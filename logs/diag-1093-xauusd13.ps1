# #1093 follow-up — the 13 XAUUSD rows: did the broker ever close these positions?
# For each AB-929 ticket: the matched deal's positionId, every :5000 deal on that position, and the
# CURRENT open XAUUSD positions. A netting position still open would explain "opening deal only".
$pw = 'tradingcs_dev_2026'
$mysql = 'C:\wamp64\bin\mysql\mysql9.1.0\bin\mysql.exe'

$a = curl.exe -s --max-time 60 'http://localhost:5000/history/deals?days=120' | ConvertFrom-Json
$d0 = @($a.deals)

$tickets = @('152671260371','152671275599','152671275601','152671260359','152690988172','152704838352','152704838354','152704779073','152704747427','152704747466','152733559984','152733569074','152733639383')
foreach ($tk in $tickets) {
  $m = @($d0 | Where-Object { [string]$_.orderId -eq $tk -or [string]$_.positionId -eq $tk })
  if ($m.Count -eq 0) { Write-Output "$tk -> NO DEAL"; continue }
  $first = $m | Select-Object -First 1
  $pos = [string]$first.positionId
  $posDeals = @($d0 | Where-Object { [string]$_.positionId -eq $pos })
  Write-Output "tk=$tk -> matched=$($m.Count) dealPos=$pos | dealsOnPos=$($posDeals.Count) types=$(($posDeals.type | Select-Object -First 8) -join ',') reasons=$(($posDeals.reason | Select-Object -First 8) -join ',')"
}

Write-Output ''
Write-Output '=== CURRENT open positions on :5000 (XAUUSD and all) ==='
$p = curl.exe -s --max-time 30 'http://localhost:5000/positions' | ConvertFrom-Json
Write-Output "open positions: $($p.count)"
$p.positions | ForEach-Object { "  $($_.symbol) $($_.type) vol=$($_.volume) open=$($_.openTime) ticket=$($_.ticket) comment=[$($_.comment)]" }
