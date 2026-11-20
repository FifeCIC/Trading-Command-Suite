/**
 * position-bar.ts — MANAGING AN OPEN POSITION THROUGH ONE BAR, as one pure function.
 *
 * ── WHY THIS EXISTS (2026-11-20) ─────────────────────────────────────────────────────────────────
 * The backtest engine manages a position inside a ~180-line inline loop: measure the excursion, test
 * the stop in force, test the target, test the bot's time stop, then tighten the stop for the next
 * bar. Every rule it applies is a rule the live path also applies, and until now the only way to reuse
 * any of it was to copy the loop.
 *
 * That copy is what this file exists to prevent. A second DRIVER is legitimate — the engine walks one
 * trade forward at a time, while a live account holds several at once and therefore needs a
 * cooldown and a position cap — but a second DECISION is not. This module holds the decision; a driver
 * holds only what it alone knows (when it may open, how many it may hold).
 *
 * ── THE ORDER IS THE DECISION, SO IT IS DOCUMENTED ───────────────────────────────────────────────
 *
 *   1. EXCURSION   measured on the RAW bar extremes, before any test — so a trade that exits on this
 *                  bar still records how far it went against and in favour. Losing that on the exit
 *                  bar biases the excursion statistics toward the trades that survived.
 *   2. STOP        the level IN FORCE, set from an EARLIER bar — never from this bar's own high.
 *                  Tightening a stop from this bar's high and then testing this bar's low would be
 *                  look-ahead: OHLC cannot order an intrabar high against an intrabar low.
 *   3. TARGET      the take-profit level.
 *   3a. MONEY      the bot's ABSOLUTE target in account currency, judged at the close.
 *   4. TIME STOP   a decision to leave at the close, so it comes AFTER the levels. When both could
 *                  fire on one bar, the level the market actually traded through is the defensible
 *                  exit; booking the close first would invent an exit while ignoring a real one.
 *                  The verdict is passed IN (`heldTooLong`) because `maxHoldHours` arithmetic has its
 *                  own module and its own inclusive-boundary spec (`modules/backtest/max-hold.ts`).
 *   5. TIGHTEN     for the NEXT bar only, from this bar's extremes.
 *
 * ⚠️ A TIGHTER STOP IS NEVER LOOSER. Every candidate is combined with `max`/`min` against the stop
 * already in force; a stop that moves backwards is not a stop.
 *
 * ⚠️ THIS MODULE DOES NOT KNOW ABOUT MONEY, UNITS OR COMMISSION — the engine computes them and passes
 * the result in (`money.pnlAtClose`). It does own the VERDICT, through `moneyTargetVerdict()`, so the
 * "has the target been reached" question has one answer on both paths.
 *
 * ── DECISION (2026-11-20, primary) ────────────────────────────────────────────────────────────────
 * WHAT:      the per-bar management rules are extracted here, and the engine drives them by calling
 *            this function rather than by keeping its own copy of the loop.
 * WHY:       a second DRIVER is legitimate (an account holds several positions and needs a cooldown and
 *            a cap; the engine walks one trade forward at a time) but a second DECISION is not — it is
 *            the copy that makes a backtest unable to improve a strategy. The proof of extraction is
 *            that a 175-trade run is byte-identical after it.
 * INSTEAD OF: leaving the rules inline and writing the chronological driver against a second copy.
 * REVERSE BY: restoring the inline block from `git show HEAD:nest/src/modules/backtest/backtest.service.ts`
 *            and deleting this module.
 * REGISTER:  docs/SETTLED-DECISIONS.md row 241
 * GUARD:     position-bar.spec.ts (17 cases — the ORDER, not only the arithmetic), plus the
 *            before/after hash of the same run recorded in the register row.
 */
import { trailTriggerPrice } from './simulated-tsl';
import { moneyTargetVerdict } from './money-target';

export type PositionSide = 'buy' | 'sell';

export interface PositionBar {
  /** The bar's first price. Used ONLY by the session boundary, whose instant is the bar's opening. */
  open: number;
  high: number;
  low: number;
  close: number;
  /** Epoch milliseconds. Carried so an exit can be stamped at the bar that caused it. */
  timeMs: number;
}

