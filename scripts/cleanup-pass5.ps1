$promptsDir = "g:\My Drive\Project Management\Live\Trading-Command-Suite-Documentation\.agenticmemory\prompts"
$docsDir = "C:\wamp64\www\trading-command-suite\docs"

$designDocs = @('MARKET-REGIME.md','MEAN-REVERSION.md','MULTI-SCREEN-DASHBOARD.md','MULTI-SCREEN-SUPPORT.md','NEWS-DISSIPATION-CURVES.md','logging-debugging-system.md','MT5-BRIDGE-EXPANSION.md')
foreach ($d in $designDocs) {
  $path = Join-Path $promptsDir $d
  if (Test-Path $path) { Move-Item $path (Join-Path $docsDir $d) -Force; Write-Output "MOVED: $d" }
}

$complete = @('live-ordering-stack-pairing.md','news-intel-ai-position-tracking.md')
foreach ($c in $complete) {
  $path = Join-Path $promptsDir $c
  if (Test-Path $path) { Move-Item $path (Join-Path $docsDir $c) -Force; Write-Output "DONE: $c" }
}

$remain = (Get-ChildItem "$promptsDir\*.md" -Name | Where-Object { $_ -notmatch '^PREFLIGHT' }).Count
Write-Output "Remaining: $remain"
