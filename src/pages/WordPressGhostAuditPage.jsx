export default function WordPressGhostAuditPage() {
  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: 20, color: '#e2e8f0' }}>
      <header style={{ marginBottom: 16 }}>
        <h1>WordPress Ghost Audit</h1>
        <p style={{ color: '#64748b' }}>Audit of WordPress plugin features that should exist in Trading Command Suite</p>
      </header>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {[
          { feature: 'SEES Live Stack', wp: 'Yes — SEES dashboard', tcs: '✅ SeesLiveStackMockPage', match: true },
          { feature: 'Directives Manager', wp: 'Yes — directive editor', tcs: '✅ DirectivesManagerPage', match: true },
          { feature: 'Portfolio Overview', wp: 'Yes — holdings page', tcs: '✅ PortfolioPage', match: true },
          { feature: 'Strategy Builder', wp: 'Partial — strategy config', tcs: '✅ StrategyBuilderPage', match: true },
          { feature: 'Backtest Engine', wp: 'No', tcs: '✅ BacktestPage', match: false },
          { feature: 'Algorithm Lab', wp: 'No', tcs: '✅ AlgorithmLabPage', match: false },
          { feature: 'Scoring Overview', wp: 'Yes — admin scoring', tcs: '✅ ScoringOverviewPage', match: true },
          { feature: 'System Status', wp: 'Yes — diagnostics', tcs: '✅ SystemStatusPage', match: true },
          { feature: 'Symbols Browser', wp: 'Yes — symbol list', tcs: '✅ SymbolsBrowserPage', match: true },
          { feature: 'Import Jobs', wp: 'Yes — data imports', tcs: '✅ ImportJobsPage', match: true },
          { feature: 'Risk Controls', wp: 'No', tcs: '✅ RiskControlsPage', match: false },
          { feature: 'Trade Journal', wp: 'No', tcs: '✅ TradeJournalPage', match: false },
          { feature: 'Watchlists', wp: 'Yes — watchlists', tcs: '✅ WatchlistsPage', match: true },
          { feature: 'Alert Center', wp: 'No', tcs: '✅ AlertCenterPage', match: false },
        ].map((row, i) => (
          <div key={i} style={{
            display: 'flex', gap: 12, padding: '10px 14px', background: '#1a1d2e',
            border: '1px solid #2d3040', borderRadius: 8, fontSize: 13, alignItems: 'center'
          }}>
            <span style={{ flex: 1, fontWeight: 500 }}>{row.feature}</span>
            <span style={{ width: 60, textAlign: 'center', color: row.match ? '#4ade80' : '#64748b' }}>{row.match ? '✓' : '✦'}</span>
            <span style={{ width: 120, color: '#94a3b8', fontSize: 11 }}>{row.wp}</span>
            <span style={{ flex: 2, color: '#e2e8f0', fontSize: 12 }}>{row.tcs}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
