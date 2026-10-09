/**
 * tradeFailureNotice() — turn a REFUSED trade result into a registry notice (#826).
 * =================================================================================
 * A refusal can come from four different places, and they need four different remedies:
 *
 *   - the BRIDGE's own cap          → TCS-TRADE-017 {open, maximum}   "close a position"
 *   - the bridge being unreachable  → TCS-INTEG-001 / TCS-INTEG-002   "check the bridge"
 *   - the BROKER rejecting the fill → the bridge's own code/retcode   "read the retcode"
 *   - nothing supplying a code      → the caller's fallback, which must describe the OPERATION
 *
 * ⚠️ WHY THIS IS ONE FUNCTION AND NOT A LINE IN EACH CARD
 * ------------------------------------------------------
 * Two surfaces call it (SignalCard, SignalsOverviewPage). Both previously hardcoded
 * `notice('TCS-TRADE-005', ...)` on the `success: false` path, DISCARDING the `code` and `params`
 * the server had already computed and sent. Two copies meant the same defect had to be found twice —
 * it was fixed in SignalsOverviewPage first, and the identical bug was still live in SignalCard.
 *
 * ⚠️ THE SPECIFIC HARM OF DISCARDING THE CODE
 * -------------------------------------------
 * `TCS-TRADE-005`'s `action` asserts broker involvement:
 *
 *   "Broker refusals carry a retcode — the bridge reports the symbol, the filling mode it tried
 *    and the modes the broker does allow."
 *
 * Observed live 2026-09-17: XAUUSD was refused by the BRIDGE's position cap (5 open). Nothing was
 * sent to any broker, so there is no retcode and no filling mode to look at — the user was sent
 * hunting for information that cannot exist. The bridge HAD sent
 * `code: 'TCS-TRADE-017', params: { open: 5, maximum: 5 }`, whose own `action` reads
 * "Close a position, or raise MT5_MAX_OPEN_POSITIONS" — correct, and already available.
 *
 * So: prefer the server's code. Fall back to TCS-TRADE-005 ONLY when it genuinely supplied none,
 * which is the one case where "the order was not placed" is all that is known.
 *
 * ⚠️ `params` are passed through wholesale, not just {symbol}/{detail}: codes whose placeholders are
 * richer than that (TCS-TRADE-017 needs {open} and {maximum}) would otherwise render with blanks.
 *
 * ⚠️ The `.js` extension on the registry import is deliberate — Node's ESM resolver requires it, and
 * it is what lets `notices.test.js` reach this module without a browser (same reason as from-error.js).
 */

import { notice } from './registry.js';

/** The code meaning "the order was not placed and the server did not say why". */
export const TRADE_FAILURE_FALLBACK = 'TCS-TRADE-005';

/**
 * @param {object} result  the server's refusal — `{ success: false, error, code?, params? }`
 * @param {string} symbol  the symbol that was refused
 * @returns a rendered notice object (never null, never blank)
 */
export function tradeFailureNotice(result, symbol) {
  // ── #866 (2026-10-09) — a TIMEOUT is not a refusal, and it OUTRANKS the server's code ──
  // `status: 'UNKNOWN'` (adapter) / `'unknown'` (mt5-trading service) means the request LEFT
  // and the response was lost — the broker MAY have filled it. Both writers record the attempt
  // with status 'unknown' for exactly this reason. Rendering it with a refusal code would claim
  // "the order was not placed", which is a fact nobody has — and the user's natural next move
  // (retry) is the one that can double the position. So it gets its own notice, and it is
  // checked BEFORE the server's code: TCS-INTEG-001's own action talks about the bridge, not
  // about the position this trade may now hold.
  if (result?.status === 'unknown' || result?.status === 'UNKNOWN') {
    return notice('TCS-TRADE-022', {
      symbol,
      detail: result?.error || 'The response was lost before it arrived.',
    });
  }
  const code = result?.code || TRADE_FAILURE_FALLBACK;
  return notice(code, {
    symbol,
    // The server's own sentence, preserved verbatim as the cause — never discarded, never
    // re-parsed. For TCS-TRADE-005 that IS the whole explanation.
    detail: result?.error || 'The broker refused the order without giving a reason.',
    // Spread LAST so a server-supplied param wins over a same-named local default.
    ...(result?.params ?? {}),
  });
}
