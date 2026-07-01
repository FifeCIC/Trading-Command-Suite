$base = "C:\wamp64\www\trading-command-suite"
$checks = @(
  @{n='Q235-Multi-Screen'; f='src/pages/MultiScreenDashboardPage.jsx'},
  @{n='Q242-HOTAS-Gamepad'; f='src/pages/HOTASGamepadPage.jsx'},
  @{n='Q284-First-Live-Trade'; f='src/pages/FirstLiveTradePage.jsx'},
  @{n='DB001-DB-Interface'; f='nest/src/modules/database/database-interface.service.ts'},
  @{n='oil-speed-v1'; f='nest/src/modules/directives/implementations/oil-speed.directive.ts'},
  @{n='sector-rotation'; f='nest/src/modules/scoring/sector-rotation.service.ts'},
  @{n='stock-investigation'; f='src/pages/StockInvestigationPage.jsx'},
  @{n='research-overview-dashboard'; f='src/pages/ResearchOverviewPage.jsx'},
  @{n='build-portfolio-events'; f='src/pages/PortfolioEventsPage.jsx'},
  @{n='chart-comparison-analyse'; f='src/pages/ChartComparisonPage.jsx'},
  @{n='RUI001-Theme-Lab'; f='src/pages/ThemeLabPage.jsx'},
  @{n='RUI009-Chart-Comp'; f='src/pages/ChartComparisonPage.jsx'},
  @{n='RUI011-VIX'; f='src/pages/VIXTradingPage.jsx'},
  @{n='RUI016-HOTAS'; f='src/pages/HOTASTradingPage.jsx'},
  @{n='social-networks-profile'; f='src/pages/SocialNetworksProfilePage.jsx'},
  @{n='bitcoin-patterns'; f='nest/src/modules/directives/implementations/bitcoin-patterns.directive.ts'},
  @{n='iana-timezone'; f='nest/src/modules/directives/implementations/iana-timezone.directive.ts'},
  @{n='market-correlations'; f='nest/src/modules/scoring/market-correlations.service.ts'},
  @{n='normalize-auto-refresh'; f='nest/src/modules/market-data/normalize.service.ts'},
  @{n='price-forecast'; f='nest/src/modules/scoring/price-forecast.service.ts'},
  @{n='recently-analysed'; f='src/pages/RecentlyAnalysedPage.jsx'}
)
foreach ($c in $checks) {
  $exists = Test-Path (Join-Path $base $c.f)
  if ($exists) { Write-Output "CODE: $($c.n)" } else { Write-Output "NO CODE: $($c.n)" }
}
