import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';

/**
 * DataFreshnessCard — sidebar card showing live status of all data sources.
 * Auto-refreshes every 30s. Compact enough for the left rail.
 */

const SOURCE_ICONS = {
  trading212: '📈',
  mt5: '🔌',
  'market-data': '📊',
  scoring: '🧠',
};

export default function DataFreshnessCard() {
  const { data, isLoading } = useQuery({
    queryKey: ['data-freshness'],
    queryFn: () => apiGet('/api/data/freshness'),
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const rlQuery = useQuery({
    queryKey: ['rate-limits-detail'],
    queryFn: () => apiGet('/api/providers/rate-limits/detail').catch(() => null),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  if (isLoading || !data) {
    return (
      <div className="df-card">
        <div className="df-title">Data Sources</div>
        <div className="df-loading">Checking…</div>
      </div>
    );
  }

  const { sources, summary } = data;
  const rl = rlQuery.data;
  const t212Endpoints = rl?.endpoints || [];
  const breakerTripped = rl?.circuitBreaker?.tripped;

  return (
    <div className="df-card">
      <div className="df-title">
        Data Sources
        <span className={`df-summary-dot ${summary.hasLiveData ? 'df-dot-live' : 'df-dot-none'}`} />
      </div>

      <div className="df-sources">
        {sources.map((src) => (
          <div key={src.id} className="df-source" title={src.detail || ''}>
            <span className={`df-dot ${src.connected ? 'df-dot-live' : 'df-dot-off'}`}>
              {src.connected ? '●' : '○'}
            </span>
            <span className="df-source-label">
              {SOURCE_ICONS[src.id] || '📡'} {src.label}
            </span>
            <span className="df-source-detail">{src.detail}</span>
          </div>
        ))}
      </div>

      {rl && (
        <div className="df-rl-section">
          <div className="df-rl-title">
            Rate Limits {breakerTripped ? '🔴 TRIPPED' : '🟢 OK'}
          </div>
          <div className="df-rl-endpoints">
            {t212Endpoints.slice(0, 4).map((ep) => (
              <div key={ep.endpoint} className="df-rl-ep">
                <span className={`df-rl-dot ${ep.ready ? 'df-dot-live' : 'df-dot-off'}`}>
                  {ep.ready ? '●' : '○'}
                </span>
                <span className="df-rl-ep-label">{ep.endpoint}</span>
                <span className="df-rl-ep-time">
                  {ep.ready ? 'ready' : `${(ep.readyInMs / 1000).toFixed(1)}s`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
