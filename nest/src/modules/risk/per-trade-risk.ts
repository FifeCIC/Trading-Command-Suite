/**
 * per-trade-risk.ts — HOW MUCH MONEY ONE ORDER CAN LOSE, and whether that is allowed.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS (2026-11-12, #1257)
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * `risk.maxPerTradeRisk` has been configurable since the settings registry existed and was read
 * by exactly ONE thing: `RiskService.calculatePositionSize()`, the position-size **calculator** —
 * a preview an operator can call. Nothing on the order path consulted it.
 *
 * So it was a DECLARED cap that no trade ever met. Measured live the day this was written:
 *
 *   | position | baseSize | money at risk if the stop fills | % of the £589.16 account |
 *   |----------|----------|---------------------------------|--------------------------|
 *   | XAUUSD   | 0.01     | £78                             | 13.3%                    |
 *   | NZDJPY   | 0.1      | £37                             | 6.3%                     |
 *
 * …against a declared ceiling of 2%. Both orders passed every gate, because the only portfolio
 * caps (`maxPortfolioRisk`, `maxPerSymbol`) are measured as MARGIN, and margin on a 1:100 account
 * is trivial next to the money a stop can lose. Margin answers "can I afford to open this";
 * this module answers "can I afford to be wrong about it".
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHY IT IS A MODULE AND NOT AN `if`
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Every input here is a number that has ALREADY been resolved by the caller (price, contract
 * size, profit→account conversion, equity). Keeping the arithmetic pure means it can be canaried
 * in both directions without a database, a bridge or a Nest container — and the gate that calls it
 * cannot quietly substitute a different formula.
 *
 * ⚠️ UNITS. `capPct` and the returned `riskPct` are PERCENTAGES (2 = 2%). The `risk.maxPerTradeRisk`
 * SETTING is a FRACTION (0.02) — the caller converts, and every call site says so. The two units
 * under near-identical names is precisely the trap this repo has paid for before (`maxDrawdown`
 * as a fraction vs `health.drawdown` as a percent), so the unit is named in the field, not implied.
 *
 * ⚠️ AND THE TWO SETTINGS DO DIFFERENT JOBS, which is why this reads `risk.maxTradeRiskCeilingPct`
 * (already a percent) and not `risk.maxPerTradeRisk`:
 *   `risk.maxPerTradeRisk`     = a SIZING TARGET. `calculatePositionSize()` multiplies equity by it
 *                                to decide how big an order SHOULD be. Raising it makes orders bigger.
 *   `risk.maxTradeRiskCeilingPct` = a CEILING. It refuses an order that is ALREADY too big.
 * One number cannot do both without one meaning corrupting the other.
 *
 * REGISTER: docs/SETTLED-DECISIONS.md row 171 · ISSUE: #1257
 */

export interface PerTradeRiskInput {
  /** Entry→stop price distance, in the instrument's own quote unit. */
  stopDistance: number;
  /** Order volume in lots. */
  volume: number;
  /** `trade_contract_size` from the broker's symbol spec. */
  contractSize: number;
  /** Profit currency → ACCOUNT currency multiplier, from `estimatePositionMargin`. */
  conversionRate: number;
  /** Account equity, in the account currency. The denominator of the percentage. */
  equity: number;
  /** The ceiling, as a PERCENT of equity. 2 means "risk at most 2% of equity". */
  capPct: number;
  /** Where `capPct` came from — quoted in the refusal so the reader knows WHICH cap fired. */
  capSource: string;
}

export interface PerTradeRiskEvaluated {
  evaluable: true;
  allowed: boolean;
  /** Money at risk if the stop fills, in the account currency. */
  riskMoney: number;
  /** That money as a percent of equity. */
  riskPct: number;
  capPct: number;
  capMoney: number;
  reason: string;
}

/**
 * The check could not be performed. `allowed` is `false` — a cap that cannot read its input must
 * refuse, never pass. (The same rule as `marginEstimate.source === 'unavailable'`: an unreadable
 * limit is not a satisfied limit.)
 */
