import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import ReplayPlayer from '../components/ReplayPlayer';
import { apiGet, apiPost } from '../core/api/client';
import NoticeBlock from '../components/NoticeBlock';
import { noticeFromError } from '../core/notices/from-error.js';
import BacktestChartPane from '../components/backtest/BacktestChartPane';
import EquityCurveChart from '../components/backtest/EquityCurveChart';

// ── Preset profiles (#50) ──
const EXECUTION_PRESETS = {
  forex: {
    label: '💱 Forex',
    slippage: 0.0001,
    spread: 0.0001,
    commission: 0,
    positionModel: 'fixedPercent',
    accountSize: 10000,
    riskPct: 2,
    assetClass: 'forex',
  },
  stocks: {
    label: '📈 US Stocks',
    slippage: 0.01,
    spread: 0.01,
    commission: 0,
    positionModel: 'fixedPercent',
    accountSize: 10000,
    riskPct: 2,
    assetClass: 'stock',
  },
  crypto: {
    label: '₿ Crypto',
    slippage: 0.002,
    spread: 0.001,
    commission: 0.1,
    positionModel: 'fixedPercent',
    accountSize: 10000,
    riskPct: 2,
    assetClass: 'crypto',
  },
};

export default function BacktestPage() {
  const [symbol, setSymbol] = useState('NVDA');
  const [days, setDays] = useState(30);
  const [runId, setRunId] = useState('');
  const [showChart, setShowChart] = useState(false);
  // ⚠️ R-BT — the engine needs a PROTOCOL for canonical META.Stack scoring, and this form had no
  // way to supply one. A symbol-only run came back `Backtest requires protocolId…` — and because the
  // API sent that as HTTP 201, the page showed NOTHING (owner: "Run Backtest does not work yet").
  // A bot carries protocol + symbol + levels, and "backtest this bot" is ONE call (#965 item 3), so
  // it is the default path here.
  const [botId, setBotId] = useState('');
  const [newsExclusion, setNewsExclusion] = useState('none');
  const [showExecution, setShowExecution] = useState(false);

  // Execution realism state (#50)
  const [slippage, setSlippage] = useState(0.01);
  const [spread, setSpread] = useState(0.01);
  const [commission, setCommission] = useState(0);
  const [positionModel, setPositionModel] = useState('fixedPercent');
  const [accountSize, setAccountSize] = useState(10000);
  const [riskPct, setRiskPct] = useState(2);
  const [kellyCapPct, setKellyCapPct] = useState(25);
  const [atrPeriod, setAtrPeriod] = useState(14);
  const [atrMultiplier, setAtrMultiplier] = useState(1.5);
  const [activePreset, setActivePreset] = useState('stocks');

  const applyPreset = (key) => {
    const p = EXECUTION_PRESETS[key];
    if (!p) return;
    setSlippage(p.slippage);
    setSpread(p.spread);
    setCommission(p.commission);
    setPositionModel(p.positionModel);
    setAccountSize(p.accountSize);
    setRiskPct(p.riskPct);
    setActivePreset(key);
  };

  const botsQuery = useQuery({
    queryKey: ['bt-bots'],
    queryFn: () => apiGet('/api/trading/strategies').catch(() => null),
  });
  const bots = useMemo(() => {
    const raw = botsQuery.data;
    if (!raw) return [];
    const list = Array.isArray(raw) ? raw : (raw.strategies ?? []);
    return Array.isArray(list) ? list.filter((b) => b && b.id) : [];
  }, [botsQuery.data]);
  // Default to a real bot so the button works on first click, rather than failing on a rule the
  // form never showed the user.
  useEffect(() => {
    if (!botId && bots.length > 0) setBotId(bots[0].id);
  }, [bots, botId]);

  const runMutation = useMutation({
    mutationFn: () => apiPost('/api/backtest/run', botId ? { botId, days } : {
      symbol,
      days,
      timeframe: '1d',
      newsExclusion,
      slippage,
      spread,
      commission,
      positionModel,
      accountSize,
      riskPct,
      kellyCapPct,
      atrPeriod,
      atrMultiplier,
    }),
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

  const equityQuery = useQuery({
    queryKey: ['backtest-equity', runId],
    queryFn: () => apiGet(`/api/backtest/equity/${runId}`),
    enabled: Boolean(runId),
    refetchInterval: false,
  });

  const result = resultQuery.data;
  const equityData = equityQuery.data;
  const stats = result?.stats;
  const execution = result?.execution;

  return (
    <div className="bt-page">
      <p className="bt-sub">Run the Conviction Dip Accumulation strategy against historical data and measure entry signal outcomes.</p>

      <div className="bt-form">
        <label>
          Bot
          <select value={botId} onChange={(e) => setBotId(e.target.value)}>
            <option value="">— none (ad-hoc symbol run) —</option>
            {bots.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}{b.symbol ? ` · ${b.symbol}` : ''}{b.protocolId ? ` · ${b.protocolId}` : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          Symbol
          <input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} placeholder="NVDA" />
        </label>
        <label>
          Days
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>7</option>
            <option value={14}>14</option>
            <option value={30}>30</option>
            <option value={60}>60</option>
            <option value={90}>90</option>
            <option value={180}>180</option>
            <option value={365}>365 (1 year)</option>
            <option value={730}>730 (2 years)</option>
            <option value={1825}>1825 (5 years)</option>
          </select>
        </label>
        <label>
          News
          <select value={newsExclusion} onChange={(e) => setNewsExclusion(e.target.value)} title="Filter out news-driven signals to isolate protocol performance">
            <option value="none">📰 Include (realistic)</option>
            <option value="exclude">🚫 Exclude (protocol purity)</option>
            <option value="only">📡 News-only (sensitivity)</option>
            <option value="reduce">📉 Reduce weight</option>
          </select>
        </label>
        <button type="button" className="bt-run" disabled={runMutation.isPending} onClick={() => runMutation.mutate()}>
          {runMutation.isPending ? 'Running...' : 'Run Backtest'}
        </button>
      </div>

      {/* ── Execution Realism Panel (#50) ── */}
      <div className="bt-execution-section">
        <button
          type="button"
          className={`bt-execution-toggle ${showExecution ? 'open' : ''}`}
          onClick={() => setShowExecution(!showExecution)}
        >
          ⚙ Execution Realism {showExecution ? '▾' : '▸'}
          {activePreset && <span className="bt-preset-badge">{EXECUTION_PRESETS[activePreset].label}</span>}
        </button>

        {showExecution && (
          <div className="bt-execution-panel">
            {/* Preset buttons */}
            <div className="bt-presets">
              {Object.entries(EXECUTION_PRESETS).map(([key, p]) => (
                <button
                  key={key}
                  type="button"
                  className={`bt-preset-btn ${activePreset === key ? 'active' : ''}`}
                  onClick={() => applyPreset(key)}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div className="bt-execution-grid">
              <label title="Slippage as decimal (0.01 = 1%)">
                Slippage
                <input type="number" step="0.0001" min="0" value={slippage} onChange={e => { setSlippage(parseFloat(e.target.value) || 0); setActivePreset(''); }} />
              </label>
              <label title="Spread as decimal (0.01 = 1%)">
                Spread
                <input type="number" step="0.0001" min="0" value={spread} onChange={e => { setSpread(parseFloat(e.target.value) || 0); setActivePreset(''); }} />
              </label>
              <label title="Per-share/contract commission ($)">
                Commission $
                <input type="number" step="0.01" min="0" value={commission} onChange={e => { setCommission(parseFloat(e.target.value) || 0); setActivePreset(''); }} />
              </label>
              <label title="Position sizing model">
                Sizing Model
                <select value={positionModel} onChange={e => { setPositionModel(e.target.value); setActivePreset(''); }}>
                  <option value="fixedPercent">% of Equity</option>
                  <option value="fixedDollar">Fixed $</option>
                  <option value="atrEqualRisk">ATR Equal Risk</option>
                  <option value="kellyFull">Kelly (full)</option>
                  <option value="kellyHalf">Kelly (half)</option>
                </select>
              </label>
              {(positionModel === 'kellyFull' || positionModel === 'kellyHalf') && (
                <label title="Maximum % of account allowed per trade. Kelly can be aggressive — cap it.">
                  Kelly Cap %
                  <input type="number" step="5" min="5" max="50" value={kellyCapPct} onChange={e => { setKellyCapPct(parseFloat(e.target.value) || 25); setActivePreset(''); }} />
                </label>
              )}
              {positionModel === 'atrEqualRisk' && (
                <label title="Stop distance = ATR × multiplier. Higher = wider stop, smaller position.">
                  ATR Multiplier
                  <input type="number" step="0.5" min="0.5" max="5" value={atrMultiplier} onChange={e => { setAtrMultiplier(parseFloat(e.target.value) || 1.5); setActivePreset(''); }} />
                </label>
              )}
              {positionModel === 'atrEqualRisk' && (
                <label title="ATR lookback period. 14 = standard, 10 = more responsive, 20 = smoother.">
                  ATR Period
                  <input type="number" step="1" min="5" max="50" value={atrPeriod} onChange={e => { setAtrPeriod(parseInt(e.target.value, 10) || 14); setActivePreset(''); }} />
                </label>
              )}
              {!(positionModel === 'kellyFull' || positionModel === 'kellyHalf') && (
                <label title="Risk per trade as % of account. Position size = (account * risk%) / stopDistance">
                  Risk %
                  <input type="number" step="0.5" min="0.5" max="20" value={riskPct} onChange={e => { setRiskPct(parseFloat(e.target.value) || 2); setActivePreset(''); }} />
                </label>
              )}
              <label title="Starting account balance for position sizing">
                Account Size
                <input type="number" step="1000" min="1000" value={accountSize} onChange={e => { setAccountSize(parseInt(e.target.value) || 10000); setActivePreset(''); }} />
              </label>
            </div>
          </div>
        )}
      </div>

{runMutation.isError && <NoticeBlock notice={noticeFromError(runMutation.error)} compact />}

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
            {/* Bracket trade stats */}
            {stats.totalTrades != null && (
              <>
                <div className="bt-stat"><div className="bt-stat-value">{stats.totalTrades}</div><div>Bracket Trades</div></div>
                <div className="bt-stat"><div className="bt-stat-value">{(stats.tradeWinRate * 100).toFixed(0)}%</div><div>Trade Win Rate</div></div>
                <div className="bt-stat"><div className="bt-stat-value">{stats.avgTradePnl}%</div><div>Avg Trade PnL</div></div>
                <div className="bt-stat"><div className="bt-stat-value">${stats.totalPnl?.toFixed(2)}</div><div>Total PnL</div></div>
                <div className="bt-stat"><div className="bt-stat-value">{stats.grossPnl != null ? `$${stats.grossPnl.toFixed(2)}` : '—'}</div><div>Gross PnL</div></div>
                <div className="bt-stat"><div className="bt-stat-value">{stats.totalCommission != null ? `$${stats.totalCommission.toFixed(2)}` : '—'}</div><div>Total Commission</div></div>
                <div className="bt-stat"><div className="bt-stat-value">{stats.avgPositionSize != null ? Math.round(stats.avgPositionSize) : '—'}</div><div>Avg Pos Size</div></div>
                <div className="bt-stat"><div className="bt-stat-value">{stats.maxTradeDrawdown != null ? `$${stats.maxTradeDrawdown.toFixed(2)}` : '—'}</div><div>Max Trade DD</div></div>
              </>
            )}
          </div>

          {result?.period && <p className="bt-period">Period: {result.period}</p>}

          {/* Execution realism info */}
          {execution && (
            <p className="bt-execution-info">
              ⚙ Slippage: {(execution.slippage * 100).toFixed(2)}% · Spread: {(execution.spread * 100).toFixed(2)}%
              · Commission: ${execution.commission.toFixed(2)}/share · {execution.positionModel === 'fixedPercent'
                ? `${execution.riskPct}% risk on $${execution.accountSize.toLocaleString()}`
                : execution.positionModel === 'fixedDollar'
                ? `$${execution.fixedAmount} fixed`
                : execution.positionModel?.startsWith('kelly')
                ? <>Kelly ({execution.positionModel === 'kellyHalf' ? 'half' : 'full'})
                  · f={(execution.kellyFraction * 100).toFixed(1)}%
                  · Edge: {execution.kellyEdge > 0 ? '+' : ''}{execution.kellyEdge}%
                  · Cap: {execution.kellyCapPct}%
                  {execution.kellyFraction * 100 > 25 && <span style={{ color: 'var(--danger)', fontWeight: 700 }}> ⚠ Aggressive!</span>}
                </>
                : `$${execution.fixedAmount} fixed`}
            </p>
          )}

          {/* News exclusion info */}
          {result?.newsExclusion && result.newsExclusion !== 'none' && (
            <p className="bt-news-info">
              📡 News mode: <strong>{result.newsExclusion}</strong>
              {result.newsDatesCount != null && <span> — {result.newsDatesCount} news dates found</span>}
            </p>
          )}

          {/* Equity curve + drawdown */}
          {equityData && !equityData.error && equityData.equity?.length > 0 && (
            <div className="bt-chart-section">
              <h3>Equity Curve &amp; Drawdown</h3>
              <EquityCurveChart equityData={equityData} symbol={symbol} height={300} />
            </div>
          )}

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

      {/* #819 — the replay of THIS run. Mounted here rather than as a new route: sprint #965
          item 5 names the surfaces (#819, #606) and a fourth surface is the churn it forbids. */}
      <ReplayPlayer runId={runId} />
    </div>
  );
}
