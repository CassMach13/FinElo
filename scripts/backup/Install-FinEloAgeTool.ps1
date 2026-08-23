[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$DestinationDirectory
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$version = '1.3.1'
$downloadUri = 'https://github.com/FiloSottile/age/releases/download/v1.3.1/age-v1.3.1-windows-amd64.zip'
$expectedSha256 = 'c56e8ce22f7e80cb85ad946cc82d198767b056366201d3e1a2b93d865be38154'

if (Test-Path -LiteralPath $DestinationDirectory) {
    throw 'O diretório de destino já existe. Nada foi sobrescrito.'
}

$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ('finelo-age-install-' + [guid]::NewGuid().ToString('N'))
$zipPath = Join-Path $tempRoot 'age.zip'
$extractRoot = Join-Path $tempRoot 'extract'

try {
    $null = New-Item -ItemType Directory -Path $tempRoot
    Invoke-WebRequest -Uri $downloadUri -OutFile $zipPath
    $actualSha256 = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualSha256 -cne $expectedSha256) {
        throw 'O checksum do pacote oficial age não corresponde ao valor pinado.'
    }

    Expand-Archive -LiteralPath $zipPath -DestinationPath $extractRoot
    $sourceDirectory = Join-Path $extractRoot 'age'
    foreach ($file in @('age.exe', 'age-inspect.exe', 'age-keygen.exe')) {
        if (-not (Test-Path -LiteralPath (Join-Path $sourceDirectory $file) -PathType Leaf)) {
            throw "O pacote age não contém $file."
        }
    }

    $parent = Split-Path -Parent $DestinationDirectory
    if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
        $null = New-Item -ItemType Directory -Path $parent
    }
    Move-Item -LiteralPath $sourceDirectory -Destination $DestinationDirectory

    $versionOutput = & (Join-Path $DestinationDirectory 'age.exe') --version
    if ($LASTEXITCODE -ne 0 -or $versionOutput.Trim() -cne ('v' + $version)) {
        throw 'A instalação local do age não passou na validação de versão.'
    }

    [pscustomobject]@{
        Directory = $DestinationDirectory
        Version = $versionOutput.Trim()
        PackageSha256 = $actualSha256
        Source = $downloadUri
    }
}
finally {
    $resolvedTempRoot = [IO.Path]::GetFullPath($tempRoot)
    $resolvedTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if (-not $resolvedTempRoot.StartsWith($resolvedTemp, [StringComparison]::OrdinalIgnoreCase) -or
        -not (Split-Path -Leaf $resolvedTempRoot).StartsWith('finelo-age-install-', [StringComparison]::Ordinal)) {
        throw 'A limpeza recusou um caminho fora do diretório temporário controlado.'
    }
    Remove-Item -LiteralPath $resolvedTempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
