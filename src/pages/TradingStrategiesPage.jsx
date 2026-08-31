import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import './trading-strategies.css';

const TRADING = '/api/trading/strategies';

// ── Strategy intelligence derived from protocol registry ──
// No hardcoded maps. All metadata comes from GET /api/scoring/gated/protocols.
// Fields not yet in the protocol schema (requiredAccounts, canFallback) are
// omitted until they're added to the DB.

function buildIntel(strategy, protocolMap) {
  const proto = strategy.protocolId ? protocolMap[strategy.protocolId] : null;
  const name = proto?.name || strategy.protocolId || 'Unknown';
  const desc = proto?.description || 'Protocol metadata not available.';
  const style = proto?.tradingStyle || '—';
  const tf = proto?.recommendedTimeframe || strategy.timeframe || '—';
  return { name, description: desc, tradingStyle: style, recommendedTimeframe: tf };
}

export default function TradingStrategiesPage() {
  const [trading, setTrading] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [editField, setEditField] = useState(null);     // which field is being edited
  const [editValue, setEditValue] = useState('');        // current input value
  const [saving, setSaving] = useState(false);           // save in progress
  const [sortKey, setSortKey] = useState('symbol');
  const [sortDir, setSortDir] = useState('asc');

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

  // Protocol registry — authoritative source for protocol metadata
  const protocolsQuery = useQuery({
    queryKey: ['ts-protocols'],
    queryFn: () => apiGet('/api/scoring/gated/protocols').catch(() => ({ protocols: [] })),
    staleTime: 120_000,
  });
  const protocolMap = useMemo(() => {
    const map = {};
    for (const p of (protocolsQuery.data?.protocols || [])) {
      map[p.id] = p;
    }
    return map;
  }, [protocolsQuery.data]);

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

  // ── Sorted list ──
  const sortedTrading = useMemo(() => {
    const sorted = [...trading];
    sorted.sort((a, b) => {
      const va = (a[sortKey] ?? '').toString().toLowerCase();
      const vb = (b[sortKey] ?? '').toString().toLowerCase();
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [trading, sortKey, sortDir]);

  const handleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  const sortArrow = (key) => sortKey === key ? (sortDir === 'asc' ? ' ▴' : ' ▾') : '';

  const intel = selected ? buildIntel(selected, protocolMap) : null;

  // Strategy-owned protocol subscriptions (2026-08-31). Falls back to the
  // legacy single protocolId/shortProtocolId link until subscriptions exist.
  const subscriptions = selected
    ? (Array.isArray(selected.protocols) && selected.protocols.length > 0
        ? selected.protocols
        : [
            ...(selected.protocolId ? [{ protocolId: selected.protocolId, role: 'long' }] : []),
            ...(selected.shortProtocolId ? [{ protocolId: selected.shortProtocolId, role: 'short' }] : []),
          ])
    : [];

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
                  <th className="ts-sortable" onClick={() => handleSort('symbol')}>Symbol{sortArrow('symbol')}</th>
                  <th className="ts-sortable" onClick={() => handleSort('name')}>Name{sortArrow('name')}</th>
                  <th className="ts-tf-header ts-sortable" onClick={() => handleSort('timeframe')}>
                    TF{sortArrow('timeframe')}
                    <span className="ts-tf-popover">Timeframe — the chart interval each strategy operates on (e.g. 5m = 5-minute, 1h = 1-hour, 1D = daily)</span>
                  </th>
                  <th>Pos</th>
                  <th>SL / TP</th>
                  <th className="ts-sortable" onClick={() => handleSort('mode')}>Mode{sortArrow('mode')}</th>
                  <th className="ts-sortable" onClick={() => handleSort('active')}>Active{sortArrow('active')}</th>
                </tr>
              </thead>
              <tbody>
                {sortedTrading.map(s => (
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

                {/* Protocols — signal sources (strategy-owned subscriptions) */}
                <section className="ts-detail-section">
                  <h3>Protocols <span className="ts-req-label">(signal sources)</span></h3>
                  <div className="ts-detail-card">
                    {subscriptions.length === 0 ? (
                      <p className="ts-intensity-desc">
                        No protocol subscriptions yet — this strategy has no signal sources.
                      </p>
                    ) : (
                      <div className="ts-sub-list">
                        {subscriptions.map((sub, i) => {
                          const meta = protocolMap[sub.protocolId];
                          return (
                            <div key={`${sub.protocolId}-${i}`} className={`ts-sub-row ts-sub-${String(sub.role).toLowerCase()}`}>
                              <span className="ts-sub-name">{meta?.name || sub.protocolId}</span>
                              <span className="ts-sub-role">{sub.role}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </section>

                {/* Protocol Info — from protocol registry (authoritative source) */}
                <section className="ts-detail-section">
                  <h3>Protocol</h3>
                  <div className="ts-detail-card">
                    <div className="ts-requirement-row">
                      <span className="ts-req-label">Name</span>
                      <span className="ts-req-value">{intel?.name || '—'}</span>
                    </div>
                    <div className="ts-requirement-row">
                      <span className="ts-req-label">Style</span>
                      <span className="ts-req-value">{intel?.tradingStyle || '—'}</span>
                    </div>
                    <div className="ts-requirement-row">
                      <span className="ts-req-label">Timeframe</span>
                      <span className="ts-req-value">{intel?.recommendedTimeframe || '—'}</span>
                    </div>
                    {intel?.description && (
                      <p className="ts-intensity-desc">{intel.description}</p>
                    )}
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