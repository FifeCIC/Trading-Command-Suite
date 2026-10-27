# build-api.ps1 — build the NestJS API safely, with the service stopped
#
# WHY THIS EXISTS
# ---------------
# `npm run build` inside `nest/` runs `prebuild`, which runs `prisma generate`.
# That step REPLACES `node_modules/.prisma/client/query_engine-windows.dll.node` by
# renaming a temp file over it. Windows does not allow renaming over a loaded DLL.
#
# The NestJS API loads the query engine at startup and holds it for its whole
# lifetime, so `npm run build` with the API running fails with:
#
#   EPERM: operation not permitted, rename '...tmp30880' -> '...query_engine-windows.dll.node'
#
# which names a temp file and says nothing about the API. Three separate sessions
# lost time to this before it was diagnosed. `build-preflight.cjs` now blocks with a
# clear message, and THIS script is the one-command answer to that message.
#
# WHAT IT DOES
# ------------
#   1. Stops ONLY the API on port 3201 — not the MT5 bridges, not Vite. Those are
#      independent and stopping them would needlessly interrupt market data and the
#      UI while a TypeScript build runs.
#   2. Filters the stop to node processes actually running THIS repo, so an unrelated
#      listener on 3201 is reported rather than blind-killed.
#   3. Runs the build.
#   4. Restarts the API only if the build SUCCEEDED. On failure the API stays down —
#      deliberately: restarting into a broken build would hide the failure and leave
#      the app serving stale code, which is worse than an obvious outage.
#
# USAGE
# -----
#   npm run build:api            # from nest/
#   pwsh -File scripts/build-api.ps1
#
#   -SkipRestart   build and leave the API down (e.g. before a manual launch)
#   -SelfTest      exercise ONLY the restart-verification path against a dead port and exit 1
#                  (canary for the "restart failed" reporting — see #933)
#
# ⚠️ RESTART-VERIFICATION CONTRACT (#933, 2026-09-23)
# ---------------------------------------------------
# This script previously ended a failed restart with:
#
#   !!  API did not report healthy within 30s - check the start log
#
# ...and exit 1, while the port was closed. The message reads as "slow", the exit code was
# the only signal, and several agents (twice on 2026-09-22/23 alone) were left believing the
# API was merely warming up while it was in fact DOWN. The contract now is:
#
#   1. The start is `node dist/src/main.js` (the fast, documented form), with stdout/stderr
#      redirected to nest\logs\console-build-api.log and -err.log so "the start log" has a
#      location. ⚠️ ONE directory for console capture (#1023): this file used to write
#      logs\api-out.log while tcs-launch.ps1 wrote %TEMP%\nest-api.log, so which file was live
#      depended on which launcher ran last and the wrong one read as "the API is silent".
#   2. Verification answers a REAL request — GET /api/version — not just a socket check.
#   3. On failure the script says **API IS DOWN** and distinguishes the three states it can
#      actually observe: process exited / nothing listening / listening but not answering.
#   4. It exits NON-ZERO with the last error lines printed. It never returns success with the
#      port closed.

param(
    [switch]$SkipRestart,
    [switch]$Quick,
    [switch]$SelfTest,
    [switch]$LockSelfTest
    )

$ErrorActionPreference = 'Continue'
$repoRoot = Split-Path -Parent $PSScriptRoot
$nestDir  = Join-Path $repoRoot 'nest'