export interface PositionState {
  side: PositionSide;
  /** The price the position was opened at. Used as the "lock at breakeven" level. */
  entryPrice: number;
  /** The stop as CONFIGURED. A fill at this level is the configured stop; any other is a trail. */
  initialStop: number;
  /** The stop actually in force — starts at `initialStop` and only ever tightens. */
  stop: number;
  target: number;
  /** Best price seen BEFORE this bar. Seeded at entry so the first bar can tighten. */
  bestPrice: number;
  /** Worst excursion against the position so far, as % of entry. */
  worstPct: number;
  /** Best excursion in its favour so far, as % of entry. */
  bestPct: number;
}

/** The optional tightening plan (the engine's `StopPlan`). Every field absent = that step is off. */
export interface PositionRules {
  lockAtPct?: number | null;
  trailPct?: number | null;
  stepPct?: number | null;
  tightenPct?: number | null;
}

export type PositionExitKind = 'SESSION' | 'SL' | 'TRAIL' | 'TP' | 'TIME' | 'TARGET';

export interface PositionExit {
  kind: PositionExitKind;
  price: number;
  timeMs: number;
}

export interface BarDecision {
  /** The state AFTER this bar — stop tightened, excursions updated. Ignored once `exit` is set. */
  state: PositionState;
  exit: PositionExit | null;
}

/**
 * The bot's ABSOLUTE money target, expressed for one bar.
 *
 * ⚠️ `pnlAtClose` IS COMPUTED BY THE DRIVER, because only it knows the unit count, and the size is a
 * decision of its own (`position-sizing.ts`, `applyAffordability()`). Passing it in keeps this module
 * pure, and keeps the reach-the-target question here so both paths answer it the same way.
 */
export interface MoneyAtBar {
  /** `trading_strategy.takeProfitAmount`, account currency. NULL/0 = no opinion, and that is most bots. */
  targetAmount?: number | null;
  /** Unrealised P&L at this bar's close, same currency. `null` when it cannot be measured. */
  pnlAtClose?: number | null;
}

const sign = (side: PositionSide): 1 | -1 => (side === 'buy' ? 1 : -1);

/** Percent move in the position's favour, from entry to `price`. Negative when against. */
function favourablePct(side: PositionSide, entryPrice: number, price: number): number {
  return (sign(side) * (price - entryPrice)) / entryPrice * 100;
}

/**
 * What happened to this position on this bar.
 *
 * @param state       The position as it stood BEFORE this bar's tests.
 * @param bar         This bar.
 * @param rules       The tightening plan. `{}` = no tightening.
 * @param heldTooLong The caller's own time-stop verdict for this bar.
 */
/**
 * What the DRIVER's own clock rules say about this bar, already decided.
 *
 * ⚠️ THESE ARE TWO MECHANISMS WITH TWO DIFFERENT INSTANTS, which is why they arrive as a kind rather
 * than a flag:
 *   `SESSION` — the bot's `exitBeforeUtc` boundary was passed. It is an INSTANT: the clock crossed at
 *               the bar's OPEN, before this bar's range was traded, so it exits at `bar.open` and it is
 *               tested FIRST.
 *   `TIME`    — the bot's `maxHoldHours` limit is exceeded. It is a decision to leave at the CLOSE, so
 *               it is tested AFTER the levels (a level the market traded through is more defensible).
 *
 * The combination itself (`decideExitTrigger()`, which also names which mechanism wins when both are
 * due) belongs to the caller: it owns the two columns.
 */
export type TimedExit = 'SESSION' | 'TIME' | null;

