/**
 * GlobalAllocatorPage — Cross-broker strategy allocation & diversification view.
 *
 * Shows:
 *   - All trading strategies grouped by broker
 *   - Current allocation % of total funds per strategy
 *   - Cross-broker duplicate symbols (diversification risk)
 *   - Global exposure heatmap
 *   - Global diversification settings (warn/strict/off)
 *
 * Route: /allocator
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPut } from '../core/api/client';
import './global-allocator.css';
import PageInfoPopover from '../components/PageInfoPopover';

// ── Constants ───────────────────────────────────────────

const BROKER_BADGES = {
  mt5: { label: 'MT5', icon: '📡', className: 'badge-mt5' },
  trading212: { label: 'T212', icon: '🏦', className: 'badge-t212' },
  isa: { label: 'ISA', icon: '🏛️', className: 'badge-isa' },
};

const MODE_BADGES = {
  auto: { label: 'AUTO', className: 'badge-auto' },
  'semi-auto': { label: 'SEMI', className: 'badge-semi' },
  manual: { label: 'MANUAL', className: 'badge-manual' },
};

const DIVERSIFICATION_MODES = [
  { value: 'off', label: 'Off — No cross-broker checks', desc: 'Allow duplicates freely' },
  { value: 'warn', label: 'Warn — Log & flag duplicates', desc: 'Allow but warn (recommended)' },
  { value: 'strict', label: 'Strict — Block cross-broker duplicates', desc: 'Reject trades on duplicate symbols' },
];

// ── Component ────────────────────────────────────────────

export default function GlobalAllocatorPage() {
  const queryClient = useQueryClient();

  // Fetch diversification summary (cross-broker positions, exposures)
  const divQuery = useQuery({
    queryKey: ['allocator-diversification'],
    queryFn: () => apiGet('/api/diversification/summary').catch(() => null),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  // Fetch all trading strategies
  const stratQuery = useQuery({
    queryKey: ['allocator-strategies'],
    queryFn: () => apiGet('/api/trading-strategies').catch(() => []),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  // Fetch scoring strategies (watchlist-based)
  const scoringQuery = useQuery({
    queryKey: ['allocator-scoring'],
    queryFn: () => apiGet('/api/scoring-strategies').catch(() => []),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  // Settings mutation
  const settingsMutation = useMutation({
    mutationFn: (settings) => apiPut('/api/diversification/settings', settings),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['allocator-diversification'] });
    },
  });

  const summary = divQuery.data || {};
  const strategies = Array.isArray(stratQuery.data) ? stratQuery.data : [];
  const scoringStrats = Array.isArray(scoringQuery.data) ? scoringQuery.data : [];

  const settings = summary.settings || {};
  const crossBrokerDupes = summary.crossBrokerDuplicates || [];
  const globalExposures = summary.globalExposures || [];
  const brokerBreakdown = summary.brokerBreakdown || [];

  // Group strategies by broker
  const byBroker = {};
  for (const s of strategies) {
    const bId = s.brokerId || 'mt5';
    if (!byBroker[bId]) byBroker[bId] = [];
    byBroker[bId].push(s);
  }

  // Scoring strategies by broker
  const scoringByBroker = {};
  for (const s of scoringStrats) {
    const bId = s.brokerId || 'mt5';
    if (!scoringByBroker[bId]) scoringByBroker[bId] = [];
    scoringByBroker[bId].push(s);
  }

  const brokerIds = [...new Set([
    ...Object.keys(byBroker),
    ...Object.keys(scoringByBroker),
    'mt5', 'trading212', 'isa',
  ])];

  const handleModeChange = (mode) => {
    settingsMutation.mutate({ 'diversification.mode': mode });
  };

  // ── Render ────────────────────────────────────────────

  return (
    <div className="allocator-page">
      <header className="allocator-header">
        <h1>Global Strategy Allocator
          <PageInfoPopover>
            Cross-broker diversification &amp; strategy allocation. Avoid duplicate symbols across brokers.
          </PageInfoPopover>
        </h1>
      </header>

      {/* ── Quick Stats Bar ── */}
      <div className="allocator-stats-bar">
        <div className="stat-card">
          <span className="stat-label">Total Portfolio</span>
          <span className="stat-value">
            £{(summary.totalPortfolioValue || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Active Strategies</span>
          <span className="stat-value">{strategies.filter(s => s.active).length}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Scoring Protocols</span>
          <span className="stat-value">{scoringStrats.filter(s => s.enabled).length}</span>
        </div>
        <div className={`stat-card ${crossBrokerDupes.length > 0 ? 'stat-warn' : 'stat-ok'}`}>
          <span className="stat-label">Cross-Broker Dupes</span>
          <span className="stat-value">{crossBrokerDupes.length}</span>
        </div>
      </div>

      <div className="allocator-grid">
        {/* ── Left Column: Strategy Lists ── */}
        <div className="allocator-main">
          {/* ── Diversification Mode Selector ── */}
          <section className="allocator-section">
            <h2>⚙️ Diversification Mode</h2>
            <div className="mode-selector">
              {DIVERSIFICATION_MODES.map((m) => (
                <button
                  key={m.value}
                  className={`mode-option ${(settings['diversification.mode'] || 'warn') === m.value ? 'active' : ''}`}
                  onClick={() => handleModeChange(m.value)}
                  disabled={settingsMutation.isPending}
                >
                  <span className="mode-label">{m.label}</span>
                  <span className="mode-desc">{m.desc}</span>
                </button>
              ))}
            </div>
          </section>

          {/* ── Cross-Broker Duplicates Warning ── */}
          {crossBrokerDupes.length > 0 && (
            <section className="allocator-section dupes-section">
              <h2>⚠️ Cross-Broker Duplicates</h2>
              <p className="section-desc">
                These symbols are held on multiple brokers, reducing diversification.
                {(settings['diversification.mode'] || 'warn') === 'strict' && ' New positions in these symbols will be blocked.'}
              </p>
              <div className="dupes-list">
                {crossBrokerDupes.map((d) => (
                  <div key={d.symbol} className="dupe-card">
                    <span className="dupe-symbol">{d.symbol}</span>
                    <span className="dupe-brokers">
                      {d.brokers.map((b) => (
                        <span key={b} className={`broker-badge ${BROKER_BADGES[b]?.className || ''}`}>
                          {BROKER_BADGES[b]?.icon} {BROKER_BADGES[b]?.label || b}
                        </span>
                      ))}
                    </span>
                    <span className="dupe-value">£{d.totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── Global Exposure ── */}
          {globalExposures.length > 0 && (
            <section className="allocator-section">
              <h2>📊 Global Exposure</h2>
              <div className="exposure-list">
                {globalExposures.slice(0, 10).map((e) => (
                  <div key={e.symbol} className="exposure-row">
                    <span className="exposure-symbol">{e.symbol}</span>
                    <div className="exposure-bar-wrap">
                      <div
                        className={`exposure-bar ${e.pctOfPortfolio > parseFloat(settings['diversification.maxGlobalExposurePct'] || '25') ? 'exposure-high' : ''}`}
                        style={{ width: `${Math.min(e.pctOfPortfolio, 100)}%` }}
                      />
                    </div>
                    <span className="exposure-pct">{e.pctOfPortfolio.toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── Trading Strategies by Broker ── */}
          {brokerIds.map((brokerId) => {
            const brokerStrats = byBroker[brokerId] || [];
            const brokerScoring = scoringByBroker[brokerId] || [];
            const badge = BROKER_BADGES[brokerId] || { label: brokerId, icon: '🔌', className: '' };
            const breakdown = brokerBreakdown.find(b => b.brokerId === brokerId);

            return (
              <section key={brokerId} className="allocator-section">
                <h2>
                  <span className={`broker-badge ${badge.className}`}>{badge.icon} {badge.label}</span>
                  {breakdown && (
                    <span className="broker-alloc">
                      £{breakdown.totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      {' '}({breakdown.allocationPct.toFixed(1)}% of portfolio)
                    </span>
                  )}
                </h2>

                {/* Trading Strategies */}
                {brokerStrats.length > 0 && (
                  <>
                    <h3>Trading Strategies ({brokerStrats.length})</h3>
                    <div className="strategy-table-wrap">
                      <table className="strategy-table">
                        <thead>
                          <tr>
                            <th>Name</th>
                            <th>Symbol</th>
                            <th>Mode</th>
                            <th>Threshold</th>
                            <th>Base Size</th>
                            <th>Max Pos</th>
                            <th>Active</th>
                          </tr>
                        </thead>
                        <tbody>
                          {brokerStrats.map((s) => (
                            <tr key={s.id} className={!s.active ? 'row-inactive' : ''}>
                              <td className="cell-name">{s.name}</td>
                              <td><span className="symbol-tag">{s.symbol}</span></td>
                              <td>
                                <span className={`mode-badge ${MODE_BADGES[s.mode]?.className || ''}`}>
                                  {MODE_BADGES[s.mode]?.label || s.mode}
                                </span>
                              </td>
                              <td>{s.minComposite || s.tradeThreshold || '—'}</td>
                              <td>{s.baseSize || '—'}</td>
                              <td>{s.maxPositions || 1}</td>
                              <td>
                                <span className={`status-dot ${s.active ? 'dot-active' : 'dot-inactive'}`} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}

                {/* Scoring Strategies */}
                {brokerScoring.length > 0 && (
                  <>
                    <h3>Scoring Strategies ({brokerScoring.length})</h3>
                    <div className="strategy-table-wrap">
                      <table className="strategy-table">
                        <thead>
                          <tr>
                            <th>Name</th>
                            <th>Watchlist</th>
                            <th>Protocol</th>
                            <th>Mode</th>
                            <th>Threshold</th>
                            <th>Base Size</th>
                            <th>Trading</th>
                          </tr>
                        </thead>
                        <tbody>
                          {brokerScoring.map((s) => (
                            <tr key={s.id} className={!s.enabled ? 'row-inactive' : ''}>
                              <td className="cell-name">{s.name}</td>
                              <td><span className="symbol-tag">{s.watchlistName}</span></td>
                              <td><code>{s.protocolId}</code></td>
                              <td>
                                <span className={`mode-badge ${MODE_BADGES[s.mode]?.className || ''}`}>
                                  {MODE_BADGES[s.mode]?.label || s.mode}
                                </span>
                              </td>
                              <td>{s.tradeThreshold || '—'}</td>
                              <td>{s.baseSize || '—'}</td>
                              <td>
                                <span className={`status-dot ${s.tradingEnabled ? 'dot-active' : 'dot-inactive'}`} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}

                {brokerStrats.length === 0 && brokerScoring.length === 0 && (
                  <p className="empty-msg">No strategies configured for this broker.</p>
                )}
              </section>
            );
          })}
        </div>

        {/* ── Right Column: Settings & Warnings ── */}
        <aside className="allocator-sidebar">
          <section className="sidebar-card">
            <h3>🔧 Global Settings</h3>
            <div className="setting-row">
              <label>Max Exposure / Symbol</label>
              <span className="setting-value">{settings['diversification.maxGlobalExposurePct'] || '25'}%</span>
            </div>
            <div className="setting-row">
              <label>Max Sector Exposure</label>
              <span className="setting-value">{settings['diversification.maxSectorExposurePct'] || '50'}%</span>
            </div>
            <div className="setting-row">
              <label>MT5 Allocation</label>
              <span className="setting-value">{settings['diversification.brokerAllocation.mt5'] || '50'}%</span>
            </div>
            <div className="setting-row">
              <label>Trading212 Allocation</label>
              <span className="setting-value">{settings['diversification.brokerAllocation.trading212'] || '35'}%</span>
            </div>
            <div className="setting-row">
              <label>ISA Allocation</label>
              <span className="setting-value">{settings['diversification.brokerAllocation.isa'] || '15'}%</span>
            </div>
          </section>

          {summary.warnings && summary.warnings.length > 0 && (
            <section className="sidebar-card warnings-card">
              <h3>⚠️ Warnings</h3>
              <ul className="warnings-list">
                {summary.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </section>
          )}

          <section className="sidebar-card help-card">
            <h3>💡 About Diversification</h3>
            <p>
              Holding the same stock on multiple brokers concentrates risk rather than spreading it.
              Set mode to <strong>Warn</strong> to be notified, or <strong>Strict</strong> to block duplicate positions.
            </p>
            <p>
              Use the <strong>Max Exposure / Symbol</strong> setting to cap how much of your total portfolio
              can be in any single symbol, regardless of which broker holds it.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
