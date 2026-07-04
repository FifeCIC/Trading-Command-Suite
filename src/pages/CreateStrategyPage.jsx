/**
 * Create Strategy Page
 * ====================
 * Form to create a new Trading Strategy in the database.
 * Links a protocol (from code registry) + scoring strategy + broker account.
 *
 * Original WordPress plugin had this — now in the React PWA.
 */

import { useState, useEffect } from 'react';
import { apiGet, apiPost } from '../core/api/client';
import './create-strategy.css';

export default function CreateStrategyPage() {
  // ── Form state ──
  const [name, setName] = useState('');
  const [protocolId, setProtocolId] = useState('');
  const [symbol, setSymbol] = useState('EURUSD');
  const [timeframe, setTimeframe] = useState('15m');
  const [mode, setMode] = useState('semi-auto');
  const [brokerId, setBrokerId] = useState('mt5');
  const [baseSize, setBaseSize] = useState('0.01');
  const [slPct, setSlPct] = useState('1.5');
  const [tpPct, setTpPct] = useState('2.0');
  const [minComposite, setMinComposite] = useState('60');

  // ── Data sources ──
  const [protocols, setProtocols] = useState([]);
  const [scoringStrategies, setScoringStrategies] = useState([]);
  const [mt5Account, setMt5Account] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(null);
  const [error, setError] = useState(null);
  const [saveError, setSaveError] = useState(null);

  // ── Load data ──
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [protos, scoring, mt5] = await Promise.all([
          apiGet('/api/scoring/gated/protocols').catch(() => ({ protocols: [] })),
          apiGet('/api/automation/scoring-strategies').catch(() => []),
          apiGet('/api/trading/mt5/account').catch(() => null),
        ]);
        if (cancelled) return;
        setProtocols((protos.protocols || protos || []).filter(p => p.active !== false));
        setScoringStrategies(Array.isArray(scoring) ? scoring : (scoring.strategies || []));
        setMt5Account(mt5);
        setLoading(false);
      } catch (err) {
        if (!cancelled) { setError(err.message); setLoading(false); }
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  // ── Symbol suggestions ──
  const COMMON_SYMBOLS = [
    'EURUSD', 'GBPUSD', 'USDJPY', 'USDCAD', 'AUDUSD', 'NZDUSD',
    'XAUUSD', 'XAGUSD', 'USOIL', 'UKOIL', 'BTCUSD', 'ETHUSD',
    'SPX500', 'TECH100', 'DJI30', 'US500',
  ];

  // ── Timeframe options ──
  const TIMEFRAMES = ['5s', '15s', '30s', '1m', '5m', '15m', '30m', '1h', '4h', '1d'];

  // ── Submit ──
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim() || !protocolId || !symbol) {
      setSaveError('Name, Protocol, and Symbol are required.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    setSaved(null);
    try {
      const result = await apiPost('/api/trading/strategies', {
        name: name.trim(),
        protocolId,
        symbol: symbol.toUpperCase(),
        timeframe,
        mode,
        brokerId,
        baseSize: parseFloat(baseSize) || 0.01,
        slPct: parseFloat(slPct) || 1.0,
        tpPct: parseFloat(tpPct) || 1.0,
        minComposite: parseInt(minComposite) || 60,
        active: true,
      });
      setSaved(result);
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  };

  // ── Render ──
  if (loading) return <main className="create-strategy-page"><p className="cs-loading">Loading data…</p></main>;
  if (error) return <main className="create-strategy-page"><p className="cs-error">Failed to load: {error}</p></main>;

  return (
    <main className="create-strategy-page">
      <header className="cs-header">
        <h1>Create Trading Strategy</h1>
        <p className="cs-subtitle">
          Link a scoring protocol to a symbol and broker account.
        </p>
      </header>

      {saved && (
        <div className="cs-success">
          ✅ Strategy created: <strong>{saved.name}</strong> — {saved.symbol} {saved.timeframe} on {saved.brokerId}
        </div>
      )}

      <form className="cs-form" onSubmit={handleSubmit}>
        {/* ── Name ── */}
        <label className="cs-field">
          <span>Strategy Name</span>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. EURUSD Default Pipeline"
            required
          />
        </label>

        {/* ── Protocol ── */}
        <label className="cs-field">
          <span>Scoring Protocol</span>
          <select value={protocolId} onChange={e => setProtocolId(e.target.value)} required>
            <option value="">— Select a protocol —</option>
            {protocols.map(p => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.directiveCount} directives, {p.tradingStyle || 'Swing'})
              </option>
            ))}
          </select>
        </label>

        {/* ── Scoring Strategy (optional) ── */}
        <label className="cs-field">
          <span>Scoring Strategy (optional — for automation config)</span>
          <select
            value=""
            onChange={() => {}}
            className="cs-select-optional"
          >
            <option value="">— None (default scoring) —</option>
            {scoringStrategies.filter(s => s.enabled).map(s => (
              <option key={s.id} value={s.id}>
                {s.name} — {s.protocolId} (threshold: {s.tradeThreshold})
              </option>
            ))}
          </select>
          <span className="cs-hint">Scoring strategies configure watchlists and thresholds for automation.</span>
        </label>

        {/* ── Symbol ── */}
        <label className="cs-field">
          <span>Symbol</span>
          <div className="cs-symbol-row">
            <input
              type="text"
              value={symbol}
              onChange={e => setSymbol(e.target.value.toUpperCase())}
              placeholder="EURUSD"
              required
              list="common-symbols"
            />
            <datalist id="common-symbols">
              {COMMON_SYMBOLS.map(s => <option key={s} value={s} />)}
            </datalist>
          </div>
        </label>

        {/* ── Timeframe ── */}
        <label className="cs-field">
          <span>Timeframe</span>
          <select value={timeframe} onChange={e => setTimeframe(e.target.value)}>
            {TIMEFRAMES.map(tf => <option key={tf} value={tf}>{tf}</option>)}
          </select>
        </label>

        {/* ── Broker ── */}
        <label className="cs-field">
          <span>Broker Account</span>
          <select value={brokerId} onChange={e => setBrokerId(e.target.value)}>
            <option value="mt5">
              MT5 — MetaQuotes-Demo #{mt5Account?.account || '10011309743'}
              {mt5Account ? ` (${mt5Account.balance ? '$' + mt5Account.balance : 'connected'})` : ''}
            </option>
            <option value="trading212">Trading212 — Portfolio monitoring only (trading disabled)</option>
            <option value="paper">Paper Trading — Virtual account for testing</option>
          </select>
          {brokerId === 'trading212' && (
            <span className="cs-hint cs-warning">
              ⚠️ Trading212 is portfolio-monitoring only. No trades will execute.
            </span>
          )}
          {brokerId === 'paper' && (
            <span className="cs-hint">
              Paper trading uses a virtual ledger — no real money. Ideal for testing.
            </span>
          )}
        </label>

        {/* ── Mode ── */}
        <label className="cs-field">
          <span>Execution Mode</span>
          <select value={mode} onChange={e => setMode(e.target.value)}>
            <option value="manual">Manual — signals displayed, no automatic action</option>
            <option value="semi-auto">Semi-Auto — trades queued for confirmation</option>
            <option value="auto">Auto — trades execute automatically</option>
          </select>
        </label>

        {/* ── Risk Params ── */}
        <fieldset className="cs-fieldset">
          <legend>Risk Parameters</legend>
          <div className="cs-row-3">
            <label className="cs-field">
              <span>Base Size (lots)</span>
              <input type="number" value={baseSize} onChange={e => setBaseSize(e.target.value)} step="0.01" min="0.01" />
            </label>
            <label className="cs-field">
              <span>Stop Loss %</span>
              <input type="number" value={slPct} onChange={e => setSlPct(e.target.value)} step="0.1" min="0.1" />
            </label>
            <label className="cs-field">
              <span>Take Profit %</span>
              <input type="number" value={tpPct} onChange={e => setTpPct(e.target.value)} step="0.1" min="0.1" />
            </label>
          </div>
          <label className="cs-field">
            <span>Min Composite Score</span>
            <input type="number" value={minComposite} onChange={e => setMinComposite(e.target.value)} min="0" max="100" />
            <span className="cs-hint">Only trade when composite score exceeds this threshold (0–100).</span>
          </label>
        </fieldset>

        {/* ── Submit ── */}
        {saveError && <div className="cs-save-error">❌ {saveError}</div>}
        <button type="submit" className="cs-submit" disabled={saving}>
          {saving ? 'Creating…' : 'Create Strategy'}
        </button>
      </form>
    </main>
  );
}