export function managePositionBar(
  state: PositionState,
  bar: PositionBar,
  rules: PositionRules = {},
  timed: TimedExit = null,
  money?: MoneyAtBar,
): BarDecision {
  const isLong = state.side === 'buy';
  if (!(state.entryPrice > 0)) {
    // Refused rather than computed: a non-positive entry makes every excursion a division by zero or a
    // sign flip, and the caller would read the result as a trade that never moved.
    throw new Error(`managePositionBar: entry price must be > 0, got ${state.entryPrice}`);
  }

  // ── 1. Excursion, on the RAW extremes, before any test ──
  const adversePct = isLong
    ? ((state.entryPrice - bar.low) / state.entryPrice) * 100
    : ((bar.high - state.entryPrice) / state.entryPrice) * 100;
  const inFavourPct = isLong
    ? ((bar.high - state.entryPrice) / state.entryPrice) * 100
    : ((state.entryPrice - bar.low) / state.entryPrice) * 100;
  const next: PositionState = {
    ...state,
    worstPct: Math.max(state.worstPct, adversePct),
    bestPct: Math.max(state.bestPct, inFavourPct),
  };

  // ── 2. The stop IN FORCE (set from an earlier bar) ──
  const stopTouched = isLong ? bar.low <= state.stop : bar.high >= state.stop;
  if (stopTouched) {
    return {
      state: next,
      exit: {
        // A tightened stop is not the configured stop — say which one fired, so a reader is never told
        // the original bracket stopped them out when the trail had already moved it.
        kind: state.stop === state.initialStop ? 'SL' : 'TRAIL',
        price: state.stop,
        timeMs: bar.timeMs,
      },
    };
  }

  // ── 3. The target ──
  if (isLong ? bar.high >= state.target : bar.low <= state.target) {
    return { state: next, exit: { kind: 'TP', price: state.target, timeMs: bar.timeMs } };
  }

  // ── 4. The bot's ABSOLUTE money target, at the close ──
  // ⚠️ AFTER the percentage target and BEFORE the time stop. Reaching an amount in account currency can
  // only be known once a price is observed, and a percentage level the market traded through is the
  // more specific event — so the same "levels beat close-price decisions" rule as the time stop applies.
  // ⚠️ A BOT WITH NO TARGET IS UNCHANGED: `moneyTargetVerdict` returns `not-configured` for NULL/0, so
  // 77 of 78 bots take exactly the path they took before this existed.
  if (money) {
    const verdict = moneyTargetVerdict({ targetAmount: money.targetAmount, pnl: money.pnlAtClose });
    if (verdict.reached) {
      return { state: next, exit: { kind: 'TARGET', price: bar.close, timeMs: bar.timeMs } };
    }
  }

  // ── 5. The bot's own time stop, at the close ──
  if (heldTooLong) {
    return { state: next, exit: { kind: 'TIME', price: bar.close, timeMs: bar.timeMs } };
  }

  // ── 6. Tighten for the NEXT bar ──
  // ⚠️ `bestPrice` is updated HERE and not at the top, so a bar that exits never feeds the trail. That
  // is not tidiness: it is the same look-ahead rule as the stop test, expressed on the value the trail
  // is computed from.
  const bestPrice = isLong ? Math.max(next.bestPrice, bar.high) : Math.min(next.bestPrice, bar.low);
  next.bestPrice = bestPrice;

  let candidate = next.stop;
  const gainPct = favourablePct(state.side, state.entryPrice, bestPrice);

  // 1. Lock at breakeven once the trade is far enough in front.
  if (rules.lockAtPct != null && gainPct >= rules.lockAtPct) {
    candidate = isLong ? Math.max(candidate, state.entryPrice) : Math.min(candidate, state.entryPrice);
  }
  // 2. Trail a fixed distance behind the best price.
  if (rules.trailPct != null && gainPct > 0) {
    // ⚠️ THE FORMULA IS THE GUARDIAN'S (#1242). `trailTriggerPrice()` is the same expression
    // `observeSimulatedTsl()` uses on the live path, so the two cannot drift.
    const trailStop = trailTriggerPrice(state.side, bestPrice, rules.trailPct);
    candidate = isLong ? Math.max(candidate, trailStop) : Math.min(candidate, trailStop);
  }
  // 3. Step-tighten: every `stepPct` of favourable move, pull the stop in by `tightenPct`.
  if (rules.stepPct != null && rules.tightenPct != null && gainPct > 0) {
    const steps = Math.floor(gainPct / rules.stepPct);
    if (steps > 0) {
      const stepped = isLong
        ? state.initialStop + state.entryPrice * (steps * rules.tightenPct) / 100
        : state.initialStop - state.entryPrice * (steps * rules.tightenPct) / 100;
      candidate = isLong ? Math.max(candidate, stepped) : Math.min(candidate, stepped);
    }
  }

  // NEVER loosen: a stop that moves backwards is not a stop.
  next.stop = isLong ? Math.max(next.stop, candidate) : Math.min(next.stop, candidate);
  return { state: next, exit: null };
}
