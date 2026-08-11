/**
 * SettingsDatabasePage — database table sizes, backup strategy, and config export.
 *
 * Route: /settings/settings-database
 * API:   GET /api/system/config/stats, POST /api/system/config/export
 */

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiGet, apiPost } from '../core/api/client';
import './settings-database.css';

/** Table purpose descriptions — shown on hover */
const TABLE_PURPOSES = {
  score:               'Every scoring event. Append-only log. strategyId=protocolId for protocol scores, strategy UUID for strategy scores. Used by runs API, directive impact, research.',
  score_snapshot:      'Latest protocol-gated score per protocol+symbol. Used for rarity percentile computation (current score vs 1-year history). NOT filtered by Scoring Strategy gates.',
  strategy:            'Legacy strategy definitions from WordPress era. Being migrated to TradingStrategy + ScoringStrategy.',
  trading_strategy:    'Trading strategy configs: symbol, broker, SL/TP, position sizing. Linked to ScoringStrategy via scoringStrategyId FK.',
  scoring_strategy:    'Scoring strategy configs: protocol, watchlist, thresholds, gates. Links protocol definitions to trading rules.',
  protocol:            'Protocol definitions with metadata (tradingStyle, directionMode, timeframes). Linked to directive groups.',
  protocol_directive_group: 'Directive groups within a protocol (technical, sentiment, risk). Each group has a weight and directive list.',
  protocol_directive_entry: 'Individual directives within a protocol group. Links directive IDs to groups.',
  directive:           'Registered directive metadata (name, readiness tier, directionBias). The directive implementations are in code, this is the registry.',
  directiveoutcome:    'Per-directive results from each scoring run. One row per directive per symbol per tick. Used for audit and performance analysis.',
  marketbar:           'OHLCV market data bars per symbol+timeframe. Imported from MT5 bridge and external providers.',
  position:            'Current open positions across all brokers. Synced from MT5/T212 on each tick.',
  trade:               'Closed trade records with P&L, duration, entry/exit prices. Used for performance analytics.',
  order:               'Order history: placed, filled, cancelled. Links to Trade table on fill.',
  signal:              'Trading signals generated from scores. BUY/SELL/HOLD per symbol per tick.',
  watchlist:           'Named groups of symbols for batch scoring and strategy assignment.',
  symbol:              'Tradable symbol registry. Ticker, exchange, asset type. Looked up by ticker for scoring.',
  alert:               'System alerts: MT5 health, provider degradation, data staleness, P&L thresholds.',
  automation_config:   'Per-broker automation settings: enabled, intervals, trade thresholds.',
  decision_trail:      'Audit trail of every automation decision: scored, skipped, executed, failed. Links to ScoreSnapshot for traceability.',
  backtest_run:        'Historical backtest results with entry signals, equity curves, and performance stats.',
  earnings_event:      'Upcoming and historical earnings dates. Used for earnings gate in risk assessment.',
};

function tablePurpose(tableName) {
  return TABLE_PURPOSES[tableName] || '';
}

