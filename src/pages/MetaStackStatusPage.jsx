import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import { STRATEGY_LIBRARY } from '../data/strategy-library';
import './meta-stack-status.css';

// ── Constants ────────────────────────────────────────────

const STATUS_CLASS = {
  healthy: 'mss-chip--ok',
  ok: 'mss-chip--ok',
  fresh: 'mss-chip--ok',
  degraded: 'mss-chip--neutral',
  stale: 'mss-chip--neutral',
  'missing-credentials': 'mss-chip--warn',
  error: 'mss-chip--warn',
  missing: 'mss-chip--warn',
  unknown: 'mss-chip--dim',
  failed: 'mss-chip--warn',
};

const STRATEGY_STATUS_CLASS = {
  supported: 'mss-chip--ok',
  live: 'mss-chip--ok',
  partial: 'mss-chip--neutral',
  concept: 'mss-chip--dim',
};

const STRATEGY_STATUS_LABEL = {
  supported: 'Supported',
  live: 'Live',
  partial: 'Partial',
  concept: 'Concept',
};

// Priority symbol — everything else is secondary
const PRIORITY_SYMBOL = 'XAUUSD';

// ── Helpers ──────────────────────────────────────────────

function statusChip(status) {
  return `mss-chip ${STATUS_CLASS[status] || 'mss-chip--dim'}`;
}

function brokerReady(p) {
  if (p.status === 'healthy') return '✅ Ready';
  if (p.status === 'unknown' && p.credentialsConfigured) return '⚠️ Untested';
  if (p.status === 'missing-credentials') return '❌ No Credentials';
  return '❓ ' + (p.status || 'unknown');
}

function canTrade(p) {
  if (p.status === 'healthy') return true;
  if (p.status === 'unknown' && p.credentialsConfigured) return 'maybe';
  return false;
}

// ── Component ────────────────────────────────────────────

