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
  /** Higher-timeframe bars for multi-timeframe directives. Optional — most directives ignore these. */
  dayBars?: MarketBar[];
  hourBars?: MarketBar[];
  min15Bars?: MarketBar[];
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
  /** True if the directive was muted by an activation gate (Q301). */
  gated?: boolean;
  /** Reason why the activation gate muted/adjusted this directive. */
  gatedReason?: string;
  /** Time modifiers that were applied to adjust the score. */
  timeModifiersApplied?: { adjustment: number; reason: string }[];
  /** Arbitrary metadata from the directive (e.g., wick ratio, ATR values). */
  metadata?: Record<string, any>;
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

// ── Activation Gates (Q301) ──

export type RegimeType = 'trending' | 'ranging' | 'chaotic' | 'any';
export type VolatilityLevel = 'low' | 'normal' | 'high' | 'any';
export type InstrumentType = 'forex' | 'stocks' | 'crypto' | 'indices' | 'commodities';
export type TradingSession = 'US' | 'London' | 'Asian' | 'off-hours';

/** Static suitability tags attached to each directive by design. */
export interface SuitabilityProfile {
  /** Which market regime this directive is designed for. */
  regimeType: RegimeType;
  /** Volatility level this directive is calibrated for. */
  volatilityLevel: VolatilityLevel;
  /** Instrument types this directive applies to. */
  readonly instrumentTypes: readonly InstrumentType[];
  /** Minimum timeframe required (e.g. "M5", "M15", "H1"). */
  minTimeframe: string;
  /** Trading sessions where this directive is most effective. */
  readonly preferredSessions: readonly TradingSession[];
}

/** Runtime condition snapshot produced by the ConditionDetector before scoring. */
export interface ConditionVector {
  regime: 'trending' | 'ranging' | 'chaotic';
  /** Ensemble strength 0–1. >0.65 = strong trending, <0.35 = chaotic. */
  regimeStrength: number;
  /** Component breakdown of the ensemble score. */
  regimeComponents: {
    hurst: number;
    adx: number;
    volatilityPercentile: number;
  };
  hurstExponent: number;
  volatility: 'low' | 'normal' | 'high';
  activeSession: TradingSession;
  adx: number;
  atrPercentile: number;
  /** True if within 30min of a major economic event (FOMC, NFP, CPI). */
  preEvent: boolean;
  timestamp: Date;
}

export interface IDirective {
  /** Unique identifier, e.g. "rsi-oversold". */
  readonly id: string;

  /** Human-readable name, e.g. "RSI Oversold Reversion". */
  readonly name: string;

  /** Brief description of what this directive evaluates. */
  readonly description: string;

  /**
   * Readiness tier — enforced by the scoring pipeline and activation gates.
   * - 'alpha': Mock, stub, or placeholder. Excluded from composite scoring.
   * - 'beta': Real math but degraded/proxy data. Included with capped confidence.
   * - 'ready': Verified against live data. Full scoring active.
   *
   * Default is 'alpha' (alpha until proven otherwise). See docs/readiness-tiers.md.
   * A protocol can only claim the readiness of its weakest directive.
   */
  readonly readiness: 'alpha' | 'beta' | 'ready';

  /**
   * Directional bias of this directive.
   * - 'bullish': Only produces buy/hold signals. Exclude from SHORT_ONLY protocols.
   * - 'bearish': Only produces sell/hold signals. Exclude from LONG_ONLY protocols.
   * - 'neutral': No directional bias. Include in all protocols.
   * Defaults to 'neutral' if not set.
   */
  readonly directionBias?: 'bullish' | 'bearish' | 'neutral';

  /**
   * Scoring category — determines which template to use.
   * - 'oscillator': Bounded scale (RSI, CCI, VI). Uses curve formula: weight × curve + rawValue.
   * - 'ratio': Unbounded ratio (A/D, volume surge). Hardcoded branch thresholds.
   * - 'pattern': Binary detection (doji, engulfing, calendar). Flat score or zero.
   * - 'structural': Risk gates, regime checks. Modifier, not signal score.
   */
  readonly category?: 'oscillator' | 'ratio' | 'pattern' | 'structural';

  /**
   * Floor value — the directive always returns at least this.
   * Prevents zero scores from looking like the directive failed.
   * Default 0 (no floor). Typical value: 1.
   */
  readonly minScore?: number;

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
   * Optional suitability profile — activation gates (Q301).
   * When set, the directive is checked against the current ConditionVector before scoring.
   * Regime/volatility mismatches mute the directive (score=0).
   * Session mismatches reduce weight by 50%.
   */
  readonly suitability?: SuitabilityProfile;

  /**
   * Minimum number of bars required per timeframe for this directive to produce
   * a meaningful score. When the input has fewer bars than declared here,
   * the directive may return score 0 (data-starved) rather than a false signal.
   *
   * Keyed by timeframe string (e.g. '1m', '5m', '1h', '1d').
   * Example: { '1d': 25 } — this directive needs at least 25 daily bars.
   *
   * If omitted, the directive has no minimum bar requirement (uses all available).
   * If the input timeframe is not in the map, the directive runs regardless.
   *
   * Used by protocol-level requiredBars computation and dynamic data fetching
   * to ensure every directive in a protocol gets adequate market data.
   */
  readonly minBars?: Record<string, number>;

  /**
   * External data feeds this directive depends on (beyond OHLCV bars).
   * Used by Layer B capability contracts to check if a strategy's data
   * requirements can be met before activation.
   *
   * Common values:
   *   'dxy'          — US Dollar Index (DXY or EURUSD proxy)
   *   'vix'          — Volatility Index (VIX or ATR proxy)
   *   'treasury10y'  — 10-year Treasury yield
   *   'oil'          — Crude oil price (WTI/Brent)
   *   'news'         — News sentiment API (Alpha Vantage / Finnhub)
   *   'earnings'     — Earnings calendar data
   *   'social'       — Social media sentiment (Reddit / Twitter)
   *   'insider'      — Insider trading filings
   *   'fear-greed'   — Crypto Fear & Greed Index (alternative.me)
   *   'halving'      — Bitcoin halving cycle data
   *
   * If omitted or empty, the directive only needs bar data (self-contained).
   * See docs/readiness-tiers.md for how this interacts with readiness tiers.
   */
  readonly requiredDataFeeds?: string[];

  /**
   * Evaluate the directive against the provided market data.
   * Must NOT throw — return a neutral/low-confidence result on error.
   * Score should be in range 0 to this.maxScore.
   * Async directives may fetch external data (Finnhub, etc).
   */
  calculate(input: DirectiveInput): DirectiveResult | Promise<DirectiveResult>;

  /**
   * Meta-directive support (#369). When set, this directive consumes peer directive
   * results instead of raw market data. Dependencies must be scored first in the tick.
   */
  readonly dependsOn?: string[];

  /** How to combine dependency results. 'AND' (all must fire), 'OR' (any), 'WEIGHTED'. */
  readonly combineRule?: 'AND' | 'OR' | 'WEIGHTED';

  /**
   * Optional meta-directive calculation. Receives dependency results + market data.
   * If not set, regular calculate() is used.
   */
  calculateWithPeers?(peerResults: Map<string, DirectiveResult>, input: DirectiveInput): DirectiveResult | Promise<DirectiveResult>;
}
