/**
 * close-reason.ts — WHY A TRADE CLOSED, named once.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS (2026-09-18)
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Measured that morning: **15 of 16 bot trades closed at 3–18% of the distance to their configured
 * SL/TP.** AUDJPY had a 1.003% stop and closed at 0.036%. And three positions closed inside five
 * seconds — NZDJPY at 12:15:59, EURGBP at 12:16:00, EURCHF at 12:16:04. That is a batch, not the
 * market.
 *
 * The system could not say what closed them:
 *
 *   - `PositionTimeStopService` keeps its close history **in memory**, so a restart erases it.
 *   - Every *closing* deal in MT5 history has an **empty comment** — openings carry `TCS <bot>`,
 *     closings carry nothing — so the broker did not tag them as SL/TP fills either.
 *   - `trade` had no column for it at all.
 *
 * An hour of elimination produced suspects and no cause. **A trade's exit is the single most
 * consequential thing about it, and nothing recorded it.** This module is the missing record.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * THE RULE
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * > Every code path that closes a position must say so in `trade.closeReason`, using a value from
 * > `CLOSE_REASONS`. A closer that cannot name itself is a closer nobody can audit.
 *
 * The format is `<authority>:<mechanism>`, because "who" and "why" are different questions and the
 * 2026-09-18 investigation needed both:
 *
 *   | authority | means                                                       |
 *   |-----------|-------------------------------------------------------------|
 *   | `system`  | one of OUR services decided to close it                     |
 *   | `user`    | a person closed it through the API or the UI                |
 *   | `broker`  | the position closed at the broker — we only observed it     |
 *
 * ⚠️ **`broker:unknown` is a first-class value, not a failure.** When the broker closes a position
 * and does not report why, "the broker did it and I cannot say why" is the honest answer. It is
 * strictly better than a guess, because a guess stops the next reader from looking — which is
 * exactly how the 2026-09-18 defect stayed invisible in the first place.
 */

/** `<authority>:<mechanism>` — see the table in the file header. */
export const CLOSE_REASONS = {
  /** The #773 position time-stop closed it (maxHoldHours exceeded). */
  SYSTEM_TIME_STOP: 'system:time-stop',
  /** The sync found a DB position with no broker counterpart and finalised the trade. */
  SYSTEM_RECONCILED: 'system:reconciled',
  /** Closed through the API/UI by a person. */
  USER_MANUAL: 'user:manual',
  /** MT5 filled the stop loss. */
  BROKER_SL: 'broker:sl',
  /** MT5 filled the take profit. */
  BROKER_TP: 'broker:tp',
  /** MT5 closed it because it decided to — client terminal, web, expert, stop-out, rollover. */
  BROKER_TERMINAL: 'broker:terminal',
  /** Margin stop-out specifically: the account ran out of room. Worth its own name. */
  BROKER_STOP_OUT: 'broker:stop-out',
  /** The position is gone but nothing reported a cause. Honest, not a failure. */
  BROKER_UNKNOWN: 'broker:unknown',
} as const;

export type CloseReason = (typeof CLOSE_REASONS)[keyof typeof CLOSE_REASONS];

/**
 * MT5 `deal.reason` → our vocabulary.
 *
 * ⚠️ The values are the `mt5.DEAL_REASON_*` constants. MT5 reports an INTEGER; the bridge now
 * forwards it as `reason` on each deal (see `/history/deals` in `mt5_bridge_v2.py`), but the
 * RUNNING bridge is an older build that omits the field — so callers must treat `undefined` as
 * `BROKER_UNKNOWN` rather than defaulting to something that reads like knowledge.
 *
 * Deliberately NOT mapped to anything more specific than they are:
 *   CLIENT / MOBILE / WEB — a human closed it somewhere, but not necessarily OUR ui. Calling that
 *   `user:manual` would claim knowledge we do not have, so it is `broker:terminal`.
 */
export function closeReasonFromDealReason(reason: number | null | undefined): CloseReason {
  switch (reason) {
    case 4:
      return CLOSE_REASONS.BROKER_SL;
    case 5:
      return CLOSE_REASONS.BROKER_TP;
    case 6:
      return CLOSE_REASONS.BROKER_STOP_OUT;
    case 0:
    case 1:
    case 2:
    case 3:
    case 7:
    case 8:
    case 9:
      // client | mobile | web | expert | rollover | vmargins | split
      return CLOSE_REASONS.BROKER_TERMINAL;
    default:
      // Including `undefined` — the running bridge does not send this field yet. Naming that
      // honestly is the point; see the header.
      return CLOSE_REASONS.BROKER_UNKNOWN;
  }
}

/** Human-facing label. Kept beside the codes so the two cannot drift. */
export const CLOSE_REASON_LABELS: Record<string, string> = {
  [CLOSE_REASONS.SYSTEM_TIME_STOP]: 'Time stop (held past max hold)',
  [CLOSE_REASONS.SYSTEM_RECONCILED]: 'Reconciled — no broker counterpart',
  [CLOSE_REASONS.USER_MANUAL]: 'Closed manually',
  [CLOSE_REASONS.BROKER_SL]: 'Stop loss filled',
  [CLOSE_REASONS.BROKER_TP]: 'Take profit filled',
  [CLOSE_REASONS.BROKER_TERMINAL]: 'Closed at the broker terminal',
  [CLOSE_REASONS.BROKER_STOP_OUT]: 'Broker stop-out (margin)',
  [CLOSE_REASONS.BROKER_UNKNOWN]: 'Closed at the broker — cause not reported',
};

export function closeReasonLabel(reason: string | null | undefined): string {
  if (!reason) return 'Not recorded';
  return CLOSE_REASON_LABELS[reason] ?? reason;
}

/**
 * ⚠️ A close that records NOTHING is the defect this file exists to prevent, so the three
 * "we did not record it" shapes are distinguished rather than collapsed — the same rule
 * `development-philosophy.md` §7 states for `[]` vs `null` vs an error:
 *
 *   `null`                       → the trade is still open, OR closed before this column existed
 *   `''` (empty)                 → BAD: a writer that set the field without a value
 *   `broker:unknown` / `system:*` → a writer that named itself, which is what we want
 */
export function isCloseAttributed(reason: string | null | undefined): boolean {
  return typeof reason === 'string' && reason.trim().length > 0;
}
