<#
Service control helper for Windows servers.
Usage: .\scripts\service-control.ps1 -Action start|stop|restart|status

This script will attempt to control a Windows Service if one exists with the expected name
(`cmp-backend` and `cmp-telegram-bot`). If not found it will attempt to control via `pm2`
if pm2 is installed (pm2 on Windows often managed via pm2-windows-service).
#>

[param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("start","stop","restart","status")]
  [string]$Action
)]

$backendServiceName = 'cmp-backend'
# NOTE: the Telegram bot runs inside cmp-backend (Postgres advisory lock) and
# is deliberately not controlled separately - a second poller causes HTTP 409
# getUpdates conflicts. Kept only so legacy installs can be cleaned up.
$botServiceName = 'cmp-telegram-bot'

function Control-ServiceByName($name, $action) {
  $svc = Get-Service -Name $name -ErrorAction SilentlyContinue
  if ($null -ne $svc) {
    switch ($action) {
      'start'   { if ($svc.Status -ne 'Running') { Start-Service -Name $name -ErrorAction Stop } }
      'stop'    { if ($svc.Status -ne 'Stopped') { Stop-Service -Name $name -ErrorAction Stop } }
      'restart' { Restart-Service -Name $name -Force -ErrorAction Stop }
      'status'  { Write-Output "$name : $($svc.Status)" }
    }
    return $true
  }
  return $false
}

function Control-PM2($procName, $action) {
  $pm2 = Get-Command pm2 -ErrorAction SilentlyContinue
  if ($null -ne $pm2) {
    switch ($action) {
      'start'   { & pm2 start $procName | Out-Null }
      'stop'    { & pm2 stop $procName | Out-Null }
      'restart' { & pm2 restart $procName | Out-Null }
      'status'  { & pm2 list }
    }
    return $true
  }
  return $false
}

Write-Output "Service control: $Action"

# Backend
if (Control-ServiceByName $backendServiceName $Action) {
  Write-Output "Windows service: $backendServiceName $Action succeeded"
} else {
  if (Control-PM2 $backendServiceName $Action) { Write-Output "pm2: $backendServiceName $Action succeeded" } else { Write-Warning "Backend service ($backendServiceName) not found as Windows service or pm2 process" }
}

# Bot: runs inside cmp-backend, so no separate action is taken here.
# Starting a second poller causes HTTP 409 "terminated by other getUpdates
# request" conflicts. If a legacy bot service exists, ensure it is stopped and
# removed so it cannot be started again.
if ($Action -eq 'stop' -or $Action -eq 'restart' -or $Action -eq 'status') {
  if (Control-ServiceByName $botServiceName 'stop') {
    Write-Output "Legacy $botServiceName stopped (bot runs inside $backendServiceName)"
  }
}

exit 0
