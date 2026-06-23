import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';

const SOURCES_MAP = {
  trading212:  { icon: '📈', label: 'Trading212' },
  mt5:         { icon: '🔌', label: 'MT5 Bridge' },
  'market-data': { icon: '📊', label: 'Market Data' },
  scoring:     { icon: '🧠', label: 'Scoring' },
};

export default function DataFreshnessCard() {
  const { data, isLoading } = useQuery({
    queryKey: ['data-freshness'],
    queryFn: () => apiGet('/api/data/freshness'),
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  if (isLoading || !data) {
    return (
      <div className="dfs">
        <div className="dfs-head">
          <span className="dfs-head-icon">📡</span>
          <span className="dfs-head-title">Data Sources</span>
        </div>
        <div className="dfs-body"><span className="dfs-loading">Checking…</span></div>
      </div>
    );
  }

  const { sources } = data;
  const liveCount = sources.filter((s) => s.connected).length;
  const allLive = liveCount === sources.length;

  return (
    <div className="dfs">
      <div className="dfs-head">
        <span className="dfs-head-icon">📡</span>
        <span className="dfs-head-title">Data Sources</span>
        <span className={`dfs-badge ${allLive ? 'dfs-badge--ok' : liveCount > 0 ? 'dfs-badge--warn' : 'dfs-badge--err'}`}>
          {liveCount}/{sources.length}
        </span>
      </div>
      <div className="dfs-body">
        {sources.map((src) => {
          const m = SOURCES_MAP[src.id] || { icon: '📡', label: src.label };
          return (
            <div key={src.id} className="dfs-row" title={src.detail || ''}>
              <span className={`dfs-dot ${src.connected ? 'on' : 'off'}`} />
              <span className="dfs-row-icon">{m.icon}</span>
              <span className="dfs-row-label">{m.label}</span>
              <span className="dfs-row-detail">{src.connected ? src.detail || '' : 'offline'}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
