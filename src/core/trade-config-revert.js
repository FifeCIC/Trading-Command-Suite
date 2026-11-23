/**
 * trade-config-revert.js — keep the PREVIOUS bot settings, and decide when to go back to them.
 * ================================================================================
 * Owner, 2026-11-23: cache the previous test's settings so they can be restored, and offer an option to
 * revert automatically when a Retest makes less profit, notifying when it does.
 *
 * ⚠️ **A LOWER NET P&L ON ONE RE-RUN IS NOT PROOF THE CHANGE WAS BAD.** It is one sample of the same
 * days with one different number, and the repo's own rule (register row 23) says a maths change is
 * judged against a copied configuration, not a single before/after. So this module returns a DECISION
 * plus the caveat to print with it — the revert is a guard-rail that stops a clearly worse setting
 * being left in place, never a verdict. `because` always carries that sentence so a caller cannot
 * present the revert as a measurement.
 *
 * ⚠️ NOTHING HERE TOUCHES THE DATABASE. It builds the PATCH bodies; the panel sends them, so there is
 * one write path (`PATCH /api/trading/strategies/:id`) and one place a refusal can come from.
 */
import { parseFieldValue, storedRaw } from './trade-config-edit.js';

/**
 * The previous value of every field the PATCH is about to change.
 *
 * ⚠️ ONLY EDITABLE FIELDS ARE SNAPSHOTTED. A row with no `editable` has no column behind it (the Stop
 * Guardian row is the example) — putting its display value into a revert body would send a string to a
 * column that does not exist.
 */
export function snapshotOf(fields, body) {
  const ids = new Set(Object.keys(body ?? {}));
  const snap = {};
  for (const field of fields ?? []) {
    if (!ids.has(field.id) || !field?.editable) continue;
    snap[field.id] = storedRaw(field);      // the raw the control held BEFORE the edit
  }
  return snap;
}

/** The PATCH body that puts a snapshot back. Refusals are returned, never thrown away. */
export function revertBody(snapshot, fields) {
  const byId = new Map((fields ?? []).map((f) => [f.id, f]));
  const body = {};
  const problems = [];
  for (const [id, raw] of Object.entries(snapshot ?? {})) {
    const field = byId.get(id);
    if (!field?.editable) continue;
    const parsed = parseFieldValue(field, raw);
    if (parsed.ok) body[id] = parsed.value;
    else problems.push(`${field.label}: ${parsed.error}`);
  }
  return { body, problems, count: Object.keys(body).length };
}

/** Net P&L across the runs a re-test returned, or `null` when no run succeeded. */
export function netPnlOf(runs) {
  const ok = (runs ?? []).filter((r) => r && !r.notice);
  if (!ok.length) return null;
  let sum = 0;
  let any = false;
  for (const r of ok) {
    const v = Number(r.totals?.netPnl);
    if (Number.isFinite(v)) { sum += v; any = true; }
  }
  return any ? sum : null;
}

export const REVERT_CAVEAT =
  'One re-run is a sample, not a verdict: the same days with one number changed can differ by chance. '
  + 'Use it to stop a clearly worse setting being left in place, and judge the change properly with a '
  + 'copied configuration.';

/**
 * Should the previous settings be put back?
 *
 * ⚠️ `null` IS "CANNOT JUDGE" AND NEVER TRIGGERS A REVERT. A failed re-run has no P&L, and reverting on
 * the strength of a number that does not exist would be the plausible-output defect this repo keeps
 * paying for.
 */
export function autoRevertDecision({ enabled, beforePnl, afterPnl }) {
  if (!enabled) {
    return { revert: false, because: 'automatic revert is off', caveat: REVERT_CAVEAT };
  }
  const before = Number(beforePnl);
  const after = Number(afterPnl);
  if (beforePnl === null || beforePnl === undefined || !Number.isFinite(before)) {
    return { revert: false, because: 'no previous profit figure to compare against', caveat: REVERT_CAVEAT };
  }
  if (afterPnl === null || afterPnl === undefined || !Number.isFinite(after)) {
    return { revert: false, because: 'the re-run produced no profit figure, so nothing can be compared', caveat: REVERT_CAVEAT };
  }
  if (after < before) {
    return {
      revert: true,
      because: `the re-run made ${after.toFixed(2)} against ${before.toFixed(2)} before the change`,
      caveat: REVERT_CAVEAT,
    };
  }
  return {
    revert: false,
    because: `the re-run made ${after.toFixed(2)} against ${before.toFixed(2)} — not worse`,
    caveat: REVERT_CAVEAT,
  };
}
