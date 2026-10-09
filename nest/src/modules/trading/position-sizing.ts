/**
 * position-sizing.ts — THE sizing decision, in ONE place (#843).
 * ===============================================================================
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `backtest.service.ts` implemented FOUR sizing models (`fixedDollar`, `atrEqualRisk`,
 * `kellyFull`/`kellyHalf`, `fixedPercent`) while the live automation loop read a fixed lot from
 * the strategy row (`baseSize`) and sent it unchanged. A backtest that sizes with equal risk and
 * a live loop that sends 0.01 lots are answering DIFFERENT questions, so the backtest's return,
 * drawdown and Sharpe numbers cannot describe the live system — and they fail in the direction
 * that looks fine, because 0.01 lots of EURUSD and 0.01 lots of gold are not remotely the same
 * risk. Same defect class as everything else in this repo: plausible numbers, no error.
 *
 * THE CONTRACT (units matter — read this before calling)
 * ------------------------------------------------------
 * `computeSizing()` returns `rawSize` in **per-price-units**: "how many units, each of which
 * loses exactly `stopDistance` in account currency if the stop is hit".
 *   - Equities backtester: 1 unit = 1 share. Use `rawSize` directly.
 *   - MT5 live path: divide by `valuePerPriceUnitPerLot` (= `tickValue / tickSize`, money per
 *     1.0 of price per 1 lot) to get LOTS, then `applyVolumeConstraints()`.
 * One maths, two unit adapters. A caller must not re-implement the maths to fix its own units.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 * - No rounding. The backtester floors to whole shares itself; the live path rounds to the
 *   broker's `volumeStep` via `applyVolumeConstraints`. THE CALLER OWNS ITS UNIT — see contract.
 * - No "no-edge" policy for Kelly. When the fraction is ≤ 0 the maths returns `unusable`; the
 *   BACKTESTER keeps its historical behaviour (size 1), and the LIVE path refuses visibly.
 *   That divergence is deliberate and each caller documents it at its call site — do not merge.
 * - No defaults. A missing input is `unusable`, never a guessed number. `riskPct` 1.0 is a
 *   config a bot must be MIGRATED to; it is never applied because a field was empty.
 */

/** The selectable models. `fixedLot` is the pre-#843 live behaviour and the unchanged default. */
export type SizingModel =
  | 'fixedLot'
  | 'fixedPercent'
  | 'fixedDollar'
  | 'atrEqualRisk'
  | 'kellyFull'
  | 'kellyHalf';

export const SIZING_MODELS: readonly SizingModel[] = [
  'fixedLot', 'fixedPercent', 'fixedDollar', 'atrEqualRisk', 'kellyFull', 'kellyHalf',
];

export interface SizingInput {
  model: SizingModel;
  /** Account equity in account currency. Required by every model except `fixedLot`. */
  equity?: number | null;
  /** Price the position opens at. Required by every model except `fixedLot`. */
  entryPrice?: number | null;
  /** `fixedLot` — the configured lot. */
  fixedLot?: number | null;
  /** `fixedPercent` / `atrEqualRisk` — risk per trade as % of equity. */
  riskPct?: number | null;
  /** `fixedDollar` — money risked per trade. */
  fixedAmount?: number | null;
  /**
   * Price distance from entry to the stop. `fixedPercent` requires it; `atrEqualRisk` uses it
   * when given (live path: the stop the order will actually carry), else `atrStopDistance`.
   */
  stopDistance?: number | null;
  /** `atrEqualRisk` — ATR × multiplier, when the caller measured ATR itself (backtester). */
  atrStopDistance?: number | null;
  /** Kelly — reward:risk comes from `tpPct/slPct`. */
  tpPct?: number | null;
  slPct?: number | null;
  kellyCapPct?: number | null;
}

export interface SizingEvaluation {
  model: SizingModel;
  /** Size in per-price-units BEFORE rounding/clamping — the evidence for the calculation. */
  rawSize: number | null;
  /** The stop distance actually divided by — echoed so the evidence is checkable. */
  usedStopDistance: number | null;
  /** Set when the maths could not produce a size. The caller decides what to do (see header). */
  unusable: { code: string; reason: string } | null;
}

