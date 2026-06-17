import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';

export default function AutomationDashboardPage() {
  const healthQuery = useQuery({
    queryKey: ['health'],
    queryFn: () => apiGet('/api/version').catch(() => null),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const scoringSummary = useQuery({
    queryKey: ['scoring-summary'],
    queryFn: () => apiGet('/api/scoring/summary').catch(() => null),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const apiOnline = Boolean(healthQuery.data?.version);
  const dbOnline = healthQuery.data?.services?.databaseConnected;
  const uptime = healthQuery.data?.uptime;

  return (
    <div className="pf-page">
      <div className="pf-header">
        <h1>Automation Dashboard</h1>
      </div>

      {/* ── System Status Cards ─────────────────────────────── */}
      <div className="pf-summary">
        <div className="pf-sum-card">
          <div className={`pf-sum-val ${apiOnline ? 'pf-green' : 'pf-red'}`}>
            {apiOnline ? 'Online' : 'Offline'}
          </div>
          <div>API Server</div>
        </div>
        <div className="pf-sum-card">
          <div className={`pf-sum-val ${dbOnline ? 'pf-green' : 'pf-red'}`}>
            {dbOnline ? 'Connected' : 'Offline'}
          </div>
          <div>Database</div>
        </div>
        <div className="pf-sum-card">
          <div className="pf-sum-val">
            {scoringSummary.data?.totalScores ?? '—'}
          </div>
          <div>Total Scores</div>
        </div>
        <div className="pf-sum-card">
          <div className="pf-sum-val">
            {uptime ? `${Math.floor(uptime / 60)}m` : '—'}
          </div>
          <div>Uptime</div>
        </div>
        <div className="pf-sum-card">
          <div className="pf-sum-val">
            {scoringSummary.data?.activeSymbols ?? '—'}
          </div>
          <div>Active Symbols</div>
        </div>
      </div>

      {/* ── Background Processes ────────────────────────────── */}
      <div className="pf-section">
        <h2>Background Processes</h2>
        <table className="pf-table">
          <thead>
            <tr><th>Process</th><th>Status</th><th>Detail</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>SEES Scoring Scheduler</strong></td>
              <td>{apiOnline ? <span className="pf-green">Active</span> : <span className="pf-red">Offline</span>}</td>
              <td className="pf-hint">Runs every 5 minutes when API is online</td>
            </tr>
            <tr>
              <td><strong>MT5 Bridge</strong></td>
              <td><span className="pf-hint">Check MT5 Status page</span></td>
              <td className="pf-hint">Python bridge to MetaTrader 5 terminal</td>
            </tr>
            <tr>
              <td><strong>Data Import Jobs</strong></td>
              <td><span className="pf-hint">Check Import Jobs page</span></td>
              <td className="pf-hint">Scheduled provider data imports</td>
            </tr>
            <tr>
              <td><strong>Analytics Queue</strong></td>
              <td>{apiOnline ? <span className="pf-green">Active</span> : <span className="pf-red">Offline</span>}</td>
              <td className="pf-hint">Local event queue, forwarded when endpoint configured</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* ── Recent Activity ─────────────────────────────────── */}
      <div className="pf-section">
        <h2>What's Running</h2>
        <p className="pf-hint">
          The Automation area surfaces background processes that keep the trading pipeline running.
          Check individual pages for detailed status:
        </p>
        <ul style={{ color: 'var(--ink-soft)', fontSize: '0.88rem', paddingLeft: '1.25rem', lineHeight: 1.6 }}>
          <li><strong>Scoring Runs</strong> — SEES scoring pipeline history and live runs</li>
          <li><strong>Execution Queue</strong> — Pending and completed order queue from MT5</li>
          <li><strong>Import Jobs</strong> — Data import status from connected providers</li>
          <li><strong>MT5 Status</strong> — Bridge connection health and diagnostics</li>
          <li><strong>Alert Center</strong> — Price alerts, API health, scoring alerts</li>
        </ul>
      </div>
    </div>
  );
}
