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

param(
    [switch]$SkipRestart
)

$ErrorActionPreference = 'Continue'
$repoRoot = Split-Path -Parent $PSScriptRoot
$nestDir  = Join-Path $repoRoot 'nest'

function Write-Step($msg) { Write-Host "`n== $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "   OK  $msg" -ForegroundColor Green }
function Write-Warn2($msg){ Write-Host "   !!  $msg" -ForegroundColor Yellow }

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
Start-Process -FilePath 'npm' -ArgumentList 'run', 'start' -WorkingDirectory $nestDir -WindowStyle Hidden
Write-Ok 'API starting in the background (allow ~15s).'

$healthy = $false
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    try {
        $r = Invoke-WebRequest -Uri 'http://localhost:3201/api/health' -UseBasicParsing -TimeoutSec 3
        if ($r.StatusCode -eq 200) { $healthy = $true; break }
    } catch { }
}

if ($healthy) {
    Write-Ok 'API healthy on http://localhost:3201'
} else {
    Write-Warn2 'API did not report healthy within 30s — check the start log.'
    exit 1
}
