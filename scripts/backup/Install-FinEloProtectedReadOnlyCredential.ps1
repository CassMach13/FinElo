[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidatePattern('^[a-z0-9]{20}$')]
    [string]$ProjectRef,

    [Security.SecureString]$Password,

    [switch]$ReadFromClipboard,

    [ValidatePattern('^db\.[a-z0-9]{20}\.supabase\.co$')]
    [string]$DatabaseHost = '',

    [ValidateRange(1, 65535)]
    [int]$Port = 5432,

    [string]$DestinationFile = (Join-Path $env:LOCALAPPDATA 'FinElo\Backup\readonly-db-url.dpapi'),

    [string]$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$prompted = $false
$clipboardMode = $false
$clipboardText = ''

if ([string]::IsNullOrWhiteSpace($DatabaseHost)) {
    $DatabaseHost = "db.$ProjectRef.supabase.co"
}
if ($DatabaseHost -cne "db.$ProjectRef.supabase.co") {
    throw 'O host direto não corresponde ao project ref permitido.'
}

if ($ReadFromClipboard -and $null -ne $Password) {
    throw 'Use Password ou ReadFromClipboard, nunca os dois ao mesmo tempo.'
}

if ($ReadFromClipboard) {
    $clipboardMode = $true
    Set-Clipboard -Value 'FINELO-AGUARDANDO-CODIGO'
    try {
        $null = Read-Host 'Agora vá ao SQL Editor, copie a célula completa, volte aqui e pressione Enter sem colar nada'
        $clipboardText = Get-Clipboard -Raw
        if ([string]::IsNullOrWhiteSpace($clipboardText) -or $clipboardText -ceq 'FINELO-AGUARDANDO-CODIGO') {
            throw 'Nenhum código novo foi copiado do SQL Editor.'
        }
        $Password = ConvertTo-SecureString -String $clipboardText -AsPlainText -Force
    }
    finally {
        Set-Clipboard -Value 'clipboard-limpa'
        $clipboardText = ''
    }
    $prompted = $true
}
elseif ($null -eq $Password) {
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
    $databaseUrl = 'postgresql://finelo_backup_reader:{0}@{1}:{2}/postgres?sslmode=require' -f `
        $encodedPassword,
        $DatabaseHost,
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
        Host = $DatabaseHost
        Port = $Port
        Storage = [string]$result.Storage
        PasswordPrinted = $false
        ClipboardCleared = $prompted
        ClipboardMode = $clipboardMode
    }
}
finally {
    $plainPassword = ''
    $encodedPassword = ''
    $databaseUrl = ''
    $clipboardText = ''
    if ($null -ne $secureDatabaseUrl) {
        $secureDatabaseUrl.Dispose()
    }
    if ($null -ne $Password) {
        $Password.Dispose()
    }
}
