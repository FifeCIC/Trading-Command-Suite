/**
 * pnl-population.ts — WHICH closed trades are actual results (#1044).
 * ============================================================================
 *
 * THE DEFECT THIS EXISTS FOR
 * --------------------------
 * `pnlInvalid` alone does NOT identify a usable result. Measured 2026-10-01 on the live database:
 *
 *   | closed rows | exitPrice | pnlInvalid | pnl | meaning                          |
 *   |-------------|-----------|------------|-----|----------------------------------|
 *   |         113 | NULL      | 1          | 0   | flagged; `0` is a PLACEHOLDER    |
 *   |          21 | NULL      | **0**      | 0   | **unflagged phantom — the gap**  |
 *   |         231 | present   | 0          | real| genuine results                 |
 *
 * The 113 and the 21 are the SAME physical thing — a close whose exit price was never captured —
 * and only a flag separates them. So two consumers of the same table disagree:
 *
 *   `pnlInvalid !== 1`                        → 264 rows  (includes the 21)
 *   `exitPrice IS NOT NULL`                   → 243 rows  (excludes them)
 *
 * **One table, two answers, no error.** That is this repo's most expensive failure signature.
 *
 * ⚠️ THE RESOLUTION — AND WHICH FIELD WINS
 * ---------------------------------------
 * `pnlInvalid` is the honest signal when it is set; the **absence of an exit price** is the
 * structural one. Neither alone is sufficient, and `pnl = 0` decides nothing at all.
 *
 *   **A row is NOT a result iff `pnlInvalid = 1`, OR (`exitPrice` is missing AND `pnl` is `0`).**
 *
 * `pnl = 0` with no exit price is a WRITER PLACEHOLDER, never a break-even: without an exit price
 * nothing could have been derived, so the zero came from the row's creation value. A row carrying
 * a NON-zero P&L with a missing exit price is a real number recovered from deal history and is
 * **kept** — the structural fact is applied to the value, never used to discard real data.
 * A genuine scratch (`pnl = 0` WITH an exit price) IS a result and is counted as one — see §3-states
 * in `trade-history.controller.ts`, which reached the same conclusion from the other direction.
 *
 * ⚠️ WHY A `0` IS THE DANGEROUS VALUE, NOT THE `NULL`
 * --------------------------------------------------
 * A `NULL` is visibly absent. A `0` is a plausible number that sums to nothing, so a bad total
 * looks CORRECT and a row count looks complete. #805 measured the cost: a win rate of **8.77%**
 * over a population containing placeholder zeros against **31.3%** over the rows that had a
 * result — the difference between "abandon ship" and "within a point of break-even".
 *
 * ⚠️ NOT THE SAME AS `REALISED_TRADE_PREDICATE`
 * --------------------------------------------
 * `trading/bot-performance.service.ts` additionally requires `brokerTicket IS NOT NULL`, because
 * bot attribution needs a broker counterpart. This module deliberately does NOT: measured
 * 2026-10-01, 12 rows carry a real exit price and a real P&L with no ticket, and they are
 * legitimate results. A missing ticket is reported as an annotation, never used to discard a
 * number that exists. Use the bot predicate for attribution; use THIS for P&L populations.
 *
 * ⚠️ PURE BY DESIGN — no Prisma, no IO, so `--self-test` and unit tests can drive every branch.
 */

/** Which population a closed trade belongs to. Four states, because a `0` cannot express them. */
export type PnlPopulation =
  /** `exitPrice` present and `pnlInvalid = 0` — a result, including a genuine break-even. */
  | 'realised'
  /** `pnlInvalid = 1` — the exit was never captured; `pnl` is a placeholder. */
  | 'quarantined'
  /**
   * Closed, `exitPrice` missing, and NOT flagged — the 21-row gap.
   * Structurally identical to `quarantined`; only the flag is absent.
   */
  | 'exit-unknown'
  /** `closedAt` is null — the trade is still open and has no result yet. */
  | 'open';

/** The facts a classification needs. Structural on purpose, so a raw Prisma row can be passed. */
export interface PnlRowFacts {
  closedAt?: Date | string | null;
  exitPrice?: number | null;
  pnl?: number | null;
  pnlInvalid?: number | boolean | null;
  brokerTicket?: string | null;
}

