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

const fmt = (v, unit) => {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'number') {
    const n = Number.isInteger(v) ? String(v) : String(Number(v.toFixed(3)));
    return unit ? `${n}${unit === '$' || unit === '%' ? unit : ` ${unit}`}` : n;
  }
  return String(v);
};

/** The stored column as the raw value a control holds. Empty string means "no value". */
const storedRaw = (f) => {
  if (!f.editable) return '';
  if (f.editable.control === 'toggle') return f.botValue === 'on';
  return f.botValue === null || f.botValue === undefined ? '' : String(f.botValue);
};

/**
 * Raw input → the value the PATCH sends, or a refusal.
 *
 * ⚠️ AN EMPTY INPUT IS NOT ZERO. `Number('')` is `0`, so a cleared box would silently set a stop loss
 * of 0% (no stop) or a cooldown of 0 minutes while looking like it saved what was typed. Empty is
 * therefore `null` when the column is nullable and an ERROR otherwise — never a silent zero.
 */
function parseValue(field, raw) {
  const e = field.editable;
  if (!e) return { ok: true, value: undefined };
  if (e.control === 'toggle') return { ok: true, value: Boolean(raw) };

  const text = String(raw ?? '').trim();
  if (text === '') {
    if (e.control === 'time' || e.nullable) return { ok: true, value: null };
    return { ok: false, error: `${field.label} cannot be empty — this column has no “no value” state.` };
  }
  if (e.control === 'time') {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) {
      return { ok: false, error: `${field.label} must be a 24-hour time, HH:MM (UTC).` };
    }
    return { ok: true, value: text };
  }
  const n = Number(text);
  if (!Number.isFinite(n)) return { ok: false, error: `${field.label} must be a number.` };
  if (e.integer && !Number.isInteger(n)) {
    return { ok: false, error: `${field.label} must be a whole number — the column is an integer.` };
  }
  if (e.min !== undefined && n < e.min) return { ok: false, error: `${field.label} cannot be below ${e.min}.` };
  if (e.max !== undefined && n > e.max) return { ok: false, error: `${field.label} cannot be above ${e.max}.` };
  return { ok: true, value: n };
}

/** Two raw inputs are the same when they parse to the same typed value. */
function sameValue(field, a, b) {
  const pa = parseValue(field, a);
  const pb = parseValue(field, b);
  if (!pa.ok || !pb.ok) return String(a) === String(b);
  return pa.value === pb.value;
}

export default function TradeConfigPanel({ tradeConfig, onRetest, retestBusy = false }) {
  const [showIgnored, setShowIgnored] = useState(true);
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const bot = tradeConfig?.bot ?? null;
  const botId = bot?.id ?? null;

  /**
   * A new run object is a new configuration, so unsaved edits are DROPPED rather than carried over.
   * Carrying them would leave a control showing a value the bot no longer holds, with nothing on
   * screen saying the edit was never saved.
   */
  useEffect(() => {
    setDraft({});
    setError(null);
  }, [tradeConfig]);

  const fields = useMemo(() => tradeConfig?.fields ?? [], [tradeConfig]);
  const editableFields = useMemo(() => fields.filter((f) => f.editable), [fields]);

  /** Parsed, validated changes — the exact body the PATCH will send. */
  const changes = useMemo(() => {
    const body = {};
    const problems = [];
    for (const f of editableFields) {
      const raw = f.id in draft ? draft[f.id] : storedRaw(f);
      if (sameValue(f, raw, storedRaw(f))) continue;
      const parsed = parseValue(f, raw);
      if (parsed.ok) body[f.id] = parsed.value;
      else problems.push(parsed.error);
    }
    return { body, problems, count: Object.keys(body).length + problems.length };
  }, [draft, editableFields]);

  if (!tradeConfig) return null;

  const ignored = fields.filter((f) => !f.applied);
  const shown = showIgnored ? fields : fields.filter((f) => f.applied);
  const canSave = Boolean(botId && onRetest);
  const busy = saving || retestBusy;

  /** A bot value that differs from what the run used is the most interesting cell in the table. */
  const diverged = (f) => f.botValue != null && f.botValue !== f.value;

  const setField = (id, raw) => {
    setError(null);
    setDraft((prev) => ({ ...prev, [id]: raw }));
  };

  const discard = () => {
    setDraft({});
    setError(null);
  };

  /**
   * SAVE, THEN RE-RUN — the order is not interchangeable. The run resolves the bot server-side, so a
   * re-run started before the write lands would measure the OLD values and report them as the new ones.
   */
  const saveAndRetest = async () => {
    if (!canSave || !changes.count) return;
    if (changes.problems.length) {
      setError(changes.problems[0]);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiPatch(`/api/trading/strategies/${encodeURIComponent(botId)}`, changes.body);
      setDraft({});
      await onRetest();
    } catch (err) {
      // The server's own wording — a ceiling refusal names the gate that refused, and paraphrasing it
      // would drop the only part a reader can act on.
      setError(err?.detail || err?.message || 'The bot config was not saved.');
    } finally {
      setSaving(false);
    }
  };

  const control = (f) => {
    const raw = f.id in draft ? draft[f.id] : storedRaw(f);
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
              <th scope="col">Where it lives</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((f) => {
              const dirty = f.editable
                ? !sameValue(f, f.id in draft ? draft[f.id] : storedRaw(f), storedRaw(f))
                : false;
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
                          <span className="mvp-config-botv">run used {fmt(f.value, f.unit)}</span>
                        )}
                      </>
                    ) : (
                      <>
                        {fmt(f.value, f.unit)}
                        {diverged(f) && (
                          <span
                            className="mvp-config-botv"
                            title="the bot's own value, which this run did not use"
                          >
                            bot {fmt(f.botValue, f.unit)}
                          </span>
                        )}
                      </>
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
                  <td className="mvp-config-note">{f.note}</td>
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
          <button
            type="button"
            className="mvp-cfg-save"
            disabled={!changes.count || busy}
            onClick={saveAndRetest}
          >
            {saving ? 'Saving…' : retestBusy ? 'Retesting…' : 'Retest'}
          </button>
          {changes.count > 0 && !busy && (
            <button type="button" className="mvp-link-btn" onClick={discard}>
              Discard
            </button>
          )}
        </div>
      )}

      {error && <p className="mvp-cfg-error" role="alert">{error}</p>}

      <p className="mvp-note">{tradeConfig.summary}</p>
    </section>
  );
}
