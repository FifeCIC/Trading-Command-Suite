#Requires -Version 7
<#
.SYNOPSIS
    Trading Command Suite — stop all services.
.EXAMPLE
    pwsh -File scripts/tcs-stop.ps1
#>

Write-Host "`n  Stopping Trading Command Suite services…" -ForegroundColor DarkGray

# #866 — the stop-sentinel directory hangs off the repo root (same constant as tcs-launch).
$ROOT = 'C:\wamp64\www\trading-command-suite'

# ── ⚠️ REFUSE WHILE A BUILD OWNS THE API (#1240) ────────────────────────────────────────────────
#
# `build:api` holds `logs/build-api.lock` from before its first step until AFTER its health check.
# Stopping the stack mid-build is not merely rude: the build has already `rimraf`-ed dist, and it is
# about to start an API and assert it healthy. Killing the processes underneath it makes it report a
# failure that has nothing to do with the code, and leaves every other agent guessing.
#
# ⚠️ A STALE lock must NOT block a stop. If a build was killed, its lock outlives it and the machine
# would be un-stoppable — the exact trap `build-api.ps1` avoids by taking over a dead holder. So this
# only refuses on a LIVE holder.
$apiLockPath = Join-Path $ROOT 'logs\build-api.lock'
if (Test-Path $apiLockPath) {
    $apiLockHolder = $null
    try { $apiLockHolder = Get-Content $apiLockPath -Raw | ConvertFrom-Json } catch { $apiLockHolder = $null }
    if ($apiLockHolder -and $apiLockHolder.pid -and (Get-Process -Id ([int]$apiLockHolder.pid) -ErrorAction SilentlyContinue)) {
        Write-Host "`n   REFUSING TO STOP: a build holds the API lock (pid $($apiLockHolder.pid), started $($apiLockHolder.startedUtc))." -ForegroundColor Red
        Write-Host "   It has already removed dist/ and is about to health-check the API it starts." -ForegroundColor Red
        Write-Host "   Stopping now would make that build fail for a reason unrelated to the code." -ForegroundColor Red
        Write-Host "   Wait for it to finish (a build is ~40 s), then run this again." -ForegroundColor Yellow
        Write-Host "   If the build is genuinely gone, the lock is stale only when its pid is not running — this check already tested that." -ForegroundColor DarkGray
        exit 1
    }
    if ($apiLockHolder) {
        Write-Host "   Note: a STALE API lock (pid $($apiLockHolder.pid), not running) is present — ignoring it." -ForegroundColor DarkGray
    }
}

# 0) #866 — write the bridge supervisors' stop-sentinels FIRST. The supervisor relaunches a
#    bridge that dies, which is correct for an ACCIDENT and wrong for a deliberate stop —
#    without this, tcs-stop would kill each bridge once and watch it come straight back.
$stopSentinelDir = Join-Path $ROOT 'logs\mt5-bridge'
New-Item -ItemType Directory -Path $stopSentinelDir -Force | Out-Null
foreach ($bp in @(5000, 5001, 5002)) {
    $null = New-Item -ItemType File -Path (Join-Path $stopSentinelDir "supervisor-${bp}.stop") -Force
}

# 1) Kill MT5 bridges by process identity — port-based killing below only
#    catches the process holding the LISTEN socket; zombies that crashed or
#    raced to bind survive and keep serving stale candles (issue #643).
#    #866: match the supervisor too, or it would relaunch the bridge we just killed.
$zombieBridges = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*mt5_bridge_v2.py*' -or $_.CommandLine -like '*bridge_supervisor.py*' }
foreach ($bp in $zombieBridges) {
    try { Stop-Process -Id $bp.ProcessId -Force -ErrorAction Stop } catch {}
    $null = cmd /c "taskkill /F /PID $($bp.ProcessId) 2>nul"
}
if ($zombieBridges) {
    Write-Host "  Stopped $($zombieBridges.Count) MT5 bridge process(es) by identity" -ForegroundColor Green
}

# 2) Kill anything still holding our known ports (NestJS, Vite, and any
#    bridge only reachable via the LISTEN socket). 5001 covers broker #2.
$ports = @(3201, 5000, 5001, 5173, 5174)
$killed = @()

foreach ($port in $ports) {
    # ⚠️ PICK THE LISTENER, NOT "the first connection on this port" (measured 2026-11-07, #1238).
    #
    # A busy port holds many CLIENT sockets as well as the listener. Measured on 3201 while the API was
    # healthy: **14 rows with `OwningProcess = 0`** (TimeWait/FinWait2 pairs) and ONE real listener.
    # `Select-Object -First 1` took a client row, so the script ran `Stop-Process -Id 0`, fell through to
    # `taskkill /F /PID 0`, and printed "Port 3201 is held by PID 0 — requires admin to free" — while the
    # real API (pid 23540) went on serving. A stop that reports a fabricated blocker and stops nothing is
    # the "plausible output, no error" shape on the path that decides whether a rebuild took effect.
    #
    # ⚠️ The listener row on this host can carry a BLANK `State` (no `LISTENING` row appears in `netstat`
    # either), so `State -eq 'Listen'` is a PREFERENCE, not a filter. The reliable second signal, measured
    # on 3201: **a listener has no peer** — `[::]:3201 → [::]:0` — while every client row names a real
    # remote port (`::1:64632`, `::1:49541`, …). Owners 0 are released sockets and must never be chosen.
    $conns = @(Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue |
        Where-Object { $_.OwningProcess -ne 0 })
    $conn = $conns | Where-Object { $_.State -eq 'Listen' } | Select-Object -First 1
    if (-not $conn) { $conn = $conns | Where-Object { $_.RemotePort -eq 0 } | Select-Object -First 1 }
    if (-not $conn) { $conn = $conns | Select-Object -First 1 }
    if ($conn) {
        $procId = $conn.OwningProcess
        # Try PowerShell first, fall back to cmd taskkill for admin-owned processes
        try {
            Stop-Process -Id $procId -Force -ErrorAction Stop
            $killed += "$port (PID $procId)"
        } catch {
            # Try cmd-level kill for stubborn processes
            $result = cmd /c "taskkill /F /PID $procId 2>&1"
            if ($LASTEXITCODE -eq 0) {
                $killed += "$port (PID $procId, via taskkill)"
            } else {
                Write-Host "    ⚠ Port $port is held by PID $procId — requires admin to free" -ForegroundColor Yellow
            }
        }
    }
}

if ($killed.Count -gt 0) {
    Write-Host "  Stopped: $($killed -join ', ')" -ForegroundColor Green
} else {
    Write-Host "  No TCS services were running." -ForegroundColor Yellow
}
Write-Host ""
