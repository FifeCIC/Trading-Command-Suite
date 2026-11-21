/**
 * portfolio-admission.ts — COULD THE BOT ACTUALLY HAVE TAKEN THIS TRADE?
 *
 * ── THE DEFECT THIS ADDRESSES (#1325) ───────────────────────────────────────────────────────────
 * The engine walks one hypothetical trade forward from each signal, independently. That is the right
 * shape for measuring SIGNAL quality — every trade gets a fair walk — but it is not what a bot does: a
 * live bot can hold at most so many positions and must wait `cooldownMinutes` between entries.
 *
 * ⚠️ **MEASURED 2026-11-20: `cooldownMinutes` is set on every movers bot (30 minutes) and was read by
 * NOTHING in the engine.** One movers day produced **53 entries** where the bot could have taken **13**.
 * Every statistic a reader then draws from that run — win rate, net P&L, hold time — describes a
 * population the bot could never have produced.
 *
 * ── WHAT THIS IS, AND WHAT IT IS NOT ────────────────────────────────────────────────────────────
 * It is NOT a second decision path. The entries and the exits are unchanged: each trade was already
 * decided by the shared scoring/gating/exit core. This is an **admission filter over the resulting
 * trades** — "was the bot free to take this one?" — in the same shape as `applySelection()` (which asks
 * "was this symbol in the day's pick?").
 *
 * ⚠️ **IT IS OPT-IN, AND THAT IS REGISTER ROW 23, NOT HEDGING.** A run that silently applied a cap
 * would change the population of every stored result. So the incumbent behaviour stays the default and
 * the capped population is a SECOND ARM that can be compared with it on the same dataset.
 *
 * ── WHAT IT DOES NOT MODEL, STATED SO NOBODY INFERS IT ─────────────────────────────────────────
 *   · **Pyramiding / averaging in** (`maxPyramidTiers`) — adding to an open position changes the
 *     position's size and its exits, which this filter cannot see. Still open in #1325.
 *   · **The equity effect of refusing trades** — in `compound` mode the accepted subset would have
 *     sized later trades differently. The sizes here are the ones the run produced.
 *   · **Margin** — a cap of N positions says nothing about whether N were affordable.
 *
 * ── THE TWO RULES, AS LIVE IMPLEMENTS THEM ─────────────────────────────────────────────────────
 *   cooldown   `automation-loop.service.ts` → `lastTradeTime.get(strategy.id)`, refuse while
 *              `now - lastTrade < cooldownMinutes`. So it is ENTRY-TO-ENTRY across all symbols, and
 *              exactly-at-the-boundary is ALLOWED (`<` refuses, `==` passes). ⚠️ `|| 5`: a missing or
 *              zero value means FIVE MINUTES live, not "off".
 *   cap        the LIVE cap is the GLOBAL `risk.maxOpenPositions` (default 5, broker-wide) — NOT the
 *              per-bot `trading_strategy.maxPositions`, which `bot-rules.ts` records as `legacy-only`
 *              and which the live dispatch path never reads.
 */

export interface AdmittableTrade {
  /** Entry instant, epoch ms. */
  entryMs: number;
  /** Exit instant, epoch ms. */
  exitMs: number;
  symbol?: string;
}

export interface AdmissionRules {
  /**
   * How many positions may be open at once — the GLOBAL `risk.maxOpenPositions`, not the dead per-bot
   * column. `null` = no cap declared (report it; do not invent one).
   */
  maxConcurrent: number | null;
  /** `trading_strategy.cooldownMinutes`. Live reads `|| 5`, so 0/absent means FIVE MINUTES here too. */
  cooldownMinutes: number | null;
}

export type RefusalCode = 'cap' | 'cooldown';

export interface AdmissionResult<T extends AdmittableTrade> {
  admitted: T[];
  refused: Array<{ trade: T; code: RefusalCode; because: string }>;
  /** The rules actually applied, with live's `|| 5` default made explicit. */
  applied: { maxConcurrent: number | null; cooldownMinutes: number };
}

/** Live's `cooldownMinutes || 5`, as one function so the default cannot drift between paths. */
export function effectiveCooldownMinutes(raw: number | null | undefined): number {
  const minutes = Number(raw ?? 0);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : 5;
}

/**
 * Filter a set of decided trades down to the ones the bot could have been holding.
 *
 * Greedy in ENTRY order, and that is the honest reading: a bot evaluates signals as they arrive, so the
 * earliest entry has first claim. A trade whose entry coincides with another trade's exit is ADMITTED —
 * the position was closed first (`exitMs <= entryMs`), which is the same ordering the live loop has
 * (a close is processed before the next dispatch).
 */
export function admitTrades<T extends AdmittableTrade>(
  trades: readonly T[],
  rules: AdmissionRules,
): AdmissionResult<T> {
  const cooldownMinutes = effectiveCooldownMinutes(rules.cooldownMinutes);
  const cooldownMs = cooldownMinutes * 60_000;
  const cap = rules.maxConcurrent != null && Number.isFinite(Number(rules.maxConcurrent)) && Number(rules.maxConcurrent) > 0
    ? Math.floor(Number(rules.maxConcurrent))
    : null;

  const ordered = [...trades].sort((a, b) => a.entryMs - b.entryMs);

  const admitted: T[] = [];
  const refused: AdmissionResult<T>['refused'] = [];
  /** Exit instants of the admitted trades that are still open at the moment being considered. */
  const openUntil: number[] = [];
  let lastEntryMs: number | null = null;

  for (const trade of ordered) {
    // Drop positions that have already closed — the same pruning a live portfolio does implicitly.
    for (let i = openUntil.length - 1; i >= 0; i--) {
      if (openUntil[i] <= trade.entryMs) openUntil.splice(i, 1);
    }

    if (lastEntryMs !== null && trade.entryMs - lastEntryMs < cooldownMs) {
      const waitMin = Math.ceil((cooldownMs - (trade.entryMs - lastEntryMs)) / 60_000);
      refused.push({
        trade,
        code: 'cooldown',
        because: `entered ${Math.round((trade.entryMs - lastEntryMs) / 60_000)} min after the previous entry, inside the ${cooldownMinutes}-minute cooldown (${waitMin} min short)`,
      });
      continue;
    }

    if (cap !== null && openUntil.length >= cap) {
      refused.push({
        trade,
        code: 'cap',
        because: `${openUntil.length} position(s) already open — the live cap is ${cap}`,
      });
      continue;
    }

    admitted.push(trade);
    openUntil.push(trade.exitMs);
    lastEntryMs = trade.entryMs;
  }

  return { admitted, refused, applied: { maxConcurrent: cap, cooldownMinutes } };
}
