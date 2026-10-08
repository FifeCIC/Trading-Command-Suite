/**
 * pre-open-session.ts — the ADVISORY pre-open alert decision (#981).
 * =================================================================
 *
 * THE OWNER'S DECISION THIS IMPLEMENTS (2026-09-23):
 *
 *     "I would like the app to use alert of market opening ahead, **no automatic effect**."
 *
 * So this is deliberately a PLANNER, not a gate. It answers ONE question — "should an alert be
 * raised right now, and what should it say?" — and its output is a string. Nothing here can pause,
 * close, block or size anything; the caller writes an alert row and nothing else.
 *
 * ⚠️ WHY AN ALERT AND NOT A GATE — do not "fix" this into one.
 * #928 Part 2 measured the pre-NY-open window and it did not reach significance (hour-12 UTC
 * demeaned −0.0255% but t = −0.82 over 11 days; ~127 days needed). An alert is justified by the
 * observation; a gate is not. Raising the alert is also how the sample gets collected deliberately
 * instead of reconstructed afterwards.
 *
 * ⚠️ THE COLLAPSE CONSTRAINT IS LOAD-BEARING, SO THE TITLE CARRIES NO NUMBER.
 * Alerts collapse on `(type, title)` on UNDISMISSED rows (see `common/alerts/alert-collapse.ts`).
 * A title carrying the minute count ("… opens in 27 minutes") would treat every tick as a new
 * condition and insert one row per tick — reproducing the measured disasters that file documents
 * ("1 MT5 Bridge(s) Down" ×2,210). The title is therefore DAY-scoped and stable for the whole
 * window; the changing numbers live in `detail`, which the collapse updates in place. Measured
 * 2026-10-08: one row per window, repeatCount growing, exactly as designed.
 *
 * ⚠️ "CANNOT JUDGE" IS A THIRD STATE, NOT "NO ALERT".
 * A failed or unresolvable session read returns `kind: 'unknown'` — never `none`. Absence is not a
 * negative (the repo's own rule: `[]` is information, `null` is the absence of information, an
 * error is a third thing — an empty list and a failed query must never render the same).
 *
 * AXIS: FX-SESSION (`market-sessions.service.ts`), read through `getSessionStates()`. This is NOT
 * the bot-policy axis and NOT the venue axis — see #851 for how the three relate.
 */
import type { SessionState } from './market-sessions.service';

/**
 * The session this alert watches, and the bot tag that means "this bot waits for it".
 * `ny` is the FX-session scope; `us` is the session-window tag for the same 09:30–16:00 ET clock
 * (`SESSION_DEFS` in `trading/session-window.ts`). Start with NY per #981; adding London/Tokyo is
 * a second entry here plus a second loop, not a redesign.
 */
export const PRE_OPEN_SESSION = { scope: 'ny', botTag: 'us', label: 'New York (US session)' } as const;

export interface PreOpenSessionInput {
  /** Full session roster read (`MarketSessionsService.getSessionStates()`). */
  states: SessionState[];
  /** Minutes before open at which the alert fires. 0 (or less) disables it. */
  thresholdMinutes: number;
  /** Names of ACTIVE bots whose declared window includes `PRE_OPEN_SESSION.botTag`. */
  botNames: string[];
  /** Open positions right now — context for the reader of the alert. */
  openPositions: number;
  at?: Date;
}

export type PreOpenSessionOutcome =
  | { kind: 'disabled' }
  | { kind: 'unknown'; reason: string }
  | { kind: 'none'; reason: 'session-open' | 'outside-window'; minutesUntilOpen: number | null }
  | { kind: 'alert'; title: string; detail: string; minutesUntilOpen: number };

export function planPreOpenSession(input: PreOpenSessionInput): PreOpenSessionOutcome {
  const { states, thresholdMinutes, botNames, openPositions, at = new Date() } = input;

  if (!(thresholdMinutes > 0)) return { kind: 'disabled' };

  const ny = (states || []).find((s) => s.scope === PRE_OPEN_SESSION.scope);
  if (!ny) {
    return { kind: 'unknown', reason: `no "${PRE_OPEN_SESSION.scope}" row in the session read` };
  }

  if (ny.active) {
    return { kind: 'none', reason: 'session-open', minutesUntilOpen: null };
  }

  const m = ny.minutesUntilOpen;
  if (m === null || !Number.isFinite(m)) {
    return {
      kind: 'unknown',
      reason: `${PRE_OPEN_SESSION.label} is not open and its next open could not be resolved`,
    };
  }

  if (m <= 0 || m > thresholdMinutes) {
    return { kind: 'none', reason: 'outside-window', minutesUntilOpen: m };
  }

  const date = at.toISOString().slice(0, 10);
  const botText = botNames.length
    ? `${botNames.length} bot(s): ${botNames.slice(0, 4).join(', ')}` +
      (botNames.length > 4 ? ` +${botNames.length - 4} more` : '')
    : 'none';

  return {
    kind: 'alert',
    minutesUntilOpen: m,
    // Date-scoped, minute-free — see the header. One row per window; a new day is a new alert.
    title: `${PRE_OPEN_SESSION.label} opens soon — ${date}`,
    detail:
      `${PRE_OPEN_SESSION.label} opens in ${m} minute(s). ` +
      `Bots waiting on this session: ${botText}. ` +
      `Open positions right now: ${openPositions}. ` +
      `Advisory only — no automatic trade action.`,
  };
}
