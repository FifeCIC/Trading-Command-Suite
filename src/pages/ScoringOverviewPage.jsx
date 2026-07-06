/**
 * Scoring Overview Dashboard Page
 * ===============================
 * System-level scoring health dashboard. Consumes GET /api/scoring/ranked
 * via TanStack Query with 30s auto-refresh.
 *
 * Shows:
 * - Summary cards: total scored, mode, avg score, freshness distribution
 * - Score distribution bar chart
 * - Strategy configuration card
 * - Top symbols mini-table
 * - Empty / loading / error states
 */

import { useQuery } from '@tanstack/react-query';
import { fetchRankedSymbols } from '../core/api/scoring';
import LoadingSkeleton from '../components/LoadingSkeleton';
import { usePreferences } from '../core/hooks/usePreferences';
import { useDataFreshness } from '../core/hooks/useDataFreshness';
import './scoring-overview.css';

const TABLE_STYLES = [
  { value: 'default', label: 'Default' },
  { value: 'compact', label: 'Compact' },
  { value: 'bordered', label: 'Bordered' },
  { value: 'striped', label: 'Striped' },
];

/** @param {{ low: number, high: number }} bucket @param {number} val */
function inBucket(bucket, val) {
  return val >= bucket.low && val <= bucket.high;
}

const SCORE_BUCKETS = [
  { low: 0, high: 20, label: '0–20', css: 'so-bucket--low' },
  { low: 21, high: 40, label: '21–40', css: 'so-bucket--watch' },
  { low: 41, high: 60, label: '41–60', css: 'so-bucket--mid' },
  { low: 61, high: 80, label: '61–80', css: 'so-bucket--entry' },
  { low: 81, high: 100, label: '81–100', css: 'so-bucket--strong' },
];

const FRESHNESS_COLORS = {
  fresh: 'so-freshness--fresh',
  stale: 'so-freshness--stale',
  missing: 'so-freshness--missing',
  deterministic: 'so-freshness--deterministic',
};

