param(
  [switch]$Ci
)

$ErrorActionPreference = 'Stop'
$env:WRANGLER_WRITE_LOGS = 'false'
$env:WRANGLER_LOG_PATH = '.wrangler/logs'

npm run build:portable
npm run lint:portable
npm run test:only
npm run media:check:build
npm run migration:check

if ($Ci) { Write-Host 'Quality pipeline completed in CI mode.' } else { Write-Host 'Quality pipeline completed.' }
