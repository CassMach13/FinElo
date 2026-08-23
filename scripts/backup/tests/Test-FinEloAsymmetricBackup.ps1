[CmdletBinding()]
param(
    [string]$AgeBinDirectory = $env:FINELO_TEST_AGE_BIN,
    [string]$SevenZipPath = 'C:\Program Files\7-Zip\7z.exe'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$backupRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$repositoryRoot = (Resolve-Path (Join-Path $backupRoot '..\..')).Path
Import-Module (Join-Path $backupRoot 'FinElo.Backup.psm1') -Force

function Assert-True {
    param([Parameter(Mandatory)][bool]$Condition, [Parameter(Mandatory)][string]$Message)
    if (-not $Condition) { throw "ASSERTION FAILED: $Message" }
}

function Assert-Throws {
    param([Parameter(Mandatory)][scriptblock]$Action, [Parameter(Mandatory)][string]$Pattern)
    $thrown = $false
    try { & $Action } catch {
        $thrown = $true
        if ($_.Exception.Message -notmatch $Pattern) {
            throw "Exceção inesperada: $($_.Exception.Message)"
        }
    }
    if (-not $thrown) { throw "ASSERTION FAILED: era esperada uma exceção contendo '$Pattern'." }
}

if ([string]::IsNullOrWhiteSpace($AgeBinDirectory)) {
    throw 'Defina FINELO_TEST_AGE_BIN com a pasta dos binários oficiais age 1.3+.'
}

$agePath = Join-Path $AgeBinDirectory 'age.exe'
$ageInspectPath = Join-Path $AgeBinDirectory 'age-inspect.exe'
$ageKeygenPath = Join-Path $AgeBinDirectory 'age-keygen.exe'
foreach ($tool in @($agePath, $ageInspectPath, $ageKeygenPath, $SevenZipPath)) {
    if (-not (Test-Path -LiteralPath $tool -PathType Leaf)) { throw "Ferramenta ausente: $tool" }
}

$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('finelo-asymmetric-test-' + [guid]::NewGuid().ToString('N'))
$identityPath = Join-Path $testRoot 'ephemeral-pq-identity.txt'
$recipientPath = Join-Path $testRoot 'ephemeral-pq-recipient.txt'
$classicIdentityPath = Join-Path $testRoot 'ephemeral-classic-identity.txt'
$classicRecipientPath = Join-Path $testRoot 'ephemeral-classic-recipient.txt'
$sourceRoot = Join-Path $testRoot 'logical-source'
$outputRoot = Join-Path $testRoot 'encrypted-output'
$restoreRoot = Join-Path $testRoot 'restore'
$decryptedArchive = Join-Path $testRoot 'decrypted.7z'
$recoveryEvidence = Join-Path $testRoot 'recovery-evidence.json'
$backupId = 'FinElo-Synthetic-20000101-000000-age-v1'

try {
    $null = New-Item -ItemType Directory -Path $testRoot
    $null = Invoke-FinEloProcess -FilePath $ageKeygenPath -ArgumentList @('-pq', '-o', $identityPath) -Operation 'Geração da identidade PQ efêmera'
    $null = Invoke-FinEloProcess -FilePath $ageKeygenPath -ArgumentList @('-y', '-o', $recipientPath, $identityPath) -Operation 'Derivação do recipient PQ efêmero'
    $null = Invoke-FinEloProcess -FilePath $ageKeygenPath -ArgumentList @('-o', $classicIdentityPath) -Operation 'Geração da identidade clássica efêmera'
    $null = Invoke-FinEloProcess -FilePath $ageKeygenPath -ArgumentList @('-y', '-o', $classicRecipientPath, $classicIdentityPath) -Operation 'Derivação do recipient clássico efêmero'

    $recipientLine = (Get-Content -LiteralPath $recipientPath | Where-Object { $_ -and -not $_.StartsWith('#') } | Select-Object -First 1).Trim()
    $canonicalSha = Get-FinEloSha256Hex -Text $recipientLine

    $databaseRoot = Join-Path $sourceRoot 'database'
    $recoveryRoot = Join-Path $sourceRoot 'recovery'
    $null = New-Item -ItemType Directory -Path $databaseRoot -Force
    $null = New-Item -ItemType Directory -Path $recoveryRoot -Force

    $fixtures = [ordered]@{
        'roles.sql' = 'create role fixture_reader nologin;'
        'schema.sql' = 'create table public.fixture (id bigint primary key, amount numeric(12,2));'
        'data.sql' = "COPY public.fixture (id, amount) FROM stdin;`n1`t10.01`n\."
        'history_schema.sql' = 'create schema if not exists supabase_migrations;'
        'history_data.sql' = "-- synthetic migration history`nselect 1;"
        'auth_storage_changes.sql' = '-- no synthetic changes'
    }
    foreach ($entry in $fixtures.GetEnumerator()) {
        [IO.File]::WriteAllText((Join-Path $databaseRoot $entry.Key), $entry.Value, [System.Text.UTF8Encoding]::new($false))
    }
    [IO.File]::WriteAllText(
        (Join-Path $recoveryRoot 'dr-inventory.json'),
        '{"format":"finelo-disaster-recovery-inventory/v1","storage":{"bucket_count":0,"object_count":0}}',
        [System.Text.UTF8Encoding]::new($false)
    )

    $packageParameters = @{
        SourceDirectory = $sourceRoot
        OutputDirectory = $outputRoot
        RecipientFile = $recipientPath
        ProjectRef = 'sxmmrnwbxntccscojmfh'
        CanonicalRecipientSha256 = $canonicalSha
        AgePath = $agePath
        AgeInspectPath = $ageInspectPath
        SevenZipPath = $SevenZipPath
        BackupId = $backupId
        CodeCommit = 'synthetic-test'
        RepositoryRoot = $repositoryRoot
    }
    $packageResult = & (Join-Path $backupRoot 'New-FinEloEncryptedBackup.ps1') @packageParameters

    Assert-True -Condition (Test-Path -LiteralPath $packageResult.Archive -PathType Leaf) -Message 'artefato criptografado ausente'
    Assert-True -Condition (Test-Path -LiteralPath $packageResult.Receipt -PathType Leaf) -Message 'receipt ausente'
    Assert-True -Condition (-not [bool]$packageResult.RecoveryTested) -Message 'validação estrutural foi marcada como teste de recuperação'

    $receipt = Get-Content -LiteralPath $packageResult.Receipt -Raw | ConvertFrom-Json
    Assert-True -Condition ($receipt.validation.age_inspect -ceq 'passed') -Message 'age-inspect não consta como aprovado'
    Assert-True -Condition ($receipt.validation.scope -ceq 'structural-only-no-private-key') -Message 'escopo estrutural incorreto'
    Assert-True -Condition (-not [bool]$receipt.validation.recovery_tested) -Message 'receipt declarou recuperação testada'
    Assert-True -Condition ($receipt.code_commit -ceq 'synthetic-test') -Message 'receipt não preservou o commit do runner'
    Assert-True -Condition ($receipt.recipient.canonical_sha256 -ceq $canonicalSha) -Message 'fingerprint do receipt diverge'
    Assert-True -Condition ($receipt.artifact.sha256 -ceq (Get-FinEloSha256Hex -LiteralPath $packageResult.Archive)) -Message 'SHA-256 do artefato diverge'

    $recoveryParameters = @{
        EncryptedArchive = $packageResult.Archive
        ReceiptFile = $packageResult.Receipt
        IdentityFile = $identityPath
        ExpectedProjectRef = 'sxmmrnwbxntccscojmfh'
        CanonicalRecipientSha256 = $canonicalSha
        AgePath = $agePath
        AgeInspectPath = $ageInspectPath
        SevenZipPath = $SevenZipPath
        EvidenceFile = $recoveryEvidence
        RepositoryRoot = $repositoryRoot
    }
    $recoveryResult = & (Join-Path $backupRoot 'Test-FinEloPrivateKeyRecovery.ps1') @recoveryParameters
    Assert-True -Condition ([bool]$recoveryResult.Passed) -Message 'verificador de chave privada falhou'
    Assert-True -Condition ($recoveryResult.PrivateKeyDecryption -ceq 'passed') -Message 'descriptografia real não foi comprovada'
    Assert-True -Condition (Test-Path -LiteralPath $recoveryEvidence -PathType Leaf) -Message 'evidência de recuperação ausente'
    $recoveryEvidenceJson = Get-Content -LiteralPath $recoveryEvidence -Raw | ConvertFrom-Json
    Assert-True -Condition ($recoveryEvidenceJson.validation.disposable_supabase_restore -ceq 'not-performed') -Message 'ensaio local foi confundido com restauração no Supabase'

    $null = Invoke-FinEloProcess -FilePath $agePath -ArgumentList @(
        '--decrypt', '--identity', $identityPath, '--output', $decryptedArchive, $packageResult.Archive
    ) -Operation 'Descriptografia sintética real'
    $sevenZipTest = Invoke-FinEloProcess -FilePath $SevenZipPath -ArgumentList @('t', $decryptedArchive) -Operation 'Teste do 7z descriptografado'
    Assert-True -Condition ($sevenZipTest.StdOut -match 'Everything is Ok') -Message '7z descriptografado inválido'

    $null = New-Item -ItemType Directory -Path $restoreRoot
    $null = Invoke-FinEloProcess -FilePath $SevenZipPath -ArgumentList @('x', $decryptedArchive, ('-o' + $restoreRoot), '-y') -Operation 'Extração sintética'
    $manifestPath = Join-Path $restoreRoot 'manifest.json'
    Assert-True -Condition (Test-Path -LiteralPath $manifestPath -PathType Leaf) -Message 'manifest ausente após restauração'
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    foreach ($file in $manifest.files) {
        $restoredPath = Join-Path $restoreRoot ([string]$file.path).Replace('/', [IO.Path]::DirectorySeparatorChar)
        Assert-True -Condition (Test-Path -LiteralPath $restoredPath -PathType Leaf) -Message "arquivo restaurado ausente: $($file.path)"
        Assert-True -Condition ((Get-FinEloSha256Hex -LiteralPath $restoredPath) -ceq [string]$file.sha256) -Message "hash restaurado diverge: $($file.path)"
    }

    Assert-Throws -Pattern 'fingerprint canônico' -Action {
        Get-FinEloRecipientInfo -RecipientFile $recipientPath -CanonicalSha256 ('0' * 64) | Out-Null
    }
    Assert-Throws -Pattern 'híbrido pós-quântico' -Action {
        $classicLine = (Get-Content -LiteralPath $classicRecipientPath | Where-Object { $_ -and -not $_.StartsWith('#') } | Select-Object -First 1).Trim()
        Get-FinEloRecipientInfo -RecipientFile $classicRecipientPath -CanonicalSha256 (Get-FinEloSha256Hex -Text $classicLine) | Out-Null
    }
    Assert-Throws -Pattern 'privilegiada' -Action {
        Get-FinEloDatabaseConnectionInfo -DatabaseUrl 'postgresql://postgres:secret@db.sxmmrnwbxntccscojmfh.supabase.com:5432/postgres?sslmode=require' -ExpectedProjectRef 'sxmmrnwbxntccscojmfh' | Out-Null
    }

    $connection = Get-FinEloDatabaseConnectionInfo -DatabaseUrl 'postgresql://finelo_backup_reader.sxmmrnwbxntccscojmfh:secret@aws-0-sa-east-1.pooler.supabase.com:5432/postgres?sslmode=require' -ExpectedProjectRef 'sxmmrnwbxntccscojmfh'
    Assert-True -Condition ($connection.UserName -ceq 'finelo_backup_reader.sxmmrnwbxntccscojmfh') -Message 'papel de backup válido foi recusado'
    $connection.Password = ''
    $connection.OriginalUrl = ''

    $invalidPreflight = [pscustomobject]@{
        current_user = 'finelo_backup_reader'
        project_ref = 'sxmmrnwbxntccscojmfh'
        transaction_read_only = 'on'
        role_default_read_only = $true
        is_superuser = $false
        can_create_db = $false
        can_create_role = $false
        can_replicate = $false
        can_bypass_rls = $false
        writable_table_count = 1
        executable_security_definer_count = 0
        storage_object_count = 0
        storage_bucket_count = 0
        server_version_num = 170006
    }
    Assert-Throws -Pattern 'privilégios DML' -Action {
        Test-FinEloReadOnlyPreflightResult -Result $invalidPreflight -ExpectedRole 'finelo_backup_reader' -ExpectedProjectRef 'sxmmrnwbxntccscojmfh' | Out-Null
    }
    $invalidPreflight.writable_table_count = 0
    $invalidPreflight.executable_security_definer_count = 1
    Assert-Throws -Pattern 'SECURITY DEFINER' -Action {
        Test-FinEloReadOnlyPreflightResult -Result $invalidPreflight -ExpectedRole 'finelo_backup_reader' -ExpectedProjectRef 'sxmmrnwbxntccscojmfh' | Out-Null
    }
    Assert-Throws -Pattern 'STORAGE_OBJECT_EXPORT_REQUIRED' -Action {
        Assert-FinEloStorageRecoveryReady -StorageObjectCount 1 -StorageObjectExportDirectory ''
    }
    $storageExportRoot = Join-Path $testRoot 'storage-export'
    $storageObjectPath = Join-Path $storageExportRoot 'objects/images/example.bin'
    $null = New-Item -ItemType Directory -Path (Split-Path -Parent $storageObjectPath) -Force
    [IO.File]::WriteAllBytes($storageObjectPath, [byte[]](1, 2, 3, 4))
    $storageInventoryPath = Join-Path $storageExportRoot 'storage-object-inventory.json'
    $storageInventory = [ordered]@{
        object_count = 1
        objects = @([ordered]@{
            path = 'objects/images/example.bin'
            bytes = 4
            sha256 = Get-FinEloSha256Hex -LiteralPath $storageObjectPath
        })
    }
    [IO.File]::WriteAllText($storageInventoryPath, ($storageInventory | ConvertTo-Json -Depth 6), [System.Text.UTF8Encoding]::new($false))
    Assert-FinEloStorageRecoveryReady -StorageObjectCount 1 -StorageObjectExportDirectory $storageExportRoot
    Assert-True -Condition $true -Message 'export válido do Storage foi recusado'
    $storageInventory.objects[0].sha256 = '0' * 64
    [IO.File]::WriteAllText($storageInventoryPath, ($storageInventory | ConvertTo-Json -Depth 6), [System.Text.UTF8Encoding]::new($false))
    Assert-Throws -Pattern 'tamanho ou SHA-256' -Action {
        Assert-FinEloStorageRecoveryReady -StorageObjectCount 1 -StorageObjectExportDirectory $storageExportRoot
    }
    Assert-Throws -Pattern 'Nada foi sobrescrito' -Action {
        & (Join-Path $backupRoot 'New-FinEloEncryptedBackup.ps1') @packageParameters | Out-Null
    }

    $inventoryPath = Join-Path $testRoot 'generated-dr-inventory.json'
    $inventoryParameters = @{
        RepositoryRoot = $repositoryRoot
        OutputFile = $inventoryPath
        ProjectRef = 'sxmmrnwbxntccscojmfh'
        StorageBucketCount = 1
        StorageObjectCount = 0
        CodeCommit = 'synthetic-test'
    }
    $inventoryResult = & (Join-Path $backupRoot 'New-FinEloDrInventory.ps1') @inventoryParameters
    Assert-True -Condition ($inventoryResult.EdgeFunctionCount -eq 2) -Message 'inventário não encontrou as duas Edge Functions'
    $generatedInventory = Get-Content -LiteralPath $inventoryPath -Raw | ConvertFrom-Json
    Assert-True -Condition (@($generatedInventory.edge_functions).Count -eq 2) -Message 'inventário de Edge Functions incompleto'
    Assert-True -Condition (-not [bool]$generatedInventory.database.vault_secret_values_included) -Message 'inventário permite secrets do Vault'

    [pscustomobject]@{
        Passed = $true
        Assertions = 34
        Encryption = 'age-pq-hybrid'
        StructuralInspection = 'passed'
        SyntheticDecryption = 'passed'
        SyntheticArchiveRestore = 'passed'
        PrivateKeyUsed = 'ephemeral-test-only'
    }
}
finally {
    $recipientLine = $null
    $canonicalSha = $null
    $resolvedTestRoot = [IO.Path]::GetFullPath($testRoot)
    $resolvedTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if (-not $resolvedTestRoot.StartsWith($resolvedTemp, [StringComparison]::OrdinalIgnoreCase) -or
        -not (Split-Path -Leaf $resolvedTestRoot).StartsWith('finelo-asymmetric-test-', [StringComparison]::Ordinal)) {
        throw 'A limpeza de testes recusou um caminho fora do escopo temporário.'
    }
    Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force -ErrorAction SilentlyContinue
}
