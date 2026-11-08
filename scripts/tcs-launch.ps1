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

# ── ⚠️ REFUSE WHILE A BUILD OWNS THE API (#1240) ────────────────────────────────────────────────
#
# This launcher KILLS whatever is on 3201/5000/5001/5173 before starting. Running it during a build
# therefore destroys the very API the build is about to health-check — so the build fails for a reason
# that has nothing to do with the code, and reports it as if it did.
#
# ⚠️ A STALE lock must NOT block a launch (a killed build would make the machine un-launchable). Only a
# holder whose pid is still running refuses.
$apiBuildLock = Join-Path $ROOT 'logs\build-api.lock'
if (Test-Path $apiBuildLock) {
    $apiBuildHolder = $null
    try { $apiBuildHolder = Get-Content $apiBuildLock -Raw | ConvertFrom-Json } catch { $apiBuildHolder = $null }
    if ($apiBuildHolder -and $apiBuildHolder.pid -and (Get-Process -Id ([int]$apiBuildHolder.pid) -ErrorAction SilentlyContinue)) {
        Write-Host "`n   REFUSING TO LAUNCH: a build holds the API lock (pid $($apiBuildHolder.pid))." -ForegroundColor Red
        Write-Host "   This launcher kills what is on 3201, which is the API that build is about to health-check." -ForegroundColor Red
        Write-Host "   Wait for it to finish (a build is ~40 s), then run this again." -ForegroundColor Yellow
        exit 1
    }
    if ($apiBuildHolder) {
        Write-Host "   Note: a STALE API lock (pid $($apiBuildHolder.pid), not running) is present — ignoring it." -ForegroundColor DarkGray
    }
}

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

# ── KILL STALE FRONTEND / API BY IDENTITY (2026-11-03) ────────────────────────────────────────
# ⚠️ MEASURED: a Vite started 2026-11-02 12:51 was still serving port 5173 **34 hours later**,
# across many launches. The port-based kill below could not see it: `netstat -ano` and
# `Get-NetTCPConnection -State Listen` BOTH returned no LISTENING row for 5173 even though
# connections were ESTABLISHED on `[::1]:5173` and a new Vite failed with
# `Error: Port 5173 is already in use` (which `--strictPort` turns into an immediate exit). So the
# frontend never restarted and every launch served yesterday's build, while the launcher's poll saw
# a healthy port and said nothing.
#
# Same remedy the bridges already use: kill by process identity, not by who currently holds the
# socket. Restricted to `node.exe` with `vite` in the command line so an unrelated terminal that
# merely mentions the word is not touched.
$zombieFrontends = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        $_.Name -eq 'node.exe' -and $_.CommandLine -match 'vite'
    })
foreach ($vp in $zombieFrontends) {
    try { Stop-Process -Id $vp.ProcessId -Force -ErrorAction Stop } catch {}
    $null = cmd /c "taskkill /F /PID $($vp.ProcessId) 2>nul"
}
if ($zombieFrontends.Count -gt 0) {
    Write-Host "    Killed $($zombieFrontends.Count) stale Vite process(es) by identity" -ForegroundColor DarkGray
}

# The API can strand the same way: a `node dist/src/main.js` that the port probe cannot see keeps
# serving an OLD build, and the version check then reports the previous version.
$zombieApis = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        $_.Name -eq 'node.exe' -and $_.CommandLine -match 'dist[/\\]src[/\\]main\.js'
    })
