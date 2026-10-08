# CANARY (#1088) — prove the FX-holiday guard fails when the fix is removed, in both directions.
#
# M1: the FX Christmas Day row removed from FX_HOLIDAYS → the table half of the fix is gone.
# M2: the weekly-session holiday lookup forced to null → the INTEGRATION half is gone (the row
#     would exist but `getWeeklyStatus` would never consult it — the exact shape the original
#     defect had: the mechanism existed for US and the weekly path ignored it).
#
# Verdict regex uses `Tests:\s+(\d+) failed` — NEVER a bare `(\d+) failed` (which first matches
# `Test Suites: 1 failed`).

$ErrorActionPreference = 'Stop'
$repo = 'C:\wamp64\www\trading-command-suite'
$file = Join-Path $repo 'nest\src\modules\calendar\market-calendar.service.ts'
$spec = 'src/modules/calendar/market-calendar.service.spec.ts'

$orig = [IO.File]::ReadAllText($file)
$sha = (Get-FileHash $file -Algorithm SHA256).Hash

$m1Anchor = "  { date: '2026-12-25', exchange: 'FX', status: 'closed', name: 'Christmas Day' },"
$m2Anchor = '    const holiday = this.findHoliday(this.formatDate(now, tz), exchange);'
$m2Repl = '    const holiday: HolidayEntry | null = null; // CANARY MUTATION M2 (#1088)'

if (-not $orig.Contains($m1Anchor)) { Write-Host 'CANARY INVALID: M1 anchor missing'; exit 2 }
if (-not $orig.Contains($m2Anchor)) { Write-Host 'CANARY INVALID: M2 anchor missing'; exit 2 }
# The M2 anchor must be UNIQUE — it is `formatDate(now, tz)`, which is the weekly path's form;
# the non-weekly path uses `dateStr`. If both matched, the mutation would hit the wrong branch.
if (($orig -split [regex]::Escape($m2Anchor)).Count -ne 2) { Write-Host 'CANARY INVALID: M2 anchor not unique'; exit 2 }

# ── direction 1: mutate both halves, run the spec ────────────────────────────────────────────
[IO.File]::WriteAllText($file, $orig.Replace($m1Anchor, '  // CANARY MUTATION M1 (#1088) — FX Christmas row removed').Replace($m2Anchor, $m2Repl))

Push-Location (Join-Path $repo 'nest')
try { $r1 = (npx jest $spec --silent 2>&1 | Out-String) } finally { Pop-Location }

[IO.File]::WriteAllText($file, $orig)
$restoreOk = ((Get-FileHash $file -Algorithm SHA256).Hash -eq $sha)
Write-Host "restore byte-for-byte: $restoreOk"
if (-not $restoreOk) { Write-Host 'CANARY INVALID: restore mismatch'; exit 2 }

$f1 = if ($r1 -match 'Tests:\s+(\d+) failed') { [int]$Matches[1] } else { 0 }
if ($f1 -lt 2 -or $r1 -notmatch 'Christmas Day 2026' -or $r1 -notmatch 'New Year') {
  Write-Host "CANARY FAIL: the mutilated service did not fail the Christmas/New Year cases (failed=$f1)"
  $r1.Substring(0, [Math]::Min(2500, $r1.Length))
  exit 1
}
Write-Host "direction 1 OK: M1+M2 failed $f1 case(s) (Christmas + New Year)"

# ── direction 2: restored ────────────────────────────────────────────────────────────────────
Push-Location (Join-Path $repo 'nest')
try { $p1 = (npx jest $spec --silent 2>&1 | Out-String) } finally { Pop-Location }
if ($p1 -match 'Tests:\s+(\d+) failed') { Write-Host 'CANARY FAIL: restored suite still failing'; exit 1 }
if ($p1 -notmatch '16 passed') {
  Write-Host 'CANARY FAIL: restored suite did not report the expected pass count (16)'
  exit 1
}
Write-Host 'direction 2 OK: restored suite passes (16)'
Write-Host 'CANARY PASS - both directions observed'
exit 0
