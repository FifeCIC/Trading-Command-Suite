import { useState, useEffect, useMemo } from 'react';
import './trading-strategies.css';

const TRADING = 'http://localhost:3201/api/trading/strategies';

// ── Strategy intelligence maps ──
const PROTOCOL_INTEL = {
  'btc-speed-v1': {
    label: 'BTC Speed v1',
    description: 'High-frequency scalping protocol for BTC/USD. Designed for rapid entry/exit within 15-minute windows.',
    requiredAccounts: ['MT5 Bridge', 'Trading212'],
    minimumDataSource: 'MT5 (tick-level or M1 bars)',
    apiIntensity: 'intensive',
    canFallback: false,
    preTradeChecks: ['MT5 connected', 'Spread < 0.05%', 'Min 2 recent M1 bars'],
  },
  'conviction-dip': {
    label: 'Conviction Dip Accumulation',
    description: 'Accumulates positions during dips in high-conviction symbols using scaled entries.',
    requiredAccounts: ['Alpaca', 'Trading212'],
    minimumDataSource: 'Alpaca (1H bars) or Trading212',
    apiIntensity: 'moderate',
    canFallback: true,
    preTradeChecks: ['Portfolio balance > 0', 'Symbol in watchlist', 'Min 50 1H bars'],
  },
  'momentum-breakout': {
    label: 'Momentum Breakout',
    description: 'Enter on confirmed momentum breakouts above resistance with volume confirmation.',
    requiredAccounts: ['Alpaca', 'MT5 Bridge'],
    minimumDataSource: 'Alpaca (1D bars) or MT5',  
    apiIntensity: 'moderate',
    canFallback: true,
    preTradeChecks: ['Alpaca or MT5 connected', 'Min 50 1D bars', 'Volume > 1M avg'],
  },
  'mean-reversion-swing': {
    label: 'Mean Reversion Swing',
    description: 'Swing trade off overextended RSI and Bollinger Band extremes.',
    requiredAccounts: ['Alpaca'],
    minimumDataSource: 'Alpaca (1H bars)',
    apiIntensity: 'low',
    canFallback: true,
    preTradeChecks: ['Alpaca connected', 'Min 100 1H bars'],
  },
  'earnings-whisper': {
    label: 'Earnings Whisper',
    description: 'Pre-earnings positioning based on whisper numbers and analyst revisions.',
    requiredAccounts: ['Trading212'],
    minimumDataSource: 'Trading212 or Finnhub',
    apiIntensity: 'low',
    canFallback: true,
    preTradeChecks: ['Earnings date within 7 days', 'Analyst consensus available'],
  },
};

const INTENSITY_COLORS = {
  intensive: '#ef4444',
  moderate: '#f59e0b', 
  low: '#22c55e',
};

const INTENSITY_LABELS = {
  intensive: 'Intensive — needs MT5 or real-time feed. 15-min max cycle.',
  moderate: 'Moderate — hourly/daily bars sufficient. Free-tier viable.',
  low: 'Low — daily bars OK. Minimum API calls.',
};

function inferIntelligence(strategy) {
  const proto = PROTOCOL_INTEL[strategy.protocolId];
  if (proto) return proto;
  // Fallback: derive from timeframe
  const tf = (strategy.timeframe || '').toLowerCase();
  const isShort = tf.includes('m') || tf === '1h';
  return {
    label: strategy.protocolId || 'Unknown',
    description: 'Custom protocol — review requirements manually.',
    requiredAccounts: isShort ? ['MT5 Bridge'] : ['Alpaca', 'Trading212'],
    minimumDataSource: isShort ? 'MT5 (real-time)' : 'Alpaca (1D bars)',
    apiIntensity: isShort ? 'intensive' : 'moderate',
    canFallback: !isShort,
    preTradeChecks: isShort
      ? ['MT5 connected', 'Spread < 0.1%']
      : ['Provider connected', 'Min 50 bars'],
  };
}

