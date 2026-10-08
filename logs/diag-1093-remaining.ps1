# #1093 diagnostic (measurement only, not production) — why do the remaining ticketed gaps not resolve?
#
# Reproduces, offline, what the app's finaliser sees for each current ticketed gap row: which deals
# match the stored ticket (as positionId OR orderId), their sides, `reason`/`comment`, and each
# bridge's retention boundary — so "served but unmappable", "opening-only" and "beyond the wall"
# are measured facts rather than explanations.
$ErrorActionPreference = 'Continue'
$pw = 'tradingcs_dev_2026'
$mysql = 'C:\wamp64\bin\mysql\mysql9.1.0\bin\mysql.exe'

$rows = & $mysql -utradingcs "-p$pw" tradingcs -N -B -e "SELECT id, symbol, side, brokerTicket, openedAt, closedAt FROM trade WHERE provider='mt5' AND status='closed' AND (closeReason IS NULL OR closeReason='broker:unknown') AND brokerTicket IS NOT NULL AND brokerTicket<>'' ORDER BY closedAt ASC;" 2>$null

$a = curl.exe -s --max-time 60 'http://localhost:5000/history/deals?days=120' | ConvertFrom-Json
$b = curl.exe -s --max-time 60 'http://localhost:5001/history/deals?days=120' | ConvertFrom-Json
$d0 = @($a.deals); $d1 = @($b.deals)
$oldest0 = ($d0 | Sort-Object time | Select-Object -First 1).time
$oldest1 = ($d1 | Sort-Object time | Select-Object -First 1).time
Write-Output ":5000 deals=$($d0.Count) oldest=$oldest0"
Write-Output ":5001 deals=$($d1.Count) oldest=$oldest1"
$cut0 = [datetime]::ParseExact($oldest0, 'MM/dd/yyyy HH:mm:ss', $null)
$cut1 = [datetime]::ParseExact($oldest1, 'MM/dd/yyyy HH:mm:ss', $null)
$cutEarliest = if ($cut0 -le $cut1) { $cut0 } else { $cut1 }
Write-Output "earliest retention boundary across both: $cutEarliest"
Write-Output "ticketed gap rows: $($rows.Count)"
Write-Output ''

$all = $d0 + $d1
$buckets = @{ closing = @(); openingOnly = @(); inside = @(); beyond = @() }
foreach ($line in $rows) {
  $p = $line -split "`t"
  if ($p.Count -lt 6) { continue }
  $symbol = $p[1]; $side = $p[2]; $tk = $p[3].Trim(); $opened = [datetime]$p[4]; $closed = [datetime]$p[5]
  $matched = @($all | Where-Object { ([string]$_.orderId -eq $tk) -or ([string]$_.positionId -eq $tk) })
  if ($matched.Count -eq 0) {
    if ($opened -ge $cutEarliest) { $buckets.inside += "$symbol $side tk=$tk opened=$($opened.ToString('MM-dd HH:mm')) closed=$($closed.ToString('MM-dd HH:mm'))" }
    else { $buckets.beyond += "$symbol $side tk=$tk opened=$($opened.ToString('MM-dd HH:mm')) closed=$($closed.ToString('MM-dd HH:mm'))" }
    continue
  }
  $closingSide = if ($side -eq 'sell') { 'buy' } else { 'sell' }
  $exitDeals = @($matched | Where-Object { $_.side -eq $closingSide })
  if ($exitDeals.Count -gt 0) {
    $last = $exitDeals | Sort-Object time | Select-Object -Last 1
    $buckets.closing += "$symbol $side tk=$tk closed=$($closed.ToString('MM-dd HH:mm')) n=$($matched.Count) sides=$($matched.side -join ',') exitReason=$($last.reason) exitComment=[$($last.comment)]"
  } else {
    $buckets.openingOnly += "$symbol $side tk=$tk closed=$($closed.ToString('MM-dd HH:mm')) n=$($matched.Count) sides=$($matched.side -join ',') reasons=$($matched.reason -join ',') comments=[$(($matched.comment) -join '|')]"
  }
}

Write-Output "SERVED WITH A CLOSING DEAL (should be attributable!): $($buckets.closing.Count)"
$buckets.closing | ForEach-Object { "  $_" }
Write-Output ''
Write-Output "SERVED, OPENING DEAL ONLY (no closing side found): $($buckets.openingOnly.Count)"
$buckets.openingOnly | ForEach-Object { "  $_" }
Write-Output ''
Write-Output "UNSERVED, OPENED INSIDE A PLAUSIBLE WINDOW (investigate): $($buckets.inside.Count)"
$buckets.inside | ForEach-Object { "  $_" }
Write-Output ''
Write-Output "UNSERVED, OPENED BEFORE BOTH WINDOWS (terminal retention wall): $($buckets.beyond.Count)"
$buckets.beyond | Select-Object -First 10 | ForEach-Object { "  $_" }
if ($buckets.beyond.Count -gt 10) { Write-Output "  … and $($buckets.beyond.Count - 10) more" }

$u = & $mysql -utradingcs "-p$pw" tradingcs -N -B -e "SELECT COUNT(*), MIN(closedAt), MAX(closedAt) FROM trade WHERE provider='mt5' AND status='closed' AND (closeReason IS NULL OR closeReason='broker:unknown') AND (brokerTicket IS NULL OR brokerTicket='');" 2>$null
Write-Output ''
Write-Output "unticketed gap rows: $u"