const bad = (model: SizingModel, code: string, reason: string): SizingEvaluation =>
  ({ model, rawSize: null, usedStopDistance: null, unusable: { code, reason } });

/** Positive, finite number or null. A zero/NaN/negative config is MISSING, never "no risk". */
const pos = (v: number | null | undefined): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;

/**
 * computeSizing() — the model maths, extracted from `backtest.service.ts` (#843) so the
 * backtester and the live loop cannot drift. Behaviour-preserving for every model the
 * backtester already used — its spec suite is the regression check on this extraction.
 */
export function computeSizing(input: SizingInput): SizingEvaluation {
  const { model } = input;

  if (model === 'fixedLot') {
    const lot = pos(input.fixedLot);
    if (lot == null) return bad(model, 'SIZING-NO-LOT', 'fixedLot model with no lot configured');
    return { model, rawSize: lot, usedStopDistance: null, unusable: null };
  }

  const equity = pos(input.equity);
  const entryPrice = pos(input.entryPrice);
  if (equity == null) return bad(model, 'SIZING-NO-EQUITY', 'account equity is unknown or zero');
  if (entryPrice == null) return bad(model, 'SIZING-NO-PRICE', 'entry price is unknown or zero');

  if (model === 'fixedDollar') {
    const amount = pos(input.fixedAmount);
    if (amount == null) return bad(model, 'SIZING-NO-AMOUNT', 'fixedDollar model with no fixed amount');
    return { model, rawSize: amount / entryPrice, usedStopDistance: null, unusable: null };
  }

  if (model === 'atrEqualRisk') {
    const riskPct = pos(input.riskPct);
    if (riskPct == null) return bad(model, 'SIZING-NO-RISK-PCT', 'atrEqualRisk model with no riskPct');
    // The stop the position will actually carry wins (live path); the measured ATR distance is
    // the fallback (backtester, which computes ATR from its own bars).
    const stop = pos(input.stopDistance) ?? pos(input.atrStopDistance);
    if (stop == null) return bad(model, 'SIZING-NO-STOP', 'no stop distance and no ATR distance');
    return { model, rawSize: (equity * (riskPct / 100)) / stop, usedStopDistance: stop, unusable: null };
  }

  if (model === 'kellyFull' || model === 'kellyHalf') {
    const tpPct = pos(input.tpPct);
    const slPct = pos(input.slPct);
    if (tpPct == null || slPct == null) return bad(model, 'SIZING-NO-TPSL', 'Kelly needs tpPct and slPct');
    const cap = pos(input.kellyCapPct) ?? 25;
    const b = tpPct / slPct;               // reward:risk ratio
    const p = 0.5;                          // neutral prior — deliberately NOT improved here
    const q = 1 - p;
    const cappedFraction = Math.min((b * p - q) / b, cap / 100);
    const fraction = model === 'kellyHalf' ? cappedFraction / 2 : cappedFraction;
    if (!(fraction > 0)) {
      // No edge under the neutral prior. NOT an error in the maths — a caller policy. The
      // backtester opens size 1 (historical); the live path refuses with this code.
      return bad(model, 'SIZING-KELLY-NO-EDGE', 'Kelly fraction is ≤ 0 at the neutral 50% prior');
    }
    return { model, rawSize: (equity * fraction) / entryPrice, usedStopDistance: null, unusable: null };
  }

  // fixedPercent — risk `riskPct`% of equity on the stop distance; entry price is the fallback
  // denominator when no stop exists (behaviour kept from the backtester).
  const riskPct = pos(input.riskPct);
  if (riskPct == null) return bad(model, 'SIZING-NO-RISK-PCT', 'fixedPercent model with no riskPct');
  const stop = pos(input.stopDistance);
  const denominator = stop ?? entryPrice;
  return { model, rawSize: (equity * (riskPct / 100)) / denominator, usedStopDistance: stop, unusable: null };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Broker volume constraints — rounding to the step and clamping to min/max
// ─────────────────────────────────────────────────────────────────────────────────────────────

export interface VolumeConstraints {
  /** Broker minimum lots. REQUIRED for a sized order — unknown is not "no minimum". */
  volumeMin?: number | null;
  /** Broker maximum lots. `null`/0 = no ceiling, matching the bridge's own `volume_max > 0` test. */
  volumeMax?: number | null;
  /** Broker lot step. REQUIRED — an order off the step is rejected by the terminal. */
  volumeStep?: number | null;
}

export interface VolumeResolution {
  ok: boolean;
  /** Final lots after rounding + clamping. */
  volume: number | null;
  /** What clamping did, so the decision can report it: none | rounded | raised-to-min | capped-at-max. */
  action: 'none' | 'rounded' | 'raised-to-min' | 'capped-at-max' | null;
  /** Present when ok === false — a TCS notice code, so the failure is visible, not silent. */
  noticeCode?: string;
  reason?: string;
}

/** Floor `raw` to a multiple of `step`, tolerant of float noise (0.1+0.2 problems). */
function floorToStep(raw: number, step: number): number {
  const steps = Math.floor(raw / step + 1e-9);
  return Number((steps * step).toFixed(8));
}

/**
 * applyVolumeConstraints() — the LAST step before an order is sized (#843).
 *
 * ⚠️ WHY A SEPARATE FUNCTION. Rounding and clamping are broker facts, not model maths: the
 * backtester's share counts must not be pushed through a lot step, and the live path must not
 * inherit the backtester's `Math.floor`+`min 1` convention. The maths lives once above; the
 * units and the venue live here.
 *
 * ⚠️ UNKNOWN STEP / MIN IS A REFUSAL, NOT A GUESS. A missing `volumeStep` (old bridge — see
 * `getSizingContext`) or a missing `volumeMin` means the volume cannot be made valid for this
 * venue; sending an off-step order would produce a bridge refusal with no explanation of WHY
 * the size was wrong. `ok: false` + a notice code instead — the caller skips the dispatch and
 * says so in the decision record.
 */
export function applyVolumeConstraints(raw: number, constraints: VolumeConstraints): VolumeResolution {
  const step = pos(constraints.volumeStep);
  const min = pos(constraints.volumeMin);
  const max = pos(constraints.volumeMax); // null = no ceiling

  if (!(Number.isFinite(raw) && raw > 0)) {
    return { ok: false, volume: null, action: null, noticeCode: 'TCS-TRADE-023', reason: `computed volume is ${raw}` };
  }
  if (step == null) {
    return { ok: false, volume: null, action: null, noticeCode: 'TCS-TRADE-023', reason: 'broker volume step is unknown (bridge did not report volumeStep)' };
  }
  if (min == null) {
    return { ok: false, volume: null, action: null, noticeCode: 'TCS-TRADE-023', reason: 'broker volume minimum is unknown' };
  }
  if (max != null && max < min) {
    return { ok: false, volume: null, action: null, noticeCode: 'TCS-TRADE-023', reason: `broker constraints are impossible (max ${max} < min ${min})` };
  }

  let volume = floorToStep(raw, step);
  let action: VolumeResolution['action'] = 'rounded';

  if (volume < min) {
    volume = min;
    action = 'raised-to-min';
  } else if (max != null && volume > max) {
    volume = floorToStep(max, step);
    // A floor can only shrink; if the max itself is below min the constraints were refused above.
    if (volume < min) volume = min;
    action = 'capped-at-max';
  }

  if (!(Number.isFinite(volume) && volume > 0)) {
    return { ok: false, volume: null, action: null, noticeCode: 'TCS-TRADE-023', reason: `rounded volume is ${volume}` };
  }
  return { ok: true, volume, action };
}

/**
 * valuePerPriceUnitPerLot() — MT5's money-at-risk conversion (#843).
 *
 * `tickValue` is the account-currency value of one `tickSize` price move on ONE lot, so
 * `tickValue / tickSize` is the account-currency risk of a 1.0 price move on one lot. The live
 * path needs it to turn `rawSize` (per-price-units) into lots. Returns null when either half is
 * missing — callers must refuse, never assume 1, because assuming would mis-size by orders of
 * magnitude on metals and indices.
 */
export function valuePerPriceUnitPerLot(tickValue: number | null | undefined, tickSize: number | null | undefined): number | null {
  const tv = pos(tickValue);
  const ts = pos(tickSize);
  if (tv == null || ts == null) return null;
  return tv / ts;
}
