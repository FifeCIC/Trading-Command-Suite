/**
 * exit-equivalence.ts — DOES A SIMULATED EXIT MEAN THE SAME AS A LIVE ONE?
 *
 * ── WHY THIS EXISTS (2026-11-20) ────────────────────────────────────────────────────────────────
 * A stored run says `exitReason: 'TP' | 'SL' | 'TRAIL' | 'TIME' | 'EOD'`. A live close records
 * `trade.closeReason` from `CLOSE_REASONS` — `broker:tp`, `broker:sl`, `system:time-stop`, and so on.
 * Two vocabularies for one concept, so nobody can ask "does the backtest exit the way the bot does?"
 * without translating by hand, and a hand translation is where a `TRAIL` quietly becomes a `broker:sl`
 * and the trail disappears from the comparison.
 *
 * ⚠️ THE MAPPING IS A JUDGEMENT, SO EACH ROW STATES ITS REASON — and three of the five are NOT a
 * straight equality:
 *
 *   · `TP` → `broker:tp`      the level was hit in the market, exactly as a resting TP order fills.
 *   · `SL` → `broker:sl`      the same, for the stop.
 *   · `TRAIL` → `broker:sl`   a tightened stop is still a resting order that fills, BUT live has no
 *                             acting trail at all (#936 records the decision and moves nothing), so the
 *                             trail distinction exists ONLY in a run. Mapping it to `broker:sl` would
 *                             erase that, so the note carries it and `equivalent: 'qualified'` says so.
 *   · `TIME` → `system:time-stop`  the same mechanism, named the same way.
 *   · `EOD` → **none**        ending a trade because the data ended is a simulation artefact. Live has
 *                             no equivalent event, and inventing one would let a backtest-only exit be
 *                             counted as a real one.
 *
 * ⚠️ AN UNKNOWN VALUE RETURNS `null`, NEVER A GUESS. A sixth exit reason added to the engine without a
 * row here must fail the coverage spec, not fall through to `broker:unknown` — `broker:unknown` is a
 * real live value meaning "the broker closed it and we cannot say why", which is a different fact.
 *
 * ── DECISION (2026-11-20, primary) ────────────────────────────────────────────────────────────────
 * WHAT:      every simulated exit is ALSO reported in the live `CLOSE_REASONS` vocabulary
 *            (`closeReason` on the trade), and `EOD` reports `null` because live has no such event.
 * WHY:       a run and an account cannot be compared at all while they name the same exit differently,
 *            and the comparison is the only reason to run a backtest. `TRAIL` is mapped but marked
 *            `qualified` so the run cannot claim a protection the live bot does not have (#936).
 * INSTEAD OF: leaving `exitReason` as the only field and translating by hand when reading a result.
 * REVERSE BY: deleting the two `closeReason` fields from `TradeRecord` and the call to
 *            `engineExitCloseReason()` in `backtest.service.ts`.
 * REGISTER:  docs/SETTLED-DECISIONS.md row 240
 * GUARD:     exit-equivalence.spec.ts (7 cases, incl. the EOD-vs-unmapped distinction)
 */
import { CLOSE_REASONS } from '../close-reason';

export const ENGINE_EXIT_REASONS = ['TP', 'SL', 'TRAIL', 'TIME', 'EOD', 'TARGET', 'SESSION'] as const;
export type EngineExitReason = (typeof ENGINE_EXIT_REASONS)[number];

export interface ExitEquivalence {
  /** The live vocabulary value, or `null` when no live event corresponds. */
  closeReason: string | null;
  /**
   * `exact`      the two name the same thing;
   * `qualified`  the live value fits, but a distinction exists only on one side (see `note`);
   * `none`       there is no live counterpart at all.
   */
  equivalent: 'exact' | 'qualified' | 'none';
  note: string;
}

const MAP: Record<EngineExitReason, ExitEquivalence> = {
  TP: {
    closeReason: CLOSE_REASONS.BROKER_TP,
    equivalent: 'exact',
    note: 'The target level was hit in the market — the same event as a resting take-profit filling.',
  },
  SL: {
    closeReason: CLOSE_REASONS.BROKER_SL,
    equivalent: 'exact',
    note: 'The stop level was hit in the market — the same event as a resting stop filling.',
  },
  TRAIL: {
    closeReason: CLOSE_REASONS.BROKER_SL,
    equivalent: 'qualified',
    note: 'A tightened stop still fills at the broker, BUT the live guardian only RECORDS the trail decision (#936) and moves nothing — so the trail exists in a run and not in the account.',
  },
  TIME: {
    closeReason: CLOSE_REASONS.SYSTEM_TIME_STOP,
    equivalent: 'exact',
    note: 'The bot’s own max-hold time stop, the same mechanism `position-time-stop.service.ts` applies live.',
  },
  EOD: {
    closeReason: null,
    equivalent: 'none',
    note: 'The data ended while the position was open. Live has no equivalent event — this exit is a property of the simulation and must not be counted as a real close.',
  },
  TARGET: {
    closeReason: CLOSE_REASONS.SYSTEM_TAKE_PROFIT,
    equivalent: 'exact',
    note: 'The bot’s ABSOLUTE money target (`takeProfitAmount`) was reached and the position closed at the market — the same event `stop-guardian.service.ts` acts on live.',
  },
  SESSION: {
    closeReason: CLOSE_REASONS.SYSTEM_SESSION_EXIT,
    equivalent: 'exact',
    note: 'The bot’s `exitBeforeUtc` boundary was passed, so the position was flattened at the market — the same event `decision-trigger`/`position-time-stop.service.ts` acts on live (#928).',
  },
};

/** Translate one engine exit reason, or `null` when it is not in the map. */
export function engineExitEquivalence(exitReason: string): ExitEquivalence | null {
  return (MAP as Record<string, ExitEquivalence>)[exitReason] ?? null;
}

/**
 * The live close reason for an engine exit, or `null` when there is none.
 *
 * ⚠️ `null` IS TWO CASES AND THE CALLER MUST TELL THEM APART: an unmapped reason returns `null` from
 * `engineExitEquivalence` (a defect — the coverage spec fails), while `EOD` returns a row whose
 * `closeReason` is `null` (a correct absence). Never render both as "unknown".
 */
export function engineExitCloseReason(exitReason: string): string | null {
  return engineExitEquivalence(exitReason)?.closeReason ?? null;
}
