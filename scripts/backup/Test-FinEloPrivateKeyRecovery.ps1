[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$EncryptedArchive,

    [Parameter(Mandatory)]
    [string]$ReceiptFile,

    [Parameter(Mandatory)]
    [string]$IdentityFile,

    [Parameter(Mandatory)]
    [ValidatePattern('^[a-z0-9]{20}$')]
    [string]$ExpectedProjectRef,

    [string]$CanonicalRecipientSha256 = $env:FINELO_BACKUP_RECIPIENT_SHA256_CANONICAL,

    [Parameter(Mandatory)]
    [string]$AgePath,

    [Parameter(Mandatory)]
    [string]$AgeInspectPath,

    [string]$SevenZipPath = 'C:\Program Files\7-Zip\7z.exe',

    [string]$EvidenceFile = '',

    [string]$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'FinElo.Backup.psm1') -Force

foreach ($path in @($EncryptedArchive, $ReceiptFile, $IdentityFile, $AgePath, $AgeInspectPath, $SevenZipPath)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw 'Um arquivo obrigatório para o ensaio de recuperação não foi encontrado.'
    }
}
if ($CanonicalRecipientSha256 -notmatch '^[0-9a-fA-F]{64}$') {
    throw 'O fingerprint canônico protegido não foi fornecido.'
}

