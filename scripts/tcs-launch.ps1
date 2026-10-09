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

# ── Where console output goes (#1023) ───────────────────────
#
# ⚠️ ONE DIRECTORY FOR ALL PROCESS OUTPUT. Measured 2026-09-29: the API's console capture was
# written to `%TEMP%\nest-api.log` by THIS script and to `logs\api-out.log` by `build-api.ps1`,
# so which file was live depended on which launcher ran last — and `api-out.log` existed in THREE
# directories at once (470 KB in `logs\`, 225 KB in `nest\`, 1.2 MB in `nest\logs\`). Tailing the
# wrong one shows a stale file and reads as "the API is silent", a false negative with no error.
#
# So everything lands next to the app's own structured log (`nest\logs\tcs-<date>.log`), and the
# LAUNCHER is named in the file, not implied by the directory. "Where is the log?" now has one
# answer: `GET /api/system/logs/files` lists them all, because they are all in one place.
#
# `nest\logs\` is gitignored — correct for raw console capture, which is not repository material.
$LOG_DIR = Join-Path $ROOT 'nest\logs'
if (-not (Test-Path $LOG_DIR)) { New-Item -ItemType Directory -Path $LOG_DIR -Force | Out-Null }

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
# #866 — bridges are STARTED via the supervisor, which relaunches them if they die (including
# the wedge exit, code 75). tcs-stop writes the stop-sentinel this supervisor obeys.
$supervisorScript = "$ROOT\scripts\mt5-bridge\bridge_supervisor.py"
$bridgeCwd = Split-Path $bridgeScript -Parent

# A launch clears any previous stop-sentinel — its presence means "tcs-stop ran", which
# must not suppress a bridge that is being deliberately started NOW.
$stopSentinelDir = Join-Path $ROOT 'logs\mt5-bridge'
New-Item -ItemType Directory -Path $stopSentinelDir -Force | Out-Null
Get-ChildItem -Path $stopSentinelDir -Filter 'supervisor-*.stop' -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue

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
    Where-Object { $_.CommandLine -like '*mt5_bridge_v2.py*' -or $_.CommandLine -like '*bridge_supervisor.py*' }
foreach ($bp in $zombieBridges) {
    try { Stop-Process -Id $bp.ProcessId -Force -ErrorAction Stop } catch {}
    $null = cmd /c "taskkill /F /PID $($bp.ProcessId) 2>nul"
}
if ($zombieBridges) {
    Write-Host "    Killed $($zombieBridges.Count) MT5 bridge process(es) by identity" -ForegroundColor DarkGray
}

