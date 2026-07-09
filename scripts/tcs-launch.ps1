#Requires -Version 7
<#
.SYNOPSIS
    Trading Command Suite — one command to start everything.
.EXAMPLE
    pwsh -File scripts/tcs-launch.ps1
    pwsh -File scripts/tcs-launch.ps1 -SkipFrontend
#>
param([switch]$SkipFrontend)

$ROOT = 'C:\wamp64\www\trading-command-suite'
$ErrorActionPreference = 'Continue'

# ── Kill anything on our ports ─────────────────────────────

Write-Host "`n  Stopping existing services…" -ForegroundColor DarkGray
@(3201, 5000, 5173, 5174) | ForEach-Object {
    $conn = Get-NetTCPConnection -LocalPort $_ -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($conn) { 
        try { Stop-Process -Id $conn.OwningProcess -Force -ErrorAction Stop } catch {}
        $null = cmd /c "taskkill /F /PID $($conn.OwningProcess) 2>nul"
    }
}
Start-Sleep -Seconds 2

# ── Start MT5 Bridge ────────────────────────────────────────

Write-Host "  Starting MT5 Bridge (port 5000)…" -ForegroundColor Yellow
$mt5 = Start-Process -FilePath "python" `
    -ArgumentList "$ROOT\scripts\mt5-bridge\mt5_bridge_v2.py" `
    -WorkingDirectory "$ROOT\scripts\mt5-bridge" `
    -PassThru -NoNewWindow `
    -RedirectStandardOutput "$env:TEMP\mt5-bridge.log" `
    -RedirectStandardError "$env:TEMP\mt5-bridge-err.log"
Write-Host "    PID $($mt5.Id)" -ForegroundColor DarkGray

# ── Start NestJS API ────────────────────────────────────────

Write-Host "  Starting NestJS API (port 3201)…" -ForegroundColor Cyan
$env:DATABASE_URL = 'mysql://tradingcs:tradingcs_dev_2026@localhost:3306/tradingcs'
$nest = Start-Process -FilePath "node" `
    -ArgumentList "$ROOT\nest\dist\src\main.js" `
    -WorkingDirectory "$ROOT\nest" `
    -PassThru -NoNewWindow `
    -RedirectStandardOutput "$env:TEMP\nest-api.log" `
    -RedirectStandardError "$env:TEMP\nest-api-err.log"
Write-Host "    PID $($nest.Id)" -ForegroundColor DarkGray

# ── Start Vite Frontend ─────────────────────────────────────

if (-not $SkipFrontend) {
    Write-Host "  Starting Vite Frontend (port 5173)…" -ForegroundColor Green
    $vite = Start-Process -FilePath "cmd" `
        -ArgumentList "/c npx vite --host --port 5173 --strictPort" `
        -WorkingDirectory $ROOT `
        -PassThru -NoNewWindow `
        -RedirectStandardOutput "$env:TEMP\vite.log" `
        -RedirectStandardError "$env:TEMP\vite-err.log"
    Write-Host "    PID $($vite.Id)" -ForegroundColor DarkGray
}

# ── Wait and verify ────────────────────────────────────────

Write-Host "`n  Waiting for services to come online…" -ForegroundColor DarkGray
$services = @(
    @{ Name = 'MT5 Bridge'; Port = 5000; Color = 'Yellow' }
    @{ Name = 'NestJS API'; Port = 3201; Color = 'Cyan' }
)
if (-not $SkipFrontend) {
    $services += @{ Name = 'Vite'; Port = 5173; Color = 'Green' }
}

$allUp = $false
$down = @()
for ($i = 1; $i -le 15; $i++) {
    Start-Sleep -Seconds 2
    $up = @()
    $down = @()
    foreach ($svc in $services) {
        $conn = Get-NetTCPConnection -LocalPort $svc.Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($conn) { $up += $svc } else { $down += $svc }
    }
    if ($down.Count -eq 0) { $allUp = $true; break }
    $status = ($up | ForEach-Object { "$($_.Name) ✓" }) -join '  '
    $waiting = ($down | ForEach-Object { "$($_.Name) …" }) -join '  '
    Write-Host "    [$i] $status  $waiting" -ForegroundColor DarkGray
}

Write-Host ""
if ($allUp) {
    Write-Host "  All services running" -ForegroundColor Green
    foreach ($svc in $services) {
        Write-Host "    $($svc.Name): http://localhost:$($svc.Port)" -ForegroundColor $svc.Color
    }
    Write-Host ""
    if (-not $SkipFrontend) {
        Write-Host "  App: http://localhost:5173" -ForegroundColor White
    }
} else {
    Write-Host "  Some services didn't start:" -ForegroundColor Red
    foreach ($svc in $down) {
        Write-Host "    $($svc.Name) on port $($svc.Port) — check $env:TEMP\$($svc.Name -replace ' ','-').log" -ForegroundColor Red
    }
}
Write-Host ""
