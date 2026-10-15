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
// #840 — the above-ceiling rule. Kept in `core/` so it is covered by `node --test` rather than
// living untested inside JSX; see the note where it is used.
import { barAboveCeiling as barAboveCeilingRule, ceilingKnown } from '../core/threshold-ceiling.js';
import LoadingSkeleton from '../components/LoadingSkeleton';
import StrategyWizard from '../components/StrategyBuilder/StrategyWizard';
import { noticeLine } from '../core/notices/registry.js';
// ⚠️ #870 — the SAME enforcement words the truth view uses. Read from `bot-rules`, never restated:
// this form used to offer every behavioural field with no indication that some do nothing at all
// (8 of 29 declared columns had no live reader).
import { useBotRules, BotRuleStatus, EnforcementLegend } from '../core/bot-rule-enforcement.jsx';
import '../core/bot-rule-enforcement.css';
import '../core/forms.css';
import '../components/StrategyBuilder/strategy-wizard.css';
import './strategy-create.css';
import PageInfoPopover from '../components/PageInfoPopover';

const TABS = [
  { id: 'form', label: 'Form', icon: '📝' },
  { id: 'wizard', label: 'Wizard', icon: '🧙' },
];

/**
 * The session tags, mirroring `SessionTag` in `nest/src/modules/trading/session-window.ts`.
 *
 * ⚠️ Kept as a literal list rather than fetched: the server REJECTS an unknown tag when it parses
 * the window, so a tag added there without being added here would be a value the UI cannot offer —
 * a capability no surface reaches. `validate-…` does not police this pair, so the note is the guard.
 */
const SESSION_TAGS = ['asian', 'london', 'us'];

