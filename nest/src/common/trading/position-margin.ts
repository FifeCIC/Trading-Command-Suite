/**
 * position-margin.ts — HOW MUCH CAPITAL A POSITION ACTUALLY TIES UP, computed once.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS (#865, 2026-09-18)
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * `assessGlobalRiskLimits()` refused **78 trades in a single day** with
 *
 *     Allocation 62.7% exceeds max per symbol 25%
 *
 * …against this expression:
 *
 *     leverage         = balance / margin          // 8.62 on a 1:100 account
 *     estimatedCapital = (size * 100_000) / max(leverage, 1)
 *
 * Two things were wrong, and both are provable from the data rather than argued:
 *
 *   1. `balance / margin` is margin UTILISATION, not leverage. It read 8.62 against the account's
 *      declared 1:100, inflating the estimate ~11x. It also FALLS as positions open, so the more is
 *      open the harder entries are blocked — a compounding trap, not a constant error.
 *   2. `size * 100_000` is the FX contract convention applied to EVERY instrument, and it contains
 *      no price. So XAUUSD and NZDJPY produced the IDENTICAL estimate — visible in the logs as
 *      `62.7%` and `62.6%` for gold and a yen cross on the same day.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * THE FORMULA, AND THE MEASUREMENT THAT PROVES IT
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 *     notional(profit currency) = volume × contractSize × price
 *     margin(account currency)  = notional × profitToAccount ÷ leverage
 *
 * ⚠️ Verified against the live account on 2026-09-18 — not asserted. The account's own `margin`
 * is the sum of its positions' margins, so it is a real oracle:
 *
 *     EURGBP  0.1  × 100000 × 0.85982                   =  8598.20 GBP      -> 85.98
 *     GBPJPY  0.01 × 100000 × 210.637  × (1/209.768)    = 210637 JPY -> GBP -> 10.04
 *     ────────────────────────────────────────────────────────────────────────────────────
 *     COMPUTED TOTAL  96.02 GBP
 *     ACTUAL ACCOUNT  95.98 GBP        delta 0.04 (0.05%)
 *
 * The 0.05% residual is expected: this used `priceOpen` while MT5 recalculates margin at CURRENT
 * prices. It is reproduced as a regression fixture in `position-margin.spec.ts` so a future change
 * that breaks the formula fails against real numbers rather than a made-up one.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * ⚠️ IT FAILS CLOSED, AND THAT IS THE POINT
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Every input is either READ or the estimate is `unavailable`. There is no default, no `?? 0.25`,
 * no `?? 100000` — and this is deliberate, because the previous version's failure mode was not a
 * wrong number, it was a WRONG NUMBER THAT LOOKED NORMAL.
 *
 * A missing cap does not trip a check; it **disables** it (`allocation > undefined` is `false`).
 * So when the estimate cannot be computed the caller must refuse the order and say what was
 * missing — never proceed as though the limit were satisfied. The `reason` field names the exact
 * missing input for that.
 */

/** Everything the formula needs. Nothing here is optional-with-a-default on purpose. */
export interface MarginInputs {
  symbol: string;
  volume: number;
  /** Price of the BASE currency in the QUOTE currency — the symbol's own quote. */
  price: number;
  /** `trade_contract_size` from `/symbol/<SYM>/info`. */
  contractSize: number;
  /** The ACCOUNT's declared leverage (`/account` → `leverage`), e.g. 100 for 1:100. */
  accountLeverage: number;
  /** Account currency, e.g. `GBP`. The currency `margin` is returned in. */
  accountCurrency: string;
  /**
   * The symbol's PROFIT currency, when known — authoritative source is an open position
   * (`/positions` → `currencyProfit`). `undefined` falls back to {@link resolveProfitCurrency}.
   */
  profitCurrency?: string;
  /**
   * Quoted pairs available for conversion, keyed by pair name as the broker quotes it:
   * `{ GBPUSD: 1.33838, GBPJPY: 209.768 }`. Used to build the profit→account rate.
   */
  quotes?: Record<string, number>;
}

