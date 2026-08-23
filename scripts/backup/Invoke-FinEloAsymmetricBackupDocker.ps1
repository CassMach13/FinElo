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
$relayProcess = $null
$relayReadyFile = ''
$connectionInfo = $null
$runnerParameters = $null

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
$connectionInfo = Get-FinEloDatabaseConnectionInfo `
    -DatabaseUrl $DatabaseUrl `
    -ExpectedProjectRef $ProjectRef `
    -ExpectedRole 'finelo_backup_reader'

try {
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

    $transportHost = ''
    $transportPort = 0
    if ($connectionInfo.Host.StartsWith('db.', [StringComparison]::OrdinalIgnoreCase)) {
    $relayReadyFile = Join-Path ([IO.Path]::GetTempPath()) (
        'finelo-loopback-relay-' + [guid]::NewGuid().ToString('N') + '.ready'
    )
    $relayStartInfo = [Diagnostics.ProcessStartInfo]::new()
    $relayStartInfo.FileName = Join-Path $PSHOME 'pwsh.exe'
    $relayStartInfo.ArgumentList.Add('-NoProfile')
    $relayStartInfo.ArgumentList.Add('-File')
    $relayStartInfo.ArgumentList.Add((Join-Path $PSScriptRoot 'Start-FinEloLoopbackTcpRelay.ps1'))
    $relayStartInfo.ArgumentList.Add('-TargetHost')
    $relayStartInfo.ArgumentList.Add($connectionInfo.Host)
    $relayStartInfo.ArgumentList.Add('-TargetPort')
    $relayStartInfo.ArgumentList.Add([string]$connectionInfo.Port)
    $relayStartInfo.ArgumentList.Add('-ReadyFile')
    $relayStartInfo.ArgumentList.Add($relayReadyFile)
    $relayStartInfo.UseShellExecute = $false
    $relayStartInfo.RedirectStandardOutput = $true
    $relayStartInfo.RedirectStandardError = $true
    $relayStartInfo.CreateNoWindow = $true
    $relayProcess = [Diagnostics.Process]::Start($relayStartInfo)

    for ($attempt = 0; $attempt -lt 100 -and -not (Test-Path -LiteralPath $relayReadyFile); $attempt++) {
        if ($relayProcess.HasExited) {
            $safeRelayError = $relayProcess.StandardError.ReadToEnd().Trim()
            throw ('O relay IPv6 local encerrou antes do preflight: ' + $safeRelayError)
        }
        Start-Sleep -Milliseconds 50
    }
    if (-not (Test-Path -LiteralPath $relayReadyFile -PathType Leaf)) {
        throw 'O relay IPv6 local não ficou pronto no tempo esperado.'
    }
    $relayPortText = (Get-Content -LiteralPath $relayReadyFile -Raw).Trim()
    if ($relayPortText -notmatch '^[0-9]{1,5}$') {
        throw 'O relay IPv6 local publicou uma porta inválida.'
    }
    $transportHost = 'host.docker.internal'
    $transportPort = [int]$relayPortText
    if ($transportPort -lt 1 -or $transportPort -gt 65535) {
        throw 'A porta publicada pelo relay IPv6 está fora do intervalo permitido.'
    }
    }

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
    TransportHost = $transportHost
    TransportPort = $transportPort
    }

    & (Join-Path $PSScriptRoot 'Invoke-FinEloAsymmetricBackup.ps1') @runnerParameters
}
finally {
    $DatabaseUrl = ''
    if ($null -ne $runnerParameters) {
        $runnerParameters.DatabaseUrl = ''
    }
    if ($null -ne $connectionInfo) {
        $connectionInfo.Password = ''
        $connectionInfo.OriginalUrl = ''
    }
    if ($null -ne $relayProcess) {
        if (-not $relayProcess.HasExited) {
            $relayProcess.Kill($true)
            $relayProcess.WaitForExit()
        }
        $relayProcess.Dispose()
    }
    foreach ($relayArtifact in @($relayReadyFile, ($relayReadyFile + '.partial'))) {
        if (-not [string]::IsNullOrWhiteSpace($relayArtifact) -and
            (Test-Path -LiteralPath $relayArtifact)) {
            Remove-Item -LiteralPath $relayArtifact -Force
        }
    }
}
