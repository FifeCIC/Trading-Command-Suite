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

# Kill MT5 bridges by process identity FIRST. Port-based killing below only
# catches the process currently holding the LISTEN socket — bridges that
# crashed-but-didn't-exit, or raced to bind, survive as zombies and keep
# serving stale candles (issue #643).
$zombieBridges = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*mt5_bridge_v2.py*' }
foreach ($bp in $zombieBridges) {
    try { Stop-Process -Id $bp.ProcessId -Force -ErrorAction Stop } catch {}
    $null = cmd /c "taskkill /F /PID $($bp.ProcessId) 2>nul"
}
if ($zombieBridges) {
    Write-Host "    Killed $($zombieBridges.Count) MT5 bridge process(es) by identity" -ForegroundColor DarkGray
}

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
    # ⚠️ `-NoNewWindow` puts the bridge in THIS console's process group, so when the
    # launcher exits the bridge receives CTRL_C_EVENT and dies. Measured (#765):
    #
    #   18:18:07  MT5 Bridge v2 listening on http://127.0.0.1:5000
    #   18:18:44  Bridge shutting down...          ← 37s later, when the launcher exited
    #
    # The bridge traps KeyboardInterrupt (mt5_bridge_v2.py:1205) and shuts down cleanly, so
    # it looks like a deliberate stop rather than a crash — and every subsequent launch
    # reported "All services running" while the bridges were already gone. Crypto and FX
    # then fetched nothing and the API logged "All MT5 Bridges Disconnected".
    #
    # The bridges are long-lived daemons; they must outlive the launcher. Use `cmd /c start`
    # to give each bridge its own detached console, which is not in the launcher's process
    # group and so never receives its signals.
    $bridgeLog = "$env:TEMP\mt5-bridge-${bridgePort}.log"
    $bridgeErr = "$env:TEMP\mt5-bridge-${bridgePort}-err.log"
    $bridgeArgs = "`"$bridgeScript`""
    $started = Start-Process -FilePath "cmd" `
        -ArgumentList "/c start `"MT5 Bridge $brokerId`" /min `"$pythonPath`" $bridgeArgs > `"$bridgeLog`" 2> `"$bridgeErr`"" `
        -WorkingDirectory $bridgeCwd `
        -PassThru -WindowStyle Hidden
    $mt5Pids += $started.Id
    Write-Host "    launcher PID $($started.Id) (detached; bridge on port ${bridgePort})" -ForegroundColor DarkGray
}

# ── Wait for the bridges to be READY before starting the API ─
#
# WHY THIS GATE EXISTS (#765)
# ---------------------------
# The API used to be started immediately after the bridges, with all waiting done at the
# END. That ordering is wrong and the symptom is severe but quiet:
#
#   WARN  MT5 bridge [broker 2] GET /candles?symbol=US500… FAILED: network: fetch failed
#   LOG   Bar refresh complete (live): 0 bars for 39 symbols
#   ALERT All MT5 Bridges Disconnected: ?, ? not connected. Automated trading disabled.
#
# The API boots, runs its first refresh against bridges that are not accepting connections
# yet, fails EVERY fetch, and commits a refresh cycle that upserted nothing. The final
# "Waiting for services" loop then reports "All services running" — because by then the
# bridges HAVE come up. So the launch reports success over a cycle that produced no data,
# and nothing re-runs that first refresh.
#
# A listening socket is NOT the readiness signal we need on its own — the bridge binds
# AFTER connecting to MT5 (see mt5_bridge_v2.py), so we poll `/health` and require
# `connected=true`, which is the same predicate the adapter needs to succeed.
$bridgeReady = @{}
foreach ($i in 0..($activeBrokers.Count - 1)) {
    $brokerId = $activeBrokers[$i]
    $bridgePort = 5000 + $i
    $brokerServer = $envVars["MT5_SERVER_$brokerId"] ?? '?'
    $ready = $false
    for ($attempt = 1; $attempt -le 45; $attempt++) {   # up to 90s
        Start-Sleep -Seconds 2
        if (Get-NetTCPConnection -LocalPort $bridgePort -State Listen -ErrorAction SilentlyContinue) {
            try {
                $h = Invoke-RestMethod "http://localhost:$bridgePort/health" -TimeoutSec 5 -ErrorAction Stop
                if ($h.connected) {
                    $ready = $true
                    Write-Host "    MT5 #${brokerId} (${brokerServer}) ready after $($attempt*2)s — connected to terminal" -ForegroundColor DarkGray
                    break
                }
            } catch { /* not up yet */ }
        }
    }
    $bridgeReady[$bridgePort] = $ready
    if (-not $ready) {
        Write-Host "    ⚠️  MT5 #${brokerId} (${brokerServer}) did NOT report connected within 90s" -ForegroundColor Yellow
        Write-Host "        Starting the API anyway — but its first refresh will fetch nothing." -ForegroundColor Yellow
        Write-Host "        Check: $env:TEMP\mt5-bridge-${bridgePort}-err.log" -ForegroundColor DarkGray
    }
}

# ── Start NestJS API ────────────────────────────────────────

Write-Host "  Starting NestJS API (port 3201)…" -ForegroundColor Cyan
$env:DATABASE_URL = 'mysql://tradingcs:tradingcs_dev_2026@localhost:3306/tradingcs'
$nestLog = "$env:TEMP\nest-api.log"
$nestErr = "$env:TEMP\nest-api-err.log"
# Detached for the same reason as the bridges (#765): a child started with `-NoNewWindow`
# shares this console's process group, so the launcher exiting sends it CTRL_C_EVENT.
#
# ⚠️ Do NOT wrap this in `cmd /c start` for the redirects — measured (#765): the API is
# detected on 3201 during the launcher's wait loop, then gone, with EMPTY log files. The
# nested quoting swallowed the redirect and the process never persisted, yet the launcher
# still reported "All services running" because it tests the port, not the process.
#
# `-WindowStyle Hidden` already gives the child its own console and detaches it from our
# signal group, so the plain form is both correct and simpler.
$nest = Start-Process -FilePath "node" `
    -ArgumentList "$ROOT\nest\dist\src\main.js" `
    -WorkingDirectory "$ROOT\nest" `
    -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput $nestLog `
    -RedirectStandardError $nestErr
Write-Host "    PID $($nest.Id) (detached; API on port 3201)" -ForegroundColor DarkGray

# ── Start Vite Frontend ─────────────────────────────────────

if (-not $SkipFrontend) {
    Write-Host "  Starting Vite Frontend (port 5173)…" -ForegroundColor Green
    # Detached, same reasoning (#765).
    $vite = Start-Process -FilePath "cmd" `
        -ArgumentList "/c npx vite --host --port 5173 --strictPort" `
        -WorkingDirectory $ROOT `
        -PassThru -WindowStyle Hidden `
        -RedirectStandardOutput "$env:TEMP\vite.log" `
        -RedirectStandardError "$env:TEMP\vite-err.log"
    Write-Host "    PID $($vite.Id) (detached; Vite on port 5173)" -ForegroundColor DarkGray
}

