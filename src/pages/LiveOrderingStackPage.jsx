/**
 * Live Ordering Stack
 * ===================
 * The primary SEES scoring view. Pair a Watchlist with a Protocol
 * and get a live-ranked ordering stack of every symbol, refreshed
 * continuously as market data flows in.
 *
 * Layout clones Scoring Overview's clean card-based design.
 */
import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet, apiPost } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import RarityGauge from '../components/RarityGauge';
import './scoring-overview.css';

const REFRESH_MS = 15_000;

const SIGNAL_COLORS = {
  entry: '#22c55e',
  exit: '#ef4444',
  hold: '#f59e0b',
  unknown: '#64748b',
};

const FRESHNESS_COLORS = {
  fresh: 'so-freshness--fresh',
  stale: 'so-freshness--stale',
  missing: 'so-freshness--missing',
  deterministic: 'so-freshness--deterministic',
};

export default function LiveOrderingStackPage() {
  const [watchlistId, setWatchlistId] = useState('');
  const [protocolId, setProtocolId] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);

  // ── Available watchlists ──
  const wlQuery = useQuery({
    queryKey: ['los-watchlists'],
    queryFn: () => apiGet('/api/watchlists').catch(() => []),
    staleTime: 60_000,
  });
  const watchlists = Array.isArray(wlQuery.data) ? wlQuery.data : [];

  // ── Available protocols ──
  const protoQuery = useQuery({
    queryKey: ['los-protocols'],
    queryFn: () => apiGet('/api/scoring/gated/protocols').catch(() => ({ protocols: [] })),
    staleTime: 60_000,
  });
  const protocols = (protoQuery.data?.protocols ?? []).filter(p => p.source === 'code');

  // ── Auto-select first watchlist + matching protocol ──
  useEffect(() => {
    if (watchlists.length > 0 && !watchlistId) {
      const first = watchlists[0];
      setWatchlistId(first.id);
      // Try to match protocol name to watchlist
      const wlName = (first.label || '').toLowerCase();
      const match = protocols.find(p =>
        (p.name || '').toLowerCase().includes(wlName) ||
        p.id.includes(wlName.replace(/\s+/g, '-'))
      );
      setProtocolId(match ? match.id : (protocols[0]?.id ?? ''));
    }
  }, [watchlists, protocols, watchlistId]);

  // ── Watchlist symbols ──
  const symbolsQuery = useQuery({
    queryKey: ['los-symbols', watchlistId],
    queryFn: () => apiGet(`/api/watchlists/${watchlistId}`).catch(() => ({ symbols: [] })),
    enabled: !!watchlistId,
    staleTime: 30_000,
  });
  const watchlistSymbols = symbolsQuery.data?.symbols ?? [];

  // ── Scored results via gated pipeline (includes rarity) ──
  const scoreQuery = useQuery({
    queryKey: ['los-scored', watchlistId, protocolId],
    queryFn: async () => {
      if (!watchlistId || !protocolId) return [];
      const tickers = watchlistSymbols.map(s => s.ticker).filter(Boolean);
      if (tickers.length === 0) return [];
      return apiPost('/api/scoring/gated/batch', {
        tickers,
        protocolId,
      }).catch(() => []);
    },
    refetchInterval: autoRefresh ? REFRESH_MS : false,
    enabled: !!watchlistId && !!protocolId && watchlistSymbols.length > 0,
  });
  const scored = scoreQuery.data ?? [];

  // ── Stats ──
  const stats = useMemo(() => {
    const withData = watchlistSymbols.length;
    const scoredCount = scored.length;
    const avgComposite = scoredCount > 0
      ? scored.reduce((s, r) => s + (r.composite ?? 0), 0) / scoredCount
      : 0;
    const buyCount = scored.filter(r => r.signal === 'BUY').length;
    const sellCount = scored.filter(r => r.signal === 'SELL').length;
    const holdCount = scored.filter(r => r.signal === 'HOLD').length;
    const topSignal = scored[0]?.signal ?? '—';
    const rareCount = scored.filter(r => r.rarity?.band === 'cyclical' || r.rarity?.band === 'exceptional').length;
    return { withData, scoredCount, avgComposite, buyCount, sellCount, holdCount, topSignal, rareCount };
  }, [scored, watchlistSymbols]);

  // ── Selected labels ──
  const selectedWatchlist = watchlists.find(w => w.id === watchlistId);
  const selectedProtocol = protocols.find(p => p.id === protocolId);

  // ── Loading ──
  if (wlQuery.isLoading || protoQuery.isLoading) {
    return (
      <div className="so-page">
        <header className="so-page-header"><h2>Live Ordering Stack</h2></header>
        <LoadingSkeleton variant="card" count={4} />
        <LoadingSkeleton variant="table" rows={8} cols={5} className="ls-spacer-top" />
      </div>
    );
  }

  return (
    <div className="so-page">
      {/* ── Header ── */}
      <header className="so-page-header">
        <h1>Live Ordering Stack</h1>
        <p className="so-subtitle">
          {selectedWatchlist?.label ?? 'Select watchlist'} · {selectedProtocol?.name ?? 'Select protocol'}
        </p>
      </header>

      {/* ── Pair selectors ── */}
      <div className="los-selectors">
        <label className="los-select-label">
          <span>Watchlist</span>
          <select value={watchlistId} onChange={e => setWatchlistId(e.target.value)} className="los-select">
            {watchlists.map(w => (
              <option key={w.id} value={w.id}>{w.label} ({w.symbolCount ?? '?'} symbols)</option>
            ))}
          </select>
        </label>
        <label className="los-select-label">
          <span>Protocol</span>
          <select value={protocolId} onChange={e => setProtocolId(e.target.value)} className="los-select">
            {protocols.map(p => (
              <option key={p.id} value={p.id}>{p.name ?? p.id}</option>
            ))}
          </select>
        </label>
        <button
          className={`los-auto-btn ${autoRefresh ? 'active' : ''}`}
          onClick={() => setAutoRefresh(!autoRefresh)}
          title={autoRefresh ? 'Auto-refreshing every 15s' : 'Click to enable auto-refresh'}
        >
          {autoRefresh ? '⏸ Auto' : '▶ Manual'} 
        </button>
      </div>

      {/* ── Summary cards ── */}
      <div className="so-summary-grid">
        <div className="so-summary-card">
          <p className="so-card-label">Symbols in Watchlist</p>
          <span className="so-card-value">{stats.withData}</span>
          <p className="so-card-note">{stats.scoredCount} scored · {stats.withData - stats.scoredCount} pending</p>
        </div>
        <div className="so-summary-card">
          <p className="so-card-label">Avg Composite Score</p>
          <span className="so-card-value">{stats.avgComposite.toFixed(1)}</span>
          <p className="so-card-note">{selectedProtocol?.name ?? '—'}</p>
        </div>
        <div className="so-summary-card">
          <p className="so-card-label">Signal Split</p>
          <span className="so-card-value">
            <span style={{ color: '#22c55e' }}>{stats.buyCount}</span>
            {' / '}
            <span style={{ color: '#f59e0b' }}>{stats.holdCount}</span>
            {' / '}
            <span style={{ color: '#ef4444' }}>{stats.sellCount}</span>
          </span>
          <p className="so-card-note">buy / hold / sell signals</p>
        </div>
        <div className="so-summary-card">
          <p className="so-card-label">Rare Opportunities</p>
          <span className="so-card-value" style={{ color: stats.rareCount > 0 ? '#f59e0b' : '#64748b' }}>
            {stats.rareCount}
          </span>
          <p className="so-card-note">cyclical / exceptional alignments</p>
        </div>
      </div>

      {/* ── Live Ordering Stack table ── */}
      <section className="so-panel los-stack-panel">
        <div className="los-stack-header">
          <h2>Ordering Stack</h2>
          {autoRefresh && <span className="los-live-badge">LIVE</span>}
          {!autoRefresh && <span className="los-paused-badge">PAUSED</span>}
        </div>

        {scored.length === 0 ? (
          <p className="so-empty">
            {symbolsQuery.isLoading ? 'Loading symbols…' : 
             watchlistSymbols.length === 0 ? 'No symbols in this watchlist.' :
             'No scored data yet. The scoring pipeline may need market data for these symbols.'}
          </p>
        ) : (
          <div className="los-stack-table-wrap">
            <table className="los-stack-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Symbol</th>
                  <th>Score</th>
                  <th>Signal</th>
                  <th>Rarity</th>
                  <th>Risk</th>
                </tr>
              </thead>
              <tbody>
                {scored.map((r, i) => (
                  <tr key={r.symbol ?? i} className={i === 0 ? 'los-row-top' : ''}>
                    <td className="los-rank">{i + 1}</td>
                    <td className="los-ticker">{r.symbol}</td>
                    <td className="los-score">
                      <div className="los-score-bar-wrap">
                        <div
                          className="los-score-bar"
                          style={{
                            width: `${Math.min(100, (r.composite ?? 0))}%`,
                            background: r.signal === 'BUY' ? '#22c55e' : r.signal === 'SELL' ? '#ef4444' : '#f59e0b',
                          }}
                        />
                      </div>
                      <span className="los-score-val">{(r.composite ?? 0).toFixed(1)}</span>
                    </td>
                    <td>
                      <span className="los-signal-chip" style={{
                        background: r.signal === 'BUY' ? '#22c55e' : r.signal === 'SELL' ? '#ef4444' : '#f59e0b',
                        color: '#fff',
                      }}>
                        {r.signal ?? '—'}
                      </span>
                    </td>
                    <td><RarityGauge rarity={r.rarity} compact /></td>
                    <td className="los-norm">
                      {r.riskMultiplier != null ? `${(r.riskMultiplier * 100).toFixed(0)}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {scoreQuery.isFetching && autoRefresh && (
          <p className="los-refreshing">Refreshing…</p>
        )}
      </section>
    </div>
  );
}
