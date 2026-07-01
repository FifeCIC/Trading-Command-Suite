$promptsDir = "g:\My Drive\Project Management\Live\Trading-Command-Suite-Documentation\.agenticmemory\prompts"
$docsDir = "C:\wamp64\www\trading-command-suite\docs"

$designDocs = @(
  'QA-SUMMARY-AND-NEXT-STEPS.md','RESISTANCE-LEVELS.md','RISK-METRICS.md',
  'S&P500.md','SINGLE-SYMBOL-SPEED-TRADING.md','SPY-QQQ-INDEX-TIMING-DIRECTIVES.md',
  'STARRING-SYSTEM.md','SYMBOL-CALIBRATION.md','SYMBOL-SPECIFIC-EQUITY-DIRECTIVES.md',
  'TRADING-STRATEGY-TRAINING-SCENARIOS.md','VIX-REGIME-DIRECTIVE.md','VIX-TRADING-STRATEGY.md',
  'VIX.md','WALK-FORWARD.md','WATCHLIST-PIES.md','WATCHLIST-SEED-INSTALL.md','WEEKLY-RHYTHM.md'
)
foreach ($d in $designDocs) {
  $path = Join-Path $promptsDir $d
  if (Test-Path $path) { Move-Item $path (Join-Path $docsDir $d) -Force; Write-Output "DESIGN: $d" }
}

$done = @(
  'rarity-percentile-gauge.md','research-overview-dashboard.md',
  'scoring-logs-logging-system.md','scoring-runs-overhaul.md',
  'seasonality-directives.md','seasonality-heatmap.md',
  'sees-arena-scoring-independence.md','signals-workbench-design.md',
  'speed-scanner.md','store-earnings-calendar.md',
  'support-resistance-fast-working.md','symbols-browser-new-area.md',
  'technical-indicators-single-chart.md','trading-session-init.md',
  'trading-strategy-bridge.md','unified-broker-interface.md',
  'volatility-analysis-expression.md','wire-alpha-vantage-earnings.md',
  'xau-speed-v1.md',
  'RUI001-Theme-Lab-Maintenance.md','RUI007-Social-Networks-Sentiment.md',
  'RUI008-Scoring-Activity-Logs-Trace.md','RUI009-Chart-Comparison-Protocol-AB.md',
  'RUI010-Research-Overview-Signal-Dashboard.md','RUI011-VIX-Trading-Strategy.md',
  'RUI012-Decoder-AI-Integration.md','RUI013-Data-Elements-Real-Data.md',
  'RUI014-Backtest-Data-Strategy.md','RUI015-Exit-Signals-System.md',
  'RUI016-HOTAS-Trading-Interface.md'
)
foreach ($c in $done) {
  $path = Join-Path $promptsDir $c
  if (Test-Path $path) { Move-Item $path (Join-Path $docsDir $c) -Force; Write-Output "DONE: $c" }
}

$remain = (Get-ChildItem "$promptsDir\*.md" -Name | Where-Object { $_ -notmatch '^PREFLIGHT' }).Count
Write-Output ""
Write-Output "=== Remaining: $remain ==="
Get-ChildItem "$promptsDir\*.md" -Name | Where-Object { $_ -notmatch '^PREFLIGHT' } | Sort-Object | ForEach-Object { Write-Output "  $_" }
