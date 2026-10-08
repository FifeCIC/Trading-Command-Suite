# Canary for #1086 — alert-risk-cap-breach.spec.ts   (v2)
#
# ⚠️ v1 WAS WRONG IN TWO WAYS, AND BOTH WERE IN THIS SCRIPT RATHER THAN IN THE GUARD:
#   1. PowerShell treats `''` inside a single-quoted string as ONE literal quote, so two anchors
#      silently became un-matchable text. The canary correctly reported "anchor not found" instead
#      of a false pass — which is the whole reason the INVALID state exists.
#   2. The title mutation injected a literal `${n}` (single quotes in TS do not interpolate), so it
#      added no digit and could not fail a "no digits in the title" assertion.
# Here-strings (`@'…'@`) are literal, so quotes survive verbatim.
$ErrorActionPreference = 'Stop'
Set-Location 'c:\wamp64\www\trading-command-suite'

$svc = 'nest\src\modules\alerts\alert-trigger.service.ts'
function Hash($p) { (Get-FileHash $p -Algorithm SHA256).Hash }

function RunSpec {
  Push-Location nest
  $out = npx jest src/modules/alerts/alert-risk-cap-breach.spec.ts 2>&1 | Out-String
  Pop-Location
  ($out -split "`n" | Where-Object { $_ -match '^Tests:' } | Select-Object -First 1).Trim()
}

$before = Hash $svc
Write-Output "baseline : $(RunSpec)"
Write-Output "sha256   : $before"
Write-Output ''

$canaries = @(
  @{ Name = 'A — report a TRANSIENT too (drop the below-the-bar guard)'
     From = @'
    if (n < minRefusals) return { triggered: false, title: '', message: '' };
'@
     To   = @'
    if (false) return { triggered: false, title: '', message: '' };
'@ },
  @{ Name = 'B — treat the CAPACITY cap as self-blocking too (collapse C)'
     From = @'
    const isDailyLossCap = key === 'risk-daily-loss';
'@
     To   = @'
    const isDailyLossCap = true;
'@ },
  @{ Name = 'C — stop attending the self-blocking cap (no Windows toast)'
     From = @'
  private readonly ATTENTION_KEYS = new Set(['trade-disabled', 'mt5-disconnected', 'risk-daily-loss']);
'@
     To   = @'
  private readonly ATTENTION_KEYS = new Set(['trade-disabled', 'mt5-disconnected']);
'@ },
  @{ Name = 'D — window on NOW() instead of UTC_TIMESTAMP() (fires never, silently)'
     From = @'
          AND timestamp >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${RISK_CAP_BREACH_WINDOW_MIN} MINUTE)
'@
     To   = @'
          AND timestamp >= DATE_SUB(NOW(), INTERVAL ${RISK_CAP_BREACH_WINDOW_MIN} MINUTE)
'@ },
  @{ Name = 'E — put the COUNT in the title (fractures rows)'
     From = @'
      title: isDailyLossCap ? 'Trading blocked by the daily-loss cap' : 'Trading blocked by the portfolio-risk cap',
'@
     To   = @'
      title: isDailyLossCap ? `Trading blocked - ${n} orders` : 'Trading blocked by the portfolio-risk cap',
'@ },
  @{ Name = 'F — restore the OVERSTATED claim (cannot clear until local midnight)'
     From = @'
            ' ⚠️ This does NOT clear by trading out of it — opening a position is the very thing it' +
'@
     To   = @'
            ' ⚠️ This is a LATCH — it cannot clear until local midnight, so every bot stays blocked' +
'@ }
)

$bad = 0
foreach ($c in $canaries) {
  $src = [System.IO.File]::ReadAllText((Resolve-Path $svc))
  if (-not $src.Contains($c.From)) {
    Write-Output "CANARY INVALID — [$($c.Name)] : anchor not found, edit was NOT made. Refusing to report."
    Write-Output ''
    $bad++
    continue
  }
  [System.IO.File]::WriteAllText((Resolve-Path $svc), $src.Replace($c.From, $c.To))
  if ((Hash $svc) -eq $before) {
    Write-Output "CANARY INVALID — [$($c.Name)] : hash unchanged, edit did NOT land. Refusing to report."
    [System.IO.File]::WriteAllText((Resolve-Path $svc), $src)
    Write-Output ''
    $bad++
    continue
  }

  $result = RunSpec
  # "did ANY test fail" — and a suite that failed to RUN ("Tests: 0 total") does NOT count as the
  # guard failing, so it is a misbehaving canary rather than a pass.
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
