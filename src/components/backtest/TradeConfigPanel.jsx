/**
 * TradeConfigPanel — WHERE EACH TRADE-MANAGEMENT NUMBER CAME FROM, AND HOW TO CHANGE IT.
 *
 * ── WHY THIS IS A PANEL AND NOT A LINE OF PROSE ─────────────────────────────────────────────────
 * "The strategy lost on a +430% mover because its 1%/1% bracket" was a wrong sentence, and only a
 * table makes that class of error impossible to repeat. Measured 2026-11-20: `Movers V1 Long Bot` is
 * configured **2.5% / 6%**, entry bar **30%**, max hold **4h**, cooldown **30 min** — while the run that
 * produced the sentence used the engine's literals **1% / 1% / 0 / none**.
 *
 * The three sources answer the question "global config, hardcoded, or data-driven?", and each carries a
 * different weight when a result is read:
 *
 *   BOT            a `trading_strategy` record — the only source a live trade obeys.
 *   REQUEST        this run only. Not a fact about the strategy.
 *   ENGINE DEFAULT a literal in the engine — correct for no strategy in particular.
 *
 * ⚠️ `applied: false` is the second half of the answer, and it is NOT cosmetic. The engine has no
 * cooldown, no position cap, no session filter and sizes differently from the live loop, so those rows
 * say the result is silent about them. A row rendered as a plain value would read as measured.
 *
 * ── WHAT THE LAST COLUMN SAYS (owner, 2026-11-23) ───────────────────────────────────────────────
 * It used to be "Where it lives": `trading_strategy.tpPct`, `#1325`, `NOT APPLIED — the engine has no
 * concurrency model`. Owner: *"too much technical information … the information displayed should be
 * description of what the value does and how it affects the trade or decisions made. Potentially even
 * making some of it dynamic based on the settings value."*
 *
 * So the column renders `field.effect` — a value-aware sentence about the TRADING ("6% is banked and the
 * trade closes there. It caps a winner"), and `field.note` keeps the provenance in the payload for
 * diagnosis. The guard is `trade-config-effect.spec.ts`, which fails on a schema path, an identifier, an
 * issue number or a verdict cap appearing in an effect.
 *
 * ── EDITING IS PERMANENT, AND THAT IS THE DECISION (register row 247) ───────────────────────────
 * Owner, on this page: *"I think we should save them as live values and so the user would be editing
 * the same bot configuration as will be used live… stop protecting the user from using a rubbish
 * strategy they didn't test well."*
 *
 * So a change here is NOT a run-scoped override. It is a PATCH to the `trading_strategy` record — the
 * same row the live loop reads — and the run is then repeated against it. A run-scoped override would
 * create a SECOND configuration that drifts from the real one, and the table would stop describing the
 * bot that actually trades, which is the defect this panel exists to expose.
 *
 * ⚠️ WHICH rows are editable is the SERVER'S declaration (`field.editable`), never this file's guess.
 * Only the server knows a column exists, its type, and whether it accepts NULL. A page that guessed
 * would offer an input whose save fails at the database — after telling the reader it saved.
 */
import { useEffect, useMemo, useState } from 'react';
import { apiPatch } from '../../core/api/client';
import { noticeFromError } from '../../core/notices/from-error.js';
import { collectChanges, parseFieldValue, sameFieldValue, storedRaw } from '../../core/trade-config-edit.js';
import { priceDistance, formatDistance } from '../../features/movers-strategy/price-reference.js';
import {
  snapshotOf,
  revertBody,
  netPnlOf,
  autoRevertDecision,
} from '../../core/trade-config-revert.js';
import WhyPopover from '../WhyPopover.jsx';

const SOURCE_LABEL = {
  bot: 'bot',
  request: 'this run',
  'engine-default': 'engine default',
};

const SOURCE_TONE = {
  bot: 'bot',
  request: 'request',
  'engine-default': 'default',
};

const fmtWithUnit = (v, unit) => {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'number') {
    const n = Number.isInteger(v) ? String(v) : String(Number(v.toFixed(3)));
    return unit ? `${n}${unit === '$' || unit === '%' ? unit : ` ${unit}`}` : n;
  }
  return String(v);
};

