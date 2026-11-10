param([ValidateRange(1,65535)][int]$Port = 8080,[string]$ListenAddress = '0.0.0.0',[switch]$EnableHomeLogin)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$phpBin = Join-Path $PSScriptRoot '.runtime/php/php.exe'
if (!(Test-Path $phpBin)) { $phpBin = (Get-Command php -ErrorAction Stop).Source }
$phpArgs = @()
$phpIni = Join-Path $PSScriptRoot '.runtime/php/php.ini'
if (Test-Path $phpIni) { $phpArgs += @('-c', $phpIni) }
if (!$env:ALLOWED_ORIGINS) {
    $origins = @("http://127.0.0.1:$Port", "http://localhost:$Port")
    $lanAddresses = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -ne '127.0.0.1' -and $_.IPAddress -notlike '169.254.*' -and $_.AddressState -eq 'Preferred' } | Select-Object -ExpandProperty IPAddress)
    foreach ($lanAddress in $lanAddresses) { $origins += "http://${lanAddress}:$Port" }
    $origins += "http://$($env:COMPUTERNAME):$Port", "http://$($env:COMPUTERNAME.ToLowerInvariant()):$Port"
    $env:ALLOWED_ORIGINS = ($origins | Select-Object -Unique) -join ','
}
& $phpBin @phpArgs (Join-Path $PSScriptRoot 'server/check-runtime.php')
if ($LASTEXITCODE -ne 0) { throw 'PHP environment is incomplete.' }
Write-Host "Shiying: http://127.0.0.1:$Port (Ctrl+C to stop)"
if ($ListenAddress -eq '0.0.0.0') {
    Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -ne '127.0.0.1' -and $_.IPAddress -notlike '169.254.*' -and $_.AddressState -eq 'Preferred' } | ForEach-Object { Write-Host "LAN: http://$($_.IPAddress):$Port" }
}
if (!$EnableHomeLogin) { & $phpBin @phpArgs -S "${ListenAddress}:$Port" server/router.php; exit $LASTEXITCODE }
$env:ENABLE_HOME = '1'
$nodeBin = (Get-Command node -ErrorAction Stop).Source
if (!(Test-Path (Join-Path $PSScriptRoot 'node_modules/playwright-core'))) { throw 'Run npm ci first to install the Douyin login helper.' }
$secretBytes = New-Object byte[] 32
$randomGenerator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$randomGenerator.GetBytes($secretBytes)
$randomGenerator.Dispose()
$env:PLATFORM_HELPER_SECRET = [Convert]::ToBase64String($secretBytes)
New-Item -ItemType Directory -Force (Join-Path $PSScriptRoot '.runtime') | Out-Null
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback,0)
$listener.Start()
$env:PLATFORM_HELPER_PORT = [string]$listener.LocalEndpoint.Port
$listener.Stop()
$helper = Start-Process -FilePath $nodeBin -ArgumentList @('scripts/douyin-login.mjs') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $PSScriptRoot '.runtime/login-helper.log') -RedirectStandardError (Join-Path $PSScriptRoot '.runtime/login-helper-error.log')
try { & $phpBin @phpArgs -S "${ListenAddress}:$Port" server/router.php }
finally {
    try { Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$env:PLATFORM_HELPER_PORT/shutdown" -Headers @{'X-Helper-Secret'=$env:PLATFORM_HELPER_SECRET} -Body '{}' -ContentType 'application/json' | Out-Null } catch { if (!$helper.HasExited) { Stop-Process -Id $helper.Id -ErrorAction SilentlyContinue } }
    Remove-Item Env:PLATFORM_HELPER_SECRET -ErrorAction SilentlyContinue
}
