param([ValidateRange(1024,65535)][int]$Port=5209)
$ErrorActionPreference='Stop'
$taskRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$taskEnvironment=@{VITE_SUPABASE_URL='https://integrated-fixture.invalid';VITE_SUPABASE_PUBLISHABLE_KEY='synthetic-public-key';VITE_SUPABASE_ANON_KEY='synthetic-public-key';VITE_APPEARANCE_PILOT='true';VITE_OPEN_FINANCE_ENABLED='false';VITE_ATOMIC_IMPORTS_ENABLED='false';VITE_CARD_ENGINE_FORCE='false';VITE_CARD_V2_FORCE='false';VITE_CARD_V2_SHADOW_FORCE='false';VITE_CARD_V2_ROLLOUT_PERCENT='0';VITE_DASHBOARD_OWNER_SCOPE_ENABLED='false';VITE_INVESTMENT_PORTFOLIOS_ENABLED='false';VITE_NET_WORTH_COMPONENTS_V2_ENABLED='false'}
$taskPrevious=@{}
foreach($taskName in $taskEnvironment.Keys){$taskPrevious[$taskName]=[Environment]::GetEnvironmentVariable($taskName,'Process');[Environment]::SetEnvironmentVariable($taskName,$taskEnvironment[$taskName],'Process')}
Push-Location $taskRoot
try{& node node_modules/vite/bin/vite.js --mode staging --host 127.0.0.1 --port $Port --strictPort}
finally{Pop-Location;foreach($taskName in $taskPrevious.Keys){[Environment]::SetEnvironmentVariable($taskName,'Process',$taskPrevious[$taskName])}}
