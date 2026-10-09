# Canary for scoring.ranked-denominator.spec.ts (#1090)
# Proves the spec FAILS when the contract regresses, then restores byte-for-byte.
$ErrorActionPreference = 'Stop'
$file = 'nest\src\modules\scoring\scoring.service.ts'
$spec = 'scoring.ranked-denominator'

function Run-Spec {
  $out = npm --prefix nest run test -- $spec --silent 2>&1 | Out-String
  if ($out -match 'Tests:\s+(\d+) failed') { return [int]$Matches[1] }
  if ($out -match 'Tests:\s+(\d+) passed') { return 0 }
  return -999
}

$original = [System.IO.File]::ReadAllText($file)
$sha0 = (Get-FileHash $file -Algorithm SHA256).Hash
Write-Host "baseline sha: $sha0"

# ── Canary 1: re-introduce the fabricated denominator (header + both branches) ──
$n1 = ([regex]::Matches($original, 'maxPossibleScore: null')).Count
if ($n1 -lt 3) { Write-Host "CANARY 1 INVALID — only $n1 sites matched, expected >=3"; exit 2 }
$mut1 = $original.Replace('maxPossibleScore: null', 'maxPossibleScore: 100')
[System.IO.File]::WriteAllText($file, $mut1)
$f1 = Run-Spec
Write-Host "canary1 (denominator=100, $n1 sites) failures: $f1"
[System.IO.File]::WriteAllText($file, $original)

# ── Canary 2: break the percentage passthrough ──
$old2 = 'const normalizedScore = Number.isFinite(Number(s.signalPct)) ? Number(s.signalPct) : 0;'
if (-not $original.Contains($old2)) { Write-Host 'CANARY 2 INVALID — pattern not found'; exit 2 }
$mut2 = $original.Replace($old2, 'const normalizedScore = 0;')
[System.IO.File]::WriteAllText($file, $mut2)
$f2 = Run-Spec
Write-Host "canary2 (normalizedScore=0) failures: $f2"
[System.IO.File]::WriteAllText($file, $original)

# ── Restore + verify ──
$sha1 = (Get-FileHash $file -Algorithm SHA256).Hash
$ok = ($sha1 -eq $sha0)
$f0 = Run-Spec
Write-Host "restored sha: $sha1  match=$ok"
Write-Host "baseline after restore failures: $f0"
if (-not $ok) { Write-Host 'RESTORE FAILED'; exit 3 }
if ($f1 -le 0 -or $f2 -le 0) { Write-Host 'CANARY DID NOT FIRE — guard is a decoration'; exit 4 }
Write-Host 'CANARY OK — both directions fire, restore verified'
