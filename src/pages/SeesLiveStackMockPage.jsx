import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { buildSeesRanking } from '../core/sees/sees-engine'
import { fetchRankedSymbols } from '../core/api/scoring'
import './sees-live-stack.css'

const INITIAL_SYMBOLS = [
  { symbol: 'AAPL', name: 'Apple Inc.', industry: 'Consumer Electronics', basePrice: 198.32, baseBias: 0.22, baseQuality: 80.5 },
  { symbol: 'MSFT', name: 'Microsoft Corp.', industry: 'Software Infrastructure', basePrice: 462.75, baseBias: 0.34, baseQuality: 84.3 },
  { symbol: 'NVDA', name: 'NVIDIA Corp.', industry: 'Semiconductors', basePrice: 129.14, baseBias: 0.68, baseQuality: 88.7 },
  { symbol: 'TSLA', name: 'Tesla Inc.', industry: 'Auto Manufacturers', basePrice: 227.91, baseBias: -0.28, baseQuality: 69.4 },
  { symbol: 'META', name: 'Meta Platforms', industry: 'Internet Content', basePrice: 513.48, baseBias: 0.16, baseQuality: 77.1 },
  { symbol: 'AMD', name: 'Advanced Micro Devices', industry: 'Semiconductors', basePrice: 176.23, baseBias: -0.14, baseQuality: 74.5 },
]

const AUTO_INTERVAL_MS = 4000