export interface PerTradeRiskUnknown {
  evaluable: false;
  allowed: false;
  riskMoney: null;
  riskPct: null;
  capPct: number | null;
  capMoney: null;
  reason: string;
}

export type PerTradeRisk = PerTradeRiskEvaluated | PerTradeRiskUnknown;

/** Positive, finite number or null. Zero/NaN/negative is MISSING, never "no risk". */
const positive = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;

const unknown = (reason: string, capPct: number | null): PerTradeRiskUnknown => ({
  evaluable: false,
  allowed: false,
  riskMoney: null,
  riskPct: null,
  capPct,
  capMoney: null,
  reason,
});

/**
 * evaluatePerTradeRisk() — the money risk of ONE order against a configured ceiling.
 *
 * ⚠️ THE BOUNDARY IS INCLUSIVE: exactly `capPct` PASSES, anything above it fails. Named here and
 * pinned by a test, because "is 2.0% over a 2% cap" is a real decision and leaving it to whoever
 * reads the operator is how two readers end up disagreeing about the same trade.
 *
 * ⚠️ A cap of 0 (or NaN, or negative) REFUSES EVERYTHING rather than disabling itself. A cap that
 * collapses to "no limit" when its value is missing is the #865 class: `undefined` does not trip a
 * check, it removes it. Refusing loudly is recoverable; trading without the cap is not.
 */
export function evaluatePerTradeRisk(input: PerTradeRiskInput): PerTradeRisk {
  const stopDistance = positive(input.stopDistance);
  const volume = positive(input.volume);
  const contractSize = positive(input.contractSize);
  const conversionRate = positive(input.conversionRate);
  const equity = positive(input.equity);
  const capPct = positive(input.capPct);

  const cap = capPct ?? null;

  // The cap itself first — if the ceiling is unusable, nothing else matters.
  if (capPct === null) {
    return unknown(
      `Risk cap is unusable (${JSON.stringify(input.capPct)} from ${input.capSource}) — ` +
        'a cap that cannot be read must not be treated as absent. Refusing rather than trading without it.',
      cap,
    );
  }

  const missing: string[] = [];
  if (stopDistance === null) missing.push(`stopDistance=${JSON.stringify(input.stopDistance)}`);
  if (volume === null) missing.push(`volume=${JSON.stringify(input.volume)}`);
  if (contractSize === null) missing.push(`contractSize=${JSON.stringify(input.contractSize)}`);
  if (conversionRate === null) missing.push(`conversionRate=${JSON.stringify(input.conversionRate)}`);
  if (equity === null) missing.push(`equity=${JSON.stringify(input.equity)}`);
  if (missing.length) {
    return unknown(
      `Cannot measure the money at risk — ${missing.join(', ')}. ` +
        `Refusing rather than trading without the ${capPct}% per-trade cap (${input.capSource}).`,
      cap,
    );
  }

  // Non-null by the checks above.
  const riskMoney = (stopDistance as number) * (volume as number) * (contractSize as number) * (conversionRate as number);
  const riskPct = (riskMoney / (equity as number)) * 100;
  const capMoney = ((equity as number) * capPct) / 100;
  const allowed = riskPct <= capPct;

  const fmt = (n: number) => n.toFixed(2);
  const reason = allowed
    ? `Risk ${fmt(riskMoney)} (${fmt(riskPct)}% of equity) is within the ${capPct}% per-trade cap ` +
      `(${fmt(capMoney)}, from ${input.capSource})`
    : `Risk ${fmt(riskMoney)} (${fmt(riskPct)}% of equity) exceeds the ${capPct}% per-trade cap ` +
      `(${fmt(capMoney)}, from ${input.capSource}) — stop distance ${stopDistance}, ` +
      `${volume} lot × ${contractSize} × rate ${conversionRate}`;

  return { evaluable: true, allowed, riskMoney, riskPct, capPct, capMoney, reason };
}
