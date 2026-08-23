[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$SourceDirectory,

    [Parameter(Mandatory)]
    [string]$OutputDirectory,

    [Parameter(Mandatory)]
    [string]$RecipientFile,

    [Parameter(Mandatory)]
    [ValidatePattern('^[a-z0-9]{20}$')]
    [string]$ProjectRef,

    [string]$CanonicalRecipientSha256 = $env:FINELO_BACKUP_RECIPIENT_SHA256_CANONICAL,

    [string]$CanonicalRecipientSha256File = $env:FINELO_BACKUP_RECIPIENT_SHA256_FILE,

    [Parameter(Mandatory)]
    [string]$AgePath,

    [Parameter(Mandatory)]
    [string]$AgeInspectPath,

    [string]$SevenZipPath = 'C:\Program Files\7-Zip\7z.exe',

    [string]$BackupId = ('FinElo-Production-{0}-age-v1' -f (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss')),

    [string]$CodeCommit = '',

    [string]$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'FinElo.Backup.psm1') -Force

function New-RestrictedBackupTempDirectory {
    $path = Join-Path ([IO.Path]::GetTempPath()) ('finelo-asymmetric-backup-' + [guid]::NewGuid().ToString('N'))
    $null = New-Item -ItemType Directory -Path $path

    if ($IsWindows) {
        $currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
        $acl = [System.Security.AccessControl.DirectorySecurity]::new()
        $acl.SetOwner($currentSid)
        $acl.SetAccessRuleProtection($true, $false)
        $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
            $currentSid,
            [System.Security.AccessControl.FileSystemRights]::FullControl,
            [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit',
            [System.Security.AccessControl.PropagationFlags]::None,
            [System.Security.AccessControl.AccessControlType]::Allow
        )
        $null = $acl.AddAccessRule($rule)
        Set-Acl -LiteralPath $path -AclObject $acl
    }

    return $path
}

function Remove-RestrictedBackupTempDirectory {
    param([Parameter(Mandatory)][string]$LiteralPath)

    $resolvedPath = [IO.Path]::GetFullPath($LiteralPath)
    $resolvedTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    $leafName = Split-Path -Leaf $resolvedPath
    if (-not $resolvedPath.StartsWith($resolvedTemp, [StringComparison]::OrdinalIgnoreCase) -or
        -not $leafName.StartsWith('finelo-asymmetric-backup-', [StringComparison]::Ordinal)) {
        throw 'A limpeza recusou um caminho fora do diretório temporário controlado.'
    }

    Remove-Item -LiteralPath $resolvedPath -Recurse -Force -ErrorAction SilentlyContinue
}

if ($BackupId -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$') {
    throw 'BackupId contém caracteres não permitidos.'
}
if (-not (Test-Path -LiteralPath $SourceDirectory -PathType Container)) {
    throw 'A origem do backup não foi encontrada.'
}
if ((Get-Item -LiteralPath $SourceDirectory -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
    throw 'A origem do backup não pode ser um link ou reparse point.'
}
if (-not (Test-Path -LiteralPath $AgePath -PathType Leaf)) {
    throw 'age não foi encontrado.'
}
if (-not (Test-Path -LiteralPath $AgeInspectPath -PathType Leaf)) {
    throw 'age-inspect não foi encontrado.'
}
if (-not (Test-Path -LiteralPath $SevenZipPath -PathType Leaf)) {
    throw '7-Zip não foi encontrado.'
}
$CanonicalRecipientSha256 = Get-FinEloCanonicalRecipientSha256 `
    -ExplicitSha256 $CanonicalRecipientSha256 `
    -ProtectedSha256File $CanonicalRecipientSha256File `
    -RepositoryRoot $RepositoryRoot

$requiredRelativePaths = @(
    'database/roles.sql',
    'database/schema.sql',
    'database/data.sql',
    'database/history_schema.sql',
    'database/history_data.sql',
    'database/auth_storage_schema_snapshot.sql',
    'recovery/dr-inventory.json'
)
foreach ($relativePath in $requiredRelativePaths) {
    $platformPath = $relativePath.Replace('/', [IO.Path]::DirectorySeparatorChar)
    $requiredPath = Join-Path $SourceDirectory $platformPath
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
        throw "O pacote lógico está incompleto: falta $relativePath."
    }
    if ((Get-Item -LiteralPath $requiredPath).Length -eq 0) {
        throw "O pacote lógico contém arquivo vazio: $relativePath."
    }
}

$sourceItems = @(Get-ChildItem -LiteralPath $SourceDirectory -Recurse -Force)
$sourceFiles = @($sourceItems | Where-Object { -not $_.PSIsContainer })
if ($sourceFiles.Count -eq 0) {
    throw 'A origem do backup está vazia.'
}
if (@($sourceItems | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count -ne 0) {
    throw 'Links ou reparse points não são permitidos no pacote de backup.'
}
$forbiddenPrivateFiles = @(
    $sourceFiles | Where-Object {
        $_.Name -match '(?i)(AGE-SECRET-KEY|identity.*\.txt$|private.*key|\.pem$|\.p12$|\.env(?:\.|$))'
    }
)
if ($forbiddenPrivateFiles.Count -ne 0) {
    throw 'O pacote contém um arquivo que pode representar chave privada ou segredo externo.'
}
$textExtensions = @('.sql', '.json', '.txt', '.md', '.toml', '.yaml', '.yml')
foreach ($textFile in ($sourceFiles | Where-Object { $textExtensions -contains $_.Extension.ToLowerInvariant() })) {
    if (Select-String -LiteralPath $textFile.FullName -Pattern 'AGE-SECRET-KEY-(?:PQ-)?1|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----' -Quiet) {
        throw 'O pacote contém material que se parece com uma chave privada.'
    }
}

$recipientInfo = Get-FinEloRecipientInfo -RecipientFile $RecipientFile -CanonicalSha256 $CanonicalRecipientSha256

if (-not (Test-Path -LiteralPath $OutputDirectory -PathType Container)) {
    $null = New-Item -ItemType Directory -Path $OutputDirectory
}
$outputRoot = (Resolve-Path -LiteralPath $OutputDirectory).Path
$finalArchive = Join-Path $outputRoot ($BackupId + '.7z.age')
$finalReceipt = Join-Path $outputRoot ($BackupId + '.receipt.json')
$partialArchive = $finalArchive + '.partial'
$partialReceipt = $finalReceipt + '.partial'

foreach ($target in @($finalArchive, $finalReceipt, $partialArchive, $partialReceipt)) {
    if (Test-Path -LiteralPath $target) {
        throw 'Um artefato com este BackupId já existe. Nada foi sobrescrito.'
    }
}

$tempRoot = New-RestrictedBackupTempDirectory
$plainArchive = Join-Path $tempRoot ($BackupId + '.7z')
$payloadRoot = Join-Path $tempRoot 'payload'
$completed = $false
$archivePublished = $false
$receiptPublished = $false

try {
    $null = New-Item -ItemType Directory -Path $payloadRoot
    foreach ($sourceItem in (Get-ChildItem -LiteralPath $SourceDirectory -Force)) {
        Copy-Item -LiteralPath $sourceItem.FullName -Destination $payloadRoot -Recurse -Force
    }

    $copiedFiles = @(Get-ChildItem -LiteralPath $payloadRoot -File -Recurse -Force)
    if ($copiedFiles.Count -ne $sourceFiles.Count) {
        throw 'A cópia temporária não preservou a quantidade de arquivos da origem.'
    }

    if ([string]::IsNullOrWhiteSpace($CodeCommit)) {
        $gitResult = Invoke-FinEloProcess -FilePath 'git' -ArgumentList @('-C', $RepositoryRoot, 'rev-parse', 'HEAD') -Operation 'Leitura do commit Git'
        $CodeCommit = $gitResult.StdOut.Trim()
    }

    $manifestFiles = @(
        foreach ($file in ($copiedFiles | Sort-Object FullName)) {
            $relative = [IO.Path]::GetRelativePath($payloadRoot, $file.FullName).Replace('\', '/')
            [ordered]@{
                path = $relative
                bytes = [long]$file.Length
                sha256 = Get-FinEloSha256Hex -LiteralPath $file.FullName
            }
        }
    )

    $manifest = [ordered]@{
        format = 'finelo-logical-backup/v2'
        created_at_utc = (Get-Date).ToUniversalTime().ToString('o')
        project_ref = $ProjectRef
        code_commit = $CodeCommit
        encryption = [ordered]@{
            format = 'age-encryption.org/v1'
            recipient_type = $recipientInfo.Type
            post_quantum = $true
            recipient_sha256 = $recipientInfo.Sha256
        }
        recovery = [ordered]@{
            structural_validation = 'required'
            private_key_decryption_test = 'not-performed-by-backup-job'
            disposable_restore_test = 'not-performed-by-backup-job'
        }
        files = $manifestFiles
    }
    $manifestJson = $manifest | ConvertTo-Json -Depth 8
    [IO.File]::WriteAllText((Join-Path $payloadRoot 'manifest.json'), $manifestJson, [System.Text.UTF8Encoding]::new($false))

    $sevenZipAdd = Invoke-FinEloProcess -FilePath $SevenZipPath -ArgumentList @(
        'a', '-t7z', $plainArchive, (Join-Path $payloadRoot '*'), '-mx=9', '-y'
    ) -Operation 'Compressão 7-Zip'
    $null = $sevenZipAdd

    $sevenZipTest = Invoke-FinEloProcess -FilePath $SevenZipPath -ArgumentList @('t', $plainArchive) -Operation 'Teste estrutural 7-Zip'
    if ($sevenZipTest.StdOut -notmatch 'Everything is Ok') {
        throw 'O 7-Zip não confirmou a integridade do arquivo comprimido.'
    }

    $ageVersionResult = Invoke-FinEloProcess -FilePath $AgePath -ArgumentList @('--version') -Operation 'Leitura da versão do age'
    $ageVersion = $ageVersionResult.StdOut.Trim()
    if ($ageVersion -notmatch '^v1\.(?:[3-9]|[1-9][0-9])\.') {
        throw 'É necessário age 1.3.0 ou superior para recipients híbridos pós-quânticos.'
    }

    $encryptResult = Invoke-FinEloProcess -FilePath $AgePath -ArgumentList @(
        '--encrypt', '--recipients-file', $RecipientFile, '--output', $partialArchive, $plainArchive
    ) -Operation 'Criptografia assimétrica age'
    $null = $encryptResult

    $inspection = Test-FinEloAgeEnvelope -AgeInspectPath $AgeInspectPath -EncryptedFile $partialArchive
    $archiveItem = Get-Item -LiteralPath $partialArchive
    $archiveSha256 = Get-FinEloSha256Hex -LiteralPath $partialArchive

    $receipt = [ordered]@{
        format = 'finelo-backup-receipt/v1'
        backup_id = $BackupId
        created_at_utc = (Get-Date).ToUniversalTime().ToString('o')
        project_ref = $ProjectRef
        code_commit = $CodeCommit
        artifact = [ordered]@{
            file = [IO.Path]::GetFileName($finalArchive)
            bytes = [long]$archiveItem.Length
            sha256 = $archiveSha256
        }
        recipient = [ordered]@{
            type = $recipientInfo.Type
            post_quantum = $true
            canonical_sha256 = $recipientInfo.Sha256
        }
        tooling = [ordered]@{
            age = $ageVersion
            seven_zip = 'compression-only-no-password'
        }
        validation = [ordered]@{
            age_inspect = 'passed'
            scope = $inspection.ValidationScope
            decryption_with_private_key = 'not-performed'
            disposable_restore = 'not-performed'
            recovery_tested = $false
        }
    }
    [IO.File]::WriteAllText($partialReceipt, ($receipt | ConvertTo-Json -Depth 8), [System.Text.UTF8Encoding]::new($false))

    Move-Item -LiteralPath $partialArchive -Destination $finalArchive
    $archivePublished = $true
    Move-Item -LiteralPath $partialReceipt -Destination $finalReceipt
    $receiptPublished = $true
    $completed = $true

    [pscustomobject]@{
        Archive = $finalArchive
        Receipt = $finalReceipt
        Sha256 = $archiveSha256
        Bytes = [long]$archiveItem.Length
        RecipientSha256 = $recipientInfo.Sha256
        StructuralValidation = 'passed'
        RecoveryTested = $false
    }
}
finally {
    if (Test-Path -LiteralPath $partialArchive) {
        Remove-Item -LiteralPath $partialArchive -Force
    }
    if (Test-Path -LiteralPath $partialReceipt) {
        Remove-Item -LiteralPath $partialReceipt -Force
    }
    if (-not $completed -and $receiptPublished -and (Test-Path -LiteralPath $finalReceipt)) {
        Remove-Item -LiteralPath $finalReceipt -Force
    }
    if (-not $completed -and $archivePublished -and (Test-Path -LiteralPath $finalArchive)) {
        Remove-Item -LiteralPath $finalArchive -Force
    }
    Remove-RestrictedBackupTempDirectory -LiteralPath $tempRoot

    if (-not $completed) {
        Write-Verbose 'Nenhum artefato final foi publicado.'
    }
}
