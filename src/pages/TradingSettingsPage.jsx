import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPut } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import ApiOfflineBanner from '../components/ApiOfflineBanner';
import PageInfoPopover from '../components/PageInfoPopover';
import NoticeBlock from '../components/NoticeBlock';
import { noticeFromError } from '../core/notices/from-error.js';
import MetaStackLayerSwitch from '../components/MetaStackLayerSwitch';
import { BotBarsTable } from '../components/ScoringThresholds';
import { SettingRow, SettingsSection, MovedNote } from '../components/SettingsControls';
import { usePreferences } from '../core/hooks/usePreferences';
// ⚠️ `./settings.css` ONLY — deliberately.
//
// This page used to import `./trading-settings.css`, which defined `.ts-page`,
// `.ts-header`, `.ts-card` and `.ts-grid`. So did `trading-styles.css` and
// `metastack-cockpit.css` (was `triple-screen.css`) — three stylesheets, one prefix, and ALL of them load globally, so
// only one rule could win and the page was styled almost entirely by two OTHER pages:
//
//   measured on /settings/trading-settings before this change:
//     .ts-page  background rgb(8,8,13)   ← metastack-cockpit.css  (--bg, not the panel surface)
//               display flex, min-height 780px, max-width 900px
//     .ts-grid  display flex             ← trading-styles.css (so grid-template-columns
//               with grid-template-columns still declared but INERT — the three trade
//               default fields stacked vertically instead of forming a row)
//     .ts-header margin-bottom 16px      ← trading-styles.css (this page asked for 20px)
//
// Nothing this page declared was reaching the DOM. Deleting the stylesheet and using the
// shared `settings-page` scaffolding removes the collision and the whole class of it —
// a page cannot collide with a prefix it no longer defines. See settings.css for the
// primitives (`SettingRow`, `.settings-input`, `.cta`, `.settings-ok`).
import './settings.css';

/**
 * TradingSettingsPage — BOTS, their bars, their defaults, and the risk limits they run under.
 * (#720 initial page, extended by §617.)
 *
 * ⚠️ FRAMING — there are MANY bots, and the user creates more.
 *   Each trading setup (a symbol + strategy + bar) is its own bot. This page is where a bot's
 *   behaviour is configured, which is why "Bot settings" landed here rather than on a page
 *   called "Bot & Automation" — that name implied a single bot, and would have been wrong the
 *   moment a second bot existed.
 *
 *   The loop that RUNS the bots, and the queue that paces them, are on Automation. This page
 *   governs what a bot does when the loop reaches it.
 *
 * ⚠️ One source of truth, two entry points: Settings → Trading and Trading → Settings both
 *   render this same page (view id `trading-settings`, registered twice in nav-tree under
 *   different areas at different labels). That duplication is deliberate — a user looking for
 *   "settings" from either direction should land here.
 *
 * ⚠️ STYLING CONTRACT: this page must stay on the shared settings vocabulary so it looks
 *   identical to General / Appearance / Scoring / Automation. If a control genuinely needs a
 *   new look, add it to `settings.css` under a `settings-` name — do NOT introduce a
 *   page-specific prefix. A second prefix is how the three-way `.ts-*` collision began.
 */

const FIELDS = [
  { key: 'size', label: 'Position size', unit: 'lots', step: 0.01, min: 0.001, max: 100, hint: 'Lots. Used when a Signals card places a manual trade without a size. The server-enforced hard cap still applies — see Risk Limits below.' },
  { key: 'slPct', label: 'Stop loss', unit: '%', step: 0.5, min: 0, max: 50, hint: 'Stop loss as a percentage of entry. 0 means no stop is attached by default.' },
  { key: 'tpPct', label: 'Take profit', unit: '%', step: 0.5, min: 0, max: 100, hint: 'Take profit as a percentage of entry. Measured: no closed bot trade has reached its take profit yet, so treat this as untested in practice.' },
];