export interface MarginComputed {
  source: 'computed';
  /** Margin in the account currency. */
  margin: number;
  /** Notional in the symbol's profit currency. */
  notionalProfitCurrency: number;
  /** Multiplier applied to go from profit currency to account currency. */
  conversionRate: number;
  /** Which pair supplied the rate, or `'same-currency'`. For the log/decision row. */
  conversionSource: string;
  profitCurrency: string;
  /** The inputs, so a block reason can explain itself instead of just naming a ratio. */
  inputs: MarginInputs;
}

export interface MarginUnavailable {
  source: 'unavailable';
  /** Names the MISSING INPUT — not "risk check failed". */
  reason: string;
}

export type MarginEstimate = MarginComputed | MarginUnavailable;

/**
 * Currencies whose codes are three ASCII letters. Used only to recognise the `XXXYYY` shape.
 * A symbol that is not six letters (e.g. `US500`, `GER40`) has no derivable profit currency and
 * returns null — it does NOT get a guess.
 */
const CCY_RE = /^[A-Z]{3}$/;

/**
 * The symbol's PROFIT currency — the currency its profit (and therefore its notional) is
 * denominated in.
 *
 * ⚠️ Resolution order, and WHY each step is safe:
 *
 *   1. `knownFromPositions` — an open position reports `currencyProfit` directly (MT5's own value).
 *      Authoritative; prefer it always.
 *   2. The `XXXYYY` shape → `YYY`. On this broker every FX pair and metal is named that way and
 *      the profit currency is the quote currency: EURGBP→GBP, GBPJPY→JPY, XAUUSD→USD. This is a
 *      DOCUMENTED CONVENTION, not a guess about a specific instrument, and it is covered by tests
 *      for both FX and metals.
 *   3. **`null`** — an index CFD (`US500`, `GER40`, `UK100`, `FRA40`) carries no currency in its
 *      name. Returning null makes the estimate `unavailable` and the caller refuses, which is
 *      correct: we would otherwise have to assume an index settles in the account currency.
 *
 * ⚠️ `/symbol/<SYM>/info` does NOT return `currencyProfit` on the running bridge build. It reads
 * `mt5.symbol_info(sym)`, which HAS the field, so adding it to the payload is a one-line bridge
 * change — done in `mt5_bridge_v2.py` on 2026-09-18 and awaiting the next deploy. When it lands,
 * `symbolInfo.currencyProfit` should be passed as step 0, ahead of everything above.
 */
export function resolveProfitCurrency(
  symbol: string,
  knownFromPositions?: string | null,
): string | null {
  if (knownFromPositions && CCY_RE.test(String(knownFromPositions).toUpperCase())) {
    return String(knownFromPositions).toUpperCase();
  }
  const s = String(symbol ?? '').toUpperCase().replace(/[^A-Z]/g, '');
  if (s.length === 6 && CCY_RE.test(s.slice(0, 3)) && CCY_RE.test(s.slice(3))) {
    return s.slice(3);
  }
  return null;
}

/**
 * How to turn a profit-currency amount into the account currency, given the pairs the broker
 * quotes.
 *
 * Brokers usually quote only one direction: this one has `GBPUSD` and `GBPJPY`, and neither
 * `USDGBP` nor `JPYGBP`. So both directions are tried and the inverse is used when needed —
 * a one-sided lookup would silently fail for every JPY and USD instrument on a GBP account.
 */
export function conversionFor(
  profitCurrency: string,
  accountCurrency: string,
  quotes: Record<string, number> = {},
): { rate: number; source: string } | null {
  const p = profitCurrency.toUpperCase();
  const a = accountCurrency.toUpperCase();
  if (p === a) return { rate: 1, source: 'same-currency' };

  const direct = quotes[`${p}${a}`];
  if (typeof direct === 'number' && Number.isFinite(direct) && direct > 0) {
    return { rate: direct, source: `${p}${a}` };
  }

  const inverse = quotes[`${a}${p}`];
  if (typeof inverse === 'number' && Number.isFinite(inverse) && inverse > 0) {
    return { rate: 1 / inverse, source: `1/${a}${p}` };
  }

  return null;
}

