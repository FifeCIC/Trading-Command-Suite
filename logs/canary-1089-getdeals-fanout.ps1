# CANARY (#1089) — prove the multi-broker deal fan-out is what the suite is actually testing.
#
# Direction 1: force `fetchAllBrokerDeals` back to the single-URL path (brokerIds = []) →
#              the new getDeals cases MUST fail (that IS the #1089 defect).
# Direction 2: restore → the suite MUST pass again, byte-for-byte identical file.
#
# Verdict predicate uses the TESTS summary line — NEVER a bare `(\d+) failed` and never a
# "passed" substring. Two traps measured on 2026-10-08:
#   - a bare `(\d+) failed` first matches `Test Suites: 1 failed, 1 total`, under-reporting the
#     TEST count (this canary printed 1 when 2 tests had failed);
#   - a "passed" substring also matches "1 failed, 7 passed, 8 total" (the canary-1079 trap).

$ErrorActionPreference = 'Stop'
$repo = 'C:\wamp64\www\trading-command-suite'
$file = Join-Path $repo 'nest\src\modules\providers\adapters\mt5.adapter.ts'
$spec = 'src/modules/providers/adapters/mt5-adapter-multibroker.spec.ts'

$original = [IO.File]::ReadAllText($file)
$shaBefore = (Get-FileHash $file -Algorithm SHA256).Hash

# Anchored on the METHOD + next line so it cannot hit `fetchAllBrokerPositions`' identical line.
$anchor = @'
  private async fetchAllBrokerDeals(days: number): Promise<any[]> {
    const brokerIds = this.symbolRouter?.brokerIds?.() ?? [];
'@
$replacement = @'
  private async fetchAllBrokerDeals(days: number): Promise<any[]> {
    const brokerIds: number[] = []; // CANARY MUTATION (#1089)
'@

if (-not $original.Contains($anchor)) {
  Write-Host 'CANARY INVALID: anchor not found in mt5.adapter.ts — refusing to report'
  exit 2
}
$mutated = $original.Replace($anchor, $replacement)
if ($mutated -eq $original) {
  Write-Host 'CANARY INVALID: replace made no change — refusing to report'
  exit 2
}

Write-Host '--- direction 1: mutation (single-URL regression) ---'
[IO.File]::WriteAllText($file, $mutated)
Push-Location (Join-Path $repo 'nest')
try { $result1 = (npx jest $spec --silent 2>&1 | Out-String) } finally { Pop-Location }

[IO.File]::WriteAllText($file, $original)
$shaAfter = (Get-FileHash $file -Algorithm SHA256).Hash
Write-Host "restore byte-for-byte: $($shaAfter -eq $shaBefore)"
if ($shaAfter -ne $shaBefore) {
  Write-Host 'CANARY INVALID: restore is NOT byte-identical — refusing to report'
  exit 2
}

$failed = if ($result1 -match 'Tests:\s+(\d+) failed') { [int]$Matches[1] } else { 0 }
if ($failed -lt 1) {
  Write-Host 'CANARY FAIL: the single-URL mutation did NOT fail the suite — the tests do not pin the fan-out'
  $result1.Substring(0, [Math]::Min(3000, $result1.Length))
  exit 1
}
if ($result1 -notmatch 'queries EVERY active broker and merges the deals') {
  Write-Host "CANARY FAIL: the suite failed ($failed) but not on the fan-out test — mutation hit the wrong thing"
  $result1.Substring(0, [Math]::Min(3000, $result1.Length))
  exit 1
}
Write-Host "direction 1 OK: mutated suite failed ($failed test(s)), including the fan-out test"

Write-Host '--- direction 2: restored file ---'
Push-Location (Join-Path $repo 'nest')
try { $result2 = (npx jest $spec --silent 2>&1 | Out-String) } finally { Pop-Location }
if ($result2 -match 'Tests:\s+(\d+) failed') {
  Write-Host "CANARY FAIL: restored suite still failing ($($Matches[1])) — restore or fix is wrong"
  $result2.Substring(0, [Math]::Min(3000, $result2.Length))
  exit 1
}
if ($result2 -notmatch '8 passed') {
  Write-Host 'CANARY FAIL: restored suite did not report 8 passed'
  $result2.Substring(0, [Math]::Min(3000, $result2.Length))
  exit 1
}
Write-Host 'direction 2 OK: restored suite passes (8 tests)'
Write-Host 'CANARY PASS — both directions observed'
exit 0