export default function StrategyCreatePage() {
  const [tab, setTab] = useState('form');
  const queryClient = useQueryClient();

  /**
   * #870 — the enforcement registry. One fetch, cached by react-query under `['bot-rules']`, shared
   * with the truth view. `byField` turns the declaration list into a lookup so each field can carry
   * its own marker.
   */
  const { byField: botRuleFields, counts: botRuleCounts } = useBotRules();

  // ── Form state ──
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [brokerId, setBrokerId] = useState('mt5');
  const [protocolId, setProtocolId] = useState('');
  const [mode, setMode] = useState('score');
  const [baseSize, setBaseSize] = useState(0.02);
  const [slPct, setSlPct] = useState(0.5);
  const [tpPct, setTpPct] = useState(1.0);
  const [minComposite, setMinComposite] = useState(null);
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
  // ── Session policy (#928) ──
  // BOTH halves live here. `sessionWindow` (entry) was declared `enforcement: 'live'` but was
  // reachable from NO screen — the only way a bot ever got a window was the seed file — so the
  // exit half would have been unpaired on the only surface that creates a bot.
  const [sessionTags, setSessionTags] = useState([]);
  const [exitBeforeUtc, setExitBeforeUtc] = useState('');
  const [hotStockEnabled, setHotStockEnabled] = useState(false);
  const [hotStockAllocation, setHotStockAllocation] = useState('');
  const [hotStockDetectionMode, setHotStockDetectionMode] = useState('');
  const [hotStockMaxHoldHours, setHotStockMaxHoldHours] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  // ⚠️ REMOVED 2026-10-01 (#870): `const [showHotStock, setShowHotStock] = useState(false)`. It was
  // declared and NEVER read — the section renders on `hotStockEnabled`, not on this flag. Dead state
  // beside a section whose whole problem is that it does nothing was a small joke at the reader's
  // expense; eslint flagged it while this file was being edited.
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
  // ⚠️ THE FIELDS ARE `id` AND `label` — THERE IS NO `name` (measured 2026-10-09, #1098).
  // This list previously rendered `value={w.name}>{w.name}`, and `w.name` is `undefined` for every
  // row, so all ~50 options carried an EMPTY value and EMPTY text: a select holding 50 options that
  // looked completely unpopulated, with no error anywhere. Reported from the walkthrough as "this
  // menu is not populated".
  //
  // ⚠️ `value` must be the **id**, not the label. `readWatchlist(name)` on the backend resolves
  // `WATCHLISTS_DIR/${name}.json`, so the stored `watchlistName` is used as a FILE STEM — submitting
  // the label ("Primary") would look for `Primary.json` and would appear to work only on a
  // case-insensitive filesystem. The label is what a human should READ, hence id-as-value.
  // The filter drops malformed rows so one bad item cannot render a blank option.
  const wlList = useMemo(() => {
    const raw = watchlists?.watchlists || watchlists || [];
    return (Array.isArray(raw) ? raw : []).filter((w) => w && (w.id || w.label));
  }, [watchlists]);

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

  /**
   * The bot strength bar — READ from the server, never remembered here.
   *
   * ⚠️ WHY THIS IS A FETCH AND NOT A CONSTANT (#839).
   *
   * The backend owns this value (`nest/src/common/utils/style-thresholds.ts`, rescaled
   * 2026-09-15). When the frontend kept its own copy, the rescale updated the owner and left the
   * copy behind — and a bot created here silently never traded, because its bar was ~2x the
   * maximum the scoring scale can produce.
   *
   * `preTradeGate.default` is the server's own fallback bar, so it is always clearable by
   * construction. A form field whose blank value means "an unclearable bot" is a trap; seeding it
   * from the server removes the trap rather than documenting it.
   */
  const thresholdsQuery = useQuery({
    queryKey: ['scoring-thresholds'],
    queryFn: () => apiGet('/api/scoring/gated/thresholds'),
    staleTime: 5 * 60_000,
    retry: 1,
  });
  const serverBarDefault = thresholdsQuery.data?.preTradeGate?.default ?? null;

  /**
   * The selected protocol's measured CEILING — the highest percentage it has ever achieved (#840).
   *
   * ⚠️ WHY THIS WARNS INSTEAD OF BLOCKING. #839 removed the *default* trap (a blank field no longer
   * means an unclearable bot), but nothing stopped a user TYPING 65. A bar above the protocol's
   * all-time maximum is one it has never cleared, so the bot would look active, report no error, and
   * never trade — the same silent failure, reached deliberately rather than by accident.
   *
   * It must not BLOCK, though: #817 says bars should be raised from measured outcomes, and a user
   * may legitimately set a bar above current capacity for a protocol they expect to improve. So this
   * names the two numbers and lets them decide.
   */
  const protocolCeiling = useMemo(() => {
    const map = thresholdsQuery.data?.protocolCeilings;
    if (!map) return null;
    // The map is keyed by protocol SLUG (`score.strategyId`), while the select stores `id || slug`.
    // Try both rather than assuming one — a UUID key would silently find nothing and the warning
    // would never appear, which looks exactly like "no problem to report".
    for (const key of [selectedProto?.slug, selectedProto?.id, protocolId]) {
      if (key && map[key]) return map[key];
    }
    return null;
  }, [thresholdsQuery.data, selectedProto, protocolId]);

  const barAboveCeiling = useMemo(() => {
    if (!protocolCeiling || minComposite == null || minComposite === '') return null;
    // The rule lives in `core/threshold-ceiling.js` — PURE, and covered by `node --test`.
    // ⚠️ It is NOT written inline here on purpose: the three conditions were got wrong once in JSX
    // (a `ceilingPct`/`ceiling` field mix-up rendered the number as blank), and JSX has no test
    // harness in this project to catch that. Pure logic goes where it can be tested.
    return barAboveCeilingRule(protocolCeiling, minComposite);
  }, [protocolCeiling, minComposite]);

  // Seed the field once the server value arrives, but never clobber a value the user has typed.
  useEffect(() => {
    if (minComposite == null && serverBarDefault != null) setMinComposite(serverBarDefault);
  }, [serverBarDefault, minComposite]);

  const brokerCompatible = useMemo(() => {
    if (!brokerCfg) return true;
    const styleOk = brokerCfg.supportedStyles.includes(
      selectedProto?.tradingStyle || selectedProto?.style || 'swing'
    );
    const assetOk = brokerCfg.supportedAssetTypes.includes(assetType);
    return { styleOk, assetOk, ok: styleOk && assetOk };
  }, [brokerCfg, selectedProto, assetType]);

  // ── Apply style defaults ──
  //
  // ⚠️ `minComposite` is deliberately NOT set from here any more (#839).
  //
  // This function used to read `STYLE_DEFAULTS[style].minComposite` — a frontend copy of the
  // backend style table. Two problems, both real:
  //   1. The copy was missed by the 2026-09-15 rescale, so it held 55-75 while the live scale
  //      tops out at ~33. Any bot created from it could never clear its own bar.
  //   2. The keys never matched anyway: `STYLE_DEFAULTS['Swing / Position']` is `undefined`, so
  //      the lookup returned early and the form kept its hardcoded `useState(65)`. The style path
  //      therefore never applied — 65 was the only value this form ever submitted.
  //
  // The bar now comes from the ONE owner via the API (see the thresholds effect below). Size and
  // SL/TP stay local — they are risk parameters, not capability thresholds, and were never rescaled.
  const applyStyleDefaults = (style) => {
    const d = STYLE_DEFAULTS[style];
    if (!d) return;
    setBaseSize(d.baseSize);
    setSlPct(d.slPct);
    setTpPct(d.tpPct);
    setTimeframe(d.timeframe);
  };

  useEffect(() => {
    if (selectedProto?.tradingStyle) {
      applyStyleDefaults(selectedProto.tradingStyle);
    }
  }, [protocolId]);

  // ── Submit ──
  // ── PLANNED IN #1123 ──
  // MISSING:    a bot created here gets NO `strategy_protocol` subscription, so it is never
  //             queued and never trades. It renders active, produces nothing, and reports no error.
  // TODAY:      `POST /api/trading/strategies/:id/protocols` → `addProtocolSubscription()`
  //             (trading-strategy.controller.ts L192-195, #712) exists, and NO page in `src/`
  //             calls it. This form posts the bot only.
  // WHEN BUILT: add a protocol picker here and write through that endpoint; show subscription
  //             state on the bot list so a bot that cannot trade is visible as a defect.
  // ⚠️ Routing is by SUBSCRIPTION, not by the bot — see `database-seed-discipline.instructions.md`.
  const createMutation = useMutation({
    mutationFn: (body) => apiPost('/api/trading/strategies', body),
    onSuccess: () => {
      setMsg('✅ Strategy created!');
      queryClient.invalidateQueries({ queryKey: ['strategies-list'] });
      queryClient.invalidateQueries({ queryKey: ['monitor-strategies'] });
    },
    onError: (err) => setMsg('❌ ' + noticeLine('TCS-SYS-007', { operation: 'create the strategy', detail: err })),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim()) { setMsg('❌ Name is required'); return; }
    // ⚠️ The SERVER is authoritative (`parseExitBoundary` in session-window.ts refuses anything
    // that is not HH:MM and triggers no close). This check exists only so a typo is caught while
    // the operator is looking at the field, instead of creating a bot whose exit gate is silently
    // inert. The pattern MIRRORS the server's, and deliberately accepts `9:30` — a stricter copy
    // here would reject a value the engine happily honours, which is the worse disagreement.
    const boundary = exitBeforeUtc.trim();
    if (boundary && !/^(\d{1,2}):(\d{2})$/.test(boundary)) {
      setMsg('❌ Exit before must be HH:MM in UTC (e.g. 13:30), or empty for no boundary.');
      return;
    }
    if (boundary) {
      const [h, m] = boundary.split(':').map(Number);
      if (h > 23 || m > 59) {
        setMsg('❌ Exit before must be a real UTC time — hours 00-23, minutes 00-59.');
        return;
      }
    }
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
      // #928 — JSON array, or null when ungated. `parseSessionWindow` on the server reads BOTH the
      // JSON-array and the bare-string form (`london`), so a bot created here and one seeded as a
      // bare string are the same configuration — which is why the write form is not a third one.
      sessionWindow: sessionTags.length ? JSON.stringify(sessionTags) : null,
      exitBeforeUtc: boundary || null,
      hotStockEnabled,
      hotStockAllocation: hotStockAllocation ? Number(hotStockAllocation) : undefined,
      hotStockDetectionMode: hotStockDetectionMode || undefined,
      hotStockMaxHoldHours: hotStockMaxHoldHours ? Number(hotStockMaxHoldHours) : undefined,
    });
  };

  // ── Render ─────────────────────────────────────────────

  return (
    <div className="stratcreate-page">
      <motion.header className="stratcreate-header" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <div>
          <h1>Create Bot
          <PageInfoPopover>
            Form or wizard — configure a new TRADING BOT. A bot is the execution policy (sizing, risk,
            entry/exit rules); the signal thesis comes from the protocol it subscribes to. See
            docs/trading-bot-model.md.
          </PageInfoPopover>
        </h1>
        </div>
      </motion.header>

      {/* Tabs */}
      <div className="stratcreate-tabs">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`stratcreate-tab ${tab === t.id ? 'stratcreate-tab-active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* ── Form Tab ── */}
      {tab === 'form' && (
        <motion.div className="stratcreate-tab-content" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
          {protoLoading ? <LoadingSkeleton variant="text" lines={4} /> : (
            <form className="stratcreate-form" onSubmit={handleSubmit}>
              {/* #870 — say up front that the markers exist and what they mean. Without this the
                  chips read as decoration; with it, "NOT APPLIED" beside Hot Stock Allocation is
                  the answer to the question the field's own label implies. */}
              <EnforcementLegend counts={botRuleCounts} />

              {/* Name + Mode */}
              <div className="stratcreate-field-row">
                <label className="stratcreate-field">
                  <span>Strategy Name * <BotRuleStatus field="name" byField={botRuleFields} /></span>
                  <input
                    className="stratcreate-input" type="text" placeholder="e.g. Gold Scalp v2"
                    value={name} onChange={e => setName(e.target.value)}
                  />
                </label>
                <label className="stratcreate-field">
                  <span>Mode <BotRuleStatus field="mode" byField={botRuleFields} /></span>
                  <select className="stratcreate-input" value={mode} onChange={e => { setMode(e.target.value); if (e.target.value === 'score') setSymbol(''); }}>
                    <option value="trade">Trade (single symbol)</option>
                    <option value="score">Score (watchlist)</option>
                  </select>
                </label>
              </div>

              {/* Symbol or Watchlist */}
              <div className="stratcreate-field-row">
                {mode === 'trade' ? (
                  <label className="stratcreate-field">
                    <span>Symbol <BotRuleStatus field="symbol" byField={botRuleFields} /></span>
                    <input
                      className="stratcreate-input" type="text" placeholder="e.g. XAUUSD"
                      value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())}
                    />
                    {symbol && (
                      <span className="stratcreate-hint">Asset type: {assetType}</span>
                    )}
                  </label>
                ) : (
                  <label className="stratcreate-field">
                    <span>Watchlist</span>
                    <select className="stratcreate-input" value={watchlistName} onChange={e => setWatchlistName(e.target.value)}>
                      <option value="">— Select —</option>
                      {wlList.map(w => (
                        <option key={w.id || w.label} value={w.id}>{w.label || w.id}</option>
                      ))}
                    </select>
                    {/* ⚠️ An empty list must SAY it is empty. The API call above swallows its own error
                        (`.catch(() => ({watchlists: []}))`), so a failure and a genuinely empty list
                        are indistinguishable — and an unpopulated menu with no message is exactly
                        the defect this control was reported for. */}
                    {wlList.length === 0 && (
                      <span className="stratcreate-hint">No watchlists were returned — the list could not be loaded, or none exist yet.</span>
                    )}
                  </label>
                )}
                <label className="stratcreate-field">
                  <span>Broker <BotRuleStatus field="brokerId" byField={botRuleFields} /></span>
                  <select className="stratcreate-input" value={brokerId} onChange={e => setBrokerId(e.target.value)}>
                    {BROKER_LIST.map(b => (
                      <option key={b} value={b}>{b.toUpperCase()}</option>
                    ))}
                  </select>
                  {brokerCfg && (
                    <span className="stratcreate-hint">{brokerCfg.note}</span>
                  )}
                </label>
              </div>

              {/* Protocol */}
              <label className="stratcreate-field">
                <span>Protocol <BotRuleStatus field="protocolId" byField={botRuleFields} /></span>
                <select className="stratcreate-input" value={protocolId} onChange={e => setProtocolId(e.target.value)}>
                  <option value="">— Select —</option>
                  {protoList.map(p => (
                    <option key={p.id || p.slug} value={p.id || p.slug}>
                      {p.name || p.id} {p.tradingStyle ? `(${p.tradingStyle})` : ''}
                    </option>
                  ))}
                </select>
                {/* Same rule as the watchlist select: an empty menu states that it is empty. */}
                {protoList.length === 0 && !protoLoading && (
                  <span className="stratcreate-hint">No protocols were returned — the list could not be loaded, or none are registered.</span>
                )}
              </label>

              {/* Broker compatibility */}
              {protocolId && symbol && (
                <div className={`stratcreate-compat ${brokerCompatible.ok ? 'stratcreate-compat-ok' : 'stratcreate-compat-warn'}`}>
                  {brokerCompatible.ok
                    ? '✅ Broker compatible with protocol style and asset type'
                    : `⚠️ Broker may not support this: style=${!brokerCompatible.styleOk ? '✗' : '✓'}, asset=${!brokerCompatible.assetOk ? '✗' : '✓'}`}
                </div>
              )}

              {/* Risk params */}
              <div className="stratcreate-section-label">Risk Parameters</div>
              <div className="stratcreate-field-row stratcreate-field-row-4">
                <label className="stratcreate-field">
                  <span>Base Size <BotRuleStatus field="baseSize" byField={botRuleFields} /></span>
                  <input className="stratcreate-input" type="number" step="0.01" min="0.01" value={baseSize} onChange={e => setBaseSize(Number(e.target.value))} />
                </label>
                <label className="stratcreate-field">
                  <span>SL % <BotRuleStatus field="slPct" byField={botRuleFields} /></span>
                  <input className="stratcreate-input" type="number" step="0.1" min="0.1" value={slPct} onChange={e => setSlPct(Number(e.target.value))} />
                </label>
                <label className="stratcreate-field">
                  <span>TP % <BotRuleStatus field="tpPct" byField={botRuleFields} /></span>
                  <input className="stratcreate-input" type="number" step="0.1" min="0.1" value={tpPct} onChange={e => setTpPct(Number(e.target.value))} />
                </label>
                <label className="stratcreate-field">
                  <span>Min Composite <BotRuleStatus field="minComposite" byField={botRuleFields} /></span>
                  {/* ⚠️ Bounds were min="40" max="95" (#839). The state now seeds from the server
                      (serverBarDefault = BOT_BAR_DEFAULT, 10), but the OLD bounds would have
                      rejected it: a corrected default of 10 cannot be entered into a field whose
                      minimum is 40, so the fix above was not reachable through this input.
                  
                      ⚠️ aria-label IS NOT REDUNDANT. The warning below sits inside this <label>, so
                      without it the accessible NAME became "Min Composite ⚠️ 65 is above the highest
                      this protocol has ever reached (…)" — a form control's name should be short, and
                      a screen-reader user would hear the whole sentence before reaching the field.
                      The explicit name keeps the control's identity brief; `aria-describedby` below
                      still attaches the warning as the DESCRIPTION, which is what it is. */}
                  <input
                    className="stratcreate-input" type="number" min="0" max="100"
                    value={minComposite}
                    onChange={e => setMinComposite(Number(e.target.value))}
                    aria-label="Min Composite"
                    aria-describedby={barAboveCeiling || ceilingKnown(protocolCeiling)
                      ? 'min-composite-ceiling' : undefined}
                  />
                  {/* #840 — the warning, not a block. Names both numbers so the user can judge. */}
                  {barAboveCeiling && (
                    <span id="min-composite-ceiling" className="stratcreate-hint stratcreate-hint-warn" role="status">
                      ⚠️ {barAboveCeiling.bar} is above the highest this protocol has ever reached
                      ({barAboveCeiling.ceiling}% over {barAboveCeiling.samples.toLocaleString()} readings).
                      A bot with this bar would probably never trade. You can still save it.
                    </span>
                  )}
                  {!barAboveCeiling && ceilingKnown(protocolCeiling) && (
                    <span id="min-composite-ceiling" className="stratcreate-hint">
                      This protocol's highest recorded result is {protocolCeiling.ceilingPct}%.
                    </span>
                  )}
                </label>
              </div>

              <label className="stratcreate-field">
                <span>Timeframe <BotRuleStatus field="timeframe" byField={botRuleFields} /></span>
                <select className="stratcreate-input" value={timeframe} onChange={e => setTimeframe(e.target.value)}>
                  {['5s','15s','1m','5m','15m','1h','4h','1d'].map(tf => (
                    <option key={tf} value={tf}>{tf}</option>
                  ))}
                </select>
              </label>

              {/* Description */}
              <label className="stratcreate-field">
                <span>Description <BotRuleStatus field="description" byField={botRuleFields} /></span>
                <textarea
                  className="stratcreate-input stratcreate-textarea" rows={2} placeholder="Optional notes about this strategy..."
                  value={description} onChange={e => setDescription(e.target.value)}
                />
              </label>

              {/* ── Signal Filters (collapsible) ── */}
              <button type="button" className="stratcreate-section-toggle" onClick={() => setShowAdvanced(!showAdvanced)}>
                {showAdvanced ? '▾' : '▸'} Advanced Settings
              </button>
              {showAdvanced && (
                <div className="stratcreate-advanced-grid">
                  <div className="stratcreate-section-label">Signal Filters</div>
                  <div className="stratcreate-field-row">
                    <label className="stratcreate-field">
                      <span>Min Rarity Band <BotRuleStatus field="minRarityBand" byField={botRuleFields} /></span>
                      <select className="stratcreate-input" value={minRarityBand} onChange={e => setMinRarityBand(e.target.value)}>
                        <option value="">— Any —</option>
                        {['standard','strong','exceptional','cyclical','black-swan'].map(b => (
                          <option key={b} value={b}>{b}</option>
                        ))}
                      </select>
                    </label>
                    <label className="stratcreate-field">
                      <span>Require Direction <BotRuleStatus field="requireDirection" byField={botRuleFields} /></span>
                      <select className="stratcreate-input" value={requireDirection} onChange={e => setRequireDirection(e.target.value)}>
                        <option value="">— Any —</option>
                        <option value="long">Long only</option>
                        <option value="short">Short only</option>
                      </select>
                    </label>
                  </div>

                  {/* ── Position & Risk Management ── */}
                  <div className="stratcreate-section-label">Position & Risk Management</div>
                  <div className="stratcreate-field-row stratcreate-field-row-4">
                    <label className="stratcreate-field">
                      <span>Max Positions <BotRuleStatus field="maxPositions" byField={botRuleFields} /></span>
                      <input className="stratcreate-input" type="number" min="1" max="20" value={maxPositions} onChange={e => setMaxPositions(Number(e.target.value))} />
                      {/* ⚠️ #870 / #733 — the dangerous one. The LIVE cap is the GLOBAL
                          `risk.maxOpenPositions` setting; this per-bot value does not cap anything
                          on the automation loop. Saying so here is the whole point: a user who sets
                          1 and believes they are capped has a risk control that is not applied. */}
                      <span className="stratcreate-hint stratcreate-hint-warn">
                        The cap that is applied live is the GLOBAL <code>risk.maxOpenPositions</code>{' '}
                        setting. This per-bot value is not checked on the automation loop.
                      </span>
                    </label>
                    <label className="stratcreate-field">
                      <span>Max Size <BotRuleStatus field="maxSize" byField={botRuleFields} /></span>
                      <input className="stratcreate-input" type="number" step="0.01" min="0" placeholder="e.g. 0.5" value={maxSize} onChange={e => setMaxSize(e.target.value)} />
                    </label>
                    <label className="stratcreate-field">
                      <span>Max Daily Loss ($) <BotRuleStatus field="maxDailyLoss" byField={botRuleFields} /></span>
                      <input className="stratcreate-input" type="number" step="0.01" min="0" placeholder="e.g. 500" value={maxDailyLoss} onChange={e => setMaxDailyLoss(e.target.value)} />
                    </label>
                    <label className="stratcreate-field">
                      <span>Cooldown (min) <BotRuleStatus field="cooldownMinutes" byField={botRuleFields} /></span>
                      <input className="stratcreate-input" type="number" min="0" max="1440" value={cooldownMinutes} onChange={e => setCooldownMinutes(Number(e.target.value))} />
                    </label>
                  </div>
                  <label className="stratcreate-field stratcreate-checkbox-field">
                    <label className="stratcreate-checkbox-label">
                      <input type="checkbox" checked={useRaritySizing} onChange={e => setUseRaritySizing(e.target.checked)} />
                      <span>Use rarity-based position sizing <BotRuleStatus field="useRaritySizing" byField={botRuleFields} /></span>
                    </label>
                  </label>

                  {/* ── Session Policy (#928) ── */}
                  {/* ⚠️ THE TWO HALVES ARE OFFERED TOGETHER ON PURPOSE. `sessionWindow` gates ENTRY
                      (Gate 5) and `exitBeforeUtc` gates HOLDING (Gate 7). Shipping the exit half
                      alone would let an operator say "flat by 13:30" without being able to say
                      "only trade asian" — half a policy, on the one screen that makes bots. */}
                  <div className="stratcreate-section-label">Session Policy</div>
                  <div className="stratcreate-field-row stratcreate-field-row-2">
                    <label className="stratcreate-field">
                      <span>Session Window (entry) <BotRuleStatus field="sessionWindow" byField={botRuleFields} /></span>
                      <div className="stratcreate-tag-row">
                        {SESSION_TAGS.map(tag => (
                          <label key={tag} className="stratcreate-checkbox-label">
                            <input
                              type="checkbox"
                              checked={sessionTags.includes(tag)}
                              onChange={e => setSessionTags(prev =>
                                e.target.checked ? [...prev, tag] : prev.filter(t => t !== tag))}
                            />
                            <span>{tag}</span>
                          </label>
                        ))}
                      </div>
                      {/* An empty list is a REAL declared state, not missing data — the engine reads
                          NULL as "may open at any hour". Saying so beats an unexplained blank. */}
                      <span className="stratcreate-hint">
                        Tags this bot may OPEN in. None ticked = may open at any hour (ungated).
                      </span>
                    </label>
                    <label className="stratcreate-field">
                      <span>Exit Before (UTC) <BotRuleStatus field="exitBeforeUtc" byField={botRuleFields} /></span>
                      <input
                        className="stratcreate-input"
                        type="text"
                        inputMode="numeric"
                        placeholder="e.g. 13:30"
                        value={exitBeforeUtc}
                        onChange={e => setExitBeforeUtc(e.target.value)}
                      />
                      <span className="stratcreate-hint">
                        <code>HH:MM</code> UTC. Past this time the bot closes and stops holding.
                        Empty = holds through any time.
                      </span>
                      {/* ⚠️ #928 — the measurement, stated where the choice is made. A blanket
                          version of this rule did NOT pay: replaying 228 real trades closed before
                          13:30 gained +0.045pp on the mean while CUTTING 23 winners. Offering it
                          without that sentence invites the reader to assume it is an improvement. */}
                      <span className="stratcreate-hint stratcreate-hint-warn">
                        ⚠️ Opt-in policy, not a fix: closing before 13:30 measured 23 winners cut for
                        +0.045pp. Use it where being flat over a boundary is the point.
                      </span>
                    </label>
                  </div>

                  {/* ── Hot Stock Picks ── */}
                  <div className="stratcreate-section-label">Hot Stock Picks (#339)</div>
                  {/* ⚠️ #870 — stated plainly, not only as a chip. This was the sharpest case in the
                      issue: a labelled section, a checkbox and a reveal-on-tick sub-form, where the
                      user ticks the box, fills in the allocation, and NOTHING HAPPENS. The four
                      hotStock columns have NO READER ANYWHERE. Removing the section is a product
                      decision (#339), so the honest thing is to say so where it is offered. */}
                  <span className="stratcreate-hint stratcreate-hint-warn">
                    ⚠️ These four settings are saved but read by NOTHING — no code applies them to a
                    trade. They are declared <code>enforcement: none</code> in <code>bot-rules.ts</code>.
                    See #339.
                  </span>
                  <label className="stratcreate-field stratcreate-checkbox-field">
                    <label className="stratcreate-checkbox-label">
                      <input type="checkbox" checked={hotStockEnabled} onChange={e => setHotStockEnabled(e.target.checked)} />
                      <span>Enable hot stock picks <BotRuleStatus field="hotStockEnabled" byField={botRuleFields} /></span>
                    </label>
                  </label>
                  {hotStockEnabled && (
                    <div className="stratcreate-field-row stratcreate-field-row-3">
                      <label className="stratcreate-field">
                        <span>Hot Stock Allocation % <BotRuleStatus field="hotStockAllocation" byField={botRuleFields} /></span>
                        <input className="stratcreate-input" type="number" step="0.1" min="0" max="100" placeholder="e.g. 10" value={hotStockAllocation} onChange={e => setHotStockAllocation(e.target.value)} />
                      </label>
                      <label className="stratcreate-field">
                        <span>Detection Mode <BotRuleStatus field="hotStockDetectionMode" byField={botRuleFields} /></span>
                        <select className="stratcreate-input" value={hotStockDetectionMode} onChange={e => setHotStockDetectionMode(e.target.value)}>
                          <option value="">— Select —</option>
                          <option value="top-scoring">Top Scoring</option>
                          <option value="volume-spike">Volume Spike</option>
                          <option value="all">All</option>
                        </select>
                      </label>
                      <label className="stratcreate-field">
                        <span>Max Hold (hours) <BotRuleStatus field="hotStockMaxHoldHours" byField={botRuleFields} /></span>
                        <input className="stratcreate-input" type="number" min="1" max="168" placeholder="24" value={hotStockMaxHoldHours} onChange={e => setHotStockMaxHoldHours(e.target.value)} />
                      </label>
                    </div>
                  )}
                </div>
              )}

              {/* Submit */}
              <div className="stratcreate-actions">
                <button type="submit" className="stratcreate-btn-primary" disabled={createMutation.isPending}>
                  {createMutation.isPending ? '⏳ Creating...' : 'Create Bot'}
                </button>
                {msg && <span className={`stratcreate-msg ${msg.startsWith('✅') ? 'stratcreate-msg-ok' : 'stratcreate-msg-err'}`}>{msg}</span>}
              </div>
            </form>
          )}
        </motion.div>
      )}

      {/* ── Wizard Tab ── */}
      {tab === 'wizard' && (
        <motion.div className="stratcreate-tab-content" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
          <StrategyWizard />
        </motion.div>
      )}
    </div>
  );
}
