import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import { NAV_TREE } from '../core/nav-tree';
import ScreenOptions from '../components/ScreenOptions';
import './HomeDashboard.css'; // reuses nav-card styles

const AREA_ICONS = {
  qa: '🧪', trading: '📈', scoring: '🎯', research: '🔬', data: '🗄️',
  watchlists: '👁️', automation: '⚙️', platforms: '🔌',
  focus: '🎯', training: '🕯️', testing: '🧪',
  status: '📡', settings: '⚙️', wizard: '🧙', ops: '🛡️',
  analysis: '📊', builder: '🔧', planner: '📋', lab: '🧪',
};

/** Trading workflow areas — shown first as a focused group */
const WORKFLOW_AREAS = ['qa', 'watchlists', 'scoring', 'trading'];

export default function DashboardPage() {
  const navigate = useNavigate();
  const [screenOptionsOpen, setScreenOptionsOpen] = useState(false);

  // ── Portfolio data ──
  const diagQuery = useQuery({
    queryKey: ['dash-diag'],
    queryFn: () => apiGet('/api/providers/mt5/diagnostics').catch(() => null),
    refetchInterval: 30_000,
  });
  const diag = diagQuery.data || {};
  const mt5Connected = diag.connected === true;
  const balance = diag.balance ?? 0;
  const equity = diag.equity ?? 0;

  const posQuery = useQuery({
    queryKey: ['dash-positions'],
    queryFn: () => apiGet('/api/providers/mt5/positions').catch(() => ({ positions: [] })),
    refetchInterval: 30_000,
    enabled: mt5Connected,
  });
  const positions = posQuery.data?.positions || [];
  const totalPnl = positions.reduce((s, p) => s + (p.profit || 0), 0);
  const posCount = positions.length;

  // Trading212 portfolio for P&L breakdown
  const t212Query = useQuery({
    queryKey: ['dash-t212'],
    queryFn: () => apiGet('/api/portfolio?source=trading212').catch(() => ({ positions: [] })),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const t212Positions = t212Query.data?.positions || [];
  const t212Account = t212Query.data?.account || {};

  // Stocks ISA for per-broker breakdown
  const isaQuery = useQuery({
    queryKey: ['dash-isa'],
    queryFn: () => apiGet('/api/isa/dashboard').catch(() => ({})),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const isaData = isaQuery.data || {};
  const isaSummary = isaData.summary || {};

  // ── P&L by Broker ──
  const pnlByBroker = (() => {
    const mt5Pnl = positions.reduce((s, p) => s + (p.profit || 0), 0);
    const mt5Winners = positions.filter(p => (p.profit || 0) > 0).length;
    const mt5Losers = positions.filter(p => (p.profit || 0) < 0).length;
    const t212Pnl = t212Positions.reduce((s, p) => s + (p.pnl || 0), 0);
    const t212Winners = t212Positions.filter(p => (p.pnl || 0) > 0).length;
    const t212Losers = t212Positions.filter(p => (p.pnl || 0) < 0).length;
    const isaValue = isaSummary.totalValueGbp || 0;
    const isaPnl = isaSummary.totalPnl !== undefined ? isaSummary.totalPnl : (isaSummary.unrealizedPnl || 0);
    const isaPosCount = isaSummary.positionCount || 0;
    return {
      mt5: { pnl: mt5Pnl, winners: mt5Winners, losers: mt5Losers, count: positions.length, balance: balance, equity: equity },
      t212: { pnl: t212Pnl, winners: t212Winners, losers: t212Losers, count: t212Positions.length, balance: t212Account.balance, equity: t212Account.equity },
      isa: { pnl: isaPnl, value: isaValue, count: isaPosCount },
    };
  })();
  const grandTotalPnl = pnlByBroker.mt5.pnl + pnlByBroker.t212.pnl + pnlByBroker.isa.pnl;

  // Hot Picks widget
  const hotPicksQuery = useQuery({
    queryKey: ['dash-hot-picks'],
    queryFn: () => apiGet('/api/scoring/ranked?limit=5'),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const hotPicks = hotPicksQuery.data?.ranked ?? [];

  // ── Diversification ──
  const divQuery = useQuery({
    queryKey: ['dash-diversification'],
    queryFn: () => apiGet('/api/diversification/summary').catch(() => null),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const divSummary = divQuery.data || {};
  const crossBrokerDupes = divSummary.crossBrokerDuplicates || [];
  const divWarnings = divSummary.warnings || [];
  const divMode = (divSummary.settings || {})['diversification.mode'] || 'warn';

  const statusLevel = diagQuery.isLoading ? null : mt5Connected ? 'online' : 'offline';

  const areas = Object.entries(NAV_TREE)
    .filter(([id]) => id !== 'dashboard') // exclude self
    .map(([id, area]) => ({
      id,
      label: area.label,
      icon: AREA_ICONS[id] || '📋',
      viewCount: (area.views || []).length,
      firstView: (area.views || [])[0]?.id || 'overview',
    }));

  const workflowAreas = areas.filter(a => WORKFLOW_AREAS.includes(a.id));
  const supportingAreas = areas.filter(a => !WORKFLOW_AREAS.includes(a.id));

  return (
    <div className="nav-dashboard">
      {/* ── Top-Left Logo Bar ── */}
      <div className="nd-topbar">
        <img src="/tcs-logo.png" alt="Trading Command Suite" className="nd-topbar-logo" />
      </div>

      {/* ── Dashboard 2-Column Grid ── */}
      <div className="dash-grid">
        <div className="dash-col dash-col-main">
          <div className="dash-card">
            <h3>📊 Portfolio Summary</h3>
            <div className="dash-card-stats">
              <div className="dash-stat">
                <span className="dash-stat-label">MT5 Bridge</span>
                <span className={`dash-stat-value ${mt5Connected ? 'ok' : 'err'}`}>
                  {mt5Connected ? 'Connected' : 'Offline'}
                </span>
              </div>
              <div className="dash-stat">
                <span className="dash-stat-label">Balance</span>
                <span className="dash-stat-value ok">${balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
              </div>
              <div className="dash-stat">
                <span className="dash-stat-label">Equity</span>
                <span className="dash-stat-value ok">${equity.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
              </div>
              <div className="dash-stat">
                <span className="dash-stat-label">Open Positions</span>
                <span className="dash-stat-value">{posCount}</span>
              </div>
              <div className="dash-stat">
                <span className="dash-stat-label">Unrealized P&amp;L</span>
                <span className={`dash-stat-value ${totalPnl >= 0 ? 'ok' : 'err'}`}>
                  {totalPnl >= 0 ? '+' : ''}{totalPnl.toFixed(2)}
                </span>
              </div>
            </div>
          </div>

          {/* ── P&L by Broker ── */}
          <div className="dash-card">
            <h3>💼 P&amp;L by Broker</h3>
            <div className="dash-broker-grid">
              {/* MT5 */}
              <div className="dash-broker-row">
                <div className="dash-broker-head">
                  <span className="dash-broker-icon">📡</span>
                  <span className="dash-broker-name">MT5</span>
                  <span className={`dash-broker-badge ${mt5Connected ? 'badge-live' : 'badge-off'}`}>
                    {mt5Connected ? 'DEMO' : 'OFFLINE'}
                  </span>
                </div>
                <div className="dash-broker-metrics">
                  <div className="dash-broker-metric">
                    <span className="dash-broker-mlabel">Balance</span>
                    <span className="dash-broker-mval">${balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="dash-broker-metric">
                    <span className="dash-broker-mlabel">Equity</span>
                    <span className="dash-broker-mval">${equity.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="dash-broker-metric">
                    <span className="dash-broker-mlabel">Positions</span>
                    <span className="dash-broker-mval">{pnlByBroker.mt5.count}</span>
                  </div>
                  <div className="dash-broker-metric dash-broker-pnl">
                    <span className="dash-broker-mlabel">P&amp;L</span>
                    <span className={`dash-broker-mval ${pnlByBroker.mt5.pnl >= 0 ? 'ok' : 'err'}`}>
                      {pnlByBroker.mt5.pnl >= 0 ? '+' : ''}{pnlByBroker.mt5.pnl.toFixed(2)}
                    </span>
                    <span className="dash-broker-sub">{pnlByBroker.mt5.winners}W / {pnlByBroker.mt5.losers}L</span>
                  </div>
                </div>
              </div>

              {/* Trading212 */}
              <div className="dash-broker-row">
                <div className="dash-broker-head">
                  <span className="dash-broker-icon">🏦</span>
                  <span className="dash-broker-name">Trading 212</span>
                  <span className="dash-broker-badge badge-demo">GIA</span>
                </div>
                <div className="dash-broker-metrics">
                  <div className="dash-broker-metric">
                    <span className="dash-broker-mlabel">Balance</span>
                    <span className="dash-broker-mval">
                      {pnlByBroker.t212.balance != null ? `$${pnlByBroker.t212.balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '—'}
                    </span>
                  </div>
                  <div className="dash-broker-metric">
                    <span className="dash-broker-mlabel">Equity</span>
                    <span className="dash-broker-mval">
                      {pnlByBroker.t212.equity != null ? `$${pnlByBroker.t212.equity.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '—'}
                    </span>
                  </div>
                  <div className="dash-broker-metric">
                    <span className="dash-broker-mlabel">Positions</span>
                    <span className="dash-broker-mval">{pnlByBroker.t212.count}</span>
                  </div>
                  <div className="dash-broker-metric dash-broker-pnl">
                    <span className="dash-broker-mlabel">P&amp;L</span>
                    <span className={`dash-broker-mval ${pnlByBroker.t212.pnl >= 0 ? 'ok' : 'err'}`}>
                      {pnlByBroker.t212.pnl >= 0 ? '+' : ''}{pnlByBroker.t212.pnl.toFixed(2)}
                    </span>
                    <span className="dash-broker-sub">{pnlByBroker.t212.winners}W / {pnlByBroker.t212.losers}L</span>
                  </div>
                </div>
              </div>

              {/* Stocks ISA */}
              <div className="dash-broker-row">
                <div className="dash-broker-head">
                  <span className="dash-broker-icon">🏛️</span>
                  <span className="dash-broker-name">Stocks ISA</span>
                  <span className="dash-broker-badge badge-isa">ISA</span>
                </div>
                <div className="dash-broker-metrics">
                  <div className="dash-broker-metric">
                    <span className="dash-broker-mlabel">Value</span>
                    <span className="dash-broker-mval">
                      {pnlByBroker.isa.value > 0 ? `£${pnlByBroker.isa.value.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '—'}
                    </span>
                  </div>
                  <div className="dash-broker-metric">
                    <span className="dash-broker-mlabel">Positions</span>
                    <span className="dash-broker-mval">{pnlByBroker.isa.count}</span>
                  </div>
                  <div className="dash-broker-metric dash-broker-pnl">
                    <span className="dash-broker-mlabel">P&amp;L</span>
                    <span className={`dash-broker-mval ${pnlByBroker.isa.pnl >= 0 ? 'ok' : 'err'}`}>
                      {pnlByBroker.isa.pnl >= 0 ? '+' : ''}{pnlByBroker.isa.pnl.toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Total Row */}
              <div className="dash-broker-row dash-broker-total">
                <div className="dash-broker-head">
                  <span className="dash-broker-name">All Brokers</span>
                </div>
                <div className="dash-broker-metrics">
                  <div className="dash-broker-metric">
                    <span className="dash-broker-mlabel">Total P&amp;L</span>
                    <span className={`dash-broker-mval dash-broker-total-val ${grandTotalPnl >= 0 ? 'ok' : 'err'}`}>
                      {grandTotalPnl >= 0 ? '+' : ''}{grandTotalPnl.toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ── Diversification Card ── */}
          <div className="dash-card">
            <h3>
              🌐 Diversification
              <span className={`dash-div-mode-badge ${divMode === 'strict' ? 'mode-strict' : divMode === 'warn' ? 'mode-warn' : 'mode-off'}`}>
                {divMode.toUpperCase()}
              </span>
            </h3>
            {crossBrokerDupes.length > 0 ? (
              <div className="dash-div-dupes">
                <p className="dash-div-warn">⚠️ {crossBrokerDupes.length} symbol(s) held across multiple brokers:</p>
                {crossBrokerDupes.map((d) => (
                  <div key={d.symbol} className="dash-div-dupe-row">
                    <span className="dash-div-dupe-symbol">{d.symbol}</span>
                    <span className="dash-div-dupe-brokers">{d.brokers.join(' + ')}</span>
                    <span className="dash-div-dupe-val">£{d.totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="dash-div-clean">✅ No cross-broker duplicates — good diversification.</p>
            )}
            {divWarnings.length > 0 && (
              <div className="dash-div-warnings">
                {divWarnings.slice(0, 2).map((w, i) => (
                  <p key={i} className="dash-div-warn-msg">⚠️ {w}</p>
                ))}
              </div>
            )}
            <a href="/allocator" className="dash-div-link">View Strategy Allocator →</a>
          </div>

          {posCount > 0 && (
            <div className="dash-card">
              <h3>📈 Open Positions</h3>
              <div className="dash-table-wrap">
                <table className="dash-table">
                  <thead><tr><th>Symbol</th><th>Type</th><th>Vol</th><th>Open</th><th>Current</th><th>P&amp;L</th></tr></thead>
                  <tbody>
                    {positions.slice(0, 5).map((p) => (
                      <tr key={p.ticket}>
                        <td><strong>{p.symbol}</strong></td>
                        <td className={p.type === 'buy' ? 'dash-buy' : 'dash-sell'}>{p.type?.toUpperCase()}</td>
                        <td>{p.volume}</td>
                        <td>{p.priceOpen?.toFixed(2)}</td>
                        <td>{p.priceCurrent?.toFixed(2)}</td>
                        <td className={p.profit >= 0 ? 'dash-profit' : 'dash-loss'}>
                          {p.profit >= 0 ? '+' : ''}{p.profit?.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {posCount > 5 && (
                <p className="dash-hint">+{posCount - 5} more — <button className="dash-link" onClick={() => navigate('/trading/positions-monitor')}>view all</button></p>
              )}
            </div>
          )}

          {posCount === 0 && mt5Connected && (
            <div className="dash-card"><h3>📈 Open Positions</h3><p className="dash-hint">No open positions.</p></div>
          )}
          {!mt5Connected && (
            <div className="dash-card"><h3>📈 Open Positions</h3><p className="dash-hint">MT5 bridge offline — connect to see positions.</p></div>
          )}

          {/* ── Worst-Case Risk Snapshot ── */}
          {posCount > 0 && (() => {
            const worst = [...positions].sort((a, b) => (a.profit || 0) - (b.profit || 0))[0];
            const losersCount = positions.filter(p => (p.profit || 0) < 0).length;
            const totalLoss = positions.filter(p => (p.profit || 0) < 0).reduce((s, p) => s + (p.profit || 0), 0);
            return worst && (worst.profit || 0) < 0 ? (
              <div className="dash-card dash-worst-case">
                <h3>⚠️ Worst-Case Monitor</h3>
                <div className="dash-card-stats">
                  <div className="dash-stat">
                    <span className="dash-stat-label">Biggest Loser</span>
                    <span className="dash-stat-value err">{worst.symbol} {worst.profit?.toFixed(2)}</span>
                  </div>
                  <div className="dash-stat">
                    <span className="dash-stat-label">Losing Positions</span>
                    <span className="dash-stat-value err">{losersCount} of {posCount}</span>
                  </div>
                  <div className="dash-stat">
                    <span className="dash-stat-label">Total at Risk</span>
                    <span className="dash-stat-value err">{totalLoss.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            ) : null;
          })()}
        </div>

        <div className="dash-col dash-col-side">
          <div className="dash-card">
            <h3>🌍 Market Sessions</h3>
            <div className="dash-sessions">
              {[{ label: 'London', open: 8, close: 16 }, { label: 'New York', open: 9, close: 16 }, { label: 'Tokyo', open: 9, close: 15 }].map((s) => {
                const now = new Date();
                const utc = now.getUTCHours();
                const offsets = { London: 1, 'New York': -4, Tokyo: 9 };
                const local = (utc + offsets[s.label] + 24) % 24;
                const isOpen = local >= s.open && local < s.close;
                return (
                  <div key={s.label} className={`dash-session ${isOpen ? 'dash-session-open' : 'dash-session-closed'}`}>
                    <span className="dash-session-dot" style={{background: isOpen ? '#22c55e' : '#ef4444'}}/>
                    <span>{s.label}</span>
                    <span className="dash-session-status">{isOpen ? 'Open' : 'Closed'}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="dash-card">
            <h3>🔧 Dev Updates</h3>
            <p className="dash-hint">Release notes and community updates coming soon — pending TCS website and social presence.</p>
          </div>

          {/* ── Hot Picks Widget ── */}
          <div className="dash-card dash-hot-picks">
            <h3>
              🔥 Hot Picks
              {hotPicksQuery.isFetching && <span className="dash-hp-refresh"> ⟳</span>}
            </h3>
            {hotPicks.length === 0 ? (
              <p className="dash-hint">Waiting for scoring data…</p>
            ) : (
              <div className="dash-hp-list">
                {hotPicks.slice(0, 5).map((pick, i) => {
                  const scoreColor = pick.score >= 50 ? 'var(--color-profit)' : pick.score >= 25 ? 'var(--color-warning)' : 'var(--color-loss)';
                  return (
                    <a
                      key={pick.symbolId}
                      href={`/research/symbol/${pick.symbolId}`}
                      className="dash-hp-item"
                      onClick={(e) => { e.preventDefault(); navigate(`/research/symbol/${pick.symbolId}`); }}
                    >
                      <span className="dash-hp-rank">#{i + 1}</span>
                      <span className="dash-hp-ticker">{pick.ticker}</span>
                      <span className="dash-hp-signal">{pick.signal === 'entry' ? '🎯' : pick.signal === 'watch' ? '👁' : '—'}</span>
                      <span className="dash-hp-score" style={{ color: scoreColor }}>{pick.score}</span>
                    </a>
                  );
                })}
              </div>
            )}
            <button
              className="dash-hp-link"
              onClick={() => navigate('/lab/hot-stock-picks')}
            >
              View all picks →
            </button>
          </div>
        </div>
      </div>

      {/* ── Trading Workflow ── */}
      <section className="nd-section nd-workflow">
        <h2 className="nd-section-label">🧪 Trading Workflow</h2>
        <div className="nd-nav-grid nd-nav-grid-primary">
          {workflowAreas.map((area) => (
            <button
              key={area.id}
              className="nd-nav-card nd-nav-card-primary"
              onClick={() => navigate(`/${area.id}/${area.firstView}`)}
            >
              <span className="nd-nav-icon">{area.icon}</span>
              <span className="nd-nav-label">{area.label}</span>
              <span className="nd-nav-count">{area.viewCount} views</span>
            </button>
          ))}
        </div>
      </section>

      {/* ── Supporting Areas ── */}
      <section className="nd-section nd-supporting">
        <h2 className="nd-section-label">🔧 Supporting Areas</h2>
        <div className="nd-nav-grid nd-nav-grid-secondary">
          {supportingAreas.map((area) => (
            <button
              key={area.id}
              className="nd-nav-card nd-nav-card-secondary"
              onClick={() => navigate(`/${area.id}/${area.firstView}`)}
            >
              <span className="nd-nav-icon">{area.icon}</span>
              <span className="nd-nav-label">{area.label}</span>
              <span className="nd-nav-count">{area.viewCount} views</span>
            </button>
          ))}
        </div>
      </section>
      <ScreenOptions
        activeView={null}
        isOpen={screenOptionsOpen}
        onToggle={() => setScreenOptionsOpen((v) => !v)}
        isBookmarked={false}
        onToggleBookmark={() => {}}
        statusLevel={statusLevel}
        isMt5Online={mt5Connected}
        isApiOnline={!diagQuery.isError}
        isDbOnline={!diagQuery.isError}
      />
    </div>
  );
}
