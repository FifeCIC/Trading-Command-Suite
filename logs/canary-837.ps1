# #837 canary — prove the informational counter moves when a synthetic duplicate-bucket row exists.
$ErrorActionPreference = 'Stop'
$repo = 'C:\wamp64\www\trading-command-suite'
$pw = 'tradingcs_dev_2026'
$mysql = 'C:\wamp64\bin\mysql\mysql9.1.0\bin\mysql.exe'

function Probe-Count {
    Set-Location (Join-Path $repo 'nest')
    $out = node scripts/contract-probe.cjs 2>&1 | Out-String
    Set-Location $repo
    $m = [regex]::Match($out, 'pairs=(\d+)')
    if (-not $m.Success) { Write-Host 'PROBE DID NOT REPORT pairs='; Write-Host ($out.Substring([Math]::Max(0, $out.Length - 800))); exit 1 }
    return [int]$m.Groups[1].Value
}

# Pick a symbol+timeframe+provider whose bar at T MOVED (close != open) AND has NO successor at
# T+1min. The GAP matters: crypto prints a bar every minute, so inserting over an existing next
# minute breaks the LAG adjacency the count depends on (first attempt: DURING == BEFORE for this
# exact reason — a real 21:57 bar already existed).
$pickSql = @"
SELECT m1.symbolId, m1.timeframe, m1.provider, m1.timestamp, m1.open FROM marketbar m1
WHERE m1.timeframe='1m' AND m1.close <> m1.open
  AND m1.timestamp > NOW() - INTERVAL 20 HOUR
  AND NOT EXISTS (
    SELECT 1 FROM marketbar m2
    WHERE m2.symbolId = m1.symbolId AND m2.timeframe = m1.timeframe
      AND m2.provider = m1.provider AND m2.timestamp = DATE_ADD(m1.timestamp, INTERVAL 1 MINUTE)
  )
ORDER BY m1.timestamp DESC LIMIT 1;
"@
$pick = & $mysql -utradingcs "-p$pw" tradingcs -e $pickSql 2>$null | Select-Object -Skip 1 | Select-Object -First 1
if (-not $pick) { Write-Host 'CANARY INVALID - no moved 1m bar found'; exit 1 }
$cols = ($pick -split "`t")
$symbolId = $cols[0]; $timeframe = $cols[1]; $provider = $cols[2]; $ts = $cols[3]; $open = $cols[4]
Write-Host "anchor: $symbolId $timeframe $provider @ $ts open=$open"

$before = Probe-Count
Write-Host "pairs BEFORE: $before"

$insertSql = "INSERT INTO marketbar (id, symbolId, provider, timeframe, timestamp, open, high, low, close, volume) VALUES ('canary-837-dup', '$symbolId', '$provider', '$timeframe', DATE_ADD('$ts', INTERVAL 1 MINUTE), $open, $open, $open, $open, 1.0);"
& $mysql -utradingcs "-p$pw" tradingcs -e $insertSql 2>$null
Write-Host 'synthetic duplicate row INSERTED'

$during = Probe-Count
Write-Host "pairs DURING: $during"

& $mysql -utradingcs "-p$pw" tradingcs -e "DELETE FROM marketbar WHERE id = 'canary-837-dup';" 2>$null
$after = Probe-Count
Write-Host "pairs AFTER delete: $after"

$ok1 = ($during -ge ($before + 1))
$ok2 = ($after -eq $before)
Write-Host ("CANARY: during>=before+1 -> {0} ; after==before -> {1}" -f $ok1, $ok2)
if (-not ($ok1 -and $ok2)) { exit 1 }