export default function SeesLiveStackMockPage() {
  const [tick, setTick] = useState(0)
  const [lastUpdated, setLastUpdated] = useState(new Date())
  const [isAutoSorting, setIsAutoSorting] = useState(false)

  const apiQuery = useQuery({
    queryKey: ['scoring-ranked', tick],
    queryFn: () => fetchRankedSymbols(undefined, 20),
    refetchInterval: isAutoSorting ? AUTO_INTERVAL_MS : false,
    retry: 1,
    staleTime: 10_000,
  })

  const apiRanked = apiQuery.data?.ranked ?? []
  const useApi = apiRanked.length > 0 && apiRanked.some((r) => r.score > 0)

  const localRanking = useMemo(() => buildSeesRanking(INITIAL_SYMBOLS, tick), [tick])

  // Derive display state: prefer API data when available.
  // API returns { symbolId, ticker, score, confidence, freshness, timestamp }.
  // Strategy metadata and thresholds still come from the local engine until Task 5-6 deliver full API contracts.
  const apiRankingState = useMemo(() => {
    if (!useApi) return null

    const mode = apiQuery.data?.mode ?? 'api'
    const strategy = localRanking.strategy
    const directives = localRanking.directives

    const ranked = apiRanked.map((r) => ({
      symbolId: r.symbolId,
      ticker: r.ticker,
      name: r.ticker,
      industry: '—',
      price: null,
      changePercent: null,
      score: r.score,
      confidence: r.confidence,
      signal: r.score >= strategy.entryThreshold ? 'entry'
        : r.score >= strategy.watchThreshold ? 'watch'
        : 'defensive',
      baseScore: r.score,
      boostScore: null,
      scoreMultiplier: null,
      directives: null,
      moments: null,
      freshness: r.freshness ?? 'api',
      timestamp: r.timestamp,
      _source: 'api',
    }))

    return { strategy, directives, mode, ranked, marketAverageChange: null }
  }, [useApi, apiRanked, apiQuery.data?.mode, localRanking.strategy, localRanking.directives])

  const rankingState = apiRankingState ?? localRanking
  const rankedSymbols = rankingState.ranked
  const dataSource = useApi ? 'api' : 'local-direct-route'
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

  return (
    <main className="sees-page">
      <section className="sees-header">
        <div className="sees-title-wrap">
          <p className="eyebrow">Direct route operating mode <span className="mode-badge mode-local-direct-route" style={{ marginLeft: '0.5rem' }}>🧪 SIMULATION</span></p>
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
              <p className="sees-panel-label">Strategy</p>
              <h2>{rankingState.strategy.name}</h2>
            </div>
            <div className="mode-badge mode-local-direct-route">{rankingState.mode}</div>
          </header>
          <p className="sees-summary-text">{rankingState.strategy.description}</p>
          <div className="sees-thresholds">
            <span>Entry {rankingState.strategy.entryThreshold}</span>
            <span>Watch {rankingState.strategy.watchThreshold}</span>
            <span>Defense {rankingState.strategy.defenseThreshold}</span>
          </div>
        </article>

        <article className="sees-summary-card">
          <p className="sees-panel-label">Market Tilt</p>
          <strong className="sees-summary-value">
            {rankingState.marketAverageChange != null
              ? `${rankingState.marketAverageChange > 0 ? '+' : ''}${rankingState.marketAverageChange}%`
              : '—'}
          </strong>
          <p className="sees-summary-note">
            {dataSource === 'api' ? 'Not computed in API mode.' : 'Average change across the sample set.'}
          </p>
        </article>

        <article className="sees-summary-card">
          <p className="sees-panel-label">Symbols</p>
          <strong className="sees-summary-value">{rankedSymbols.length}</strong>
          <p className="sees-summary-note">Ranked from highest score to lowest.</p>
        </article>
      </section>

      <section className="sees-directives-grid" aria-label="SEES directives">
        {rankingState.directives.map((directive) => (
          <article className="sees-directive-card" key={directive.id}>
            <p className="sees-panel-label">Directive</p>
            <h3>{directive.label}</h3>
            <p className="sees-directive-indicator">{directive.indicator}</p>
            <p className="sees-directive-weight">Weight {(directive.weight * 100).toFixed(0)}%</p>
            <p className="sees-directive-description">{directive.description}</p>
          </article>
        ))}
      </section>

      <section className="sees-controls">
        <button type="button" className="btn btn-primary" onClick={mutateSymbols}>Refresh Data</button>
        {!isAutoSorting && (
          <button type="button" className="btn" onClick={() => setIsAutoSorting(true)}>Start Auto-Re-Sorting</button>
        )}
        {isAutoSorting && (
          <button type="button" className="btn" onClick={() => setIsAutoSorting(false)}>Stop Auto-Re-Sorting</button>
        )}
      </section>

      <section className="sees-logic-card">
        <h2>Calculation Chain</h2>
        {dataSource === 'api' ? (
          <>
            <p className="hint">Backend API active — scores computed by NestJS scoring pipeline.</p>
            <ol>
              <li>Fetch active symbols from database.</li>
              <li>Score each symbol through the deterministic scoring service (directive engine pending).</li>
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
                  <span className="v">{(row.confidence * 100).toFixed(0)}%</span>
                </div>
                {row.directives ? (
                  <>
                    <div>
                      <span className="k">Trend</span>
                      <span className="v">{row.directives.trend.toFixed(1)}</span>
                    </div>
                    <div>
                      <span className="k">Momentum</span>
                      <span className="v">{row.directives.momentum.toFixed(1)}</span>
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
                  <span className="v">{row.baseScore.toFixed(1)}</span>
                </div>
                <div>
                  <span className="k">Boost</span>
                  <span className="v">{row.boostScore != null ? `${row.boostScore >= 0 ? '+' : ''}${row.boostScore.toFixed(1)}` : '—'}</span>
                </div>
                <div>
                  <span className="k">Multiplier</span>
                  <span className="v">{row.scoreMultiplier != null ? `x${row.scoreMultiplier.toFixed(3)}` : '—'}</span>
                </div>
              </div>

              {row.directives && (
                <div className="directive-breakdown">
                  {rankingState.directives.map((directive) => (
                    <div className="directive-chip" key={`${row.symbolId}-${directive.id}`}>
                      <span>{directive.label}</span>
                      <strong>{row.directives[directive.id].toFixed(1)}</strong>
                    </div>
                  ))}
                </div>
              )}

              {row.moments && row.moments.length > 0 && (
                <div className="directive-breakdown">
                  {row.moments.map((moment) => (
                    <div className="directive-chip" key={`${row.symbolId}-${moment.id}`}>
                      <span>{moment.label}</span>
                      <strong>{moment.boost >= 0 ? '+' : ''}{moment.boost} · x{moment.multiplier}</strong>
                    </div>
                  ))}
                </div>
              )}
            </article>
          )
        })}
      </section>

      <section className="sees-notes-card">
        <h2>Why this direct route is not wasted work</h2>
        <ul>
          <li>The scoring engine is now a real module with explicit directive weights, additive boosts, and multipliers.</li>
          <li>The final score is intentionally not capped at 100, so significant moments can materially amplify rank outcomes.</li>
          <li>The UI is compact and explainable, so the project can evolve without prematurely building the complex strategy wizard flow.</li>
        </ul>
      </section>
    </main>
  )
}
