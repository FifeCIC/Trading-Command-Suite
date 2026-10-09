# #803 canary — break each half of the kill switch, prove the spec fails, restore, verify hashes.
$ErrorActionPreference = 'Stop'
$repo = 'C:\wamp64\www\trading-command-suite'

function Mutate-Run-Restore {
    param([string]$File, [string]$Old, [string]$New, [string]$Spec)
    $path = Join-Path $repo $File
    $orig = [IO.File]::ReadAllText($path)
    $h1 = (Get-FileHash $path -Algorithm SHA256).Hash
    if (-not $orig.Contains($Old)) { Write-Host "CANARY INVALID ($File) - anchor not found"; exit 1 }
    [IO.File]::WriteAllText($path, $orig.Replace($Old, $New))
    Set-Location (Join-Path $repo 'nest')
    $out = npx jest $Spec --silent 2>&1 | Out-String
    Set-Location $repo
    [IO.File]::WriteAllText($path, $orig)
    $h2 = (Get-FileHash $path -Algorithm SHA256).Hash
    $fail = [regex]::Match($out, '(\d+) failed').Groups[1].Value
    Write-Host ("{0}: mutated -> {1} failed | restore {2}" -f (Split-Path $File -Leaf), ($fail -replace '^$','0'), ($(if ($h1 -eq $h2) { 'OK' } else { 'FAILED' })))
}

# 1. Remove the write-point active guard -> the inactive-write test must fail.
Mutate-Run-Restore `
    -File 'nest\src\modules\scoring\protocol-gating.service.ts' `
    -Old '      if (!(await this.isActiveProtocol(protocolId))) {' `
    -New '      if (false && !(await this.isActiveProtocol(protocolId))) {' `
    -Spec 'src/modules/scoring/single-scoring-path.spec.ts'

# 2. Restore the hardcoded `active: true` lie -> the fallback honesty tests must fail.
Mutate-Run-Restore `
    -File 'nest\src\modules\scoring\speed-scan.service.ts' `
    -Old '  if (fallbackSlug) return withDbActive(fallbackSlug, prisma);' `
    -New '  if (fallbackSlug) return { slug: fallbackSlug, active: true };' `
    -Spec 'src/modules/scoring/single-scoring-path.spec.ts'
