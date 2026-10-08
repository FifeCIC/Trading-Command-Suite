# Canary for the currency-symbol guard (#1086 follow-up)
#
# ⚠️ This guard was itself a FALSE POSITIVE on its first run — it matched the docblock that quotes
# the old string. Comment lines are now excluded, and that is the third occurrence of this pattern in
# two days (see `ab-arm-accounts.spec.ts`). Recorded here so the next author writes the filter first.
$ErrorActionPreference = 'Stop'
Set-Location 'c:\wamp64\www\trading-command-suite'

$svc  = 'nest\src\modules\trading\trading-strategy.service.ts'
$spec = 'nest\src\modules\trading\assess-global-risk-limits.spec.ts'
function Hash($p) { (Get-FileHash $p -Algorithm SHA256).Hash }

function RunSpec {
  Push-Location nest
  $out = npx jest src/modules/trading/assess-global-risk-limits.spec.ts 2>&1 | Out-String
  Pop-Location
  ($out -split "`n" | Where-Object { $_ -match '^Tests:' } | Select-Object -First 1).Trim()
}

$before = Hash $svc
Write-Output "baseline : $(RunSpec)"
Write-Output ''

$canaries = @(
  @{ Name = 'A — restore the $-labelled loss figure'
     From = @'
        return { allowed: false, reason: `Daily loss ${Math.abs(dailyPnl).toFixed(2)} exceeds risk.maxDailyLoss (${maxDailyLoss}) [account currency]` };
'@
     To   = @'
        return { allowed: false, reason: `Daily loss $${Math.abs(dailyPnl).toFixed(2)} exceeds risk.maxDailyLoss ($${maxDailyLoss})` };
'@ },
  @{ Name = 'B — drop the unit note, so the message names no unit at all'
     From = @'
 [account currency]` };
'@
     To   = @'
` };
'@ }
)

$bad = 0
foreach ($c in $canaries) {
  $src = [System.IO.File]::ReadAllText((Resolve-Path $svc))
  if (-not $src.Contains($c.From)) {
    Write-Output "CANARY INVALID — [$($c.Name)] : anchor not found, edit NOT made. Refusing to report."
    Write-Output ''
    $bad++; continue
  }
  [System.IO.File]::WriteAllText((Resolve-Path $svc), $src.Replace($c.From, $c.To))
  if ((Hash $svc) -eq $before) {
    Write-Output "CANARY INVALID — [$($c.Name)] : hash unchanged, edit did NOT land. Refusing to report."
    [System.IO.File]::WriteAllText((Resolve-Path $svc), $src)
    Write-Output ''
    $bad++; continue
  }

  $result = RunSpec
  $observedFail = ($result -match '\d+ failed') -and ($result -notmatch 'Tests:\s+0 total')

  [System.IO.File]::WriteAllText((Resolve-Path $svc), $src)
  $restored = (Hash $svc) -eq $before

  $verdict = if ($observedFail -and $restored) { 'FAILED AS REQUIRED' } else { 'DID NOT FAIL  <-- problem' }
  if (-not ($observedFail -and $restored)) { $bad++ }
  Write-Output "$verdict  [$($c.Name)]"
  Write-Output "    result  : $result"
  Write-Output "    restore : $(if ($restored) { 'byte-for-byte OK' } else { 'NOT RESTORED' })"
  Write-Output ''
}

Write-Output "final sha256 : $(Hash $svc)  $(if ((Hash $svc) -eq $before) { '(unchanged)' } else { '(CHANGED!)' })"
Write-Output "canaries that did not behave: $bad"
Write-Output "final run: $(RunSpec)"
Write-Output "spec sha256 (unchanged by design): $(Hash $spec)"