/**
 * ManualTradeDefaults — values applied when a Signals card places a manual trade without
 * explicit size / SL / TP. Persisted in `global_setting` via /api/signals/trade-defaults,
 * read at ORDER TIME (not at boot), so a save affects the next manual trade with no restart.
 */
function ManualTradeDefaults() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState({ size: '0.01', slPct: '2', tpPct: '4' });
  const [saved, setSaved] = useState(false);

  const defaultsQuery = useQuery({
    queryKey: ['manual-trade-defaults'],
    queryFn: () => apiGet('/api/signals/trade-defaults'),
  });

  // Sync draft once the persisted values load (and on refetch).
  useEffect(() => {
    if (defaultsQuery.data) {
      setDraft({
        size: String(defaultsQuery.data.size),
        slPct: String(defaultsQuery.data.slPct),
        tpPct: String(defaultsQuery.data.tpPct),
      });
    }
  }, [defaultsQuery.data]);

  const saveMutation = useMutation({
    mutationFn: (values) => apiPut('/api/signals/trade-defaults', values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manual-trade-defaults'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  const submit = (e) => {
    e.preventDefault();
    saveMutation.mutate({
      size: parseFloat(draft.size),
      slPct: parseFloat(draft.slPct),
      tpPct: parseFloat(draft.tpPct),
    });
  };

  if (defaultsQuery.isLoading) return <LoadingSkeleton variant="card" count={1} />;

  return (
    <>
      {defaultsQuery.isError && <ApiOfflineBanner />}

      {/* No <motion.form> and no card: the rows below are the same `setting-row` markup
          General / Appearance / Scoring use, so this section is visually identical to
          theirs. The card was the only reason this page needed its own stylesheet. */}
      <form onSubmit={submit}>
        {FIELDS.map((f) => (
          <SettingRow
            key={f.key}
            label={f.label}
            hint={f.hint}
          >
            <input
              type="number"
              step={f.step}
              min={f.min}
              max={f.max}
              aria-label={`${f.label} in ${f.unit}`}
              className="settings-input settings-input-sm"
              value={draft[f.key]}
              onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
            />
          </SettingRow>
        ))}

        <SettingRow
          label="Save"
          hint="Read at order time, so a save affects the next manual trade immediately — no restart needed."
        >
          <div className="inline-actions">
            <button type="submit" className="cta" disabled={saveMutation.isPending}>
              {saveMutation.isPending ? 'Saving…' : 'Save defaults'}
            </button>
            {/* ⚠️ The tick and the word carry the meaning; `.settings-ok` only reinforces
                them. Colour alone must never be the signal (WCAG 1.4.1). */}
            {saved && <span className="settings-ok">✓ Saved</span>}
          </div>
        </SettingRow>
      </form>

      {saveMutation.isError && (
        <NoticeBlock notice={noticeFromError(saveMutation.error, 'TCS-SYS-007', { operation: 'save the trading settings' })} compact />
      )}

      <p className="settings-note">
        Stored in <code>global_setting</code>, so a reinstall restores it from the seed.
      </p>
    </>
  );
}

/**
 * RiskLimits — the preference-backed limits, plus the server-enforced hard limits.
 *
 * ⚠️ These are DUPLICATED BY DESIGN (§617 decision). The same preferences also appear on the
 *   User Preferences page, and the server-enforced values are fixed in `nest/.env`.
 *   Seeing the limits here — on the page where a bot's size is set — is the point: a limit
 *   that only exists on a different page is a limit nobody checks before raising a position.
 *
 * ⚠️ The two blocks are NOT the same kind of thing, and the page says so:
 *   - "Risk Limits" are CLIENT preferences in localStorage. A strategy or the UI can change
 *     them, and they do not constrain the server.
 *   - "Server-Enforced Hard Limits" are read LIVE from the database (`global_setting`, keys `risk.*`)
 *     by the backend, and cannot be overridden by anything in the app.
 *
 *     ⚠️ CORRECTED 2026-09-19 (#901): "no restart needed" is true of the BACKEND check and FALSE
 *     of the MT5 bridges, which read their own copies (`MT5_MAX_OPEN_POSITIONS`,
 *     `MT5_MAX_POSITION_SIZE`) from `nest/.env` at IMPORT — restart-bound. The run-on sentence
 *     that used to live here ("They are no longer .env values, so they no longer need a
 *     restart") was wrong in exactly the way this page's Max Open Positions hint was: it made a
 *     factual claim about a second control it did not know existed. The LOWER of the app cap and
 *     the bridge cap binds; the health page's Risk Cap Alignment check reports divergence.
 *
 * ⚠️ #863 (2026-09-17 → fixed 2026-09-18): the `Max Positions` field used to write a CLIENT
 * preference stored in **localStorage**, which the backend never reads. A user set it to 20, the UI
 * confirmed the save, and 5 (the enforced `risk.maxOpenPositions`) stayed in force. The page then
 * displayed BOTH numbers in one panel — two values for one rule, with no way to tell which was real.
 *
 * It now reads and writes `risk.maxOpenPositions` through `ServerNumberInput`, so there is exactly
 * one number and it is the one the backend uses. The old read-only comparison row is gone with it.
 *
 * ⚠️ `Max Per Symbol (%)` was the same lie and is now read-only on purpose: the stored value is a
 * FRACTION (0.25) while the display is a PERCENT (25%), and an editable control that converts units
 * on a money path is a defect waiting to happen. The other CLIENT rows below (drawdown, per-trade
 * risk, circuit-breaker triggers) are still local preferences and are labelled as such.
 */
/**
 * ServerNumberInput — a number that writes a SERVER setting, and says so.
 *
 * ⚠️ WHY THIS EXISTS (2026-09-18). Before it, `Max Positions` on this page wrote
 * `prefs.riskMaxPositions` — a **localStorage** value. The save succeeded, the UI confirmed it, and
 * nothing enforced it: the backend has only ever read `risk.maxOpenPositions` from `global_setting`.
 * Measured consequence: a user set 20, and 5 remained in force. The page then displayed BOTH numbers
 * at once, in one panel, which is the worst form of the defect — two values for one rule, no way to
 * tell which is real.
 *
 * So this control does three things the old one could not:
 *   1. it reads the value the BACKEND is using, not a local copy;
 *   2. it writes that same value, live, with no restart (`PUT /settings/registry/<key>`);
 *   3. it shows what happened — saving, saved, or the server's refusal.
 *
 * ⚠️ The draft is local and commits on blur/Enter, NOT on every keystroke. A PUT per keypress would
 * write "2" on the way to "20" and the cap would briefly be 2 — on a live trading system that is a
 * real, if short, change to how many positions may open.
 */
function ServerNumberInput({ settingKey, value, min, max, step = 1, unit = '', queryKey = ['trading-risk-limits'] }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState(value == null ? '' : String(value));
  const [status, setStatus] = useState(null); // null | 'saving' | 'saved' | 'error'
  const [errorText, setErrorText] = useState('');

  // Follow the server when it changes underneath us (another tab, another page) — but the input is
  // the source while the user is typing, so this only re-syncs when `value` itself moves.
  useEffect(() => { setDraft(value == null ? '' : String(value)); }, [value]);

  const save = useMutation({
    mutationFn: (v) => apiPut(`/api/system/settings/registry/${settingKey}`, { value: v }),
    onSuccess: () => {
      setStatus('saved');
      qc.invalidateQueries({ queryKey });
    },
    onError: (e) => {
      setStatus('error');
      setErrorText(noticeFromError(e)?.message ?? 'Could not save');
    },
  });

  const commit = () => {
    const n = Number(draft);
    if (draft === '' || !Number.isFinite(n)) return; // let the blur handler restore on next sync
    if (min != null && n < min) { setStatus('error'); setErrorText(`Minimum is ${min}`); return; }
    if (max != null && n > max) { setStatus('error'); setErrorText(`Maximum is ${max}`); return; }
    if (n === Number(value)) { setStatus(null); return; }
    setStatus('saving');
    save.mutate(n);
  };

  return (
    <>
      <input
        type="number" min={min} max={max} step={step}
        className="settings-input settings-input-sm"
        value={draft}
        onChange={(e) => { setDraft(e.target.value); setStatus(null); }}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        aria-label={`${settingKey} — enforced live`}
      />
      {unit && <span className="settings-hint-text">{unit}</span>}
      {status === 'saving' && <span className="settings-hint-text">saving…</span>}
      {status === 'saved' && <span className="settings-ok">saved — live now</span>}
      {status === 'error' && <span className="settings-hint-text">⚠️ {errorText}</span>}
    </>
  );
}

function RiskLimits() {
  const { prefs, set } = usePreferences();
  const { data: serverLimits } = useQuery({
    queryKey: ['trading-risk-limits'],
    queryFn: () => apiGet('/api/trading/strategies/risk-limits').catch(() => null),
    staleTime: 300_000,
    retry: 1,
  });

  return (
    <>
      <SettingRow label="Max Drawdown (%)" hint="Circuit breaker trips when drawdown exceeds this. Client-side preference.">
        <input type="number" min="5" max="50" step="1" className="settings-input settings-input-sm"
          value={prefs.riskMaxDrawdown}
          onChange={e => set('riskMaxDrawdown', parseInt(e.target.value, 10) || 25)} />
      </SettingRow>
      {serverLimits ? (
        <SettingRow
          label="Max Open Positions"
          hint="How many positions may be open at once, across every bot. The BACKEND enforces risk.maxOpenPositions on every order, live. ⚠️ A SECOND cap exists: each MT5 bridge also enforces MT5_MAX_OPEN_POSITIONS from nest/.env, read when the bridge process STARTED — and the LOWER of the two is what binds. If an order is refused while this reads higher than the set number, restart the bridges (tcs-stop + tcs-launch) so they re-read .env. The health page's Risk Cap Alignment check reports any divergence.">
          <ServerNumberInput settingKey="risk.maxOpenPositions" value={serverLimits.maxOpenPositions} min={1} max={1000} />
        </SettingRow>
      ) : (
        // ⚠️ "could not load" is stated, never rendered as an empty control. An unavailable hard
        // limit must not read as "there is no hard limit".
        <SettingRow label="Max Open Positions" hint="Enforced by the backend on every order.">
          <span className="settings-hint-text">⚠️ could not load — see the limits panel below</span>
        </SettingRow>
      )}
      <SettingRow
        label="Max Per Symbol (%)"
        hint={`Ceiling on one instrument as a share of the portfolio. Enforced live; shown read-only here because the display is a percentage and the stored value is a fraction (0.25 = 25%) — a unit conversion in an editable control is a defect waiting to happen on a money path.`}>
        {/* ⚠️ `Number.isFinite`, not a bare multiply. The first version of this row read a field the
            endpoint did not return and rendered `NaN%` — a limit displayed as a non-number is worse
            than one displayed as absent, because it reads as a value. */}
        <code className="settings-limit-value">
          {Number.isFinite(serverLimits?.maxPerSymbol)
            ? `${(serverLimits.maxPerSymbol * 100).toFixed(0)}%`
            : '— not reported'}
        </code>
      </SettingRow>
      <SettingRow label="Max Per Trade Risk (%)" hint="Maximum portfolio risk per individual trade.">
        <input type="number" min="1" max="10" step="0.5" className="settings-input settings-input-sm"
          value={prefs.riskMaxPerTrade}
          onChange={e => set('riskMaxPerTrade', parseFloat(e.target.value) || 2)} />
      </SettingRow>
      <SettingRow label="CB Drawdown Trigger (%)" hint="Circuit breaker trips at this drawdown level.">
        <input type="number" min="5" max="40" step="1" className="settings-input settings-input-sm"
          value={prefs.circuitBreakerDrawdownTrigger}
          onChange={e => set('circuitBreakerDrawdownTrigger', parseInt(e.target.value, 10) || 20)} />
      </SettingRow>
      <SettingRow label="CB Exposure Trigger (%)" hint="Circuit breaker trips when total exposure exceeds this.">
        <input type="number" min="20" max="100" step="5" className="settings-input settings-input-sm"
          value={prefs.circuitBreakerExposureTrigger}
          onChange={e => set('circuitBreakerExposureTrigger', parseInt(e.target.value, 10) || 80)} />
      </SettingRow>

      {serverLimits ? (
        <>
          <h3 className="settings-subheading">Server-Enforced Hard Limits</h3>
          <p className="settings-hint-text">
            Read live from the database (<code>global_setting</code>, keys <code>risk.*</code>) by the
            backend on every order. They no longer need a restart, and neither strategies nor the client
            preferences above can override them.
          </p>
          <SettingRow label="Max Position Size (lots)" hint="Hard cap on any single position volume.">
            <code className="settings-limit-value">{serverLimits.maxPositionSize}</code>
          </SettingRow>
          <SettingRow label="Max Daily Loss ($)" hint="Trading halts if today's P&L drops below this.">
            <code className="settings-limit-value settings-limit-danger">${serverLimits.maxDailyLoss}</code>
          </SettingRow>
          {serverLimits.note && <p className="settings-note">ℹ️ {serverLimits.note}</p>}
        </>
      ) : (
        // ⚠️ "could not load" is stated, never rendered as an empty block. A missing hard-limit
        // panel must not read as "there are no hard limits".
        <p className="settings-hint-text">
          Server-enforced hard limits could not be read from
          <code> GET /api/trading/strategies/risk-limits</code>. The values above are
          client-side only — do not assume they are enforced.
        </p>
      )}
    </>
  );
}

export default function TradingSettingsPage() {
  return (
    <div className="settings-page">
      <motion.header className="settings-header" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
        <h1>Trading
          <PageInfoPopover>
            Where each bot's behaviour is configured: its bar, its default size / stop-loss /
            take-profit, and the risk limits it runs under. The loop that runs the bots and
            the queue that paces them are on Automation.
          </PageInfoPopover>
        </h1>
        <p>Bots, thresholds, trade defaults and risk limits.</p>
      </motion.header>

      <SettingsSection
        id="trading-layer"
        title="Trading layer"
        desc="The META.Stack kill switch for dispatch. OFF keeps scoring and signals running but sends every order to paper."
      >
        <MetaStackLayerSwitch layer="trading" />
        <MovedNote>
          The same switch appears on <a href="/settings/automation">Automation</a>, alongside the
          loop and the queue. Bots can dispatch only when BOTH this layer and the bot's own
          broker flag allow it.
        </MovedNote>
      </SettingsSection>

      <SettingsSection
        id="bots"
        title="Bots"
        desc="Every active bot's bar against the highest score its protocol has actually produced. A bar above the achieved ceiling is a bot that can never fire."
      >
        <BotBarsTable />
        <MovedNote>
          Add and edit bots on <a href="/trading/trading-strategies">Trading Strategies</a> or{' '}
          <a href="/trading/bot-create">Create Bot</a>. Live evaluations are on{' '}
          <a href="/trading/strategy-monitor">Strategy Monitor</a>. The queue that paces them is
          on <a href="/settings/automation">Automation</a>.
        </MovedNote>
      </SettingsSection>

      <SettingsSection
        id="trade-defaults"
        title="Manual trade defaults"
        desc="Applied when a Signals card places a manual trade without explicit size / stop-loss / take-profit."
      >
        <ManualTradeDefaults />
      </SettingsSection>

      <SettingsSection
        id="risk-limits"
        title="Risk Limits"
        desc="Client-side limits, shown here because this is where position size is set. These are preferences — the hard ceiling is the server-enforced block below."
      >
        <RiskLimits />
      </SettingsSection>
    </div>
  );
}
