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
  "btc-speed-v1": {
    "name": "BTC Investment Monitor V1",
    "description": "Medium-term Bitcoin monitoring protocol for investment/ETF entries. Uses halving cycle macro overlay, fear-greed index, and technical momentum. Not for scalping — holds last hours to days.",
    "directionMode": "LONG_ONLY",
    "tradingStyle": "Monitor / Position",
    "recommendedTimeframe": "15m–1d",
    "avgHoldTime": "Hours to days",
    "winRateTarget": "55–65%",
    "idealFor": "Bitcoin ETF entry timing, spot accumulation zones, swing trades around halving cycle phases. Best when halving cycle is in Rally or Mid-Cycle phase.",
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
          "speed-momentum",
          "bollinger-band-squeeze",
          "volume-confirmation",
          "volatility-tools",
          "rsi-oversold",
          "support-resistance-levels",
          "multi-timeframe-trend",
          "micro-sr-levels",
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
          "crypto-fear-greed",
          "social-buzz",
          "btc-halving-cycle",
          "crypto-weekend-effect"
        ]
      },
      {
        "id": "risk",
        "name": "Risk & Structural",
        "description": "Risk & Structural",
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
  "btc-scalp-v1": {
    "name": "BTC Tick Scalp V1",
    "description": "True sub-minute Bitcoin scalping protocol. Designed for $1–$10 positions held seconds to minutes. Heavy risk gating on execution quality — wide spreads or low liquidity kill the signal.",
    "directionMode": "LONG_ONLY",
    "tradingStyle": "Tick Scalp",
    "recommendedTimeframe": "5s–30s",
    "avgHoldTime": "Seconds to a few minutes",
    "winRateTarget": "65–75%",
    "idealFor": "XTrend speed trading — $1 positions, sub-minute holds, high win rate. Requires tight spreads and liquid sessions. Do NOT use for position trading or multi-hour holds.",
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
          "rsi-oversold",
          "support-resistance-levels",
          "multi-timeframe-trend",
          "micro-sr-levels",
          "volatility-tools",
          "session-open-effect"
        ]
      },
      {
        "id": "sentiment",
        "name": "Background Sentiment",
        "description": "Background Sentiment",
        "weight": 0.2,
        "isRiskGate": false,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "crypto-fear-greed",
          "crypto-weekend-effect"
        ]
      },
      {
        "id": "risk",
        "name": "Execution Risk",
        "description": "Execution Risk",
        "weight": 0.4,
        "isRiskGate": true,
        "minMultiplier": 0.5,
        "maxMultiplier": 1.3,
        "directiveIds": [
          "liquidity-check"
        ]
      }
    ]
  },
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
  "xau-speed-m5": {
    "name": "Gold Scalp M5",
    "description": "5-minute gold (XAUUSD) scalping protocol. Derived from xau-speed-v1 — same directive set, longer timeframe for more stable signals. Suitable for semi-auto and automated trading with existing bar refresh.",
    "directionMode": "LONG_ONLY",
    "tradingStyle": "Scalp",
    "recommendedTimeframe": "5m",
    "derivedFrom": "xau-speed-v1",
    "avgHoldTime": "5–30 minutes",
    "winRateTarget": "60–70%",
    "idealFor": "Gold scalping on 5m bars during London/NY overlap. More reliable than tick-level — fewer false signals, still fast enough for multiple trades per session.",
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
        "weight": 0.25,
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
        "weight": 0.35,
        "isRiskGate": true,
        "minMultiplier": 0.4,
        "maxMultiplier": 1.3,
        "directiveIds": [
          "liquidity-check"
        ]
      }
    ]
  },
  "xau-speed-m15": {
    "name": "Gold Day-Trade M15",
    "description": "15-minute gold (XAUUSD) day-trading protocol. Derived from xau-speed-v1 — longer timeframe, broader stops, fewer but higher-quality signals.",
    "directionMode": "LONG_ONLY",
    "tradingStyle": "Day Trade",
    "recommendedTimeframe": "15m",
    "derivedFrom": "xau-speed-v1",
    "avgHoldTime": "30 min – 4 hours",
    "winRateTarget": "55–65%",
    "idealFor": "Day-trading gold during active sessions. Wider stops accommodate intraday swings. Best during London open through NY close.",
    "groups": [
      {
        "id": "technical",
        "name": "Micro-Structure Technicals",
        "description": "Micro-Structure Technicals",
        "weight": 0.35,
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
        "weight": 0.3,
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
        "weight": 0.35,
        "isRiskGate": true,
        "minMultiplier": 0.4,
        "maxMultiplier": 1.3,
        "directiveIds": [
          "liquidity-check"
        ]
      }
    ]
  },
  "xau-speed-1h": {
    "name": "Gold Swing 1H",
    "description": "1-hour gold (XAUUSD) swing trading protocol. Derived from xau-speed-v1 — swing timeframe with trend-following bias. Holds through intraday noise.",
    "directionMode": "LONG_ONLY",
    "tradingStyle": "Swing",
    "recommendedTimeframe": "1h",
    "derivedFrom": "xau-speed-v1",
    "avgHoldTime": "4 hours – 2 days",
    "winRateTarget": "50–60%",
    "idealFor": "Swing trading gold on hourly bars. Captures multi-session trends. Wider stops, fewer trades, higher profit targets per trade.",
    "groups": [
      {
        "id": "technical",
        "name": "Micro-Structure Technicals",
        "description": "Micro-Structure Technicals",
        "weight": 0.3,
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
        "weight": 0.35,
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
        "weight": 0.35,
        "isRiskGate": true,
        "minMultiplier": 0.4,
        "maxMultiplier": 1.3,
        "directiveIds": [
          "liquidity-check"
        ]
      }
    ]
  },
  "xau-speed-4h": {
    "name": "Gold Position 4H",
    "description": "4-hour gold (XAUUSD) position trading protocol. Derived from xau-speed-v1 — multi-day trend following with macro overlay. Ignores intraday noise entirely.",
    "directionMode": "LONG_ONLY",
    "tradingStyle": "Position",
    "recommendedTimeframe": "4h",
    "derivedFrom": "xau-speed-v1",
    "avgHoldTime": "2–10 days",
    "winRateTarget": "45–55%",
    "idealFor": "Position trading gold on 4H bars. Captures weekly trends driven by USD strength, real rates, and geopolitical events. Fewest trades, largest targets.",
    "groups": [
      {
        "id": "technical",
        "name": "Micro-Structure Technicals",
        "description": "Micro-Structure Technicals",
        "weight": 0.25,
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
        "weight": 0.4,
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
        "weight": 0.35,
        "isRiskGate": true,
        "minMultiplier": 0.4,
        "maxMultiplier": 1.3,
        "directiveIds": [
          "liquidity-check"
        ]
      }
    ]
  },
  "oil-speed-v1": {
    "name": "Oil Speed Scalp V1",
    "description": "Sub-minute WTI crude (USOIL) scalping protocol. Extremely event-driven — EIA inventories, OPEC headlines, geopolitical supply shocks. Strong mean-reverting tendencies within daily ranges.",
    "directionMode": "LONG_ONLY",
    "tradingStyle": "Tick Scalp",
    "recommendedTimeframe": "5s–30s",
    "avgHoldTime": "Seconds to a few minutes",
    "winRateTarget": "65–75%",
    "idealFor": "XTrend oil speed trading during NY session (13:30–20:00 GMT). EIA report Wednesdays 14:30 GMT = massive volatility. Avoid Asian session — oil is thin and whippy.",
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
          "session-open-effect"
        ]
      },
      {
        "id": "sentiment",
        "name": "Sentiment & Fundamentals",
        "description": "Sentiment & Fundamentals",
        "weight": 0.25,
        "isRiskGate": false,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "cad-usd-oil-correlation"
        ]
      },
      {
        "id": "risk",
        "name": "Execution Risk",
        "description": "Execution Risk",
        "weight": 0.35,
        "isRiskGate": true,
        "minMultiplier": 0.45,
        "maxMultiplier": 1.3,
        "directiveIds": [
          "liquidity-check"
        ]
      }
    ]
  },
  "spy-speed-v1": {
    "name": "SPY Speed Scalp V1",
    "description": "Sub-minute SPX500/SPY scalping protocol. Exploits options-driven micro-structure: gamma pinning at strikes, 0DTE max pain gravity, opening drive and power hour momentum. The most liquid instrument on Earth.",
    "directionMode": "LONG_ONLY",
    "tradingStyle": "Tick Scalp",
    "recommendedTimeframe": "5s–30s",
    "avgHoldTime": "Seconds to a few minutes",
    "winRateTarget": "65–75%",
    "idealFor": "XTrend SPX500 speed trading during US session (14:30–21:00 GMT). Best during opening drive (first 30min) and power hour (last 60min) when gamma flows are strongest.",
    "groups": [
      {
        "id": "technical",
        "name": "Options-Driven Micro-Structure",
        "description": "Options-Driven Micro-Structure",
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
          "session-open-effect"
        ]
      },
      {
        "id": "sentiment",
        "name": "Market Context",
        "description": "Market Context",
        "weight": 0.25,
        "isRiskGate": false,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": []
      },
      {
        "id": "risk",
        "name": "Session & Execution Risk",
        "description": "Session & Execution Risk",
        "weight": 0.35,
        "isRiskGate": true,
        "minMultiplier": 0.5,
        "maxMultiplier": 1.25,
        "directiveIds": [
          "liquidity-check"
        ]
      }
    ]
  },
  "spy-day-v1": {
    "name": "SPY Day Trade V1",
    "description": "SPX500/SPY day trading protocol for multi-hour holds. Uses session structure — opening range, VWAP gravity, lunch drift, power hour acceleration. Not for scalping — positions held minutes to hours.",
    "directionMode": "LONG_ONLY",
    "tradingStyle": "Day Trade",
    "recommendedTimeframe": "5m–1h",
    "avgHoldTime": "Minutes to hours",
    "winRateTarget": "55–65%",
    "idealFor": "XTrend SPX500 day trading during full US session. Best entries: opening range break (first 30min), VWAP reversion mid-day, power hour trend (last 60min).",
    "groups": [
      {
        "id": "technical",
        "name": "Session Structure Technicals",
        "description": "Session Structure Technicals",
        "weight": 0.4,
        "isRiskGate": false,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "ema-structure",
          "macd-crossover",
          "bollinger-band-squeeze",
          "volume-confirmation",
          "support-resistance-levels",
          "speed-momentum",
          "rsi-oversold"
        ]
      },
      {
        "id": "sentiment",
        "name": "Macro & Breadth",
        "description": "Macro & Breadth",
        "weight": 0.3,
        "isRiskGate": false,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "analyst-adjustments"
        ]
      },
      {
        "id": "risk",
        "name": "Position & Session Risk",
        "description": "Position & Session Risk",
        "weight": 0.3,
        "isRiskGate": true,
        "minMultiplier": 0.55,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "liquidity-check"
        ]
      }
    ]
  },
  "qqq-speed-v1": {
    "name": "QQQ Speed Scalp V1",
    "description": "Sub-minute TECH100/QQQ scalping protocol. Higher beta than SPY — wider risk gates, stronger momentum weighting. NVDA/AAPL/MSFT drive 30% of movement. Tech earnings season adds volatility premium.",
    "directionMode": "LONG_ONLY",
    "tradingStyle": "Tick Scalp",
    "recommendedTimeframe": "5s–30s",
    "avgHoldTime": "Seconds to a few minutes",
    "winRateTarget": "65–75%",
    "idealFor": "XTrend TECH100 speed trading during US session. Best during tech earnings season and AI news cycles when QQQ vol is elevated.",
    "groups": [
      {
        "id": "technical",
        "name": "Tech Momentum Micro-Structure",
        "description": "Tech Momentum Micro-Structure",
        "weight": 0.45,
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
          "session-open-effect"
        ]
      },
      {
        "id": "sentiment",
        "name": "Tech Sentiment",
        "description": "Tech Sentiment",
        "weight": 0.2,
        "isRiskGate": false,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "analyst-adjustments"
        ]
      },
      {
        "id": "risk",
        "name": "High Beta Risk",
        "description": "High Beta Risk",
        "weight": 0.35,
        "isRiskGate": true,
        "minMultiplier": 0.45,
        "maxMultiplier": 1.3,
        "directiveIds": [
          "liquidity-check"
        ]
      }
    ]
  },
  "qqq-day-v1": {
    "name": "QQQ Day Trade V1",
    "description": "TECH100/QQQ day trading protocol. Trend-following bias — QQQ trends harder and mean-reverts less than SPY. Higher beta = bigger moves. Tech earnings season provides volatility catalysts.",
    "directionMode": "LONG_ONLY",
    "tradingStyle": "Day Trade",
    "recommendedTimeframe": "5m–1h",
    "avgHoldTime": "Minutes to hours",
    "winRateTarget": "55–65%",
    "idealFor": "XTrend TECH100 day trading during US session. Follow the trend — QQQ trends last longer than SPY. Best during tech earnings (Jan/Apr/Jul/Oct) and AI news cycles.",
    "groups": [
      {
        "id": "technical",
        "name": "Tech Trend Technicals",
        "description": "Tech Trend Technicals",
        "weight": 0.45,
        "isRiskGate": false,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "ema-structure",
          "macd-crossover",
          "bollinger-band-squeeze",
          "volume-confirmation",
          "speed-momentum",
          "support-resistance-levels",
          "rsi-oversold"
        ]
      },
      {
        "id": "sentiment",
        "name": "Tech Fundamentals",
        "description": "Tech Fundamentals",
        "weight": 0.25,
        "isRiskGate": false,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "analyst-adjustments"
        ]
      },
      {
        "id": "risk",
        "name": "Tech Concentration Risk",
        "description": "Tech Concentration Risk",
        "weight": 0.3,
        "isRiskGate": true,
        "minMultiplier": 0.45,
        "maxMultiplier": 1.3,
        "directiveIds": [
          "liquidity-check"
        ]
      }
    ]
  },
  "dow-speed-v1": {
    "name": "Dow Speed Scalp V1",
    "description": "Sub-minute US30/DJI30 scalping protocol. Lower beta than SPY/QQQ — tighter risk gates, more emphasis on sector rotation and value/cyclical patterns. 30 industrial stocks, less tech-driven.",
    "directionMode": "LONG_ONLY",
    "tradingStyle": "Tick Scalp",
    "recommendedTimeframe": "5s–30s",
    "avgHoldTime": "Seconds to a few minutes",
    "winRateTarget": "65–75%",
    "idealFor": "XTrend US30/DJI30 speed trading during US session. Less volatile than SPY — tighter stops, smaller profit targets. Best during sector rotation days.",
    "groups": [
      {
        "id": "technical",
        "name": "Industrial Micro-Structure",
        "description": "Industrial Micro-Structure",
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
          "session-open-effect"
        ]
      },
      {
        "id": "sentiment",
        "name": "Cyclical Sentiment",
        "description": "Cyclical Sentiment",
        "weight": 0.25,
        "isRiskGate": false,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "analyst-adjustments"
        ]
      },
      {
        "id": "risk",
        "name": "Value Rotation Risk",
        "description": "Value Rotation Risk",
        "weight": 0.35,
        "isRiskGate": true,
        "minMultiplier": 0.55,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "liquidity-check"
        ]
      }
    ]
  },
  "ftse-speed-v1": {
    "name": "FTSE Speed Scalp V1",
    "description": "Sub-minute UK100/FTSE100 scalping protocol. Commodity-heavy index (BP, Shell, Rio Tinto, Glencore) — sensitive to commodity prices and GBP. London session only.",
    "directionMode": "LONG_ONLY",
    "tradingStyle": "Tick Scalp",
    "recommendedTimeframe": "5s–30s",
    "avgHoldTime": "Seconds to a few minutes",
    "winRateTarget": "65–75%",
    "idealFor": "XTrend UK100 speed trading during London session (08:00–16:30 GMT). Best during UK econ data releases and commodity price moves.",
    "groups": [
      {
        "id": "technical",
        "name": "FTSE Micro-Structure",
        "description": "FTSE Micro-Structure",
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
          "session-open-effect"
        ]
      },
      {
        "id": "sentiment",
        "name": "UK Macro",
        "description": "UK Macro",
        "weight": 0.25,
        "isRiskGate": false,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "analyst-adjustments"
        ]
      },
      {
        "id": "risk",
        "name": "Cross-Session Risk",
        "description": "Cross-Session Risk",
        "weight": 0.35,
        "isRiskGate": true,
        "minMultiplier": 0.5,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "liquidity-check"
        ]
      }
    ]
  },
  "dax-speed-v1": {
    "name": "DAX Speed Scalp V1",
    "description": "Sub-minute GER40/DAX scalping protocol (German large-caps — SAP, Siemens, Allianz). Frankfurt session; sensitive to EUR and EU macro data.",
    "directionMode": "LONG_ONLY",
    "tradingStyle": "Tick Scalp",
    "recommendedTimeframe": "5s–30s",
    "avgHoldTime": "Seconds to a few minutes",
    "winRateTarget": "65–75%",
    "idealFor": "XTrend GER40 speed trading during Frankfurt/London session. Mirrors ftse-speed-v1 directive structure.",
    "derivedFrom": "ftse-speed-v1",
    "groups": [
      {
        "id": "technical",
        "name": "DAX Micro-Structure",
        "description": "DAX Micro-Structure",
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
          "session-open-effect"
        ]
      },
      {
        "id": "sentiment",
        "name": "EU Macro",
        "description": "EU Macro",
        "weight": 0.25,
        "isRiskGate": false,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "analyst-adjustments"
        ]
      },
      {
        "id": "risk",
        "name": "Cross-Session Risk",
        "description": "Cross-Session Risk",
        "weight": 0.35,
        "isRiskGate": true,
        "minMultiplier": 0.5,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "liquidity-check"
        ]
      }
    ]
  },
  "cac-speed-v1": {
    "name": "CAC Speed Scalp V1",
    "description": "Sub-minute FRA40/CAC40 scalping protocol (French large-caps — LVMH, Total, Sanofi). Paris session 08:00–16:30 UK; sensitive to EUR and EU macro data.",
    "directionMode": "LONG_ONLY",
    "tradingStyle": "Tick Scalp",
    "recommendedTimeframe": "5s–30s",
    "avgHoldTime": "Seconds to a few minutes",
    "winRateTarget": "65–75%",
    "idealFor": "XTrend FRA40 speed trading during Paris/London session. Mirrors ftse-speed-v1 directive structure.",
    "derivedFrom": "ftse-speed-v1",
    "groups": [
      {
        "id": "technical",
        "name": "CAC Micro-Structure",
        "description": "CAC Micro-Structure",
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
          "session-open-effect"
        ]
      },
      {
        "id": "sentiment",
        "name": "EU Macro",
        "description": "EU Macro",
        "weight": 0.25,
        "isRiskGate": false,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "analyst-adjustments"
        ]
      },
      {
        "id": "risk",
        "name": "Cross-Session Risk",
        "description": "Cross-Session Risk",
        "weight": 0.35,
        "isRiskGate": true,
        "minMultiplier": 0.5,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "liquidity-check"
        ]
      }
    ]
  },
  "tsla-speed-v1": {
    "name": "TSLA Speed Scalp V1",
    "description": "Sub-minute Tesla (TSLA) single-stock scalping protocol. The most volatile mega-cap — Elon factor, delivery numbers, AI narrative. Much wider risk gates than index protocols.",
    "directionMode": "LONG_ONLY",
    "tradingStyle": "Tick Scalp",
    "recommendedTimeframe": "5s–30s",
    "avgHoldTime": "Seconds to a few minutes",
    "winRateTarget": "60–70%",
    "idealFor": "XTrend TSLA speed trading during US session. Expect wider spreads than indices. Do NOT hold through earnings. Elon tweets can move the stock 5% in minutes.",
    "groups": [
      {
        "id": "technical",
        "name": "Tesla Micro-Structure",
        "description": "Tesla Micro-Structure",
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
          "session-open-effect"
        ]
      },
      {
        "id": "sentiment",
        "name": "Elon Factor",
        "description": "Elon Factor",
        "weight": 0.25,
        "isRiskGate": false,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "social-buzz"
        ]
      },
      {
        "id": "risk",
        "name": "Single Stock Risk",
        "description": "Single Stock Risk",
        "weight": 0.35,
        "isRiskGate": true,
        "minMultiplier": 0.4,
        "maxMultiplier": 1.35,
        "directiveIds": [
          "liquidity-check"
        ]
      }
    ]
  },
  "doge-speed-v1": {
    "name": "DOGE Speed Scalp V1",
    "description": "Sub-minute Dogecoin (DOGE) scalping protocol. Pure momentum and social sentiment — no fundamentals, no earnings, just flow. The widest risk gates of any protocol.",
    "directionMode": "LONG_ONLY",
    "tradingStyle": "Tick Scalp",
    "recommendedTimeframe": "5s–30s",
    "avgHoldTime": "Seconds — get in, get out",
    "winRateTarget": "55–65%",
    "idealFor": "XTrend DOGE speed trading — absolute smallest position size ($1). Meme coins can drop 20% in minutes. Use tightest possible stops. Only trade during high social activity.",
    "groups": [
      {
        "id": "technical",
        "name": "Meme Coin Micro-Structure",
        "description": "Meme Coin Micro-Structure",
        "weight": 0.45,
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
          "session-open-effect"
        ]
      },
      {
        "id": "sentiment",
        "name": "Meme Sentiment",
        "description": "Meme Sentiment",
        "weight": 0.3,
        "isRiskGate": false,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "social-buzz",
          "crypto-fear-greed"
        ]
      },
      {
        "id": "risk",
        "name": "Meme Coin Risk",
        "description": "Meme Coin Risk",
        "weight": 0.25,
        "isRiskGate": true,
        "minMultiplier": 0.35,
        "maxMultiplier": 1.4,
        "directiveIds": [
          "liquidity-check"
        ]
      }
    ]
  },
  "china-speed-v1": {
    "name": "CHINA50 Speed Scalp V1",
    "description": "Sub-minute CHINA50/A50 scalping protocol. Policy-driven index — PBoC decisions, Politburo statements, regulatory announcements dominate. Government intervention risk is real.",
    "directionMode": "LONG_ONLY",
    "tradingStyle": "Tick Scalp",
    "recommendedTimeframe": "5s–30s",
    "avgHoldTime": "Seconds to a few minutes",
    "winRateTarget": "60–70%",
    "idealFor": "XTrend CHINA50 speed trading during Asian session (01:00–09:00 GMT). Government can halt trading or intervene at any time. Use extreme caution.",
    "groups": [
      {
        "id": "technical",
        "name": "China A50 Micro-Structure",
        "description": "China A50 Micro-Structure",
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
          "session-open-effect"
        ]
      },
      {
        "id": "sentiment",
        "name": "Policy Sentiment",
        "description": "Policy Sentiment",
        "weight": 0.25,
        "isRiskGate": false,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "analyst-adjustments"
        ]
      },
      {
        "id": "risk",
        "name": "Policy & Session Risk",
        "description": "Policy & Session Risk",
        "weight": 0.35,
        "isRiskGate": true,
        "minMultiplier": 0.35,
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
  "pandemic-v1": {
    "name": "Pandemic & Health Crisis V1",
    "description": "Group protocol for pandemic/health-crisis stocks. Highest sentiment weight (40%) of any protocol — these stocks move on headlines, not technicals. Biotech gapping risk requires widest risk gate (0.35–1.40). Covers vaccines, diagnostics, supply chain, bio-defense.",
    "directionMode": "LONG_ONLY",
    "tradingStyle": "Event-Driven / Swing",
    "recommendedTimeframe": "5m–1d",
    "avgHoldTime": "Hours to days (event-dependent)",
    "winRateTarget": "50–60%",
    "idealFor": "Pandemic watchlist stocks: PFE, MRNA, BNTX, MRK, HOLX, DHR, CVS, UNH, ECL, BAH, EBS, TDOC, CODX, SNGX. Best during outbreak news cycles, WHO declarations, BARDA contracts, and trial result announcements.",
    "groups": [
      {
        "id": "technical",
        "name": "Event-Driven Technicals",
        "description": "Event-Driven Technicals",
        "weight": 0.35,
        "isRiskGate": false,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "speed-momentum",
          "volume-confirmation",
          "bollinger-band-squeeze",
          "rsi-oversold",
          "support-resistance-levels",
          "volatility-tools"
        ]
      },
      {
        "id": "sentiment",
        "name": "News & Crisis Sentiment",
        "description": "News & Crisis Sentiment",
        "weight": 0.4,
        "isRiskGate": false,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "social-buzz",
          "analyst-adjustments"
        ]
      },
      {
        "id": "risk",
        "name": "Biotech Event Risk",
        "description": "Biotech Event Risk",
        "weight": 0.25,
        "isRiskGate": true,
        "minMultiplier": 0.35,
        "maxMultiplier": 1.4,
        "directiveIds": [
          "liquidity-check"
        ]
      }
    ]
  },
  "leverage-v2": {
    "name": "Leverage Shares V2",
    "description": "Bidirectional leverage protocol for 79 symbols: 55 long (3x) + 24 short (-3x). Covers indices, sectors, commodities, thematics, and single stocks. Correlation-drag detects macro tides vs sector rotation. 45% risk weight with budget gate prevents leverage over-allocation. Designed for a ~100 symbol universe.",
    "directionMode": "LONG_ONLY",
    "tradingStyle": "Day Trade / Scalp",
    "recommendedTimeframe": "1m–15m",
    "avgHoldTime": "Minutes to hours (NOT overnight)",
    "winRateTarget": "50–60%",
    "idealFor": "79 Leverage Shares across 5 categories. Never hold overnight — compounding decay erodes 3x value. Position size = 1/3 of normal due to amplification. SEES scans all 79 to find the single best leverage opportunity at any moment.",
    "groups": [
      {
        "id": "technical",
        "name": "Amplified Technicals",
        "description": "Amplified Technicals",
        "weight": 0.3,
        "isRiskGate": false,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "speed-momentum",
          "volume-confirmation",
          "bollinger-band-squeeze",
          "rsi-oversold",
          "support-resistance-levels",
          "volatility-tools",
          "ema-structure",
          "session-open-effect"
        ]
      },
      {
        "id": "sentiment",
        "name": "Market Direction & Rotation",
        "description": "Market Direction & Rotation",
        "weight": 0.25,
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
        "name": "3x Amplified Risk (79-symbol universe)",
        "description": "3x Amplified Risk (79-symbol universe)",
        "weight": 0.45,
        "isRiskGate": true,
        "minMultiplier": 0.25,
        "maxMultiplier": 1.4,
        "directiveIds": [
          "liquidity-check",
          "budget-gate"
        ]
      }
    ]
  },
  "vix-spike-v1": {
    "name": "VIX Spike Mean Reversion V1",
    "description": "VIX speed/scalp protocol — exploits VIX spike-to-mean-reversion patterns. Buy after spikes, sell when complacency returns.",
    "directionMode": "LONG_ONLY",
    "tradingStyle": "Mean Reversion / Scalp",
    "recommendedTimeframe": "1m–5m",
    "avgHoldTime": "Minutes to 1 hour",
    "winRateTarget": "65–75%",
    "idealFor": "VIX spike reversals. Best during US market hours when VIX options are most liquid. Not for trend-following — pure mean reversion.",
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
          "bollinger-band-squeeze",
          "volume-confirmation",
          "volatility-tools",
          "support-resistance-levels",
          "mean-reversion"
        ]
      },
      {
        "id": "sentiment",
        "name": "Sentiment",
        "description": "Sentiment",
        "weight": 0.35,
        "isRiskGate": false,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": []
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
          "liquidity-check",
          "sp500-regime"
        ]
      }
    ]
  },
  "vix-short-v1": {
    "name": "VIX Spike Short V1",
    "description": "Short-volatility mean-reversion protocol — fades VIX spikes from the short side (overbought vol, elevated ATR). Natural pair to vix-spike-v1: the long side buys spike reversals, this side sells extended vol premium.",
    "directionMode": "SHORT_ONLY",
    "tradingStyle": "Mean Reversion / Scalp",
    "recommendedTimeframe": "1m–5m",
    "avgHoldTime": "Minutes to 1 hour",
    "winRateTarget": "55–65%",
    "idealFor": "Shorting VIX/vol exposure after spike crests. Higher win-rate targets than trend shorts — short-vol has positive carry but fat left tails. Risk gate (SP500 regime) is mandatory.",
    "derivedFrom": "vix-spike-v1",
    "groups": [
      {
        "id": "short-technical",
        "name": "Bearish Technical Analysis",
        "description": "Overbought volatility — fade signals",
        "weight": 0.4,
        "isRiskGate": false,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "rsi-overbought",
          "cci",
          "macd-crossover",
          "bollinger-band-squeeze",
          "mean-reversion"
        ]
      },
      {
        "id": "short-sentiment",
        "name": "Volatility Structure",
        "description": "Volatility structure and confirmation",
        "weight": 0.35,
        "isRiskGate": false,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "volatility-tools",
          "volume-confirmation",
          "support-resistance-levels"
        ]
      },
      {
        "id": "short-risk",
        "name": "Short-Side Risk",
        "description": "Short-Side Risk",
        "weight": 0.25,
        "isRiskGate": true,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "liquidity-check",
          "sp500-regime"
        ]
      }
    ]
  },
  "gold-macro-v1": {
    "name": "Gold Macro Correlation V1",
    "description": "Gold scoring protocol — trend-following with macro correlation (DXY, real rates, inflation). Longer hold periods than speed protocols.",
    "directionMode": "LONG_ONLY",
    "tradingStyle": "Trend Following / Position",
    "recommendedTimeframe": "1d–1w",
    "avgHoldTime": "Days to weeks",
    "winRateTarget": "55–65%",
    "idealFor": "Gold EFTs, XAUUSD CFD positions, macro-driven gold exposure. Best when DXY is weak and real rates are falling.",
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
          "ema-structure",
          "macd-crossover",
          "support-resistance-levels",
          "bollinger-band-squeeze",
          "volume-confirmation",
          "rsi-oversold"
        ]
      },
      {
        "id": "sentiment",
        "name": "Sentiment & Macro",
        "description": "Sentiment & Macro",
        "weight": 0.35,
        "isRiskGate": false,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "gold-macro-correlation",
          "analyst-adjustments"
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
  "nikkei-speed-v1": {
    "name": "Nikkei Speed Scalp V1",
    "description": "Sub-minute JPN225/Nikkei225 scalping protocol. Yen-sensitive index (exporters, tech, auto). Tokyo session only (00:00–06:00 UTC). BOJ policy and USDJPY moves are primary drivers.",
    "directionMode": "LONG_ONLY",
    "tradingStyle": "Tick Scalp",
    "recommendedTimeframe": "5s–30s",
    "avgHoldTime": "Seconds to a few minutes",
    "winRateTarget": "60–70%",
    "idealFor": "XTrend JPN225 speed trading during Tokyo session. Best during BOJ announcements, Japan econ data, and USDJPY volatility.",
    "groups": [
      {
        "id": "technical",
        "name": "Nikkei Micro-Structure",
        "description": "Nikkei Micro-Structure",
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
          "session-open-effect"
        ]
      },
      {
        "id": "sentiment",
        "name": "Japan Macro",
        "description": "Japan Macro",
        "weight": 0.25,
        "isRiskGate": false,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "analyst-adjustments"
        ]
      },
      {
        "id": "risk",
        "name": "Asian Session Risk",
        "description": "Asian Session Risk",
        "weight": 0.35,
        "isRiskGate": true,
        "minMultiplier": 0.4,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "liquidity-check",
          "rollover-risk"
        ]
      }
    ]
  },
  "euro-stoxx-v1": {
    "name": "Euro Stoxx Speed Scalp V1",
    "description": "Sub-minute EUSTX50/EuroStoxx50 scalping protocol. Eurozone blue-chip index (SAP, LVMH, ASML, Siemens, TotalEnergies). Frankfurt/Paris session (07:00–16:30 UTC). ECB policy and EUR moves are primary drivers.",
    "directionMode": "LONG_ONLY",
    "tradingStyle": "Tick Scalp",
    "recommendedTimeframe": "5s–30s",
    "avgHoldTime": "Seconds to a few minutes",
    "winRateTarget": "60–70%",
    "idealFor": "XTrend EUSTX50 speed trading during European session. Best during ECB announcements, EU econ data, and EUR volatility.",
    "groups": [
      {
        "id": "technical",
        "name": "Euro Stoxx Micro-Structure",
        "description": "Euro Stoxx Micro-Structure",
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
          "session-open-effect"
        ]
      },
      {
        "id": "sentiment",
        "name": "Eurozone Macro",
        "description": "Eurozone Macro",
        "weight": 0.25,
        "isRiskGate": false,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "analyst-adjustments"
        ]
      },
      {
        "id": "risk",
        "name": "European Session Risk",
        "description": "European Session Risk",
        "weight": 0.35,
        "isRiskGate": true,
        "minMultiplier": 0.45,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "liquidity-check",
          "rollover-risk"
        ]
      }
    ]
  },
  "oil-supply-v1": {
    "name": "Oil Supply/Demand V1",
    "description": "Oil scoring protocol — trend-following with supply/demand fundamentals. Sensitive to OPEC, EIA inventories, and geopolitical events.",
    "directionMode": "LONG_ONLY",
    "tradingStyle": "Trend Following / Event-Driven",
    "recommendedTimeframe": "1d–4h",
    "avgHoldTime": "Hours to days",
    "winRateTarget": "55–65%",
    "idealFor": "Oil CFD/ETF trades around OPEC meetings, EIA reports, and geopolitical supply events.",
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
          "ema-structure",
          "support-resistance-levels",
          "bollinger-band-squeeze",
          "volume-confirmation",
          "volatility-tools",
          "speed-momentum"
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
          "cad-usd-oil-correlation",
          "analyst-adjustments"
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
  "dxy-sensitivity-v1": {
    "name": "DXY Sensitivity V1",
    "description": "USD-driven protocol for gold, silver, forex majors, and crypto. DXY regime gates all positions — USD strength/weakness is the primary driver. Designed for XTrend speed trading during London/NY overlap.",
    "directionMode": "LONG_ONLY",
    "tradingStyle": "Tick Scalp",
    "recommendedTimeframe": "5s–30s",
    "avgHoldTime": "Seconds to a few minutes",
    "winRateTarget": "60–70%",
    "idealFor": "XTrend speed trading on DXY-sensitive symbols: XAUUSD, XAGUSD, EURUSD, GBPUSD, AUDUSD, NZDUSD, USDCAD, USDJPY, USDCHF, BTCUSD. Best during London/NY overlap (12:00–16:00 GMT) and US economic data releases.",
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
          "rsi-oversold",
          "support-resistance-levels",
          "session-open-effect",
          "volatility-tools"
        ]
      },
      {
        "id": "sentiment",
        "name": "USD Sentiment",
        "description": "USD Sentiment",
        "weight": 0.2,
        "isRiskGate": false,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "spy-qqq-relative-strength"
        ]
      },
      {
        "id": "risk",
        "name": "DXY-Driven Risk",
        "description": "DXY-Driven Risk",
        "weight": 0.4,
        "isRiskGate": true,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.25,
        "directiveIds": [
          "dxy-regime",
          "liquidity-check"
        ]
      }
    ]
  },
  "divergence-suite-v1": {
    "name": "Divergence Suite V1",
    "description": "Multi-indicator divergence detection suite. Combines RSI, MACD, and OBV divergence with volume confirmation. OBV (smart money) divergence given highest weight. Best used as a reversal/mean-reversion signal in ranging markets.",
    "directionMode": "LONG_ONLY",
    "tradingStyle": "Swing / Position",
    "recommendedTimeframe": "1h–1d",
    "avgHoldTime": "Hours to days",
    "winRateTarget": "60–70%",
    "idealFor": "Reversal detection on liquid equities and indices. Works best in ranging/mean-reverting markets — disable during strong trends.",
    "groups": [
      {
        "id": "technical",
        "name": "Divergence Detection",
        "description": "Divergence Detection",
        "weight": 0.45,
        "isRiskGate": false,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "rsi-divergence",
          "macd-divergence",
          "obv-divergence"
        ]
      },
      {
        "id": "sentiment",
        "name": "Trend Confirmation",
        "description": "Trend Confirmation",
        "weight": 0.25,
        "isRiskGate": false,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "volume-confirmation",
          "speed-momentum"
        ]
      },
      {
        "id": "risk",
        "name": "Divergence Risk Gates",
        "description": "Divergence Risk Gates",
        "weight": 0.3,
        "isRiskGate": true,
        "minMultiplier": 0.4,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "market-regime",
          "liquidity-check"
        ]
      }
    ]
  },
  "mtf-conservative-v1": {
    "name": "MTF Confluence Conservative V1",
    "description": "Requires ALL 3 timeframes (daily, hourly, 15-min) to align bullish for entry. ~3-5 high-confidence signals per month on SPY. Very high accuracy — designed for position entries, not scalping.",
    "directionMode": "LONG_ONLY",
    "tradingStyle": "Swing / Position",
    "recommendedTimeframe": "1d (signal), 1h/15m ",
    "avgHoldTime": "Days to weeks",
    "winRateTarget": "65–75%",
    "idealFor": "SPY, QQQ, AAPL, MSFT — liquid index ETFs and mega-caps. Use for core position entries.",
    "groups": [
      {
        "id": "technical",
        "name": "MTF Alignment (Conservative)",
        "description": "MTF Alignment (Conservative)",
        "weight": 0.5,
        "isRiskGate": false,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "mtf-confluence-conservative",
          "ema-structure",
          "volume-confirmation"
        ]
      },
      {
        "id": "sentiment",
        "name": "Trend Context",
        "description": "Trend Context",
        "weight": 0.2,
        "isRiskGate": false,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "analyst-adjustments"
        ]
      },
      {
        "id": "risk",
        "name": "Conservative Risk",
        "description": "Conservative Risk",
        "weight": 0.3,
        "isRiskGate": true,
        "minMultiplier": 0.5,
        "maxMultiplier": 1.15,
        "directiveIds": [
          "liquidity-check"
        ]
      }
    ]
  },
  "mtf-weighted-v1": {
    "name": "MTF Confluence Weighted V1",
    "description": "Uses 50/35/15 macro/meso/micro weighting for ~15-20 signals per month on SPY. More trading opportunities than conservative variant, balanced per-signal accuracy. Composite > 0.3 = bullish entry.",
    "directionMode": "LONG_ONLY",
    "tradingStyle": "Swing / Day Trade",
    "recommendedTimeframe": "1h–1d",
    "avgHoldTime": "Hours to days",
    "winRateTarget": "55–65%",
    "idealFor": "Active traders wanting more frequent signals. SPY, QQQ, liquid stocks. Pair with trailing stops for best results.",
    "groups": [
      {
        "id": "technical",
        "name": "MTF Composite (Weighted)",
        "description": "MTF Composite (Weighted)",
        "weight": 0.45,
        "isRiskGate": false,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "mtf-confluence-weighted",
          "macd-crossover",
          "rsi-oversold"
        ]
      },
      {
        "id": "sentiment",
        "name": "Market Bias",
        "description": "Market Bias",
        "weight": 0.25,
        "isRiskGate": false,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": []
      },
      {
        "id": "risk",
        "name": "Balanced Risk",
        "description": "Balanced Risk",
        "weight": 0.3,
        "isRiskGate": true,
        "minMultiplier": 0.45,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "liquidity-check",
          "budget-gate"
        ]
      }
    ]
  },
  "vwap-simple-v1": {
    "name": "VWAP Simple AND-Gate V1",
    "description": "Prop-firm staple mean-reversion strategy. Price must be at VWAP (within 0.5%), RSI must be neutral (40-65), and volume must be elevated. Simple 3-condition AND-gate — all must confirm. High win rate on liquid equities.",
    "directionMode": "LONG_ONLY",
    "tradingStyle": "Day Trade / Scalp",
    "recommendedTimeframe": "5m–15m",
    "avgHoldTime": "Minutes to hours",
    "winRateTarget": "60–70%",
    "idealFor": "Intraday mean-reversion on SPY, QQQ, AAPL, MSFT. Best during active sessions (9:30-11:30, 14:00-16:00 ET).",
    "groups": [
      {
        "id": "technical",
        "name": "VWAP AND-Gate",
        "description": "VWAP AND-Gate",
        "weight": 0.45,
        "isRiskGate": false,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "vwap-confluence-simple",
          "vwap",
          "volume-confirmation"
        ]
      },
      {
        "id": "sentiment",
        "name": "Session Context",
        "description": "Session Context",
        "weight": 0.2,
        "isRiskGate": false,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "session-open-effect"
        ]
      },
      {
        "id": "risk",
        "name": "Mean-Reversion Risk",
        "description": "Mean-Reversion Risk",
        "weight": 0.35,
        "isRiskGate": true,
        "minMultiplier": 0.4,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "market-regime",
          "liquidity-check"
        ]
      }
    ]
  },
  "vwap-bands-v1": {
    "name": "VWAP Full Bands V1",
    "description": "Uses VWAP standard deviation (±1σ, ±2σ) bands for precision mean-reversion entries. -2σ zone = deep institutional discount (strong buy). +2σ zone = overextended (bearish). More nuanced than simple AND-gate — accounts for how far price has deviated from VWAP.",
    "directionMode": "LONG_ONLY",
    "tradingStyle": "Swing / Day Trade",
    "recommendedTimeframe": "15m–1h",
    "avgHoldTime": "Hours to 1-2 days",
    "winRateTarget": "55–65%",
    "idealFor": "Patience entries at extreme VWAP deviations. Works on all liquid symbols. Best entries at -2σ during uptrends.",
    "groups": [
      {
        "id": "technical",
        "name": "VWAP Standard Deviation Bands",
        "description": "VWAP Standard Deviation Bands",
        "weight": 0.45,
        "isRiskGate": false,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "vwap-confluence-bands",
          "rsi-oversold",
          "volume-surge"
        ]
      },
      {
        "id": "sentiment",
        "name": "Market Structure",
        "description": "Market Structure",
        "weight": 0.2,
        "isRiskGate": false,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "market-regime"
        ]
      },
      {
        "id": "risk",
        "name": "Band Risk Gates",
        "description": "Band Risk Gates",
        "weight": 0.35,
        "isRiskGate": true,
        "minMultiplier": 0.35,
        "maxMultiplier": 1.25,
        "directiveIds": [
          "liquidity-check",
          "rollover-risk"
        ]
      }
    ]
  },
  "gap-scanner-v1": {
    "name": "Gap Scanner V1",
    "description": "Detects overnight/opening price gaps and scores them by fill probability. Small gaps (0.5-2%) have high fill probability — fade them. Large gaps (2-5%) may gap-and-go — follow momentum. Extreme gaps (5%+) are news-driven and unpredictable. Best used within first 15-60 min of market open.",
    "directionMode": "LONG_ONLY",
    "tradingStyle": "Day Trade",
    "recommendedTimeframe": "1m–5m",
    "avgHoldTime": "Minutes to hours",
    "winRateTarget": "55–65%",
    "idealFor": "Opening-range trading on SPY, QQQ, and liquid stocks. Use only during first hour of US market session.",
    "groups": [
      {
        "id": "technical",
        "name": "Gap Detection",
        "description": "Gap Detection",
        "weight": 0.4,
        "isRiskGate": false,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "gap-scanner",
          "volume-confirmation",
          "session-open-effect"
        ]
      },
      {
        "id": "sentiment",
        "name": "Gap Context",
        "description": "Gap Context",
        "weight": 0.25,
        "isRiskGate": false,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": []
      },
      {
        "id": "risk",
        "name": "Gap Risk Gates",
        "description": "Gap Risk Gates",
        "weight": 0.35,
        "isRiskGate": true,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.15,
        "directiveIds": [
          "liquidity-check",
          "budget-gate"
        ]
      }
    ]
  },
  "earnings-momentum-v1": {
    "name": "Earnings Momentum Auto-Play V1",
    "description": "Captures pre-earnings drift by entering on strong earnings momentum 5-14 days before the report date. Auto-exits 1-2 days before earnings to avoid the binary event. Based on the well-documented pre-earnings announcement drift anomaly. Uses DB-backed earnings-momentum directive (surprise magnitude, QoQ growth, recency).",
    "directionMode": "LONG_ONLY",
    "tradingStyle": "Swing / Event-Driven",
    "recommendedTimeframe": "1d (signal), 1h (ent",
    "avgHoldTime": "3-10 days",
    "winRateTarget": "55–65%",
    "idealFor": "Liquid stocks with consistent earnings beats. Best entered 5-14 days before earnings, exited 1-2 days before. NOT for holding through earnings — this captures the run-up, not the binary gamble.",
    "groups": [
      {
        "id": "technical",
        "name": "Earnings Quality",
        "description": "Earnings Quality",
        "weight": 0.45,
        "isRiskGate": false,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "earnings-momentum",
          "rsi-oversold",
          "volume-confirmation"
        ]
      },
      {
        "id": "sentiment",
        "name": "Analyst & News Context",
        "description": "Analyst & News Context",
        "weight": 0.25,
        "isRiskGate": false,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "analyst-adjustments"
        ]
      },
      {
        "id": "risk",
        "name": "Pre-Earnings Risk Gates",
        "description": "Pre-Earnings Risk Gates",
        "weight": 0.3,
        "isRiskGate": true,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.1,
        "directiveIds": [
          "liquidity-check",
          "budget-gate"
        ]
      }
    ]
  },
  "mt5-technical-core-v1": {
    "name": "MT5 Technical Core V1",
    "description": "Production-ready protocol for MetaQuotes-Demo validation. Uses ONLY MT5-sourced directives — no Finnhub/Alpha Vantage dependency. All technical signals from candle data via MT5 bridge. DXY regime uses EURUSD proxy. Focus on liquid forex + gold with tight risk gates for small account protection ($1,000 balance).",
    "directionMode": "LONG_ONLY",
    "tradingStyle": "Swing / Intraday",
    "recommendedTimeframe": "15m",
    "avgHoldTime": "1–4 hours",
    "winRateTarget": "55–65%",
    "idealFor": "Demo validation on the MetaQuotes demo account. EURUSD, GBPUSD, XAUUSD. 0.01 lot entries. Tight stops at 1.5× ATR. Risk gates protect the $1K balance from over-trading and session risk.",
    "groups": [
      {
        "id": "technical",
        "name": "Price Action & Momentum",
        "description": "Price Action & Momentum",
        "weight": 0.4,
        "isRiskGate": false,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "speed-momentum",
          "rsi-oversold",
          "macd-crossover",
          "atr-dip",
          "volume-confirmation",
          "volume-rhythm",
          "bollinger-band-squeeze",
          "vwap",
          "doji-pattern",
          "hammer-pattern",
          "engulfing-pattern",
          "mt5-engulfing",
          "mt5-harami",
          "support-resistance-levels",
          "confluence-reversal-combo",
          "momentum-continuation-combo",
          "momentum-exhaustion"
        ]
      },
      {
        "id": "sentiment",
        "name": "Macro Context (MT5-Sourced)",
        "description": "Macro Context (MT5-Sourced)",
        "weight": 0.25,
        "isRiskGate": false,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "dxy-regime",
          "gold-macro-correlation",
          "cad-usd-oil-correlation"
        ]
      },
      {
        "id": "risk",
        "name": "Position & Execution Risk",
        "description": "Position & Execution Risk",
        "weight": 0.35,
        "isRiskGate": true,
        "minMultiplier": 0.4,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "budget-gate",
          "liquidity-check",
          "rollover-risk",
          "position-size-confidence",
          "target-achieved",
          "time-stop",
          "market-regime"
        ]
      }
    ]
  },
  "mt5-technical-short": {
    "name": "MT5 Technical Core (SHORT)",
    "description": "Short-side variant of MT5 Technical Core. Uses bearish directives — overbought, breakdown, distribution. Pair with mt5-technical-core-v1 for dual BUY/SELL on EURUSD, GBPUSD, XAUUSD.",
    "directionMode": "SHORT_ONLY",
    "tradingStyle": "Swing / Intraday",
    "recommendedTimeframe": "15m",
    "avgHoldTime": "1–4 hours",
    "winRateTarget": "50–60%",
    "idealFor": "Short-side opportunities on liquid forex + gold. Pairs with MT5 Technical Core V1 for dual scoring.",
    "groups": [
      {
        "id": "bearish-technical",
        "name": "Bearish Technical Analysis",
        "description": "Bearish Technical Analysis",
        "weight": 0.4,
        "isRiskGate": false,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "rsi-overbought",
          "stochastic",
          "williams-r",
          "cci",
          "mfi",
          "engulfing-pattern",
          "pin-bar-pattern",
          "doji-pattern",
          "resistance-levels-strategy",
          "obv-divergence",
          "macd-crossover",
          "speed-momentum"
        ]
      },
      {
        "id": "bearish-sentiment",
        "name": "Bearish Sentiment & Fundamentals",
        "description": "Bearish Sentiment & Fundamentals",
        "weight": 0.35,
        "isRiskGate": false,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "analyst-adjustments",
          "social-buzz",
          "spy-qqq-relative-strength"
        ]
      },
      {
        "id": "short-risk",
        "name": "Short-Side Risk & Structural",
        "description": "Short-Side Risk & Structural",
        "weight": 0.25,
        "isRiskGate": true,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "dilution-impact",
          "vix-strategy",
          "liquidity-check",
          "budget-gate",
          "rollover-risk",
          "dxy-regime"
        ]
      }
    ]
  },
  "eurusd-macro-v1": {
    "name": "EURUSD Macro-Pair V1",
    "description": "Rate-differential and macro-data-driven protocol for EURUSD.",
    "directionMode": "LONG_ONLY",
    "tradingStyle": "swing",
    "recommendedTimeframe": null,
    "avgHoldTime": null,
    "winRateTarget": null,
    "idealFor": null,
    "groups": [
      {
        "id": "macro",
        "name": "Macro Fundamentals",
        "description": "Macro Fundamentals",
        "weight": 10,
        "isRiskGate": false,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "dxy-regime",
          "gold-macro-correlation",
          "market-regime"
        ]
      },
      {
        "id": "technical",
        "name": "Technical Entry",
        "description": "Technical Entry",
        "weight": 8,
        "isRiskGate": false,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "support-resistance-levels",
          "moving-averages",
          "macd",
          "adx"
        ]
      },
      {
        "id": "sentiment",
        "name": "Sentiment",
        "description": "Sentiment",
        "weight": 6,
        "isRiskGate": false,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "conviction-growth"
        ]
      },
      {
        "id": "risk",
        "name": "Risk Gate",
        "description": "Risk Gate",
        "weight": 5,
        "isRiskGate": true,
        "minMultiplier": 0.3,
        "maxMultiplier": 1,
        "directiveIds": [
          "position-size-kelly"
        ]
      }
    ]
  },
  "usdjpy-risk-v1": {
    "name": "USDJPY Risk-Pair V1",
    "description": "Risk-sentiment yen protocol",
    "directionMode": "LONG_ONLY",
    "tradingStyle": "swing",
    "recommendedTimeframe": null,
    "avgHoldTime": null,
    "winRateTarget": null,
    "idealFor": null,
    "groups": [
      {
        "id": "risk-sentiment",
        "name": "Risk Sentiment",
        "description": "Risk Sentiment",
        "weight": 10,
        "isRiskGate": false,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "market-regime"
        ]
      },
      {
        "id": "technical",
        "name": "Technical",
        "description": "Technical",
        "weight": 8,
        "isRiskGate": false,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "adx",
          "bollinger-bands",
          "moving-averages"
        ]
      },
      {
        "id": "risk",
        "name": "Risk Gate",
        "description": "Risk Gate",
        "weight": 5,
        "isRiskGate": true,
        "minMultiplier": 0.3,
        "maxMultiplier": 1,
        "directiveIds": [
          "position-size-kelly"
        ]
      }
    ]
  },
  "gbpusd-news-v1": {
    "name": "GBPUSD News-Pair V1",
    "description": "News-surprise cable protocol",
    "directionMode": "LONG_ONLY",
    "tradingStyle": "day-trade",
    "recommendedTimeframe": null,
    "avgHoldTime": null,
    "winRateTarget": null,
    "idealFor": null,
    "groups": [
      {
        "id": "news",
        "name": "News",
        "description": "News",
        "weight": 10,
        "isRiskGate": false,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "conviction-growth"
        ]
      },
      {
        "id": "technical",
        "name": "Technical",
        "description": "Technical",
        "weight": 8,
        "isRiskGate": false,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "adx",
          "macd",
          "atr-dip",
          "price-action"
        ]
      },
      {
        "id": "risk",
        "name": "Risk Gate",
        "description": "Risk Gate",
        "weight": 5,
        "isRiskGate": true,
        "minMultiplier": 0.3,
        "maxMultiplier": 1,
        "directiveIds": [
          "position-size-kelly"
        ]
      }
    ]
  },
  "usdcad-oil-v1": {
    "name": "USDCAD Oil-Pair V1",
    "description": "Oil-correlation protocol for USDCAD — replaces the older CAD-focused protocol.",
    "directionMode": "LONG_ONLY",
    "tradingStyle": "day-trade",
    "recommendedTimeframe": null,
    "avgHoldTime": null,
    "winRateTarget": null,
    "idealFor": null,
    "groups": [
      {
        "id": "oil-macro",
        "name": "Oil Macro",
        "description": "Oil Macro",
        "weight": 10,
        "isRiskGate": false,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "cad-usd-oil-correlation",
          "market-regime"
        ]
      },
      {
        "id": "technical",
        "name": "Technical",
        "description": "Technical",
        "weight": 8,
        "isRiskGate": false,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "adx",
          "bollinger-band-squeeze",
          "moving-averages"
        ]
      },
      {
        "id": "risk",
        "name": "Risk Gate",
        "description": "Risk Gate",
        "weight": 5,
        "isRiskGate": true,
        "minMultiplier": 0.3,
        "maxMultiplier": 1,
        "directiveIds": [
          "position-size-kelly"
        ]
      }
    ]
  },
  "commodity-pairs-v1": {
    "name": "Commodity-Pairs Macro V1",
    "description": "Commodity currency strength",
    "directionMode": "LONG_ONLY",
    "tradingStyle": "swing",
    "recommendedTimeframe": null,
    "avgHoldTime": null,
    "winRateTarget": null,
    "idealFor": null,
    "groups": [
      {
        "id": "commodity",
        "name": "Commodity",
        "description": "Commodity",
        "weight": 10,
        "isRiskGate": false,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "market-regime",
          "cad-usd-oil-correlation",
          "gold-macro-correlation"
        ]
      },
      {
        "id": "technical",
        "name": "Technical",
        "description": "Technical",
        "weight": 8,
        "isRiskGate": false,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "adx",
          "macd",
          "moving-averages"
        ]
      },
      {
        "id": "risk",
        "name": "Risk Gate",
        "description": "Risk Gate",
        "weight": 5,
        "isRiskGate": true,
        "minMultiplier": 0.3,
        "maxMultiplier": 1,
        "directiveIds": [
          "position-size-kelly"
        ]
      }
    ]
  },
  "060ed261-4a8c-46a4-aa9c-9de0ba7ddb8d": {
    "name": "Conviction Dip Accumulation",
    "description": "Soft long-only, share-buying. Accumulate on quality dips; hold through normal drawdown.",
    "directionMode": "LONG_ONLY",
    "tradingStyle": null,
    "recommendedTimeframe": null,
    "avgHoldTime": null,
    "winRateTarget": null,
    "idealFor": null,
    "groups": []
  },
  "signals-workbench": {
    "name": "Signals Workbench",
    "description": "Auto-created for Signals Workbench score persistence",
    "directionMode": "LONG_ONLY",
    "tradingStyle": null,
    "recommendedTimeframe": null,
    "avgHoldTime": null,
    "winRateTarget": null,
    "idealFor": null,
    "groups": []
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // hourly-3dir-v1 — the #761 CONTROL PROTOCOL
  //
  // PURPOSE: settle whether the ~24% ceiling on scoring percentages is a
  // DENOMINATOR problem or a SCORING problem. Every existing protocol mixes
  // directional and non-directional directives in one capacity sum, which makes
  // both explanations consistent with the observed numbers. This protocol removes
  // the ambiguity by construction.
  //
  // DESIGN RULES (each deliberately different from the existing protocols):
  //
  // 1. THREE directives only. Every existing protocol carries 8-12, and the
  //    measured 24h utilisation showed several of them contributing near-zero
  //    (speed-momentum 10.6%, support-resistance-levels 4.9%, session-open-effect
  //    0.9%) while still occupying the denominator with their full maxScore.
  //    Three directives means the denominator is ~300 rather than ~700-900.
  //
  // 2. ALL THREE MUST BE ABLE TO EMIT A DIRECTION. This is the control condition.
  //    Measured 24h bullish-rate on the excluded candidates:
  //      bollinger-band-squeeze 0.0% (63.4% util), volume-confirmation 0.0% (24.4%),
  //      gold-session-profile 0.0% (50.0%), spy-qqq-relative-strength 0.0% (46.7%),
  //      volatility-tools 0.0% (37.9%)
  //    Those directives have NEVER produced a directional reading, so including
  //    them guarantees the numerator can never reach the denominator. The chosen
  //    three all measured directionally active:
  //      ema-structure   45.8% bullish rate (45.6% utilisation)
  //      rsi-oversold    14.7% bullish rate (28.9% utilisation) — 140 maxScore
  //      macd-crossover  18.6% bullish rate (31.9% utilisation)
  //
  // 3. NO risk gate. `liquidity-check` is correctly excluded from capacity by
  //    isRiskGate, but including one here would add a second variable.
  //
  // 4. ONE start-with-an-index confirmation, no session/calendar directive. A
  //    session directive only fires at an open, so for most of the day it is pure
  //    denominator — the exact artefact this protocol exists to eliminate.
  //
  // EXPECTED OUTCOME — this is the falsifiable prediction:
  //   If the low percentages are a DENOMINATOR artefact, this protocol should
  //   print a materially higher peak percentage than the ~23% seen elsewhere,
  //   because its denominator carries no idle capacity.
  //   If it still prints ~25%, then neither denominator composition nor directive
  //   failure explains it, and the loss is inside composite assembly itself
  //   (candidates: the risk multiplier, or selectDirectionalEvidence picking the
  //   minority side). That would mean #761 was treating a symptom.
  //
  // Run for one full session on a symbol with dense hourly bars (crypto has the
  // most complete 1h history: BTC/ETH/SOL/DOGE at 145 bars/7d vs 104 for forex),
  // then examine. See issue #761.
  // ─────────────────────────────────────────────────────────────────────────────
  "hourly-3dir-v1": {
    "name": "Hourly Triple-Directive Control V1",
    "description": "Experiment protocol for issue #761. Three directional-only directives on hourly bars, sized so the capacity denominator carries no idle weight. Exists to distinguish a denominator artefact from a scoring fault in the ~24% scoring ceiling. Not intended for live capital — it is a measurement instrument.",
    "directionMode": "LONG_ONLY",
    "tradingStyle": "Day Trade / Momentum",
    "recommendedTimeframe": "1h",
    "avgHoldTime": "2–12 hours",
    "winRateTarget": "50–60%",
    "idealFor": "Measuring whether scoring percentages are suppressed by denominator composition. Designed for symbols whose favourable conditions recur on an hourly cadence, where a 3-directive set can realistically align.",
    "groups": [
      {
        "id": "technical",
        "name": "Directional Core",
        "description": "The three directional directives. All three can emit bullish/bearish, so the numerator has a real chance of reaching the denominator.",
        "weight": 1.0,
        "isRiskGate": false,
        "minMultiplier": 1.0,
        "maxMultiplier": 1.0,
        "directiveIds": [
          "ema-structure",
          "rsi-oversold",
          "macd-crossover"
        ]
      }
    ]
  },
  "xau-speed-v1-copy": {
    "name": "Gold Speed Scalp V1 (copy)",
    "description": "Sub-minute gold (XAUUSD) scalping protocol. Gold is the ultimate fear gauge — volatile during CPI, FOMC, NFP, geopolitics. Tight spreads, massive liquidity. Reacts to USD strength and real rates.",
    "directionMode": "LONG_ONLY",
    "tradingStyle": "Tick Scalp",
    "recommendedTimeframe": "5s–30s",
    "derivedFrom": "xau-speed-v1",
    "avgHoldTime": "Seconds to a few minutes",
    "winRateTarget": "65–75%",
    "idealFor": "XTrend gold speed trading during London/NY overlap (12:00–16:00 GMT). Avoid first 5min after major news — spreads widen dramatically.",
    "groups": [
      {
        "id": "technical",
        "name": "Micro-Structure Technicals",
        "description": "Gold micro-moves: momentum, squeezes, volume spikes for sub-minute entries",
        "weight": 0.4,
        "isRiskGate": false,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "bollinger-band-squeeze",
          "gold-round-numbers",
          "rsi-oversold",
          "session-open-effect",
          "speed-momentum",
          "stoch-rsi",
          "support-resistance-levels",
          "volatility-tools",
          "volume-confirmation"
        ]
      },
      {
        "id": "sentiment",
        "name": "Sentiment & Macro Context",
        "description": "Gold IS sentiment — DXY, real rates, fear gauge",
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
        "description": "Gold-specific: spread widening during news, weekend gaps, over-allocation",
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
};
