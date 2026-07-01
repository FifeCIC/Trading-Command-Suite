$promptsDir = "g:\My Drive\Project Management\Live\Trading-Command-Suite-Documentation\.agenticmemory\prompts"
$docsDir = "C:\wamp64\www\trading-command-suite\docs"

$designDocs = @('Q-MULTISCREEN-V1.md','Q-WIZARD-COLUMNS-V1.md')
foreach ($d in $designDocs) {
  $path = Join-Path $promptsDir $d
  if (Test-Path $path) { Move-Item $path (Join-Path $docsDir $d) -Force; Write-Output "DESIGN: $d" }
}

$done = @('protocol-calendar.md','protocol-risk-gating.md','Q235-Multi-Screen-Dashboard.md','Q242-HOTAS-Gamepad-Prototype.md')
foreach ($c in $done) {
  $path = Join-Path $promptsDir $c
  if (Test-Path $path) { Move-Item $path (Join-Path $docsDir $c) -Force; Write-Output "DONE: $c" }
}

$remain = (Get-ChildItem "$promptsDir\*.md" -Name | Where-Object { $_ -notmatch '^PREFLIGHT' }).Count
Write-Output "Remaining: $remain"
