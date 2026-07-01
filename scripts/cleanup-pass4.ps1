$promptsDir = "g:\My Drive\Project Management\Live\Trading-Command-Suite-Documentation\.agenticmemory\prompts"
$docsDir = "C:\wamp64\www\trading-command-suite\docs"

$designDocs = @('FLUFF-DETECTOR.md','GOLD-MACRO-CORRELATION-DIRECTIVE.md','HOTAS-TRADING-INTERFACE.md','KEYBOARD-SPEED-TRADING.md','LIKE-ZACKS.md','improved-primary-page-files.md')
foreach ($d in $designDocs) {
  $path = Join-Path $promptsDir $d
  if (Test-Path $path) { Move-Item $path (Join-Path $docsDir $d) -Force; Write-Output "DESIGN: $d" }
}

$complete = @('fix-directive-maxscore-clamps.md','fix-intranet-nestjs-task.md','fix-trading212-tickers.md','import-portfolio-to-positions.md')
foreach ($c in $complete) {
  $path = Join-Path $promptsDir $c
  if (Test-Path $path) { Move-Item $path (Join-Path $docsDir $c) -Force; Write-Output "DONE: $c" }
}

$remain = (Get-ChildItem "$promptsDir\*.md" -Name | Where-Object { $_ -notmatch '^PREFLIGHT' }).Count
Write-Output "Remaining: $remain"
