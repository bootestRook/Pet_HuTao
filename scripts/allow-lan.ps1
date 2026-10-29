[CmdletBinding(SupportsShouldProcess = $true)]
param([ValidateRange(1024, 65535)][int]$Port = 3000)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$OutputEncoding = [System.Text.UTF8Encoding]::new()
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) -and -not $WhatIfPreference) {
    throw 'Open PowerShell as Administrator to add this firewall rule. This script only allows a Private network and LocalSubnet sources.'
}

$ruleName = "PetArena-LAN-TCP-$Port-Private"
if ($PSCmdlet.ShouldProcess($ruleName, "Allow inbound TCP $Port on Private networks from LocalSubnet only")) {
    $existing = Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue
    if ($null -eq $existing) {
        New-NetFirewallRule -Name $ruleName -DisplayName "Pet Arena LAN (TCP $Port, Private, LocalSubnet)" -Direction Inbound -Action Allow -Enabled True -Profile Private -Protocol TCP -LocalPort $Port -RemoteAddress LocalSubnet | Out-Null
    }
    else {
        Set-NetFirewallRule -Name $ruleName -Direction Inbound -Action Allow -Enabled True -Profile Private | Out-Null
        $existing | Get-NetFirewallPortFilter | Set-NetFirewallPortFilter -Protocol TCP -LocalPort $Port | Out-Null
        $existing | Get-NetFirewallAddressFilter | Set-NetFirewallAddressFilter -LocalAddress Any -RemoteAddress LocalSubnet | Out-Null
    }
    Write-Host "LAN firewall rule ready: $ruleName"
    Write-Host 'This does not change the network profile and does not open a Public network.'
}
