/**
 * Strategy Create — Unified Creation Hub
 * ========================================
 * Tabbed creation consolidating form-based and wizard-based flows.
 *
 * Tabs:
 *   Form    — structured form with broker compatibility, risk defaults (from CreateStrategyPage)
 *   Wizard  — step-by-step guided creation (from StrategyWizardPage)
 *
 * Data: /api/scoring/gated/protocols, /api/watchlists, /api/trading/strategies
 *
 * @created 2026-07-29 — #504 strategy page consolidation
 */

import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { apiGet, apiPost } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import EmptyState from '../components/EmptyState';
import StrategyWizard from '../components/StrategyBuilder/StrategyWizard';
import '../core/forms.css';
import '../components/StrategyBuilder/strategy-wizard.css';
import './strategy-create.css';

const TABS = [
  { id: 'form', label: 'Form', icon: '📝' },
  { id: 'wizard', label: 'Wizard', icon: '🧙' },
];

// ── Protocol → Broker compatibility (from CreateStrategyPage) ──
const PROTOCOL_BROKER_MAP = {
  mt5: {
    supportedStyles: ['scalp', 'day-trade', 'swing', 'position', 'speed'],
    supportedAssetTypes: ['forex', 'commodity', 'index', 'crypto', 'stock'],
    tradingEnabled: true,
    note: 'Full execution — SL/TP, trailing stops, partial close',
  },
  trading212: {
    supportedStyles: ['swing', 'position'],
    supportedAssetTypes: ['stock', 'etf'],
    tradingEnabled: false,
    note: 'Portfolio monitoring only — no trade execution',
  },
  paper: {
    supportedStyles: ['scalp', 'day-trade', 'swing', 'position', 'speed'],
    supportedAssetTypes: ['forex', 'commodity', 'index', 'crypto', 'stock', 'etf'],
    tradingEnabled: true,
    note: 'Virtual ledger — ideal for testing new strategies',
  },
  'capital.com': {
    supportedStyles: ['scalp', 'day-trade', 'swing', 'position'],
    supportedAssetTypes: ['forex', 'commodity', 'index', 'crypto'],
    tradingEnabled: true,
    note: 'CFD broker — session-based auth, demo + live accounts',
  },
};

const STYLE_DEFAULTS = {
  scalp:    { baseSize: 0.01, slPct: 0.3, tpPct: 0.5, minComposite: 70, timeframe: '5s' },
  'day-trade': { baseSize: 0.02, slPct: 0.5, tpPct: 1.0, minComposite: 65, timeframe: '5m' },
  speed:    { baseSize: 0.01, slPct: 0.2, tpPct: 0.4, minComposite: 75, timeframe: '15s' },
  swing:    { baseSize: 0.05, slPct: 1.5, tpPct: 3.0, minComposite: 60, timeframe: '1h' },
  position: { baseSize: 0.1, slPct: 3.0, tpPct: 6.0, minComposite: 55, timeframe: '1d' },
};

function inferAssetType(symbol) {
  const s = symbol.toUpperCase();
  if (['EURUSD','GBPUSD','USDJPY','USDCAD','AUDUSD','NZDUSD','USDCHF'].includes(s)) return 'forex';
  if (['XAUUSD','XAGUSD','USOIL','UKOIL','XTIUSD','XBRUSD'].includes(s)) return 'commodity';
  if (['US500','US100','US30','GER40','UK100'].includes(s)) return 'index';
  if (['BTCUSD','ETHUSD','LTCUSD'].includes(s)) return 'crypto';
  return 'stock';
}

const BROKER_LIST = Object.keys(PROTOCOL_BROKER_MAP);

