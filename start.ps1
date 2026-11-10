$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$phpBin = Join-Path $PSScriptRoot '.runtime/php/php.exe'
if (!(Test-Path $phpBin)) { $phpBin = 'php' }
& $phpBin -c (Join-Path $PSScriptRoot '.runtime/php/php.ini') -S 127.0.0.1:8080 server/router.php
