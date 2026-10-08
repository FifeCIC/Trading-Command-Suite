# Mirror the finaliser's deal resolution for every ticketed broker:unknown row (#1093 follow-up).
# Answers ONE question: for rows the RECOVERY calls "served", does finalizeClosedPosition's own
# matching (positionId -> orderId indirection, then closing-side filter) find a closing deal?
$ErrorActionPreference = 'Continue'
$pw = 'tradingcs_dev_2026'
$mysql = 'C:\wamp64\bin\mysql\mysql9.1.0\bin\mysql.exe'

# 1. The remaining ticketed gaps
$q = "SELECT id, symbol, side, brokerTicket, DATE_FORMAT(openedAt,'%Y-%m-%dT%H:%i:%sZ') FROM trade WHERE provider='mt5' AND status='closed' AND closeReason='broker:unknown' AND brokerTicket IS NOT NULL AND brokerTicket<>''"
$rows = & $mysql -utradingcs "-p$pw" tradingcs -N -e $q 2>$null

# 2. Merged deals, broad window (the bridge's own /history/recover used from = min(openedAt))
$a = curl.exe -s --max-time 90 'http://localhost:5000/history?days=150' | ConvertFrom-Json
$b = curl.exe -s --max-time 90 'http://localhost:5001/history?days=150' | ConvertFrom-Json
$all = @($a.deals) + @($b.deals)
Write-Output "merged deals: $($all.Count) (:5000=$($a.deals.Count), :5001=$($b.deals.Count))"

$served = 0; $unserved = 0; $exitEmpty = 0; $exitFound = 0
$cases = @()
foreach ($line in $rows) {
    if (-not $line.Trim()) { continue }
    $p = $line -split "`t"
    $id = $p[0]; $symbol = $p[1]; $side = $p[2].ToLower(); $t = $p[3].Trim(); $opened = $p[4]

    # served = the bridge's check: ticket appears as position id OR order id
    $byPosDirect = @($all | Where-Object { [string]$_.positionId -eq $t })
    $asOrder = $all | Where-Object { [string]$_.orderId -eq $t } | Select-Object -First 1
    $isServed = ($byPosDirect.Count -gt 0) -or ($null -ne $asOrder)
    if (-not $isServed) { $unserved++; continue }
    $served++

    # finaliser resolution: byPosition first; else order -> position -> filter
    $byPos = $byPosDirect
    $posId = $t
    $resolvedFromOrder = $false
    if ($byPos.Count -eq 0 -and $asOrder) {
        $posId = [string]$asOrder.positionId
        $byPos = @($all | Where-Object { [string]$_.positionId -eq $posId })
        $resolvedFromOrder = $true
    }
    $closingSide = if ($side -eq 'sell') { 'buy' } else { 'sell' }
    $exit = @($byPos | Where-Object { $_.type -eq $closingSide })
    $last = $exit | Select-Object -Last 1
    if ($exit.Count -eq 0) { $exitEmpty++ } else { $exitFound++ }
    $cases += [pscustomobject]@{
        ticket = $t; symbol = $symbol; side = $side; opened = $opened
        servedAs = if ($resolvedFromOrder) { 'order' } else { 'position' }
        byPos = $byPos.Count; posId = $posId; exitDeals = $exit.Count
        lastReason = if ($last) { $last.reason } else { '' }
        lastTime = if ($last) { $last.time } else { '' }
    }
}

Write-Output "served=$served unserved=$unserved  (of $($rows.Count) rows)"
Write-Output "served with exitDeals>0: $exitFound   served with exitDeals=0: $exitEmpty"
Write-Output ''
Write-Output '=== served rows (up to 20) ==='
$cases | Select-Object -First 20 | Format-Table -AutoSize | Out-String -Width 220
Write-Output '=== served rows by symbol ==='
$cases | Group-Object symbol | Sort-Object Count -Descending | ForEach-Object { "$($_.Name): $($_.Count)" }
Write-Output ''
Write-Output '=== UNSERVED rows by symbol (for contrast) ==='
$uns = @()
foreach ($line in $rows) {
    if (-not $line.Trim()) { continue }
    $p = $line -split "`t"; $t = $p[3].Trim()
    $hit = (@($all | Where-Object { [string]$_.positionId -eq $t -or [string]$_.orderId -eq $t }).Count -gt 0)
    if (-not $hit) { $uns += $p[1] }
}
$uns | Group-Object | Sort-Object Count -Descending | ForEach-Object { "$($_.Name): $($_.Count)" }
