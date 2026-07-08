#Requires -Version 7
<#
.SYNOPSIS
    Trading Command Suite — stop all services.
.EXAMPLE
    pwsh -File scripts/tcs-stop.ps1
#>

Write-Host "`n  Stopping Trading Command Suite services…" -ForegroundColor DarkGray

$ports = @(3201, 5000, 5173, 5174)
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
