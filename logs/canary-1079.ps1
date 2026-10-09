# #1079 canary — disable both account filters, prove the specs fail, restore, verify hashes.
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
    $fail = [regex]::Match($out, 'Tests:\s+.*?(\d+) failed').Groups[1].Value
    $passed = [regex]::Match($out, 'Tests:\s+(\d+) passed').Groups[1].Value
    Write-Host ("{0}: mutated -> {1} passed, {2} failed | restore {3}" -f $File, $passed, ($fail -replace '^$','0'), ($(if ($h1 -eq $h2) { 'OK' } else { 'FAILED' })))
}

# 1. Duplicate guard — remove the account filter on positions (keep the code COMPILING so the
#    failure is the TEST failing, not the suite failing to build).
Mutate-Run-Restore `
    -File 'nest\src\modules\trading\duplicate-guard.service.ts' `
    -Old '          ? positions.filter((p: any) => !p.accountId || String(p.accountId) === String(accountId))' `
    -New '          ? positions.filter((p: any) => true || !p.accountId || String(p.accountId) === String(accountId))' `
    -Spec 'src/modules/trading/duplicate-guard.service.spec.ts'

# 2. Pyramid policy — remove the cross-account exclusion.
Mutate-Run-Restore `
    -File 'nest\src\modules\trading\pyramid-policy.service.ts' `
    -Old '      if (params.accountId && rowAccount && String(rowAccount) !== String(params.accountId)) return false;' `
    -New '      if (false && params.accountId && rowAccount && String(rowAccount) !== String(params.accountId)) return false;' `
    -Spec 'src/modules/trading/pyramid-policy.account-scope.spec.ts'
