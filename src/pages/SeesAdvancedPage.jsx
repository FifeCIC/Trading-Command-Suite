import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiGet, apiPost } from '../core/api/client'
import { exportCsv } from '../utils/exportCsv'
import useKeyboardShortcuts from '../hooks/useKeyboardShortcuts'
import ProtocolPicker from '../components/ProtocolPicker'
import './sees-live-stack.css'

const AUTO_INTERVAL_MS = 4000

export default function SeesAdvancedPage() {
  const [tick, setTick] = useState(0)
  const [lastUpdated, setLastUpdated] = useState(new Date())
  const [isAutoSorting, setIsAutoSorting] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [watchlistId, setWatchlistId] = useState('')
  const [protocolId, setProtocolId] = useState('')

  // ── Fetch watchlists ──
  const watchlistsQuery = useQuery({
    queryKey: ['sees-watchlists'],
    queryFn: () => apiGet('/api/watchlists').catch(() => ({ watchlists: [] })),
    staleTime: 30_000,
  })
  const watchlists = watchlistsQuery.data?.watchlists ?? []

  // ── Fetch protocols (same as LiveOrderingStack) ──
  const protocolsQuery = useQuery({
    queryKey: ['sees-protocols'],
    queryFn: () => apiGet('/api/scoring/gated/protocols').catch(() => ({ protocols: [] })),
    staleTime: 60_000,
  })
  const protocols = protocolsQuery.data?.protocols ?? []

  // ── Fetch selected watchlist symbols ──
  const symbolsQuery = useQuery({
    queryKey: ['sees-symbols', watchlistId],
    queryFn: () => apiGet(`/api/watchlists/${watchlistId}`).catch(() => ({ symbols: [] })),
    enabled: !!watchlistId,
    staleTime: 30_000,
  })
  const watchlistSymbols = symbolsQuery.data?.symbols ?? []

  // ── Scored results via gated pipeline (SAME as LiveOrderingStack) ──
  const scoreQuery = useQuery({
    queryKey: ['sees-scored', watchlistId, protocolId, tick],
    queryFn: async () => {
      if (!watchlistId || !protocolId) return [];
      const tickers = watchlistSymbols.map(s => s.ticker).filter(Boolean);
      if (tickers.length === 0) return [];
      return apiPost('/api/scoring/gated/batch', {
        tickers,
        protocolId,
      }).catch(() => []);
    },
    refetchInterval: isAutoSorting ? AUTO_INTERVAL_MS : false,
    enabled: !!watchlistId && !!protocolId && watchlistSymbols.length > 0,
  });
  // Sort by composite descending — safety net with backend sort (#432)
  const scored = useMemo(
    () => [...(scoreQuery.data ?? [])].sort((a, b) => (b.composite ?? 0) - (a.composite ?? 0)),
    [scoreQuery.data],
  );

  const hasData = scored.length > 0;
  const selectedProtocol = protocols.find((p) => p.id === protocolId);
  const selectedWatchlist = watchlists.find((w) => w.id === watchlistId);

  const mutateSymbols = () => {
    setTick((current) => current + 1)
    setLastUpdated(new Date())
    scoreQuery.refetch()
  }

  useEffect(() => {
    if (!isAutoSorting) return undefined
    const id = window.setInterval(() => { mutateSymbols() }, AUTO_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [isAutoSorting])

  useKeyboardShortcuts({
    r: () => { setTick((t) => t + 1); setLastUpdated(new Date()); scoreQuery.refetch(); },
    a: () => setIsAutoSorting((v) => !v),
    '?': () => setShowHelp((v) => !v),
    Escape: () => setShowHelp(false),
  });

  // Auto-select first watchlist and protocol
  useEffect(() => {
    if (!watchlistId && watchlists.length > 0) {
      const def = watchlists.find((w) => w.isDefault) || watchlists[0];
      setWatchlistId(def.id);
    }
  }, [watchlists, watchlistId]);

  useEffect(() => {
    if (!protocolId && protocols.length > 0) {
      setProtocolId(protocols[0].id);
    }
  }, [protocols, protocolId]);

  if (!watchlists.length || !protocols.length) {
    return (
      <main className="sees-page">
        <section className="sees-header"><h1>SEES Advanced</h1></section>
        <div className="pf-unavailable">
          <h2>SEES Scoring Not Available</h2>
          <p>The scoring pipeline requires a running backend with configured data providers.</p>
        </div>
      </main>
    );
  }

  const rankedSymbols = scored.map((r, i) => ({
    symbolId: r.symbol || `s-${i}`,
    ticker: r.symbol || '—',
    name: r.symbol || '—',
    industry: '—',
    price: null,
    changePercent: null,
    score: r.composite ?? 0,
    confidence: r.confidence ?? 0,
    signal: r.signal || (r.composite >= 60 ? 'entry' : r.composite >= 40 ? 'watch' : 'defensive'),
    baseScore: r.composite ?? 0,
    boostScore: null,
    scoreMultiplier: null,
    directives: r.breakouts || {},
    freshness: 'gated-pipeline',
    _source: 'api',
    _breakdown: Object.entries(r.breakouts || {}).map(([k, v]) => ({
      directiveId: k,
      name: k,
      contribution: v,
      weight: 1,
      reason: '',
    })),
    subScores: r.subScores,
    riskMultiplier: r.riskMultiplier,
  }));

  return (
    <main className="sees-page">
      <section className="sees-header">
        <div className="sees-title-wrap">
          <p className="eyebrow">Gated pipeline <span className="mode-badge mode-full">🔌 LIVE</span></p>
        </div>
      </section>

      {/* Watchlist + Protocol selectors (same as LiveOrderingStack) */}
      <section className="sees-controls" style={{ gap: '1rem', flexWrap: 'wrap' }}>
        <div className="va-field">
          <label>Watchlist</label>
          <select value={watchlistId} onChange={(e) => setWatchlistId(e.target.value)}>
            {watchlists.map((w) => <option key={w.id} value={w.id}>{w.name} ({w.symbolCount || '?'})</option>)}
          </select>
        </div>
        <div className="va-field">
          <label>Protocol</label>
          <ProtocolPicker
            value={protocolId}
            onChange={setProtocolId}
            protocols={protocols}
          />
        </div>
        <button type="button" className="btn btn-primary" onClick={mutateSymbols}>Refresh</button>
        <button type="button" className="btn" onClick={() => setIsAutoSorting((v) => !v)}>
          {isAutoSorting ? 'Stop Auto' : 'Auto Refresh'}
        </button>
        <button type="button" className="btn" onClick={() => {
          exportCsv(rankedSymbols, [
            { key: 'ticker', label: 'Ticker' },
            { key: 'score', label: 'Score' },
            { key: 'confidence', label: 'Confidence' },
            { key: 'signal', label: 'Signal' },
          ], 'sees-advanced.csv');
        }}>Export CSV</button>
      </section>

      {/* Status */}
      <div className="sees-status-card">
        <p><strong>Status:</strong> {isAutoSorting ? 'Auto-Refresh Active' : 'Manual'}</p>
        <p><strong>Pipeline:</strong> POST /api/scoring/gated/batch (same as Live Ordering Stack)</p>
        <p><strong>Protocol:</strong> {selectedProtocol?.name || protocolId} · {selectedProtocol?.directiveCount || '?'} directives</p>
        <p><strong>Symbols scored:</strong> {scored.length} / {watchlistSymbols.length}</p>
        <p><strong>Last updated:</strong> {lastUpdated.toLocaleTimeString()}</p>
      </div>

      {!hasData && !scoreQuery.isLoading && (
        <div className="pf-unavailable">
          <h2>No data yet</h2>
          <p>Select a watchlist and protocol, then click Refresh. Scores come from the same pipeline as the Live Ordering Stack.</p>
        </div>
      )}

      {scoreQuery.isLoading && <p style={{ padding: '1rem' }}>Scoring…</p>}

      {/* Ranked symbols */}
      <section className="stack" aria-label="SEES ranked symbols">
        {rankedSymbols.map((row, index) => {
          const signalTone = row.signal === 'entry' ? 'signal-entry' : row.signal === 'watch' ? 'signal-watch' : 'signal-defensive'
          return (
            <article className="stack-card" key={row.symbolId}>
              <header className="stack-header">
                <div className="stack-rank">#{index + 1}</div>
                <div>
                  <h2>{row.ticker}</h2>
                  <p>{row.name}<span className="chip chip--neutral" style={{marginLeft: 8}}>GATED</span></p>
                </div>
                <div className="score-stack">
                  <div className="score-pill">Score {row.score.toFixed(1)}</div>
                  <div className={`signal-pill ${signalTone}`}>{row.signal}</div>
                </div>
              </header>

              <div className="stack-grid">
                <div><span className="k">Confidence</span><span className="v">{(row.confidence * 100).toFixed(0)}%</span></div>
                <div><span className="k">Base Score</span><span className="v">{row.baseScore.toFixed(1)}</span></div>
                {row.subScores && (
                  <>
                    <div><span className="k">Technical</span><span className="v">{row.subScores.technical?.toFixed(1) || '—'}</span></div>
                    <div><span className="k">Sentiment</span><span className="v">{row.subScores.sentiment?.toFixed(1) || '—'}</span></div>
                    <div><span className="k">Risk</span><span className="v">{row.subScores.risk?.toFixed(1) || '—'}</span></div>
                  </>
                )}
                {row.riskMultiplier != null && (
                  <div><span className="k">Risk ×</span><span className="v">{row.riskMultiplier.toFixed(2)}</span></div>
                )}
              </div>

              {row._breakdown && row._breakdown.length > 0 && (
                <div className="directive-breakdown">
                  {row._breakdown.map((b) => (
                    <div className="directive-chip" key={b.directiveId} title={b.reason || ''}>
                      <span>{b.name || b.directiveId}</span>
                      <strong>{b.contribution != null ? Number(b.contribution).toFixed(1) : '—'}</strong>
                    </div>
                  ))}
                </div>
              )}
            </article>
          )
        })}
      </section>

      <section className="sees-notes-card">
        <h2>🔌 Gated Pipeline — same as Live Ordering Stack</h2>
        <ul>
          <li>Both SEES Advanced and Live Ordering Stack now use <code>POST /api/scoring/gated/batch</code>.</li>
          <li>Select the same watchlist + protocol on both pages to verify scores match identically.</li>
          <li>Risk directives multiplicatively gate Technical + Sentiment scores via the protocol gating service.</li>
        </ul>
      </section>

      {showHelp && (
        <div className="sees-help-overlay" onClick={() => setShowHelp(false)}>
          <div className="sees-help-modal" onClick={(e) => e.stopPropagation()}>
            <h2>⌨ Keyboard Shortcuts</h2>
            <table className="sees-help-table"><tbody>
              <tr><td><kbd>R</kbd></td><td>Refresh data</td></tr>
              <tr><td><kbd>A</kbd></td><td>Toggle auto-refresh</td></tr>
              <tr><td><kbd>?</kbd></td><td>Show/hide help</td></tr>
              <tr><td><kbd>Esc</kbd></td><td>Close help</td></tr>
            </tbody></table>
            <button type="button" className="btn" onClick={() => setShowHelp(false)}>Close</button>
          </div>
        </div>
      )}
    </main>
  );
}
