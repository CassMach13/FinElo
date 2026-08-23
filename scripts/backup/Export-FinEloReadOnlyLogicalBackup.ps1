[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$OutputDirectory,

    [Parameter(Mandatory)]
    [ValidatePattern('^[a-z0-9]{20}$')]
    [string]$ProjectRef,

    [string]$DatabaseUrl = $env:FINELO_BACKUP_DB_URL_RO,

    [string]$ExpectedRole = 'finelo_backup_reader',

    [Parameter(Mandatory)]
    [string]$PsqlPath,

    [string[]]$PsqlArgumentPrefix = @(),

    [string]$SupabaseExecutable = 'npx.cmd',

    [string[]]$SupabaseArgumentPrefix = @('--yes', 'supabase@2.115.0'),

    [ValidatePattern('^(?:|host\.docker\.internal)$')]
    [string]$TransportHost = '',

    [ValidateRange(0, 65535)]
    [int]$TransportPort = 0,

    [string]$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,

    [string]$StorageObjectExportDirectory = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'FinElo.Backup.psm1') -Force

if ([string]::IsNullOrWhiteSpace($DatabaseUrl)) {
    throw 'FINELO_BACKUP_DB_URL_RO não foi fornecida.'
}

$forbiddenAutomationCredentials = @(
    'SUPABASE_ACCESS_TOKEN',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_DB_PASSWORD',
    'SUPABASE_DB_URL',
    'SUPABASE_DATABASE_URL',
    'POSTGRES_PASSWORD',
    'DATABASE_URL',
    'DIRECT_URL',
    'VERCEL_TOKEN',
    'GH_TOKEN',
    'GITHUB_TOKEN'
)
foreach ($name in $forbiddenAutomationCredentials) {
    if (-not [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name))) {
        throw "A sessão de backup contém a credencial proibida $name. Execute o backup em um processo isolado."
    }
}

if (Test-Path -LiteralPath $OutputDirectory) {
    throw 'O diretório de exportação já existe. Nada foi sobrescrito.'
}
if (-not (Test-Path -LiteralPath $PsqlPath -PathType Leaf)) {
    throw 'psql não foi encontrado para o preflight somente leitura.'
}

