/**
 * affordable-size.ts — can the account actually afford this position? (#1142)
 * ==========================================================================
 *
 * ── DECISION (2026-11-01, primary) ──
 * WHAT:      Committed notional is capped at `accountSize × maxLeverage` (default 1, unleveraged) and
 *            an unaffordable request is REFUSED — the trade is skipped and counted. Never inflated to
 *            one unit. Every trade records `notional` and `notionalPct`.
 * WHY:       `fixedPercent` sizes notional as `accountSize × riskPct / slPct`, so `Risk %` is a budget,
 *            not a cap — at the defaults every trade commits 2× the account. A `min 1 unit` floor then
 *            guaranteed one whole unit regardless, so stored run `a6fcd0ee` (BTC 15m, 610 trades, $10k
 *            account) reported **+$138,058.50 / +1,380%** from $77,600 notional per trade.
 * INSTEAD OF: Keeping the floor and merely reporting the notional, which leaves the money column
 *            describing a fill no broker would accept. Refusing matches what the live path already does
 *            when a lot is below the broker minimum.
 * REVERSE BY: Restoring `if (positionSize < 1) positionSize = 1` in `backtest.service.ts` and deleting
 *            this call. Nothing is stored or migrated; stored runs keep their numbers either way.
 *            ⚠️ Do not reverse it to make a symbol "testable" — see #1170, which asks for per-instrument
 *            unit granularity (fractional crypto / CFD sizes) instead of one whole unit.
 * REGISTER:  docs/SETTLED-DECISIONS.md row 114
 * GUARD:     nest/src/modules/backtest/affordable-size.spec.ts
 *
 * MEASURED 2026-10-26 on stored run `a6fcd0ee` (BTC 15m, 610 trades, `accountSize` $10,000):
 * `totalPnl` **$138,058.50** — a **+1,380% "return"** — from an implied notional of **≈$77,600 per
 * trade**. One whole coin, on a ten-thousand-dollar account.
 *
 * The cause was two lines working together:
 *
 *   1. `fixedPercent` sizes from the STOP DISTANCE, so the price cancels:
 *        notional = accountSize × riskPct / slPct
 *      At the defaults (2% risk, 1% stop) every trade commits **2× the account**, and a wider stop
 *      commits less while a tighter one commits more — `Risk %` is a risk BUDGET, never a cap.
 *   2. `if (positionSize < 1) positionSize = 1` then guaranteed at least **one whole unit**. For an
 *      instrument priced above the account (BTC ≈ $77k), that one unit is 7.76× the account, and the
 *      money column stops describing anything a broker would fill.
 *
 * ── WHY THIS IS A DEFECT FIX, NOT A MATHS CHANGE ────────────────────────────────────────────────
 * `maths-change-requires-ab.instructions.md` excludes "a bug fix that restores an intended value".
 * The intent here is that the money column be PHYSICAL — a position the account can afford. The old
 * output is not a strategy result that A/B could compare: it is arithmetic from a floor. There is
 * nothing to protect by copying the configuration, because the incumbent number describes a fill no
 * broker would accept.
 *
 * ⚠️ It DOES change every future run's P&L, so new runs are not comparable with older ones on money.
 * That is why the cap is reported per trade (`notional`, `notionalPct`) and refusals are COUNTED —
 * a reader must be able to see the mechanism rather than infer it.
 *
 * ── LIVE AGREEMENT ─────────────────────────────────────────────────────────────────────────────
 * The live path already refuses an unaffordable size (the broker rejects a lot below its minimum).
 * This makes the backtest agree: an unaffordable position becomes a REFUSAL, not a fabricated size.
 * Skipping is the honest option — inventing a size so the trade "happens" is what produced the 1,380%.
 */

/** Default cap: committed notional may not exceed the account. One-to-one, no leverage assumed. */
export const DEFAULT_MAX_LEVERAGE = 1;

