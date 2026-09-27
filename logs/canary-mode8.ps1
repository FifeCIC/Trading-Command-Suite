# Canary for MODE 8 (bar starvation) in directive-guard.cjs.
#
# Why this file exists: a guard that has never been observed to fail is a
# decoration, not a guard. Each canary patches the classifier so it is WRONG in
# one direction, runs the self-test, and requires the self-test to report FAIL.
# The restore is verified by SHA256, because a canary that leaves the tree
# modified is worse than no canary.
#
# ⚠️ CORRECTION (2026-09-27). The first version of this file reported a FALSE PASS.
# `$a = Invoke-Case ...` captured the function's MESSAGE STRING as well as its
# boolean, so `$a -and $b` coerced a NON-EMPTY ARRAY to `$true` and the verdict was
# "PROVED" unconditionally — it would have said PROVED with the guard deleted. The
# messages now go to the HOST (`Write-Host`), not the pipeline, so the only value
# returned is the boolean. Case 0 below proves the canary CAN report failure.
#
# Usage:
#   pwsh -File logs/canary-mode8.ps1
# Exit 0 = the guard is proved to fail in both directions AND the tree is clean.

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

$file = (Resolve-Path 'nest\scripts\directive-guard.cjs').Path
$orig = [System.IO.File]::ReadAllText($file)
$hash0 = (Get-FileHash $file -Algorithm SHA256).Hash
"baseline SHA256 : $hash0"

if ($orig -notmatch 'STARVATION_RATIO = 0\.5;') { "CANARY INVALID - anchor not found; refusing to report"; exit 2 }

# Returns $true only when the guard behaved as required. Writes nothing to the
# pipeline except that boolean.
function Invoke-Case {
  param([string]$Name, [string]$From, [string]$To, [int]$ExpectExit)
  $patched = $orig.Replace($From, $To)
  if ($patched -eq $orig) {
    Write-Host "  CANARY INVALID [$Name] - edit did not land (anchor absent)"
    return $false
  }
  [System.IO.File]::WriteAllText($file, $patched)
  node $file --self-test *> $null
  $code = $LASTEXITCODE
  [System.IO.File]::WriteAllText($file, $orig)
  $ok = ($code -eq $ExpectExit)
  Write-Host ("  {0} [{1}] self-test exit={2} (expected {3})" -f $(if ($ok) { 'PASS' } else { 'FAIL' }), $Name, $code, $ExpectExit)
  return $ok
}

Write-Host ''
Write-Host 'CASE 0 - a bogus anchor must report INVALID, not PASS (proves this canary can fail)'
$c0 = Invoke-Case -Name 'bogus-anchor' -From 'const THIS_ANCHOR_DOES_NOT_EXIST = 1;' -To 'x' -ExpectExit 1
Write-Host ("  -> returned {0} (expected False)" -f $c0)

Write-Host ''
Write-Host 'CANARY A - make the guard BLIND (nothing can ever be chronic)'
$a = Invoke-Case -Name 'blind' -From 'const STARVATION_RATIO = 0.5;' -To 'const STARVATION_RATIO = 1.01;' -ExpectExit 1

Write-Host ''
Write-Host 'CANARY B - make the guard OVER-FIRE (a single gap counts as chronic)'
$b = Invoke-Case -Name 'over-fire' -From 'const STARVATION_MIN_TICKS = 20;' -To 'const STARVATION_MIN_TICKS = 0;' -ExpectExit 1

$hash1 = (Get-FileHash $file -Algorithm SHA256).Hash
$restored = ($hash0 -eq $hash1)
Write-Host ''
Write-Host "restore byte-for-byte : $restored"
if (-not $restored) { Write-Host "  baseline $hash0"; Write-Host "  restored $hash1" }

node $file --self-test *> $null
$final = $LASTEXITCODE
Write-Host "restored self-test    : exit=$final (expected 0)"

# Case 0 must return FALSE for the canary itself to be trustworthy: a canary that
# cannot report failure is the defect it exists to catch.
$canaryTrustworthy = (-not $c0)
$verdict = ($canaryTrustworthy -and $a -and $b -and $restored -and $final -eq 0)
Write-Host ''
Write-Host ("canary can report failure : {0}" -f $canaryTrustworthy)
Write-Host ("CANARY VERDICT: " + $(if ($verdict) { 'GUARD PROVED (fails when broken, passes when restored)' } else { 'NOT PROVED' }))
if ($verdict) { exit 0 } else { exit 1 }
