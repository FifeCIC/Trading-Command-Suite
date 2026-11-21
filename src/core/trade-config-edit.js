/**
 * trade-config-edit.js — the parsing rules for editing a BOT column from a table cell.
 * ================================================================================
 * Extracted from `TradeConfigPanel.jsx` so the rules can be tested by `node --test`, which is how the
 * rest of `src/core` is guarded. The panel renders; this module decides what the PATCH will send.
 *
 * ── THE ONE RULE THAT MATTERS ───────────────────────────────────────────────────────────────────
 * ⚠️ **AN EMPTY INPUT IS NOT ZERO.** `Number('')` is `0`, so a cleared box would silently write a
 * 0% stop loss, a 0-minute cooldown or a 0-tier pyramid — a live trading change nobody typed, made
 * by a control that looked like it had simply been emptied. So empty is:
 *
 *   `null`      when the column accepts NULL (the intended "no value"), and
 *   a REFUSAL   otherwise — the reader is told the column has no "no value" state.
 *
 * Never a silent zero, and never `NaN` reaching Prisma.
 *
 * ⚠️ **The column's type decides what is legal, and the server declares it.** `integer` and
 * `nullable` come from `nest/src/modules/backtest/trade-config.ts` (asserted against the Prisma DMMF
 * there), because a fraction sent to an `Int` column is rejected by the database *after* the UI has
 * reported a save.
 */

/** The stored column as the raw value a control holds. Empty string means "no value". */
export function storedRaw(field) {
  if (!field?.editable) return '';
  if (field.editable.control === 'toggle') return field.botValue === 'on';
  return field.botValue === null || field.botValue === undefined ? '' : String(field.botValue);
}

/**
 * Raw input → `{ ok: true, value }` or `{ ok: false, error }`.
 *
 * `value` is `null` for a cleared nullable field, and the typed number/string/boolean otherwise.
 */
export function parseFieldValue(field, raw) {
  const e = field?.editable;
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

/** Two raw inputs are the same when they parse to the same typed value (`'2.50'` === `'2.5'`). */
export function sameFieldValue(field, a, b) {
  const pa = parseFieldValue(field, a);
  const pb = parseFieldValue(field, b);
  if (!pa.ok || !pb.ok) return String(a) === String(b);
  return pa.value === pb.value;
}

/**
 * The PATCH body: only the fields whose draft differs from the stored column, plus every refusal.
 *
 * ⚠️ `count` includes the refusals on purpose — the footer must not say "No changes" while a box
 * holds a value that cannot be saved, because the disabled button would then look like the only
 * problem.
 */
export function collectChanges(fields, draft = {}) {
  const body = {};
  const problems = [];
  for (const field of fields ?? []) {
    if (!field?.editable) continue;
    const stored = storedRaw(field);
    const raw = Object.prototype.hasOwnProperty.call(draft, field.id) ? draft[field.id] : stored;
    if (sameFieldValue(field, raw, stored)) continue;
    const parsed = parseFieldValue(field, raw);
    if (parsed.ok) body[field.id] = parsed.value;
    else problems.push(parsed.error);
  }
  return { body, problems, count: Object.keys(body).length + problems.length };
}
