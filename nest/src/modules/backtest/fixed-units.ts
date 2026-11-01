/**
 * resolveFixedUnits() — WHAT SIZE does a constant-size run hold? (#1143)
 *
 * ── WHY THIS IS A SEPARATE FUNCTION ─────────────────────────────────────────────────────────────
 * The size a `fixedUnits` run holds is the one number in the backtester that is supposed to equal the
 * LIVE bot's position. Getting it from `baseSize × contractSize` is arithmetic; getting it wrong is a
 * silent money error, and the alternative to arithmetic here is a fallback to a percentage — which is
 * the exact 5× mismatch #1143 measured (`Gold Macro Position` commits $4,015 live; the same protocol at
 * 2% risk / 1% stop simulated $20,074). So the rule lives in one testable place rather than inline in a
 * 3,900-line `run()`.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────────────────────────
 *   1. an explicit `fixedUnits` wins — the operator typed a number and meant it;
 *   2. otherwise the named bot's `baseSize × contractSize`;
 *   3. otherwise THROW. Never fall back to a percentage, and never invent a size.
 *
 * ⚠️ THROWING IS THE CORRECT BEHAVIOUR, and it happens before a single bar is read. A run that says
 * "sized like the bot" while using a size the bot does not have is worse than no run: it produces a
 * plausible P&L attributed to a configuration that was never tested.
 */

export interface FixedUnitsInput {
  /** `fixedUnits` from the request, when the operator supplied one. */
  requested?: number | null;
  /** The bot's own lot size (`trading_strategy.baseSize`), when a bot was named and resolved. */
  botBaseSize?: number | null;
  /** Base units per lot (`broker_symbol.contractSize`) for the routed symbol. */
  contractSize?: number | null;
  /** Used in the refusal message so the reader knows which symbol could not be resolved. */
  symbol: string;
}

export interface FixedUnitsResolution {
  units: number;
  /** Why this number — so a stored run can say where its size came from. */
  source: 'requested' | 'bot';
}

const positive = (v: number | null | undefined): v is number => Number.isFinite(v) && (v as number) > 0;

export function resolveFixedUnits(input: FixedUnitsInput): FixedUnitsResolution {
  if (positive(input.requested)) {
    return { units: input.requested, source: 'requested' };
  }
  if (positive(input.botBaseSize) && positive(input.contractSize)) {
    return { units: input.botBaseSize * input.contractSize, source: 'bot' };
  }
  /**
   * ⚠️ NAME BOTH MISSING INPUTS, and name the symbol. A refusal that only said "no size" would send the
   * reader looking in the request, when the actual gap may be a missing `symbol_route` row — measured
   * 2026-11-01: `XAUUSD` has no route at all, so its contract size cannot be resolved and its bot's own
   * size is unknowable. The message has to make that distinction visible.
   */
  const bot = positive(input.botBaseSize) ? String(input.botBaseSize) : 'none';
  const contract = positive(input.contractSize) ? String(input.contractSize) : `not found for ${input.symbol}`;
  throw new Error(
    'positionModel "fixedUnits" needs a size: send `fixedUnits`, or name a `botId` whose `baseSize` '
    + `and contract size can be resolved (bot baseSize=${bot}, contract size=${contract}). `
    + 'Nothing was run — a constant-size backtest with an invented size would not describe the bot.',
  );
}
