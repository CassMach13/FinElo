[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$RepositoryRoot,

    [Parameter(Mandatory)]
    [string]$OutputFile,

    [Parameter(Mandatory)]
    [ValidatePattern('^[a-z0-9]{20}$')]
    [string]$ProjectRef,

    [Parameter(Mandatory)]
    [long]$StorageBucketCount,

    [Parameter(Mandatory)]
    [long]$StorageObjectCount,

    [string]$CodeCommit = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'FinElo.Backup.psm1') -Force

$repository = (Resolve-Path -LiteralPath $RepositoryRoot).Path
if ([string]::IsNullOrWhiteSpace($CodeCommit)) {
    $gitResult = Invoke-FinEloProcess -FilePath 'git' -ArgumentList @('-C', $repository, 'rev-parse', 'HEAD') -Operation 'Leitura do commit Git'
    $CodeCommit = $gitResult.StdOut.Trim()
}

$edgeRoot = Join-Path $repository 'supabase\functions'
$edgeFunctions = @()
if (Test-Path -LiteralPath $edgeRoot -PathType Container) {
    foreach ($directory in (Get-ChildItem -LiteralPath $edgeRoot -Directory | Sort-Object Name)) {
        $files = @(Get-ChildItem -LiteralPath $directory.FullName -File -Recurse -Force | Sort-Object FullName)
        $secretNames = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
        foreach ($file in $files) {
            $content = Get-Content -LiteralPath $file.FullName -Raw
            foreach ($match in [regex]::Matches($content, 'Deno\.env\.get\([\x27\x22]([A-Z0-9_]+)[\x27\x22]\)')) {
                $null = $secretNames.Add($match.Groups[1].Value)
            }
        }
        $edgeFunctions += [ordered]@{
            name = $directory.Name
            source_files = @(
                foreach ($file in $files) {
                    [ordered]@{
                        path = [IO.Path]::GetRelativePath($repository, $file.FullName).Replace('\', '/')
                        bytes = [long]$file.Length
                        sha256 = Get-FinEloSha256Hex -LiteralPath $file.FullName
                    }
                }
            )
            required_secret_names = @($secretNames | Sort-Object)
            secret_values_in_backup = $false
        }
    }
}

$serverlessRoots = @('api')
$serverlessFiles = @(
    foreach ($rootName in $serverlessRoots) {
        $root = Join-Path $repository $rootName
        if (Test-Path -LiteralPath $root -PathType Container) {
            Get-ChildItem -LiteralPath $root -File -Recurse -Force
        }
    }
)
$serverlessSecretNames = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
foreach ($file in $serverlessFiles) {
    $content = Get-Content -LiteralPath $file.FullName -Raw
    foreach ($match in [regex]::Matches($content, 'process\.env\.([A-Z0-9_]+)')) {
        $null = $serverlessSecretNames.Add($match.Groups[1].Value)
    }
}

$inventory = [ordered]@{
    format = 'finelo-disaster-recovery-inventory/v1'
    generated_at_utc = (Get-Date).ToUniversalTime().ToString('o')
    project_ref = $ProjectRef
    code_commit = $CodeCommit
    database = [ordered]@{
        logical_dump_included = $true
        migration_history_included = $true
        auth_storage_customization_diff_included = $true
        vault_secret_values_included = $false
    }
    storage = [ordered]@{
        bucket_count = $StorageBucketCount
        object_count = $StorageObjectCount
        binary_object_export_required = ($StorageObjectCount -gt 0)
        database_metadata_is_not_binary_object_backup = $true
    }
    edge_functions = $edgeFunctions
    vercel_serverless = [ordered]@{
        source_files = @(
            foreach ($file in ($serverlessFiles | Sort-Object FullName)) {
                [ordered]@{
                    path = [IO.Path]::GetRelativePath($repository, $file.FullName).Replace('\', '/')
                    bytes = [long]$file.Length
                    sha256 = Get-FinEloSha256Hex -LiteralPath $file.FullName
                }
            }
        )
        required_environment_names = @($serverlessSecretNames | Sort-Object)
        secret_values_in_backup = $false
    }
    external_configuration = @(
        [ordered]@{ component = 'Supabase Auth'; recovery_source = 'dashboard protegido + registro offline'; values_in_backup = $false },
        [ordered]@{ component = 'Supabase Edge Function secrets'; recovery_source = 'cofre/configuração protegida do responsável'; values_in_backup = $false },
        [ordered]@{ component = 'Vercel environment variables'; recovery_source = 'Vercel + registro protegido do responsável'; values_in_backup = $false },
        [ordered]@{ component = 'Stripe webhooks e chaves'; recovery_source = 'Stripe + cofre do responsável'; values_in_backup = $false },
        [ordered]@{ component = 'DNS e domínio customizado'; recovery_source = 'registrador/DNS + runbook offline'; values_in_backup = $false },
        [ordered]@{ component = 'Sentry'; recovery_source = 'Sentry + configuração protegida'; values_in_backup = $false },
        [ordered]@{ component = 'PostHog'; recovery_source = 'PostHog + configuração protegida'; values_in_backup = $false }
    )
}

$parent = Split-Path -Parent $OutputFile
if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
    $null = New-Item -ItemType Directory -Path $parent
}
[IO.File]::WriteAllText($OutputFile, ($inventory | ConvertTo-Json -Depth 12), [System.Text.UTF8Encoding]::new($false))

[pscustomobject]@{
    OutputFile = $OutputFile
    EdgeFunctionCount = @($edgeFunctions).Count
    StorageObjectCount = $StorageObjectCount
    SecretValueCount = 0
}
