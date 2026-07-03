$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ScriptPath = Join-Path $ProjectRoot 'scripts\start-printer.ps1'
$TaskName = 'TikTok Live Label Printer'

$Action = New-ScheduledTaskAction `
  -Execute 'powershell.exe' `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$ScriptPath`""

$Trigger = New-ScheduledTaskTrigger -AtLogOn
$Settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $Action `
  -Trigger $Trigger `
  -Settings $Settings `
  -Description 'Runs the TikTok Live label printer web app and webhook service.' `
  -Force | Out-Null

Write-Host "Installed scheduled task: $TaskName"
Write-Host "Start it now from Task Scheduler, or run:"
Write-Host "Start-ScheduledTask -TaskName `"$TaskName`""