export default function ScoringOverviewPage() {
  const rankQuery = useQuery({
    queryKey: ['scoring-overview-ranked'],
    queryFn: () => fetchRankedSymbols(undefined, 50),
    refetchInterval: 30_000,
  });

  const data = rankQuery.data ?? {};
  const ranked = Array.isArray(data.ranked) ? data.ranked : [];
  const mode = data.mode ?? '...';
  const services = data.services ?? {};
  const strategy = data.strategy ?? {};
  const degradation = data.degradation ?? { isDegraded: false, warning: null, overallCoverage: 1, failedProviders: [], degradedProviders: [] };

  // ---- Loading state ----
  if (rankQuery.isLoading) {
    return (
      <div className="so-page">
        <header className="so-page-header">
          <h2>Scoring Overview</h2>
        </header>
        <LoadingSkeleton variant="card" count={4} />
        <LoadingSkeleton variant="chart" count={8} className="ls-spacer-top" />
        <LoadingSkeleton variant="table" rows={5} cols={4} className="ls-spacer-top" />
      </div>
    );
  }

  // ---- Error state ----
  if (rankQuery.isError) {
    return (
      <div className="so-page">
        <header className="so-page-header">
          <h2>Scoring Overview</h2>
        </header>
        <div className="so-error-card">
          <p className="so-error-msg">Could not reach the scoring pipeline.</p>
          <p className="so-error-hint">Check that the NestJS backend is running on localhost:3201.</p>
          <button type="button" className="so-retry-btn" onClick={() => rankQuery.refetch()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  // ---- Compute stats ----
  const totalScored = ranked.length;
  const scores = ranked.map(r => r.score ?? 0);
  const avgScore = totalScored > 0
    ? scores.reduce((a, b) => a + b, 0) / totalScored
    : 0;
  const avgNormScore = totalScored > 0
    ? ranked.reduce((a, r) => a + (r.normalizedScore ?? 0), 0) / totalScored
    : 0;
  const avgConfidence = totalScored > 0
    ? ranked.reduce((a, r) => a + (r.confidence ?? 0), 0) / totalScored
    : 0;

  // Freshness counts
  const freshnessBins = { fresh: 0, stale: 0, missing: 0, deterministic: 0 };
  for (const r of ranked) {
    const key = r.freshness ?? 'missing';
    if (freshnessBins[key] !== undefined) freshnessBins[key]++;
  }

  // Score distribution — use normalized scores (% of max)
  const normScores = ranked.map(r => r.normalizedScore ?? 0);
  const bucketCounts = SCORE_BUCKETS.map(b => ({
    ...b,
    count: normScores.filter(s => inBucket(b, s)).length,
  }));
  const maxBucket = Math.max(1, ...bucketCounts.map(b => b.count));

  // Signal distribution
  const signalBins = {};
  for (const r of ranked) {
    const s = r.signal ?? 'unknown';
    signalBins[s] = (signalBins[s] ?? 0) + 1;
  }

  // Top 5
  const top5 = ranked.slice(0, 5);

  const { prefs, set } = usePreferences();
  const { stale, checking, lastRefresh, refresh } = useDataFreshness({
    symbols: ranked.slice(0, 20).map(r => r.symbol || r.ticker).filter(Boolean),
    enabled: ranked.length > 0,
  });

  return (
    <div className="so-page">
      <header className="so-page-header">
        <div>
          <h1>All Directives</h1>
          <p className="so-subtitle">
            Default protocol: <strong>Conviction Dip Accumulation</strong> — runs every registered directive
            {services.database === false && <span className="so-chip-warn">DB offline</span>}
            {services.queue === false && <span className="so-chip-warn">Queue offline</span>}
          </p>
        </div>
        <select
          className="so-table-style-picker"
          value={prefs.tableStyle || 'default'}
          onChange={e => set('tableStyle', e.target.value)}
          title="Table style for A/B testing"
        >
          {TABLE_STYLES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        {stale && (
          <button className="so-freshness-btn" onClick={refresh} title="Data may be stale — click to refresh prices">
            {checking ? '⟳ Refreshing…' : '⟳ Refresh Prices'}
          </button>
        )}
        {lastRefresh && !stale && (
          <span className="so-freshness-ok" title={`Prices refreshed at ${new Date(lastRefresh).toLocaleTimeString()}`}>✓ Fresh</span>
        )}
      </header>

      {/* ── Degradation Warning Banner ── */}
      {degradation.isDegraded && (
        <div className="so-degradation-banner">
          <span className="so-degradation-icon">⚠️</span>
          <div className="so-degradation-body">
            <strong>Scoring Integrity Degraded</strong>
            <p>{degradation.warning || 'Some providers are unavailable. Scores may be unreliable.'}</p>
            {degradation.failedProviders.length > 0 && (
              <p className="so-degradation-detail">Failed: {degradation.failedProviders.join(', ')}</p>
            )}
            {degradation.degradedProviders.length > 0 && (
              <p className="so-degradation-detail">Degraded: {degradation.degradedProviders.join(', ')}</p>
            )}
            <p className="so-degradation-coverage">Coverage: {(degradation.overallCoverage * 100).toFixed(0)}%</p>
          </div>
        </div>
      )}

      {/* ---- Summary cards ---- */}
      <div className="so-summary-grid">
        <div className="so-summary-card">
          <p className="so-card-label">Symbols Scored</p>
          <span className="so-card-value">{totalScored}</span>
          <p className="so-card-note">{totalScored === 0 ? 'No active symbols' : `out of ${totalScored} active`}</p>
        </div>
        <div className="so-summary-card">
          <p className="so-card-label">Avg Raw Score</p>
          <span className="so-card-value">{avgScore.toFixed(1)}</span>
          <p className="so-card-note">Unbounded sum of directive scores</p>
        </div>
        <div className="so-summary-card">
          <p className="so-card-label">Avg % of Max</p>
          <span className="so-card-value">{avgNormScore.toFixed(0)}%</span>
          <p className="so-card-note">Protocol max: {strategy.maxPossibleScore ?? '—'}</p>
        </div>
        <div className="so-summary-card">
          <p className="so-card-label">Pipeline Mode</p>
          <span className={`so-card-value so-mode-${mode}`}>{mode}</span>
          <p className="so-card-note">{mode === 'full' ? 'All services available' : 'Running with fallbacks'}</p>
        </div>
      </div>

      {/* ---- Two-column section ---- */}
      <div className="so-two-col">
        {/* ---- Score distribution ---- */}
        <section className="so-panel">
          <h2>Score Distribution</h2>
          {totalScored === 0 ? (
            <p className="so-empty">No scores to distribute yet. Add symbols and seed market data.</p>
          ) : (
            <div className="so-distro">
              {bucketCounts.map(b => (
                <div key={b.label} className="so-distro-row">
                  <span className="so-distro-label">{b.label}</span>
                  <div className="so-distro-track">
                    <div
                      className={`so-distro-bar ${b.css}`}
                      style={{ width: `${(b.count / maxBucket) * 100}%` }}
                    />
                  </div>
                  <span className="so-distro-count">{b.count}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ---- Freshness breakdown ---- */}
        <section className="so-panel">
          <h2>Freshness Breakdown</h2>
          {totalScored === 0 ? (
            <p className="so-empty">No data to report.</p>
          ) : (
            <div className="so-freshness-grid">
              {Object.entries(freshnessBins).map(([key, count]) => (
                <div key={key} className={`so-freshness-card ${FRESHNESS_COLORS[key] ?? ''}`}>
                  <span className="so-freshness-count">{count}</span>
                  <span className="so-freshness-label">{key}</span>
                </div>
              ))}
            </div>
          )}

          {/* Signal distribution */}
          {Object.keys(signalBins).length > 0 && (
            <div className="so-signal-section">
              <h3>Signal Breakdown</h3>
              <div className="so-signal-chips">
                {Object.entries(signalBins).map(([sig, count]) => (
                  <span key={sig} className={`so-signal-chip so-signal--${sig}`}>
                    {sig}: {count}
                  </span>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>

      {/* ---- Protocol card ---- */}
      <section className="so-panel so-strategy-panel">
        <h2>Active Protocol</h2>
        <div className="so-strategy-detail">
          <div className="so-strategy-row">
            <span className="so-strategy-key">Name</span>
            <span className="so-strategy-val">{strategy.name || 'Not configured'}</span>
          </div>
          <div className="so-strategy-row">
            <span className="so-strategy-key">Max Possible Score</span>
            <span className="so-strategy-val so-max-score">{strategy.maxPossibleScore ?? '—'}</span>
          </div>
          <div className="so-strategy-row">
            <span className="so-strategy-key">Directives</span>
            <span className="so-strategy-val">{strategy.directiveCount ?? '—'} registered (sum of maxScores = protocol max)</span>
          </div>
          <div className="so-strategy-row">
            <span className="so-strategy-key">Entry Threshold</span>
            <span className="so-strategy-val">{strategy.entryThreshold ?? '—'}% of max possible</span>
          </div>
          <div className="so-strategy-row">
            <span className="so-strategy-key">Watch Threshold</span>
            <span className="so-strategy-val">{strategy.watchThreshold ?? '—'}% of max possible</span>
          </div>
          <div className="so-strategy-row">
            <span className="so-strategy-key">Scoring Model</span>
            <span className="so-strategy-val">Sum of directive scores ÷ protocol max. Each directive's maxScore determines its natural influence.</span>
          </div>
        </div>
      </section>

      {/* ---- Top symbols ---- */}
      <section className="so-panel">
        <h2>Top Ranked Symbols</h2>
        {top5.length === 0 ? (
          <div className="so-empty-state">
            <p>No symbols ranked yet.</p>
            <p className="so-empty-hint">
              Symbols need price data before scoring can produce rankings.
              {mode !== 'full' && ' Start the NestJS backend and seed market data.'}
            </p>
          </div>
        ) : (
          <div className={`so-table-wrap so-table--${prefs.tableStyle || 'default'}`}>
            <table className="so-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Ticker</th>
                  <th>Score</th>
                  <th title="Percentage of protocol max possible score">% Max</th>
                  <th>Signal</th>
                  <th>Coverage</th>
                  <th>Freshness</th>
                </tr>
              </thead>
              <tbody>
                {top5.map((item, i) => (
                  <tr key={item.symbolId} className={item.degraded ? 'so-row-degraded' : ''}>
                    <td className="so-num">{i + 1}</td>
                    <td><strong>{item.ticker}</strong>{item.degraded && <span className="so-degrade-dot" title={`${item.activeDirectives}/${item.totalDirectives} directives active`}>⚠</span>}</td>
                    <td className="so-num">{(item.score ?? 0).toFixed(1)}</td>
                    <td className="so-num">{((item.normalizedScore ?? 0)).toFixed(0)}%</td>
                    <td><span className={`so-signal-chip so-signal--${item.signal ?? 'unknown'}`}>{item.signal ?? 'unknown'}</span></td>
                    <td className="so-num" style={{ color: item.coverage < 0.7 ? '#ef4444' : item.coverage < 1 ? '#f59e0b' : '#22c55e' }}>
                      {item.activeDirectives}/{item.totalDirectives} ({(item.coverage * 100).toFixed(0)}%)
                    </td>
                    <td><span className={`so-freshness-chip ${FRESHNESS_COLORS[item.freshness] ?? ''}`}>{item.freshness ?? 'unknown'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ---- Footer ---- */}
      <p className="so-footer">
        Auto-refresh every 30s · Last check: {new Date().toLocaleTimeString()}
        {' · '}
        <button type="button" className="so-refresh-link" onClick={() => rankQuery.refetch()}>
          Refresh now
        </button>
      </p>
    </div>
  );
}
