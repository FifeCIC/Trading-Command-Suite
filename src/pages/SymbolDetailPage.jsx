import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import './symbol-detail.css';

export default function SymbolDetailPage() {
  const { symbolId } = useParams();

  const symbolQuery = useQuery({
    queryKey: ['symbol', symbolId],
    queryFn: () => apiGet(`/api/symbols/${symbolId}`),
    enabled: Boolean(symbolId),
  });

  const freshnessQuery = useQuery({
    queryKey: ['freshness', symbolId],
    queryFn: () => apiGet(`/api/market-data/freshness/${symbolId}`),
    enabled: Boolean(symbolId),
  });

  const scoringQuery = useQuery({
    queryKey: ['scoring-history', symbolId],
    queryFn: () => apiGet(`/api/scoring/history/${symbolId}`),
    enabled: Boolean(symbolId),
    retry: 1,
  });

  if (symbolQuery.isLoading) return <div className="sd-page"><p>Loading symbol data...</p></div>;
  if (symbolQuery.isError) return <div className="sd-page"><p className="sd-error">Failed to load symbol. Is the backend running?</p></div>;

  const sym = symbolQuery.data ?? {};
  const freshness = freshnessQuery.data ?? {};
  const scoring = scoringQuery.data ?? {};
  const history = Array.isArray(scoring.history) ? scoring.history : [];
  const breakdown = Array.isArray(scoring.breakdown) ? scoring.breakdown : [];
  const currentScore = scoring.totalScore ?? scoring.score ?? null;

  const freshnessStatus = freshness.status || freshness.freshness || 'unknown';
  const freshnessTone = freshnessStatus === 'fresh' ? 'ok' : freshnessStatus === 'stale' ? 'warn' : 'neutral';

  return (
    <div className="sd-page">
      <Link to="/research/symbols-browser" className="sd-back">← Back to Symbols</Link>

      <header className="sd-header">
        <div>
          <h1>{sym.ticker || symbolId}</h1>
          <p>{sym.name || '—'}</p>
        </div>
        <div className="sd-badges">
          <span className={`sd-chip sd-chip--${freshnessTone}`}>{freshnessStatus}</span>
          <span className="sd-chip sd-chip--neutral">{sym.exchange || '—'}</span>
          <span className="sd-chip sd-chip--neutral">{sym.type || '—'}</span>
          <span className={`sd-chip ${sym.active ? 'sd-chip--ok' : 'sd-chip--warn'}`}>{sym.active ? 'Active' : 'Inactive'}</span>
        </div>
      </header>

      <div className="sd-grid">
        {/* Freshness Card */}
        <section className="sd-card">
          <h2>Freshness</h2>
          {freshnessQuery.isLoading ? <p>Loading...</p> : freshnessQuery.isError ? <p className="sd-error">Unavailable</p> : (
            <>
              <div className="sd-stat">{freshnessStatus}</div>
              <p className="sd-sub">Last bar: {freshness.lastBarTimestamp ? new Date(freshness.lastBarTimestamp).toLocaleString() : 'none'}</p>
              <p className="sd-sub">Stale after: {freshness.staleThresholdMinutes ?? '—'} min</p>
            </>
          )}
        </section>

        {/* Score Card */}
        <section className="sd-card">
          <h2>Current Score</h2>
          {scoringQuery.isLoading ? <p>Loading...</p> : scoringQuery.isError ? <p className="sd-error">Scoring unavailable</p> : currentScore != null ? (
            <>
              <div className="sd-stat">{currentScore.toFixed(1)}</div>
              <p className="sd-sub">Confidence: {((scoring.confidence ?? 0) * 100).toFixed(0)}%</p>
              <p className="sd-sub">Signal: <span className={`sd-chip sd-chip--${scoring.signal === 'entry' ? 'ok' : scoring.signal === 'watch' ? 'warn' : 'neutral'}`}>{scoring.signal || '—'}</span></p>
            </>
          ) : (
            <p className="sd-sub">No scoring data yet. Run scoring from the SEES page.</p>
          )}
        </section>

        {/* Recent Scores */}
        <section className="sd-card sd-card--wide">
          <h2>Recent Scores</h2>
          {history.length === 0 ? (
            <p className="sd-sub">No score history available.</p>
          ) : (
            <div className="sd-bars">
              {history.slice(-20).map((h, i) => (
                <div key={i} className="sd-bar-wrap" title={`${h.score?.toFixed(1) ?? '—'} at ${h.timestamp ? new Date(h.timestamp).toLocaleDateString() : '—'}`}>
                  <div className="sd-bar" style={{ height: `${Math.max(2, (h.score ?? 0))}%` }} />
                  <span className="sd-bar-label">{i + 1}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Directive Breakdown */}
      {breakdown.length > 0 && (
        <section className="sd-card">
          <h2>Directive Breakdown</h2>
          <table className="sd-table">
            <thead>
              <tr>
                <th>Directive</th>
                <th>Score</th>
                <th>Weight</th>
                <th>Contribution</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {breakdown.map((d) => (
                <tr key={d.directiveId}>
                  <td>{d.name || d.directiveId}</td>
                  <td>{d.score?.toFixed(1) ?? '—'}</td>
                  <td>{d.weight ?? '—'}</td>
                  <td>{d.contribution?.toFixed(1) ?? '—'}</td>
                  <td className="sd-reason">{d.reason || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
