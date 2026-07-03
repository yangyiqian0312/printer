$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$LogDir = Join-Path $ProjectRoot 'data\logs'
$OutLog = Join-Path $LogDir 'service-out.log'
$ErrLog = Join-Path $LogDir 'service-err.log'

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
Set-Location $ProjectRoot

npm.cmd run agent 1>> $OutLog 2>> $ErrLog
