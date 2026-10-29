# Shared process identity checks. All script source is ASCII for Windows PowerShell 5.1.
Set-StrictMode -Version Latest

function Get-ArenaLayout {
    $projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
    $runtimeDirectory = Join-Path $projectRoot '.runtime'
    return [pscustomobject]@{
        Root = $projectRoot
        Runtime = $runtimeDirectory
        Entry = Join-Path $projectRoot 'dist\server\index.js'
        State = Join-Path $runtimeDirectory 'server.json'
        Stdout = Join-Path $runtimeDirectory 'server.stdout.log'
        Stderr = Join-Path $runtimeDirectory 'server.stderr.log'
    }
}

function Read-ArenaState($Layout) {
    if (-not (Test-Path -LiteralPath $Layout.State)) { return $null }
    try { return Get-Content -LiteralPath $Layout.State -Raw -Encoding UTF8 | ConvertFrom-Json }
    catch { throw "Cannot read $($Layout.State). Resolve this state file before starting or stopping a server." }
}

function Get-ArenaOwnedProcess($Layout, $State) {
    if ($null -eq $State) { return $null }
    try {
        if (-not [string]::Equals([string]$State.entry, $Layout.Entry, [System.StringComparison]::OrdinalIgnoreCase)) { return $null }
        $arenaProcess = Get-Process -Id ([int]$State.processId) -ErrorAction Stop
        $actualStart = [string]$arenaProcess.StartTime.ToUniversalTime().Ticks
        if ($actualStart -ne [string]$State.startedAtTicks) { return $null }
        $details = Get-CimInstance Win32_Process -Filter "ProcessId = $($arenaProcess.Id)" -ErrorAction Stop
        if ([string]::IsNullOrEmpty($details.CommandLine) -or $details.CommandLine.IndexOf($Layout.Entry, [System.StringComparison]::OrdinalIgnoreCase) -lt 0) { return $null }
        if (-not [string]::Equals([string]$details.ExecutablePath, [string]$State.nodePath, [System.StringComparison]::OrdinalIgnoreCase)) { return $null }
        return $arenaProcess
    }
    catch { return $null }
}

function Write-ArenaLinks([int]$Port) {
    Write-Host "Local: http://localhost:$Port/"
    try {
        $interfaces = @(Get-NetIPConfiguration -ErrorAction Stop | Where-Object { $_.NetAdapter.Status -eq 'Up' -and $_.NetAdapter.HardwareInterface })
        foreach ($network in $interfaces) {
            foreach ($address in @($network.IPv4Address)) {
                $ip = [string]$address.IPAddress
                if ($ip -match '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)') {
                    Write-Host "LAN ($($network.InterfaceAlias)): http://${ip}:$Port/"
                }
            }
        }
    }
    catch { Write-Warning 'LAN addresses could not be detected. Use ipconfig to find this computer IPv4 address.' }
    Write-Host 'Share the LAN address with a device on the same network. A localhost link only works on this computer.'
}