/**
 * classifyPnlRow() — the ONE place that decides what a closed trade IS.
 *
 * ⚠️ WHY THE EXIT PRICE IS CHECKED LAST, AND ONLY FOR A ZERO
 * The defect is a `0` that is indistinguishable from a result. A MISSING exit price is what makes
 * that `0` not a result — but a missing exit price on a row carrying a real recovered number
 * (`pnl = -234.52` from deal history) must NOT discard it. So the structural fact is applied to
 * the VALUE, not used to reject the row:
 *
 *     no exit price AND `pnl = 0`  →  the zero was never derived from anything. Not a result.
 *     no exit price AND `pnl ≠ 0`  →  a real number. Keep it.
 *
 * Neither alone is enough: `pnlInvalid` is a declaration that can be absent (the 21 rows), and a
 * non-null `pnl` is a value that every Trade row has from creation (`pnl: 0`).
 *
 * Order matters: `open` first (nothing else is knowable), then the flag (a human declaration
 * outranks the data), then the structure. A flagged row with a real P&L is still `quarantined`.
 */
export function classifyPnlRow(row: PnlRowFacts): PnlPopulation {
  if (row.closedAt === null || row.closedAt === undefined) return 'open';
  if (Number(row.pnlInvalid ?? 0) === 1) return 'quarantined';
  if (isMissingExit(row.exitPrice) && Number(row.pnl ?? 0) === 0) return 'exit-unknown';
  return 'realised';
}

/** `null` and `undefined` are the same absence here — a column Prisma did not SELECT is undefined. */
function isMissingExit(v: number | null | undefined): boolean {
  return v === null || v === undefined;
}

/** The single question every P&L consumer should ask. */
export function isRealisedResult(row: PnlRowFacts): boolean {
  return classifyPnlRow(row) === 'realised';
}

/**
 * A `pnl` value that is an absence wearing the clothes of a number.
 *
 * ⚠️ It returns the REASON, not a boolean, so a caller that has to log can say *which* absence it
 * found. `null` means "this really is a result".
 */
export function placeholderZeroReason(row: PnlRowFacts): string | null {
  const pop = classifyPnlRow(row);
  if (pop === 'realised') return null;
  if (pop === 'open') return null; // an open trade has no P&L yet; that is not a placeholder
  if (Number(row.pnl ?? 0) !== 0) return null; // a NON-zero value on an unusable row is a different fault
  return pop === 'quarantined'
    ? 'pnl = 0 placeholder on a row flagged pnlInvalid'
    : 'pnl = 0 placeholder on a closed row with no exit price (NOT flagged)';
}

/**
 * Rows that claim to be results but are not — the fault #1044 was filed for.
 *
 * ⚠️ Named for the DEFECT, not for the state: the state is honest (no exit price was captured);
 * what is wrong is that nothing FLAGGED it, so a `pnlInvalid`-only filter books it as a
 * break-even trade.
 */
export function isUnflaggedPhantom(row: PnlRowFacts): boolean {
  return classifyPnlRow(row) === 'exit-unknown';
}

/**
 * The Prisma `where` for "realised P&L only" — the ONE filter, so no caller retypes it.
 *
 * ⚠️ `closedAt` carries BOTH constraints in one key. Written as two separate `closedAt`
 * properties, JavaScript silently keeps the last, which drops the not-null filter and lets open
 * trades into expectancy maths.
 *
 * ⚠️ This returns a fresh object each call so a caller cannot mutate a shared literal.
 */
export function realisedPnlWhere(extra: Record<string, unknown> = {}): Record<string, unknown> {
  // ⚠️ Prisma cannot express "exit missing AND pnl = 0 → exclude", so the structural half is
  // expressed as the OR of the two real cases: an exit price exists, OR a non-zero pnl does.
  return {
    ...extra,
    closedAt: { not: null },
    pnlInvalid: 0,
    OR: [{ exitPrice: { not: null } }, { NOT: { pnl: 0 } }],
  };
}

/** The same rule as raw SQL, for the scripts and audits that do not use Prisma. */
export const REALISED_PNL_SQL =
  'closedAt IS NOT NULL AND pnlInvalid = 0 AND (exitPrice IS NOT NULL OR pnl <> 0)';

/** The same rule, negated — every closed row that is NOT a result. */
export const NON_RESULT_PNL_SQL =
  'closedAt IS NOT NULL AND (pnlInvalid = 1 OR (exitPrice IS NULL AND pnl = 0))';

/** A one-line summary of a population, for a log line or an audit footer. */
export function summarisePopulations(rows: PnlRowFacts[]): Record<PnlPopulation, number> {
  const out: Record<PnlPopulation, number> = { realised: 0, quarantined: 0, 'exit-unknown': 0, open: 0 };
  for (const r of rows) out[classifyPnlRow(r)] += 1;
  return out;
}