$repository = [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $RepositoryRoot).Path)
$repositoryWithSeparator = $repository.TrimEnd(
    [IO.Path]::DirectorySeparatorChar,
    [IO.Path]::AltDirectorySeparatorChar
) + [IO.Path]::DirectorySeparatorChar
$identity = [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $IdentityFile).Path)
if ($identity.StartsWith($repositoryWithSeparator, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'A chave privada não pode estar dentro do repositório.'
}

$receipt = Get-Content -LiteralPath $ReceiptFile -Raw | ConvertFrom-Json
if ([string]$receipt.format -cne 'finelo-backup-receipt/v1' -or
    [string]$receipt.project_ref -cne $ExpectedProjectRef) {
    throw 'O receipt não corresponde ao formato ou projeto esperado.'
}
if (-not (Test-FinEloFixedTimeHexEqual `
    -Left ([string]$receipt.recipient.canonical_sha256) `
    -Right $CanonicalRecipientSha256)) {
    throw 'O receipt não corresponde ao fingerprint canônico protegido.'
}

$archiveItem = Get-Item -LiteralPath $EncryptedArchive
if ([long]$archiveItem.Length -ne [long]$receipt.artifact.bytes -or
    (Get-FinEloSha256Hex -LiteralPath $EncryptedArchive) -cne ([string]$receipt.artifact.sha256).ToLowerInvariant()) {
    throw 'O artefato criptografado não corresponde ao receipt.'
}

$inspection = Test-FinEloAgeEnvelope -AgeInspectPath $AgeInspectPath -EncryptedFile $EncryptedArchive
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ('finelo-private-recovery-' + [guid]::NewGuid().ToString('N'))
$plainArchive = Join-Path $tempRoot 'backup.7z'
$restoreRoot = Join-Path $tempRoot 'restored'

try {
    $null = New-Item -ItemType Directory -Path $tempRoot
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
        Set-Acl -LiteralPath $tempRoot -AclObject $acl
    }

    $null = Invoke-FinEloProcess -FilePath $AgePath -ArgumentList @(
        '--decrypt', '--identity', $identity, '--output', $plainArchive, $EncryptedArchive
    ) -Operation 'Descriptografia real com chave privada'

    $sevenZipTest = Invoke-FinEloProcess -FilePath $SevenZipPath -ArgumentList @(
        't', $plainArchive
    ) -Operation 'Teste do arquivo descriptografado'
    if ($sevenZipTest.StdOut -notmatch 'Everything is Ok') {
        throw 'O 7-Zip não confirmou a integridade do arquivo descriptografado.'
    }

    $null = New-Item -ItemType Directory -Path $restoreRoot
    $null = Invoke-FinEloProcess -FilePath $SevenZipPath -ArgumentList @(
        'x', $plainArchive, ('-o' + $restoreRoot), '-y'
    ) -Operation 'Extração controlada do backup'

    $manifestPath = Join-Path $restoreRoot 'manifest.json'
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        throw 'O manifest não foi encontrado no arquivo restaurado.'
    }
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    if ([string]$manifest.format -cne 'finelo-logical-backup/v2' -or
        [string]$manifest.project_ref -cne $ExpectedProjectRef -or
        [string]$manifest.encryption.recipient_sha256 -cne $CanonicalRecipientSha256.ToLowerInvariant()) {
        throw 'O manifest não corresponde ao formato, projeto ou recipient esperado.'
    }

    $restoreRootFull = [IO.Path]::GetFullPath($restoreRoot)
    $restoreRootWithSeparator = $restoreRootFull.TrimEnd(
        [IO.Path]::DirectorySeparatorChar,
        [IO.Path]::AltDirectorySeparatorChar
    ) + [IO.Path]::DirectorySeparatorChar
    $verifiedFileCount = 0
    foreach ($file in @($manifest.files)) {
        $relativePath = [string]$file.path
        if ([string]::IsNullOrWhiteSpace($relativePath) -or [IO.Path]::IsPathRooted($relativePath)) {
            throw 'O manifest contém um caminho inválido.'
        }
        $restoredPath = [IO.Path]::GetFullPath((Join-Path $restoreRoot $relativePath.Replace('/', [IO.Path]::DirectorySeparatorChar)))
        if (-not $restoredPath.StartsWith($restoreRootWithSeparator, [StringComparison]::OrdinalIgnoreCase) -or
            -not (Test-Path -LiteralPath $restoredPath -PathType Leaf)) {
            throw 'O manifest referencia um arquivo ausente ou fora do diretório de restauração.'
        }
        $restoredItem = Get-Item -LiteralPath $restoredPath -Force
        if (($restoredItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
            [long]$restoredItem.Length -ne [long]$file.bytes -or
            (Get-FinEloSha256Hex -LiteralPath $restoredPath) -cne ([string]$file.sha256).ToLowerInvariant()) {
            throw 'Um arquivo restaurado diverge do tamanho ou SHA-256 do manifest.'
        }
        $verifiedFileCount++
    }

    $evidence = [ordered]@{
        format = 'finelo-recovery-evidence/v1'
        tested_at_utc = (Get-Date).ToUniversalTime().ToString('o')
        backup_id = [string]$receipt.backup_id
        project_ref = $ExpectedProjectRef
        artifact_sha256 = [string]$receipt.artifact.sha256
        recipient_sha256 = $CanonicalRecipientSha256.ToLowerInvariant()
        validation = [ordered]@{
            age_inspect_structural = 'passed'
            private_key_decryption = 'passed'
            seven_zip_integrity = 'passed'
            manifest_files_verified = $verifiedFileCount
            disposable_supabase_restore = 'not-performed'
        }
        private_key_material_recorded = $false
    }

    if (-not [string]::IsNullOrWhiteSpace($EvidenceFile)) {
        if (Test-Path -LiteralPath $EvidenceFile) {
            throw 'O arquivo de evidência já existe. Nada foi sobrescrito.'
        }
        $evidenceParent = Split-Path -Parent $EvidenceFile
        if (-not (Test-Path -LiteralPath $evidenceParent -PathType Container)) {
            $null = New-Item -ItemType Directory -Path $evidenceParent
        }
        [IO.File]::WriteAllText($EvidenceFile, ($evidence | ConvertTo-Json -Depth 8), [System.Text.UTF8Encoding]::new($false))
    }

    [pscustomobject]@{
        Passed = $true
        BackupId = [string]$receipt.backup_id
        ProjectRef = $ExpectedProjectRef
        StructuralInspection = $inspection.ValidationScope
        PrivateKeyDecryption = 'passed'
        ManifestFilesVerified = $verifiedFileCount
        DisposableSupabaseRestore = 'not-performed'
        EvidenceFile = $EvidenceFile
    }
}
finally {
    $resolvedTempRoot = [IO.Path]::GetFullPath($tempRoot)
    $resolvedTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if (-not $resolvedTempRoot.StartsWith($resolvedTemp, [StringComparison]::OrdinalIgnoreCase) -or
        -not (Split-Path -Leaf $resolvedTempRoot).StartsWith('finelo-private-recovery-', [StringComparison]::Ordinal)) {
        throw 'A limpeza recusou um caminho fora do diretório temporário controlado.'
    }
    Remove-Item -LiteralPath $resolvedTempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
