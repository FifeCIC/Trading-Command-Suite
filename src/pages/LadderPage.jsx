/**
 * Ladder
 * =====
 * The primary SEES scoring view. Pair a Watchlist with a Protocol
 * and get a live-ranked ladder of every symbol, refreshed
 * continuously as market data flows in.
 *
 * Layout clones Scoring Overview's clean card-based design.
 */
import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet, apiPost } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import RarityGauge from '../components/RarityGauge';
import Notice from '../components/Notice';
import useKeyboardShortcuts from '../hooks/useKeyboardShortcuts';
import { exportCsv } from '../utils/exportCsv';
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
  const [viewMode, setViewMode] = useState('table'); // 'table' | 'cards'
  const [showHelp, setShowHelp] = useState(false);

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

  // ── Planner objectives (for alignment indicator) ──
  const objQuery = useQuery({
    queryKey: ['los-objectives'],
    queryFn: () => apiGet('/api/planner/objectives').catch(() => []),
    staleTime: 120_000,
  });
  const objectives = Array.isArray(objQuery.data) ? objQuery.data.filter(o => o.status === 'active') : [];

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
  // Sort by composite descending — belt-and-suspenders with backend sort (#432)
  const scored = useMemo(
    () => [...(scoreQuery.data ?? [])].sort((a, b) => (b.composite ?? 0) - (a.composite ?? 0)),
    [scoreQuery.data],
  );

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

  // ── Data quality: detect uniform placeholder or weak data ──
  const dataQualityWarning = useMemo(() => {
    if (scored.length < 2) return null;
    const firstSignal = scored[0]?.signal;
    const allSameSignal = scored.every(r => r.signal === firstSignal);
    const allZeroRisk = scored.every(r => (r.riskMultiplier ?? 0) === 0);
    const allCommonRarity = scored.every(r => !r.rarity || r.rarity.band === 'common');
    const maxComposite = Math.max(...scored.map(r => r.composite ?? 0));
    const allWeak = maxComposite < 35 && scored.every(r => r.signal === 'HOLD');
    if (allSameSignal && allZeroRisk && allCommonRarity) {
      return `All ${scored.length} symbols show identical "${firstSignal}" signals with no risk differentiation — scoring pipeline may not have fresh market data.`;
    }
    if (allWeak) {
      return `⚠️ All ${scored.length} symbols scored weak (max composite ${maxComposite.toFixed(0)}/100). Market data may be limited — insufficient daily bars or no external sentiment APIs connected.`;
    }
    return null;
  }, [scored]);

  // ── Pairing guidance — based on REAL batch scoring data ──
  const pairingGuidance = useMemo(() => {
    if (!watchlistId || !protocolId) return null;
    if (scoreQuery.isLoading) return { level: 'info', text: '⏳ Computing scores from live pipeline…', reasons: [] };
    if (!scoreQuery.data || scored.length === 0) return null;
    const avg = scored.reduce((s, r) => s + (r.composite ?? 0), 0) / scored.length;
    const buyPct = scored.filter(r => r.signal === 'BUY').length / scored.length * 100;
    const reasons = [`${scored.length} symbols`, `avg ${avg.toFixed(0)}`, `${buyPct.toFixed(0)}% BUY`];
    if (avg >= 70) return { level: 'strong', text: '✅ Strong scoring — high composite across symbols', reasons };
    if (avg >= 40) return { level: 'ok', text: '⚡ Moderate scoring — mixed signals across symbols', reasons };
    return { level: 'weak', text: '⚠️ Weak scoring — low composite or few signals. Market data may be unavailable for these symbols.', reasons };
  }, [watchlistId, protocolId, scored, scoreQuery.isLoading, scoreQuery.data]);

  // ── Selected labels ──
  const selectedWatchlist = watchlists.find(w => w.id === watchlistId);
  const selectedProtocol = protocols.find(p => p.id === protocolId);

  // ── Keyboard shortcuts ──
  useKeyboardShortcuts({
    r: () => scoreQuery.refetch(),
    a: () => setAutoRefresh(v => !v),
    '?': () => setShowHelp(v => !v),
    Escape: () => setShowHelp(false),
    v: () => setViewMode(v => v === 'table' ? 'cards' : 'table'),
  });

  // ── CSV export ──
  const handleExportCsv = () => {
    if (scored.length === 0) return;
    const rows = scored.map((r, i) => ({
      rank: i + 1,
      symbol: r.symbol,
      composite: (r.composite ?? 0).toFixed(1),
      signal: r.signal ?? '—',
      rarity: r.rarity?.band ?? '—',
      risk: r.riskMultiplier != null ? `${(r.riskMultiplier * 100).toFixed(0)}%` : '—',
    }));
    exportCsv(rows, `sees-stack-${selectedProtocol?.name ?? 'scoring'}-${new Date().toISOString().slice(0, 10)}.csv`);
  };

  // ── Objectives alignment ──
  const alignedObjectives = useMemo(() => {
    if (!selectedProtocol || objectives.length === 0) return [];
    const protoName = (selectedProtocol.name || '').toLowerCase();
    const protoId = (selectedProtocol.id || '').toLowerCase();
    return objectives.filter(obj => {
      const strat = (obj.linkedStrategy || '').toLowerCase();
      const notes = (obj.notes || '').toLowerCase();
      const desc = (obj.description || '').toLowerCase();
      return strat.includes(protoName) || strat.includes(protoId)
        || notes.includes(protoName) || notes.includes(protoId)
        || desc.includes(protoName) || desc.includes(protoId)
        || (protoId.includes('mt5') && obj.category === 'active-trading')
        || (protoId.includes('speed') && obj.category === 'account-growth')
        || (protoId.includes('mt5') && (obj.title || '').toLowerCase().includes('mt5'));
    });
  }, [selectedProtocol, objectives]);

  // ── Loading ──
  if (wlQuery.isLoading || protoQuery.isLoading) {
    return (
      <div className="so-page">
        <header className="so-page-header"><h2>Ladder</h2></header>
        <LoadingSkeleton variant="card" count={4} />
        <LoadingSkeleton variant="table" rows={8} cols={5} className="ls-spacer-top" />
      </div>
    );
  }

  return (
    <div className="so-page">
      {/* ── Header ── */}
      <header className="so-page-header">
        <div>
          <h1>Ladder</h1>
          <p className="so-subtitle">
            {selectedWatchlist?.label ?? 'Select watchlist'} · {selectedProtocol?.name ?? 'Select protocol'}
          </p>
        </div>
        <div className="los-header-actions">
          <div className="los-view-tabs">
            <button className={`los-view-tab ${viewMode === 'table' ? 'active' : ''}`} onClick={() => setViewMode('table')} title="Table view (V)">☰ Table</button>
            <button className={`los-view-tab ${viewMode === 'cards' ? 'active' : ''}`} onClick={() => setViewMode('cards')} title="Card view (V)">▦ Cards</button>
          </div>
          <button className="los-export-btn" onClick={handleExportCsv} disabled={scored.length === 0} title="Export CSV">📥 CSV</button>
          <button className="los-help-btn" onClick={() => setShowHelp(v => !v)} title="Keyboard shortcuts (?)">?</button>
        </div>
      </header>

      {/* ── Pair selectors ── */}
      <div className="los-selectors">
        <label className="los-select-label">
          <span>Watchlist</span>
          <select value={watchlistId} onChange={e => setWatchlistId(e.target.value)} className="los-select">
            {watchlists.map(w => (
              <option key={w.id} value={w.id}>
                {w.label} ({w.symbolCount ?? '?'})
              </option>
            ))}
          </select>
        </label>
        <label className="los-select-label">
          <span>Protocol</span>
          <select value={protocolId} onChange={e => setProtocolId(e.target.value)} className="los-select">
            {protocols.map(p => (
              <option key={p.id} value={p.id}>
                {p.name ?? p.id}
              </option>
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

      {/* ── Pairing Guidance — based on real scored data ── */}
      {pairingGuidance && (
        <Notice level={pairingGuidance.level === 'strong' ? 'success' : pairingGuidance.level === 'ok' ? 'warning' : pairingGuidance.level === 'info' ? 'info' : 'critical'}>
          {pairingGuidance.text}
          {pairingGuidance.reasons.length > 0 && (
            <> — {pairingGuidance.reasons.join(', ')}</>
          )}
        </Notice>
      )}

      {/* ── Data Quality Warning ── */}
      {dataQualityWarning && (
        <Notice level="info">{dataQualityWarning}</Notice>
      )}

      {/* ── Objectives Alignment ── */}
      {alignedObjectives.length > 0 && (
        <Notice level="info" icon="🎯">
          Aligned with{' '}
          {alignedObjectives.map((obj, i) => (
            <span key={obj.id}>
              <a href="/planner/objectives" className="los-obj-link">{obj.title}</a>
              {i < alignedObjectives.length - 1 ? ', ' : ''}
            </span>
          ))}
        </Notice>
      )}

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

      {/* ── Ladder table ── */}
      <div className="los-stack-section">
        <div className="los-stack-header">
          <h2>Ladder</h2>
          {autoRefresh && <span className="los-live-badge">LIVE</span>}
          {!autoRefresh && <span className="los-paused-badge">PAUSED</span>}
        </div>

        {scored.length === 0 ? (
          <div className="so-empty ladder-empty">
            {symbolsQuery.isLoading ? (
              <p>Loading symbols…</p>
            ) : watchlistSymbols.length === 0 ? (
              <p>No symbols in this watchlist.</p>
            ) : (
              <>
                <p className="ladder-no-data-title">🔒 No Scoring Data</p>
                <p style={{ color: 'var(--ink-soft)', fontSize: '0.85rem', maxWidth: 480, margin: '0 auto' }}>
                  The Ladder requires active scoring data to display ranked symbols.
                  Ensure the protocol is active and market data (bars) is available for the symbols in this watchlist.
                </p>
                <p style={{ color: 'var(--ink-soft)', fontSize: '0.78rem', marginTop: '0.75rem' }}>
                  Features that will appear: ranked symbol list with BUY/SELL/HOLD signals, composite scores, and rarity indicators.
                </p>
              </>
            )}
          </div>
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
                      {r.riskMultiplier != null && r.riskMultiplier > 0
                        ? `${(r.riskMultiplier * 100).toFixed(0)}%`
                        : <span style={{color:'#64748b'}}>—</span>}
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
      </div>

      {/* ── Card View ── */}
      {viewMode === 'cards' && scored.length > 0 && (
        <div className="los-cards">
          {scored.map((r, i) => (
            <div key={r.symbol ?? i} className={`los-card ${i === 0 ? 'los-card-top' : ''}`}>
              <div className="los-card-head">
                <span className="los-card-rank">#{i + 1}</span>
                <span className="los-card-symbol">{r.symbol}</span>
                <span
                  className="los-card-score"
                  style={{ color: r.signal === 'BUY' ? '#22c55e' : r.signal === 'SELL' ? '#ef4444' : '#f59e0b' }}
                >{(r.composite ?? 0).toFixed(0)}</span>
                <span
                  className="los-card-signal"
                  style={{
                    background: (r.signal === 'BUY' ? '#22c55e' : r.signal === 'SELL' ? '#ef4444' : '#f59e0b') + '22',
                    color: r.signal === 'BUY' ? '#22c55e' : r.signal === 'SELL' ? '#ef4444' : '#f59e0b',
                  }}
                >{r.signal ?? '—'}</span>
              </div>
              <div className="los-card-body">
                <RarityGauge rarity={r.rarity} />
                <span className="los-card-risk">
                  Risk: {r.riskMultiplier != null && r.riskMultiplier > 0 ? `${(r.riskMultiplier * 100).toFixed(0)}%` : '—'}
                </span>
              </div>
              {(r.subScores || r.breakouts) && (
                <div className="los-card-chips">
                  {Object.entries(r.subScores || {}).filter(([, v]) => v !== 50).slice(0, 4).map(([k, v]) => (
                    <span key={k} className="los-card-chip" style={{
                      background: v > 65 ? 'rgba(34,197,94,0.1)' : v < 35 ? 'rgba(239,68,68,0.1)' : 'rgba(148,163,184,0.1)',
                      color: v > 65 ? '#22c55e' : v < 35 ? '#ef4444' : '#94a3b8',
                    }}>{k}: {v.toFixed(0)}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Help Modal ── */}
      {showHelp && (
        <div className="los-help-overlay" onClick={() => setShowHelp(false)}>
          <div className="los-help-modal" onClick={e => e.stopPropagation()}>
            <h3>Keyboard Shortcuts</h3>
            <table className="los-help-table">
              <tbody>
                <tr><td><kbd>R</kbd></td><td>Refresh data</td></tr>
                <tr><td><kbd>A</kbd></td><td>Toggle auto-refresh</td></tr>
                <tr><td><kbd>V</kbd></td><td>Toggle table/card view</td></tr>
                <tr><td><kbd>?</kbd></td><td>Show this help</td></tr>
                <tr><td><kbd>Esc</kbd></td><td>Close help</td></tr>
              </tbody>
            </table>
            <button className="los-help-close" onClick={() => setShowHelp(false)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