function Write-Step($msg) { Write-Host "`n== $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "   OK  $msg" -ForegroundColor Green }
function Write-Warn2($msg){ Write-Host "   !!  $msg" -ForegroundColor Yellow }

<#
  Assert-ApiUp — the post-restart verification, extracted so the failure path can be canaried
  without breaking a real start (-SelfTest points it at a dead port).
  Returns $true only when /api/version answers 200 within the budget.
#>
function Assert-ApiUp([int]$Port = 3201, [int]$TimeoutSeconds = 60, [System.Diagnostics.Process]$Proc = $null) {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $listening = $false
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 1
        $listening = [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
        try {
            $r = Invoke-WebRequest -Uri "http://localhost:$Port/api/version" -UseBasicParsing -TimeoutSec 3
            if ($r.StatusCode -eq 200) { return $true }
        } catch { }
        if ($Proc -and $Proc.HasExited) { break }   # crashed — no point waiting the full budget
    }

    # ── The DOWN report: state what is OBSERVED, not what is hoped ──
    Write-Host "`n   API IS DOWN on port $Port." -ForegroundColor Red
    if ($Proc -and $Proc.HasExited) {
        Write-Host "   The API process exited immediately (exit code $($Proc.ExitCode))." -ForegroundColor Red
    } elseif (-not $listening) {
        Write-Host "   Nothing is listening on $Port after ${TimeoutSeconds}s — the process did not bind the port." -ForegroundColor Red
    } else {
        Write-Host "   $Port IS listening but /api/version did not answer — the API is not serving." -ForegroundColor Red
    }
    $errLog = Join-Path $repoRoot 'nest\logs\console-build-api-err.log'
    $outLog = Join-Path $repoRoot 'nest\logs\console-build-api.log'
    Write-Host "   Logs: $outLog  |  $errLog" -ForegroundColor Yellow
    foreach ($log in @($errLog, $outLog)) {
        if (Test-Path $log) {
            Write-Host "   Last lines of $(Split-Path $log -Leaf):" -ForegroundColor Yellow
            Get-Content $log -Tail 5 | ForEach-Object { Write-Host "     $_" -ForegroundColor DarkGray }
        }
    }
    Write-Host "`n   Start it manually when ready:  node dist/src/main.js  (from $nestDir)" -ForegroundColor Yellow
    return $false
}

if ($SelfTest) {
    # Canary for the restart-failure reporting. Uses a port nothing can be listening on, so the
    # check is deterministic whether or not the real API is up: the guard MUST find it DOWN,
    # print the DOWN block, and the script MUST exit non-zero. If /api/version somehow answers
    # on the test port, the self-test refuses to report (SELFTEST INVALID, exit 2) rather than
    # claiming a pass it did not establish.
    Write-Step 'SELFTEST — verifying the restart-failure path reports DOWN (port 39991)'
    $up = Assert-ApiUp -Port 39991 -TimeoutSeconds 3
    if ($up) {
        Write-Host '   SELFTEST INVALID — something answered on the test port; no pass can be claimed.' -ForegroundColor Red
        exit 2
    }
    Write-Ok 'SELFTEST PASSED — the failure path reports API IS DOWN and exits non-zero.'
    exit 1
}

# ---------------------------------------------------------------------------------
# THE BUILD LOCK (#767 build-side). One build at a time, or deploys fail for everyone.
#
# OBSERVED 2026-10-09: two agents launched `build:api` within seconds of each other — TWICE
# (19:11Z and 19:14Z). Both runs stop the API and race `rimraf dist` + `prisma generate`
# in the same working tree. First race: both builds died; API left down. Second race: one
# generate hit EPERM on the query engine held by the other run while the winner restarted
# the API into the loser's build — and the loser's `rimraf` had ALREADY deleted dist, so
# for a window the repo had no launchable build at all.
#
# The lock is a file carrying the holder's PID. A LIVE holder refuses new runs; a STALE one
# (holder gone) is taken over with a note — so a killed build can never wedge the tool.
# Canary: -LockSelfTest (both directions, fabricated states, no build, API untouched).
# ---------------------------------------------------------------------------------
$script:buildLockPath = Join-Path $repoRoot 'logs\build-api.lock'

function Enter-BuildLock {
    <# $true when the lock was acquired; $false while a LIVE holder exists. #>
    $existing = $null
    if (Test-Path $script:buildLockPath) {
        try { $existing = Get-Content $script:buildLockPath -Raw | ConvertFrom-Json } catch { $existing = $null }
    }
    if ($existing -and $existing.pid) {
        $holder = Get-Process -Id ([int]$existing.pid) -ErrorAction SilentlyContinue
        if ($holder) { return $false }
        Write-Warn2 "Stale build lock (PID $($existing.pid), started $($existing.startedUtc)) — holder is gone; taking over."
        Remove-Item $script:buildLockPath -ErrorAction SilentlyContinue
    }
    @{ pid = $PID; startedUtc = [DateTime]::UtcNow.ToString('o'); cmd = 'build:api' } |
        ConvertTo-Json -Compress | Set-Content -Path $script:buildLockPath -Encoding utf8
    return $true
}

function Release-BuildLock {
    if ($script:buildLockPath -and (Test-Path $script:buildLockPath)) {
        Remove-Item $script:buildLockPath -ErrorAction SilentlyContinue
    }
}

if ($LockSelfTest) {
    # Both directions, fabricated states — no build runs, the API is never touched.
    Write-Step 'LOCK SELFTEST — refuse a LIVE holder, take over a DEAD one'
    if (Test-Path $script:buildLockPath) {
        Write-Host '   LOCK SELFTEST INVALID — a real lock exists; refusing to interfere.' -ForegroundColor Red
        exit 2
    }
    $passed = $true
    @{ pid = $PID; startedUtc = 'selftest'; cmd = 'selftest' } | ConvertTo-Json -Compress | Set-Content -Path $script:buildLockPath -Encoding utf8
    if (Enter-BuildLock) {
        Write-Host '   FAIL — acquired a lock while a LIVE holder existed.' -ForegroundColor Red
        $passed = $false
    } else {
        Write-Host '   OK  refused a LIVE holder.' -ForegroundColor Green
    }
    if ($passed) {
        @{ pid = 999999; startedUtc = 'selftest-dead'; cmd = 'selftest' } | ConvertTo-Json -Compress | Set-Content -Path $script:buildLockPath -Encoding utf8
        if (Enter-BuildLock) {
            Write-Host '   OK  took over a STALE lock.' -ForegroundColor Green
        } else {
            Write-Host '   FAIL — refused a DEAD holder; a killed build would wedge the tool.' -ForegroundColor Red
            $passed = $false
        }
    }
    Release-BuildLock
    if ($passed) {
        Write-Ok 'LOCK SELFTEST PASSED — refusal and takeover both behave.'
        exit 0
    }
    Write-Host '   LOCK SELFTEST FAILED.' -ForegroundColor Red
    exit 1
}

# ── 0. One build at a time (#767 build-side; observed twice on 2026-10-09) ────────
if (-not (Enter-BuildLock)) {
    $holder = $null
    try { $holder = Get-Content $script:buildLockPath -Raw | ConvertFrom-Json } catch { }
    Write-Warn2 "Another build:api is RUNNING (PID $($holder.pid), started $($holder.startedUtc))."
    Write-Warn2 'Refusing — two concurrent runs stop each other''s API and race rimraf/prisma over the same tree.'
    Write-Warn2 "Wait for it to finish (health on :3201), or delete $($script:buildLockPath) if you are sure it is dead."
    exit 1
}
Write-Ok "Build lock acquired (PID $PID)."

# ── 1. Find what is listening on 3201 ─────────────────────────────────────────────
Write-Step 'Locating the API on port 3201'

$apiPids = @()
try {
    $conns = Get-NetTCPConnection -LocalPort 3201 -State Listen -ErrorAction SilentlyContinue
    if ($conns) {
        $apiPids = $conns | Select-Object -ExpandProperty OwningProcess -Unique | Where-Object { $_ -gt 0 }
    }
} catch { }

if (-not $apiPids -or $apiPids.Count -eq 0) {
    Write-Ok 'Nothing listening on 3201 — the engine DLL is already free.'
} else {
    foreach ($procId in $apiPids) {
        # Confirm it is OURS before stopping it. A blind Stop-Process on whatever owns
        # 3201 could kill an unrelated service that happened to bind the port.
        #
        # ⚠️ The command line is often RELATIVE (`node dist/src/main.js`), because the
        # API is launched with its working directory set to nest/. So matching on the
        # repo absolute path alone gives a false negative and refuses to stop our own
        # API. Check the relative signature first, then fall back to the absolute path.
        $info = Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction SilentlyContinue
        $cmd  = if ($info) { [string]$info.CommandLine } else { '' }

        $relativeSignature = $cmd -match 'dist[\\/]src[\\/]main\.js' -or $cmd -match 'nest\s+start' -or $cmd -match 'nest-cli'
        $absoluteSignature = $cmd -and $cmd.ToLower().Contains($repoRoot.ToLower())
        $isOurs = $relativeSignature -or ($absoluteSignature -and $cmd -match 'node')

        if (-not $isOurs) {
            Write-Warn2 "PID $procId is listening on 3201 but does not look like this repo's API."
            Write-Warn2 "  cmd: $(if ($cmd.Length -gt 140) { $cmd.Substring(0,140) + '...' } else { $cmd })"
            Write-Warn2 '  Refusing to kill it. Resolve manually, then re-run.'
            exit 1
        }

        try {
            Stop-Process -Id $procId -Force -ErrorAction Stop
            Write-Ok "Stopped API (PID $procId)."
        } catch {
            Write-Warn2 "Could not stop PID ${procId}: $($_.Exception.Message)"
            Write-Warn2 'Close the process (or its terminal) and re-run.'
            exit 1
        }
    }

    # Windows releases the file mapping asynchronously after process exit. Poll rather
    # than sleeping a fixed amount — a fixed sleep either wastes time or races.
    $dll = Join-Path $nestDir 'node_modules\.prisma\client\query_engine-windows.dll.node'
    $waited = 0
    while ($waited -lt 15000) {
        $stillListening = Get-NetTCPConnection -LocalPort 3201 -State Listen -ErrorAction SilentlyContinue
        if (-not $stillListening) {
            # Port is free; confirm the DLL is actually renameable before proceeding,
            # because that (not the port) is what prisma generate needs.
            try {
                $probe = "$dll.probe"
                if (Test-Path $dll) {
                    Rename-Item -Path $dll -NewName (Split-Path $probe -Leaf) -ErrorAction Stop
                    Rename-Item -Path $probe -NewName (Split-Path $dll -Leaf) -ErrorAction Stop
                }
                break
            } catch { }
        }
        Start-Sleep -Milliseconds 400
        $waited += 400
    }
    if ($waited -ge 15000) {
        Write-Warn2 'The engine DLL is still locked after 15s. The build will explain what holds it.'
    } else {
        Write-Ok 'Engine DLL released.'
    }
}

# ── 2. Build ──────────────────────────────────────────────────────────────────────
Write-Step 'Building the API'
Push-Location $nestDir
try {
    if ($Quick) {
        # ── -Quick (2026-10-27) ──
        # WHAT:  `tsc` only — the same compiler step `npm run build` runs, WITHOUT `prebuild`.
        # WHY:   `prebuild` is 55 chained steps including `npx jest` (1,947 tests), ~47 validators and
        #        `prisma generate`. Measured ~90s of the ~2 min, paid PER ITERATION for a one-line change.
        # INSTEAD OF: running the full gate on every save, which is what made a small edit cost minutes.
        # REVERSE BY: dropping the switch and always running `npm run build`.
        # ⚠️ THIS IS NOT A SUBSTITUTE FOR THE GATE. Run `build:api` (no switch) before a commit/close —
        # `-Quick` skips the validators, so it cannot tell you an invariant broke.
        # ⚠️ AND IT DOES NOT RUN `prisma generate` (that lives in `prebuild`). After a schema.prisma change
        # the Prisma client is stale and `tsc` will fail on the new column — use the full build for that.
        Write-Host '   -Quick: tsc only (prebuild validators and jest SKIPPED — run build:api before closing)' -ForegroundColor Yellow
        & npx tsc -p tsconfig.build.json
    } else {
        & npm run build
    }
    $buildExit = $LASTEXITCODE
} finally {
    Pop-Location
}

if ($buildExit -ne 0) {
    Write-Host "`n   BUILD FAILED (exit $buildExit)" -ForegroundColor Red
    Write-Host '   The API has been left STOPPED on purpose — restarting into a failed' -ForegroundColor Yellow
    Write-Host '   build would serve stale code and hide the error.' -ForegroundColor Yellow
    Write-Host "`n   Restart when ready:  npm --prefix `"$nestDir`" run start" -ForegroundColor Yellow
    Release-BuildLock
    exit $buildExit
}
Write-Ok 'Build succeeded.'

# ── 3. Restart ────────────────────────────────────────────────────────────────────
if ($SkipRestart) {
    Write-Host "`n   -SkipRestart set — API left down." -ForegroundColor Yellow
    Release-BuildLock
    exit 0
}

Write-Step 'Restarting the API'
# ⚠️ `nest\logs\` — the same directory `tcs-launch.ps1` writes to (#1023). The LAUNCHER is named in
# the file, so a reader can tell which one started the running API instead of inferring it from a
# path. `nest\logs\` is gitignored, which is right for raw console capture.
$logDir = Join-Path $repoRoot 'nest\logs'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
$outLog = Join-Path $logDir 'console-build-api.log'
$errLog = Join-Path $logDir 'console-build-api-err.log'

# ⚠️ `node dist/src/main.js` — NOT `npm run start`. This is the form the team has been using
# manually to recover from this script's own restart failures; it is the same artefact the
# build just wrote, starts in seconds, and produces a log file that the DOWN report can tail.
#
# ── ⚠️ STARTED VIA WMI SO THE CALLER CAN RETURN (2026-10-22) ──────────────────────────────────
# WHY THIS IS NOT `Start-Process`. Measured: `build:api` finished its work — log complete, API
# healthy, `/api/version` answering, no jest/tsc process alive — and the CALLING SHELL still reported
# "running" minutes later. It returned only when a LATER build stopped that API.
#
# The cause is process OWNERSHIP, not output redirection: a `Start-Process` child is a DESCENDANT of
# the caller, and the caller waits for its process tree to drain. A server never drains, so the call
# never returns. `$apiProc.Dispose()` was tried and does NOT fix it — it drops a .NET handle, not an
# OS parent-child relationship.
#
# `Win32_Process.Create` parents the new process to **WmiPrvSE.exe**, not to this script. The tree
# the caller waits on therefore ends when this script exits, and the API keeps running — which is what
# "starting in the background" was always supposed to mean.
#
# ⚠️ Redirection moves into `cmd.exe`, because WMI cannot attach standard handles. The log paths are
# unchanged, so `nest/logs/console-build-api*.log` remains the answer to "where is the log".
#
# ── ⚠️ AND THE WINDOW IS CREATED HIDDEN (2026-10-26) ───────────────────────────────────────────
# `Win32_Process.Create` with no `ProcessStartupInformation` gives a console-subsystem child
# (`cmd.exe`) a BRAND-NEW VISIBLE CONSOLE — an empty black window titled `C:\WINDOWS\system32\cmd.exe`
# that displays nothing and belongs to nobody. The owner reported exactly that (*"2-3 times you've
# caused a new one to open but it never displays anything"*), and this line was the only launcher in
# the toolchain that omitted the flag: `tcs-launch.ps1` already passes `-WindowStyle Hidden` for the
# same reason. `ShowWindow = 0` (SW_HIDE) creates the same console, hidden.
#
# ⚠️ Do not "fix" this by dropping `cmd.exe` — WMI cannot attach standard handles, so redirection has
# to happen inside a shell. The flag is the fix; the shell is required.
#
# Falls back to `Start-Process` if WMI is unavailable or refused — a slow call is far better than an
# API that did not start.
$apiProc = $null
try {
    $redirected = "cmd.exe /c node dist/src/main.js 1> `"$outLog`" 2> `"$errLog`""
    # `New-CimInstance -ClientOnly` builds the WMI method's startup blob without registering anything.
    # ⚠️ `[uint16]` IS REQUIRED (measured 2026-10-27). `Win32_ProcessStartup.ShowWindow` is a CIM
    # **uint16**; a plain `0` is an Int32 and `Invoke-CimMethod` rejects the blob with the bare message
    # **"Type mismatch"** — which this block's `catch` turned into the `Start-Process` fallback, whose
    # launch is a CHILD of the caller and therefore makes every `build:api` caller WAIT until that API
    # is stopped. That is the whole "Waiting for terminal output" symptom: measured builds finished at
    # ~2 min and the shell reported "running" for 9+ minutes. Reproduced in isolation: `0` → Type
    # mismatch, `[uint16]0` → ReturnValue 0 with a PID.
    $startup = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0 }
    $created = Invoke-CimMethod -ClassName Win32_Process -MethodName Create `
        -Arguments @{
            CommandLine              = $redirected
            CurrentDirectory         = $nestDir
            ProcessStartupInformation = $startup
        } -ErrorAction Stop
    if ($created.ReturnValue -eq 0 -and $created.ProcessId) {
        Start-Sleep -Milliseconds 250
        $apiProc = Get-Process -Id $created.ProcessId -ErrorAction Stop
        Write-Ok "API starting DETACHED via WMI (pid $($created.ProcessId), window hidden) — this script's caller will not wait on it."
    }
} catch {
    Write-Host "   ⚠ WMI launch unavailable ($($_.Exception.Message)) — falling back to Start-Process." -ForegroundColor Yellow
}
if (-not $apiProc) {
    $apiProc = Start-Process -FilePath 'node' -ArgumentList 'dist/src/main.js' `
        -WorkingDirectory $nestDir `
        -RedirectStandardOutput $outLog `
        -RedirectStandardError $errLog `
        -WindowStyle Hidden -PassThru
    Write-Ok "API starting (pid $($apiProc.Id)) — ⚠ as a CHILD of this shell, so the caller may wait until it stops."
}
Write-Ok "API starting in the background (node dist/src/main.js, PID $($apiProc.Id))."

# The post-restart assertion (#933): a REAL request must answer, or the script fails LOUDLY.
$healthy = Assert-ApiUp -Port 3201 -TimeoutSeconds 60 -Proc $apiProc

# ⚠️ DROPS OUR REFERENCE ONLY. The API is a separate process and is NOT stopped by this.
$apiProc.Dispose()

# ⚠️ MEASURED 2026-10-22 — DISPOSING THE HANDLE DID **NOT** FIX THE HANG, and this note exists so
# nobody "fixes" it again on the same theory.
#
# The symptom: `npm --prefix nest run build:api` finishes its work and then the CALLER WAITS — for
# minutes — with no output. Measured with a stopwatch: the build log was complete at 22:20:46
# ("Build succeeded", "API healthy"), `/api/version` answered 0.138.0, no jest/tsc/build process was
# alive, and the calling shell still reported "running" past 22:28. It reported completion only once a
# LATER build stopped that API process.
#
# That last sentence is the mechanism: the restarted API remains a DESCENDANT of the shell that
# launched this script, and the caller waits for its process tree to drain. A running API never
# drains. `$apiProc.Dispose()` releases the .NET handle (correct hygiene, kept) but does not detach
# the OS process, so it changes nothing about the wait.
#
# What actually avoids it: run this script ASYNCHRONOUSLY and treat "API healthy" in the log as
# completion, rather than blocking on the call.

if ($healthy) {
    Write-Ok 'API healthy on http://localhost:3201 — /api/version answered.'
    Release-BuildLock
} else {
    Release-BuildLock
    exit 1
}
