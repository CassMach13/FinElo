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

    [string[]]$PgToolsArgumentPrefix = @(),

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

function Invoke-ReadOnlyPgTool {
    param(
        [Parameter(Mandatory)][string]$Script,
        [Parameter(Mandatory)][string]$OutputFile,
        [Parameter(Mandatory)][string]$Operation,
        [hashtable]$AdditionalEnvironment = @{}
    )

    if ($PgToolsArgumentPrefix.Count -eq 0) {
        throw 'O prefixo pinado das ferramentas PostgreSQL não foi fornecido.'
    }
    $environment = @{
        PGHOST = $preflightConnectionInfo.Host
        PGPORT = [string]$preflightConnectionInfo.Port
        PGDATABASE = $connectionInfo.Database
        PGUSER = $connectionInfo.UserName
        PGPASSWORD = $connectionInfo.Password
        PGSSLMODE = 'require'
        PGOPTIONS = '-c default_transaction_read_only=on -c statement_timeout=900000'
    }
    foreach ($entry in $AdditionalEnvironment.GetEnumerator()) {
        $environment[[string]$entry.Key] = [string]$entry.Value
    }
    try {
        if ($PgToolsArgumentPrefix.Count -lt 2) {
            throw 'O prefixo pinado das ferramentas PostgreSQL está incompleto.'
        }
        $arguments = @($PgToolsArgumentPrefix[0..($PgToolsArgumentPrefix.Count - 2)])
        foreach ($name in ($AdditionalEnvironment.Keys | Sort-Object)) {
            $arguments += @('--env', [string]$name)
        }
        $arguments += @($PgToolsArgumentPrefix[-1], 'bash', '-c', $Script, '--')
        $null = Invoke-FinEloProcess `
            -FilePath $PsqlPath `
            -ArgumentList $arguments `
            -Operation $Operation `
            -Environment $environment `
            -SensitiveValues $redactionValues `
            -StandardOutputFile $OutputFile
    }
    finally {
        $environment['PGPASSWORD'] = ''
    }
}

$schemaDumpScript = @'
set -euo pipefail
pg_dump --schema-only --quote-all-identifier --exclude-schema "${EXCLUDED_SCHEMAS:-}" ${EXTRA_FLAGS:-} \
| sed -E 's/^\\(un)?restrict .*$/-- &/' \
| sed -E 's/^CREATE SCHEMA "/CREATE SCHEMA IF NOT EXISTS "/' \
| sed -E 's/^CREATE TABLE "/CREATE TABLE IF NOT EXISTS "/' \
| sed -E 's/^CREATE SEQUENCE "/CREATE SEQUENCE IF NOT EXISTS "/' \
| sed -E 's/^CREATE VIEW "/CREATE OR REPLACE VIEW "/' \
| sed -E 's/^CREATE FUNCTION "/CREATE OR REPLACE FUNCTION "/' \
| sed -E 's/^CREATE TRIGGER "/CREATE OR REPLACE TRIGGER "/' \
| sed -E 's/^CREATE PUBLICATION "supabase_realtime/-- &/' \
| sed -E 's/^CREATE EVENT TRIGGER /-- &/' \
| sed -E 's/^         WHEN TAG IN /-- &/' \
| sed -E 's/^   EXECUTE FUNCTION /-- &/' \
| sed -E 's/^ALTER EVENT TRIGGER /-- &/' \
| sed -E 's/^ALTER PUBLICATION "supabase_realtime_/-- &/' \
| sed -E 's/^ALTER FOREIGN DATA WRAPPER (.+) OWNER TO /-- &/' \
| sed -E 's/^ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin"/-- &/' \
| sed -E 's/^GRANT ALL ON FOREIGN DATA WRAPPER (.+) TO "postgres" WITH GRANT OPTION/-- &/' \
| sed -E "s/^GRANT (.+) ON (.+) \"(${EXCLUDED_SCHEMAS:-})\"/-- &/" \
| sed -E "s/^REVOKE (.+) ON (.+) \"(${EXCLUDED_SCHEMAS:-})\"/-- &/" \
| sed -E 's/^(CREATE EXTENSION IF NOT EXISTS "pg_tle").+/\1;/' \
| sed -E 's/^(CREATE EXTENSION IF NOT EXISTS "pgsodium").+/\1;/' \
| sed -E 's/^(CREATE EXTENSION IF NOT EXISTS "pgmq").+/\1;/' \
| sed -E 's/^COMMENT ON EXTENSION (.+)/-- &/' \
| sed -E 's/^CREATE POLICY "cron_job_/-- &/' \
| sed -E 's/^ALTER TABLE "cron"/-- &/' \
| sed -E 's/^SET transaction_timeout = 0;/-- &/' \
| sed -E "${EXTRA_SED:-}"
'@

$dataDumpScript = @'
set -euo pipefail
printf 'SET session_replication_role = replica;\n\n'
pg_dump --data-only --quote-all-identifier \
  --exclude-schema "${EXCLUDED_SCHEMAS:-}" \
  --exclude-table "auth.schema_migrations" \
  --exclude-table "storage.migrations" \
  --exclude-table "supabase_functions.migrations" \
  --schema "$INCLUDED_SCHEMAS" ${EXTRA_FLAGS:-} \
| sed -E 's/^\\(un)?restrict .*$/-- &/'
printf 'RESET ALL;\n'
'@

