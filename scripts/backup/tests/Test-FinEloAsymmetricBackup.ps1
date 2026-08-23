[CmdletBinding()]
param(
    [string]$AgeBinDirectory = $env:FINELO_TEST_AGE_BIN,
    [string]$SevenZipPath = 'C:\Program Files\7-Zip\7z.exe',
    [string]$ProductionRecipientFile = '',
    [string]$ExpectedProductionRecipientSha256 = $env:FINELO_BACKUP_RECIPIENT_SHA256_CANONICAL,
    [string]$ProductionRecipientSha256File = $env:FINELO_BACKUP_RECIPIENT_SHA256_FILE
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$backupRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$repositoryRoot = (Resolve-Path (Join-Path $backupRoot '..\..')).Path
Import-Module (Join-Path $backupRoot 'FinElo.Backup.psm1') -Force
$script:AssertionCount = 0

function Assert-True {
    param([Parameter(Mandatory)][bool]$Condition, [Parameter(Mandatory)][string]$Message)
    if (-not $Condition) { throw "ASSERTION FAILED: $Message" }
    $script:AssertionCount++
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
    $script:AssertionCount++
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
$productionRecipientOutput = Join-Path $testRoot 'production-recipient-output'
$protectedFingerprintFile = Join-Path $testRoot 'protected-source/recipient-fingerprint.sha256'
$protectedFingerprintOutput = Join-Path $testRoot 'protected-fingerprint-output'
$protectedDatabaseUrlFile = Join-Path $testRoot 'protected-credentials/readonly-db-url.dpapi'
$protectedCredentialFile = Join-Path $testRoot 'protected-generated-credential/readonly-db-url.dpapi'
$backupId = 'FinElo-Synthetic-20000101-000000-age-v1'

try {
    $null = New-Item -ItemType Directory -Path $testRoot
    $null = Invoke-FinEloProcess -FilePath $ageKeygenPath -ArgumentList @('-pq', '-o', $identityPath) -Operation 'Geração da identidade PQ efêmera'
    $null = Invoke-FinEloProcess -FilePath $ageKeygenPath -ArgumentList @('-y', '-o', $recipientPath, $identityPath) -Operation 'Derivação do recipient PQ efêmero'
    $null = Invoke-FinEloProcess -FilePath $ageKeygenPath -ArgumentList @('-o', $classicIdentityPath) -Operation 'Geração da identidade clássica efêmera'
    $null = Invoke-FinEloProcess -FilePath $ageKeygenPath -ArgumentList @('-y', '-o', $classicRecipientPath, $classicIdentityPath) -Operation 'Derivação do recipient clássico efêmero'

    $recipientLine = (Get-Content -LiteralPath $recipientPath | Where-Object { $_ -and -not $_.StartsWith('#') } | Select-Object -First 1).Trim()
    $canonicalSha = Get-FinEloSha256Hex -Text $recipientLine

    $protectedInstallParameters = @{
        RecipientFile = $recipientPath
        ExpectedSha256 = $canonicalSha
        DestinationFile = $protectedFingerprintFile
        RepositoryRoot = $repositoryRoot
    }
    $protectedInstall = & (Join-Path $backupRoot 'Install-FinEloProtectedRecipientFingerprint.ps1') @protectedInstallParameters
    Assert-True -Condition ([bool]$protectedInstall.Installed) -Message 'fonte protegida não foi instalada'
    Assert-True -Condition (Test-Path -LiteralPath $protectedFingerprintFile -PathType Leaf) -Message 'arquivo protegido ausente'
    $protectedCanonical = Get-FinEloCanonicalRecipientSha256 -ProtectedSha256File $protectedFingerprintFile -RepositoryRoot $repositoryRoot
    Assert-True -Condition ($protectedCanonical -ceq $canonicalSha) -Message 'fonte protegida diverge do fingerprint esperado'
    Assert-Throws -Pattern 'já existe' -Action {
        & (Join-Path $backupRoot 'Install-FinEloProtectedRecipientFingerprint.ps1') @protectedInstallParameters | Out-Null
    }
    Assert-Throws -Pattern 'duas fontes protegidas' -Action {
        Get-FinEloCanonicalRecipientSha256 -ExplicitSha256 ('0' * 64) -ProtectedSha256File $protectedFingerprintFile -RepositoryRoot $repositoryRoot | Out-Null
    }

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
        CanonicalRecipientSha256File = ''
        AgePath = $agePath
        AgeInspectPath = $ageInspectPath
        SevenZipPath = $SevenZipPath
        BackupId = $backupId
        CodeCommit = 'synthetic-test'
        RepositoryRoot = $repositoryRoot
    }
    $packageResult = & (Join-Path $backupRoot 'New-FinEloEncryptedBackup.ps1') @packageParameters

    $protectedPackageParameters = @{} + $packageParameters
    $protectedPackageParameters.OutputDirectory = $protectedFingerprintOutput
    $protectedPackageParameters.CanonicalRecipientSha256 = ''
    $protectedPackageParameters.CanonicalRecipientSha256File = $protectedFingerprintFile
    $protectedPackageParameters.BackupId = 'FinElo-Synthetic-20000101-000003-protected-fingerprint'
    $protectedPackageResult = & (Join-Path $backupRoot 'New-FinEloEncryptedBackup.ps1') @protectedPackageParameters
    Assert-True -Condition (Test-Path -LiteralPath $protectedPackageResult.Archive -PathType Leaf) -Message 'fonte protegida não autorizou criptografia válida'
    Assert-True -Condition ($protectedPackageResult.RecipientSha256 -ceq $canonicalSha) -Message 'pacote não preservou fingerprint protegido'

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
        CanonicalRecipientSha256File = ''
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
        Get-FinEloDatabaseConnectionInfo -DatabaseUrl 'postgresql://postgres:secret@db.sxmmrnwbxntccscojmfh.supabase.co:5432/postgres?sslmode=require' -ExpectedProjectRef 'sxmmrnwbxntccscojmfh' | Out-Null
    }

    $connection = Get-FinEloDatabaseConnectionInfo -DatabaseUrl 'postgresql://finelo_backup_reader.sxmmrnwbxntccscojmfh:secret@aws-0-sa-east-1.pooler.supabase.com:5432/postgres?sslmode=require' -ExpectedProjectRef 'sxmmrnwbxntccscojmfh'
    Assert-True -Condition ($connection.UserName -ceq 'finelo_backup_reader.sxmmrnwbxntccscojmfh') -Message 'papel de backup válido foi recusado'
    $connection.Password = ''
    $connection.OriginalUrl = ''

    $syntheticDatabaseUrl = [string]::Concat(
        'postgresql://finelo_backup_reader.sxmmrnwbxntccscojmfh:',
        'synthetic-secret-never-used',
        '@aws-0-sa-east-1.pooler.supabase.com:5432/postgres?sslmode=require'
    )
    $syntheticSecureUrl = ConvertTo-SecureString -String $syntheticDatabaseUrl -AsPlainText -Force
    $protectedUrlInstall = & (Join-Path $backupRoot 'Set-FinEloProtectedReadOnlyDatabaseUrl.ps1') `
        -ExpectedProjectRef 'sxmmrnwbxntccscojmfh' `
        -DatabaseUrl $syntheticSecureUrl `
        -DestinationFile $protectedDatabaseUrlFile `
        -RepositoryRoot $repositoryRoot
    Assert-True -Condition ([bool]$protectedUrlInstall.Installed) -Message 'URL leitora protegida não foi instalada'
    Assert-True -Condition ($protectedUrlInstall.Storage -ceq 'Windows-DPAPI-CurrentUser') -Message 'URL leitora não usou DPAPI do usuário atual'
    Assert-True -Condition (-not [bool]$protectedUrlInstall.SecretPrinted) -Message 'instalador declarou exposição do segredo'
    Assert-True -Condition (Test-Path -LiteralPath $protectedDatabaseUrlFile -PathType Leaf) -Message 'arquivo DPAPI da URL leitora ausente'
    Assert-True -Condition (-not (Test-Path -LiteralPath ($protectedDatabaseUrlFile + '.partial'))) -Message 'instalação da URL leitora deixou arquivo parcial'

    $protectedUrlRoundTrip = Get-FinEloCurrentUserProtectedText `
        -ProtectedFile $protectedDatabaseUrlFile `
        -RepositoryRoot $repositoryRoot
    try {
        Assert-True -Condition ($protectedUrlRoundTrip -ceq $syntheticDatabaseUrl) -Message 'roundtrip DPAPI da URL leitora diverge'
    }
    finally {
        $protectedUrlRoundTrip = ''
    }

    $replacementSecureUrl = ConvertTo-SecureString -String $syntheticDatabaseUrl -AsPlainText -Force
    Assert-Throws -Pattern 'já existe' -Action {
        & (Join-Path $backupRoot 'Set-FinEloProtectedReadOnlyDatabaseUrl.ps1') `
            -ExpectedProjectRef 'sxmmrnwbxntccscojmfh' `
            -DatabaseUrl $replacementSecureUrl `
            -DestinationFile $protectedDatabaseUrlFile `
            -RepositoryRoot $repositoryRoot | Out-Null
    }
    $replacementSecureUrl.Dispose()
    $syntheticDatabaseUrl = ''

    $syntheticGeneratedPasswordText = 'A' * 43
    $syntheticGroupedPasswordText = '{0}.{1}.{2}.{3}' -f `
        $syntheticGeneratedPasswordText.Substring(0, 11), `
        $syntheticGeneratedPasswordText.Substring(11, 11), `
        $syntheticGeneratedPasswordText.Substring(22, 11), `
        $syntheticGeneratedPasswordText.Substring(33, 10)
    $syntheticGeneratedPassword = ConvertTo-SecureString `
        -String $syntheticGroupedPasswordText `
        -AsPlainText `
        -Force
    $credentialInstall = & (Join-Path $backupRoot 'Install-FinEloProtectedReadOnlyCredential.ps1') `
        -ProjectRef 'sxmmrnwbxntccscojmfh' `
        -Password $syntheticGeneratedPassword `
        -DestinationFile $protectedCredentialFile `
        -RepositoryRoot $repositoryRoot
    Assert-True -Condition ([bool]$credentialInstall.Installed) -Message 'instalador da credencial gerada falhou'
    Assert-True -Condition (-not [bool]$credentialInstall.PasswordPrinted) -Message 'instalador declarou exposição da senha'
    Assert-True -Condition (Test-Path -LiteralPath $protectedCredentialFile -PathType Leaf) -Message 'credencial gerada protegida ausente'
    $generatedCredentialRoundTrip = Get-FinEloCurrentUserProtectedText `
        -ProtectedFile $protectedCredentialFile `
        -RepositoryRoot $repositoryRoot
    try {
        $expectedGeneratedUrl = 'postgresql://finelo_backup_reader:{0}@db.sxmmrnwbxntccscojmfh.supabase.co:5432/postgres?sslmode=require' -f $syntheticGeneratedPasswordText
        Assert-True -Condition ($generatedCredentialRoundTrip -ceq $expectedGeneratedUrl) -Message 'URL montada pelo instalador diverge'
    }
    finally {
        $generatedCredentialRoundTrip = ''
        $expectedGeneratedUrl = ''
        $syntheticGeneratedPasswordText = ''
        $syntheticGroupedPasswordText = ''
    }

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

    $inspectionFailureId = 'FinElo-Synthetic-20000101-000001-inspection-failure'
    $inspectionFailureParameters = @{} + $packageParameters
    $inspectionFailureParameters.BackupId = $inspectionFailureId
    $inspectionFailureParameters.AgeInspectPath = $agePath
    Assert-Throws -Pattern 'Validação estrutural age-inspect' -Action {
        & (Join-Path $backupRoot 'New-FinEloEncryptedBackup.ps1') @inspectionFailureParameters | Out-Null
    }
    foreach ($suffix in @('.7z.age', '.receipt.json', '.7z.age.partial', '.receipt.json.partial')) {
        Assert-True -Condition (-not (Test-Path -LiteralPath (Join-Path $outputRoot ($inspectionFailureId + $suffix)))) -Message "falha deixou artefato $suffix"
    }

    if (-not [string]::IsNullOrWhiteSpace($ProductionRecipientFile)) {
        $productionExpectedSha = Get-FinEloCanonicalRecipientSha256 `
            -ExplicitSha256 $ExpectedProductionRecipientSha256 `
            -ProtectedSha256File $ProductionRecipientSha256File `
            -RepositoryRoot $repositoryRoot
        $productionRecipientInfo = Get-FinEloRecipientInfo `
            -RecipientFile $ProductionRecipientFile `
            -CanonicalSha256 $productionExpectedSha
        Assert-True -Condition ($productionRecipientInfo.Type -ceq 'mlkem768x25519') -Message 'recipient definitivo não é híbrido PQ'
        Assert-True -Condition ($productionRecipientInfo.Sha256 -ceq $productionExpectedSha) -Message 'fingerprint definitivo diverge'

        $productionPackageParameters = @{} + $packageParameters
        $productionPackageParameters.OutputDirectory = $productionRecipientOutput
        $productionPackageParameters.RecipientFile = $ProductionRecipientFile
        $productionPackageParameters.CanonicalRecipientSha256 = $ExpectedProductionRecipientSha256
        $productionPackageParameters.CanonicalRecipientSha256File = $ProductionRecipientSha256File
        $productionPackageParameters.BackupId = 'FinElo-Synthetic-20000101-000002-production-recipient'
        $productionPackageResult = & (Join-Path $backupRoot 'New-FinEloEncryptedBackup.ps1') @productionPackageParameters
        $productionReceipt = Get-Content -LiteralPath $productionPackageResult.Receipt -Raw | ConvertFrom-Json
        Assert-True -Condition (Test-Path -LiteralPath $productionPackageResult.Archive -PathType Leaf) -Message 'recipient definitivo não produziu artefato'
        Assert-True -Condition ($productionReceipt.validation.age_inspect -ceq 'passed') -Message 'artefato definitivo não passou no age-inspect'
        Assert-True -Condition (-not [bool]$productionReceipt.validation.recovery_tested) -Message 'artefato sem chave privada foi marcado como recuperado'
        Assert-True -Condition (@(Get-ChildItem -LiteralPath $productionRecipientOutput -File -Filter '*.partial').Count -eq 0) -Message 'recipient definitivo deixou arquivo parcial'
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
        Assertions = $script:AssertionCount
        Encryption = 'age-pq-hybrid'
        StructuralInspection = 'passed'
        SyntheticDecryption = 'passed'
        SyntheticArchiveRestore = 'passed'
        PrivateKeyUsed = 'ephemeral-test-only'
        ProductionRecipientValidated = (-not [string]::IsNullOrWhiteSpace($ProductionRecipientFile))
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
