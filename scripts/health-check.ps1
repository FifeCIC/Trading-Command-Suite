#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Quick health check for agents and developers.
  Hits /api/system/health-summary and prints a compact status.
.DESCRIPTION
  Run this at the start of any session to understand system state.
  No arguments needed — just `pwsh scripts/health-check.ps1`.
.EXAMPLE
  pwsh scripts/health-check.ps1
#>

$api = "http://localhost:3201/api/system/health-summary"
try {
  $r = Invoke-RestMethod -Uri $api -TimeoutSec 5
  Write-Host "`n🩺 Health Summary (fetched in $($r.fetchedMs)ms):" -ForegroundColor Cyan
  Write-Host $r.summary
  Write-Host ""
} catch {
  Write-Host "❌ NestJS API not reachable at http://localhost:3201" -ForegroundColor Red
  Write-Host "   Run: pwsh scripts/tcs-launch.ps1" -ForegroundColor Yellow
}