@(3201) + $bridgePorts + @(5173, 5174) | ForEach-Object {
    # ⚠️ `-State Listen` IS REQUIRED. Measured 2026-09-29 (#1023): without it this loop killed
    # whatever process owned the FIRST connection the cmdlet happened to return — a TIME_WAIT or
    # established socket, not the server — so the real listener survived. The launcher then started a
    # new API that could not bind, that one died, and **the launcher still printed "All services
    # running"** because its verification tests the PORT, not the process it started. The old API
    # kept serving and `GET /api/version` reported the previous version while the launch looked
    # clean. Only the LISTEN socket identifies the server.
    $conn = Get-NetTCPConnection -LocalPort $_ -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
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
    # ⚠️ NO `cmd /c start` HERE — it opened a console WINDOW, once per bridge, every launch.
    #
    # The line used to be:
    #     Start-Process -FilePath "cmd" -ArgumentList "/c start `"MT5 Bridge $brokerId`" /min ..."
    #
    # WHY THAT SHOWED A WINDOW. `start` ALWAYS creates a new console; it has no quiet form except
    # `/B`, which was not used. `-WindowStyle Hidden` on the OUTER `cmd` cannot hide a window the
    # INNER `start` creates — it only hides the outer cmd, which had no window to begin with.
    # `/min` merely minimised it. Net effect: two empty, minimised console windows per launch
    # (one per bridge), on every relaunch, which is what "terminals keep opening and they never
    # contain anything" was.
    #
    # WHY REMOVING `start` IS SAFE. Its whole purpose was to give the bridge its own console so
    # it outlives the launcher and never receives its CTRL_C_EVENT. `-WindowStyle Hidden` already
    # does exactly that — the same reasoning the API block below records ("already gives the child
    # its own console and detaches it from our signal group"). So `start` was redundant AND was
    # the window. This is now the plain form, identical in shape to the API and Vite launches.
    #
    # ⚠️ It also fixes the redirects. With `start`, the `> log 2> err` applied to the *detaching*
    # `start` command, so the child's output was never captured and the TEMP bridge logs stayed
    # empty. `-RedirectStandardOutput/-Error` redirect the actual process.
    $bridgeLog = Join-Path $LOG_DIR "console-mt5-${bridgePort}.log"
    $bridgeErr = Join-Path $LOG_DIR "console-mt5-${bridgePort}-err.log"
    # #866 — the SUPERVISOR is launched; it spawns the bridge and relaunches it on death.
    $bridgeArgs = "`"$supervisorScript`""
    $started = Start-Process -FilePath $pythonPath `
        -ArgumentList $bridgeArgs `
        -WorkingDirectory $bridgeCwd `
        -PassThru -WindowStyle Hidden `
        -RedirectStandardOutput $bridgeLog `
        -RedirectStandardError $bridgeErr
    $mt5Pids += $started.Id
    Write-Host "    launcher PID $($started.Id) (detached supervisor; bridge on port ${bridgePort})" -ForegroundColor DarkGray
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
            } catch {
                # ⚠️ This was `/* not up yet */` — a JavaScript comment. PowerShell cannot parse it:
                # it tried to run `/*` as a COMMAND, so the catch threw instead of swallowing the
                # expected failure, and the health-check loop reported a parse error on every retry.
                # A comment here must use `#`. The catch is deliberately empty: not being up yet is
                # the normal case on the first passes, and the loop retries.
            }
        }
    }
    $bridgeReady[$bridgePort] = $ready
    if (-not $ready) {
        Write-Host "    ⚠️  MT5 #${brokerId} (${brokerServer}) did NOT report connected within 90s" -ForegroundColor Yellow
        Write-Host "        Starting the API anyway — but its first refresh will fetch nothing." -ForegroundColor Yellow
        Write-Host "        Check: $LOG_DIR\console-mt5-${bridgePort}-err.log" -ForegroundColor DarkGray
    }
}

# ── Start NestJS API ────────────────────────────────────────

