/**
 * PLACEHOLDER — implement per SPRINT.md Task 4.
 *
 * Directive Contract
 * ==================
 * Every scoring directive MUST implement this interface.
 * Directives are stateless, pure functions that evaluate market data
 * and return a score with confidence and a human-readable reason.
 *
 * Contract rules (from Architecture Framework):
 * - Keep directives stateless and pure — no side effects.
 * - Return scores in range 0–100.
 * - Include confidence as 0–1 (where 1 = high confidence).
 * - Include a human-readable reason string for the score.
 * - Directives MUST NOT depend on each other.
 * - Input validation is mandatory (reject invalid data early).
 * - Do not hardcode magic numbers — use configurable thresholds.
 * - Unit tests are required for each directive with known input/output pairs.
 */

export interface MarketBar {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface DirectiveInput {
  symbol: string;
  bars: MarketBar[]; // Price candles ordered oldest → newest
}

export interface DirectiveResult {
  score: number; // 0–100
  confidence: number; // 0–1
  reason: string; // Human-readable explanation
  /** Directional bias. Defaults to 'neutral' when absent. */
  signalClass?: 'bullish' | 'bearish' | 'neutral';
}

export interface IDirective {
  /** Unique identifier, e.g. "rsi-oversold". */
  readonly id: string;

  /** Human-readable name, e.g. "RSI Oversold Reversion". */
  readonly name: string;

  /** Brief description of what this directive evaluates. */
  readonly description: string;

  /**
   * Importance priority 1–100.
   * Higher = more influential in dominance/cancellation decisions.
   * Priority 80+ can override lower-priority opposing directives.
   * Defaults to 50 when absent.
   */
  readonly priority?: number;

  /**
   * Evaluate the directive against the provided market data.
   * Must NOT throw — return a neutral/low-confidence result on error.
   */
  calculate(input: DirectiveInput): DirectiveResult;
}
