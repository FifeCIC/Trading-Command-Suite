# #866 canary — disable the unconditional increment, prove the new spec fails, restore.
# Written as a file because the adapter's template-literal backticks cannot survive an
# inline PowerShell command line.
$ErrorActionPreference = 'Stop'
$repo = 'C:\wamp64\www\trading-command-suite'
$f = Join-Path $repo 'nest\src\modules\providers\adapters\mt5.adapter.ts'
$orig = [IO.File]::ReadAllText($f)
$h1 = (Get-FileHash $f -Algorithm SHA256).Hash

$old = @"
      // not by excusing the most common outage. Threshold unchanged (MAX_ERRORS = 10).
      breaker.consecutiveErrors++;
"@

$new = @"
      // CANARY: increment disabled to prove the spec can fail.
      if ($false) { breaker.consecutiveErrors++; }
"@

if (-not $orig.Contains($old)) { Write-Host 'CANARY INVALID - anchor not found'; exit 1 }
$mut = $orig.Replace($old, $new)
[IO.File]::WriteAllText($f, $mut)

Set-Location (Join-Path $repo 'nest')
$out = npx jest src/modules/providers/adapters/mt5-adapter-breaker-isolation.spec.ts 2>&1 | Out-String
Set-Location $repo
[IO.File]::WriteAllText($f, $orig)
$h2 = (Get-FileHash $f -Algorithm SHA256).Hash

$tests = [regex]::Matches($out, 'Tests:\s+.*').Value
$failLine = [regex]::Matches($out, '\d+ failed').Value
Write-Host ("MUTATED RUN: {0} | failures: {1}" -f ($tests -join ''), ($failLine -join ','))
if ($h1 -eq $h2) { Write-Host 'RESTORED - hash matches' } else { Write-Host 'RESTORE FAILED'; exit 1 }
