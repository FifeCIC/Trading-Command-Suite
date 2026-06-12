import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiGet, apiPost } from '../core/api/client';
import BacktestChartPane from '../components/backtest/BacktestChartPane';

export default function BacktestPage() {
  const [symbol, setSymbol] = useState('NVDA');
  const [days, setDays] = useState(365);
  const [runId, setRunId] = useState('');
  const [showChart, setShowChart] = useState(false);

  const runMutation = useMutation({
    mutationFn: () => apiPost('/api/backtest/run', { symbol, days, timeframe: '1d' }),
    onSuccess: (data) => {
      setRunId(data.id);
      setShowChart(true);
    },
  });

  const resultQuery = useQuery({
    queryKey: ['backtest-result', runId],
    queryFn: () => apiGet(`/api/backtest/results/${runId}`),
    enabled: Boolean(runId),
    refetchInterval: false,
  });

  const result = resultQuery.data;
  const stats = result?.stats;

  return (
    <div className="bt-page">
      <h1>Backtest Engine</h1>
      <p className="bt-sub">Run the Conviction Dip Accumulation strategy against historical data and measure entry signal outcomes.</p>

      <div className="bt-form">
        <label>
          Symbol
          <input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} placeholder="NVDA" />
        </label>
        <label>
          Days
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={90}>90</option>
            <option value={180}>180</option>
            <option value={365}>365 (1 year)</option>
            <option value={730}>730 (2 years)</option>
            <option value={1825}>1825 (5 years)</option>
          </select>
        </label>
        <button type="button" className="bt-run" disabled={runMutation.isPending} onClick={() => runMutation.mutate()}>
          {runMutation.isPending ? 'Running...' : 'Run Backtest'}
        </button>
      </div>

      {runMutation.isError && <p className="bt-error">{(runMutation.error && runMutation.error.message) || 'Backtest failed'}</p>}

      {stats && (
        <div className="bt-results">
          <div className="bt-stats-grid">
            <div className="bt-stat"><div className="bt-stat-value">{stats.totalSignals}</div><div>Entry Signals</div></div>
            <div className="bt-stat"><div className="bt-stat-value">{(stats.winRate * 100).toFixed(0)}%</div><div>Win Rate (10d)</div></div>
            <div className="bt-stat"><div className="bt-stat-value">{stats.averageReturn10d}%</div><div>Avg Return (10d)</div></div>
            <div className="bt-stat"><div className="bt-stat-value">{stats.maxReturn10d}%</div><div>Max Return (10d)</div></div>
            <div className="bt-stat"><div className="bt-stat-value">{stats.maxDrawdown10d}%</div><div>Max Drawdown (10d)</div></div>
            <div className="bt-stat"><div className="bt-stat-value">{stats.profitFactor}</div><div>Profit Factor</div></div>
            <div className="bt-stat"><div className="bt-stat-value">{stats.sharpeApproximation}</div><div>Sharpe (approx)</div></div>
          </div>

          {result?.period && <p className="bt-period">Period: {result.period}</p>}

          {/* Chart visualization */}
          {showChart && (
            <div className="bt-chart-section">
              <h3>Price Chart &amp; Signals</h3>
              <BacktestChartPane initialSymbol={symbol} />
            </div>
          )}

          {result?.entrySignals?.length > 0 && (
            <table className="bt-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Score</th>
                  <th>5d Return</th>
                  <th>10d Return</th>
                  <th>20d Return</th>
                </tr>
              </thead>
              <tbody>
                {result.entrySignals.slice(-50).reverse().map((s, i) => (
                  <tr key={i} className={s.wasProfitable ? 'bt-row-win' : 'bt-row-loss'}>
                    <td>{s.date}</td>
                    <td>{s.score}</td>
                    <td className={s.return5d > 0 ? 'bt-green' : 'bt-red'}>{s.return5d != null ? `${s.return5d}%` : '—'}</td>
                    <td className={s.return10d > 0 ? 'bt-green' : 'bt-red'}>{s.return10d != null ? `${s.return10d}%` : '—'}</td>
                    <td className={s.return20d > 0 ? 'bt-green' : 'bt-red'}>{s.return20d != null ? `${s.return20d}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
