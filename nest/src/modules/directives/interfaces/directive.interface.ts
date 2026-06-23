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
 * - Return scores in the directive's natural range (0 to maxScore).
 * - Include confidence as 0–1 (where 1 = high confidence).
 * - Include a human-readable reason string for the score.
 * - Directives MUST NOT depend on each other.
 * - Input validation is mandatory (reject invalid data early).
 * - Do not hardcode magic numbers — use configurable thresholds.
 * - Unit tests are required for each directive with known input/output pairs.
 *
 * Score model:
 * - Each directive declares its own maxScore (not a fixed 100).
 * - A directive with maxScore=180 naturally carries more weight than one with maxScore=90.
 * - The protocol's total maximum is the sum of all directive maxScores.
 * - There is NO artificial cap at 100 — scores flow from directive ranges.
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
  /** Score in the directive's natural range (0 to directive.maxScore). NOT capped at 100. */
  score: number;
  /** Directive-level confidence 0–1. Distinct from protocol-level normalized %. */
  confidence: number;
  /** Human-readable explanation. */
  reason: string;
  /** Directional bias. Defaults to 'neutral' when absent. */
  signalClass?: 'bullish' | 'bearish' | 'neutral';
  /** True if the directive was suppressed by an active-window time gate. */
  timeGated?: boolean;
  /** Time modifiers that were applied to adjust the score. */
  timeModifiersApplied?: { adjustment: number; reason: string }[];
}

export interface TimeWindow {
  /** Start time in HH:mm format (e.g. "09:30"). */
  start: string;
  /** End time in HH:mm format (e.g. "16:00"). */
  end: string;
  /** IANA timezone string (e.g. "America/New_York"). Never a UTC offset. */
  timezone: string;
  /** Days of week this window applies: 0=Sun, 1=Mon, ..., 6=Sat. If omitted, all days. */
  daysOfWeek?: number[];
}

export interface TimeModifier {
  /** Start of the modifier window in HH:mm (e.g. "14:30"). */
  after: string;
  /** Optional end of the modifier window in HH:mm (e.g. "16:00"). If omitted, applies from 'after' onwards. */
  before?: string;
  /** Score adjustment — positive = bonus, negative = deduction. */
  adjustment: number;
  /** Human-readable reason for the adjustment (e.g. "Pre-US strategy — post-open decay"). */
  reason: string;
}

export interface IDirective {
  /** Unique identifier, e.g. "rsi-oversold". */
  readonly id: string;

  /** Human-readable name, e.g. "RSI Oversold Reversion". */
  readonly name: string;

  /** Brief description of what this directive evaluates. */
  readonly description: string;

  /**
   * The maximum score this directive can return.
   * Higher maxScore = more influence on the total protocol score.
   * A directive with maxScore=180 naturally carries ~2× the weight of one with maxScore=90.
   * This replaces old-style strategy weights — the range IS the weight.
   */
  readonly maxScore: number;

  /**
   * Semantic version of this directive (e.g. "1.0.0").
   * Incremented when the directive's scoring logic is fixed (not experimentally adjusted).
   * Version changes are detected at startup and logged as part of protocol history.
   */
  readonly version: string;

  /**
   * Importance priority 1–100.
   * Higher = more influential in dominance/cancellation decisions.
   * Priority 80+ can override lower-priority opposing directives.
   * Defaults to 50 when absent.
   */
  readonly priority?: number;

  /**
   * Optional active window — if set, the directive only scores within this time window.
   * Outside the window, it returns score 0 (time-gated).
   * Uses IANA timezone strings (e.g. "America/New_York"), never UTC offsets.
   */
  readonly activeWindow?: TimeWindow;

  /**
   * Optional time modifiers — adjust the directive's score based on time proximity.
   * Applied AFTER calculate() — bonuses boost the score, deductions reduce it.
   */
  readonly timeModifiers?: TimeModifier[];

  /**
   * Evaluate the directive against the provided market data.
   * Must NOT throw — return a neutral/low-confidence result on error.
   * Score should be in range 0 to this.maxScore.
   */
  calculate(input: DirectiveInput): DirectiveResult;
}