export default function TradingStrategiesPage() {
  const [trading, setTrading] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(TRADING)
      .then(r => r.ok ? r.json() : [])
      .then(data => {
        if (cancelled) return;
        // API returns flat array; support both legacy {viable:[]} and current [] formats
        const list = Array.isArray(data) ? data : (data.viable || data.strategies || []);
        setTrading(list);
        setLoading(false);
      })
      .catch(e => {
        if (cancelled) return;
        setTrading([]);
        setError(e.message);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const selected = useMemo(() => {
    if (!selectedId) return null;
    return trading.find(s => s.id === selectedId) || null;
  }, [selectedId, trading]);

  const intel = selected ? inferIntelligence(selected) : null;

  const handleToggle = (id) => {
    fetch(`${TRADING}/${id}/toggle`, { method: 'POST' })
      .then(r => r.json())
      .then(updated => {
        setTrading(prev => prev.map(s => s.id === id ? { ...s, active: updated.active } : s));
      })
      .catch(() => {});
  };

  if (loading) return <main className="trading-strategies-page"><p className="ts-empty">Loading…</p></main>;

  const showError = error && trading.every(s => s.id?.startsWith?.('mock-'));

  return (
    <main className="trading-strategies-page">
      <header className="ts-header">
        <h1>Trading Strategies</h1>
        <p className="ts-subtitle">
          {trading.length} strategies — connects protocols to symbols with bracket orders.&nbsp;
          {showError && <span style={{color:'#f59e0b',fontSize:'0.75rem'}}>(Mock data — API offline)</span>}
          <a href="/?view=scoring&secondaryView=protocols" style={{color:'var(--accent,#8b5cf6)',marginLeft:8}}>
            View Scoring Protocols →
          </a>
        </p>
      </header>

      {trading.length === 0 ? (
        <p className="ts-empty">No trading strategies configured. Create one via the API or DB.</p>
      ) : (
        <div className="ts-split">
          {/* ── Table ── */}
          <div className="ts-table-pane">
            <table className="ts-table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Name</th>
                  <th>TF</th>
                  <th>SL / TP</th>
                  <th>Mode</th>
                  <th>Active</th>
                </tr>
              </thead>
              <tbody>
                {trading.map(s => (
                  <tr
                    key={s.id}
                    className={`ts-row${selectedId === s.id ? ' ts-row--selected' : ''}`}
                    onClick={() => setSelectedId(selectedId === s.id ? null : s.id)}
                  >
                    <td className="ts-name">{s.symbol}</td>
                    <td className="ts-name-col">{s.name}</td>
                    <td>{s.timeframe}</td>
                    <td>{s.slPct ?? '—'}% / {s.tpPct ?? '—'}%</td>
                    <td>{s.mode}</td>
                    <td onClick={e => e.stopPropagation()}>
                      <button
                        type="button"
                        className={`ts-chip ${s.active ? 'ts-chip-ok' : 'ts-chip-warn'}`}
                        onClick={() => handleToggle(s.id)}
                      >
                        {s.active ? 'ON' : 'OFF'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── Sidebar ── */}
          <aside className="ts-sidebar">
            {!selected ? (
              <div className="ts-sidebar-empty">
                <p>Click a strategy row to see details, protocol info, and requirements.</p>
              </div>
            ) : (
              <div className="ts-sidebar-detail">
                <h2>{selected.symbol} — {selected.name}</h2>

                {/* Protocol */}
                <section className="ts-detail-section">
                  <h3>Protocol</h3>
                  <div className="ts-detail-card">
                    <strong>{intel?.label}</strong>
                    <p>{intel?.description}</p>
                  </div>
                </section>

                {/* Data Requirements */}
                <section className="ts-detail-section">
                  <h3>Data Requirements</h3>
                  <div className="ts-detail-card">
                    <div className="ts-requirement-row">
                      <span className="ts-req-label">Minimum source</span>
                      <span className="ts-req-value">{intel?.minimumDataSource}</span>
                    </div>
                    <div className="ts-requirement-row">
                      <span className="ts-req-label">API intensity</span>
                      <span className="ts-intensity-badge" style={{ background: INTENSITY_COLORS[intel?.apiIntensity] + '20', color: INTENSITY_COLORS[intel?.apiIntensity], borderColor: INTENSITY_COLORS[intel?.apiIntensity] }}>
                        {intel?.apiIntensity}
                      </span>
                    </div>
                    <p className="ts-intensity-desc">{INTENSITY_LABELS[intel?.apiIntensity]}</p>
                  </div>
                </section>

                {/* Required Accounts */}
                <section className="ts-detail-section">
                  <h3>Required Accounts</h3>
                  <div className="ts-detail-card">
                    {intel?.requiredAccounts?.map(acct => (
                      <div key={acct} className="ts-account-chip">{acct}</div>
                    ))}
                    {!intel?.canFallback && (
                      <p className="ts-no-fallback">⚠️ No fallback — this strategy cannot run without its primary data source.</p>
                    )}
                    {intel?.canFallback && (
                      <p className="ts-has-fallback">✅ Fallback available — can run on reduced data.</p>
                    )}
                  </div>
                </section>

                {/* Pre-Trade Checks */}
                <section className="ts-detail-section">
                  <h3>Pre-Trade Checks</h3>
                  <div className="ts-detail-card">
                    <ul className="ts-checklist">
                      {intel?.preTradeChecks?.map((check, i) => (
                        <li key={i}>{check}</li>
                      ))}
                    </ul>
                    <p className="ts-disable-note">
                      Strategy will auto-disable if required checks fail or no positions exist.
                    </p>
                  </div>
                </section>

                {/* Trade Config */}
                <section className="ts-detail-section">
                  <h3>Trade Configuration</h3>
                  <div className="ts-detail-card ts-status-grid">
                    <div><span className="ts-req-label">Min Score</span><span className="ts-req-value">{selected.minComposite ?? '—'}</span></div>
                    <div><span className="ts-req-label">Position Size</span><span className="ts-req-value">{selected.baseSize ?? '—'}</span></div>
                    <div><span className="ts-req-label">Stop Loss</span><span className="ts-req-value">{selected.slPct ?? '—'}%</span></div>
                    <div><span className="ts-req-label">Take Profit</span><span className="ts-req-value">{selected.tpPct ?? '—'}%</span></div>
                  </div>
                </section>

                {/* Status */}
                <section className="ts-detail-section">
                  <h3>Status</h3>
                  <div className="ts-detail-card ts-status-grid">
                    <div><span className="ts-req-label">Mode</span><span>{selected.mode}</span></div>
                    <div><span className="ts-req-label">Active</span><span className={`ts-chip ${selected.active ? 'ts-chip-ok' : 'ts-chip-warn'}`}>{selected.active ? 'ON' : 'OFF'}</span></div>
                    <div><span className="ts-req-label">Last Eval</span><span>{selected.lastEvaluatedAt ? new Date(selected.lastEvaluatedAt).toLocaleString() : 'Never'}</span></div>
                    <div><span className="ts-req-label">Last Signal</span><span>{selected.lastSignal ?? '—'}</span></div>
                    <div><span className="ts-req-label">Eval Count</span><span>{selected.evaluationCount ?? 0}</span></div>
                    <div><span className="ts-req-label">Composite</span><span>{selected.lastComposite?.toFixed(1) ?? '—'}</span></div>
                  </div>
                </section>
              </div>
            )}
          </aside>
        </div>
      )}
    </main>
  );
}