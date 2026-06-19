import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { buildSeesRanking } from '../core/sees/sees-engine'
import { fetchRankedSymbols } from '../core/api/scoring'
import { exportCsv } from '../utils/exportCsv'
import useKeyboardShortcuts from '../hooks/useKeyboardShortcuts'
import './sees-live-stack.css'

const AUTO_INTERVAL_MS = 4000

export default function SeesLiveStackMockPage() {
  const [tick, setTick] = useState(0)
  const [lastUpdated, setLastUpdated] = useState(new Date())
  const [isAutoSorting, setIsAutoSorting] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [showAllDirectives, setShowAllDirectives] = useState(false)

  // Strategy-weighted directive IDs (weights > 0)
  const STRATEGY_DIRECTIVE_IDS = ['rsi-oversold', 'macd-crossover', 'ema-structure', 'atr-dip', 'volume-confirmation']

  // Demo symbols for the local simulation engine
  const SEES_SYMBOLS = [
    { symbol: 'NVDA', ticker: 'NVDA', name: 'NVIDIA Corp', basePrice: 142, baseBias: 0.25, baseQuality: 78 },
    { symbol: 'TSLA', ticker: 'TSLA', name: 'Tesla Inc', basePrice: 245, baseBias: -0.15, baseQuality: 62 },
    { symbol: 'AAPL', ticker: 'AAPL', name: 'Apple Inc', basePrice: 198, baseBias: 0.10, baseQuality: 85 },
    { symbol: 'BTCUSD', ticker: 'BTCUSD', name: 'Bitcoin', basePrice: 68500, baseBias: 0.35, baseQuality: 55 },
    { symbol: 'MSFT', ticker: 'MSFT', name: 'Microsoft Corp', basePrice: 420, baseBias: 0.08, baseQuality: 80 },
    { symbol: 'EURUSD', ticker: 'EURUSD', name: 'Euro / USD', basePrice: 1.085, baseBias: -0.05, baseQuality: 70 },
    { symbol: 'AMD', ticker: 'AMD', name: 'AMD Inc', basePrice: 165, baseBias: 0.18, baseQuality: 68 },
    { symbol: 'XAUUSD', ticker: 'XAUUSD', name: 'Gold Spot', basePrice: 2420, baseBias: 0.12, baseQuality: 72 },
    { symbol: 'META', ticker: 'META', name: 'Meta Platforms', basePrice: 510, baseBias: 0.22, baseQuality: 74 },
    { symbol: 'SPX500', ticker: 'SPX500', name: 'S&P 500', basePrice: 5480, baseBias: -0.02, baseQuality: 88 },
  ]

  const apiQuery = useQuery({
    queryKey: ['scoring-ranked', tick],
    queryFn: () => fetchRankedSymbols(undefined, 20),
    refetchInterval: isAutoSorting ? AUTO_INTERVAL_MS : false,
    retry: 1,
    staleTime: 10_000,
  })

  const apiRanked = apiQuery.data?.ranked ?? []
  const useApi = apiRanked.length > 0 && apiRanked.some((r) => r.score > 0)

  const localRanking = useMemo(() => buildSeesRanking(SEES_SYMBOLS, tick), [tick])

  // Derive display state: prefer API data when available.
  // API now returns breakdown[] per symbol with real directive scores.
  const apiRankingState = useMemo(() => {
    if (!useApi) return null

    const mode = apiQuery.data?.mode ?? 'api'
    const apiStrategy = apiQuery.data?.strategy ?? {}
    const localStrategy = localRanking?.strategy ?? {}
    const localDirectives = localRanking?.directives ?? []
    const strategy = {
      name: apiStrategy.name || localStrategy.name || 'SEES Default',
      description: 'Real directive pipeline: 5 MVP directives with weighted aggregation.',
      entryThreshold: apiStrategy.entryThreshold ?? localStrategy.entryThreshold ?? 60,
      watchThreshold: apiStrategy.watchThreshold ?? localStrategy.watchThreshold ?? 40,
      defenseThreshold: localStrategy.defenseThreshold ?? 20,
    }

    // Use real directive list from API breakdown, or fall back to simulation labels
    const hasBreakdown = apiRanked.some((r) => Array.isArray(r.breakdown) && r.breakdown.length > 0)
    const directives = hasBreakdown
      ? [...new Set(apiRanked.flatMap((r) => (r.breakdown || []).map((b) => b.directiveId)))]
          .map((id, i) => {
            const sample = apiRanked.flatMap((r) => r.breakdown || []).find((b) => b.directiveId === id)
            return { id, label: sample?.name || id, indicator: 'API directive', weight: (sample?.weight || 20) / 100, description: 'Real directive from scoring pipeline.' }
          })
      : localDirectives

    const ranked = apiRanked.map((r) => {
      const breakdown = Array.isArray(r.breakdown) ? r.breakdown : []
      const breakdownDirectives = breakdown.length > 0
        ? Object.fromEntries(breakdown.map((b) => [b.directiveId, b.contribution || 0]))
        : null

      return {
        symbolId: r.symbolId,
        ticker: r.ticker,
        name: r.ticker,
        industry: '—',
        price: null,
        changePercent: null,
        score: r.score,
        confidence: r.confidence,
        signal: r.signal || (r.score >= strategy.entryThreshold ? 'entry'
          : r.score >= strategy.watchThreshold ? 'watch'
          : 'defensive'),
        baseScore: r.score,
        boostScore: null,
        scoreMultiplier: null,
        directives: breakdownDirectives,
        moments: null,
        freshness: r.freshness ?? 'api',
        timestamp: r.timestamp,
        _source: 'api',
        _breakdown: breakdown,
      }
    })

    return { strategy, directives, mode, ranked, marketAverageChange: null }
  }, [useApi, apiRanked, apiQuery.data?.mode, apiQuery.data?.strategy, localRanking])

  const rankingState = apiRankingState ?? localRanking
  if (!rankingState) {
    return (
      <main className="sees-page">
        <section className="sees-header">
          <div className="sees-title-wrap">
            <h1>SEES Live Stack</h1>
          </div>
        </section>
        <div className="pf-unavailable">
          <h2>SEES Scoring Not Available</h2>
          <p>The scoring pipeline requires a running backend with configured data providers.</p>
          <p className="pf-hint">Start the NestJS API server (port 3201) and ensure market data providers are configured.</p>
        </div>
      </main>
    );
  }
  const rankedSymbols = rankingState.ranked
  const dataSource = useApi ? 'api' : 'local-direct-route'
  const hasRealBreakdown = useApi && apiRanked.some((r) => Array.isArray(r.breakdown) && r.breakdown.length > 0)
  const apiMeta = useApi ? {
    freshness: [...new Set(apiRanked.map(r => r.freshness))].join(', '),
    symbolCount: apiRanked.length,
    services: apiQuery.data?.services ?? {},
  } : null

  const mutateSymbols = () => {
    setTick((current) => current + 1)

    setLastUpdated(new Date())
  }

  useEffect(() => {
    if (!isAutoSorting) {
      return undefined
    }

    const id = window.setInterval(() => {
      mutateSymbols()
    }, AUTO_INTERVAL_MS)

    return () => window.clearInterval(id)
  }, [isAutoSorting])

  // Keyboard shortcuts
  useKeyboardShortcuts({
    r: () => { setTick((t) => t + 1); setLastUpdated(new Date()); apiQuery.refetch(); },
    a: () => setIsAutoSorting((v) => !v),
    '?': () => setShowHelp((v) => !v),
    Escape: () => setShowHelp(false),
  });

  return (
    <main className="sees-page">
      <section className="sees-header">
        <div className="sees-title-wrap">
          <p className="eyebrow">Direct route operating mode <span className={`mode-badge ${hasRealBreakdown ? 'mode-full' : 'mode-local-direct-route'}`} style={{ marginLeft: '0.5rem' }}>{hasRealBreakdown ? '🔌 LIVE PIPELINE' : '🧪 SIMULATION'}</span></p>
        </div>

        <div className="sees-status-card" role="status" aria-live="polite">
          <p><strong>Status:</strong> {isAutoSorting ? 'Auto-Re-Scoring Active' : 'Manual Refresh'}</p>
          <p><strong>Mode:</strong> <span className={`mode-badge mode-${rankingState.mode}`}>{rankingState.mode}</span></p>
          <p><strong>Source:</strong> {dataSource === 'api' ? 'Backend API (live)' : 'Local Engine (simulation)'}</p>
          {apiMeta && (
            <>
              <p><strong>Symbols scored:</strong> {apiMeta.symbolCount}</p>
              <p><strong>Freshness:</strong> {apiMeta.freshness}</p>
              {apiMeta.services.database === false && <p className="hint">Database offline — scores are deterministic.</p>}
            </>
          )}
          <p><strong>Last updated:</strong> {lastUpdated.toLocaleTimeString()}</p>
        </div>
      </section>

      <section className="sees-summary-grid">
        <article className="sees-summary-card sees-summary-card--wide">
          <header className="sees-panel-header">
            <div>
              <p className="sees-panel-label">Protocol</p>
              <h2>{rankingState.strategy.name}</h2>
            </div>
            <div className={`mode-badge ${hasRealBreakdown ? 'mode-full' : 'mode-local-direct-route'}`}>{rankingState.mode}</div>
          </header>
          <p className="sees-summary-text">{rankingState.strategy.description}</p>
          <div className="sees-thresholds">
            <span>Entry {rankingState.strategy.entryThreshold}</span>
            <span>Watch {rankingState.strategy.watchThreshold}</span>
            <span>Defense {rankingState.strategy.defenseThreshold}</span>
            <span>{rankingState.directives.length} directives</span>
          </div>
        </article>

        <article className="sees-summary-card">
          <p className="sees-panel-label">Market Tilt</p>
          <strong className="sees-summary-value">—</strong>
          <p className="sees-summary-note">Available with real market data</p>
        </article>

        <article className="sees-summary-card">
          <p className="sees-panel-label">Symbols</p>
          <strong className="sees-summary-value">{rankedSymbols.length}</strong>
          <p className="sees-summary-note">Ranked from highest score to lowest.</p>
        </article>
      </section>

      {/* What does this mean? — collapsible explanation */}
      <details className="sees-explanation">
        <summary>📖 What does this mean?</summary>
        <div className="sees-explanation-body">
          <p><strong>Score</strong> — The aggregate score (0–100) from the 5 strategy-weighted directives. <em>Score ≥ 60 = entry signal, ≥ 40 = watch, &lt; 40 = defensive.</em></p>
          <p><strong>5 of 71 directives</strong> are active in this strategy (RSI, MACD, EMA, ATR, Volume). The other 66 exist in the library but have weight=0.</p>
          <p><strong>Data Source</strong> — <span style={{ color: '#4ade80' }}>Live</span> = real market data from provider. <span style={{ color: '#fbbf24' }}>Free API</span> = delayed data (15-min). <span style={{ color: '#64748b' }}>Mock</span> = simulation mode.</p>
          <p><strong>Confidence</strong> (0–1) — How strongly the directives agree. High confidence = most directives point the same direction.</p>
        </div>
      </details>

      <section className="sees-controls">
        <button type="button" className="btn btn-primary" onClick={mutateSymbols}>Refresh Data</button>
        {!isAutoSorting && (
          <button type="button" className="btn" onClick={() => setIsAutoSorting(true)}>Start Auto-Re-Sorting</button>
        )}
        {isAutoSorting && (
          <button type="button" className="btn" onClick={() => setIsAutoSorting(false)}>Stop Auto-Re-Sorting</button>
        )}        <button
          type="button"
          className="btn"
          onClick={() => {
            const directives = rankingState.directives
            const columns = [
              { key: 'ticker', label: 'Ticker' },
              { key: 'score', label: 'Score' },
              { key: 'confidence', label: 'Confidence' },
              { key: 'signal', label: 'Signal' },
              { key: 'freshness', label: 'Freshness' },
              ...directives.map((d) => ({
                key: `directives.${d.id}`,
                label: d.label,
                format: (v) => (v != null ? Number(v).toFixed(1) : ''),
              })),
            ]
            const comments = [
              `Strategy: ${rankingState.strategy.name}`,
              `Mode: ${rankingState.mode}`,
              `Source: ${dataSource}`,
            ]
            exportCsv(rankedSymbols, columns, 'sees-ranking.csv', { comments })
          }}
        >
          Export CSV
        </button>
      </section>

      <section className="sees-logic-card">
        <h2>Calculation Chain</h2>
        {dataSource === 'api' ? (
          <>
            <p className="hint">Backend API active — scores computed by NestJS scoring pipeline.</p>
            <ol>
              <li>Fetch active symbols from database.</li>
              <li>Score each symbol through the 5-directive pipeline (RSI, MACD, EMA, ATR, Volume).</li>
              <li>Apply strategy thresholds to classify entry, watch, or defense states.</li>
              <li>Rank the output and return via <code>GET /api/scoring/ranked</code>.</li>
            </ol>
          </>
        ) : (
          <ol>
            <li>Generate a live market snapshot from the base symbol set.</li>
            <li>Score each symbol through trend, momentum, volatility, breadth, and conviction directives.</li>
            <li>Apply the strategy thresholds to classify entry, watch, or defense states.</li>
            <li>Rank the output so the UI can stay small while still explaining the result.</li>
          </ol>
        )}
      </section>

      <section className="stack" aria-label="SEES ranked symbols">
        {rankedSymbols.map((row, index) => {
          const isApiRow = row._source === 'api'
          const positive = row.changePercent != null ? row.changePercent >= 0 : null
          const delta = row.changePercent != null
            ? `${positive ? '+' : ''}${row.changePercent.toFixed(2)}%`
            : '—'
          const signalTone = row.signal === 'entry' ? 'signal-entry' : row.signal === 'watch' ? 'signal-watch' : 'signal-defensive'

          return (
            <article className="stack-card" key={row.symbolId}>
              <header className="stack-header">
                <div className="stack-rank">#{index + 1}</div>
                <div>
                  <h2>{row.ticker}</h2>
                  <p>{row.name}{isApiRow && <span className="chip chip--neutral" style={{marginLeft: 8}}>API</span>}</p>
                </div>
                <div className="score-stack">
                  <div className="score-pill">Score {row.score.toFixed(1)}</div>
                  <div className={`signal-pill ${signalTone}`}>{row.signal}</div>
                </div>
              </header>

              <div className="stack-grid">
                <div>
                  <span className="k">Industry</span>
                  <span className="v">{row.industry || '—'}</span>
                </div>
                <div>
                  <span className="k">Price</span>
                  <span className="v">{row.price != null ? `$${row.price.toFixed(2)}` : '—'}</span>
                </div>
                <div>
                  <span className="k">Change</span>
                  <span className={`v ${positive ? 'up' : positive === false ? 'down' : ''}`}>{delta}</span>
                </div>
                <div>
                  <span className="k">Confidence</span>
                  <span className="v">{row.confidence != null ? (row.confidence * 100).toFixed(0) : '—'}%</span>
                </div>
                {row.directives ? (
                  <>
                    <div>
                      <span className="k">Trend</span>
                      <span className="v">{row.directives.trend?.toFixed(1) ?? '—'}</span>
                    </div>
                    <div>
                      <span className="k">Momentum</span>
                      <span className="v">{row.directives.momentum?.toFixed(1) ?? '—'}</span>
                    </div>
                  </>
                ) : (
                  <div>
                    <span className="k">Freshness</span>
                    <span className="v">{row.freshness || '—'}</span>
                  </div>
                )}
                <div>
                  <span className="k">Base Score</span>
                  <span className="v">{row.baseScore?.toFixed(1) ?? '—'}</span>
                </div>
                <div>
                  <span className="k">Source</span>
                  <span className="v" style={{ fontSize: '0.78rem', color: isApiRow ? 'var(--ink-soft)' : 'var(--ink-soft)' }}>
                    {isApiRow ? '🔌 API pipeline' : '🧪 simulation'}
                  </span>
                </div>
              </div>

              {row._breakdown && row._breakdown.length > 0 ? (
                <div className="directive-breakdown">
                  {row._breakdown.map((b) => (
                    <div className="directive-chip" key={`${row.symbolId}-${b.directiveId}`} title={b.reason || ''}>
                      <span>{b.name || b.directiveId}</span>
                      <strong>{b.contribution != null ? b.contribution.toFixed(1) : '—'}</strong>
                    </div>
                  ))}
                </div>
              ) : row.directives ? (
                <div className="directive-breakdown">
                  {rankingState.directives.map((directive) => (
                    <div className="directive-chip" key={`${row.symbolId}-${directive.id}`}>
                      <span>{directive.label}</span>
                      <strong>{row.directives[directive.id]?.toFixed(1) ?? '—'}</strong>
                    </div>
                  ))}
                </div>
              ) : null}

              {row._breakdown && row._breakdown.length > 0 && (
                <div style={{ marginTop: 8, fontSize: '0.78rem', color: 'var(--ink-soft)' }}>
                  {row._breakdown.slice(0, 2).map((b) => (
                    b.reason ? <p key={b.directiveId} style={{ margin: '2px 0' }}>• {b.name}: {b.reason}</p> : null
                  ))}
                </div>
              )}

              {row.moments && row.moments.length > 0 && (
                <div className="directive-breakdown">
                  <p className="sees-summary-note" style={{ margin: 0, fontSize: '0.78rem' }}>
                    🧪 Simulation events: {row.moments.map((m) => m.label).join(', ')}
                  </p>
                </div>
              )}
            </article>
          )
        })}
      </section>

      <section className="sees-notes-card">
        {dataSource === 'api' && apiRanked.some((r) => Array.isArray(r.breakdown) && r.breakdown.length > 0) ? (
          <>
            <h2>🔌 Live Pipeline — real directive scoring</h2>
            <ul>
              <li>Scoring is powered by 5 real directives: RSI Oversold, MACD Crossover, EMA Structure, ATR Dip, Volume Confirmation.</li>
              <li>Each directive returns a score (0–100), confidence (0–1), and human-readable reason — visible in chips and tooltips above.</li>
              <li>Aggregate scores use canonical weights (24/22/20/18/16) per <code>docs/CANONICAL-DIRECTIVE-REFERENCE.md</code>.</li>
              <li>The UI layout is compact and explainable, driven by real pipeline output from the NestJS backend.</li>
            </ul>
          </>
        ) : (
          <>
            <h2>🧪 Simulation — not production scoring</h2>
            <ul>
              <li>This page uses synthetic math for visual prototyping when API is unavailable.</li>
              <li>The real directive engine is implemented in <code>nest/src/modules/directives/implementations/</code> and drives the API pipeline when the backend is connected.</li>
              <li>The production scoring model is a simple weighted average capped at 0–100. No boosts, no multipliers. See <code>docs/CANONICAL-DIRECTIVE-REFERENCE.md</code>.</li>
              <li>The UI layout and component structure are reusable — only the scoring math needs replacement when real directives ship.</li>
            </ul>
          </>
        )}
      </section>

      {showHelp && (
        <div className="sees-help-overlay" onClick={() => setShowHelp(false)}>
          <div className="sees-help-modal" onClick={(e) => e.stopPropagation()}>
            <h2>⌨ Keyboard Shortcuts</h2>
            <table className="sees-help-table">
              <tbody>
                <tr><td><kbd>R</kbd></td><td>Refresh data</td></tr>
                <tr><td><kbd>A</kbd></td><td>Toggle auto-sort ({isAutoSorting ? 'ON' : 'OFF'})</td></tr>
                <tr><td><kbd>?</kbd></td><td>Show/hide this help</td></tr>
                <tr><td><kbd>Esc</kbd></td><td>Close help</td></tr>
              </tbody>
            </table>
            <button type="button" className="btn" onClick={() => setShowHelp(false)}>Close</button>
          </div>
        </div>
      )}

      <p className="sees-shortcuts-hint">Press <kbd>?</kbd> for keyboard shortcuts</p>
    </main>
  )
}
