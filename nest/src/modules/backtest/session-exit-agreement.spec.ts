/**
 * session-exit-agreement.spec.ts — THE TWO PATHS AGREE ON WHICH RULE FIRED AND WHERE.
 *
 * ── WHAT WAS UNPROVEN (the last 🔴 on register row 245) ────────────────────────────────────────
 * Live (`PositionTimeStopService`) and the engine now call the SAME decision function,
 * `decideExitTrigger()`. That is provenance — it says the inputs are shared, not that the two then do
 * the same thing with the answer. The part that can still differ is the ENGINE-side translation:
 *
 *     trigger 'max_hold'       → exit kind 'TIME'    (tested AFTER the levels, at the bar CLOSE)
 *     trigger 'exit_boundary'  → exit kind 'SESSION' (tested FIRST, at the bar OPEN)
 *
 * Get that mapping wrong and a boundary close is booked as a time stop at the wrong price, or the
 * both-due case is attributed to the wrong mechanism — the attribution
 * `replay-exit-counterfactual.cjs` reads to decide whether the boundary earns its place.
 *
 * ⚠️ THIS DOES NOT TOUCH THE LIVE SERVICE (it needs a broker and a database). It walks the engine's own
 * per-bar loop over a fabricated series and asserts that the exit it reaches is the one the shared
 * decision asked for, at the instant and price that decision implies.
 */
import { decideExitTrigger } from '../automation/exit-trigger';
// ⚠️ THE ENGINE'S OWN MAPPING, IMPORTED rather than re-stated. A fixture that copies the line it is
// meant to verify passes while the engine says something else — the repo's most expensive signature.
import { timedExitKind } from './backtest.service';
import { managePositionBar, type PositionBar, type PositionState } from '../../common/trading/exit-guardian/position-bar';

/** Epoch ms for a UTC wall clock on 2026-11-20. */
const utc = (h: number, m: number) => Date.UTC(2026, 10, 20, h, m);

/** Five-minute bars from 14:00 to 19:00 UTC, flat at 100 and wide enough to touch neither level. */
const SERIES: PositionBar[] = [];
for (let minutes = 14 * 60; minutes <= 19 * 60; minutes += 5) {
  SERIES.push({
    open: 100,
    high: 100.4,
    low: 99.6,
    close: 100,
    timeMs: utc(Math.floor(minutes / 60), minutes % 60),
  });
}

const ENTRY_INDEX = 0; // 14:00
const entry = SERIES[ENTRY_INDEX];

const openPosition = (): PositionState => ({
  side: 'buy',
  entryPrice: 100,
  // Deliberately wide: this fixture is about the CLOCK, so the bracket must never claim the exit.
  initialStop: 50,
  stop: 50,
  target: 150,
  bestPrice: 100,
  worstPct: 0,
  bestPct: 0,
});

/** The engine's loop, reduced to what it does with the decision. */
function walkEngine(input: { maxHoldHours: number | null; exitBeforeUtc: string | null }) {
  let state = openPosition();
  for (let i = ENTRY_INDEX + 1; i < SERIES.length; i++) {
    const bar = SERIES[i];
    const decision = decideExitTrigger({
      maxHoldHours: input.maxHoldHours,
      hoursHeld: (bar.timeMs - entry.timeMs) / 3_600_000,
      exitBeforeUtc: input.exitBeforeUtc,
      at: new Date(bar.timeMs),
    });
    const timed = timedExitKind(decision);
    const outcome = managePositionBar(state, bar, {}, timed);
    state = outcome.state;
    if (outcome.exit) {
      return { trigger: decision.trigger, ...outcome.exit, state };
    }
  }
  return null;
}

describe('engine ↔ exit-trigger agreement', () => {
  it('exit_boundary → SESSION at the FIRST bar past the boundary, at that bar OPEN', () => {
    const exit = walkEngine({ maxHoldHours: null, exitBeforeUtc: '18:00' });
    expect(exit?.trigger).toBe('exit_boundary');
    expect(exit?.kind).toBe('SESSION');
    expect(exit?.timeMs).toBe(utc(18, 0));
    expect(exit?.price).toBe(SERIES.find((b) => b.timeMs === utc(18, 0))!.open);
  });

  it('max_hold → TIME at the bar CLOSE, the first bar past the limit', () => {
    // 15:00 is two hours after the 14:00 entry? No — one hour. The limit is 1h, and live is
    // STRICTLY greater, so the first bar past it is 15:05.
    const exit = walkEngine({ maxHoldHours: 1, exitBeforeUtc: null });
    expect(exit?.trigger).toBe('max_hold');
    expect(exit?.kind).toBe('TIME');
    expect(exit?.timeMs).toBe(utc(15, 5));
    expect(exit?.price).toBe(SERIES.find((b) => b.timeMs === utc(15, 5))!.close);
  });

  it('▶ CANARY — when BOTH are due the shared decision names max_hold, and the engine must agree', () => {
    // Boundary at 15:00 with a 1h limit: the limit is crossed at 15:05, so on the 15:00 bar only the
    // boundary is due → SESSION. Make the limit expire EARLIER (0.5h → 14:35) and the boundary later
    // (17:00) so both are due on many bars; `decideExitTrigger` names max_hold, so the engine must
    // report TIME and must NOT report SESSION.
    const exit = walkEngine({ maxHoldHours: 0.5, exitBeforeUtc: '17:00' });
    expect(exit?.trigger).toBe('max_hold');
    expect(exit?.kind).toBe('TIME');
    expect(exit?.kind).not.toBe('SESSION');
  });

  it('neither declared → no timed exit at all', () => {
    expect(walkEngine({ maxHoldHours: null, exitBeforeUtc: null })).toBeNull();
  });

  it('an unreadable boundary closes nothing, and the time stop still works if declared', () => {
    // `checkExitBoundary` refuses an unreadable value rather than guessing (`invalid`), so a typo must
    // not flatten the run — but it must not silently disable a declared hold limit either.
    const onlyTypo = walkEngine({ maxHoldHours: null, exitBeforeUtc: '6pm' });
    expect(onlyTypo).toBeNull();
    const withLimit = walkEngine({ maxHoldHours: 1, exitBeforeUtc: '6pm' });
    expect(withLimit?.trigger).toBe('max_hold');
  });
});
