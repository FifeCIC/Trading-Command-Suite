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
    [switch]$SelfTest
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
    & npm run build
    $buildExit = $LASTEXITCODE
} finally {
    Pop-Location
}

if ($buildExit -ne 0) {
    Write-Host "`n   BUILD FAILED (exit $buildExit)" -ForegroundColor Red
    Write-Host '   The API has been left STOPPED on purpose — restarting into a failed' -ForegroundColor Yellow
    Write-Host '   build would serve stale code and hide the error.' -ForegroundColor Yellow
    Write-Host "`n   Restart when ready:  npm --prefix `"$nestDir`" run start" -ForegroundColor Yellow
    exit $buildExit
}
Write-Ok 'Build succeeded.'

# ── 3. Restart ────────────────────────────────────────────────────────────────────
if ($SkipRestart) {
    Write-Host "`n   -SkipRestart set — API left down." -ForegroundColor Yellow
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
$apiProc = Start-Process -FilePath 'node' -ArgumentList 'dist/src/main.js' `
    -WorkingDirectory $nestDir `
    -RedirectStandardOutput $outLog `
    -RedirectStandardError $errLog `
    -WindowStyle Hidden -PassThru
Write-Ok "API starting in the background (node dist/src/main.js, PID $($apiProc.Id))."

# The post-restart assertion (#933): a REAL request must answer, or the script fails LOUDLY.
if (Assert-ApiUp -Port 3201 -TimeoutSeconds 60 -Proc $apiProc) {
    Write-Ok 'API healthy on http://localhost:3201 — /api/version answered.'
} else {
    exit 1
}
