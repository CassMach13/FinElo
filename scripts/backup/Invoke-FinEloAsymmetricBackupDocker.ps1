[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$OutputDirectory,

    [Parameter(Mandatory)]
    [ValidatePattern('^[a-z0-9]{20}$')]
    [string]$ProjectRef,

    [string]$DatabaseUrl = $env:FINELO_BACKUP_DB_URL_RO,

    [string]$ProtectedDatabaseUrlFile = (Join-Path $env:LOCALAPPDATA 'FinElo\Backup\readonly-db-url.dpapi'),

    [string]$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,

    [string]$DockerPath = (Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\resources\bin\docker.exe'),

    [string]$AgeDirectory = (Join-Path $env:LOCALAPPDATA 'FinElo\Tools\age-1.3.1'),

    [string]$ProtectedRecipientSha256File = (Join-Path $env:LOCALAPPDATA 'FinElo\Backup\recipient-fingerprint.sha256'),

    [string]$SevenZipPath = 'C:\Program Files\7-Zip\7z.exe',

    [string]$StorageObjectExportDirectory = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'FinElo.Backup.psm1') -Force

$recipientFile = Join-Path $RepositoryRoot 'security\backup\finelo-backup-recipient.txt'
$agePath = Join-Path $AgeDirectory 'age.exe'
$ageInspectPath = Join-Path $AgeDirectory 'age-inspect.exe'
$postgresImage = 'postgres@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94'

foreach ($path in @($DockerPath, $recipientFile, $agePath, $ageInspectPath, $ProtectedRecipientSha256File, $SevenZipPath)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw 'Uma ferramenta ou fonte pública obrigatória do runner Docker não foi encontrada.'
    }
}
if ([string]::IsNullOrWhiteSpace($DatabaseUrl)) {
    $DatabaseUrl = Get-FinEloCurrentUserProtectedText `
        -ProtectedFile $ProtectedDatabaseUrlFile `
        -RepositoryRoot $RepositoryRoot
}

$dockerDirectory = Split-Path -Parent $DockerPath
if (-not (($env:PATH -split ';') -contains $dockerDirectory)) {
    $env:PATH = $dockerDirectory + ';' + $env:PATH
}

$dockerVersion = Invoke-FinEloProcess `
    -FilePath $DockerPath `
    -ArgumentList @('version', '--format', '{{.Server.Version}}') `
    -Operation 'Validação do Docker Engine'
if ([string]::IsNullOrWhiteSpace($dockerVersion.StdOut)) {
    throw 'O Docker Engine não está disponível.'
}

$imageInspection = Invoke-FinEloProcess `
    -FilePath $DockerPath `
    -ArgumentList @('image', 'inspect', $postgresImage, '--format', '{{.Id}}') `
    -Operation 'Validação da imagem psql pinada'
if ($imageInspection.StdOut.Trim() -notmatch '^sha256:[0-9a-f]{64}$') {
    throw 'A imagem psql pinada não passou na inspeção local.'
}

$psqlPrefix = @(
    'run', '--rm',
    '--env', 'PGHOST',
    '--env', 'PGPORT',
    '--env', 'PGDATABASE',
    '--env', 'PGUSER',
    '--env', 'PGPASSWORD',
    '--env', 'PGSSLMODE',
    '--env', 'PGOPTIONS',
    $postgresImage,
    'psql'
)

$runnerParameters = @{
    OutputDirectory = $OutputDirectory
    RecipientFile = $recipientFile
    ProjectRef = $ProjectRef
    DatabaseUrl = $DatabaseUrl
    CanonicalRecipientSha256 = ''
    CanonicalRecipientSha256File = $ProtectedRecipientSha256File
    PsqlPath = $DockerPath
    PsqlArgumentPrefix = $psqlPrefix
    AgePath = $agePath
    AgeInspectPath = $ageInspectPath
    SevenZipPath = $SevenZipPath
    StorageObjectExportDirectory = $StorageObjectExportDirectory
    RepositoryRoot = $RepositoryRoot
}

try {
    & (Join-Path $PSScriptRoot 'Invoke-FinEloAsymmetricBackup.ps1') @runnerParameters
}
finally {
    $DatabaseUrl = ''
    $runnerParameters.DatabaseUrl = ''
}
