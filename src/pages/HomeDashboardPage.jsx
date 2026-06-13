import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import { NAV_TREE, PRIMARY_PAGES } from '../core/nav-tree';
import { useUiStore } from '../stores/useUiStore';

const QUICK_LINKS = [
  { label: 'SEES Live Stack', to: '/trading/sees-live-stack', desc: 'Real-time directive scoring' },
  { label: 'Portfolio', to: '/trading/portfolio-overview', desc: 'Holdings & P&L from Trading212' },
  { label: 'MT5 Trading', to: '/trading/mt5-trading', desc: 'Forex positions & order entry' },
  { label: 'Strategy Builder', to: '/trading/strategy-builder', desc: 'Build custom scoring strategies' },
  { label: 'Backtesting', to: '/trading/backtest', desc: 'Historical strategy validation' },
  { label: 'Export Reports', to: '/trading/reports', desc: 'Download CSV, JSON, share cards' },
];

export default function HomeDashboardPage() {
  const themeMode = useUiStore((state) => state.themeMode);
  const setThemeMode = useUiStore((state) => state.setThemeMode);

  const healthQuery = useQuery({
    queryKey: ['health'],
    queryFn: () => apiGet('/api/version'),
  });

  const signalsQuery = useQuery({
    queryKey: ['signals-summary'],
    queryFn: () => apiGet('/api/signals/summary').catch(() => ({ total: 0, buys: 0, sells: 0, recent: [] })),
  });

  const status = healthQuery.data ? '🟢 Online' : healthQuery.isLoading ? '⏳ Checking…' : '🔴 Offline';
  const signals = signalsQuery.data || { total: 0, buys: 0, sells: 0, recent: [] };

  return (
    <div className="hd-page">
      <h1>Trading Command Suite</h1>
      <p className="hd-subtitle">Algorithmic trading analysis and portfolio management</p>

      <div className="hd-status-bar">
        <span><strong>API:</strong> {status}</span>
        <span><strong>Signals today:</strong> {signals.total}</span>
        <span><strong>Buys:</strong> {signals.buys}</span>
        <span><strong>Sells:</strong> {signals.sells}</span>
      </div>

      <div className="hd-section">
        <h2>Quick Navigation</h2>
        <div className="hd-grid">
          {QUICK_LINKS.map((link) => (
            <a key={link.to} href={link.to} className="hd-card">
              <strong>{link.label}</strong>
              <span>{link.desc}</span>
            </a>
          ))}
        </div>
      </div>

      <div className="hd-section">
        <h2>Appearance</h2>
        <div className="hd-theme-row">
          <span>Theme</span>
          <div className="inline-actions">
            <button type="button" className={themeMode === 'light' ? 'cta' : ''} onClick={() => setThemeMode('light')}>Light</button>
            <button type="button" className={themeMode === 'dark' ? 'cta' : ''} onClick={() => setThemeMode('dark')}>Dark</button>
          </div>
        </div>
      </div>

      {signals.recent.length > 0 && (
        <div className="hd-section">
          <h2>Recent Signals</h2>
          <div className="hd-signals">
            {signals.recent.slice(0, 6).map((s, i) => (
              <div key={i} className={`hd-signal hd-sig-${s.signal}`}>
                <strong>{s.symbol}</strong> — {s.signal.toUpperCase()} — Score {s.score}
                <span className="hd-sig-time">{s.timestamp ? new Date(s.timestamp).toLocaleTimeString() : ''}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