$connectionInfo = Get-FinEloDatabaseConnectionInfo -DatabaseUrl $DatabaseUrl -ExpectedProjectRef $ProjectRef -ExpectedRole $ExpectedRole
$transportDatabaseUrl = $DatabaseUrl
$preflightConnectionInfo = $connectionInfo
if ([string]::IsNullOrWhiteSpace($TransportHost) -ne ($TransportPort -eq 0)) {
    throw 'TransportHost e TransportPort devem ser informados juntos.'
}
if (-not [string]::IsNullOrWhiteSpace($TransportHost)) {
    $transportDatabaseUrl = 'postgresql://{0}:{1}@{2}:{3}/{4}?sslmode=require' -f `
        [Uri]::EscapeDataString($connectionInfo.UserName),
        [Uri]::EscapeDataString($connectionInfo.Password),
        $TransportHost,
        $TransportPort,
        [Uri]::EscapeDataString($connectionInfo.Database)
    $preflightConnectionInfo = [pscustomobject]@{
        Host = $TransportHost
        Port = $TransportPort
        Database = $connectionInfo.Database
        UserName = $connectionInfo.UserName
        Password = $connectionInfo.Password
        ProjectRef = $connectionInfo.ProjectRef
        OriginalUrl = $transportDatabaseUrl
    }
}
$redactionValues = @($DatabaseUrl, $transportDatabaseUrl, $connectionInfo.Password)
$preflight = Invoke-FinEloReadOnlyPreflight `
    -PsqlPath $PsqlPath `
    -ConnectionInfo $preflightConnectionInfo `
    -ExpectedRole $ExpectedRole `
    -PsqlArgumentPrefix $PsqlArgumentPrefix
Assert-FinEloStorageRecoveryReady -StorageObjectCount $preflight.StorageObjectCount -StorageObjectExportDirectory $StorageObjectExportDirectory

$databaseDirectory = Join-Path $OutputDirectory 'database'
$recoveryDirectory = Join-Path $OutputDirectory 'recovery'
$null = New-Item -ItemType Directory -Path $databaseDirectory -Force
$null = New-Item -ItemType Directory -Path $recoveryDirectory -Force

function Invoke-SupabaseBackupCommand {
    param(
        [Parameter(Mandatory)][string[]]$Arguments,
        [Parameter(Mandatory)][string]$Operation
    )

    $allArguments = @($SupabaseArgumentPrefix) + $Arguments
    return Invoke-FinEloProcess -FilePath $SupabaseExecutable -ArgumentList $allArguments -Operation $Operation -SensitiveValues $redactionValues
}

try {
    $rolesPath = Join-Path $databaseDirectory 'roles.sql'
    $schemaPath = Join-Path $databaseDirectory 'schema.sql'
    $dataPath = Join-Path $databaseDirectory 'data.sql'
    $historySchemaPath = Join-Path $databaseDirectory 'history_schema.sql'
    $historyDataPath = Join-Path $databaseDirectory 'history_data.sql'
    $authStorageChangesPath = Join-Path $databaseDirectory 'auth_storage_changes.sql'

    $null = Invoke-SupabaseBackupCommand -Operation 'Dump de papéis' -Arguments @(
        'db', 'dump', '--db-url', $transportDatabaseUrl, '--file', $rolesPath, '--role-only'
    )
    $null = Invoke-SupabaseBackupCommand -Operation 'Dump de schema' -Arguments @(
        'db', 'dump', '--db-url', $transportDatabaseUrl, '--file', $schemaPath
    )
    $null = Invoke-SupabaseBackupCommand -Operation 'Dump de dados' -Arguments @(
        'db', 'dump', '--db-url', $transportDatabaseUrl, '--file', $dataPath, '--use-copy', '--data-only',
        '--exclude', 'storage.buckets_vectors', '--exclude', 'storage.vector_indexes', '--exclude', 'vault.secrets'
    )
    $null = Invoke-SupabaseBackupCommand -Operation 'Dump do schema de histórico de migrations' -Arguments @(
        'db', 'dump', '--db-url', $transportDatabaseUrl, '--file', $historySchemaPath, '--schema', 'supabase_migrations'
    )
    $null = Invoke-SupabaseBackupCommand -Operation 'Dump dos dados de histórico de migrations' -Arguments @(
        'db', 'dump', '--db-url', $transportDatabaseUrl, '--file', $historyDataPath, '--use-copy', '--data-only', '--schema', 'supabase_migrations'
    )

    $authStorageDiff = Invoke-SupabaseBackupCommand -Operation 'Diff somente leitura de auth e storage' -Arguments @(
        'db', 'diff', '--db-url', $transportDatabaseUrl, '--schema', 'auth,storage'
    )
    $diffText = $authStorageDiff.StdOut
    if ([string]::IsNullOrWhiteSpace($diffText)) {
        $diffText = '-- Nenhuma customização de schema auth/storage detectada pelo Supabase CLI.'
    }
    [IO.File]::WriteAllText($authStorageChangesPath, $diffText, [System.Text.UTF8Encoding]::new($false))

    foreach ($path in @($rolesPath, $schemaPath, $dataPath, $historySchemaPath, $historyDataPath, $authStorageChangesPath)) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf) -or (Get-Item -LiteralPath $path).Length -eq 0) {
            throw ('Exportação lógica incompleta: ' + [IO.Path]::GetFileName($path) + '.')
        }
        if (Select-String -LiteralPath $path -Pattern '^\s*(ERROR|FATAL):' -CaseSensitive:$false -Quiet) {
            throw ('Exportação lógica contém diagnóstico de erro: ' + [IO.Path]::GetFileName($path) + '.')
        }
    }

    if (Select-String -LiteralPath $dataPath -Pattern '^COPY\s+vault\.secrets\b' -CaseSensitive:$false -Quiet) {
        throw 'O dump contém valores do Vault e foi recusado.'
    }
    if (-not (Select-String -LiteralPath $dataPath -Pattern '^COPY\s+' -CaseSensitive:$false -Quiet) -or
        -not (Select-String -LiteralPath $dataPath -Pattern '^\\\.$' -Quiet)) {
        throw 'O dump de dados não contém um bloco COPY completo.'
    }

    $inventoryPath = Join-Path $recoveryDirectory 'dr-inventory.json'
    $inventoryParameters = @{
        RepositoryRoot = $RepositoryRoot
        OutputFile = $inventoryPath
        ProjectRef = $ProjectRef
        StorageBucketCount = $preflight.StorageBucketCount
        StorageObjectCount = $preflight.StorageObjectCount
    }
    $inventoryResult = & (Join-Path $PSScriptRoot 'New-FinEloDrInventory.ps1') @inventoryParameters
    $null = $inventoryResult

    if ($preflight.StorageObjectCount -gt 0) {
        Copy-Item -LiteralPath $StorageObjectExportDirectory -Destination (Join-Path $OutputDirectory 'storage-objects') -Recurse
    }

    [pscustomobject]@{
        OutputDirectory = $OutputDirectory
        ProjectRef = $ProjectRef
        Role = $ExpectedRole
        ReadOnlyPreflight = 'passed'
        StorageBucketCount = $preflight.StorageBucketCount
        StorageObjectCount = $preflight.StorageObjectCount
        SecretValuesExported = $false
    }
}
finally {
    $DatabaseUrl = ''
    $transportDatabaseUrl = ''
    $redactionValues = @()
    if ($null -ne $connectionInfo) {
        $connectionInfo.Password = ''
        $connectionInfo.OriginalUrl = ''
    }
    if ($null -ne $preflightConnectionInfo -and
        -not [object]::ReferenceEquals($preflightConnectionInfo, $connectionInfo)) {
        $preflightConnectionInfo.Password = ''
        $preflightConnectionInfo.OriginalUrl = ''
    }
}
