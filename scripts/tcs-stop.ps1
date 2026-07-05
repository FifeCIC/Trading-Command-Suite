#Requires -Version 7
<#
.SYNOPSIS
    Trading Command Suite — stop all services.
.EXAMPLE
    pwsh -File scripts/tcs-stop.ps1
#>

Write-Host "`n  Stopping Trading Command Suite services…" -ForegroundColor DarkGray

$ports = @(3201, 5000, 5173)
$killed = @()

foreach ($port in $ports) {
    $conn = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($conn) {
        try {
            Stop-Process -Id $conn.OwningProcess -Force -ErrorAction Stop
            $killed += "$port (PID $($conn.OwningProcess))"
        } catch {
            Write-Host "    Failed to kill port $port — $_" -ForegroundColor Red
        }
    }
}

if ($killed.Count -gt 0) {
    Write-Host "  Stopped: $($killed -join ', ')" -ForegroundColor Green
} else {
    Write-Host "  No TCS services were running." -ForegroundColor Yellow
}
Write-Host ""
