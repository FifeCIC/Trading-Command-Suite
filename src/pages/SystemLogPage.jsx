import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';

const LEVEL_TONES = { info: 'neutral', warn: 'warn', error: 'error' };

export default function SystemLogPage() {
  const logQuery = useQuery({
    queryKey: ['system-logs'],
    queryFn: () => apiGet('/api/system/logs?limit=50'),
    refetchInterval: 15_000,
  });

  const logs = Array.isArray(logQuery.data?.logs) ? logQuery.data.logs : [];

  return (
    <div className="system-log-page">
      <h1>System Log</h1>
      <p className="sl-sub">Recent errors and events from directives, providers, and imports. Auto-refreshes every 15s.</p>

      {logQuery.isLoading && <p>Loading logs...</p>}
      {logQuery.isError && <p className="sl-error">Failed to load logs. Is the backend running?</p>}

      {!logQuery.isLoading && logs.length === 0 && (
        <p className="sl-empty">No log entries yet. Events will appear as directives run and providers are checked.</p>
      )}

      {logs.length > 0 && (
        <table className="sl-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Source</th>
              <th>Level</th>
              <th>Message</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((entry, i) => (
              <tr key={i} className={`sl-row sl-row--${entry.level}`}>
                <td className="sl-time">{new Date(entry.timestamp).toLocaleTimeString()}</td>
                <td>{entry.source}</td>
                <td><span className={`sl-chip sl-chip--${LEVEL_TONES[entry.level] || 'neutral'}`}>{entry.level}</span></td>
                <td>{entry.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
