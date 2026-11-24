/**
 * parity-exposure.ts — HOW MUCH OF **THIS RUN** RODE ON A MECHANISM LIVE WOULD NOT REPRODUCE.
 *
 * ── WHY THIS EXISTS (2026-11-24, continuing #1335) ───────────────────────────────────────────────
 * The parity register answers "does the engine share this mechanism with live?". It answers it for the
 * SYSTEM. A reader looking at a 4,000.94 five-day total needs the other question: **"how much of THIS
 * result came from the mechanisms that differ?"** Without that, the register is a disclaimer rather than
 * a measurement — and a run whose exits were all time-stops is a very different claim from one whose
 * exits were all engine-only data ends.
 *
 * Measured on `movers-winners-2026-11-20` before this file existed: **53 trades, 25 TIME, 28 EOD, zero
 * SL/TRAIL/TP** — so the divergent stop-fill and trail mechanisms were *never touched*, while 28 of 53
 * exits could not have happened in an account at all. That is precisely what a reader cannot see today.
 *
 * ── ⚠️ IT IS A REPORT, NOT A RE-DECISION ────────────────────────────────────────────────────────
 * No P&L is adjusted and no exit is re-mapped. The simulation filled where it filled; this attributes
 * each trade to the mechanism that decided it and names the verdict that mechanism carries. The one
 * exception is `EOD`, which is not a mechanism at all — it is the data ending — and it is reported as
 * such rather than being quietly folded into "the bars were different".
 *
 * ── ⚠️ EVERY EXIT REASON MUST MAP, AND THE SPEC ENFORCES IT ─────────────────────────────────────
 * `ENGINE_EXIT_REASONS` is the engine's own vocabulary. A reason with no row here would be a trade the
 * attribution silently drops, which would make the shares add up to less than 100% with no error. The
 * spec iterates the engine's list, so a SEVENTH exit reason fails the build until it is attributed.
 *
 * REGISTER: docs/SETTLED-DECISIONS.md row 269
 * GUARD:    parity-exposure.spec.ts
 */
import { ENGINE_EXIT_REASONS, type EngineExitReason } from './exit-guardian/exit-equivalence';
import { PARITY_REGISTER, type ParityVerdict } from './parity-register';

/**
 * Engine exit → the parity row whose mechanism decided it.
 *
 * ⚠️ `EOD` maps to `bars` and is flagged `engineOnly`: the data ending is not a decision any account
 * makes, so it must never be counted as a mechanism live "shares".
 */
export const EXIT_TO_MECHANISM: Record<EngineExitReason, { mechanism: string; engineOnly?: boolean }> = {
  SL: { mechanism: 'stop-fill' },
  TRAIL: { mechanism: 'trail' },
  TP: { mechanism: 'tp-fill' },
  TARGET: { mechanism: 'money-target' },
  TIME: { mechanism: 'time-stop' },
  SESSION: { mechanism: 'time-stop' },
  EOD: { mechanism: 'bars', engineOnly: true },
};

export interface ExposureRow {
  /** The exit reason as the engine recorded it, or `null` for an unmapped one. */
  exitReason: string | null;
  mechanism: string;
  verdict: ParityVerdict | 'unknown' | 'engine-only';
  trades: number;
  pnl: number;
  /** Share of the run's trade count, 0-1. `0` when the run produced no trades. */
  tradeShare: number;
  /** TRUE when the mechanism's verdict is not `shared` — i.e. the account may not have agreed. */
  differs: boolean;
}

export interface ParityExposure {
  trades: number;
  netPnl: number;
  /** One row per mechanism, biggest exposure first. */
  mechanisms: ExposureRow[];
  /** Trades whose exit reason has no row in `EXIT_TO_MECHANISM`. Reported, never swallowed. */
  unmapped: Array<{ exitReason: string | null; trades: number; pnl: number }>;
  /** Trades attributed to a mechanism that differs from live. */
  differingTrades: number;
  differingPnl: number;
  /**
   * Share of TRADES that ended because the data ran out (0-1).
   *
   * ⚠️ THIS IS THE MOST IMPORTANT NUMBER IN THE FILE AND IT IS NOT A PARITY DETAIL. An end-of-data
   * exit is a position still OPEN when the series stopped, marked to the last bar — it is unrealised
   * paper P&L, not a closed trade, and live has no such event. Measured 2026-11-20: 18 of 18 trades
   * and 100% of a 606.00 total were this. A reader must not read that as the strategy agreeing with
   * the account.
   */
  eodShare: number;
  /** One sentence a panel prints verbatim; never null. */
  note: string;
}

type Trade = { exitReason?: string | null; pnl?: number | null };

const money = (n: number) => Math.round(n * 100) / 100;

/**
 * Attribute every trade to the mechanism that decided its exit.
 *
 * ⚠️ THE SUMS ARE THE GUARD. `attributed.trades + unmapped.trades === trades` and
 * `attributed.pnl + unmapped.pnl === netPnl` must both hold; the spec asserts them, because a share that
 * silently omits a population is exactly the plausible-output defect this repo keeps paying for.
 */