export default function StrategyCreatePage() {
  const [tab, setTab] = useState('form');
  const queryClient = useQueryClient();

  // ── Form state ──
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [brokerId, setBrokerId] = useState('mt5');
  const [protocolId, setProtocolId] = useState('');
  const [mode, setMode] = useState('score');
  const [baseSize, setBaseSize] = useState(0.02);
  const [slPct, setSlPct] = useState(0.5);
  const [tpPct, setTpPct] = useState(1.0);
  const [minComposite, setMinComposite] = useState(65);
  const [timeframe, setTimeframe] = useState('5m');
  const [watchlistName, setWatchlistName] = useState('');
  const [msg, setMsg] = useState('');

  // ── Data ──
  const { data: protocols = [], isLoading: protoLoading } = useQuery({
    queryKey: ['create-protocols'],
    queryFn: () => apiGet('/api/scoring/gated/protocols').catch(() => ({ protocols: [] })),
    staleTime: 60_000,
  });
  const protoList = protocols?.protocols || protocols || [];

  const { data: watchlists = [] } = useQuery({
    queryKey: ['create-watchlists'],
    queryFn: () => apiGet('/api/watchlists').catch(() => ({ watchlists: [] })),
    staleTime: 30_000,
  });
  const wlList = watchlists?.watchlists || watchlists || [];

  // ── Derived ──
  const selectedProto = useMemo(() => {
    return protoList.find(p => (p.id || p.slug) === protocolId) || null;
  }, [protoList, protocolId]);

  const brokerCfg = PROTOCOL_BROKER_MAP[brokerId] || PROTOCOL_BROKER_MAP.mt5;
  const assetType = inferAssetType(symbol);

  const brokerCompatible = useMemo(() => {
    if (!brokerCfg) return true;
    const styleOk = brokerCfg.supportedStyles.includes(
      selectedProto?.tradingStyle || selectedProto?.style || 'swing'
    );
    const assetOk = brokerCfg.supportedAssetTypes.includes(assetType);
    return { styleOk, assetOk, ok: styleOk && assetOk };
  }, [brokerCfg, selectedProto, assetType]);

  // ── Apply style defaults ──
  const applyStyleDefaults = (style) => {
    const d = STYLE_DEFAULTS[style];
    if (!d) return;
    setBaseSize(d.baseSize);
    setSlPct(d.slPct);
    setTpPct(d.tpPct);
    setMinComposite(d.minComposite);
    setTimeframe(d.timeframe);
  };

  useEffect(() => {
    if (selectedProto?.tradingStyle) {
      applyStyleDefaults(selectedProto.tradingStyle);
    }
  }, [protocolId]);

  // ── Submit ──
  const createMutation = useMutation({
    mutationFn: (body) => apiPost('/api/trading/strategies', body),
    onSuccess: () => {
      setMsg('✅ Strategy created!');
      queryClient.invalidateQueries({ queryKey: ['strategies-list'] });
      queryClient.invalidateQueries({ queryKey: ['monitor-strategies'] });
    },
    onError: (err) => setMsg(`❌ ${err.message || 'Failed to create'}`),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim()) { setMsg('❌ Name is required'); return; }
    createMutation.mutate({
      name: name.trim(),
      symbol: symbol.toUpperCase() || undefined,
      brokerId,
      protocolId: protocolId || undefined,
      watchlistName: watchlistName || undefined,
      mode,
      baseSize,
      slPct,
      tpPct,
      minComposite,
      timeframe,
    });
  };

  // ── Render ─────────────────────────────────────────────

  return (
    <div className="sc-page">
      <motion.header className="sc-header" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <div>
          <h1>Create Strategy</h1>
          <p className="sc-subtitle">Form or wizard — configure a new trading or scoring strategy</p>
        </div>
      </motion.header>

      {/* Tabs */}
      <div className="sc-tabs">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`sc-tab ${tab === t.id ? 'sc-tab-active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* ── Form Tab ── */}
      {tab === 'form' && (
        <motion.div className="sc-tab-content" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
          {protoLoading ? <LoadingSkeleton variant="text" lines={4} /> : (
            <form className="sc-form" onSubmit={handleSubmit}>
              {/* Name + Mode */}
              <div className="sc-field-row">
                <label className="sc-field">
                  <span>Strategy Name *</span>
                  <input
                    className="sc-input" type="text" placeholder="e.g. Gold Scalp v2"
                    value={name} onChange={e => setName(e.target.value)}
                  />
                </label>
                <label className="sc-field">
                  <span>Mode</span>
                  <select className="sc-input" value={mode} onChange={e => { setMode(e.target.value); if (e.target.value === 'score') setSymbol(''); }}>
                    <option value="trade">Trade (single symbol)</option>
                    <option value="score">Score (watchlist)</option>
                  </select>
                </label>
              </div>

              {/* Symbol or Watchlist */}
              <div className="sc-field-row">
                {mode === 'trade' ? (
                  <label className="sc-field">
                    <span>Symbol</span>
                    <input
                      className="sc-input" type="text" placeholder="e.g. XAUUSD"
                      value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())}
                    />
                    {symbol && (
                      <span className="sc-hint">Asset type: {assetType}</span>
                    )}
                  </label>
                ) : (
                  <label className="sc-field">
                    <span>Watchlist</span>
                    <select className="sc-input" value={watchlistName} onChange={e => setWatchlistName(e.target.value)}>
                      <option value="">— Select —</option>
                      {wlList.map(w => (
                        <option key={w.id || w.name} value={w.name}>{w.name}</option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="sc-field">
                  <span>Broker</span>
                  <select className="sc-input" value={brokerId} onChange={e => setBrokerId(e.target.value)}>
                    {BROKER_LIST.map(b => (
                      <option key={b} value={b}>{b.toUpperCase()}</option>
                    ))}
                  </select>
                  {brokerCfg && (
                    <span className="sc-hint">{brokerCfg.note}</span>
                  )}
                </label>
              </div>

              {/* Protocol */}
              <label className="sc-field">
                <span>Protocol</span>
                <select className="sc-input" value={protocolId} onChange={e => setProtocolId(e.target.value)}>
                  <option value="">— Select —</option>
                  {protoList.map(p => (
                    <option key={p.id || p.slug} value={p.id || p.slug}>
                      {p.name || p.id} {p.tradingStyle ? `(${p.tradingStyle})` : ''}
                    </option>
                  ))}
                </select>
              </label>

              {/* Broker compatibility */}
              {protocolId && symbol && (
                <div className={`sc-compat ${brokerCompatible.ok ? 'sc-compat-ok' : 'sc-compat-warn'}`}>
                  {brokerCompatible.ok
                    ? '✅ Broker compatible with protocol style and asset type'
                    : `⚠️ Broker may not support this: style=${!brokerCompatible.styleOk ? '✗' : '✓'}, asset=${!brokerCompatible.assetOk ? '✗' : '✓'}`}
                </div>
              )}

              {/* Risk params */}
              <div className="sc-section-label">Risk Parameters</div>
              <div className="sc-field-row sc-field-row-4">
                <label className="sc-field">
                  <span>Base Size</span>
                  <input className="sc-input" type="number" step="0.01" min="0.01" value={baseSize} onChange={e => setBaseSize(Number(e.target.value))} />
                </label>
                <label className="sc-field">
                  <span>SL %</span>
                  <input className="sc-input" type="number" step="0.1" min="0.1" value={slPct} onChange={e => setSlPct(Number(e.target.value))} />
                </label>
                <label className="sc-field">
                  <span>TP %</span>
                  <input className="sc-input" type="number" step="0.1" min="0.1" value={tpPct} onChange={e => setTpPct(Number(e.target.value))} />
                </label>
                <label className="sc-field">
                  <span>Min Composite</span>
                  <input className="sc-input" type="number" min="40" max="95" value={minComposite} onChange={e => setMinComposite(Number(e.target.value))} />
                </label>
              </div>

              <label className="sc-field">
                <span>Timeframe</span>
                <select className="sc-input" value={timeframe} onChange={e => setTimeframe(e.target.value)}>
                  {['5s','15s','1m','5m','15m','1h','4h','1d'].map(tf => (
                    <option key={tf} value={tf}>{tf}</option>
                  ))}
                </select>
              </label>

              {/* Submit */}
              <div className="sc-actions">
                <button type="submit" className="sc-btn-primary" disabled={createMutation.isPending}>
                  {createMutation.isPending ? '⏳ Creating...' : 'Create Strategy'}
                </button>
                {msg && <span className={`sc-msg ${msg.startsWith('✅') ? 'sc-msg-ok' : 'sc-msg-err'}`}>{msg}</span>}
              </div>
            </form>
          )}
        </motion.div>
      )}

      {/* ── Wizard Tab ── */}
      {tab === 'wizard' && (
        <motion.div className="sc-tab-content" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
          <StrategyWizard />
        </motion.div>
      )}
    </div>
  );
}
