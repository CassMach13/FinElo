param([ValidateRange(1024,65535)][int]$Port = 5202)
$ErrorActionPreference = 'Stop'
$taskRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$taskEnvironment = @{
  VITE_SUPABASE_URL = 'https://import-fixture.invalid'
  VITE_SUPABASE_PUBLISHABLE_KEY = 'synthetic-public-key'
  VITE_SUPABASE_ANON_KEY = 'synthetic-public-key'
  VITE_APPEARANCE_PILOT = 'false'
  VITE_OPEN_FINANCE_ENABLED = 'false'
  VITE_ATOMIC_IMPORTS_ENABLED = 'false'
  VITE_CARD_ENGINE_FORCE = 'false'
  VITE_CARD_V2_FORCE = 'false'
  VITE_CARD_V2_SHADOW_FORCE = 'false'
  VITE_CARD_V2_ROLLOUT_PERCENT = '0'
}
$taskPrevious = @{}
foreach ($taskName in $taskEnvironment.Keys) {
  $taskPrevious[$taskName] = [Environment]::GetEnvironmentVariable($taskName,'Process')
  [Environment]::SetEnvironmentVariable($taskName,$taskEnvironment[$taskName],'Process')
}
Push-Location $taskRoot
try { & node node_modules/vite/bin/vite.js --mode staging --host 127.0.0.1 --port $Port --strictPort }
finally {
  Pop-Location
  foreach ($taskName in $taskPrevious.Keys) { [Environment]::SetEnvironmentVariable($taskName,$taskPrevious[$taskName],'Process') }
}