// ── DECISION (2026-11-01, primary) ──
// WHAT:      A size is quantised DOWN to the broker's own increment (`volumeStep × contractSize`), and
//            the run reports the step it used. No step known = whole units, reported as
//            `granularity: 'assumed-whole'`.
// WHY:       Whole units are a SHARE. Measured on US30 at ≈$45k with a $10,000 account: the sizing
//            model asked for 0.44 units, an upstream `Math.floor` made it 0, and this guard refused it —
//            301 signals, 301 refusals, zero trades. A broker sells 0.1 lots of US30 happily. The
//            engine could not, because nothing in it knew what a lot was.
// INSTEAD OF: Defaulting a missing step to 1. That is the whole-unit assumption wearing a value's
//            clothes, and it would quietly restore the defect for every symbol whose spec is absent.
// REVERSE BY: Ignoring `unitStep`/`minUnits` and flooring `requestedUnits` again. The consequence is
//            that index CFDs and any instrument priced above the account become untestable, and the
//            reason must then be recorded in row 118.
// REGISTER:  docs/SETTLED-DECISIONS.md row 118
// GUARD:     affordable-size.spec.ts (step rounding down, minimum-lot refusal, FP boundary,
//            assumed-whole fallback, whole shares unchanged)

export interface AffordabilityInput {
  /** Units the sizing model asked for. Rounded DOWN to `unitStep` — see that field. */
  requestedUnits: number;
  /** Price per unit at entry (the cost-adjusted entry, so notional is what is actually paid). */
  pricePerUnit: number;
  /** The account the run is sized against. */
  equity: number;
  /** Committed notional ÷ equity may not exceed this. 1 = unleveraged. */
  maxLeverage?: number;
  /**
   * #1170 — the SMALLEST TRADEABLE INCREMENT, in units: `volumeStep × contractSize` from the broker.
   * `0.1` on an index CFD (0.1 lots × contract size 1), `1` on a share, `1` on BTC.
   *
   * ⚠️ OMITTED OR NULL IS **NOT** 1. It means the granularity is UNKNOWN, and the size is then floored
   * to whole units exactly as before — reported as `granularity: 'assumed-whole'` so a run states which
   * assumption produced its money instead of leaving the reader to infer it.
   */
  unitStep?: number | null;
  /** #1170 — the smallest order the broker accepts, in units (`volumeMin × contractSize`). */
  minUnits?: number | null;
}

export interface Affordability {
  /** Units to actually open. 0 when the position is refused. */
  units: number;
  /** units × pricePerUnit. 0 when refused. */
  notional: number;
  /** notional ÷ equity, as a fraction (2.0 = twice the account). null when refused/unknown. */
  notionalPct: number | null;
  /** TRUE when the request could not be filled at all — the caller must SKIP the trade, not size 1. */
  refused: boolean;
  /** TRUE when the request was reduced to fit the cap. */
  capped: boolean;
  /** Only set on a refusal, so the count and the cause can both be reported. */
  refusedBecause: string | null;
  /**
   * #1170 — which assumption produced `units`. `broker` = the step came from `broker_symbol`;
   * `assumed-whole` = no step was known and whole units were used. Reported, never guessed at.
   */
  granularity: 'broker' | 'assumed-whole';
  /** The step actually applied, in units. 1 when `assumed-whole`. */
  unitStepApplied: number;
}

/**
 * Clamp a requested size to what the account can afford, refusing rather than inflating.
 *
 * ⚠️ `refused` is not an error: it is the same answer a broker gives, and the caller is expected to
 * skip the trade and count it. Returning `units: 1` here — the old floor — is precisely the bug.
 */
