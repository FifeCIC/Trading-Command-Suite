$promptsDir = "g:\My Drive\Project Management\Live\Trading-Command-Suite-Documentation\.agenticmemory\prompts"
$docsDir = "C:\wamp64\www\trading-command-suite\docs"

$designDocs = @('performance-scoring-directives-caching.md','position-monitoring-roadmap.md','POSITION-SIZING.md')
foreach ($d in $designDocs) {
  $path = Join-Path $promptsDir $d
  if (Test-Path $path) { Move-Item $path (Join-Path $docsDir $d) -Force; Write-Output "DESIGN: $d" }
}

$complete = @('pattern-scanner-chart-integration.md','populate-data-tables.md','portfolio-session-tracking.md')
foreach ($c in $complete) {
  $path = Join-Path $promptsDir $c
  if (Test-Path $path) { Move-Item $path (Join-Path $docsDir $c) -Force; Write-Output "DONE: $c" }
}

$remain = (Get-ChildItem "$promptsDir\*.md" -Name | Where-Object { $_ -notmatch '^PREFLIGHT' }).Count
Write-Output "Remaining: $remain"