/** Which pair names the caller must have quotes for, so it does not blindly fetch every pair. */
export function conversionPairsNeeded(profitCurrency: string, accountCurrency: string): string[] {
  const p = profitCurrency.toUpperCase();
  const a = accountCurrency.toUpperCase();
  if (p === a) return [];
  return [`${p}${a}`, `${a}${p}`];
}

/**
 * estimatePositionMargin() — the ONE place this arithmetic lives.
 *
 * Pure: no IO, no defaults, no fallbacks. Give it everything and it computes, or it tells you
 * exactly which input was missing.
 */
export function estimatePositionMargin(inputs: MarginInputs): MarginEstimate {
  const {
    symbol, volume, price, contractSize, accountLeverage, accountCurrency,
  } = inputs;

  if (!Number.isFinite(volume) || volume <= 0) {
    return { source: 'unavailable', reason: `volume is ${volume}` };
  }
  if (!Number.isFinite(price) || price <= 0) {
    return { source: 'unavailable', reason: `price is ${price} (no quote for ${symbol})` };
  }
  if (!Number.isFinite(contractSize) || contractSize <= 0) {
    return { source: 'unavailable', reason: `contractSize is ${contractSize} for ${symbol}` };
  }
  if (!Number.isFinite(accountLeverage) || accountLeverage <= 0) {
    return { source: 'unavailable', reason: `account leverage is ${accountLeverage}` };
  }
  if (!accountCurrency) {
    return { source: 'unavailable', reason: 'account currency not reported' };
  }

  const profitCurrency = resolveProfitCurrency(symbol, inputs.profitCurrency);
  if (!profitCurrency) {
    return {
      source: 'unavailable',
      reason:
        `profit currency unknown for '${symbol}' — name is not an XXXYYY pair, and no open ` +
        'position reports currencyProfit. Assuming one would be a guess',
    };
  }

  const conversion = conversionFor(profitCurrency, accountCurrency, inputs.quotes);
  if (!conversion) {
    const [a, b] = conversionPairsNeeded(profitCurrency, accountCurrency);
    return {
      source: 'unavailable',
      reason: `no ${profitCurrency}->${accountCurrency} rate (tried ${a} and ${b})`,
    };
  }

  const notionalProfitCurrency = volume * contractSize * price;
  const margin = (notionalProfitCurrency * conversion.rate) / accountLeverage;

  return {
    source: 'computed',
    margin,
    notionalProfitCurrency,
    conversionRate: conversion.rate,
    conversionSource: conversion.source,
    profitCurrency,
    inputs,
  };
}

/**
 * A one-line explanation for a decision row — the numbers, not only the ratio.
 *
 * Exists because the original block read `Allocation 62.7% exceeds max per symbol 25%` and it took
 * an hour and a hand-built probe to discover the estimate behind it was 11x too high. Whatever the
 * check decides, the record should let the next reader ask "why is that number that size?".
 */
export function describeMargin(estimate: MarginEstimate, accountCurrency: string): string {
  if (estimate.source === 'unavailable') return `unavailable (${estimate.reason})`;
  const i = estimate.inputs;
  return (
    `${estimate.margin.toFixed(2)} ${accountCurrency} ` +
    `(vol ${i.volume} × contract ${i.contractSize} × px ${i.price} = ` +
    `${estimate.notionalProfitCurrency.toFixed(2)} ${estimate.profitCurrency}` +
    `${estimate.conversionSource === 'same-currency' ? '' : ` × ${estimate.conversionRate.toPrecision(6)} (${estimate.conversionSource})`}` +
    ` ÷ ${i.accountLeverage})`
  );
}
