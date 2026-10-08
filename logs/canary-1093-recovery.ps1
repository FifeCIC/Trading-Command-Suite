# CANARY (#1093) — prove both new guards fail when their behaviour is removed.
#
# M1: `rederivable` forced false → the repair pass must FAIL to re-derive broker:unknown
#     (reap spec: 'RE-DERIVES broker:unknown ...' fails).
# M2: `recoverDeals`' broker list forced empty → the ticket list must stop reaching every broker
#     (multibroker spec: 'recoverDeals fans the ticket list to EVERY broker' fails).
# M3: `DEAL_LOOKBACK_GRACE_MS` forced to 0 → the fetch window loses the order→position bridge deal
#     that falls before `openedAt` (reap spec: 'looks BEFORE openedAt ...' fails).
#
# Verdict regex uses `Tests:\s+(\d+) failed` — NEVER a bare `(\d+) failed` (which first matches
# `Test Suites: 1 failed`) and never a "passed" substring.

$ErrorActionPreference = 'Stop'
$repo = 'C:\wamp64\www\trading-command-suite'
$psFile = Join-Path $repo 'nest\src\modules\providers\position-sync.service.ts'
$adFile = Join-Path $repo 'nest\src\modules\providers\adapters\mt5.adapter.ts'
$reapSpec = 'src/modules/providers/position-sync-ticketed-reap.spec.ts'
$mbSpec = 'src/modules/providers/adapters/mt5-adapter-multibroker.spec.ts'

$psOrig = [IO.File]::ReadAllText($psFile)
$adOrig = [IO.File]::ReadAllText($adFile)
$psSha = (Get-FileHash $psFile -Algorithm SHA256).Hash
$adSha = (Get-FileHash $adFile -Algorithm SHA256).Hash

$m1Anchor = '      const rederivable = opts.allowClosed && existingReason === CLOSE_REASONS.BROKER_UNKNOWN;'
$m3Anchor = 'export const DEAL_LOOKBACK_GRACE_MS = 2 * 86_400_000;'
$m2Anchor = "    const brokerIds = this.symbolRouter?.brokerIds?.() ?? [];`r`n    const targets:"
$m2Repl = "    const brokerIds: number[] = []; // CANARY MUTATION (#1093)`r`n    const targets:"

if (-not $psOrig.Contains($m1Anchor)) { Write-Host 'CANARY INVALID: M1 anchor missing'; exit 2 }
if (-not $psOrig.Contains($m3Anchor)) { Write-Host 'CANARY INVALID: M3 anchor missing'; exit 2 }
if (-not $adOrig.Contains($m2Anchor)) { Write-Host 'CANARY INVALID: M2 anchor missing'; exit 2 }

# ── direction 1: mutate all three, run both specs ───────────────────────────
[IO.File]::WriteAllText($psFile, $psOrig.Replace($m1Anchor, '      const rederivable = false; // CANARY MUTATION (#1093)').Replace($m3Anchor, 'export const DEAL_LOOKBACK_GRACE_MS = 0; // CANARY MUTATION M3 (#1093)'))
[IO.File]::WriteAllText($adFile, $adOrig.Replace($m2Anchor, $m2Repl))

Push-Location (Join-Path $repo 'nest')
try {
  $r1 = (npx jest $reapSpec --silent 2>&1 | Out-String)
  $r2 = (npx jest $mbSpec --silent 2>&1 | Out-String)
} finally { Pop-Location }

[IO.File]::WriteAllText($psFile, $psOrig)
[IO.File]::WriteAllText($adFile, $adOrig)
$restoreOk = ((Get-FileHash $psFile -Algorithm SHA256).Hash -eq $psSha) -and ((Get-FileHash $adFile -Algorithm SHA256).Hash -eq $adSha)
Write-Host "restore byte-for-byte: $restoreOk"
if (-not $restoreOk) { Write-Host 'CANARY INVALID: restore mismatch'; exit 2 }

$f1 = if ($r1 -match 'Tests:\s+(\d+) failed') { [int]$Matches[1] } else { 0 }
$f2 = if ($r2 -match 'Tests:\s+(\d+) failed') { [int]$Matches[1] } else { 0 }
if ($f1 -lt 2 -or $r1 -notmatch 'RE-DERIVES broker:unknown' -or $r1 -notmatch 'looks BEFORE openedAt') { Write-Host "CANARY FAIL: M1/M3 did not fail the re-derivation + bridge-deal cases (failed=$f1)"; $r1.Substring(0, [Math]::Min(2500, $r1.Length)); exit 1 }
if ($f2 -lt 1 -or $r2 -notmatch 'recoverDeals fans the ticket list') { Write-Host "CANARY FAIL: M2 did not fail the fan-out case (failed=$f2)"; $r2.Substring(0, [Math]::Min(2500, $r2.Length)); exit 1 }
Write-Host "direction 1 OK: M1/M3 failed $f1 (re-derivation + bridge-deal cases) · M2 failed $f2 (fan-out case)"

# ── direction 2: restored ────────────────────────────────────────────────────────────────────
Push-Location (Join-Path $repo 'nest')
try {
  $p1 = (npx jest $reapSpec --silent 2>&1 | Out-String)
  $p2 = (npx jest $mbSpec --silent 2>&1 | Out-String)
} finally { Pop-Location }
if (($p1 -match 'Tests:\s+(\d+) failed') -or ($p2 -match 'Tests:\s+(\d+) failed')) {
  Write-Host 'CANARY FAIL: restored suites still failing'
  exit 1
}
if ($p1 -notmatch '13 passed' -or $p2 -notmatch '10 passed') {
  Write-Host 'CANARY FAIL: restored suites did not report the expected pass counts (13 and 10)'
  exit 1
}
Write-Host 'direction 2 OK: restored suites pass (13 + 10)'
Write-Host 'CANARY PASS - both directions observed'
exit 0
