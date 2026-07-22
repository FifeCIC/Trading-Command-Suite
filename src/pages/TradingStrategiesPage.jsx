import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import './trading-strategies.css';

const TRADING = '/api/trading/strategies';

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
  const [editField, setEditField] = useState(null);     // which field is being edited
  const [editValue, setEditValue] = useState('');        // current input value
  const [saving, setSaving] = useState(false);           // save in progress

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

  // Portfolio positions for cross-referencing
  const portfolioQuery = useQuery({
    queryKey: ['portfolio-for-strategies'],
    queryFn: () => apiGet('/api/portfolio?source=mt5').catch(() => ({ positions: [] })),
    refetchInterval: 60_000,
  });
  const positions = Array.isArray(portfolioQuery.data?.positions) ? portfolioQuery.data.positions : [];

  // ── Compute position counts per symbol ──
  const positionCountBySymbol = useMemo(() => {
    const map = {};
    for (const p of positions) {
      const sym = (p.symbol || p.ticker || '').toUpperCase();
      map[sym] = (map[sym] || 0) + 1;
    }
    return map;
  }, [positions]);

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

  // ── Inline Edit Helpers ──
  const startEdit = (field, currentValue) => {
    setEditField(field);
    setEditValue(currentValue ?? '');
  };

  const cancelEdit = () => {
    setEditField(null);
    setEditValue('');
  };

  const saveEdit = async () => {
    if (!selectedId || !editField) return;
    setSaving(true);
    const val = editField === 'mode' || editField === 'brokerId'
      ? editValue
      : Number(editValue);
    try {
      const res = await fetch(`${TRADING}/${selectedId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [editField]: val }),
      });
      if (res.ok) {
        const updated = await res.json();
        setTrading(prev => prev.map(s => s.id === selectedId ? { ...s, ...updated } : s));
      }
    } catch {}
    setSaving(false);
    setEditField(null);
    setEditValue('');
  };

  const handleEditKey = (e) => {
    if (e.key === 'Enter') saveEdit();
    if (e.key === 'Escape') cancelEdit();
  };

  // Reusable inline editor
  const Editable = ({ field, label, value, suffix = '', type = 'number', options }) => {
    const isEditing = editField === field;
    return (
      <div className="ts-editable-row" onClick={() => !isEditing && startEdit(field, value)}>
        <span className="ts-req-label">{label}</span>
        {isEditing ? (
          <span className="ts-edit-group">
            {options ? (
              <select
                className="ts-edit-input ts-edit-select"
                value={editValue}
                onChange={e => setEditValue(e.target.value)}
                onBlur={saveEdit}
                onKeyDown={handleEditKey}
                autoFocus
              >
                {options.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input
                className="ts-edit-input"
                type={type}
                value={editValue}
                onChange={e => setEditValue(e.target.value)}
                onBlur={saveEdit}
                onKeyDown={handleEditKey}
                autoFocus
                min={type === 'number' ? '0' : undefined}
                step={type === 'number' ? 'any' : undefined}
              />
            )}
            {saving && <span className="ts-saving">…</span>}
          </span>
        ) : (
          <span className="ts-req-value ts-clickable" title="Click to edit">
            {value ?? '—'}{!isEditing && suffix}
          </span>
        )}
      </div>
    );
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
                  <th className="ts-tf-header">
                    TF
                    <span className="ts-tf-popover">Timeframe — the chart interval each strategy operates on (e.g. 5m = 5-minute, 1h = 1-hour, 1D = daily)</span>
                  </th>
                  <th>Pos</th>
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
                    <td className="ts-tf-cell">
                      {s.timeframe}
                      <span className="ts-tf-popover">Timeframe: {s.timeframe} — determines how frequently the strategy evaluates signals</span>
                    </td>
                    <td>
                      {(() => {
                        const sym = (s.symbol || '').toUpperCase();
                        const count = positionCountBySymbol[sym] || 0;
                        return count > 0 ? (
                          <span className="ts-chip ts-chip-ok" title={`${count} open position(s) for ${sym}`}>{count}</span>
                        ) : (
                          <span style={{ color: 'var(--ink-soft)' }}>—</span>
                        );
                      })()}
                    </td>
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

                {/* Trade Config — EDITABLE */}
                <section className="ts-detail-section">
                  <h3>⚙ Trade Configuration</h3>
                  <div className="ts-detail-card ts-edit-grid">
                    <Editable field="minComposite" label="Min Score" value={selected.minComposite} />
                    <Editable field="baseSize" label="Position Size" value={selected.baseSize} suffix=" lots" />
                    <Editable field="slPct" label="Stop Loss" value={selected.slPct} suffix="%" />
                    <Editable field="tpPct" label="Take Profit" value={selected.tpPct} suffix="%" />
                    <Editable field="cooldownMinutes" label="Cooldown" value={selected.cooldownMinutes} suffix=" min" />
                    <Editable field="maxPositions" label="Max Positions" value={selected.maxPositions} />
                    <Editable field="brokerId" label="Broker" value={selected.brokerId} type="text" />
                    <Editable field="mode" label="Mode" value={selected.mode} options={['manual','semi-auto','auto']} />
                  </div>
                </section>

                {/* Status — read-only telemetry */}
                <section className="ts-detail-section">
                  <h3>📊 Status</h3>
                  <div className="ts-detail-card ts-status-grid">
                    <div>
                      <span className="ts-req-label">Active</span>
                      <span onClick={e => e.stopPropagation()}>
                        <button
                          type="button"
                          className={`ts-chip ${selected.active ? 'ts-chip-ok' : 'ts-chip-warn'}`}
                          onClick={() => handleToggle(selected.id)}
                        >
                          {selected.active ? 'ON' : 'OFF'}
                        </button>
                      </span>
                    </div>
                    <div><span className="ts-req-label">Last Eval</span><span>{selected.lastEvaluatedAt ? new Date(selected.lastEvaluatedAt).toLocaleString() : 'Never'}</span></div>
                    <div><span className="ts-req-label">Last Signal</span><span>{selected.lastSignal ?? '—'}</span></div>
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