/**
 * Daily Briefing Page
 * ===================
 * Morning/evening trading briefings with priority-tiered news,
 * calendar events, overnight movers, P&L summary, and analyst changes.
 *
 * Data sources:
 *   GET /api/automation/timeline    — calendar events
 *   GET /api/providers/mt5/diagnostics — portfolio summary
 *   GET /api/providers/mt5/positions   — open positions
 *   GET /api/scoring/ranked         — top scored symbols
 *   GET /api/watchlists             — watchlist data
 */
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { apiGet } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import './daily-briefing.css';

const PRIORITY_TIERS = {
  invested: { label: 'Invested', color: '#22c55e', weight: 1 },
  starred:  { label: 'Starred',  color: '#f59e0b', weight: 2 },
  watchlist:{ label: 'Watchlist',color: '#3b82f6', weight: 3 },
  other:    { label: 'General',  color: '#64748b', weight: 4 },
};

function formatCurrency(n) {
  if (n == null) return '—';
  return '$' + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2 });
}

function timeUntil(iso) {
  if (!iso) return '';
  const diff = new Date(iso) - Date.now();
  if (diff <= 0) return 'now';
  const m = Math.floor(diff / 60000);
  const h = Math.floor(m / 60);
  if (h > 24) return Math.floor(h / 24) + 'd ' + (h % 24) + 'h';
  if (h > 0) return h + 'h ' + (m % 60) + 'm';
  return m + 'm';
}