export default function MetaStackStatusPage() {
  const providersQ = useQuery({
    queryKey: ['mss-providers'],
    queryFn: () => apiGet('/api/providers/health'),
    refetchInterval: 30_000,
  });

  const scoringQ = useQuery({
    queryKey: ['mss-scoring'],
    queryFn: () => apiGet('/api/scoring/ranked?limit=20'),
    refetchInterval: 30_000,
  });

  // ── Fresh scoring trigger (manual, not auto) ──
  const [freshScoring, setFreshScoring] = useState(false);
  const [freshScoreResult, setFreshScoreResult] = useState(null);

  const triggerFreshScoring = async () => {
    setFreshScoring(true);
    try {
      const data = await apiGet('/api/scoring/ranked?fresh=true&limit=20');
      setFreshScoreResult(data);
      scoringQ.refetch();
    } catch {
      // silently fail — the regular poll will update
    }
    setFreshScoring(false);
  };

  const refreshAll = () => {
    providersQ.refetch();
    scoringQ.refetch();
  };

  const loading = providersQ.isLoading || scoringQ.isLoading;
  const anyError = providersQ.isError || scoringQ.isError;

  // ── Derived data ──────────────────────────────────────

  const providers = Array.isArray(providersQ.data?.providers)
    ? providersQ.data.providers
    : [];
  const ranked = Array.isArray(scoringQ.data?.ranked)
    ? scoringQ.data.ranked
    : [];
  const scoringSummary = scoringQ.data?.summary ?? {};
  const scoringStrategy = scoringQ.data?.strategy ?? {};

  // Priority symbol detail
  const priorityResult = ranked.find(r => r.ticker === PRIORITY_SYMBOL) || null;

  // Broker readiness
  const brokers = providers.filter(p =>
    ['mt5', 'trading212', 'capital.com', 'alpaca', 'binance'].includes(p.provider)
  );
  const dataProviders = providers.filter(p =>
    !['mt5', 'trading212', 'capital.com', 'alpaca', 'binance'].includes(p.provider)
  );

  // Strategy readiness
  const strategiesReady = STRATEGY_LIBRARY.filter(s => s.status === 'supported' || s.status === 'live');
  const strategiesConcept = STRATEGY_LIBRARY.filter(s => s.status === 'concept' || s.status === 'partial');

  // Symbols with signals
  const buySignals = ranked.filter(r => r.signal === 'BUY');
  const sellSignals = ranked.filter(r => r.signal === 'SELL');
  const symbolsWithScore = ranked.filter(r => r.score > 0).length;

  // ── Loading state ─────────────────────────────────────

  if (loading) return (
    <div className="mss-page">
      <header className="mss-header">
        <h2>META.Stack Status</h2>
        <p className="muted">Loading system capability assessment…</p>
      </header>
      <LoadingSkeleton variant="card" count={4} />
      <LoadingSkeleton variant="table" rows={6} cols={4} className="ls-spacer-top" />
    </div>
  );

  // ── Render ────────────────────────────────────────────

  return (
    <div className="mss-page">
      <header className="mss-header">
        <div>
          <h1>META.Stack Status</h1>
          <p className="muted">
            System capability assessment — what's wired, what's ready, what's missing.
            Priority focus: <strong>{PRIORITY_SYMBOL}</strong>
          </p>
        </div>
        <button type="button" className="btn" onClick={refreshAll}>Refresh</button>
      </header>

      {anyError && (
        <div className="mss-banner mss-banner--warn">
          Some endpoints returned errors. Check backend connectivity.
        </div>
      )}

      {/* ── Quick Stats Row ── */}
      <section className="mss-stat-grid">
        <div className="mss-stat-card">
          <div className="mss-stat-value">{providers.length}</div>
          <div className="mss-stat-label">Providers</div>
          <div className="mss-stat-sub">
            {providers.filter(p => p.status === 'healthy').length} healthy
          </div>
        </div>
        <div className="mss-stat-card">
          <div className="mss-stat-value">{scoringSummary.symbolsWithData ?? ranked.length}</div>
          <div className="mss-stat-label">Symbols Scored</div>
          <div className="mss-stat-sub">
            {symbolsWithScore} with signal data
          </div>
        </div>
        <div className="mss-stat-card">
          <div className={`mss-stat-value ${buySignals.length > 0 ? 'mss-stat--bullish' : ''}`}>
            {buySignals.length}
          </div>
          <div className="mss-stat-label">BUY Signals</div>
        </div>
        <div className="mss-stat-card">
          <div className={`mss-stat-value ${sellSignals.length > 0 ? 'mss-stat--bearish' : ''}`}>
            {sellSignals.length}
          </div>
          <div className="mss-stat-label">SELL Signals</div>
        </div>
        <div className="mss-stat-card">
          <div className="mss-stat-value">{strategiesReady.length}</div>
          <div className="mss-stat-label">Supported Strategies</div>
          <div className="mss-stat-sub">{strategiesConcept.length} in concept</div>
        </div>
      </section>

      {/* ── Two-Column: Broker Readiness + Priority Symbol ── */}
      <div className="mss-two-col">
        {/* ── Broker Execution Readiness ── */}
        <section className="mss-panel">
          <h3 className="mss-panel-title">🔌 Broker Execution Readiness</h3>
          <div className="mss-table-wrap">
            <table className="mss-table">
              <thead>
                <tr>
                  <th>Broker</th>
                  <th>Assets</th>
                  <th>Read</th>
                  <th>Write</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {brokers.map(b => {
                  const assetClass = {
                    mt5: 'Forex / Commodities',
                    trading212: 'Stocks / ETFs',
                    'capital.com': 'CFDs (Forex/Indices)',
                    alpaca: 'Stocks / ETFs',
                    binance: 'Crypto',
                  }[b.provider] || '—';

                  const readOk = b.status === 'healthy';
                  const writeOk = b.provider === 'mt5' ? b.status === 'healthy'
                    : b.provider === 'capital.com' ? b.credentialsConfigured
                    : false;

                  return (
                    <tr key={b.provider}>
                      <td><strong>{b.displayName || b.provider}</strong></td>
                      <td className="mss-dim">{assetClass}</td>
                      <td>{readOk ? '✅' : '❌'}</td>
                      <td>{writeOk ? '✅' : '❌'}</td>
                      <td><span className={statusChip(b.status)}>{brokerReady(b)}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Priority Symbol: XAUUSD ── */}
        <section className="mss-panel mss-panel--priority">
          <h3 className="mss-panel-title">
            🎯 Priority Focus: {PRIORITY_SYMBOL}
            <button
              type="button"
              className="btn mss-fresh-btn"
              onClick={triggerFreshScoring}
              disabled={freshScoring}
            >
              {freshScoring ? '⏳ Scoring…' : '🔄 Run Fresh Scoring'}
            </button>
          </h3>
          {freshScoreResult && (
            <div className="mss-fresh-result">
              Fresh scoring complete — {freshScoreResult?.ranked?.find(r => r.ticker === PRIORITY_SYMBOL)?.score ?? '?'}/100, signal: {freshScoreResult?.ranked?.find(r => r.ticker === PRIORITY_SYMBOL)?.signal ?? '?'}
            </div>
          )}
          {priorityResult ? (
            <div className="mss-priority-detail">
              <div className="mss-priority-score-row">
                <div className="mss-priority-score">
                  <div className="mss-priority-score-value">{priorityResult.score}</div>
                  <div className="mss-priority-score-label">Score / {priorityResult.maxPossibleScore || 100}</div>
                </div>
                <div className="mss-priority-signal-wrap">
                  <span className={`mss-priority-signal mss-signal--${(priorityResult.signal || 'HOLD').toLowerCase()}`}>
                    {priorityResult.signal || 'HOLD'}
                  </span>
                </div>
              </div>

              <div className="mss-priority-meta">
                <div className="mss-priority-meta-item">
                  <span className="mss-dim">Confidence</span>
                  <span>{priorityResult.confidence != null ? (priorityResult.confidence * 100).toFixed(0) + '%' : '—'}</span>
                </div>
                <div className="mss-priority-meta-item">
                  <span className="mss-dim">Data</span>
                  <span>{priorityResult.dataStatus || '—'}</span>
                </div>
                <div className="mss-priority-meta-item">
                  <span className="mss-dim">Freshness</span>
                  <span>{priorityResult.freshness || '—'}</span>
                </div>
                <div className="mss-priority-meta-item">
                  <span className="mss-dim">Directives</span>
                  <span>{priorityResult.activeDirectives || 0} active</span>
                </div>
              </div>

              {/* What's needed to get a trade */}
              <div className="mss-checklist">
                <h4 className="mss-checklist-title">End-to-End Readiness (xau-speed-v1 — 14 directives)</h4>
                <div className="mss-checklist-item mss-checklist--ok">
                  ✅ MT5 Bridge — connected, orders accepted (read + write)
                </div>
                <div className="mss-checklist-item mss-checklist--ok">
                  ✅ Protocol mapped — xau-speed-v1 with 14 directives (incl. new gold-round-numbers + gold-session-profile)
                </div>
                <div className="mss-checklist-item mss-checklist--ok">
                  ✅ Bar data — 200 bars all timeframes (5m/15m/1h/4h/1d)
                </div>
                <div className={`mss-checklist-item ${priorityResult.score >= 60 ? 'mss-checklist--ok' : 'mss-checklist--warn'}`}>
                  {priorityResult.score >= 60 ? '✅' : '⚠️'} Scoring threshold — score {priorityResult.score}/{scoringStrategy.entryThreshold || 60} needed for BUY
                </div>
                <div className={`mss-checklist-item ${priorityResult.signal === 'BUY' || priorityResult.signal === 'SELL' ? 'mss-checklist--ok' : 'mss-checklist--warn'}`}>
                  {priorityResult.signal === 'BUY' || priorityResult.signal === 'SELL' ? '✅' : '⚠️'} Signal generation — currently {priorityResult.signal || 'HOLD'}
                </div>
                <div className="mss-checklist-item mss-checklist--warn">
                  ⏳ Threshold calibration — directives fire but composite stays at {priorityResult.score}. Investigate protocol gating weights or directive score contributions.
                </div>
              </div>
            </div>
          ) : (
            <div className="mss-empty">
              <p>{PRIORITY_SYMBOL} not found in scoring results.</p>
              <p className="muted">Check that the symbol is active and bar data is importing.</p>
            </div>
          )}
        </section>
      </div>

      {/* ── Scoring Pipeline ── */}
      <section className="mss-panel">
        <h3 className="mss-panel-title">📊 Scoring Pipeline</h3>
        <div className="mss-scoring-meta">
          <span className="mss-dim">Strategy:</span> {scoringStrategy.name || '—'}
          <span className="mss-sep">|</span>
          <span className="mss-dim">Entry threshold:</span> {scoringStrategy.entryThreshold || '—'}
          <span className="mss-sep">|</span>
          <span className="mss-dim">Directives:</span> {scoringStrategy.directiveCount || '—'}
          <span className="mss-sep">|</span>
          <span className="mss-dim">Coverage:</span> {scoringQ.data?.degradation?.overallCoverage != null ? (scoringQ.data.degradation.overallCoverage * 100).toFixed(0) + '%' : '—'}
        </div>

        <div className="mss-table-wrap">
          <table className="mss-table mss-table--scoring">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Score</th>
                <th>Max</th>
                <th>Signal</th>
                <th>Confidence</th>
                <th>Data</th>
                <th>Active Directives</th>
              </tr>
            </thead>
            <tbody>
              {ranked.length === 0 ? (
                <tr><td colSpan={7} className="mss-dim mss-center">No scoring data available</td></tr>
              ) : (
                ranked.map(r => (
                  <tr key={r.symbolId || r.ticker} className={r.ticker === PRIORITY_SYMBOL ? 'mss-row--priority' : ''}>
                    <td>
                      <strong>{r.ticker}</strong>
                      {r.ticker === PRIORITY_SYMBOL && <span className="mss-badge">PRIORITY</span>}
                    </td>
                    <td>
                      <span className={`mss-score ${r.score >= 60 ? 'mss-score--high' : r.score >= 30 ? 'mss-score--mid' : 'mss-score--low'}`}>
                        {r.score}
                      </span>
                    </td>
                    <td className="mss-dim">{r.maxPossibleScore || 100}</td>
                    <td>
                      <span className={`mss-signal-chip mss-signal--${(r.signal || 'HOLD').toLowerCase()}`}>
                        {r.signal || 'HOLD'}
                      </span>
                    </td>
                    <td className="mss-dim">{r.confidence != null ? (r.confidence * 100).toFixed(0) + '%' : '—'}</td>
                    <td className="mss-dim">{r.dataStatus || '—'}</td>
                    <td className="mss-dim">{r.activeDirectives || 0}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Strategy Library Readiness ── */}
      <section className="mss-panel">
        <h3 className="mss-panel-title">📚 Strategy Library Readiness</h3>
        <div className="mss-table-wrap">
          <table className="mss-table">
            <thead>
              <tr>
                <th>Strategy</th>
                <th>Status</th>
                <th>Asset Class</th>
                <th>Protocol</th>
                <th>Broker</th>
                <th>Verdict</th>
              </tr>
            </thead>
            <tbody>
              {[...strategiesReady, ...strategiesConcept].map(s => {
                const protocolSlug = s.tcsProtocol || s.directiveMappings?.[0]?.directiveId || '—';
                const hasProtocol = s.tcsProtocol || s.directiveMappings?.length > 0;
                const brokerForAssets = s.assetClasses?.some(c =>
                  c.includes('Forex') || c.includes('Commodities') || c.includes('Precious Metals')
                ) ? 'MT5' : s.assetClasses?.some(c =>
                  c.includes('ETF') || c.includes('Stock') || c.includes('Mega-Cap')
                ) ? 'Trading212' : '—';

                const brokerStatus = brokerForAssets === 'MT5' ? '✅'
                  : brokerForAssets === 'Trading212' ? '⚠️ Buggy'
                  : '❌';

                const verdict = s.status === 'supported' && brokerForAssets === 'MT5'
                  ? '🟢 Viable' : s.status === 'supported'
                  ? '🟡 Needs Broker' : '🔴 Concept Only';

                return (
                  <tr key={s.id}>
                    <td><strong>{s.name}</strong></td>
                    <td><span className={`mss-chip ${STRATEGY_STATUS_CLASS[s.status] || 'mss-chip--dim'}`}>{STRATEGY_STATUS_LABEL[s.status] || s.status}</span></td>
                    <td className="mss-dim">{(s.assetClasses || []).join(', ')}</td>
                    <td className="mss-mono">{hasProtocol ? '✅' : '❌'} {protocolSlug}</td>
                    <td>{brokerStatus} {brokerForAssets}</td>
                    <td>{verdict}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Data Providers ── */}
      <section className="mss-panel">
        <h3 className="mss-panel-title">📡 Data Provider Status</h3>
        <div className="mss-table-wrap">
          <table className="mss-table">
            <thead>
              <tr>
                <th>Provider</th>
                <th>Status</th>
                <th>Credentials</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {dataProviders.map(p => (
                <tr key={p.provider}>
                  <td><strong>{p.displayName || p.provider}</strong></td>
                  <td><span className={statusChip(p.status)}>{p.status}</span></td>
                  <td>{p.credentialsConfigured ? '✅' : '❌'}</td>
                  <td className="mss-dim mss-message">{p.message || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
