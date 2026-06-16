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
import './scoring-overview.css';

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
  const avgConfidence = totalScored > 0
    ? ranked.reduce((a, r) => a + (r.confidence ?? 0), 0) / totalScored
    : 0;

  // Freshness counts
  const freshnessBins = { fresh: 0, stale: 0, missing: 0, deterministic: 0 };
  for (const r of ranked) {
    const key = r.freshness ?? 'missing';
    if (freshnessBins[key] !== undefined) freshnessBins[key]++;
  }

  // Score distribution
  const bucketCounts = SCORE_BUCKETS.map(b => ({
    ...b,
    count: scores.filter(s => inBucket(b, s)).length,
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

  return (
    <div className="so-page">
      <header className="so-page-header">
        <h1>Scoring Overview</h1>
        <p className="so-subtitle">
          Pipeline mode: <strong>{mode}</strong>
          {services.database === false && <span className="so-chip-warn">DB offline</span>}
          {services.queue === false && <span className="so-chip-warn">Queue offline</span>}
        </p>
      </header>

      {/* ---- Summary cards ---- */}
      <div className="so-summary-grid">
        <div className="so-summary-card">
          <p className="so-card-label">Symbols Scored</p>
          <span className="so-card-value">{totalScored}</span>
          <p className="so-card-note">{totalScored === 0 ? 'No active symbols' : `out of ${totalScored} active`}</p>
        </div>
        <div className="so-summary-card">
          <p className="so-card-label">Average Score</p>
          <span className="so-card-value">{avgScore.toFixed(1)}</span>
          <p className="so-card-note">Entry threshold: {strategy.entryThreshold ?? 60}</p>
        </div>
        <div className="so-summary-card">
          <p className="so-card-label">Avg Confidence</p>
          <span className="so-card-value">{(avgConfidence * 100).toFixed(0)}%</span>
          <p className="so-card-note">Watch threshold: {strategy.watchThreshold ?? 40}</p>
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

      {/* ---- Strategy card ---- */}
      <section className="so-panel so-strategy-panel">
        <h2>Active Strategy</h2>
        <div className="so-strategy-detail">
          <div className="so-strategy-row">
            <span className="so-strategy-key">Name</span>
            <span className="so-strategy-val">{strategy.name || 'Not configured'}</span>
          </div>
          <div className="so-strategy-row">
            <span className="so-strategy-key">Entry Threshold</span>
            <span className="so-strategy-val">{strategy.entryThreshold ?? '—'}</span>
          </div>
          <div className="so-strategy-row">
            <span className="so-strategy-key">Watch Threshold</span>
            <span className="so-strategy-val">{strategy.watchThreshold ?? '—'}</span>
          </div>
          <div className="so-strategy-row">
            <span className="so-strategy-key">Aggregation</span>
            <span className="so-strategy-val">Weighted average (Conviction Dip Accumulation)</span>
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
          <div className="so-table-wrap">
            <table className="so-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Ticker</th>
                  <th>Score</th>
                  <th>Confidence</th>
                  <th>Signal</th>
                  <th>Freshness</th>
                </tr>
              </thead>
              <tbody>
                {top5.map((item, i) => (
                  <tr key={item.symbolId}>
                    <td className="so-num">{i + 1}</td>
                    <td><strong>{item.ticker}</strong></td>
                    <td className="so-num">{(item.score ?? 0).toFixed(1)}</td>
                    <td className="so-num">{((item.confidence ?? 0) * 100).toFixed(0)}%</td>
                    <td><span className={`so-signal-chip so-signal--${item.signal ?? 'unknown'}`}>{item.signal ?? 'unknown'}</span></td>
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
