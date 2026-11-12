# just-Code installer for Windows — https://code.justapps.it
# Usage: irm https://code.justapps.it/install.ps1 | iex
$ErrorActionPreference = 'Stop'
$pkg = '@justapps/just-code'
$url = 'https://code.justapps.it/latest.tgz'
Write-Host '▌ just-Code installer' -ForegroundColor DarkYellow
Write-Host ''

if (-not (Get-Command node -ErrorAction SilentlyContinue) -or -not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Host 'Node.js 20+ is required but was not found.'
  Write-Host 'Install it from https://nodejs.org (or: winget install OpenJS.NodeJS.LTS), then run this again.'
  return
}
$major = [int]((node -p "process.versions.node.split('.')[0]") | Out-String).Trim()
if ($major -lt 20) {
  Write-Host "Node.js $(node -v) found, but just-Code needs Node.js 20 or newer."
  return
}

Write-Host "-> npm install -g $pkg" -ForegroundColor DarkGray
npm install -g $pkg
if ($LASTEXITCODE -ne 0) {
  Write-Host 'npm registry install failed, trying the latest GitHub release...' -ForegroundColor DarkGray
  npm install -g $url
  if ($LASTEXITCODE -ne 0) { Write-Host 'npm install failed.' -ForegroundColor Red; return }
}

Write-Host ''
Write-Host 'Installed. Run just-code (or jc) inside a project, then type /login.' -ForegroundColor DarkYellow
