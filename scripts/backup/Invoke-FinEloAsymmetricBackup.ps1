[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$OutputDirectory,

    [Parameter(Mandatory)]
    [string]$RecipientFile,

    [Parameter(Mandatory)]
    [ValidatePattern('^[a-z0-9]{20}$')]
    [string]$ProjectRef,

    [string]$DatabaseUrl = $env:FINELO_BACKUP_DB_URL_RO,

    [string]$CanonicalRecipientSha256 = $env:FINELO_BACKUP_RECIPIENT_SHA256_CANONICAL,

    [Parameter(Mandatory)]
    [string]$PsqlPath,

    [Parameter(Mandatory)]
    [string]$AgePath,

    [Parameter(Mandatory)]
    [string]$AgeInspectPath,

    [string]$SevenZipPath = 'C:\Program Files\7-Zip\7z.exe',

    [string]$ExpectedRole = 'finelo_backup_reader',

    [string]$SupabaseExecutable = 'npx.cmd',

    [string[]]$SupabaseArgumentPrefix = @('--yes', 'supabase@2.115.0'),

    [string]$StorageObjectExportDirectory = '',

    [string]$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$workingRoot = Join-Path ([IO.Path]::GetTempPath()) ('finelo-readonly-export-' + [guid]::NewGuid().ToString('N'))
$logicalExport = Join-Path $workingRoot 'logical-export'
$backupId = 'FinElo-Production-{0}-age-v1' -f (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss')

try {
    $null = New-Item -ItemType Directory -Path $workingRoot
    if ($IsWindows) {
        $currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
        $acl = [System.Security.AccessControl.DirectorySecurity]::new()
        $acl.SetOwner($currentSid)
        $acl.SetAccessRuleProtection($true, $false)
        $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
            $currentSid,
            [System.Security.AccessControl.FileSystemRights]::FullControl,
            [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit',
            [System.Security.AccessControl.PropagationFlags]::None,
            [System.Security.AccessControl.AccessControlType]::Allow
        )
        $null = $acl.AddAccessRule($rule)
        Set-Acl -LiteralPath $workingRoot -AclObject $acl
    }

    $exportParameters = @{
        OutputDirectory = $logicalExport
        ProjectRef = $ProjectRef
        DatabaseUrl = $DatabaseUrl
        ExpectedRole = $ExpectedRole
        PsqlPath = $PsqlPath
        SupabaseExecutable = $SupabaseExecutable
        SupabaseArgumentPrefix = $SupabaseArgumentPrefix
        RepositoryRoot = $RepositoryRoot
        StorageObjectExportDirectory = $StorageObjectExportDirectory
    }
    $exportResult = & (Join-Path $PSScriptRoot 'Export-FinEloReadOnlyLogicalBackup.ps1') @exportParameters
    if ($exportResult.ReadOnlyPreflight -cne 'passed') {
        throw 'A exportação não comprovou isolamento somente leitura.'
    }

    $encryptionParameters = @{
        SourceDirectory = $logicalExport
        OutputDirectory = $OutputDirectory
        RecipientFile = $RecipientFile
        ProjectRef = $ProjectRef
        CanonicalRecipientSha256 = $CanonicalRecipientSha256
        AgePath = $AgePath
        AgeInspectPath = $AgeInspectPath
        SevenZipPath = $SevenZipPath
        BackupId = $backupId
        RepositoryRoot = $RepositoryRoot
    }
    & (Join-Path $PSScriptRoot 'New-FinEloEncryptedBackup.ps1') @encryptionParameters
}
finally {
    $DatabaseUrl = ''
    $resolvedWorkingRoot = [IO.Path]::GetFullPath($workingRoot)
    $resolvedTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if (-not $resolvedWorkingRoot.StartsWith($resolvedTemp, [StringComparison]::OrdinalIgnoreCase) -or
        -not (Split-Path -Leaf $resolvedWorkingRoot).StartsWith('finelo-readonly-export-', [StringComparison]::Ordinal)) {
        throw 'A limpeza recusou um caminho fora do diretório temporário controlado.'
    }
    Remove-Item -LiteralPath $resolvedWorkingRoot -Recurse -Force -ErrorAction SilentlyContinue
}
