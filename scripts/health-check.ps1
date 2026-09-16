#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Quick health check for agents and developers.
  Prints a compact status, then asserts a LATENCY BUDGET on the aggregate endpoints.
.DESCRIPTION
  Run this at the start of any session to understand system state.
  No arguments needed — just `pwsh scripts/health-check.ps1`.

  ⚠️ WHY THE BUDGET CHECK IS HERE (2026-09-16)

  This script previously hit ONLY `/api/system/health-summary` (~14ms). That endpoint does not
  touch the per-table scans, so it could not see the failure that mattered:

      GET /api/system/health-dashboard  ->  504 after 32,298ms  (gateway timeout 30,000ms)
      /status/health-check              ->  permanent loading skeleton

  caused by a retention config change that moved `directiveoutcome` onto an unindexed column.
  The retention code was correct, every build was green, and the fault surfaced three files away
  as a timeout on a DIAGNOSTIC endpoint. It stayed that way until someone opened the page.

  The lesson worth keeping: the expensive endpoints were probed by NOTHING. `contract-probe.cjs`
  now owns the full check (INV-ENDPOINT-BUDGET); this script mirrors the cheap subset so the
  session-start path cannot stay blind to it.

  Budgets are an order of magnitude above observed cost, so this fails on a REGRESSION and never
  on a busy machine. Exit code is 1 if any endpoint breaches its budget or fails.
.EXAMPLE
  pwsh scripts/health-check.ps1
#>

$ErrorActionPreference = 'Continue'

# Endpoint, budget in ms, why it is on the list.
# Budgets are deliberately loose: healthy cost is 2-400ms, so a breach means something changed
# structurally (usually an unindexed predicate), not that the machine was busy.
$targets = @(
  @{ Path = '/api/system/health-summary';           BudgetMs = 2000; Note = 'session-start health surface' }
  @{ Path = '/api/system/health-dashboard';         BudgetMs = 5000; Note = 'per-table row counts, sizes AND MIN/MAX per retention table' }
  @{ Path = '/api/market-data/bars/refresh/status'; BudgetMs = 2000; Note = 'feeds the Feed Freshness panel' }
  @{ Path = '/api/scoring/gated/thresholds';        BudgetMs = 5000; Note = 'per-bot and per-protocol ceiling aggregates' }
)

$base = 'http://localhost:3201'
$breaches = 0

Write-Host ''
try {
  $summary = Invoke-RestMethod -Uri "$base/api/system/health-summary" -TimeoutSec 10
  Write-Host ("Health Summary (fetched in {0}ms):" -f $summary.fetchedMs) -ForegroundColor Cyan
  Write-Host $summary.summary
} catch {
  Write-Host 'NestJS API not reachable at http://localhost:3201' -ForegroundColor Red
  Write-Host '   Run: pwsh scripts/tcs-launch.ps1' -ForegroundColor Yellow
  exit 1
}

Write-Host ''
Write-Host 'Endpoint latency budgets:' -ForegroundColor Cyan
foreach ($t in $targets) {
  $url = "$base$($t.Path)"
  $timeoutSec = [Math]::Max(5, [Math]::Ceiling($t.BudgetMs / 1000) * 4)

  # Warm call: first hit pays lazy connection/module costs that are not the property measured.
  try { Invoke-RestMethod -Uri $url -TimeoutSec $timeoutSec | Out-Null } catch { }

  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $ok = $true
  $err = $null
  try { Invoke-RestMethod -Uri $url -TimeoutSec $timeoutSec | Out-Null } catch { $ok = $false; $err = $_.Exception.Message }
  $sw.Stop()
  $ms = [int]$sw.Elapsed.TotalMilliseconds

  if (-not $ok) {
    $breaches++
    Write-Host ("  FAIL  {0,-42} did not respond" -f $t.Path) -ForegroundColor Red
    Write-Host ("        {0}" -f $err) -ForegroundColor DarkGray
  } elseif ($ms -gt $t.BudgetMs) {
    $breaches++
    Write-Host ("  FAIL  {0,-42} {1}ms exceeds {2}ms budget" -f $t.Path, $ms, $t.BudgetMs) -ForegroundColor Red
    Write-Host ("        {0}" -f $t.Note) -ForegroundColor DarkGray
    Write-Host '        An aggregate endpoint over budget usually means an UNINDEXED predicate. Check' -ForegroundColor Yellow
    Write-Host '        that every column in a WHERE/MIN/MAX clause leads an index before assuming load.' -ForegroundColor Yellow
  } else {
    Write-Host ("  ok    {0,-42} {1}ms (budget {2}ms)" -f $t.Path, $ms, $t.BudgetMs) -ForegroundColor Green
  }
}

Write-Host ''
if ($breaches -gt 0) {
  Write-Host ("$breaches endpoint(s) over budget or unreachable.") -ForegroundColor Red
  Write-Host 'Full check: from nest/, run `node scripts/contract-probe.cjs` (INV-ENDPOINT-BUDGET).' -ForegroundColor Yellow
  exit 1
}

Write-Host 'All endpoints within budget. Full live contract check: from nest/, `node scripts/contract-probe.cjs`.' -ForegroundColor Cyan
exit 0