export default function DailyBriefingPage() {
  const [mode, setMode] = useState('morning'); // 'morning' | 'evening'
  const [expanded, setExpanded] = useState(null);
  const [tierFilter, setTierFilter] = useState('all');

  // ── Calendar events ──
  const timelineQuery = useQuery({
    queryKey: ['briefing-timeline'],
    queryFn: () => apiGet('/api/automation/timeline?lookahead=1440').catch(() => null),
    refetchInterval: 120_000,
  });
  const events = timelineQuery.data?.events || [];

  // ── Portfolio ──
  const diagQuery = useQuery({
    queryKey: ['briefing-diag'],
    queryFn: () => apiGet('/api/providers/mt5/diagnostics').catch(() => null),
    refetchInterval: 60_000,
  });
  const diag = diagQuery.data || {};
  const mt5Connected = diag.connected === true;

  const posQuery = useQuery({
    queryKey: ['briefing-positions'],
    queryFn: () => apiGet('/api/providers/mt5/positions').catch(() => ({ positions: [] })),
    refetchInterval: 60_000,
    enabled: mt5Connected,
  });
  const positions = posQuery.data?.positions || [];
  const totalPnl = positions.reduce((s, p) => s + (p.profit || 0), 0);
  const winners = positions.filter(p => (p.profit || 0) > 0).length;
  const losers = positions.filter(p => (p.profit || 0) < 0).length;

  // ── Top movers ──
  const rankedQuery = useQuery({
    queryKey: ['briefing-ranked'],
    queryFn: () => apiGet('/api/scoring/ranked?limit=10').catch(() => ({ ranked: [] })),
    refetchInterval: 60_000,
  });
  const ranked = rankedQuery.data?.ranked || [];

  // ── Watchlists ──
  const wlQuery = useQuery({
    queryKey: ['briefing-watchlists'],
    queryFn: () => apiGet('/api/watchlists').catch(() => []),
    staleTime: 120_000,
  });
  const watchlists = Array.isArray(wlQuery.data) ? wlQuery.data : [];

  // ── Invested symbols set ──
  const investedSymbols = useMemo(() => {
    const set = new Set();
    positions.forEach(p => set.add(p.symbol?.toUpperCase()));
    return set;
  }, [positions]);

  // ── Watchlist symbols set ──
  const watchlistSymbols = useMemo(() => {
    const set = new Set();
    watchlists.forEach(w => (w.symbols || []).forEach(s => {
      const ticker = (typeof s === 'string' ? s : s.ticker || '').toUpperCase();
      if (ticker) set.add(ticker);
    }));
    return set;
  }, [watchlists]);

  // ── Assign priority tiers to scored symbols ──
  const tieredSymbols = useMemo(() => {
    return ranked.map(r => {
      const sym = (r.ticker || r.symbol || '').toUpperCase();
      if (investedSymbols.has(sym)) return { ...r, tier: 'invested', symbol: sym };
      if (watchlistSymbols.has(sym)) return { ...r, tier: 'watchlist', symbol: sym };
      return { ...r, tier: 'other', symbol: sym };
    }).sort((a, b) => {
      const tw = PRIORITY_TIERS[a.tier].weight - PRIORITY_TIERS[b.tier].weight;
      if (tw !== 0) return tw;
      return (b.score || 0) - (a.score || 0);
    });
  }, [ranked, investedSymbols, watchlistSymbols]);

  const filteredSymbols = tierFilter === 'all'
    ? tieredSymbols
    : tieredSymbols.filter(s => s.tier === tierFilter);

  // ── Overnight movers (top 3 gainers + top 3 losers) ──
  const overnightGainers = ranked.slice(0, 3);
  const overnightLosers = ranked.slice(-3).reverse();

  // ── Loading ──
  const isLoading = timelineQuery.isLoading || diagQuery.isLoading || rankedQuery.isLoading;

  if (isLoading) {
    return (
      <div className="db-page">
        <header className="db-header"><h1>Daily Briefing</h1></header>
        <LoadingSkeleton variant="card" count={3} />
        <LoadingSkeleton variant="text" lines={8} className="ls-spacer-top" />
      </div>
    );
  }

  return (
    <div className="db-page">
      <header className="db-header">
        <div>
          <h1>📋 Daily Briefing</h1>
          <p className="db-subtitle">
            {mode === 'morning' ? 'Morning session prep — news, calendar, overnight moves' : 'Evening wrap-up — P&L, positions, tomorrow preview'}
          </p>
        </div>
        <div className="db-mode-toggle">
          <button
            className={`db-mode-btn ${mode === 'morning' ? 'active' : ''}`}
            onClick={() => setMode('morning')}
          >☀️ Morning</button>
          <button
            className={`db-mode-btn ${mode === 'evening' ? 'active' : ''}`}
            onClick={() => setMode('evening')}
          >🌙 Evening</button>
        </div>
      </header>

      {/* ── Portfolio Snapshot (both modes) ── */}
      <section className="db-snapshot-grid">
        <div className="db-snap-card">
          <span className="db-snap-label">Balance</span>
          <span className="db-snap-value">{formatCurrency(diag.balance)}</span>
        </div>
        <div className="db-snap-card">
          <span className="db-snap-label">Equity</span>
          <span className="db-snap-value">{formatCurrency(diag.equity)}</span>
        </div>
        <div className="db-snap-card">
          <span className="db-snap-label">Open Positions</span>
          <span className="db-snap-value">{positions.length}</span>
        </div>
        <div className="db-snap-card">
          <span className="db-snap-label">Unrealized P&amp;L</span>
          <span className={`db-snap-value ${totalPnl >= 0 ? 'up' : 'down'}`}>
            {totalPnl >= 0 ? '+' : ''}{totalPnl.toFixed(2)}
          </span>
        </div>
        <div className="db-snap-card">
          <span className="db-snap-label">Win/Loss</span>
          <span className="db-snap-value">{winners}W / {losers}L</span>
        </div>
      </section>

      {/* ── Morning Briefing ── */}
      {mode === 'morning' && (
        <>
          {/* Calendar Events */}
          <section className="db-section">
            <h2>📅 Today's Calendar</h2>
            {events.length === 0 ? (
              <p className="db-empty">No events scheduled for today.</p>
            ) : (
              <div className="db-event-list">
                {events.slice(0, 6).map((e, i) => (
                  <div key={i} className={`db-event ${e.type === 'SESSION_OPEN' ? 'db-event-session' : ''}`}>
                    <span className="db-event-icon">{e.type === 'SESSION_OPEN' ? '🔔' : e.type === 'economic' ? '📊' : '📅'}</span>
                    <span className="db-event-label">{e.label || e.type}</span>
                    <span className="db-event-time">{timeUntil(e.startsAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Overnight Movers */}
          <div className="db-two-col">
            <section className="db-section">
              <h2>🟢 Overnight Gainers</h2>
              {overnightGainers.length === 0 ? (
                <p className="db-empty">No data yet.</p>
              ) : (
                <div className="db-mover-list">
                  {overnightGainers.map((r, i) => (
                    <div key={i} className="db-mover db-mover-up">
                      <span className="db-mover-rank">#{i + 1}</span>
                      <a href={`/research/symbol/${r.symbolId || r.ticker}`} className="db-mover-ticker">{r.ticker || r.symbol}</a>
                      <span className="db-mover-score" style={{color: '#22c55e'}}>{r.score || '—'}</span>
                      <span className="db-mover-signal">{r.signal || '—'}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="db-section">
              <h2>🔴 Overnight Losers</h2>
              {overnightLosers.length === 0 ? (
                <p className="db-empty">No data yet.</p>
              ) : (
                <div className="db-mover-list">
                  {overnightLosers.map((r, i) => (
                    <div key={i} className="db-mover db-mover-down">
                      <span className="db-mover-rank">#{i + 1}</span>
                      <a href={`/research/symbol/${r.symbolId || r.ticker}`} className="db-mover-ticker">{r.ticker || r.symbol}</a>
                      <span className="db-mover-score" style={{color: '#ef4444'}}>{r.score || '—'}</span>
                      <span className="db-mover-signal">{r.signal || '—'}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </>
      )}

      {/* ── Evening Briefing ── */}
      {mode === 'evening' && (
        <>
          {/* P&L Summary */}
          <section className="db-section">
            <h2>💼 Session P&amp;L Summary</h2>
            {positions.length === 0 ? (
              <p className="db-empty">No open positions.</p>
            ) : (
              <div className="db-positions-table-wrap">
                <table className="db-positions-table">
                  <thead><tr><th>Symbol</th><th>Type</th><th>Volume</th><th>Open</th><th>Current</th><th>P&amp;L</th></tr></thead>
                  <tbody>
                    {positions.map(p => (
                      <tr key={p.ticket}>
                        <td><strong>{p.symbol}</strong></td>
                        <td className={p.type === 'buy' ? 'db-buy' : 'db-sell'}>{p.type?.toUpperCase()}</td>
                        <td>{p.volume}</td>
                        <td>{p.priceOpen?.toFixed(2)}</td>
                        <td>{p.priceCurrent?.toFixed(2)}</td>
                        <td className={p.profit >= 0 ? 'db-profit' : 'db-loss'}>
                          {p.profit >= 0 ? '+' : ''}{p.profit?.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Tomorrow Preview */}
          <section className="db-section">
            <h2>📅 Tomorrow's Preview</h2>
            {events.length === 0 ? (
              <p className="db-empty">No events scheduled for tomorrow.</p>
            ) : (
              <div className="db-event-list">
                {events.slice(0, 4).map((e, i) => (
                  <div key={i} className="db-event">
                    <span className="db-event-icon">📅</span>
                    <span className="db-event-label">{e.label || e.type}</span>
                    <span className="db-event-time">{timeUntil(e.startsAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {/* ── Priority-Tiered Symbol Briefs (both modes) ── */}
      <section className="db-section">
        <div className="db-tier-header">
          <h2>📊 Symbol Briefs</h2>
          <div className="db-tier-filters">
            {['all', ...Object.keys(PRIORITY_TIERS)].map(t => (
              <button
                key={t}
                className={`db-tier-chip ${tierFilter === t ? 'active' : ''}`}
                style={t !== 'all' ? { borderColor: PRIORITY_TIERS[t]?.color } : {}}
                onClick={() => setTierFilter(t)}
              >
                {t === 'all' ? 'All Tiers' : PRIORITY_TIERS[t]?.label}
              </button>
            ))}
          </div>
        </div>

        {filteredSymbols.length === 0 ? (
          <p className="db-empty">No symbols to display for this tier.</p>
        ) : (
          <div className="db-brief-list">
            {filteredSymbols.slice(0, 12).map((item, i) => {
              const tier = PRIORITY_TIERS[item.tier];
              const isExpanded = expanded === item.symbol;
              return (
                <motion.div
                  key={item.symbol}
                  className={`db-brief-card ${isExpanded ? 'expanded' : ''}`}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                >
                  <div className="db-brief-row" onClick={() => setExpanded(isExpanded ? null : item.symbol)}>
                    <span className="db-brief-tier" style={{ background: tier.color }}>{tier.label}</span>
                    <span className="db-brief-symbol">{item.symbol}</span>
                    <span className="db-brief-score" style={{ color: (item.score || 0) >= 50 ? '#22c55e' : (item.score || 0) >= 25 ? '#f59e0b' : '#ef4444' }}>
                      {item.score || '—'}
                    </span>
                    <span className="db-brief-signal">{item.signal || '—'}</span>
                    <span className="db-brief-chevron">{isExpanded ? '▾' : '▸'}</span>
                  </div>

                  {isExpanded && (
                    <div className="db-brief-detail">
                      <div className="db-brief-actions">
                        <a href={`/research/symbol/${item.symbolId || item.symbol}`} className="db-brief-action">🔍 Research</a>
                        <button className="db-brief-action" onClick={() => {/* add to watchlist */}}>⭐ Watch</button>
                        <button className="db-brief-action" onClick={() => {/* create alert */}}>🔔 Alert</button>
                      </div>
                      <div className="db-brief-metrics">
                        <span><small>Score</small> <strong>{item.score || '—'}</strong></span>
                        <span><small>Signal</small> <strong>{item.signal || '—'}</strong></span>
                        <span><small>Tier</small> <strong style={{color: tier.color}}>{tier.label}</strong></span>
                      </div>
                      <p className="db-brief-note">
                        {item.tier === 'invested' ? 'You hold this position. Monitor for exit signals or profit-taking opportunities.'
                         : item.tier === 'watchlist' ? 'On your watchlist. Consider reviewing for entry if scores strengthen.'
                         : 'General market mover. Add to watchlist if you want to track this symbol.'}
                      </p>
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Footer ── */}
      <p className="db-footer">
        Auto-refresh every 60s · Last updated {new Date().toLocaleTimeString()}
        {' · '}
        <button type="button" className="db-refresh-link" onClick={() => { rankedQuery.refetch(); timelineQuery.refetch(); diagQuery.refetch(); }}>
          Refresh now
        </button>
      </p>
    </div>
  );
}
