/**
 * Strategy Create — Unified Creation Hub
 * ========================================
 * Tabbed creation consolidating form-based and wizard-based flows.
 *
 * Tabs:
 *   Form    — structured form with broker compatibility, risk defaults (consolidated 2026-08-27)
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
import { getAssetType } from '../core/asset-types';
import { STYLE_DEFAULTS } from '../core/broker-utils';
import LoadingSkeleton from '../components/LoadingSkeleton';
import EmptyState from '../components/EmptyState';
import StrategyWizard from '../components/StrategyBuilder/StrategyWizard';
import '../core/forms.css';
import '../components/StrategyBuilder/strategy-wizard.css';
import './strategy-create.css';
import PageInfoPopover from '../components/PageInfoPopover';

const TABS = [
  { id: 'form', label: 'Form', icon: '📝' },
  { id: 'wizard', label: 'Wizard', icon: '🧙' },
];

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
  const [description, setDescription] = useState('');
  const [minRarityBand, setMinRarityBand] = useState('');
  const [requireDirection, setRequireDirection] = useState('');
  const [useRaritySizing, setUseRaritySizing] = useState(true);
  const [maxSize, setMaxSize] = useState('');
  const [maxPositions, setMaxPositions] = useState(1);
  const [maxDailyLoss, setMaxDailyLoss] = useState('');
  const [cooldownMinutes, setCooldownMinutes] = useState(5);
  const [hotStockEnabled, setHotStockEnabled] = useState(false);
  const [hotStockAllocation, setHotStockAllocation] = useState('');
  const [hotStockDetectionMode, setHotStockDetectionMode] = useState('');
  const [hotStockMaxHoldHours, setHotStockMaxHoldHours] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showHotStock, setShowHotStock] = useState(false);
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

  // Broker configs — from API
  const { data: brokerData } = useQuery({
    queryKey: ['broker-configs'],
    queryFn: () => apiGet('/api/brokers').catch(() => ({ brokers: [] })),
    staleTime: 300_000,
  });
  const brokerMap = useMemo(() => {
    const brokers = brokerData?.brokers || [];
    const map = {};
    for (const b of brokers) {
      map[b.id] = {
        supportedStyles: b.supportedStyles || [],
        supportedAssetTypes: b.supportedAssetTypes || [],
        tradingEnabled: b.tradingEnabled ?? true,
        note: b.note || '',
        displayName: b.displayName || b.id,
      };
    }
    return map;
  }, [brokerData]);
  const BROKER_LIST = Object.keys(brokerMap);

  // ── Derived ──
  const selectedProto = useMemo(() => {
    return protoList.find(p => (p.id || p.slug) === protocolId) || null;
  }, [protoList, protocolId]);

  const brokerCfg = brokerMap[brokerId] || brokerMap.mt5;
  const assetType = getAssetType(symbol);

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
      description: description.trim() || undefined,
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
      minRarityBand: minRarityBand || undefined,
      requireDirection: requireDirection || undefined,
      useRaritySizing,
      maxSize: maxSize ? Number(maxSize) : undefined,
      maxPositions: Number(maxPositions),
      maxDailyLoss: maxDailyLoss ? Number(maxDailyLoss) : undefined,
      cooldownMinutes: Number(cooldownMinutes),
      hotStockEnabled,
      hotStockAllocation: hotStockAllocation ? Number(hotStockAllocation) : undefined,
      hotStockDetectionMode: hotStockDetectionMode || undefined,
      hotStockMaxHoldHours: hotStockMaxHoldHours ? Number(hotStockMaxHoldHours) : undefined,
    });
  };

  // ── Render ─────────────────────────────────────────────

  return (
    <div className="sc-page">
      <motion.header className="sc-header" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <div>
          <h1>Create Strategy
          <PageInfoPopover>
            Form or wizard — configure a new trading strategy
          </PageInfoPopover>
        </h1>
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

              {/* Description */}
              <label className="sc-field">
                <span>Description</span>
                <textarea
                  className="sc-input sc-textarea" rows={2} placeholder="Optional notes about this strategy..."
                  value={description} onChange={e => setDescription(e.target.value)}
                />
              </label>

              {/* ── Signal Filters (collapsible) ── */}
              <button type="button" className="sc-section-toggle" onClick={() => setShowAdvanced(!showAdvanced)}>
                {showAdvanced ? '▾' : '▸'} Advanced Settings
              </button>
              {showAdvanced && (
                <div className="sc-advanced-grid">
                  <div className="sc-section-label">Signal Filters</div>
                  <div className="sc-field-row">
                    <label className="sc-field">
                      <span>Min Rarity Band</span>
                      <select className="sc-input" value={minRarityBand} onChange={e => setMinRarityBand(e.target.value)}>
                        <option value="">— Any —</option>
                        {['standard','strong','exceptional','cyclical','black-swan'].map(b => (
                          <option key={b} value={b}>{b}</option>
                        ))}
                      </select>
                    </label>
                    <label className="sc-field">
                      <span>Require Direction</span>
                      <select className="sc-input" value={requireDirection} onChange={e => setRequireDirection(e.target.value)}>
                        <option value="">— Any —</option>
                        <option value="long">Long only</option>
                        <option value="short">Short only</option>
                      </select>
                    </label>
                  </div>

                  {/* ── Position & Risk Management ── */}
                  <div className="sc-section-label">Position & Risk Management</div>
                  <div className="sc-field-row sc-field-row-4">
                    <label className="sc-field">
                      <span>Max Positions</span>
                      <input className="sc-input" type="number" min="1" max="20" value={maxPositions} onChange={e => setMaxPositions(Number(e.target.value))} />
                    </label>
                    <label className="sc-field">
                      <span>Max Size</span>
                      <input className="sc-input" type="number" step="0.01" min="0" placeholder="e.g. 0.5" value={maxSize} onChange={e => setMaxSize(e.target.value)} />
                    </label>
                    <label className="sc-field">
                      <span>Max Daily Loss ($)</span>
                      <input className="sc-input" type="number" step="0.01" min="0" placeholder="e.g. 500" value={maxDailyLoss} onChange={e => setMaxDailyLoss(e.target.value)} />
                    </label>
                    <label className="sc-field">
                      <span>Cooldown (min)</span>
                      <input className="sc-input" type="number" min="0" max="1440" value={cooldownMinutes} onChange={e => setCooldownMinutes(Number(e.target.value))} />
                    </label>
                  </div>
                  <label className="sc-field sc-checkbox-field">
                    <label className="sc-checkbox-label">
                      <input type="checkbox" checked={useRaritySizing} onChange={e => setUseRaritySizing(e.target.checked)} />
                      <span>Use rarity-based position sizing</span>
                    </label>
                  </label>

                  {/* ── Hot Stock Picks ── */}
                  <div className="sc-section-label">Hot Stock Picks (#339)</div>
                  <label className="sc-field sc-checkbox-field">
                    <label className="sc-checkbox-label">
                      <input type="checkbox" checked={hotStockEnabled} onChange={e => setHotStockEnabled(e.target.checked)} />
                      <span>Enable hot stock picks</span>
                    </label>
                  </label>
                  {hotStockEnabled && (
                    <div className="sc-field-row sc-field-row-3">
                      <label className="sc-field">
                        <span>Hot Stock Allocation %</span>
                        <input className="sc-input" type="number" step="0.1" min="0" max="100" placeholder="e.g. 10" value={hotStockAllocation} onChange={e => setHotStockAllocation(e.target.value)} />
                      </label>
                      <label className="sc-field">
                        <span>Detection Mode</span>
                        <select className="sc-input" value={hotStockDetectionMode} onChange={e => setHotStockDetectionMode(e.target.value)}>
                          <option value="">— Select —</option>
                          <option value="top-scoring">Top Scoring</option>
                          <option value="volume-spike">Volume Spike</option>
                          <option value="all">All</option>
                        </select>
                      </label>
                      <label className="sc-field">
                        <span>Max Hold (hours)</span>
                        <input className="sc-input" type="number" min="1" max="168" placeholder="24" value={hotStockMaxHoldHours} onChange={e => setHotStockMaxHoldHours(e.target.value)} />
                      </label>
                    </div>
                  )}
                </div>
              )}

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