export function applyAffordability(input: AffordabilityInput): Affordability {
  const { requestedUnits, pricePerUnit, equity } = input;
  const maxLeverage = Number.isFinite(input.maxLeverage) ? (input.maxLeverage as number) : DEFAULT_MAX_LEVERAGE;

  /**
   * #1170 — THE STEP IS THE BROKER'S, AND A MISSING STEP IS NOT A STEP OF 1.
   *
   * `unitStep` comes from `broker_symbol` (`volumeStep × contractSize`). When it is absent the
   * granularity is UNKNOWN, so whole units are used — the pre-existing behaviour — and the result
   * says so. Silently treating "unknown" as 1 is what made four instruments untestable while looking
   * like a deliberate policy.
   */
  const stepKnown = Number.isFinite(input.unitStep) && (input.unitStep as number) > 0;
  const step = stepKnown ? (input.unitStep as number) : 1;
  const granularity: Affordability['granularity'] = stepKnown ? 'broker' : 'assumed-whole';
  const minUnitsKnown = Number.isFinite(input.minUnits) && (input.minUnits as number) > 0;
  const minUnits = minUnitsKnown ? (input.minUnits as number) : 0;
  /**
   * Floor to a step boundary without floating-point dust. `0.1 + 0.1 + 0.1 !== 0.3`, so a raw
   * `Math.floor(x / step) * step` can produce `0.30000000000000004` — a size no broker accepts in a
   * form that compares equal to one it does. Ten decimals is far finer than any real tick.
   */
  const floorToStep = (value: number): number =>
    Math.round(Math.floor(value / step + 1e-9) * step * 1e10) / 1e10;

  // ── Guard the inputs, because a non-physical input silently produces a non-physical size ──
  if (!Number.isFinite(pricePerUnit) || pricePerUnit <= 0) {
    return refuse(`entry price is not a positive number (${pricePerUnit})`, granularity, step);
  }
  if (!Number.isFinite(equity) || equity <= 0) {
    return refuse(`account size is not a positive number (${equity})`, granularity, step);
  }
  if (!Number.isFinite(maxLeverage) || maxLeverage <= 0) {
    return refuse(`maxLeverage is not a positive number (${maxLeverage})`, granularity, step);
  }

  const requested = floorToStep(Number.isFinite(requestedUnits) ? requestedUnits : 0);
  if (requested <= 0 || (minUnits > 0 && requested < minUnits)) {
    // ⚠️ TWO DIFFERENT REASONS, both of which must not become a size. Either the sizing model produced
    // nothing (a zero risk budget, or a budget smaller than one step), or it produced less than the
    // smallest order the broker accepts. Both are "cannot place this trade" — but the arithmetic that
    // explains it is printed, because a refusal that only says "no units" hides the one number that
    // matters: what one step costs.
    const oneStep = pricePerUnit * (minUnitsKnown && minUnits > step ? minUnits : step);
    return refuse(
      `the sizing model produced ${Number.isFinite(requestedUnits) ? requestedUnits : 0} unit(s) and the `
      + `smallest tradeable size is ${(minUnitsKnown && minUnits > step ? minUnits : step)} (${oneStep.toFixed(2)} `
      + `of notional priced ${pricePerUnit.toFixed(2)}) against an account of ${equity.toFixed(2)} x ${maxLeverage}`,
      granularity,
      step,
    );
  }

  const maxUnits = floorToStep((equity * maxLeverage) / pricePerUnit);
  if (maxUnits <= 0 || (minUnits > 0 && maxUnits < minUnits)) {
    // ⚠️ THE BTC CASE, AND NOW ALSO THE SMALL-STEP CASE. Refusing is right; forcing the minimum is what
    // turned $10,000 into a $77,600 position.
    const smallest = minUnitsKnown && minUnits > step ? minUnits : step;
    return refuse(
      `the smallest tradeable size is ${smallest} units, costing ${(smallest * pricePerUnit).toFixed(2)}, `
      + `and the account (${equity.toFixed(2)}) x ${maxLeverage} affords ${maxUnits} — the instrument is `
      + 'too large for this account at this leverage',
      granularity,
      step,
    );
  }

  const units = Math.min(requested, maxUnits);
  const notional = units * pricePerUnit;
  return {
    units,
    notional,
    notionalPct: notional / equity,
    refused: false,
    capped: units < requested,
    refusedBecause: null,
    granularity,
    unitStepApplied: step,
  };
}

function refuse(refusedBecause: string, granularity: Affordability['granularity'], step: number): Affordability {
  return {
    units: 0,
    notional: 0,
    notionalPct: null,
    refused: true,
    capped: false,
    refusedBecause,
    granularity,
    unitStepApplied: step,
  };
}
