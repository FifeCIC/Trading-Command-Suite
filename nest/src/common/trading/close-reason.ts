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
 *
 * ⚠️ OWNER DIRECTION, 2026-10-07 (review queue R46): **"The app should assume that it was me if
 * there is no record of the bot closing a position."** A close the app cannot attribute to one of
 * its own mechanisms is therefore reported as `user:manual`. This is not a guess in the dark: asked
 * who produced the unexplained batches, the owner answered *"Yes I think that was me bulk closing
 * the positions."* The mechanical details live in `closeReasonFromDealReason`; `broker:terminal`
 * remains for broker-DRIVEN reasons (rollover / vmargins / split) and for the 93 historic rows.
 * ⚠️ The precondition this rests on: **every close path of ours must stamp `TCS:<origin>`** — the
 * bridge does so for `/close`, `/close/partial` and `/orders/bulk` closes, and a validator fails
 * the build if a NestJS `/close` call site appears without `origin=`.
 */

/** `<authority>:<mechanism>` — see the table in the file header. */
export const CLOSE_REASONS = {
  /** The #773 position time-stop closed it (maxHoldHours exceeded). */
  SYSTEM_TIME_STOP: 'system:time-stop',
  /**
   * The #928 EXIT-side session boundary closed it (`exitBeforeUtc` reached).
   *
   * ⚠️ A value of its own rather than reusing `SYSTEM_TIME_STOP`, because the two answer different
   * questions: the time-stop means "held TOO LONG", this means "the clock reached a boundary the
   * bot named". Measured 2026-10-01, collapsing them would have made the counterfactual replay
   * unable to tell which mechanism produced a given exit — and the replay is the only evidence
   * that decides whether this boundary earns its place.
   */
  SYSTEM_SESSION_EXIT: 'system:session-exit',
  /** The sync found a DB position with no broker counterpart and finalised the trade. */
  SYSTEM_RECONCILED: 'system:reconciled',
  /** Closed through the API/UI by a person. */
  USER_MANUAL: 'user:manual',
  /** MT5 filled the stop loss. */
  BROKER_SL: 'broker:sl',
  /** MT5 filled the take profit. */
  BROKER_TP: 'broker:tp',
  /**
   * MT5 closed it because it decided to — client terminal, web, expert, rollover.
   *
   * ⚠️⚠️ #916 (2026-10-02) — **THIS IS NOT AN ATTRIBUTION. It NAMES A BUCKET, not an actor.**
   *
   * This value read as an explanation for thirteen days and that is exactly what kept #916 open:
   * `broker:terminal` was accepted as "a person closed it at the desktop", the search stopped, and
   * "something closes winners early — unexplained" stayed unexplained. It is the LARGEST attributed
   * bucket, so the thing nobody could name was also the thing wearing the most confident label.
   *
   * MEASURED 2026-10-02, from `/history` on BOTH live bridges (closing deals isolated by grouping
   * on `positionId`):
   *
   * | deal reason | n (:5000) | what it actually was |
   * |---|---|---|
   * | 3 EXPERT | 33 | every one carried `TCS:time-stop` — OUR OWN time stop |
   * | 4 SL | 9 | `[sl 4261.55]` — a real stop fill |
   * | 5 TP | 1 | `[tp 8131.0]` — a real take-profit fill |
   * | **0 CLIENT** | **34** | **EMPTY comment** — see below |
   *
   * So reason 3 and reason 0 — an EA and a client — map to ONE value, and only one of them is even
   * plausibly a person. That conflation is the defect.
   *
   * ⚠️ **AN EMPTY CLOSING COMMENT IS NOW EVIDENCE, NOT MISSING DATA.** The bridge stamps
   * `TCS:<origin>` on every close it sends (`mt5_bridge_v2.py`, `/close/<ticket>`), and that stamp is
   * visible on the reason-3 deals above. **Therefore a closing deal with NO comment did not go
   * through our API at all.** 46 of 107 closing deals across both bridges are in that state.
   *
   * And they arrive in batches that no person could produce — `:5001`, 2026-09-29 12:58:17→19:
   * XAGUSD, US500, US30, FRA40, UK100, GER40 — **six positions, two seconds, all reason 0, all
   * empty-comment, all small.** Across the book, 78 of the 90 `broker:terminal` rows sit inside a
   * ≤5-second multi-close window.
   *
   * ⚠️ NOT the archive, checked: both ports run `mt5_bridge_v2.py` (the archived build's fixed
   * `'Close by TCS'` comment is not in play). Combined with the earlier eliminations — StopGuardian,
   * broker SL/TP, `closeAll`/`closeProfitable`, the time-stop — **the actor is outside this repo**,
   * acting as MT5 *CLIENT*. The next step is the terminal's own Expert/Journal log, not this codebase.
   *
   * ⚠️⚠️ **RESOLVED 2026-10-07 — THE ACTOR WAS THE OWNER.** Asked directly (R46): *"Yes I think that
   * was me bulk closing the positions."* The batches were manual bulk closes from the MT5 side, and
   * they **STOPPED 2026-10-02** (0 in the five days after; 2-13/day before). Per the owner's same-day
   * direction, the deal-reason fallback now reports a no-comment CLIENT/MOBILE/WEB/EXPERT close as
   * `user:manual` instead of parking it here — this value stays for broker-driven reasons
   * (7 rollover / 8 vmargins / 9 split) and for the 93 historic rows, so the 13-day record is not
   * rewritten. Reversal: restore the `case 0 … case 3` grouping in `closeReasonFromDealReason`.
   */
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
 * ⚠️ The values are the `mt5.DEAL_REASON_*` constants. MT5 reports an INTEGER; the bridge forwards
 * it as `reason` on each deal (see `/history` in `mt5_bridge_v2.py`) — verified live 2026-09-20:
 * 293/293 deals carried the field. An ABSENT value still maps to `BROKER_UNKNOWN` rather than a
 * default that reads like knowledge.
 *
 * ⚠️ PREFER `closeReasonFromComment()` when a comment is available: the enum cannot distinguish our
 * own bridge closes (reason 3 / 0) from anything else the terminal did.
 *
 * ⚠️ **CHANGED 2026-10-07 — OWNER DIRECTION, reversing the paragraph that used to sit here.**
 * The old text argued that mapping 0/1/2 (client/mobile/web) to `user:manual` "would claim
 * knowledge we do not have". The owner has since said the assumption IS wanted: *"The app should
 * assume that it was me if there is no record of the bot closing a position."* And it is no longer
 * a guess in the dark — asked who produced the batches, the owner answered *"Yes I think that was
 * me bulk closing the positions."* So CLIENT / MOBILE / WEB / EXPERT **without one of our stamps** →
 * `user:manual`. ⚠️ EXPERT is included deliberately: an EA close WITHOUT `TCS:<origin>` is not our
 * bridge, so it is the owner's desktop automation. A close WITH our stamp never reaches here — a
 * parsed comment wins (precedence: row's own reason > our comment > this enum > unknown).
 * ⚠️ This is a DATED ASSUMPTION and it is reversible in one line — restore the `case 0 … case 3`
 * grouping to `BROKER_TERMINAL` below. `BROKER_UNKNOWN` is unchanged and still means "no closing
 * deal was even observable" — absence of a record is NOT the same as a record that names nobody.
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
      // client | mobile | web | expert — no stamp of ours on the closing deal, so per owner
      // direction (2026-10-07) this is the owner's own action, not an unknown stranger.
      return CLOSE_REASONS.USER_MANUAL;
    case 7:
    case 8:
    case 9:
      // rollover | vmargins | split — broker-DRIVEN events, not a person. These stay in the
      // non-attributing bucket; folding them into user:manual would claim a person acted.
      return CLOSE_REASONS.BROKER_TERMINAL;
    default:
      // Including `undefined`. Naming that honestly is the point; see the header.
      return CLOSE_REASONS.BROKER_UNKNOWN;
  }
}