# ── Wait and verify ────────────────────────────────────────

Write-Host "`n  Waiting for services to come online…" -ForegroundColor DarkGray
$services = @()
for ($i = 0; $i -lt $activeBrokers.Count; $i++) {
    $brokerId = $activeBrokers[$i]
    $bridgePort = 5000 + $i
    $brokerServer = $envVars["MT5_SERVER_$brokerId"] ?? '?'
    # Carry the REAL per-port log paths (RedirectStandardOutput/Err above) so the
    # "didn't start" message points at an actual file — the bridge writes to
    # mt5-bridge-<port>.log, NOT a constructed '<Name>.log' under TEMP.
    $services += @{ Name = "MT5 #${brokerId} (${brokerServer})"; Port = $bridgePort; Color = 'Yellow'; Log = "$env:TEMP\mt5-bridge-${bridgePort}.log"; ErrLog = "$env:TEMP\mt5-bridge-${bridgePort}-err.log" }
}
$services += @{ Name = 'NestJS API'; Port = 3201; Color = 'Cyan'; Log = "$env:TEMP\nest-api.log"; ErrLog = "$env:TEMP\nest-api-err.log" }
if (-not $SkipFrontend) {
    $services += @{ Name = 'Vite'; Port = 5173; Color = 'Green'; Log = "$env:TEMP\vite.log"; ErrLog = "$env:TEMP\vite-err.log" }
}

