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
    $conn = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1
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
