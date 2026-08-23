[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidatePattern('^[a-z0-9]{20}$')]
    [string]$ProjectRef,

    [Security.SecureString]$Password,

    [ValidatePattern('^aws-[0-9]+-sa-east-1\.pooler\.supabase\.com$')]
    [string]$PoolerHost = 'aws-0-sa-east-1.pooler.supabase.com',

    [ValidateRange(1, 65535)]
    [int]$Port = 5432,

    [string]$DestinationFile = (Join-Path $env:LOCALAPPDATA 'FinElo\Backup\readonly-db-url.dpapi'),

    [string]$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$prompted = $false

if ($null -eq $Password) {
    $Password = Read-Host 'Cole o código agrupado de 46 caracteres exibido pelo SQL Editor' -AsSecureString
    $prompted = $true
}

$plainPassword = [System.Net.NetworkCredential]::new('', $Password).Password.Trim()
$secureDatabaseUrl = $null
try {
    if ($prompted) {
        Set-Clipboard -Value 'clipboard-limpa'
    }

    if ($plainPassword.Length -eq 45 -and
        (($plainPassword.StartsWith('"') -and $plainPassword.EndsWith('"')) -or
         ($plainPassword.StartsWith("'") -and $plainPassword.EndsWith("'")))) {
        $plainPassword = $plainPassword.Substring(1, 43)
    }

    if ($plainPassword -match '^[A-Za-z0-9_-]{11}\.[A-Za-z0-9_-]{11}\.[A-Za-z0-9_-]{11}\.[A-Za-z0-9_-]{10}$') {
        $plainPassword = $plainPassword.Replace('.', '')
    }

    if ($plainPassword -notmatch '^[A-Za-z0-9_-]{43}$') {
        throw "O conteúdo recebido possui $($plainPassword.Length) caractere(s). Era esperado o código agrupado de 46 caracteres com três pontos, ou a senha normalizada de 43 caracteres. O conteúdo não foi exibido e o clipboard foi limpo."
    }

    $encodedPassword = [Uri]::EscapeDataString($plainPassword)
    $databaseUrl = 'postgresql://finelo_backup_reader.{0}:{1}@{2}:{3}/postgres?sslmode=require' -f `
        $ProjectRef,
        $encodedPassword,
        $PoolerHost,
        $Port
    $secureDatabaseUrl = ConvertTo-SecureString -String $databaseUrl -AsPlainText -Force

    $result = & (Join-Path $PSScriptRoot 'Set-FinEloProtectedReadOnlyDatabaseUrl.ps1') `
        -ExpectedProjectRef $ProjectRef `
        -DatabaseUrl $secureDatabaseUrl `
        -DestinationFile $DestinationFile `
        -RepositoryRoot $RepositoryRoot

    [pscustomobject]@{
        Installed = [bool]$result.Installed
        File = [string]$result.File
        ProjectRef = $ProjectRef
        Role = 'finelo_backup_reader'
        Host = $PoolerHost
        Port = $Port
        Storage = [string]$result.Storage
        PasswordPrinted = $false
        ClipboardCleared = $prompted
    }
}
finally {
    $plainPassword = ''
    $encodedPassword = ''
    $databaseUrl = ''
    if ($null -ne $secureDatabaseUrl) {
        $secureDatabaseUrl.Dispose()
    }
    if ($null -ne $Password) {
        $Password.Dispose()
    }
}