export default function TradeConfigPanel({
  tradeConfig,
  onRetest,
  retestBusy = false,
  /**
   * The page's running totals, read BEFORE a change is saved. A getter rather than a value because
   * `totals` is recomputed the moment the re-run lands — a prop captured at render would already be the
   * NEW figure by the time the comparison happens, and every change would look neutral.
   */
  getBaselineNetPnl,
  /**
   * `{ symbol, price, count, symbols } | null` from `buildPriceReference()` — one symbol's median
   * entry, so a percentage can be printed as the price distance it actually is. `null` means no trade
   * in this run carried a readable entry price, and the panel then says nothing rather than inventing a
   * price to multiply by.
   */
  priceRef = null,
}) {
  const [showIgnored, setShowIgnored] = useState(true);
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);
  /**
   * Two shapes reach this state: a registry notice from the save, and a local validation sentence.
   * ⚠️ Named `alert` with a `.text` field on purpose — rendering `err.message` is the raw-error
   * pattern the notices ratchet counts, and a notice must carry its code and remedy as well.
   */
  const [alert, setAlert] = useState(null);

  const bot = tradeConfig?.bot ?? null;
  const botId = bot?.id ?? null;

  /**
   * ── THE PREVIOUS SETTINGS, CACHED (owner, 2026-11-23) ───────────────────────────────────────────
   * The snapshot is the values the bot held BEFORE the last save from this panel, so "revert" is one
   * click rather than a memory exercise. Kept in `localStorage` per bot because a revert is wanted after
   * a reload as often as straight after the retest — and it is a CACHE, not a record: the durable history
   * of every configuration is the stored selection runs (`/api/backtest/selection-history`).
   */
  const snapKey = botId ? `tcs:trade-config:snapshot:${botId}` : null;
  const autoKey = botId ? `tcs:trade-config:autoRevert:${botId}` : null;
  const readStore = (key, fallback) => {
    if (!key) return fallback;
    try {
      const raw = window.localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  };
  const [snapshot, setSnapshot] = useState(() => readStore(snapKey, null));
  const [autoRevert, setAutoRevert] = useState(() => Boolean(readStore(autoKey, false)));

  useEffect(() => {
    setSnapshot(readStore(snapKey, null));
    setAutoRevert(Boolean(readStore(autoKey, false)));
  }, [snapKey, autoKey]);

  const keepSnapshot = (snap) => {
    setSnapshot(snap);
    try {
      if (snapKey) window.localStorage.setItem(snapKey, JSON.stringify(snap));
    } catch {
      /* a blocked store must not break a save that already happened */
    }
  };
  const toggleAutoRevert = () => {
    const next = !autoRevert;
    setAutoRevert(next);
    try {
      if (autoKey) window.localStorage.setItem(autoKey, JSON.stringify(next));
    } catch {
      /* same */
    }
  };

  /**
   * A new run object is a new configuration, so unsaved edits are DROPPED rather than carried over.
   * Carrying them would leave a control showing a value the bot no longer holds, with nothing on
   * screen saying the edit was never saved.
   */
  useEffect(() => {
    setDraft({});
    setAlert(null);
  }, [tradeConfig]);

  const fields = useMemo(() => tradeConfig?.fields ?? [], [tradeConfig]);

  /** The value a control is showing: the draft when one exists, otherwise the stored column. */
  const rawFor = (f) => (
    Object.prototype.hasOwnProperty.call(draft, f.id) ? draft[f.id] : storedRaw(f)
  );

  /** Parsed, validated changes — the exact body the PATCH will send. Rules live in `core/`. */
  const changes = useMemo(() => collectChanges(fields, draft), [draft, fields]);

  if (!tradeConfig) return null;

  const ignored = fields.filter((f) => !f.applied);
  const shown = showIgnored ? fields : fields.filter((f) => f.applied);
  const canSave = Boolean(botId && onRetest);
  const busy = saving || retestBusy;

  /** A bot value that differs from what the run used is the most interesting cell in the table. */
  const diverged = (f) => f.botValue != null && f.botValue !== f.value;

  const setField = (id, raw) => {
    setAlert(null);
    setDraft((prev) => ({ ...prev, [id]: raw }));
  };

  const discard = () => {
    setDraft({});
    setAlert(null);
  };

  /**
   * SAVE, THEN RE-RUN — the order is not interchangeable. The run resolves the bot server-side, so a
   * re-run started before the write lands would measure the OLD values and report them as the new ones.
   */
  const saveAndRetest = async () => {
    if (!canSave || !changes.count) return;
    if (changes.problems.length) {
      setAlert({ title: 'Check the value', message: changes.problems[0], cause: null, action: null });
      return;
    }
    setSaving(true);
    setAlert(null);
    /**
     * Capture BOTH halves of "before" before anything is written: the values (so a revert has something
     * to send back) and the profit figure (so the comparison is against the run the reader was looking
     * at, not against the re-run that has not happened yet).
     */
    const beforeSnapshot = snapshotOf(fields, changes.body);
    const beforePnl = typeof getBaselineNetPnl === 'function' ? getBaselineNetPnl() : null;
    if (Object.keys(beforeSnapshot).length) keepSnapshot(beforeSnapshot);

    /**
     * ── THE SAVE AND THE RE-RUN FAIL DIFFERENTLY, SO THEY ARE CAUGHT SEPARATELY (2026-11-23) ───────
     * MEASURED: the owner set Take profit to 100 and saw *"Bot settings were not saved"* — while the
     * value HAD been written (the row read 100 afterwards). The re-run threw, and one `try` around both
     * calls reported a **failed re-run as a failed save**, which sends the reader back to retype a value
     * that is already stored.
     */
    try {
      await apiPatch(`/api/trading/strategies/${encodeURIComponent(botId)}`, changes.body);
    } catch (err) {
      // A registry notice, not the raw string: the code is the message's stable identity, and a
      // refusal (the active-bot ceiling, a running A/B comparison) arrives as the server's own
      // wording in `cause`. Paraphrasing it would drop the only part a reader can act on.
      setAlert(noticeFromError(err, 'TCS-TRADE-026', { name: bot?.name ?? 'this bot' }));
      setSaving(false);
      return;
    }

    setDraft({});
    let runs = null;
    try {
      runs = await onRetest();
    } catch (err) {
      setAlert(noticeFromError(err, 'TCS-TRADE-027', { name: bot?.name ?? 'this bot' }));
      setSaving(false);
      return;
    }
    setSaving(false);

    /**
     * ── AUTOMATIC REVERT (owner, 2026-11-23) ─────────────────────────────────────────────────────
     * The decision is a PURE function (`trade-config-revert.js`) so "cannot judge" can never trigger a
     * rollback: a failed re-run has no P&L and the comparison returns `revert: false` with a reason.
     * ⚠️ The notice ALWAYS carries the caveat — one re-run is a sample, not a verdict.
     */
    const decision = autoRevertDecision({
      enabled: autoRevert,
      beforePnl,
      afterPnl: netPnlOf(runs),
    });
    if (decision.revert) {
      const revert = revertBody(beforeSnapshot, fields);
      try {
        if (revert.count) {
          await apiPatch(`/api/trading/strategies/${encodeURIComponent(botId)}`, revert.body);
        }
        setDraft({});
        /**
         * ── THE REVERT TOUCHES THE SETTINGS AND NOTHING ELSE (owner, 2026-11-23) ──────────────────
         * *"make sure that the reset only includes the settings so that I can actually see the reason why
         * it reset i.e. the amount reduced."*
         *
         * ⚠️ IT DELIBERATELY DOES **NOT** RE-RUN. A second run replaces the results with the restored
         * configuration's own figures, so the worse number that triggered the revert disappears — the
         * page then reads "no change" and the reason is gone. The figures on screen stay as the EVIDENCE
         * (a run made with the discarded setting), and the notice says exactly that plus both amounts.
         */
        setAlert({
          code: 'TCS-TRADE-028',
          title: `Reverted ${bot?.name ?? 'the bot'} — ${revert.count} setting${revert.count === 1 ? '' : 's'} restored`,
          message:
            `${decision.because}. The previous values are back. ` +
            'The numbers on this page are from the run that was REJECTED — they describe the setting that '
            + 'has just been removed. Re-run when you want the restored settings measured.',
          cause: decision.caveat,
          action: null,
        });
      } catch (err) {
        setAlert(noticeFromError(err, 'TCS-TRADE-026', { name: bot?.name ?? 'this bot' }));
      }
    }
  };

  /**
   * Put the cached settings back by hand.
   *
   * ⚠️ SETTINGS ONLY, for the same reason as the automatic path: a re-run would overwrite the results
   * that explain why anyone is reverting. The reader re-runs when they choose to.
   */
  const revertNow = async () => {
    if (!botId || !snapshot || !onRetest) return;
    const revert = revertBody(snapshot, fields);
    if (!revert.count) {
      setAlert({ title: 'Nothing to revert', message: 'The cached settings are empty.', cause: null, action: null });
      return;
    }
    setSaving(true);
    setAlert(null);
    try {
      await apiPatch(`/api/trading/strategies/${encodeURIComponent(botId)}`, revert.body);
      setDraft({});
      setAlert({
        code: 'TCS-TRADE-028',
        title: `Reverted ${bot?.name ?? 'the bot'} — ${revert.count} setting${revert.count === 1 ? '' : 's'} restored`,
        message:
          'The previous values are back. The numbers on this page are from the run that used the '
          + 'settings just removed, so re-run when you want the restored settings measured.',
        cause: null,
        action: null,
      });
    } catch (err) {
      setAlert(noticeFromError(err, 'TCS-TRADE-026', { name: bot?.name ?? 'this bot' }));
    } finally {
      setSaving(false);
    }
  };

  const control = (f) => {
    const raw = rawFor(f);
    const label = `${f.label} — ${bot?.name ?? 'bot'}`;
    if (f.editable.control === 'toggle') {
      const on = Boolean(raw);
      return (
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={label}
          className={`mvp-cfg-switch${on ? ' mvp-cfg-switch--on' : ''}`}
          onClick={() => setField(f.id, !on)}
        >
          <span className="mvp-cfg-switch-dot" aria-hidden="true" />
          <span className="mvp-cfg-switch-text">{on ? 'on' : 'off'}</span>
        </button>
      );
    }
    return (
      <span className="mvp-cfg-input-wrap">
        <input
          type={f.editable.control === 'time' ? 'time' : 'number'}
          className="mvp-cfg-input"
          aria-label={label}
          inputMode={f.editable.control === 'time' ? undefined : 'decimal'}
          min={f.editable.min}
          max={f.editable.max}
          step={f.editable.step}
          value={raw}
          onChange={(ev) => setField(f.id, ev.target.value)}
          onKeyDown={(ev) => {
            if (ev.key === 'Enter') saveAndRetest();
          }}
        />
        {f.editable.unit && f.editable.control !== 'time' && (
          <span className="mvp-cfg-unit" aria-hidden="true">{f.editable.unit}</span>
        )}
      </span>
    );
  };

  /**
   * ── THE SENTENCE FOLLOWS THE BOX (owner, 2026-11-23) ────────────────────────────────────────────
   * *"as I changed the value to 5 the 2.5 didn't change."* `f.effect` is computed server-side from the
   * STORED column, so it described the old number the moment a reader typed.
   *
   * The SERVER still owns the wording (`f.effectTemplate`) — a client that wrote its own sentence would
   * drift from `trade-config.ts` and only one would get the next fix. This only substitutes the value
   * currently in the box, and picks the zero branch when the box holds a zero or an empty nullable.
   */
  const effectFor = (f) => {
    const tmpl = f.effectTemplate;
    if (!tmpl) return f.effect;
    const parsed = parseFieldValue(f, rawFor(f));
    const v = parsed.ok ? parsed.value : null;
    const usePositive = typeof v === 'number' ? v > 0 : v !== null && v !== '';
    const text = usePositive ? (tmpl.positive ?? f.effect) : (tmpl.zero ?? f.effect);
    return text.replace('{value}', fmtWithUnit(v, f.unit));
  };

  return (
    <section id="mvp-sec-trade-config" className="mvp-block" aria-label="Trade management configuration">
      <div className="mvp-block-head">
        <h2>Trade management — where each number came from</h2>
        {ignored.length > 0 && (
          <button
            type="button"
            className="mvp-link-btn"
            aria-pressed={showIgnored}
            onClick={() => setShowIgnored((v) => !v)}
          >
            {showIgnored ? 'Hide' : 'Show'} {ignored.length} not applied
          </button>
        )}
      </div>

      <p className="mvp-config-summary">
        <span className={`mvp-source mvp-source--${bot ? 'bot' : 'default'}`}>
          {bot ? 'bot config' : 'engine defaults'}
        </span>
        <span>
          {bot
            ? `${bot.name}${bot.active ? '' : ' · inactive'}`
            : 'no bot names this protocol'}
        </span>
        <WhyPopover title="What these sources mean" variant="block">
          <strong>A bot</strong> row is the only value a live trade obeys. An <strong>engine default</strong>{' '}
          row is a literal in the backtester — correct for no strategy in particular, so a result built on
          one describes signals at a bracket nobody chose. A <strong>no</strong> under Applied means the
          engine ignores the field entirely: the result says nothing about it, whichever source supplied it.
        </WhyPopover>
        {canSave && (
          <WhyPopover title="Editing saves to the bot, not to this run" variant="block">
            A box you change here is written to <strong>{bot?.name}</strong> — the row the live trading
            loop reads — and the days above are measured again against it. There is no run-only
            override, deliberately: a second configuration would drift from the real one and this table
            would stop describing the bot you run.
            <br />
            <br />
            A <strong>no</strong> row stays listed because the engine cannot consume it yet. Changing it
            changes the live bot; it will not change these numbers.
          </WhyPopover>
        )}
      </p>

      <div className="mvp-scroll">
        <table className="mvp-table">
          <thead>
            <tr>
              <th scope="col">Setting</th>
              <th scope="col" className="mvp-num">This run used</th>
              <th scope="col">Source</th>
              <th scope="col">Applied by the engine?</th>
              <th scope="col">What it does</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((f) => {
              const dirty = f.editable ? !sameFieldValue(f, rawFor(f), storedRaw(f)) : false;
              return (
                <tr
                  key={f.id}
                  className={[
                    f.applied ? '' : 'mvp-config-row--ignored',
                    dirty ? 'mvp-config-row--dirty' : '',
                  ].filter(Boolean).join(' ')}
                >
                  <td className="mvp-nowrap">{f.label}</td>
                  <td className="mvp-num">
                    {f.editable ? (
                      <>
                        {control(f)}
                        {diverged(f) && (
                          <span className="mvp-config-botv">run used {fmtWithUnit(f.value, f.unit)}</span>
                        )}
                      </>
                    ) : (
                      <>
                        {fmtWithUnit(f.value, f.unit)}
                        {diverged(f) && (
                          <span
                            className="mvp-config-botv"
                            title="the bot's own value, which this run did not use"
                          >
                            bot {fmtWithUnit(f.botValue, f.unit)}
                          </span>
                        )}
                      </>
                    )}
                    {/**
                      * ── PRICE DISTANCE (note o, 2026-11-26) ──
                      * `slPct 5` at a 1.50 entry is 0.075, and the reader was doing that sum in their
                      * head to compare a bracket against the In/Out prices in the tables above.
                      *
                      * ⚠️ It is a percentage OF A PRICE, so it needs a price, and one run can hold
                      * EURUSD at 1.05 and BTC at 60,000. `priceRef` is the MOST-TRADED symbol's median
                      * entry, never a blend — a blended price describes no instrument — and the title
                      * says which symbol and how many others it does not cover.
                      */}
                    {f.unit === '%' && priceRef && priceDistance(f.value, priceRef.price) !== null && (
                      <span
                        className="mvp-config-dist"
                        title={
                          priceRef.symbols > 1
                            ? `Worked at ${priceRef.symbol} — its median of ${priceRef.count} entry price(s). This run also traded ${priceRef.symbols - 1} other symbol(s), at prices of their own; each needs its own sum.`
                            : `Worked at ${priceRef.symbol}'s median entry price, across ${priceRef.count} trade(s).`
                        }
                      >
                        ≈ {formatDistance(priceDistance(f.value, priceRef.price))} at {formatDistance(priceRef.price)}
                      </span>
                    )}
                  </td>
                  <td className="mvp-nowrap">
                    <span className={`mvp-source mvp-source--${SOURCE_TONE[f.source] ?? 'default'}`}>
                      {SOURCE_LABEL[f.source] ?? f.source}
                    </span>
                  </td>
                  <td className="mvp-nowrap">
                    {f.applied ? (
                      <span className="mvp-state mvp-state--entry">yes</span>
                    ) : (
                      <span className="mvp-state mvp-state--warn">no</span>
                    )}
                  </td>
                    {/* ⚠️ `f.effect`, NOT `f.note`. Owner, 2026-11-23: the technical column was "too much
                      technical information" — the column now says what the value DOES to a trade, and the
                      provenance (`f.note`: the column name, the literal site, the issue) stays in the API
                      payload for diagnosis. Do not put it back here; it buried the sentence a reader needs. */}
                  <td className="mvp-config-note">{effectFor(f)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {canSave && (
        <div className="mvp-cfg-actions">
          <span className="mvp-cfg-actions-text">
            {changes.count
              ? `${changes.count} setting${changes.count === 1 ? '' : 's'} changed · saves to ${bot?.name} and re-runs`
              : 'No changes'}
          </span>
          {/**
            * ⚠️ OFF BY DEFAULT. It rolls a bot back without being asked, so it is only ever enabled
            * deliberately — and the notice it raises carries the caveat that one re-run is a sample.
            */}
          <label className="mvp-cfg-auto">
            <input
              type="checkbox"
              checked={autoRevert}
              onChange={toggleAutoRevert}
              aria-label={`Revert ${bot?.name ?? 'this bot'} automatically if the re-run makes less profit`}
            />
            Auto-revert if profit falls
          </label>
          <button
            type="button"
            className="mvp-cfg-save"
            disabled={!changes.count || busy}
            onClick={saveAndRetest}
          >
            {saving ? 'Saving…' : retestBusy ? 'Retesting…' : 'Retest'}
          </button>
          {snapshot && Object.keys(snapshot).length > 0 && (
            <button type="button" className="mvp-link-btn" onClick={revertNow} disabled={busy}>
              Revert to previous settings
            </button>
          )}
          {changes.count > 0 && !busy && (
            <button type="button" className="mvp-link-btn" onClick={discard}>
              Discard
            </button>
          )}
        </div>
      )}

      {alert && (
        <div className="mvp-cfg-error" role="alert">
          <span className="mvp-cfg-error-head">
            {alert.code && <span className="mvp-cfg-error-code">{alert.code}</span>}
            <strong>{alert.title}</strong>
          </span>
          <span className="mvp-cfg-error-msg">{alert.message}</span>
          {/**
            * ⚠️ `cause` IS RENDERED — it was collected and never shown (2026-11-23). For a failed save it
            * is the SERVER'S own refusal (the active-bot ceiling, a running A/B comparison), which is the
            * only part a reader can act on; for an automatic revert it is the caveat that stops the
            * rollback being read as a verdict. Carrying text nobody renders is the same as dropping it.
            */}
          {typeof alert.cause === 'string' && alert.cause ? (
            <span className="mvp-cfg-error-msg">{alert.cause}</span>
          ) : null}
          {alert.cause && <span className="mvp-cfg-error-cause">{alert.cause}</span>}
          {alert.action && <span className="mvp-cfg-error-action">{alert.action}</span>}
        </div>
      )}

      <p className="mvp-note">{tradeConfig.summary}</p>
    </section>
  );
}