/**
 * OUR OWN comment on a closing deal → the actor that closed it, or `null` when the comment is not
 * one of ours.
 *
 * ⚠️ WHY THIS EXISTS (2026-09-20, #916). The deal-reason enum cannot attribute a close: the
 * bridge's closes surface as `3 (expert)` and terminal closes as `0 (client)`, and BOTH look the
 * same as "a human somewhere". Measured on the closed-trade book: 33 of 41 attributable closes
 * were reason 0 with an EMPTY comment — small winners (+0.125% average) closed in batches seconds
 * apart — and nothing in the app, the guardian, the time-stop or any scheduled job accounted for
 * them. The comment is the one field that survives with the deal, so the bridge now stamps
 * `TCS:<origin>` and the close can name its actor.
 *
 * Returns `null` (not `BROKER_UNKNOWN`) when the comment is foreign or absent, so the caller can
 * fall through to `closeReasonFromDealReason()` and still say something true.
 */
export function closeReasonFromComment(comment: string | null | undefined): CloseReason | null {
  const m = /^TCS:([a-z][a-z0-9-]{0,24})$/.exec(String(comment ?? '').trim());
  if (!m) return null;
  switch (m[1]) {
    case 'time-stop':
      return CLOSE_REASONS.SYSTEM_TIME_STOP;
    case 'session-exit':
      // #928 — the exit-side session boundary. Was parsed to null until 2026-10-07, so a
      // session-exit close fell through to the deal-reason enum (3) and landed in
      // broker:terminal — OUR OWN close wearing the non-attributing bucket.
      return CLOSE_REASONS.SYSTEM_SESSION_EXIT;
    case 'manual':
      return CLOSE_REASONS.USER_MANUAL;
    case 'close-all':
    case 'close-profitable':
      // The mt5.controller bulk endpoints — invoked through our API by the operator (or their
      // tooling). That is a person's instruction, not a bot mechanism.
      return CLOSE_REASONS.USER_MANUAL;
    default:
      // An origin we do not know yet — fall through rather than inventing a mapping.
      return null;
  }
}

/** Human-facing label. Kept beside the codes so the two cannot drift. */
export const CLOSE_REASON_LABELS: Record<string, string> = {
  [CLOSE_REASONS.SYSTEM_TIME_STOP]: 'Time stop (held past max hold)',
  [CLOSE_REASONS.SYSTEM_RECONCILED]: 'Reconciled — no broker counterpart',
  [CLOSE_REASONS.USER_MANUAL]: 'Closed manually',
  [CLOSE_REASONS.BROKER_SL]: 'Stop loss filled',
  [CLOSE_REASONS.BROKER_TP]: 'Take profit filled',
  [CLOSE_REASONS.BROKER_TERMINAL]: 'Closed at the broker — actor NOT identified',
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
