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

/** What a run's exits could not reproduce live, aggregated. */
export interface ExitDivergence {
  trades: number;
  /** Trades that exited on a TIGHTENED stop. Live records the trail decision and moves nothing (#936). */
  trailExits: number;
  trailPnl: number;
  /** Trades that ended because the data ran out — a simulation artefact, not a real close. */
  eodExits: number;
  eodPnl: number;
  /** Exit reasons with NO row in the map — a coverage defect. Reported, never swallowed. */
  unmapped: string[];
  /** One sentence a panel can print verbatim, or `null` when every exit maps exactly. */
  note: string | null;
}

/**
 * ── DECISION (2026-11-23, primary) ────────────────────────────────────────────────────────────────
 * WHAT:      every run reports `exitDivergence` — how many of its exits live could not reproduce —
 *            aggregated from the trades it already produced, on both the run response and the stored
 *            read, and on the movers selection run over its ADMITTED population.
 * WHY:       the per-trade `closeReason`/`closeReasonNote` fields marked `TRAIL` as `qualified` and
 *            `EOD` as having no live counterpart, but only ONE TRADE AT A TIME. A reader looking at a
 *            win rate, a Σ P&L or an equity curve had no way to see that part of the population could
 *            never have happened in the account — and the owner tuned a bot toward "do not take
 *            profit, let the trail work", which is precisely the direction where that gap is largest.
 * ⚠️ WHAT IT DOES NOT DO: it does not re-map a `TRAIL` exit to a plain stop, and it does not remove
 *            one from the P&L. The simulation really filled there; re-mapping would erase the very
 *            distinction this file exists to preserve (#936). It is a report, not a re-decision.
 * REVERSE BY: deleting the `summariseExitDivergence()` call sites in `backtest.service.ts` (both) and
 *            `selection-run.service.ts`, plus the `exitDivergence` fields on both result types.
 * REGISTER:  docs/SETTLED-DECISIONS.md row 251
 * GUARD:     exit-equivalence.spec.ts (5 cases, both silent directions)
 *
 * ⚠️ THIS IS A REPORT, NOT A RE-DECISION. It changes no exit, no stop and no threshold: it counts what
 * the run already did and names what live cannot reproduce.
 */
export function summariseExitDivergence(
  trades: Array<{ exitReason?: string; pnl?: number }> | null | undefined,
): ExitDivergence {
  const list = Array.isArray(trades) ? trades : [];
  const money = (n: number) => Math.round(n * 100) / 100;
  let trailExits = 0;
  let trailPnl = 0;
  let eodExits = 0;
  let eodPnl = 0;
  const unmapped = new Set<string>();

  for (const t of list) {
    const reason = t?.exitReason;
    const pnl = typeof t?.pnl === 'number' && Number.isFinite(t.pnl) ? t.pnl : 0;
    if (reason === 'TRAIL') { trailExits += 1; trailPnl += pnl; }
    else if (reason === 'EOD') { eodExits += 1; eodPnl += pnl; }
    else if (reason && !engineExitEquivalence(reason)) unmapped.add(reason);
  }

  const parts: string[] = [];
  if (trailExits > 0) {
    parts.push(
      `${trailExits} of ${list.length} trades exited on a TIGHTENED stop — the live guardian only RECORDS the trail decision and moves nothing (#936), so these exits would not have happened in the account`,
    );
  }
  if (eodExits > 0) {
    parts.push(`${eodExits} ended because the data ran out (not a real close)`);
  }
  if (unmapped.size > 0) {
    parts.push(`${unmapped.size} exit reason(s) have no live equivalent recorded: ${[...unmapped].join(', ')}`);
  }

  return {
    trades: list.length,
    trailExits,
    trailPnl: money(trailPnl),
    eodExits,
    eodPnl: money(eodPnl),
    unmapped: [...unmapped],
    note: parts.length ? parts.join('; ') + '.' : null,
  };
}
