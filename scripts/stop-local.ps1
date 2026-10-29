[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$OutputEncoding = [System.Text.UTF8Encoding]::new()
. (Join-Path $PSScriptRoot 'runtime.ps1')
$layout = Get-ArenaLayout
$state = Read-ArenaState $layout
if ($null -eq $state) { Write-Host 'No server started by this launcher is recorded.'; exit 0 }

$ownedProcess = Get-ArenaOwnedProcess $layout $state
if ($null -eq $ownedProcess) {
    if ($null -ne (Get-Process -Id ([int]$state.processId) -ErrorAction SilentlyContinue)) {
        throw "PID $($state.processId) does not match this project's recorded process identity. Nothing was stopped."
    }
    Remove-Item -LiteralPath $layout.State
    Write-Host 'The recorded server has already exited. Removed stale state.'
    exit 0
}

Stop-Process -Id $ownedProcess.Id -ErrorAction Stop
$ownedProcess.WaitForExit(5000) | Out-Null
Remove-Item -LiteralPath $layout.State
Write-Host "Stopped this project's server (PID $($ownedProcess.Id))."