Write-Host "  Starting NestJS API (port 3201)…" -ForegroundColor Cyan
$env:DATABASE_URL = 'mysql://tradingcs:tradingcs_dev_2026@localhost:3306/tradingcs'
$nestLog = Join-Path $LOG_DIR 'console-api.log'
$nestErr = Join-Path $LOG_DIR 'console-api-err.log'
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
        -RedirectStandardOutput (Join-Path $LOG_DIR 'console-vite.log') `
        -RedirectStandardError (Join-Path $LOG_DIR 'console-vite-err.log')
    Write-Host "    PID $($vite.Id) (detached; Vite on port 5173)" -ForegroundColor DarkGray
}

# ⚠️ THE PIDs WE STARTED, SO THE VERIFICATION CAN PROVE *OUR* PROCESS HOLDS THE PORT (#1026).
# Measured 2026-09-29: this script printed "All services running and bridges connected" while the
# API answering on 3201 was the PREVIOUS process — the one the launcher had just started never
# bound the port and exited, and every check still passed because each one tests the PORT, not the
# process. `GET /api/version` then served the OLD version under a clean-looking launch.
#
# This is the same defect the file already records twice for #765. The list below is what turns
# "something is listening" into "the thing I started is listening".
$startedPids = @{ 3201 = $nest.Id }
if (-not $SkipFrontend) { $startedPids[5173] = $vite.Id }
for ($i = 0; $i -lt $activeBrokers.Count; $i++) {
    if ($i -lt $mt5Pids.Count) { $startedPids[5000 + $i] = $mt5Pids[$i] }
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
    # console-mt5-<port>.log in $LOG_DIR, NOT a constructed '<Name>.log' under TEMP.
    $services += @{ Name = "MT5 #${brokerId} (${brokerServer})"; Port = $bridgePort; Color = 'Yellow'; Log = (Join-Path $LOG_DIR "console-mt5-${bridgePort}.log"); ErrLog = (Join-Path $LOG_DIR "console-mt5-${bridgePort}-err.log") }
}
$services += @{ Name = 'NestJS API'; Port = 3201; Color = 'Cyan'; Log = $nestLog; ErrLog = $nestErr }
if (-not $SkipFrontend) {
    $services += @{ Name = 'Vite'; Port = 5173; Color = 'Green'; Log = (Join-Path $LOG_DIR 'console-vite.log'); ErrLog = (Join-Path $LOG_DIR 'console-vite-err.log') }
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

    # ⚠️ #1026 — AND IS IT *OUR* PROCESS? Everything below proves something is listening and
    # answering. None of it proves the process we started owns the port. An old API that survived
    # the kill loop answers `/api/health` perfectly well, so the launcher reports success while the
    # OLD build serves the port — and a version bump then appears not to have taken effect.
    #
    # ⚠️ COMPUTED BEFORE THE SUCCESS MESSAGE, not after. Printing "All services running" and then
    # qualifying it two lines later is the defect rather than a caveat on it: the green line is what
    # a reader takes away, and a contradiction underneath reads as noise.
    $impostors = @()
    foreach ($port in $startedPids.Keys) {
        $expected = $startedPids[$port]
        $owner = (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
            Select-Object -First 1).OwningProcess
        if ($owner -and $expected -and $owner -ne $expected) {
            # ⚠️ #866 — the BRIDGE ports are owned by a GRANDCHILD now. This launcher starts
            # `bridge_supervisor.py` (that pid is in $startedPids) and the supervisor starts the
            # bridge, so the LISTEN owner is the supervisor's child. One parent lookup settles it —
            # and only when the expected pid did not match directly, so the check still catches a
            # genuinely stale process answering the port (#1026).
            $parent = (Get-CimInstance Win32_Process -Filter "ProcessId=$owner" -ErrorAction SilentlyContinue).ParentProcessId
            if ($parent -ne $expected) {
                $impostors += "port $port is owned by PID $owner, but we started PID $expected"
            }
        } elseif (-not $owner -and $expected) {
            $impostors += "port $port has no LISTEN owner, but we started PID $expected"
        }
    }

    if ($degraded.Count -eq 0 -and $impostors.Count -eq 0) {
        Write-Host "  All services running and bridges connected" -ForegroundColor Green
    } elseif ($impostors.Count -gt 0) {
        # A stale process outranks a degraded bridge: the reader needs to know the running build is
        # not the one they just made, because every other measurement they take is then suspect.
        Write-Host "  Services are LISTENING, but NOT under the processes this launcher started" -ForegroundColor Red
        foreach ($im in $impostors) { Write-Host "    $im" -ForegroundColor Red }
        Write-Host "    An older service is serving the port. Stop the stack and launch again:" -ForegroundColor Yellow
        Write-Host "      pwsh -File scripts\tcs-stop.ps1" -ForegroundColor Yellow
        Write-Host "    Until then, the running build is NOT the one you just made." -ForegroundColor Yellow
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
            Write-Host "        The API process may have exited. Check: $nestErr" -ForegroundColor Yellow
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
        Get-Content $nestErr -Tail 30 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
        Write-Host "  ───────────────────────────────────" -ForegroundColor DarkGray
    }
}
Write-Host ""