/**
 * ── DECISION (2026-11-24, primary) ─────────────────────────────────────────────────────────────
 * WHAT:      every run attributes each trade to the mechanism that decided its exit, and reports
 *            `eodShare` as a first-class number.
 * WHY:       measured on two movers days, 40 of 40 trades ended with the DATA, so 3,238.00 of "profit"
 *            was unrealised mark-to-market on positions no decision ever closed. A parity register
 *            cannot say that; percentage-of-EXITS can.
 * INSTEAD OF: leaving it to one line inside `caveats`, where it sat beside a headline total and read
 *            as boilerplate.
 * REVERSE BY: delete the `parityExposure` field from `SelectionRunResult` and its call site; nothing is
 *            stored, so the reversal is the removal alone.
 * REGISTER:  docs/SETTLED-DECISIONS.md row 269
 * GUARD:     parity-exposure.spec.ts (14 cases, incl. an eighth exit reason failing the build)
 */
export function parityExposure(
  trades: ReadonlyArray<Trade> | null | undefined,
  register: ReadonlyArray<{ id: string; verdict: ParityVerdict }> = PARITY_REGISTER,
): ParityExposure {
  const list = Array.isArray(trades) ? trades : [];
  const verdictOf = new Map(register.map((r) => [r.id, r.verdict]));
  const buckets = new Map<string, { exitReason: string | null; mechanism: string; trades: number; pnl: number }>();
  const unmappedMap = new Map<string, { exitReason: string | null; trades: number; pnl: number }>();

  let netPnl = 0;
  for (const t of list) {
    const pnl = typeof t?.pnl === 'number' && Number.isFinite(t.pnl) ? t.pnl : 0;
    netPnl += pnl;
    const reason = t?.exitReason ?? null;
    const mapped = reason ? EXIT_TO_MECHANISM[reason as EngineExitReason] : undefined;
    if (!mapped) {
      const key = reason ?? '(none)';
      const cur = unmappedMap.get(key) ?? { exitReason: reason, trades: 0, pnl: 0 };
      cur.trades += 1;
      cur.pnl += pnl;
      unmappedMap.set(key, cur);
      continue;
    }
    // One row per MECHANISM, remembering the exit reason that produced it (SL and TRAIL are different
    // mechanisms; TIME and SESSION are the same one and are merged deliberately — one function decided
    // both).
    const cur = buckets.get(mapped.mechanism) ?? {
      exitReason: reason,
      mechanism: mapped.mechanism,
      trades: 0,
      pnl: 0,
    };
    cur.trades += 1;
    cur.pnl += pnl;
    buckets.set(mapped.mechanism, cur);
  }

  const mechanisms: ExposureRow[] = [...buckets.values()]
    .map((b) => {
      const mapped = Object.values(EXIT_TO_MECHANISM).find((m) => m.mechanism === b.mechanism);
      const verdict: ExposureRow['verdict'] = mapped?.engineOnly
        ? 'engine-only'
        : (verdictOf.get(b.mechanism) ?? 'unknown');
      return {
        exitReason: b.exitReason,
        mechanism: b.mechanism,
        verdict,
        trades: b.trades,
        pnl: money(b.pnl),
        tradeShare: list.length ? b.trades / list.length : 0,
        differs: verdict !== 'shared',
      };
    })
    .sort((a, b) => b.trades - a.trades || b.pnl - a.pnl);

  const unmapped = [...unmappedMap.values()].map((u) => ({ ...u, pnl: money(u.pnl) }));
  const differingTrades = mechanisms.filter((m) => m.differs).reduce((a, m) => a + m.trades, 0);
  const differingPnl = money(mechanisms.filter((m) => m.differs).reduce((a, m) => a + m.pnl, 0));

  const engineOnlyTrades = mechanisms.find((m) => m.verdict === 'engine-only')?.trades ?? 0;
  const eodShare = list.length ? engineOnlyTrades / list.length : 0;
  const engineOnly = mechanisms.find((m) => m.verdict === 'engine-only');
  const parts: string[] = [];
  if (list.length === 0) {
    parts.push('No trade closed, so there is no exposure to attribute.');
  } else {
    parts.push(
      `${differingTrades} of ${list.length} trade(s) exited on a mechanism the live account does not `
      + `reproduce verbatim (${money(differingPnl)} of ${money(netPnl)}).`,
    );
    if (eodShare >= 0.5) {
      parts.push(
        `MOST of this result is NOT closed trades: ${engineOnlyTrades} of ${list.length} positions were `
        + 'still open when the data ended, marked to the last bar — unrealised paper P/L with no live event.',
      );
    }
    if (engineOnly) {
      parts.push(
        `${engineOnly.trades} ended because the DATA ran out (${money(engineOnly.pnl)}) — an event with no `
        + 'live counterpart, not a decision the bot made.',
      );
    }
  }
  if (unmapped.length) {
    parts.push(
      `${unmapped.length} exit reason(s) have no mechanism row (${unmapped.map((u) => u.exitReason ?? '(none)').join(', ')}) — reported, not attributed.`,
    );
  }

  return {
    trades: list.length,
    netPnl: money(netPnl),
    mechanisms,
    unmapped,
    differingTrades,
    differingPnl,
    eodShare,
    note: parts.join(' '),
  };
}

/** The engine's own exit vocabulary, re-exported so a spec can iterate it without importing twice. */
export { ENGINE_EXIT_REASONS };
