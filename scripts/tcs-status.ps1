#Requires -Version 5
<#
.SYNOPSIS
    Quick health check for Trading Command Suite services.
    Prints a one-line status report. No startup/restart logic.
.EXAMPLE
    pwsh -File scripts\tcs-status.ps1
    pwsh -File scripts\tcs-status.ps1 -Verbose
#>
param([switch]$Quiet)

$ROOT = 'C:\wamp64\www\trading-command-suite'

$services = @(
    @{ Name = 'NestJS API';  Port = 3201; Url = 'http://localhost:3201/api/version'; Color = 'Cyan' }
    @{ Name = 'Vite';        Port = 5173; Url = 'http://localhost:5173';           Color = 'Green' }
    @{ Name = 'MT5 Bridge';  Port = 5000; Url = 'http://localhost:5000/health';    Color = 'Yellow' }
)

Write-Host "`n  Trading Command Suite — Health Check" -ForegroundColor White

# ── Build staleness check ──────────────────────────────
$nestSrc = Get-ChildItem "$ROOT\nest\src" -Recurse -Filter *.ts | 
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
$nestDist = Get-Item "$ROOT\nest\dist\src\main.js" -ErrorAction SilentlyContinue

if ($nestSrc -and $nestDist) {
    if ($nestSrc.LastWriteTime -gt $nestDist.LastWriteTime) {
        Write-Host "  ⚠️  Build STALE — src/ is newer than dist/ — run tcs-launch.ps1 to rebuild" -ForegroundColor Yellow
    }
} elseif (-not $nestDist) {
    Write-Host "  ❌ Build MISSING — dist/ does not exist — run tcs-launch.ps1 to build" -ForegroundColor Red
}
Write-Host "  " ("─" * 40) -ForegroundColor DarkGray

$allOk = $true
$hasIssues = $false
foreach ($svc in $services) {
    $conn = Get-NetTCPConnection -LocalPort $svc.Port -ErrorAction SilentlyContinue | 
        Where-Object { $_.State -eq 'Listen' } | Select-Object -First 1
    
    if ($conn) {
        # Try HTTP check
        try {
            $response = Invoke-WebRequest -Uri $svc.Url -TimeoutSec 3 -UseBasicParsing -ErrorAction Stop
            Write-Host "  ✅ $($svc.Name) — port $($svc.Port) — HTTP $($response.StatusCode)" -ForegroundColor $svc.Color
        } catch {
            Write-Host "  ⚠️  $($svc.Name) — port $($svc.Port) — listening but HTTP error" -ForegroundColor Yellow
            $hasIssues = $true
            $allOk = $false
        }
    } else {
        Write-Host "  ❌ $($svc.Name) — port $($svc.Port) — NOT LISTENING" -ForegroundColor Red
        $allOk = $false
    }
}

# ── Show NestJS error log if it exists and is recent ──
$nestErr = "$env:TEMP\nest-api-err.log"
if (Test-Path $nestErr) {
    $errAge = (Get-Date) - (Get-Item $nestErr).LastWriteTime
    $errLines = Get-Content $nestErr -Tail 10 -ErrorAction SilentlyContinue | Where-Object { $_ -match 'error|Error|Exception|FAIL' }
    if ($errLines -and $errAge.TotalMinutes -le 30) {
        Write-Host "`n  ── NestJS recent errors (last 30 min) ──" -ForegroundColor DarkGray
        $errLines | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
        Write-Host "  ─────────────────────────────────────" -ForegroundColor DarkGray
        $hasIssues = $true
    }
}

Write-Host "  " ("─" * 40) -ForegroundColor DarkGray
if ($allOk) {
    Write-Host "  ✅ All services healthy — http://localhost:5173" -ForegroundColor Green
} elseif ($hasIssues) {
    Write-Host "  ⚠️  Services running with issues — see above" -ForegroundColor Yellow
} else {
    Write-Host "  ❌ Services down — run: pwsh -File scripts\tcs-launch.ps1" -ForegroundColor Red
}
Write-Host ""