$roleDumpScript = @'
set -euo pipefail
pg_dumpall --roles-only --quote-all-identifier --no-role-passwords --no-comments \
| sed -E 's/^\\(un)?restrict .*$/-- &/' \
| sed -E "s/^CREATE ROLE \"($RESERVED_ROLES)\"/-- &/" \
| sed -E "s/^ALTER ROLE \"($RESERVED_ROLES)\"/-- &/" \
| sed -E "s/ (NOSUPERUSER|NOREPLICATION)//g" \
| sed -E "s/^-- (.* SET \"($ALLOWED_CONFIGS)\" .*)/\1/" \
| sed -E "s/GRANT \".*\" TO \"($RESERVED_ROLES)\"/-- &/" \
| sed -E "${EXTRA_SED:-}" \
| uniq
printf 'RESET ALL;\n'
'@

$internalSchemas = @(
    'information_schema', 'pg_*', '_analytics', '_realtime', '_supavisor',
    'auth', 'etl', 'extensions', 'pgbouncer', 'realtime', 'storage',
    'supabase_functions', 'supabase_migrations', 'cron', 'dbdev', 'graphql',
    'graphql_public', 'net', 'pgmq', 'pgsodium', 'pgsodium_masks', 'pgtle',
    'repack', 'tiger', 'tiger_data', 'timescaledb_*', '_timescaledb_*',
    'topology', 'vault'
) -join '|'
$excludedDataSchemas = @(
    'information_schema', 'pg_*', 'graphql', 'graphql_public', 'pgsodium',
    'pgsodium_masks', 'pgtle', 'repack', 'tiger', 'tiger_data',
    'timescaledb_*', '_timescaledb_*', 'topology', 'vault', 'etl',
    'extensions', 'pgbouncer', 'realtime', 'supabase_migrations', '_analytics',
    '_realtime', '_supavisor'
) -join '|'
$reservedRoles = @(
    'anon', 'authenticated', 'authenticator', 'cli_login_.*', 'dashboard_user',
    'pgbouncer', 'postgres', 'service_role', 'supabase_.*', 'pgsodium_keyholder',
    'pgsodium_keyiduser', 'pgsodium_keymaker', 'pgtle_admin'
) -join '|'
$allowedConfigs = @(
    'pgaudit.*', 'pgrst.*', 'session_replication_role', 'statement_timeout',
    'track_io_timing'
) -join '|'

try {
    $rolesPath = Join-Path $databaseDirectory 'roles.sql'
    $schemaPath = Join-Path $databaseDirectory 'schema.sql'
    $dataPath = Join-Path $databaseDirectory 'data.sql'
    $historySchemaPath = Join-Path $databaseDirectory 'history_schema.sql'
    $historyDataPath = Join-Path $databaseDirectory 'history_data.sql'
    $authStorageSnapshotPath = Join-Path $databaseDirectory 'auth_storage_schema_snapshot.sql'

    Invoke-ReadOnlyPgTool -Operation 'Dump de papéis' -Script $roleDumpScript -OutputFile $rolesPath -AdditionalEnvironment @{
        RESERVED_ROLES = $reservedRoles
        ALLOWED_CONFIGS = $allowedConfigs
        EXTRA_SED = '/^--/d'
    }
    Invoke-ReadOnlyPgTool -Operation 'Dump de schema' -Script $schemaDumpScript -OutputFile $schemaPath -AdditionalEnvironment @{
        EXCLUDED_SCHEMAS = $internalSchemas
        EXTRA_SED = '/^--/d'
    }
    Invoke-ReadOnlyPgTool -Operation 'Dump de dados' -Script $dataDumpScript -OutputFile $dataPath -AdditionalEnvironment @{
        EXCLUDED_SCHEMAS = $excludedDataSchemas
        INCLUDED_SCHEMAS = '*'
        EXTRA_FLAGS = '--exclude-table "storage"."buckets_vectors" --exclude-table "storage"."vector_indexes" --exclude-table "vault"."secrets"'
    }
    Invoke-ReadOnlyPgTool -Operation 'Dump do schema de histórico de migrations' -Script $schemaDumpScript -OutputFile $historySchemaPath -AdditionalEnvironment @{
        EXCLUDED_SCHEMAS = ''
        EXTRA_FLAGS = '--schema=supabase_migrations'
        EXTRA_SED = '/^--/d'
    }
    Invoke-ReadOnlyPgTool -Operation 'Dump dos dados de histórico de migrations' -Script $dataDumpScript -OutputFile $historyDataPath -AdditionalEnvironment @{
        EXCLUDED_SCHEMAS = ''
        INCLUDED_SCHEMAS = 'supabase_migrations'
        EXTRA_FLAGS = ''
    }

    Invoke-ReadOnlyPgTool -Operation 'Snapshot forense dos schemas auth e storage' -Script $schemaDumpScript -OutputFile $authStorageSnapshotPath -AdditionalEnvironment @{
        EXCLUDED_SCHEMAS = ''
        EXTRA_FLAGS = '--schema=auth --schema=storage'
        EXTRA_SED = '/^--/d'
    }

    foreach ($path in @($rolesPath, $schemaPath, $dataPath, $historySchemaPath, $historyDataPath, $authStorageSnapshotPath)) {
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
