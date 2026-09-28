$ErrorActionPreference = 'Continue'
Set-Location C:\wamp64\www\trading-command-suite
$o = 'logs\pc-validate.txt'
"=== css tokens ===" | Out-File -Encoding utf8 $o
node scripts/validate-css-tokens.cjs *>> $o; "  rc=$LASTEXITCODE" | Out-File -Append -Encoding utf8 $o
"=== notices ===" | Out-File -Append -Encoding utf8 $o
node scripts/validate-notices.cjs *>> $o; "  rc=$LASTEXITCODE" | Out-File -Append -Encoding utf8 $o
"=== css tokens for the two new files only ===" | Out-File -Append -Encoding utf8 $o
Select-String -Path src\components\change-stat.css,src\pages\performance-change.css -Pattern 'var\(--[a-z-]+\)' -AllMatches |
  ForEach-Object { $_.Matches.Value } | Sort-Object -Unique | Out-File -Append -Encoding utf8 $o
"=== regenerate editions mirrors ===" | Out-File -Append -Encoding utf8 $o
node scripts/generate-free-map.cjs *>> $o; "  map rc=$LASTEXITCODE" | Out-File -Append -Encoding utf8 $o
node scripts/generate-free-manifest.cjs *>> $o; "  manifest rc=$LASTEXITCODE" | Out-File -Append -Encoding utf8 $o
node scripts/generate-free-registry.cjs *>> $o; "  registry rc=$LASTEXITCODE" | Out-File -Append -Encoding utf8 $o
"=== verify view-meta routes ===" | Out-File -Append -Encoding utf8 $o
node scripts/verify-view-meta-routes.cjs *>> $o; "  rc=$LASTEXITCODE" | Out-File -Append -Encoding utf8 $o
"ALLDONE"
