[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$RecipientFile,

    [Parameter(Mandatory)]
    [ValidatePattern('^[0-9a-fA-F]{64}$')]
    [string]$ExpectedSha256,

    [string]$DestinationFile = (Join-Path $env:LOCALAPPDATA 'FinElo\Backup\recipient-fingerprint.sha256'),

    [string]$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'FinElo.Backup.psm1') -Force

if (-not $IsWindows) {
    throw 'Este instalador usa ACL do Windows e deve ser executado no host Windows da automação.'
}
if (Test-Path -LiteralPath $DestinationFile) {
    throw 'A fonte protegida do fingerprint já existe. Nada foi sobrescrito.'
}

$recipientInfo = Get-FinEloRecipientInfo -RecipientFile $RecipientFile -CanonicalSha256 $ExpectedSha256
$repository = [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $RepositoryRoot).Path)
$repositoryWithSeparator = $repository.TrimEnd(
    [IO.Path]::DirectorySeparatorChar,
    [IO.Path]::AltDirectorySeparatorChar
) + [IO.Path]::DirectorySeparatorChar
$destination = [IO.Path]::GetFullPath($DestinationFile)
if ($destination.StartsWith($repositoryWithSeparator, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'A fonte protegida do fingerprint não pode ficar dentro do repositório.'
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
    throw 'Uma instalação parcial anterior existe. Nada foi sobrescrito.'
}

try {
    [IO.File]::WriteAllText($partial, ($recipientInfo.Sha256 + [Environment]::NewLine), [System.Text.UTF8Encoding]::new($false))

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

    $validated = Get-FinEloCanonicalRecipientSha256 `
        -ProtectedSha256File $partial `
        -RepositoryRoot $RepositoryRoot
    if (-not (Test-FinEloFixedTimeHexEqual -Left $validated -Right $recipientInfo.Sha256)) {
        throw 'A fonte protegida não passou na validação antes da publicação.'
    }

    Move-Item -LiteralPath $partial -Destination $destination

    [pscustomobject]@{
        Installed = $true
        File = $destination
        Sha256 = $recipientInfo.Sha256
        Owner = $currentSid.Value
        InheritanceProtected = $true
        RepositoryIndependent = $true
    }
}
finally {
    if (Test-Path -LiteralPath $partial) {
        Remove-Item -LiteralPath $partial -Force
    }
}
