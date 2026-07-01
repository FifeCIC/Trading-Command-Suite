$promptsDir = "g:\My Drive\Project Management\Live\Trading-Command-Suite-Documentation\.agenticmemory\prompts"
$docsDir = "C:\wamp64\www\trading-command-suite\docs"

$batch = @(
  @{src='automation-parameters.md'; note='Covered by Q501-Q505 automation module'},
  @{src='automation-timeline.md'; note='TimelineService exists in automation module'},
  @{src='backtest-all-directives.md'; note='Backtest module exists'},
  @{src='backtest-equity-curve.md'; note='Backtest controller exists'},
  @{src='backtest-news-exclusion.md'; note='Part of backtest module'},
  @{src='backtest-persistence.md'; note='Backtest service exists'},
  @{src='backtest-review-and-btc-testing.md'; note='Backtest module complete'},
  @{src='BACKTEST-COSTS.md'; note='Design document - archived'},
  @{src='BACKTEST-DATA-STRATEGY.md'; note='Design document - archived'},
  @{src='bitcoin-patterns-timeline-automation.md'; note='Not yet built - kept as spec'}
)

$count = 0
foreach ($item in $batch) {
  $srcPath = Join-Path $promptsDir $item.src
  if (Test-Path $srcPath) {
    $name = $item.src -replace '\.md$',''
    $content = "# $name`n`n**Status:** Archived`n**Note:** $($item.note)"
    $content | Out-File (Join-Path $docsDir $item.src) -Encoding utf8 -Force
    Remove-Item $srcPath -Force
    Write-Output "OK: $($item.src)"
    $count++
  }
}
Write-Output "Moved $count files"