$allUp = $false
$down = @()
# MT5 bridges bind their LISTEN socket only AFTER connecting to the terminal
# (they call initialize() then start listening last — mt5_bridge_v2.py). On a
# cold terminal start the first init can fail with an IPC timeout and retry,
# which can exceed the old fixed 30s window and produce a false "didn't start".
# So we wait up to 90s, but after the first 30s we ONLY keep waiting while the
# remaining down services are MT5 bridges (grace). A non-bridge service that is
# still down after 30s is treated as a real failure and reported immediately.
$bridgeGraceStart = 15  # iterations (2s each) before bridge-only grace begins
for ($i = 1; $i -le 45; $i++) {
    Start-Sleep -Seconds 2
    $up = @()
    $down = @()
    foreach ($svc in $services) {
        $conn = Get-NetTCPConnection -LocalPort $svc.Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($conn) { $up += $svc } else { $down += $svc }
    }
    if ($down.Count -eq 0) { $allUp = $true; break }
    if ($i -ge $bridgeGraceStart) {
        $bridgeDown = @($down | Where-Object { $_.Name -like 'MT5 *' }).Count
        if ($bridgeDown -lt $down.Count) { break }  # non-bridge failure — stop waiting
    }
    $status = ($up | ForEach-Object { "$($_.Name) ✓" }) -join '  '
    $waiting = ($down | ForEach-Object { "$($_.Name) …" }) -join '  '
    Write-Host "    [$i] $status  $waiting" -ForegroundColor DarkGray
}

Write-Host ""
if ($allUp) {
    # "All services running" is NOT the same as "the pipeline is working". A bridge can
    # listen while refusing every request, and the API happily boots and records a refresh
    # cycle that fetched nothing (#765). So once the ports are up, confirm the bridges are
    # actually CONNECTED before claiming success — otherwise the message is a false green
    # over a system that will not place a trade.
    $degraded = @()
    foreach ($i in 0..($activeBrokers.Count - 1)) {
        $brokerId = $activeBrokers[$i]
        $bridgePort = 5000 + $i
        $brokerServer = $envVars["MT5_SERVER_$brokerId"] ?? '?'
        $ok = $false
        try {
            $h = Invoke-RestMethod "http://localhost:$bridgePort/health" -TimeoutSec 6 -ErrorAction Stop
            $ok = [bool]$h.connected
        } catch { $ok = $false }
        if (-not $ok) { $degraded += "MT5 #${brokerId} (${brokerServer}) port ${bridgePort}" }
    }

    if ($degraded.Count -eq 0) {
        Write-Host "  All services running and bridges connected" -ForegroundColor Green
    } else {
        Write-Host "  Services are LISTENING but the pipeline is NOT healthy" -ForegroundColor Yellow
        Write-Host "    Not connected to MT5: $($degraded -join ', ')" -ForegroundColor Yellow
        Write-Host "    Symbols on those bridges will fetch 0 candles and score nothing." -ForegroundColor Yellow
    }

    # A listening port is not proof of a WORKING service (#765). Measured: the API was
    # detected on 3201 during the wait loop and was gone moments later, with the launcher
    # still printing "All services running". So confirm /api/health actually answers.
    if (-not $SkipFrontend) {
        try {
            $health = Invoke-RestMethod "http://localhost:3201/api/health" -TimeoutSec 10 -ErrorAction Stop
            Write-Host "    API health: $($health.status)" -ForegroundColor DarkGray
        } catch {
            Write-Host "    ⚠️  Port 3201 is listening but /api/health did not answer." -ForegroundColor Yellow
            Write-Host "        The API process may have exited. Check: $env:TEMP\nest-api-err.log" -ForegroundColor Yellow
        }
    }

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
        $logHint = if ($svc.ErrLog) { "$($svc.ErrLog)  (stdout: $($svc.Log))" } else { $svc.Log }
        Write-Host "    $($svc.Name) on port $($svc.Port) — check $logHint" -ForegroundColor Red
    }
    # Show NestJS error log inline if it failed
    if ($down | Where-Object { $_.Name -eq 'NestJS API' }) {
        Write-Host "`n  ── NestJS error log (last 30 lines) ──" -ForegroundColor DarkGray
        Get-Content "$env:TEMP\nest-api-err.log" -Tail 30 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
        Write-Host "  ───────────────────────────────────" -ForegroundColor DarkGray
    }
}
Write-Host ""