export default function SettingsDatabasePage() {
  const [exportResult, setExportResult] = useState(null);

  const statsQuery = useQuery({
    queryKey: ['db-stats'],
    queryFn: () => apiGet('/api/system/config/stats'),
    staleTime: 30_000,
  });

  const exportMutation = useMutation({
    mutationFn: () => apiPost('/api/system/config/export'),
    onSuccess: (data) => setExportResult(data),
  });

  const stats = statsQuery.data ?? [];
  const configTables = stats.filter((s) => s.isConfig);
  const dataTables = stats.filter((s) => !s.isConfig);
  const totalConfigRows = configTables.reduce((sum, s) => sum + (s.rows > 0 ? s.rows : 0), 0);
  const totalDataRows = dataTables.reduce((sum, s) => sum + (s.rows > 0 ? s.rows : 0), 0);

  return (
    <div className="pf-page">
      <header className="pf-header">
        <h1>Database Settings</h1>
        <p className="pf-hint">Table sizes, backup strategy, and config export.</p>
      </header>

      {/* ── Backup Strategy ── */}
      <section className="pf-section">
        <h2>Backup Strategy</h2>
        <div className="pf-account-detail sdb-section">
          <p>
            Only <strong>user-created configuration</strong> is backed up — strategies, protocols, watchlists,
            app settings, automation rules, and symbol registry. These are exported as JSON seed files
            that double as installation defaults for new deployments.
          </p>
          <ul className="sdb-list">
            <li><strong>Backed up</strong>: Strategies, directives, protocols, watchlists, app settings, user preferences, automation config, symbols</li>
            <li><strong>Not backed up</strong>: Scores, market bars, signals, news, earnings — all rebuildable from provider data</li>
            <li>Export destination: <code>nest/src/data/seed/</code></li>
          </ul>
        </div>
      </section>

      {/* ── Export Action ── */}
      <section className="pf-section">
        <h2>Config Export</h2>
        <div className="sdb-actions">
          <button
            className="btn btn-primary sdb-export-btn"
            onClick={() => exportMutation.mutate()}
            disabled={exportMutation.isPending}
          >
            {exportMutation.isPending ? '⏳ Exporting…' : '📦 Export Config Tables'}
          </button>
          <span className="pf-hint sdb-hint">
            {configTables.length > 0
              ? `${totalConfigRows.toLocaleString()} rows across ${configTables.length} tables`
              : 'Loading…'}
          </span>
        </div>

        {exportResult && (
          <div className={`pf-account-detail ${exportResult.error ? 'sdb-result-err' : 'sdb-result-ok'}`}>
            {exportResult.error ? (
              <p>Export failed: {exportResult.error}</p>
            ) : (
              <>
                <p>
                  ✅ Exported {(exportResult.totalBytes / 1024).toFixed(1)}KB across {exportResult.files?.length || 0} files
                </p>
                <div className="sdb-result-meta">
                  {exportResult.files?.filter(f => f.count > 0).map(f => (
                    <div key={f.file}>{f.file}: {f.count} rows ({(f.bytes / 1024).toFixed(1)}KB)</div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </section>

      {/* ── Config Tables ── */}
      <section className="pf-section">
        <h2>Config Tables (Backed Up)</h2>
        <table className="pf-table">
          <thead>
            <tr>
              <th>Table</th>
              <th>Label</th>
              <th className="sdb-right">Rows</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {configTables.map((s) => (
              <tr key={s.table} title={tablePurpose(s.table)} className="sdb-hoverable">
                <td className="sdb-mono">{s.table}</td>
                <td>{s.label}</td>
                <td className="sdb-right">
                  {s.rows < 0 ? '—' : s.rows.toLocaleString()}
                </td>
                <td>
                  <span className={`pf-sig ${s.rows > 0 ? 'pf-sig-buy' : 'pf-sig-no_data'}`}>
                    {s.rows < 0 ? 'N/A' : s.rows > 0 ? '✓ Data' : 'Empty'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="pf-hint sdb-hint">
          Total: {totalConfigRows.toLocaleString()} configuration rows — exported as JSON seed files.
        </p>
      </section>

      {/* ── Data Tables ── */}
      <section className="pf-section">
        <h2>Data Tables (Not Backed Up)</h2>
        <table className="pf-table">
          <thead>
            <tr>
              <th>Table</th>
              <th>Label</th>
              <th className="sdb-right">Rows</th>
              <th>Rebuildable From</th>
            </tr>
          </thead>
          <tbody>
            {dataTables.map((s) => (
              <tr key={s.table} title={tablePurpose(s.table)} className="sdb-hoverable">
                <td className="sdb-mono">{s.table}</td>
                <td>{s.label}</td>
                <td className="sdb-right">
                  {s.rows < 0 ? '—' : s.rows.toLocaleString()}
                </td>
                <td className="sdb-muted">Provider APIs</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="pf-hint sdb-hint">
          Total: {totalDataRows.toLocaleString()} data rows — not backed up, rebuildable from providers.
        </p>
      </section>

      {/* ── Retention ── */}
      <section className="pf-section">
        <h2>Data Retention</h2>
        <div className="pf-account-detail sdb-section">
          <p>
            The <strong>Data Retention Service</strong> runs daily at 3 AM and prunes old rows from these tables
            based on configured retention periods:
          </p>
          <ul className="sdb-list">
            <li>Score snapshots — 90 days</li>
            <li>Market bars — 60 days</li>
            <li>Strategy evaluations — 90 days</li>
            <li>Automation events — 60 days</li>
            <li>Portfolio snapshots — 365 days</li>
            <li>Orders — 365 days</li>
          </ul>
          <p className="sdb-result-meta">
            Retention periods are configurable via environment variables (DATA_RETENTION_*_DAYS).
            Manual prune: <code>POST /api/system/data-retention/prune?table=score&amp;days=30</code>
          </p>
        </div>
      </section>
    </div>
  );
}
