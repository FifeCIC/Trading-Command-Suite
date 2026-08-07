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

# ── Load .env ────────────────────────────────────────────

$envPath = "$ROOT\nest\.env"
$envVars = @{}
if (Test-Path $envPath) {
    Get-Content $envPath | ForEach-Object {
        if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
            $envVars[$matches[1]] = $matches[2].Trim('"').Trim("'")
        }
    }
}

# Default to account #2 only if not specified
$activeBrokers = ($envVars['MT5_ACTIVE_BROKERS'] -split ',').Trim() | Where-Object { $_ }
if (-not $activeBrokers) { $activeBrokers = @('2') }
$pythonPath = $envVars['MT5_PYTHON_PATH'] ?? 'python'
$bridgeScript = "$ROOT\scripts\mt5-bridge\mt5_bridge_v2.py"
$bridgeCwd = Split-Path $bridgeScript -Parent

# Build list of bridge ports to kill/start
$bridgePorts = @()
for ($i = 0; $i -lt $activeBrokers.Count; $i++) {
    $bridgePorts += 5000 + $i
}

# ── Kill anything on our ports ─────────────────────────────

Write-Host "`n  Stopping existing services…" -ForegroundColor DarkGray
@(3201) + $bridgePorts + @(5173, 5174) | ForEach-Object {
    $conn = Get-NetTCPConnection -LocalPort $_ -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($conn) { 
        try { Stop-Process -Id $conn.OwningProcess -Force -ErrorAction Stop } catch {}
        $null = cmd /c "taskkill /F /PID $($conn.OwningProcess) 2>nul"
    }
}
Start-Sleep -Seconds 2

# ── Build NestJS (always fresh) ────────────────────────────

Write-Host "  Building NestJS (tsc)…" -ForegroundColor Cyan
Push-Location "$ROOT\nest"
$buildOutput = cmd /c "npx tsc -p tsconfig.build.json 2>&1" 
$buildExit = $LASTEXITCODE
Pop-Location
if ($buildExit -ne 0) {
    Write-Host "  ❌ NestJS BUILD FAILED" -ForegroundColor Red
    Write-Host $buildOutput -ForegroundColor Red
    Write-Host "`n  Launch aborted — fix compilation errors first." -ForegroundColor Red
    Write-Host "  Run: npm --prefix $ROOT\nest run build`n"
    exit 1
}
Write-Host "    Build OK ($buildExit)" -ForegroundColor DarkGray

# ── Start MT5 Bridges (one per active broker) ──────────────

$mt5Pids = @()
for ($i = 0; $i -lt $activeBrokers.Count; $i++) {
    $brokerId = $activeBrokers[$i]
    $bridgePort = 5000 + $i
    $brokerServer = $envVars["MT5_SERVER_$brokerId"] ?? '?'
    Write-Host "  Starting MT5 Bridge #${brokerId} — ${brokerServer} (port ${bridgePort})…" -ForegroundColor Yellow
    $env:BRIDGE_PORT = "$bridgePort"
    $env:BRIDGE_ACCOUNT = $brokerId
    $mt5 = Start-Process -FilePath $pythonPath `
        -ArgumentList $bridgeScript `
        -WorkingDirectory $bridgeCwd `
        -PassThru -NoNewWindow `
        -RedirectStandardOutput "$env:TEMP\mt5-bridge-${bridgePort}.log" `
        -RedirectStandardError "$env:TEMP\mt5-bridge-${bridgePort}-err.log"
    $mt5Pids += $mt5.Id
    Write-Host "    PID $($mt5.Id) (port ${bridgePort})" -ForegroundColor DarkGray
}

# ── Start NestJS API ────────────────────────────────────────

Write-Host "  Starting NestJS API (port 3201)…" -ForegroundColor Cyan
$env:DATABASE_URL = 'mysql://tradingcs:tradingcs_dev_2026@localhost:3306/tradingcs'
$nestLog = "$env:TEMP\nest-api.log"
$nestErr = "$env:TEMP\nest-api-err.log"
$nest = Start-Process -FilePath "node" `
    -ArgumentList "$ROOT\nest\dist\src\main.js" `
    -WorkingDirectory "$ROOT\nest" `
    -PassThru -NoNewWindow `
    -RedirectStandardOutput $nestLog `
    -RedirectStandardError $nestErr
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
$services = @()
for ($i = 0; $i -lt $activeBrokers.Count; $i++) {
    $brokerId = $activeBrokers[$i]
    $bridgePort = 5000 + $i
    $brokerServer = $envVars["MT5_SERVER_$brokerId"] ?? '?'
    $services += @{ Name = "MT5 #${brokerId} (${brokerServer})"; Port = $bridgePort; Color = 'Yellow' }
}
$services += @{ Name = 'NestJS API'; Port = 3201; Color = 'Cyan' }
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
        Write-Host "  API health: http://localhost:3201/api/health" -ForegroundColor DarkGray
    }
} else {
    Write-Host "  Some services didn't start:" -ForegroundColor Red
    foreach ($svc in $down) {
        Write-Host "    $($svc.Name) on port $($svc.Port) — check $env:TEMP\$($svc.Name -replace ' ','-').log" -ForegroundColor Red
    }
    # Show NestJS error log inline if it failed
    if ($down | Where-Object { $_.Name -eq 'NestJS API' }) {
        Write-Host "`n  ── NestJS error log (last 30 lines) ──" -ForegroundColor DarkGray
        Get-Content "$env:TEMP\nest-api-err.log" -Tail 30 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
        Write-Host "  ───────────────────────────────────" -ForegroundColor DarkGray
    }
}
Write-Host ""