foreach ($ap in $zombieApis) {
    try { Stop-Process -Id $ap.ProcessId -Force -ErrorAction Stop } catch {}
    $null = cmd /c "taskkill /F /PID $($ap.ProcessId) 2>nul"
}
if ($zombieApis.Count -gt 0) {
    Write-Host "    Killed $($zombieApis.Count) stale API process(es) by identity" -ForegroundColor DarkGray
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
    # ⚠️ UNBUFFERED PYTHON (2026-11-03). When stdout is a FILE, Python block-buffers it, so
    # `console-mt5-5000.log` held a single line from the previous day while the -err log had today's
    # entries. The reader is then sent to a "stdout" file that looks like a process that never
    # started. This env var is inherited by the supervisor AND the bridge it spawns, which is why it
    # is set here rather than passed as `-u` to the supervisor only.
    $env:PYTHONUNBUFFERED = '1'
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
# The value comes from `nest/.env` (already parsed into $envVars above), never a literal (#1252).
$env:DATABASE_URL = $envVars['DATABASE_URL']
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
# ── PORT PROBE (2026-11-03) ────────────────────────────────────────────────────────────────────
# ⚠️ This replaced `Get-NetTCPConnection -State Listen` inside the wait loop. That cmdlet is a WMI
# query: under the load of four calls every 2 s while the API boots it intermittently returns
# nothing, and the caller cannot tell "no socket" from "query failed". Measured on a real launch:
# both bridges reported "ready after 18s/10s — connected to terminal" and then alternated ✓/… in
# every poll, which reads as a service that keeps dying. A direct TCP connect answers the question
# that is actually being asked — does something accept a connection on this port — and fails only
# when nothing does.
# ⚠️ A LAUNCHED PID IS OFTEN NOT THE PROCESS THAT SERVES THE PORT (2026-11-03).
# Vite is started as `cmd /c npx vite ...`, so the PID we hold is `cmd`, which exits while the real
# server runs several levels down (cmd → npx → node → vite). The bridges are the same shape since
# #866 (supervisor → bridge). A bare `Get-Process -Id $expected` therefore reports "our process has
# exited — an older service is serving it" over a healthy Vite. Measured: that exact false accusation
# appeared on a clean launch. So walk the descendant tree one CIM query at a time.
function Test-ProcessTreeAlive {
    param([int]$RootPid, [int]$MaxDepth = 6)
    $all = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Select-Object ProcessId, ParentProcessId)
    if ($all.Count -eq 0) { return $null }   # cannot judge — never a "yes"
    $alive = @{}
    $children = @{}
    foreach ($proc in $all) {
        $procId = [int]$proc.ProcessId
        $alive[$procId] = $true
        $parent = [int]$proc.ParentProcessId
        if (-not $children.ContainsKey($parent)) { $children[$parent] = @() }
        $children[$parent] += $procId
    }
    if ($alive.ContainsKey($RootPid)) { return $true }
    $level = @($RootPid)
    for ($depth = 0; $depth -lt $MaxDepth; $depth++) {
        $next = @()
        foreach ($node in $level) { if ($children.ContainsKey($node)) { $next += $children[$node] } }
        if ($next.Count -eq 0) { break }
        foreach ($node in $next) { if ($alive.ContainsKey($node)) { return $true } }
        $level = $next
    }
    return $false
}
function Test-PortListening {
    param([int]$Port, [int]$TimeoutMs = 700)
    # ⚠️ BOTH ADDRESS FAMILIES (2026-11-03). Vite binds `[::1]:5173` — IPv6 loopback — and there is
    # NO `127.0.0.1:5173 ... LISTENING` row at all (measured). A probe that only tries IPv4 therefore
    # reports Vite as DOWN while it is serving the app, and which family gets used can change from
    # launch to launch — an intermittent false "didn't start" that depends on nothing the reader can
    # see. Try IPv4 first, then IPv6.
    foreach ($addr in @('127.0.0.1', '::1')) {
        $client = New-Object System.Net.Sockets.TcpClient
        try {
            $task = $client.ConnectAsync($addr, $Port)
            if ($task.Wait($TimeoutMs) -and $client.Connected) { return $true }
        } catch {
            # try the next address family
        } finally { $client.Dispose() }
    }
    return $false
}
# MT5 bridges bind their LISTEN socket only AFTER connecting to the terminal
# (they call initialize() then start listening last — mt5_bridge_v2.py). On a
# cold terminal start the first init can fail with an IPC timeout and retry,
# which can exceed the old fixed 30s window and produce a false "didn't start".
# So the wait window is generous rather than fixed at 30s.
# ⚠️ 2026-11-04 — THE NON-BRIDGE CUT-OFF WAS THE FALSE-FAILURE THE OWNER KEPT SEEING.
# This loop used to stop waiting after 30s whenever a NON-bridge service was still down, and that
# is what produced a window reading "Some services didn't start" while the API was booting, the
# bridges were connected and the app then worked. MEASURED on this machine AT THE TIME: the API
# printed its bootstrap header and then did not answer for ~107 SECONDS, because its module init
# hooks (directive seed, 51 protocol readiness passes, first scoring pass) were AWAITED in front of
# `listen()` — so at 30s it was never listening, and the old rule broke out at exactly the wrong
# moment.
#
# ⚠️ CORRECTED 2026-11-07 — the mechanism has since changed and this note used to describe it as
# still current. The two ProtocolHealthService audits are now fire-and-forget in the compiled code
# (`void this.runBootDiagnostics()`), so nothing gates `listen()` on them: the port answers in
# **5–19.6 s** (six boots) and the audit runs ON AFTERWARDS for 86.6 s measured to completion. So a
# 30s cut-off would usually be enough TODAY — but the cut-off below is still the right shape, for a
# reason that does not depend on the boot time at all: 30s is a guess about a duration, and "is the
# process alive" is a fact. A slow disk, a cold database or a future awaited hook re-breaks a fixed
# number and says nothing about why. Do not lower it back to a count of seconds.
#
# The port is a PROXY for readiness. The process being alive is the fact that distinguishes
# "still booting" from "died", so that is what the cut-off now tests:
#   • non-bridge service whose process tree has EXITED  → real failure, stop immediately
#   • non-bridge service alive but not listening yet    → keep waiting, say so
#   • bridge down                                       → unchanged grace (they retry to 90s)
# The ceiling stays at 180s: it is a hang detector, not an estimate of boot time, and a service
# whose process died is still reported within seconds — which is the case the short window was
# actually protecting.
$bridgeGraceStart = 15  # iterations (2s each) before bridge-only grace begins
for ($i = 1; $i -le 90; $i++) {
    Start-Sleep -Seconds 2
    $up = @()
    $down = @()
    foreach ($svc in $services) {
        if (Test-PortListening -Port $svc.Port) { $up += $svc } else { $down += $svc }
    }
    if ($down.Count -eq 0) { $allUp = $true; break }
    if ($i -ge $bridgeGraceStart) {
        $dead = @()
        foreach ($svc in $down) {
            if ($svc.Name -like 'MT5 *') { continue }
            $svcPid = $startedPids[$svc.Port]
            # `Test-ProcessTreeAlive` returns $null when the process table cannot be read. Unknown
            # is NOT dead — treating it as death would restore the false failure through the back
            # door, and it would name a service that is booting perfectly well.
            if ($svcPid -and (Test-ProcessTreeAlive -RootPid $svcPid) -eq $false) { $dead += $svc }
        }
        if ($dead.Count -gt 0) { break }  # its process EXITED — that is a real failure
    }
    $status = ($up | ForEach-Object { "$($_.Name) ✓" }) -join '  '
    $waiting = ($down | ForEach-Object { "$($_.Name) …" }) -join '  '
    Write-Host "    [$i] $status  $waiting" -ForegroundColor DarkGray
    if ($i -eq 20) {
        Write-Host '         (the API blocks in app.listen() for ~90s on a cold start while it seeds' -ForegroundColor DarkGray
        Write-Host '          directives and scores its first pass — still booting, not failed)' -ForegroundColor DarkGray
    }
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
    # ⚠️ "IS IT OUR PROCESS?" WITHOUT ASKING WHO OWNS THE PORT (2026-11-03).
    # This used `Get-NetTCPConnection` for the owning PID, then `netstat -ano`. Both are unreliable
    # here and BOTH produced false accusations on a healthy launch: the cmdlet returned nothing for
    # all four ports (WMI, flaky under load), and netstat reported PID `0` for the bridges and no
    # LISTENING row at all for 3201/5173 (Vite binds `[::1]`, and a bridged listener can show PID 0
    # when the mapping is unavailable). Measured: a red
    #   "Services are LISTENING, but NOT under the processes this launcher started"
    # printed over a stack where every port served and /api/health was ok.
    #
    # The question actually worth asking is simpler and needs no port→PID mapping: is the process WE
    # started still alive? Port reachability is already proven above. So an impostor is exactly
    # "the port answers, but our process has exited" — which is the #1026 case, and nothing else.
    $impostors = @()
    foreach ($port in $startedPids.Keys) {
        $expected = $startedPids[$port]
        if (-not $expected) { continue }
        $treeAlive = Test-ProcessTreeAlive -RootPid $expected
        if ($treeAlive -eq $true) { continue }
        if ($treeAlive -eq $null) {
            Write-Host "    (could not read the process table — ownership of port $port not verified)" -ForegroundColor DarkGray
            continue
        }
        if (Test-PortListening -Port $port) {
            $impostors += "port $port answers, but the process we started (PID $expected) and all its children have exited — an older service is serving it"
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
    # ⚠️ RE-CHECK BEFORE BLAMING (2026-11-03). The wait loop stops early for a NON-bridge reason (a
    # slow API or Vite) and then reported EVERY still-down service — bridges included — as "didn't
    # start". That is what the owner saw: a window full of "didn't start … check
    # console-mt5-5000-err.log" naming two bridges that were listening and connected to live
    # accounts. The file it pointed at held entries from eleven hours earlier, so it read as a
    # crash. Now a service is only called failed if nothing accepts a connection NOW, and a bridge
    # that is up but not connected says exactly that, with the remedy.
    $stillDown = @()
    foreach ($svc in $down) {
        if (-not (Test-PortListening -Port $svc.Port)) { $stillDown += $svc; continue }
        if ($svc.Name -like 'MT5 *') {
            $conn = $null; $acct = $null
            try {
                $h = Invoke-RestMethod "http://localhost:$($svc.Port)/health" -TimeoutSec 6 -ErrorAction Stop
                $conn = [bool]$h.connected; $acct = $h.account
            } catch { $conn = $null }
            if ($conn -eq $false) {
                Write-Host "    $($svc.Name) port $($svc.Port) is LISTENING but NOT connected to MT5" -ForegroundColor Yellow
                Write-Host "      Remedy: POST http://127.0.0.1:$($svc.Port)/reconnect" -ForegroundColor Yellow
            } else {
                $suffix = if ($acct) { " — account $acct" } else { '' }
                Write-Host "    $($svc.Name) port $($svc.Port) is up and connected (slow to satisfy the poll, not failed)$suffix" -ForegroundColor DarkGray
            }
        } else {
            Write-Host "    $($svc.Name) port $($svc.Port) came up after the wait window" -ForegroundColor DarkGray
        }
    }
    if ($stillDown.Count -gt 0) {
        Write-Host "  Some services didn't start (nothing accepts a connection on the port):" -ForegroundColor Red
        foreach ($svc in $stillDown) {
            $logHint = if ($svc.ErrLog) { "$($svc.ErrLog)  (stdout: $($svc.Log))" } else { $svc.Log }
            Write-Host "    $($svc.Name) on port $($svc.Port) — check $logHint" -ForegroundColor Red
        }
    }
    # Show NestJS error log inline if it failed
    if ($stillDown | Where-Object { $_.Name -eq 'NestJS API' }) {
        Write-Host "`n  ── NestJS error log (last 30 lines) ──" -ForegroundColor DarkGray
        Get-Content $nestErr -Tail 30 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
        Write-Host "  ───────────────────────────────────" -ForegroundColor DarkGray
    }
}

# ── EXIT CODE (2026-11-03) ────────────────────────────────────────────────────────────────────
# ⚠️ This script used to ALWAYS exit 0: the only `exit 1` was an early guard, so a run that ended
# with "Some services didn't start" still returned success. The desktop .bat that wraps it then
# printed "All services should be online now" and opened the app on top of a failed startup. A
# caller cannot report the truth if it is told everything is fine.
#
# Re-probed here rather than threading a flag through the branches above: this uses the same
# predicate they use (a port that accepts a connection, and a bridge that says connected), so it
# cannot contradict what was just printed.
$exitOk = $true
$exitReasons = @()
foreach ($svc in $services) {
    if (-not (Test-PortListening -Port $svc.Port)) {
        $exitOk = $false
        $exitReasons += "$($svc.Name) is not accepting a connection on port $($svc.Port)"
    }
}
# A listening bridge is not a WORKING bridge (#765): confirm the terminal link itself.
for ($i = 0; $i -lt $activeBrokers.Count; $i++) {
    $bridgePort = 5000 + $i
    $brokerId = $activeBrokers[$i]
    try {
        $h = Invoke-RestMethod "http://localhost:$bridgePort/health" -TimeoutSec 6 -ErrorAction Stop
        if (-not [bool]$h.connected) {
            $exitOk = $false
            $exitReasons += "MT5 #$brokerId (:${bridgePort}) is listening but NOT connected to its terminal"
        }
    } catch {
        $exitOk = $false
        $exitReasons += "MT5 #$brokerId (:${bridgePort}) did not answer /health"
    }
}
if (-not $SkipFrontend) {
    try { Invoke-RestMethod "http://localhost:3201/api/health" -TimeoutSec 10 -ErrorAction Stop | Out-Null }
    catch {
        $exitOk = $false
        $exitReasons += 'the API port answers but /api/health did not'
    }
}

Write-Host ""
if ($exitOk) { exit 0 }
Write-Host "  EXIT 1 — startup incomplete:" -ForegroundColor Red
foreach ($r in $exitReasons) { Write-Host "    $r" -ForegroundColor Red }
exit 1
