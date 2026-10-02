/**
 * data-staleness.ts — "is our market data stale?" asked the RIGHT way (#1067).
 *
 * ── THE DEFECT THIS REPLACES ──
 *
 * `AlertTriggerService.checkDataStaleness()` asked:
 *
 *     const staleCount = await this.prisma.marketBar.count({
 *       where: { timestamp: { lt: threshold } },
 *     });
 *     if (staleCount > 0) { …fire… }
 *
 * That counts **every bar older than the threshold** — which is the entire historical table — and
 * fires if the count is greater than zero.
 *
 * ⚠️ **Measured 2026-10-02:** `marketbar` holds **1,009,146** rows and **995,489** are "older than
 * 5 minutes". The alert therefore fires on **98.6% of the table**, every poll, forever. It is
 * **structurally incapable of being false.** The alert-collapse helper records it having fired
 * **×2,621**.
 *
 * ⚠️ **WHY THIS IS A TRADING DEFECT, NOT AN ALERT NUISANCE.** Market-data staleness is the failure
 * that makes scoring act on stale prices — and this is the only thing watching for it. A guard that
 * always fires carries no information: a feed that dies at 03:00 looks exactly like a feed that is
 * working, because both produce the same alert. The one signal that mattered was buried under
 * 2,621 copies of itself.
 *
 * ── WHAT STALENESS ACTUALLY IS ──
 *
 * **The NEWEST bar for a symbol we are actually trading is older than the threshold.** Not "how
 * many old bars exist" — history is supposed to be old.
 *
 * ⚠️ TWO WAYS THIS CAN BE WRONG, BOTH AVOIDED DELIBERATELY:
 *
 * 1. **A symbol nothing trades must not count.** A delisted ticker, or one whose feed we dropped
 *    years ago, will ALWAYS have a stale newest bar. Including it reproduces the original defect in
 *    a subtler form: permanently true, permanently ignored. So only symbols with an ACTIVE BOT are
 *    judged — the set we would actually act on.
 * 2. **NO BARS AT ALL is not staleness.** A symbol we have never imported has `latest: null`. That
 *    is "cannot judge", which is a different state from "stale" and must not be reported as it —
 *    the same distinction `development-status.instructions.md` draws between "fine" and
 *    "cannot judge". A new bot subscribed this morning would otherwise alert on every poll.
 */

/** One symbol's most recent bar time, or null when we hold no bars for it. */
export interface SymbolLatest {
  symbol: string;
  latest: Date | null;
}

export interface StalenessReport {
  /** Symbols with an active bot whose NEWEST bar is older than the threshold. */
  stale: Array<{ symbol: string; latestAgeMinutes: number }>;
  /** Symbols with an active bot and NO bars at all — "cannot judge", NOT "stale". */
  cannotJudge: string[];
}

/**
 * stalenessReport() — pure, so the whole rule can be tested without a database or a clock.
 *
 * `latestBySymbol` should already be scoped to the symbols we care about; `now` is injected rather
 * than read, so a test can pin time instead of racing it.
 */
export function stalenessReport(
  latestBySymbol: readonly SymbolLatest[],
  thresholdMinutes: number,
  now: Date,
): StalenessReport {
  const stale: Array<{ symbol: string; latestAgeMinutes: number }> = [];
  const cannotJudge: string[] = [];

  for (const row of latestBySymbol) {
    if (!row.latest || !(row.latest instanceof Date) || Number.isNaN(row.latest.getTime())) {
      cannotJudge.push(row.symbol);
      continue;
    }
    const ageMinutes = (now.getTime() - row.latest.getTime()) / 60_000;
    if (ageMinutes > thresholdMinutes) {
      stale.push({ symbol: row.symbol, latestAgeMinutes: Math.round(ageMinutes) });
    }
  }

  return { stale, cannotJudge };
}

/**
 * stalenessMessage() — the alert text, derived from the report so the number in the message cannot
 * drift from the number the decision was made on.
 *
 * ⚠️ The old message printed a COUNT OF HISTORY (`995489 market bar(s) older than 5 minutes`), which
 * reads as alarming and means nothing. This names the SYMBOLS, because those are actionable.
 */
export function stalenessMessage(report: StalenessReport, thresholdMinutes: number): string {
  const names = report.stale.map((s) => s.symbol);
  const shown = names.slice(0, 8).join(', ');
  const more = names.length > 8 ? ` (+${names.length - 8} more)` : '';
  const worst = report.stale.reduce((m, s) => Math.max(m, s.latestAgeMinutes), 0);
  return (
    `${names.length} traded symbol(s) have no bar newer than ${thresholdMinutes} min ` +
    `(newest is ${worst} min old): ${shown}${more}. Scoring may be acting on stale prices.`
  );
}
