/**
 * pnl-bars.js — how long each P/L bar should be, for a day or for a symbol.
 *
 * ── WHY THIS IS ONE MODULE AND NOT TWO ──────────────────────────────────────────────────────────
 * Step 4 draws a bar per DAY and step 5 a bar per SYMBOL. The rule is identical and it is the rule,
 * not the drawing, that is easy to get wrong — so it lives once. A second copy would drift and only
 * one would get the next fix.
 *
 * ── THE THREE WAYS THIS GOES WRONG (each renders a chart that looks fine) ───────────────────────
 *
 * 1. **Scaling to the TOTAL rather than the LARGEST row.** Five days of +100 against a total of +500
 *    would draw five half-bars, when the honest picture is five equal days. The reader's question is
 *    "did one row carry it?" — that needs the biggest row at full width.
 * 2. **`Number(null) === 0`.** Coercing a blank value turns an UNREADABLE figure into a flat one, and
 *    a zero-length bar is indistinguishable from "measured, no movement". This test failed on the
 *    module's first run, so the guard is explicit.
 * 3. **A row that could not be measured at all.** Drawn as a 0-length bar it reads as break-even. It is
 *    skipped entirely, so "no bar" means "not measured" and never "zero".
 *
 * ⚠️ MAGNITUDE ONLY. The SIGN is carried by the caller's class and, more importantly, by the number
 * printed beside the bar — colour is never the only carrier (accessibility policy, and greyscale).
 */

/** `null`/`undefined`/blank → null; a real number → itself; anything else → null. Never 0 by accident. */
function asNumber(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {Array<object>} rows
 * @param {{
 *   getId?: (row: object) => string,
 *   getValue?: (row: object) => unknown,
 *   skip?: (row: object) => boolean,
 * }} [accessors]
 *   Defaults are the DAY row shape (`id`, `netPnl`, skipped when `notice` is set). The symbol table uses
 *   the same rule with `getId: r => r.symbol` and `skip: r => r.errors > 0`.
 *
 * ⚠️ THE ACCESSORS ARE DELIBERATELY NOT CALLED `valueOf` / `toString`. A plain object inherits
 * `Object.prototype.valueOf`, so `accessors.valueOf ?? fallback` NEVER falls back — it calls the
 * inherited method, which throws `Cannot convert undefined or null to object`. Measured here on the
 * module's first run: 7 of 8 tests failed with that error. A name that collides with `Object.prototype`
 * is a trap with no upside.
 * @returns {{ maxAbs: number, fracById: Record<string, number> }}
 *   `fracById[id]` is 0..1 of the WIDEST row. A skipped or unreadable row is ABSENT from the map.
 */
export function buildPnlBars(rows, accessors = {}) {
  const getId = accessors.getId ?? ((r) => r.id);
  const getValue = accessors.getValue ?? ((r) => r.netPnl);
  const skip = accessors.skip ?? ((r) => Boolean(r?.notice));

  const list = Array.isArray(rows) ? rows : [];
  const usable = list
    .filter((r) => r && !skip(r))
    .map((r) => ({ id: getId(r), value: asNumber(getValue(r)) }))
    .filter((x) => x.value !== null);

  const maxAbs = usable.reduce((a, x) => Math.max(a, Math.abs(x.value)), 0);
  const fracById = {};
  for (const { id, value } of usable) {
    // A flat row against a flat book is a real 0%, not an unknown: the number beside it says 0.00.
    fracById[id] = maxAbs > 0 ? Math.abs(value) / maxAbs : 0;
  }
  return { maxAbs, fracById };
}
