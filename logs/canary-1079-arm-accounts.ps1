# Canary for #1079 — ab-arm-accounts.spec.ts
#
# Proves the guard can FAIL, in both directions, and that the restore is byte-for-byte.
# Rule (development-philosophy §5): a canary must prove its own edit landed, refuse to report if
# it cannot make the edit, and leave the tree exactly as it found it.
#
# Untracked scratch — lives in logs/, never scripts/ (scripts/ stales docs/TOOLS-INDEX.md).

$ErrorActionPreference = 'Stop'
Set-Location 'c:\wamp64\www\trading-command-suite'

$svc  = 'nest\src\modules\automation\automation-loop.service.ts'
$spec = 'nest\src\modules\automation\ab-arm-accounts.spec.ts'

function Hash($p) { (Get-FileHash $p -Algorithm SHA256).Hash }

function RunSpec {
  Push-Location nest
  $out = npx jest src/modules/automation/ab-arm-accounts.spec.ts 2>&1 | Out-String
  Pop-Location
  # Returns a single line: the "Tests:" summary, which is what tells PASS from FAIL.
  ($out -split "`n" | Where-Object { $_ -match '^Tests:' } | Select-Object -First 1).Trim()
}

$svcBefore  = Hash $svc
$specBefore = Hash $spec

Write-Output "baseline : $(RunSpec)"
Write-Output "sha256 svc : $svcBefore"
Write-Output "sha256 spec: $specBefore"
Write-Output ''

$canaries = @(
  @{
    Name = 'A — restore the SHARED account resolution in the loop (the #1079 defect itself)'
    File = $svc
    From = "      // ⚠️ #1079 — EACH ARM TRADES ON ITS OWN ACCOUNT, handed in as ``brokerId``."
    To   = "      const brokerId = (controlCfg.brokerId ?? variantCfg.brokerId ?? 'mt5') as string;`n`n      // ⚠️ #1079 — EACH ARM TRADES ON ITS OWN ACCOUNT, handed in as ``brokerId``."
    MustFail = 'SOURCE guard'
  },
  @{
    Name = 'B — delete the same-account refusal (both arms may share one account again)'
    File = $svc
    From = '  if (a === b) {'
    To   = '  if (false && a === b) {'
    MustFail = 'same-account refusal test'
  },
  @{
    Name = 'C — stop trimming, so " mt5 " and "mt5" pass as two distinct accounts'
    File = $svc
    From = "  const read = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');"
    To   = "  const read = (v: unknown): string => (typeof v === 'string' ? v : '');"
    MustFail = 'trim test'
  },
  @{
    Name = 'D — hand BOTH sides account A (distinct values no longer wired)'
    File = $svc
    From = "      await evalSide('B', variantCfg, scoreB, accounts.accountB);"
    To   = "      await evalSide('B', variantCfg, scoreB, accounts.accountA);"
    MustFail = 'SOURCE guard'
  }
)

$failed = 0
foreach ($c in $canaries) {
  $before = Hash $c.File
  $src = [System.IO.File]::ReadAllText((Resolve-Path $c.File))
  if (-not $src.Contains($c.From)) {
    Write-Output "CANARY INVALID — $(($c.Name)) : anchor not found, edit was NOT made. Refusing to report."
    Write-Output ''
    $failed++
    continue
  }
  [System.IO.File]::WriteAllText((Resolve-Path $c.File), $src.Replace($c.From, $c.To))
  $after = Hash $c.File
  if ($after -eq $before) {
    Write-Output "CANARY INVALID — $(($c.Name)) : file hash unchanged, edit did NOT land. Refusing to report."
    [System.IO.File]::WriteAllText((Resolve-Path $c.File), $src)
    Write-Output ''
    $failed++
    continue
  }

  $result = RunSpec
  # ⚠️ The predicate is "did ANY test fail", NOT "is the summary not the passing one".
  # The first version read `$result -notmatch 'passed, 8 total'` — which also MATCHES
  # "1 failed, 7 passed, 8 total", so four working canaries were reported as DID NOT FAIL.
  # A verdict computed from the wrong predicate is worse than no verdict: it reads as evidence.
  $observedFail = $result -match '\d+ failed'

  # RESTORE, then verify byte-for-byte.
  [System.IO.File]::WriteAllText((Resolve-Path $c.File), $src)
  $restored = (Hash $c.File) -eq $before

  $verdict = if ($observedFail -and $restored) { 'FAILED AS REQUIRED' } else { 'DID NOT FAIL  <-- problem' }
  if (-not ($observedFail -and $restored)) { $failed++ }

  Write-Output "$verdict  [$($c.Name)]"
  Write-Output "    expected to break: $($c.MustFail)"
  Write-Output "    result  : $result"
  Write-Output "    restore : $(if ($restored) { 'byte-for-byte OK' } else { 'NOT RESTORED' })"
  Write-Output ''
}

# Prove the tree is exactly as found.
$svcAfter  = Hash $svc
$specAfter = Hash $spec
Write-Output "final sha256 svc : $svcAfter  $(if ($svcAfter -eq $svcBefore) { '(unchanged)' } else { '(CHANGED!)' })"
Write-Output "final sha256 spec: $specAfter  $(if ($specAfter -eq $specBefore) { '(unchanged)' } else { '(CHANGED!)' })"
Write-Output ''
Write-Output "canaries that did not behave: $failed"
Write-Output "final run: $(RunSpec)"
