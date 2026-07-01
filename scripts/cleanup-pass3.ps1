$promptsDir = "g:\My Drive\Project Management\Live\Trading-Command-Suite-Documentation\.agenticmemory\prompts"
$docsDir = "C:\wamp64\www\trading-command-suite\docs"

# Design documents → docs/
$designDocs = @(
  'CRYPTO-SPECIFIC-DIRECTIVES.md','DATA-ML-SYSTEM.md','DATABASE-TABLES-TRACKING.md',
  'DIRECTIVE-ACTIVATION-GATES.md','DIRECTIVE-ANALYSIS.md','DIRECTIVE-STATUS-UPDATE.md',
  'directive-strategy-validation.md','EARNINGS-IMPLEMENTATION.md','EARNINGS-WHISPERS.md',
  'EXIT-SIGNALS.md','DATA-ELEMENTS-REAL-DATA.md'
)
foreach ($d in $designDocs) {
  $path = Join-Path $promptsDir $d
  if (Test-Path $path) { Move-Item $path (Join-Path $docsDir $d) -Force; Write-Output "DESIGN: $d" }
}

# Already complete → docs/
$complete = @(
  'DA001-Database-Table-Stats.md','data-import-handler.md','DECODER-CONTENT-PARSING.md',
  'events-calendar-enhancement.md','earnings-calendar-multi-source.md'
)
foreach ($c in $complete) {
  $path = Join-Path $promptsDir $c
  if (Test-Path $path) { Move-Item $path (Join-Path $docsDir $c) -Force; Write-Output "DONE: $c" }
}

$remain = (Get-ChildItem "$promptsDir\*.md" -Name | Where-Object { $_ -notmatch '^PREFLIGHT' }).Count
Write-Output "Remaining: $remain"
