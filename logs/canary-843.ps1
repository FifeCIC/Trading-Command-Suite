# Canary for position-sizing.spec.ts (#843)
# Proves the spec FAILS when the maths or the constraints regress, then restores byte-for-byte.
# Single-line patterns only — multiline string matching is line-ending fragile.
$ErrorActionPreference = 'Stop'
$file = 'nest\src\modules\trading\position-sizing.ts'
$spec = 'position-sizing'

function Run-Spec {
  $out = npm --prefix nest run test -- $spec --silent 2>&1 | Out-String
  if ($out -match 'Tests:\s+(\d+) failed') { return [int]$Matches[1] }
  if ($out -match 'Tests:\s+(\d+) passed') { return 0 }
  return -999
}

$original = [System.IO.File]::ReadAllText($file)
$sha0 = (Get-FileHash $file -Algorithm SHA256).Hash
Write-Host "baseline sha: $sha0"

function Test-Canary([string]$label, [string]$old, [string]$new) {
  $src = [System.IO.File]::ReadAllText($file)
  if (-not $src.Contains($old)) { Write-Host "$label INVALID - pattern not found"; exit 2 }
  [System.IO.File]::WriteAllText($file, $src.Replace($old, $new))
  $f = Run-Spec
  Write-Host "$label failures: $f"
  [System.IO.File]::WriteAllText($file, $original)
  return $f
}

# ── Canary 1: break the equal-risk maths (divide by entry price instead of stop) ──
$f1 = Test-Canary 'canary1 (equal-risk divided by price)' '(riskPct / 100)) / stop, usedStopDistance: stop' '(riskPct / 100)) / entryPrice, usedStopDistance: stop'

# ── Canary 2: break the float-noise tolerance (0.3/0.1 loses a step) ──
$f2 = Test-Canary 'canary2 (no float tolerance)' 'const steps = Math.floor(raw / step + 1e-9);' 'const steps = Math.floor(raw / step);'

# ── Canary 3: unknown step silently guessed instead of refused ──
$f3 = Test-Canary 'canary3 (unknown step guessed)' 'const step = pos(constraints.volumeStep);' 'const step = pos(constraints.volumeStep) ?? 0.01;'

# ── Restore + verify ──
$sha1 = (Get-FileHash $file -Algorithm SHA256).Hash
$ok = ($sha1 -eq $sha0)
$f0 = Run-Spec
Write-Host "restored sha: $sha1  match=$ok"
Write-Host "baseline after restore failures: $f0"
if (-not $ok) { Write-Host 'RESTORE FAILED'; exit 3 }
if ($f1 -le 0 -or $f2 -le 0 -or $f3 -le 0) { Write-Host 'CANARY DID NOT FIRE - guard is a decoration'; exit 4 }
Write-Host 'CANARY OK - all three directions fire, restore verified'
