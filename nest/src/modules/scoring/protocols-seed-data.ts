// Auto-generated protocol seed data — used by ProtocolDbService.seedProtocolsToDatabase()
// Regenerate from live DB: node scripts/dump-protocol-seed.cjs
// Source: POST /api/scoring/gated/protocols/seed uses this data to populate empty DBs.

export interface SeedProtocolGroup {
  id: string;
  name: string;
  description: string;
  weight: number;
  isRiskGate: boolean;
  minMultiplier: number;
  maxMultiplier: number;
  directiveIds: string[];
  /**
   * Per-entry directive parameters (#1165, added 2026-11-01).
   *
   * ⚠️ WITHOUT THIS, A TUNED PARAMETER CANNOT SURVIVE A REINSTALL. `params` lives on
   * `protocol_directive_entry`, which is seeded only from the data below — so a value set through
   * the UI is a change to ONE MACHINE, and the seed discipline rule (`database-seed-discipline`)
   * says that is lost. Only declare a parameter here when the TUNED value is the intended one for
   * this protocol; a value equal to the directive's default does not need declaring, and pinning it
   * would silently survive a later improvement to that default.
   *
   * Keys and ranges are validated against the directive's own `params` spec at seed time, so a typo
   * fails loudly instead of installing a number nothing reads.
   */
  directiveParams?: Record<string, Record<string, number | boolean>>;
  /**
   * NAMED instances of a directive — a second configuration scored on the same bars (#1165).
   *
   * `directiveIds` still names each directive once (that is the primary instance, label `''`). An item
   * here adds a NAMED instance of a directive already in `directiveIds`; a named instance of a
   * directive the group does not list would never be scored, so the seed-integrity spec refuses it.
   *
   * ⚠️ Instances are AVERAGED into one directive slot at scoring time, so declaring one changes WHICH
   * view of that directive a protocol reads and NEVER its configured capacity.
   */
  directiveInstances?: Array<{
    directiveId: string;
    /** Non-empty. `''` is reserved for the primary instance declared by `directiveIds`. */
    label: string;
    params?: Record<string, number | boolean>;
  }>;
}

export interface SeedProtocol {
  name: string;
  description: string;
  directionMode: string;
  tradingStyle: string | null;
  recommendedTimeframe: string | null;
  derivedFrom?: string | null;
  avgHoldTime: string | null;
  winRateTarget: string | null;
  idealFor: string | null;
  groups: SeedProtocolGroup[];
}

export const PROTOCOL_SEED_DATA: Record<string, SeedProtocol> = {
  "xau-speed-v1": {
    "name": "Gold Speed Scalp V1",
    "description": "Sub-minute gold (XAUUSD) scalping protocol. Gold is the ultimate fear gauge — volatile during CPI, FOMC, NFP, geopolitics. Tight spreads, massive liquidity. Reacts to USD strength and real rates.",
    "directionMode": "LONG_ONLY",
    "tradingStyle": "Tick Scalp",
    "recommendedTimeframe": "5s–30s",
    "avgHoldTime": "Seconds to a few minutes",
    "winRateTarget": "65–75%",
    "idealFor": "XTrend gold speed trading during London/NY overlap (12:00–16:00 GMT). Avoid first 5min after major news — spreads widen dramatically.",
    "groups": [
      {
        "id": "technical",
        "name": "Micro-Structure Technicals",
        "description": "Micro-Structure Technicals",
        "weight": 0.4,
        "isRiskGate": false,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "speed-momentum",
          "bollinger-band-squeeze",
          "volume-confirmation",
          "volatility-tools",
          "rsi-oversold",
          "support-resistance-levels",
          "session-open-effect",
          "gold-round-numbers"
        ]
      },
      {
        "id": "sentiment",
        "name": "Sentiment & Macro Context",
        "description": "Sentiment & Macro Context",
        "weight": 0.2,
        "isRiskGate": false,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "gold-macro-correlation",
          "gold-session-profile"
        ]
      },
      {
        "id": "risk",
        "name": "Execution Risk",
        "description": "Execution Risk",
        "weight": 0.4,
        "isRiskGate": true,
        "minMultiplier": 0.4,
        "maxMultiplier": 1.3,
        "directiveIds": [
          "liquidity-check"
        ]
      }
    ]
  },
  "momentum-stock-v1": {
    "name": "Momentum Stocks V1",
    "description": "Group protocol for stocks with 100%+ annual gains and continued high expectations. Trend-following bias — winners keep winning until they don't. Higher sentiment weight than index protocols — these stocks are driven by narrative.",
    "directionMode": "LONG_ONLY",
    "tradingStyle": "Day Trade / Swing",
    "recommendedTimeframe": "5m–1d",
    "avgHoldTime": "Hours to days",
    "winRateTarget": "55–65%",
    "idealFor": "High-momentum stocks: NVDA, MSTR, PLTR, AVGO, COIN, MARA, RIOT, HOOD, RKLB, ASTS, SOFI. Score the wishlist, trade the top 1-2 signals. Never hold through earnings without confirmation.",
    "groups": [
      {
        "id": "technical",
        "name": "Momentum Technicals",
        "description": "Momentum Technicals",
        "weight": 0.35,
        "isRiskGate": false,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "speed-momentum",
          "ema-structure",
          "macd-crossover",
          "volume-confirmation",
          "bollinger-band-squeeze",
          "rsi-oversold",
          "support-resistance-levels"
        ]
      },
      {
        "id": "sentiment",
        "name": "Sentiment & Expectations",
        "description": "Sentiment & Expectations",
        "weight": 0.35,
        "isRiskGate": false,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "analyst-adjustments",
          "social-buzz",
          "earnings-momentum"
        ]
      },
      {
        "id": "risk",
        "name": "High-Momentum Risk",
        "description": "High-Momentum Risk",
        "weight": 0.3,
        "isRiskGate": true,
        "minMultiplier": 0.4,
        "maxMultiplier": 1.3,
        "directiveIds": [
          "liquidity-check"
        ]
      }
    ]
  },
  "forex-session-v1": {
    "name": "Forex Session V1",
    "description": "Forex scoring protocol — session-based mean reversion with trend following. Works across EURUSD, GBPUSD, USDJPY, USDCAD, EURGBP.",
    "directionMode": "LONG_ONLY",
    "tradingStyle": "Session / Mean Reversion",
    "recommendedTimeframe": "5m",
    "avgHoldTime": "Minutes to hours",
    "winRateTarget": "60–70%",
    "idealFor": "Forex pairs during London/NY session overlap. Mean-reverting within daily ranges, trend-following on session breaks.",
    "groups": [
      {
        "id": "technical",
        "name": "Technical Analysis",
        "description": "Technical Analysis",
        "weight": 0.4,
        "isRiskGate": false,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "rsi-oversold",
          "bollinger-band-squeeze",
          "support-resistance-levels",
          "ema-structure",
          "macd-crossover",
          "session-open-effect"
        ]
      },
      {
        "id": "sentiment",
        "name": "Sentiment & Fundamentals",
        "description": "Sentiment & Fundamentals",
        "weight": 0.35,
        "isRiskGate": false,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "analyst-adjustments",
          "spy-qqq-relative-strength"
        ]
      },
      {
        "id": "risk",
        "name": "Risk",
        "description": "Risk",
        "weight": 0.25,
        "isRiskGate": true,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "liquidity-check"
        ]
      }
    ]
  },
};
