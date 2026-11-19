#Requires -Version 5
<#
.SYNOPSIS
    Quick health check for Trading Command Suite services.
    Prints a one-line status report. No startup/restart logic.
.EXAMPLE
    pwsh -File scripts\tcs-status.ps1
    pwsh -File scripts\tcs-status.ps1 -Quiet
.NOTES
    ⚠️ THREE THINGS THIS SCRIPT USED TO GET WRONG, all measured 2026-11-19 with the whole
    stack healthy (3201 · 5173 · 5000 · 5001 all answering). Each one let it print
    "✅ All services healthy" over a stack that was not:

    1. IT CHECKED ONE BRIDGE. `nest/.env` has `MT5_ACTIVE_BROKERS=2,3`, so the launcher starts
       TWO bridges — broker 2 on :5000, broker 3 on :5001 (`5000 + index`, tcs-launch.ps1 L99).
       This script hardcoded :5000 and labelled it "MT5 Bridge", so broker 3's bridge could die
       and the report stayed green. The port list is now DERIVED from the same env var the
       launcher reads, because a second hand-kept list drifts from the first.

    2. IT TREATED "ANSWERS HTTP" AS "WORKS". A bridge returns `200` from `/health` while
       `connected: false` — the terminal link is dead and it will fetch nothing. The launcher
       already refuses to call that a success (`A listening bridge is not a WORKING bridge`,
       #765); this report did not, so the two disagreed and the reassuring one was the one a
       human read. `connected` is now checked.

    3. ITS ADVICE WAS WRONG. "run tcs-launch.ps1 to rebuild" — the launcher NEVER rebuilds; it
       starts `dist/src/main.js`. Following that hint left the build exactly as stale as before.
       The hint now names `build:api`, which is the command that actually rebuilds. It also
       pointed at `%TEMP%\nest-api-err.log`, a path the launchers stopped writing in #1023.

    The port probe is a CONNECTION test on both loopback families, not `Where-Object State -eq
    'Listen'`: that filter returns nothing for a node listener on this host and returns rows
    owning pid 0 for the python bridges, so it can report a healthy service as DOWN.
#>
param([switch]$Quiet)

$ROOT = 'C:\wamp64\www\trading-command-suite'

# ── Which bridges are expected? Read the SAME variable the launcher reads ───────────────────
# Default '2' matches tcs-launch.ps1 L83, so a missing env var cannot silently reduce the
# checked set to zero.
$activeBrokers = @()
$envFile = Join-Path $ROOT 'nest\.env'
$brokerServers = @{}
if (Test-Path $envFile) {
    $lines = Get-Content $envFile -ErrorAction SilentlyContinue
    $abLine = $lines | Where-Object { $_ -match '^\s*MT5_ACTIVE_BROKERS\s*=' } | Select-Object -First 1
    if ($abLine) {
        $activeBrokers = ($abLine -replace '^\s*MT5_ACTIVE_BROKERS\s*=\s*', '').Split(',') |
            ForEach-Object { $_.Trim() } | Where-Object { $_ }
    }
    foreach ($l in $lines) {
        if ($l -match '^\s*MT5_SERVER_(\d+)\s*=\s*(.+)$') { $brokerServers[$Matches[1]] = $Matches[2].Trim() }
    }
}
if (-not $activeBrokers -or $activeBrokers.Count -eq 0) { $activeBrokers = @('2') }

$services = @(
    @{ Name = 'NestJS API'; Port = 3201; Url = 'http://localhost:3201/api/version'; Color = 'Cyan'; Kind = 'api' }
    @{ Name = 'Vite';       Port = 5173; Url = 'http://localhost:5173';            Color = 'Green'; Kind = 'http' }
)
for ($i = 0; $i -lt $activeBrokers.Count; $i++) {
    $brokerId = $activeBrokers[$i]
    $server = if ($brokerServers.ContainsKey($brokerId)) { $brokerServers[$brokerId] } else { '?' }
    $bridgePort = 5000 + $i
    $services += @{
        Name = "MT5 #${brokerId} (${server})"; Port = $bridgePort
        Url = "http://localhost:${bridgePort}/health"; Color = 'Yellow'; Kind = 'bridge'
    }
}

# ── Does anything accept a connection on this port? ─────────────────────────────────────────
# BOTH loopback families, and NOT a fallback chain that stops at the first "no": a `::` bind
# does not answer on 127.0.0.1 and a `0.0.0.0` bind does not answer on ::1, so probing one
# address can miss a serving process entirely.
function Test-PortAnswers {
    param([int]$Port)
    $answered = $false
    foreach ($addr in @('127.0.0.1', '::1')) {
        $client = $null
        try {
            $client = New-Object System.Net.Sockets.TcpClient
            $iar = $client.BeginConnect($addr, $Port, $null, $null)
            if ($iar.AsyncWaitHandle.WaitOne(700) -and $client.Connected) { $answered = $true }
        } catch {
            # A refused or unreachable address is a "no" for that family, not an error.
        } finally {
            if ($client) { $client.Close() }
        }
    }
    return $answered
}

if (-not $Quiet) { Write-Host "`n  Trading Command Suite — Health Check" -ForegroundColor White }

# ── Build staleness check ──────────────────────────────────────────────
$nestSrc = Get-ChildItem "$ROOT\nest\src" -Recurse -Filter *.ts -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
$nestDist = Get-Item "$ROOT\nest\dist\src\main.js" -ErrorAction SilentlyContinue

if ($nestSrc -and $nestDist) {
    if ($nestSrc.LastWriteTime -gt $nestDist.LastWriteTime) {
        # ⚠️ NAME THE FILE. "Build STALE" with no subject sends the reader to `git status` over the
        # whole repo — and in a shared working tree the newest source file is often ANOTHER AGENT's
        # uncommitted edit, which they must not rebuild over. Measured 2026-11-19: this read STALE
        # for 20 minutes because a peer had `isa.service.ts` open with a failing spec, and nothing
        # said so.
        $rel = $nestSrc.FullName.Replace("$ROOT\", '')
        Write-Host "  ⚠️  Build STALE — $rel is newer than dist/ — run: npm --prefix nest run build:api" -ForegroundColor Yellow
    }
} elseif (-not $nestDist) {
    Write-Host "  ❌ Build MISSING — dist/ does not exist — run: npm --prefix nest run build:api" -ForegroundColor Red
}
if (-not $Quiet) { Write-Host "  " ("─" * 40) -ForegroundColor DarkGray }

$allOk = $true
$hasIssues = $false
foreach ($svc in $services) {
    if (-not (Test-PortAnswers -Port $svc.Port)) {
        Write-Host "  ❌ $($svc.Name) — port $($svc.Port) — NOT LISTENING" -ForegroundColor Red
        $allOk = $false
        continue
    }
    try {
        $response = Invoke-WebRequest -Uri $svc.Url -TimeoutSec 3 -UseBasicParsing -ErrorAction Stop
        if ($svc.Kind -eq 'bridge') {
            # A 200 from /health is not a working bridge (#765): the HTTP server can answer
            # while the terminal link is gone. And `connected: true` is STILL not enough —
            # measured 2026-11-19 with `tradeAllowed: false` on :5001, every order routed to that
            # broker is refused `retcode 10027` and the app stayed green because the OTHER broker
            # could trade. Three states, not two: down / connected-but-cannot-trade / working.
            $body = $null
            try { $body = $response.Content | ConvertFrom-Json } catch { $body = $null }
            if (-not $body -or $null -eq $body.connected) {
                Write-Host "  ⚠️  $($svc.Name) — port $($svc.Port) — HTTP $($response.StatusCode) but no 'connected' field to judge" -ForegroundColor Yellow
                $hasIssues = $true
                $allOk = $false
            } elseif (-not [bool]$body.connected) {
                Write-Host "  ⚠️  $($svc.Name) — port $($svc.Port) — listening but NOT connected to its terminal" -ForegroundColor Yellow
                $hasIssues = $true
                $allOk = $false
            } elseif ($null -ne $body.tradeAllowed -and -not [bool]$body.tradeAllowed) {
                Write-Host "  🔴 $($svc.Name) — port $($svc.Port) — CONNECTED but AutoTrading is OFF: every order is refused (retcode 10027)" -ForegroundColor Red
                Write-Host "       Fix: switch AutoTrading ON in that MT5 terminal (toolbar), then re-check." -ForegroundColor DarkGray
                $hasIssues = $true
                $allOk = $false
            } elseif ($body.tradeapiDisabled -eq $true) {
                Write-Host "  🔴 $($svc.Name) — port $($svc.Port) — CONNECTED but the API trade path is DISABLED: every order is refused" -ForegroundColor Red
                Write-Host "       Fix: enable API trading for the account in the MT5 terminal options." -ForegroundColor DarkGray
                $hasIssues = $true
                $allOk = $false
            } else {
                Write-Host "  ✅ $($svc.Name) — port $($svc.Port) — connected and trading, account $($body.account)" -ForegroundColor $svc.Color
            }
        } else {
            Write-Host "  ✅ $($svc.Name) — port $($svc.Port) — HTTP $($response.StatusCode)" -ForegroundColor $svc.Color
        }
    } catch {
        Write-Host "  ⚠️  $($svc.Name) — port $($svc.Port) — listening but HTTP error" -ForegroundColor Yellow
        $hasIssues = $true
        $allOk = $false
    }
}

# ── Recent API console errors, from the file the launchers actually write (#1023) ──
# This used to read `%TEMP%\nest-api-err.log`, which nothing has written since the launchers
# were unified on `nest\logs\console-*.log`. An empty read there looked like "no errors".
$logsDir = Join-Path $ROOT 'nest\logs'
if (Test-Path $logsDir) {
    $consoleLogs = Get-ChildItem $logsDir -Filter 'console-*.log' -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -notmatch '-err\.log$' } | Sort-Object LastWriteTime -Descending
    foreach ($log in ($consoleLogs | Select-Object -First 2)) {
        $ageMin = ((Get-Date) - $log.LastWriteTime).TotalMinutes
        if ($ageMin -gt 30) { continue }
        # ⚠️ `\bERROR\b`, not `ERROR`. Measured 2026-11-19: the unanchored form matched
        # `sl=... tp=... [tripped=false errors=0]` on an ordinary SUCCESSFUL order line, because
        # "errors=0" contains "error". A filter that lists a healthy order under "errors" trains
        # the reader to skip the block — and this block is the only place a broker rejection is
        # surfaced on this report.
        $errLines = Get-Content $log.FullName -Tail 200 -ErrorAction SilentlyContinue |
            Where-Object { $_ -match '\bERROR\b|\bFATAL\b|\bException\b|Unhandled' } | Select-Object -Last 5
        if ($errLines) {
            Write-Host "`n  ── $($log.Name) errors (file touched $([int]$ageMin)m ago) ──" -ForegroundColor DarkGray
            $errLines | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
            Write-Host "  ─────────────────────────────────────" -ForegroundColor DarkGray
            $hasIssues = $true
        }
    }
}

if (-not $Quiet) { Write-Host "  " ("─" * 40) -ForegroundColor DarkGray }
if ($allOk) {
    Write-Host "  ✅ All $($services.Count) services healthy — http://localhost:5173" -ForegroundColor Green
} elseif ($hasIssues) {
    Write-Host "  ⚠️  Services running with issues — see above" -ForegroundColor Yellow
} else {
    Write-Host "  ❌ Services down — run: pwsh -File scripts\tcs-launch.ps1" -ForegroundColor Red
}
Write-Host ""

# A human reading the one-line summary must not have to scroll to learn that a broker cannot
# trade. `allOk` was already false, but the ⚠️ line above is the same weight as a stale build.
if (-not $allOk) {
    $blocked = @($services | Where-Object { $_.Kind -eq 'bridge' })
    Write-Host "  ⚠️  The stack is NOT fully healthy. If a bridge above says AutoTrading is OFF, that" -ForegroundColor Yellow
    Write-Host "      broker refuses every order while still reporting connected — fix the terminal." -ForegroundColor Yellow
    Write-Host "" -ForegroundColor Yellow
    $null = $blocked
}

if ($allOk) { exit 0 } else { exit 1 }
