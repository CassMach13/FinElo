param([ValidateRange(1024,65535)][int]$Port = 5201)
$ErrorActionPreference = 'Stop'
$taskRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$taskEnvironment = @{
  VITE_SUPABASE_URL = 'https://financial-fixture.invalid'
  VITE_SUPABASE_PUBLISHABLE_KEY = 'synthetic-public-key'
  VITE_APPEARANCE_PILOT = 'false'
  VITE_SMART_TRANSACTION_FILTERS_ENABLED = 'false'
}
$taskPrevious = @{}
foreach ($taskName in $taskEnvironment.Keys) {
  $taskPrevious[$taskName] = [Environment]::GetEnvironmentVariable($taskName,'Process')
  [Environment]::SetEnvironmentVariable($taskName,$taskEnvironment[$taskName],'Process')
}
Push-Location $taskRoot
try {
  & node node_modules/vite/bin/vite.js --mode staging --host 127.0.0.1 --port $Port --strictPort
} finally {
  Pop-Location
  foreach ($taskName in $taskPrevious.Keys) { [Environment]::SetEnvironmentVariable($taskName,$taskPrevious[$taskName],'Process') }
}
