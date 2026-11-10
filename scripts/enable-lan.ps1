param([ValidateRange(1,65535)][int]$Port = 8080)
$ErrorActionPreference = 'Stop'
$workspacePath = Split-Path $PSScriptRoot -Parent
$resultPath = Join-Path $workspacePath '.runtime/lan-firewall-result.json'
try {
    $phpPath = Join-Path $workspacePath '.runtime/php/php.exe'
    if (!(Test-Path -LiteralPath $phpPath)) { $phpPath = (Get-Command php -ErrorAction Stop).Source }
    $ruleName = "Shiying-LAN-TCP-$Port"
    $existing = Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue
    if ($existing) {
        $existing | Set-NetFirewallRule -Enabled True -Direction Inbound -Action Allow -Profile Private
        $existing | Get-NetFirewallPortFilter | Set-NetFirewallPortFilter -Protocol TCP -LocalPort $Port
        $existing | Get-NetFirewallAddressFilter | Set-NetFirewallAddressFilter -RemoteAddress LocalSubnet
        $existing | Get-NetFirewallApplicationFilter | Set-NetFirewallApplicationFilter -Program $phpPath
    } else {
        New-NetFirewallRule -Name $ruleName -DisplayName "Shiying LAN (TCP $Port)" -Direction Inbound -Action Allow -Enabled True -Protocol TCP -LocalPort $Port -Program $phpPath -Profile Private -RemoteAddress LocalSubnet | Out-Null
    }
    @{success=$true;port=$Port;profile='Private';remoteAddress='LocalSubnet'} | ConvertTo-Json | Set-Content -LiteralPath $resultPath -Encoding UTF8
} catch {
    @{success=$false;message=$_.Exception.Message} | ConvertTo-Json | Set-Content -LiteralPath $resultPath -Encoding UTF8
    exit 1
}
