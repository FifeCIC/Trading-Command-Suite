/**
 * Create Strategy Page
 * ====================
 * Form to create a new Trading Strategy in the database.
 * Links a protocol (from code registry) + scoring strategy + broker account.
 *
 * Original WordPress plugin had this — now in the React PWA.
 */

import { useState, useEffect, useMemo } from 'react';
import { apiGet, apiPost } from '../core/api/client';
import { getAssetType } from '../core/asset-types';
import { useBrokers, STYLE_DEFAULTS } from '../core/broker-utils';
import '../core/forms.css';
import './create-strategy.css';
import PageInfoPopover from '../components/PageInfoPopover';

export default function CreateStrategyPage() {
  // ── Creation path ──
  const [creationPath, setCreationPath] = useState('protocol'); // 'protocol' | 'scoring-strategy'
  const { brokerMap } = useBrokers();

  // ── Form state ──
  const [name, setName] = useState('');
  const [protocolId, setProtocolId] = useState('');
  const [scoringStrategyId, setScoringStrategyId] = useState('');
  const [watchlistId, setWatchlistId] = useState('');
  const [symbol, setSymbol] = useState('EURUSD');
  const [timeframe, setTimeframe] = useState('15m');
  const [mode, setMode] = useState('semi-auto');
  const [brokerId, setBrokerId] = useState('mt5');
  const [baseSize, setBaseSize] = useState('0.01');
  const [slPct, setSlPct] = useState('1.5');
  const [tpPct, setTpPct] = useState('2.0');
  const [minComposite, setMinComposite] = useState('60');
  const [maxPyramidTiers, setMaxPyramidTiers] = useState('1');
  const [slTpInheritance, setSlTpInheritance] = useState('inherit');
  const [maxPositions, setMaxPositions] = useState('1');
  const [maxSize, setMaxSize] = useState('');
  const [maxDailyLoss, setMaxDailyLoss] = useState('');
  const [cooldownMinutes, setCooldownMinutes] = useState('5');
  const [minRarityBand, setMinRarityBand] = useState('');
  const [requireDirection, setRequireDirection] = useState('');
  const [useRaritySizing, setUseRaritySizing] = useState(true);
  const [description, setDescription] = useState('');
  const [hotStockEnabled, setHotStockEnabled] = useState(false);
  const [hotStockAllocation, setHotStockAllocation] = useState('5');
  const [hotStockDetection, setHotStockDetection] = useState('top-scoring');
  const [hotStockMaxHold, setHotStockMaxHold] = useState('24');

  // ── Data sources ──
  const [protocols, setProtocols] = useState([]);
  const [scoringStrategies, setScoringStrategies] = useState([]);
  const [watchlists, setWatchlists] = useState([]);
  const [mt5Account, setMt5Account] = useState(null);
  const [capitalComAccount, setCapitalComAccount] = useState(null);
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
        const [protos, scoring, wls, mt5] = await Promise.all([
          apiGet('/api/scoring/gated/protocols').catch(() => ({ protocols: [] })),
          apiGet('/api/automation/scoring-strategies').catch(() => []),
          apiGet('/api/watchlists').catch(() => ({ watchlists: [] })),
          apiGet('/api/trading/mt5/account').catch(() => null),
        ]);
        if (cancelled) return;
        // Deduplicate by id — API may return same protocol from code + database
        const rawProtocols = (protos.protocols || protos || []).filter(p => p.active !== false);
        const seen = new Set();
        setProtocols(rawProtocols.filter(p => { if (seen.has(p.id)) return false; seen.add(p.id); return true; }));
        setScoringStrategies(Array.isArray(scoring) ? scoring : (scoring.strategies || []));
        setWatchlists(wls.watchlists || []);
        setMt5Account(mt5);
        // Fetch Capital.com account on mount
        apiGet('/api/providers/capital.com/account').then(setCapitalComAccount).catch(() => {});
        setLoading(false);
      } catch (err) {
        if (!cancelled) { setError(err.message); setLoading(false); }
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  // ── Selected protocol metadata ──
  const selectedProtocol = useMemo(() => protocols.find(p => p.id === protocolId), [protocols, protocolId]);
  const protocolStyle = selectedProtocol?.tradingStyle || 'swing';
  const assetType = useMemo(() => getAssetType(symbol), [symbol]);

  // ── Filtered brokers based on protocol + symbol compatibility ──
  const compatibleBrokers = useMemo(() => {
    if (!protocolId) return Object.keys(brokerMap);
    const style = protocolStyle;
    return Object.entries(brokerMap)
      .filter(([, cfg]) => cfg.supportedStyles.includes(style) && cfg.supportedAssetTypes.includes(assetType))
      .map(([id]) => id);
  }, [protocolId, protocolStyle, assetType]);

  // ── Protocol change → auto-populate defaults ──
  const handleProtocolChange = (newProtocolId) => {
    setProtocolId(newProtocolId);
    const proto = protocols.find(p => p.id === newProtocolId);
    if (!proto) return;
    const style = proto.tradingStyle || 'swing';
    const defaults = STYLE_DEFAULTS[style] || STYLE_DEFAULTS.swing;
    setBaseSize(String(defaults.baseSize));
    setSlPct(String(defaults.slPct));
    setTpPct(String(defaults.tpPct));
    setMinComposite(String(defaults.minComposite));
    setTimeframe(defaults.timeframe);
    // Auto-name
    if (!name.trim()) {
      setName(`${proto.name || proto.id} — ${symbol}`);
    }
    // If current broker isn't compatible, switch to first compatible
    if (!compatibleBrokers.includes(brokerId)) {
      const firstCompatible = Object.entries(brokerMap)
        .filter(([, cfg]) => cfg.supportedStyles.includes(style))
        .map(([id]) => id)[0] || 'mt5';
      setBrokerId(firstCompatible);
    }
  };

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
    const isScoringPath = creationPath === 'scoring-strategy';

    if (!name.trim()) {
      setSaveError('Strategy name is required.');
      return;
    }
    if (isScoringPath && !scoringStrategyId) {
      setSaveError('Please select a Scoring Strategy.');
      return;
    }
    if (!isScoringPath && (!protocolId || !watchlistId)) {
      setSaveError('Protocol and Watchlist are required for the Protocol path.');
      return;
    }

    setSaving(true);
    setSaveError(null);
    setSaved(null);
    try {
      const body = {
        name: name.trim(),
        mode,
        brokerId,
        baseSize: parseFloat(baseSize) || 0.01,
        slPct: parseFloat(slPct) || 1.0,
        tpPct: parseFloat(tpPct) || 1.0,
        minComposite: parseInt(minComposite) || 60,
        // maxPyramidTiers + slTpInheritance are ScoringStrategy fields —
        // they will be used when the ScoringStrategy auto-create flow is built
        maxPositions: parseInt(maxPositions) || 1,
        maxSize: maxSize ? parseFloat(maxSize) : undefined,
        maxDailyLoss: maxDailyLoss ? parseFloat(maxDailyLoss) : undefined,
        cooldownMinutes: parseInt(cooldownMinutes) || 5,
        minRarityBand: minRarityBand || undefined,
        requireDirection: requireDirection || undefined,
        useRaritySizing,
        description: description.trim() || undefined,
        hotStockEnabled,
        hotStockAllocation: hotStockEnabled ? parseFloat(hotStockAllocation) || 5 : null,
        hotStockDetectionMode: hotStockEnabled ? hotStockDetection : null,
        hotStockMaxHoldHours: hotStockEnabled ? parseInt(hotStockMaxHold) || 24 : null,
        active: true,
      };

      if (isScoringPath) {
        // Scoring Strategy path — protocol and symbols come from the strategy
        body.scoringStrategyId = scoringStrategyId;
        const strat = scoringStrategies.find(s => s.id === scoringStrategyId);
        if (strat) {
          body.protocolId = strat.protocolId;
          body.timeframe = timeframe;
          body.symbol = symbol || strat.watchlistId || 'auto';
        }
      } else {
        // Protocol path — symbols come from the selected watchlist
        body.protocolId = protocolId;
        body.watchlistId = watchlistId;
        body.timeframe = timeframe;
        body.symbol = 'auto'; // derived from watchlist at runtime
      }

      const result = await apiPost('/api/trading/strategies', body);
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
        <h1>Create Trading Strategy
          <PageInfoPopover>
            Link a scoring protocol to a symbol and broker account.
          </PageInfoPopover>
        </h1>
      </header>

      {saved && (
        <div className="ff-success">
          ✅ Strategy created: <strong>{saved.name}</strong> — {saved.symbol} {saved.timeframe} on {saved.brokerId}
        </div>
      )}

      <form className="ff-form" onSubmit={handleSubmit}>
        {/* ── Creation Path Toggle ── */}
        <fieldset className="ff-fieldset">
          <legend className="ff-legend">Creation Method</legend>
          <div className="ff-toggle-group">
            <label className={`ff-toggle-option ${creationPath === 'protocol' ? 'active' : ''}`}>
              <input
                type="radio"
                name="creationPath"
                value="protocol"
                checked={creationPath === 'protocol'}
                onChange={() => setCreationPath('protocol')}
              />
              <span className="ff-toggle-label">Protocol + Watchlist</span>
              <span className="ff-toggle-desc">Pick a protocol and a watchlist. Full manual control.</span>
            </label>
            <label className={`ff-toggle-option ${creationPath === 'scoring-strategy' ? 'active' : ''}`}>
              <input
                type="radio"
                name="creationPath"
                value="scoring-strategy"
                checked={creationPath === 'scoring-strategy'}
                onChange={() => setCreationPath('scoring-strategy')}
              />
              <span className="ff-toggle-label">Scoring Strategy</span>
              <span className="ff-toggle-desc">Select a pre-configured strategy with watchlist, protocol, and thresholds.</span>
            </label>
          </div>
        </fieldset>

        {/* ── Name ── */}
        <label className="ff-field">
          <span className="ff-label">Strategy Name</span>
          <input
            type="text"
            className="ff-input"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. EURUSD Default Pipeline"
            required
          />
        </label>

        {/* ── Protocol + Symbol PATH ── */}
        {creationPath === 'protocol' && (
          <>
            {/* ── Protocol ── */}
            <label className="ff-field">
              <span className="ff-label">Scoring Protocol</span>
              <select className="ff-select" value={protocolId} onChange={e => handleProtocolChange(e.target.value)} required>
                <option value="">— Select a protocol —</option>
                {protocols.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.directiveCount || '?'} directives, {p.tradingStyle || 'Swing'})
                  </option>
                ))}
              </select>
              {selectedProtocol && (
                <span className="ff-hint">
                  Style: {protocolStyle} · {selectedProtocol.directiveCount || '?'} directives
                  {STYLE_DEFAULTS[protocolStyle] && <> · Defaults: {STYLE_DEFAULTS[protocolStyle].baseSize} lot, SL {STYLE_DEFAULTS[protocolStyle].slPct}%, TP {STYLE_DEFAULTS[protocolStyle].tpPct}%</>}
                </span>
              )}
            </label>

            {/* ── Watchlist ── */}
            <label className="ff-field">
              <span className="ff-label">Watchlist (symbols to trade)</span>
              <select className="ff-select" value={watchlistId} onChange={e => setWatchlistId(e.target.value)} required>
                <option value="">— Select a watchlist —</option>
                {watchlists.map(w => (
                  <option key={w.id} value={w.id}>{w.name || w.label || w.id} ({w.symbolCount || w.symbols?.length || 0} symbols)</option>
                ))}
              </select>
              <span className="ff-hint">The protocol scores all symbols in this watchlist. The trading strategy will trade whichever symbols pass the score threshold.</span>
            </label>
          </>
        )}

        {/* ── Scoring Strategy PATH ── */}
        {creationPath === 'scoring-strategy' && (
          <label className="ff-field">
            <span className="ff-label">Scoring Strategy</span>
            <select
              className="ff-select"
              value={scoringStrategyId}
              onChange={e => {
                const id = e.target.value;
                setScoringStrategyId(id);
                const strat = scoringStrategies.find(s => s.id === id);
                if (strat) {
                  handleProtocolChange(strat.protocolId);
                  setBrokerId(strat.brokerId || 'mt5');
                  setMode(strat.mode || 'semi-auto');
                  setBaseSize(String(strat.baseSize || 0.01));
                  setSlPct(String(strat.slPct || 1.0));
                  setTpPct(String(strat.tpPct || 1.0));
                  setMinComposite(String(strat.tradeThreshold || 60));
                  setMaxPyramidTiers(String(strat.maxPyramidTiers ?? 1));
                  setSlTpInheritance(strat.slTpInheritance || 'inherit');
                  setMaxPositions(String(strat.maxPositions ?? 1));
                  setHotStockEnabled(strat.hotStockEnabled || false);
                  setHotStockAllocation(String(strat.hotStockAllocation || 5));
                  setHotStockDetection(strat.hotStockDetectionMode || 'top-scoring');
                  setHotStockMaxHold(String(strat.hotStockMaxHoldHours || 24));
                  if (!name.trim()) setName(strat.name || '');
                }
              }}
              required
            >
              <option value="">— Select a scoring strategy —</option>
              {scoringStrategies.filter(s => s.enabled).map(s => (
                <option key={s.id} value={s.id}>
                  {s.name} — {s.protocolId} @ {s.brokerId || '?'} (threshold: {s.tradeThreshold})
                </option>
              ))}
            </select>
            <span className="ff-hint">
              The scoring strategy's watchlist defines which symbols are traded.
              Protocol and risk defaults are pre-filled automatically.
            </span>
          </label>
        )}

        {/* ── Timeframe (only for protocol path) ── */}
        {creationPath === 'protocol' && (
          <label className="ff-field">
            <span className="ff-label">Timeframe</span>
            <select className="ff-select" value={timeframe} onChange={e => setTimeframe(e.target.value)}>
              {TIMEFRAMES.map(tf => <option key={tf} value={tf}>{tf}</option>)}
            </select>
          </label>
        )}

        {/* ── Broker Account ── */}
        <label className="ff-field">
          <span className="ff-label">Broker Account</span>
          <select className="ff-select" value={brokerId} onChange={e => setBrokerId(e.target.value)}>
            {Object.entries(brokerMap).map(([id, cfg]) => {
              const isCompatible = compatibleBrokers.includes(id);
              return (
                <option key={id} value={id} disabled={!isCompatible}>
                  {id === 'mt5' ? `MT5${mt5Account ? ` (${mt5Account.balance != null ? '$' + mt5Account.balance : 'connected'})` : ''}` :
                   id === 'trading212' ? 'Trading212 (portfolio-monitoring only)' :
                   id === 'capital.com' ? `Capital.com${capitalComAccount?.balance != null ? ` (£${capitalComAccount.balance})` : ' (configured)'}` :
                   'Paper Trading (virtual $10k)'}
                  {!isCompatible ? ' — incompatible' : ''}
                </option>
              );
            })}
          </select>
          <span className="ff-hint">
            {brokerMap[brokerId]?.note}
            {!compatibleBrokers.includes(brokerId) && ' ⚠️ This broker may not support the selected protocol style.'}
          </span>
        </label>

        {/* ── Mode ── */}
        <label className="ff-field">
          <span className="ff-label">Execution Mode</span>
          <select className="ff-select" value={mode} onChange={e => setMode(e.target.value)}>
            <option value="manual">Manual — signals displayed, no automatic action</option>
            <option value="semi-auto">Semi-Auto — trades queued for confirmation</option>
            <option value="auto">Auto — trades execute automatically</option>
          </select>
        </label>

        {/* ── Risk Params ── */}
        <fieldset className="ff-fieldset">
          <legend className="ff-legend">Risk Parameters</legend>
          <div className="ff-row-3">
            <label className="ff-field">
              <span className="ff-label">Base Size (lots)</span>
              <input className="ff-input" type="number" value={baseSize} onChange={e => setBaseSize(e.target.value)} step="0.01" min="0.01" />
            </label>
            <label className="ff-field">
              <span className="ff-label">Stop Loss %</span>
              <input className="ff-input" type="number" value={slPct} onChange={e => setSlPct(e.target.value)} step="0.1" min="0.1" />
            </label>
            <label className="ff-field">
              <span className="ff-label">Take Profit %</span>
              <input className="ff-input" type="number" value={tpPct} onChange={e => setTpPct(e.target.value)} step="0.1" min="0.1" />
            </label>
          </div>
          <label className="ff-field">
            <span className="ff-label">Min Composite Score (% of protocol max)</span>
            <input className="ff-input" type="number" value={minComposite} onChange={e => setMinComposite(e.target.value)} min="0" max="100" />
            <span className="ff-hint">Only trade when composite score exceeds this percentage of the protocol's maximum possible score. E.g., 60 means the protocol must score at least 60% of its theoretical max.</span>
          </label>
          <label className="ff-field">
            <span className="ff-label">Max Pyramid Tiers</span>
            <select className="ff-select" value={maxPyramidTiers} onChange={e => setMaxPyramidTiers(e.target.value)}>
              <option value="1">1 — Single entry only (no pyramid)</option>
              <option value="2">2 — One additional entry</option>
              <option value="3">3 — Two additional entries</option>
              <option value="0">Unlimited — keep adding while signal stays strong</option>
            </select>
            <span className="ff-hint">How many additional entries can be stacked onto a winning position. Default: 1 (no pyramid).</span>
          </label>
          <label className="ff-field">
            <span className="ff-label">SL/TP Inheritance (Pyramid)</span>
            <select className="ff-select" value={slTpInheritance} onChange={e => setSlTpInheritance(e.target.value)}>
              <option value="inherit">Inherit parent — share same SL/TP as original position</option>
              <option value="independent">Independent — each tier gets its own SL/TP</option>
              <option value="tighten">Tighten — each subsequent tier uses tighter SL/TP</option>
            </select>
            <span className="ff-hint">How pyramid entries handle Stop Loss and Take Profit relative to the original position.</span>
          </label>
          <label className="ff-field">
            <span className="ff-label">Max Concurrent Positions</span>
            <select className="ff-select" value={maxPositions} onChange={e => setMaxPositions(e.target.value)}>
              <option value="1">1 — One position per strategy (default)</option>
              <option value="2">2 — Up to 2 concurrent positions</option>
              <option value="3">3 — Up to 3 concurrent positions</option>
              <option value="5">5 — Up to 5 concurrent positions</option>
              <option value="10">10 — Up to 10 concurrent positions</option>
            </select>
            <span className="ff-hint">How many positions this strategy can open simultaneously across different symbols. Default: 1 (single position).</span>
          </label>
          <div className="ff-row-3">
            <label className="ff-field">
              <span className="ff-label">Max Size (lots)</span>
              <input className="ff-input" type="number" value={maxSize} onChange={e => setMaxSize(e.target.value)} step="0.01" min="0" placeholder="Unlimited" />
              <span className="ff-hint">Cap on total position size. Leave empty for no limit.</span>
            </label>
            <label className="ff-field">
              <span className="ff-label">Max Daily Loss ($)</span>
              <input className="ff-input" type="number" value={maxDailyLoss} onChange={e => setMaxDailyLoss(e.target.value)} step="0.01" min="0" placeholder="No limit" />
              <span className="ff-hint">Stop trading if daily loss exceeds this amount.</span>
            </label>
            <label className="ff-field">
              <span className="ff-label">Cooldown (minutes)</span>
              <input className="ff-input" type="number" value={cooldownMinutes} onChange={e => setCooldownMinutes(e.target.value)} min="0" max="1440" />
              <span className="ff-hint">Minimum minutes between trades from this strategy.</span>
            </label>
          </div>
          <div className="ff-row-3">
            <label className="ff-field">
              <span className="ff-label">Min Rarity Band</span>
              <select className="ff-select" value={minRarityBand} onChange={e => setMinRarityBand(e.target.value)}>
                <option value="">— Any —</option>
                <option value="standard">Standard</option>
                <option value="strong">Strong</option>
                <option value="exceptional">Exceptional</option>
                <option value="cyclical">Cyclical</option>
                <option value="black-swan">Black Swan</option>
              </select>
              <span className="ff-hint">Only trade signals at or above this rarity tier.</span>
            </label>
            <label className="ff-field">
              <span className="ff-label">Require Direction</span>
              <select className="ff-select" value={requireDirection} onChange={e => setRequireDirection(e.target.value)}>
                <option value="">— Any —</option>
                <option value="long">Long only</option>
                <option value="short">Short only</option>
              </select>
              <span className="ff-hint">Restrict this strategy to long or short positions only.</span>
            </label>
            <label className="ff-field">
              <span className="ff-label">&nbsp;</span>
              <label className="ff-checkbox-label">
                <input type="checkbox" checked={useRaritySizing} onChange={e => setUseRaritySizing(e.target.checked)} />
                <span className="ff-label">Use rarity-based position sizing</span>
              </label>
              <span className="ff-hint">Scale position size by signal rarity tier.</span>
            </label>
          </div>
          <label className="ff-field">
            <span className="ff-label">Description</span>
            <textarea className="ff-input ff-textarea" rows={2} value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional notes about this strategy..." />
          </label>
        </fieldset>

        {/* ── Hot Stock Picks Integration (#339) ── */}
        <fieldset className="ff-fieldset">
          <legend>🔥 Hot Stock Auto-Discovery</legend>
          <label className="ff-field">
            <span className="ff-label">
              <input type="checkbox" checked={hotStockEnabled} onChange={e => setHotStockEnabled(e.target.checked)} style={{ marginRight: '0.4rem' }} />
              Allow auto-discovery of hot symbols
            </span>
            <span className="ff-hint">When enabled, this strategy can automatically trade hot stock picks detected by the system, in addition to its configured watchlist symbols.</span>
          </label>
          {hotStockEnabled && (
            <>
              <label className="ff-field">
                <span className="ff-label">Hot Stock Allocation (%)</span>
                <input type="number" className="ff-input" value={hotStockAllocation} onChange={e => setHotStockAllocation(e.target.value)} min="1" max="100" />
                <span className="ff-hint">Separate portfolio allocation % for hot stock trades (independent from main strategy allocation).</span>
              </label>
              <label className="ff-field">
                <span className="ff-label">Detection Mode</span>
                <select className="ff-select" value={hotStockDetection} onChange={e => setHotStockDetection(e.target.value)}>
                  <option value="top-scoring">Top Scoring Only — only highest-ranked hot picks</option>
                  <option value="volume-spike">Volume Spike — symbols with unusual volume activity</option>
                  <option value="all">All Detected — any symbol flagged by hot stock detection</option>
                </select>
                <span className="ff-hint">Which hot stock detection methods to trust for automatic trading.</span>
              </label>
              <label className="ff-field">
                <span className="ff-label">Max Hold (hours)</span>
                <input type="number" className="ff-input" value={hotStockMaxHold} onChange={e => setHotStockMaxHold(e.target.value)} min="1" max="168" />
                <span className="ff-hint">Maximum holding period for hot stock positions. Default: 24 hours (shorter than strategy default).</span>
              </label>
            </>
          )}
        </fieldset>

        {/* ── Submit ── */}
        {saveError && <div className="ff-error">❌ {saveError}</div>}
        <button type="submit" className="ff-submit" disabled={saving}>
          {saving ? 'Creating…' : 'Create Strategy'}
        </button>
      </form>
    </main>
  );
}
