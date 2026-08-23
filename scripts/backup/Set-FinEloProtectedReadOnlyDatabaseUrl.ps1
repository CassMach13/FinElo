[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidatePattern('^[a-z0-9]{20}$')]
    [string]$ExpectedProjectRef,

    [Security.SecureString]$DatabaseUrl,

    [string]$DestinationFile = (Join-Path $env:LOCALAPPDATA 'FinElo\Backup\readonly-db-url.dpapi'),

    [string]$ExpectedRole = 'finelo_backup_reader',

    [string]$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'FinElo.Backup.psm1') -Force

if (-not $IsWindows) {
    throw 'Este instalador usa DPAPI e ACL do Windows.'
}
if (Test-Path -LiteralPath $DestinationFile) {
    throw 'A credencial somente leitura protegida já existe. Nada foi sobrescrito.'
}
if ($null -eq $DatabaseUrl) {
    $DatabaseUrl = Read-Host 'Cole a URL dedicada finelo_backup_reader (a entrada não será exibida)' -AsSecureString
}

$plainDatabaseUrl = [System.Net.NetworkCredential]::new('', $DatabaseUrl).Password
$connectionInfo = $null
try {
    $connectionInfo = Get-FinEloDatabaseConnectionInfo `
        -DatabaseUrl $plainDatabaseUrl `
        -ExpectedProjectRef $ExpectedProjectRef `
        -ExpectedRole $ExpectedRole

    $repository = [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $RepositoryRoot).Path)
    $repositoryWithSeparator = $repository.TrimEnd(
        [IO.Path]::DirectorySeparatorChar,
        [IO.Path]::AltDirectorySeparatorChar
    ) + [IO.Path]::DirectorySeparatorChar
    $destination = [IO.Path]::GetFullPath($DestinationFile)
    if ($destination.StartsWith($repositoryWithSeparator, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'A credencial protegida não pode ficar dentro do repositório.'
    }

    $parent = Split-Path -Parent $destination
    if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
        $null = New-Item -ItemType Directory -Path $parent -Force
    }

    $currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
    $directoryAcl = [System.Security.AccessControl.DirectorySecurity]::new()
    $directoryAcl.SetOwner($currentSid)
    $directoryAcl.SetAccessRuleProtection($true, $false)
    $directoryRule = [System.Security.AccessControl.FileSystemAccessRule]::new(
        $currentSid,
        [System.Security.AccessControl.FileSystemRights]::FullControl,
        [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit',
        [System.Security.AccessControl.PropagationFlags]::None,
        [System.Security.AccessControl.AccessControlType]::Allow
    )
    $null = $directoryAcl.AddAccessRule($directoryRule)
    Set-Acl -LiteralPath $parent -AclObject $directoryAcl

    $partial = $destination + '.partial'
    if (Test-Path -LiteralPath $partial) {
        throw 'Uma gravação parcial anterior da credencial existe. Nada foi sobrescrito.'
    }

    try {
        $cipherText = ConvertFrom-SecureString -SecureString $DatabaseUrl
        [IO.File]::WriteAllText($partial, ($cipherText + [Environment]::NewLine), [System.Text.UTF8Encoding]::new($false))

        $fileAcl = [System.Security.AccessControl.FileSecurity]::new()
        $fileAcl.SetOwner($currentSid)
        $fileAcl.SetAccessRuleProtection($true, $false)
        $fileRule = [System.Security.AccessControl.FileSystemAccessRule]::new(
            $currentSid,
            [System.Security.AccessControl.FileSystemRights]::FullControl,
            [System.Security.AccessControl.AccessControlType]::Allow
        )
        $null = $fileAcl.AddAccessRule($fileRule)
        Set-Acl -LiteralPath $partial -AclObject $fileAcl

        $roundTrip = Get-FinEloCurrentUserProtectedText -ProtectedFile $partial -RepositoryRoot $RepositoryRoot
        try {
            $roundTripInfo = Get-FinEloDatabaseConnectionInfo `
                -DatabaseUrl $roundTrip `
                -ExpectedProjectRef $ExpectedProjectRef `
                -ExpectedRole $ExpectedRole
            $roundTripInfo.Password = ''
            $roundTripInfo.OriginalUrl = ''
        }
        finally {
            $roundTrip = ''
        }

        Move-Item -LiteralPath $partial -Destination $destination

        [pscustomobject]@{
            Installed = $true
            File = $destination
            ProjectRef = $ExpectedProjectRef
            Role = $ExpectedRole
            Storage = 'Windows-DPAPI-CurrentUser'
            Owner = $currentSid.Value
            SecretPrinted = $false
        }
    }
    finally {
        $cipherText = ''
        if (Test-Path -LiteralPath $partial) {
            Remove-Item -LiteralPath $partial -Force
        }
    }
}
finally {
    $plainDatabaseUrl = ''
    if ($null -ne $connectionInfo) {
        $connectionInfo.Password = ''
        $connectionInfo.OriginalUrl = ''
    }
    if ($null -ne $DatabaseUrl) {
        $DatabaseUrl.Dispose()
    }
}
