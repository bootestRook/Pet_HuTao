[CmdletBinding()]
param(
    [ValidateRange(1024, 65535)][int]$Port = 3000,
    [switch]$Rebuild
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$OutputEncoding = [System.Text.UTF8Encoding]::new()
. (Join-Path $PSScriptRoot 'runtime.ps1')
$layout = Get-ArenaLayout
$existingState = Read-ArenaState $layout
$existingProcess = Get-ArenaOwnedProcess $layout $existingState
if ($null -ne $existingProcess) {
    if ([int]$existingState.port -ne $Port) { throw "This project is already running on port $($existingState.port). Stop it before changing ports." }
    Write-Host "Pet Arena is already running (PID $($existingProcess.Id))."
    Write-ArenaLinks $Port
    exit 0
}

$listeners = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
if ($listeners.Count -gt 0) {
    $owners = ($listeners.OwningProcess | Sort-Object -Unique) -join ', '
    throw "Port $Port is already occupied by PID(s) $owners. Nothing was stopped. Free it yourself or use -Port with another port."
}

$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$nodePath = if ($null -ne $nodeCommand) { $nodeCommand.Source } else { 'C:\Program Files\nodejs\node.exe' }
if (-not (Test-Path -LiteralPath $nodePath)) { throw 'Node.js is required. Install Node.js 24 LTS, then run this script again.' }
$npmPath = Join-Path ([System.IO.Path]::GetDirectoryName($nodePath)) 'npm.cmd'
if (-not (Test-Path -LiteralPath $npmPath)) { throw "npm.cmd was not found beside $nodePath." }

Push-Location $layout.Root
try {
    $dependenciesMissing = -not (Test-Path -LiteralPath 'node_modules\@colyseus\core\package.json') -or -not (Test-Path -LiteralPath 'node_modules\typescript\package.json')
    if ($dependenciesMissing) {
        Write-Host 'Installing locked dependencies...'
        & $npmPath ci --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
    }
    if ($dependenciesMissing -or $Rebuild -or -not (Test-Path -LiteralPath $layout.Entry) -or -not (Test-Path -LiteralPath 'dist\client\index.html')) {
        Write-Host 'Building the client and server...'
        & $npmPath run build
        if ($LASTEXITCODE -ne 0) { throw 'npm run build failed.' }
    }
}
finally { Pop-Location }

New-Item -ItemType Directory -Path $layout.Runtime -Force | Out-Null
$previousHost = [Environment]::GetEnvironmentVariable('HOST', 'Process')
$previousPort = [Environment]::GetEnvironmentVariable('PORT', 'Process')
try {
    [Environment]::SetEnvironmentVariable('HOST', '0.0.0.0', 'Process')
    [Environment]::SetEnvironmentVariable('PORT', [string]$Port, 'Process')
    $arenaProcess = Start-Process -FilePath $nodePath -ArgumentList @('--env-file-if-exists=.env', ('"' + $layout.Entry + '"')) -WorkingDirectory $layout.Root -WindowStyle Hidden -RedirectStandardOutput $layout.Stdout -RedirectStandardError $layout.Stderr -PassThru
    $state = [pscustomobject]@{
        processId = $arenaProcess.Id
        startedAtTicks = [string]$arenaProcess.StartTime.ToUniversalTime().Ticks
        entry = $layout.Entry
        nodePath = $nodePath
        port = $Port
    }
    $state | ConvertTo-Json | Set-Content -LiteralPath $layout.State -Encoding UTF8
}
finally {
    [Environment]::SetEnvironmentVariable('HOST', $previousHost, 'Process')
    [Environment]::SetEnvironmentVariable('PORT', $previousPort, 'Process')
}

$healthy = $false
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    $arenaProcess.Refresh()
    if ($arenaProcess.HasExited) { break }
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 1
        if ($health.ok -eq $true -and $health.app -eq 'pet-arena') { $healthy = $true; break }
    }
    catch { }
    Start-Sleep -Milliseconds 500
}

if (-not $healthy) {
    $ownedProcess = Get-ArenaOwnedProcess $layout $state
    if ($null -ne $ownedProcess) { Stop-Process -Id $ownedProcess.Id -ErrorAction Stop }
    Remove-Item -LiteralPath $layout.State -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $layout.Stderr) { Get-Content -LiteralPath $layout.Stderr -Tail 15 -Encoding UTF8 | Write-Host }
    throw "Server did not become healthy. See $($layout.Stderr)."
}

Write-Host "Pet Arena started in the background (PID $($arenaProcess.Id))."
Write-ArenaLinks $Port
Write-Host "Logs: $($layout.Runtime)"
Write-Host 'Stop: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\stop-local.ps1'
