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
  directiveMaxScores: Record<string, number>;
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
  "default": {
    "name": "SEES Default",
    "description": "General-purpose equity scoring protocol covering technical, sentiment, and risk directives.",
    "directionMode": "LONG_ONLY",
    "tradingStyle": "Swing / Position",
    "recommendedTimeframe": "1d",
    "avgHoldTime": "Days to weeks",
    "winRateTarget": "55–65%",
    "idealFor": "Equity portfolios, multi-day holds, balanced risk/reward",
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
          "rsi-overbought",
          "macd-crossover",
          "ema-structure",
          "volume-confirmation",
          "speed-momentum",
          "bollinger-band-squeeze",
          "support-resistance-levels",
          "volatility-tools",
          "session-open-effect"
        ],
        "directiveMaxScores": {}
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
          "news-sentiment-positive",
          "earnings-proximity",
          "earnings-momentum",
          "social-buzz",
          "insider-activity"
        ],
        "directiveMaxScores": {}
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
          "portfolio-performance",
          "spy-qqq-relative-strength",
          "dilution-impact",
          "vix-regime",
          "liquidity-check",
          "budget-gate",
          "rollover-risk",
          "dxy-regime"
        ],
        "directiveMaxScores": {}
      }
    ]
  },
  "default-short": {
    "name": "SEES Default (SHORT)",
    "description": "Short-side variant of SEES Default — overbought, distribution, breakdown detection.",
    "directionMode": "SHORT_ONLY",
    "tradingStyle": "Swing / Position",
    "recommendedTimeframe": "1d",
    "avgHoldTime": "Days to weeks",
    "winRateTarget": "50–60%",
    "idealFor": "Short-side opportunities, bearish reversals, profit-taking exits",
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
        ],
        "directiveMaxScores": {}
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
          "news-sentiment-positive",
          "earnings-proximity",
          "earnings-momentum",
          "social-buzz"
        ],
        "directiveMaxScores": {}
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
          "portfolio-performance",
          "spy-qqq-relative-strength",
          "dilution-impact",
          "vix-strategy",
          "liquidity-check",
          "budget-gate",
          "rollover-risk",
          "dxy-regime"
        ],
        "directiveMaxScores": {}
      }
    ]
  },
  "built-in-default": {
    "name": "Built-in Default",
    "description": "Always-available default protocol. Uses only MT5 price/candle data — no external API keys needed. Works with MetaQuotes-Demo out of the box. 16 directives across technicals, macro context, and risk gates. Designed to give meaningful signals without any configuration.",
    "directionMode": "LONG_ONLY",
    "tradingStyle": "Swing / Intraday",
    "recommendedTimeframe": "15m",
    "avgHoldTime": "1–4 hours",
    "winRateTarget": "55–65%",
    "idealFor": "Default pipeline — EURUSD, GBPUSD, XAUUSD on MT5 demo. Zero-config startup. Always shows in Scoring + Trading pages.",
    "groups": [
      {
        "id": "technical",
        "name": "Core Technicals",
        "description": "Core Technicals",
        "weight": 0.45,
        "isRiskGate": false,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "speed-momentum",
          "rsi-oversold",
          "macd-crossover",
          "volume-confirmation",
          "bollinger-band-squeeze",
          "doji-pattern",
          "engulfing-pattern",
          "support-resistance-levels",
          "atr-dip",
          "momentum-exhaustion"
        ],
        "directiveMaxScores": {
          "speed-momentum": 120,
          "rsi-oversold": 120,
          "macd-crossover": 110,
          "atr-dip": 95
        }
      },
      {
        "id": "sentiment",
        "name": "Macro Context",
        "description": "Macro Context",
        "weight": 0.15,
        "isRiskGate": false,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "dxy-regime"
        ],
        "directiveMaxScores": {}
      },
      {
        "id": "risk",
        "name": "Position Risk",
        "description": "Position Risk",
        "weight": 0.4,
        "isRiskGate": true,
        "minMultiplier": 0.4,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "budget-gate",
          "liquidity-check",
          "rollover-risk",
          "session-open-effect",
          "position-size-confidence"
        ],
        "directiveMaxScores": {
          "liquidity-check": 80,
          "session-open-effect": 110
        }
      }
    ]
  },
  "built-in-short": {
    "name": "Built-in Default (SHORT)",
    "description": "Short-side variant of Built-in Default. Uses bearish MT5 directives — overbought, breakdown, distribution. Pair with built-in-default for dual-protocol BUY/SELL comparison.",
    "directionMode": "SHORT_ONLY",
    "tradingStyle": "Swing / Intraday",
    "recommendedTimeframe": "15m",
    "avgHoldTime": "1–4 hours",
    "winRateTarget": "50–60%",
    "idealFor": "Short opportunities, bearish reversals. Pairs with built-in-default for dual scoring.",
    "groups": [
      {
        "id": "bearish-technical",
        "name": "Bearish Core Technicals",
        "description": "Bearish Core Technicals",
        "weight": 0.45,
        "isRiskGate": false,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "speed-momentum",
          "rsi-overbought",
          "macd-crossover",
          "stochastic",
          "bollinger-band-squeeze",
          "doji-pattern",
          "engulfing-pattern",
          "pin-bar-pattern",
          "resistance-levels-strategy",
          "momentum-exhaustion"
        ],
        "directiveMaxScores": {
          "speed-momentum": 120,
          "macd-crossover": 110
        }
      },
      {
        "id": "bearish-sentiment",
        "name": "Macro Context",
        "description": "Macro Context",
        "weight": 0.15,
        "isRiskGate": false,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "dxy-regime"
        ],
        "directiveMaxScores": {}
      },
      {
        "id": "short-risk",
        "name": "Short-Side Risk",
        "description": "Short-Side Risk",
        "weight": 0.4,
        "isRiskGate": true,
        "minMultiplier": 0.4,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "budget-gate",
          "liquidity-check",
          "rollover-risk",
          "session-open-effect",
          "position-size-confidence"
        ],
        "directiveMaxScores": {
          "liquidity-check": 80,
          "session-open-effect": 110
        }
      }
    ]
  },
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
          "rsi-overbought",
          "session-open-effect"
        ],
        "directiveMaxScores": {
          "speed-momentum": 120,
          "rsi-oversold": 120
        }
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
          "news-sentiment-positive",
          "social-buzz"
        ],
        "directiveMaxScores": {
          "crypto-fear-greed": 60
        }
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
          "btc-halving-cycle",
          "crypto-weekend-effect",
          "vix-regime",
          "liquidity-check",
          "portfolio-performance"
        ],
        "directiveMaxScores": {
          "btc-halving-cycle": 200,
          "crypto-weekend-effect": 50
        }
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
          "rsi-overbought",
          "support-resistance-levels",
          "multi-timeframe-trend",
          "micro-sr-levels",
          "volatility-tools",
          "session-open-effect"
        ],
        "directiveMaxScores": {
          "speed-momentum": 120,
          "rsi-oversold": 120
        }
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
          "news-sentiment-positive"
        ],
        "directiveMaxScores": {
          "crypto-fear-greed": 60
        }
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
          "liquidity-check",
          "vix-regime",
          "crypto-weekend-effect",
          "portfolio-performance"
        ],
        "directiveMaxScores": {
          "crypto-weekend-effect": 50
        }
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
          "rsi-overbought",
          "support-resistance-levels",
          "session-open-effect",
          "gold-round-numbers"
        ],
        "directiveMaxScores": {
          "speed-momentum": 120,
          "rsi-oversold": 120,
          "gold-round-numbers": 80
        }
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
          "news-sentiment-positive",
          "gold-macro-correlation",
          "gold-session-profile"
        ],
        "directiveMaxScores": {}
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
          "vix-regime",
          "liquidity-check",
          "portfolio-performance",
          "crypto-weekend-effect"
        ],
        "directiveMaxScores": {
          "crypto-weekend-effect": 50
        }
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
          "rsi-overbought",
          "support-resistance-levels",
          "session-open-effect",
          "gold-round-numbers"
        ],
        "directiveMaxScores": {
          "speed-momentum": 100,
          "rsi-oversold": 100,
          "gold-round-numbers": 80
        }
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
          "news-sentiment-positive",
          "gold-macro-correlation",
          "gold-session-profile"
        ],
        "directiveMaxScores": {}
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
          "vix-regime",
          "liquidity-check",
          "portfolio-performance",
          "crypto-weekend-effect"
        ],
        "directiveMaxScores": {
          "crypto-weekend-effect": 50
        }
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
          "rsi-overbought",
          "support-resistance-levels",
          "session-open-effect",
          "gold-round-numbers"
        ],
        "directiveMaxScores": {
          "speed-momentum": 90,
          "rsi-oversold": 90,
          "gold-round-numbers": 80
        }
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
          "news-sentiment-positive",
          "gold-macro-correlation",
          "gold-session-profile"
        ],
        "directiveMaxScores": {}
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
          "vix-regime",
          "liquidity-check",
          "portfolio-performance",
          "crypto-weekend-effect"
        ],
        "directiveMaxScores": {
          "crypto-weekend-effect": 50
        }
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
          "rsi-overbought",
          "support-resistance-levels",
          "session-open-effect",
          "gold-round-numbers"
        ],
        "directiveMaxScores": {
          "speed-momentum": 80,
          "rsi-oversold": 80,
          "gold-round-numbers": 80
        }
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
          "news-sentiment-positive",
          "gold-macro-correlation",
          "gold-session-profile"
        ],
        "directiveMaxScores": {}
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
          "vix-regime",
          "liquidity-check",
          "portfolio-performance",
          "crypto-weekend-effect"
        ],
        "directiveMaxScores": {
          "crypto-weekend-effect": 50
        }
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
          "rsi-overbought",
          "support-resistance-levels",
          "session-open-effect",
          "gold-round-numbers"
        ],
        "directiveMaxScores": {
          "speed-momentum": 70,
          "rsi-oversold": 70,
          "gold-round-numbers": 80
        }
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
          "news-sentiment-positive",
          "gold-macro-correlation",
          "gold-session-profile"
        ],
        "directiveMaxScores": {}
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
          "vix-regime",
          "liquidity-check",
          "portfolio-performance",
          "crypto-weekend-effect"
        ],
        "directiveMaxScores": {
          "crypto-weekend-effect": 50
        }
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
          "rsi-overbought",
          "support-resistance-levels",
          "session-open-effect"
        ],
        "directiveMaxScores": {
          "speed-momentum": 120,
          "rsi-oversold": 120
        }
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
          "news-sentiment-positive",
          "cad-usd-oil-correlation"
        ],
        "directiveMaxScores": {}
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
          "vix-regime",
          "liquidity-check",
          "portfolio-performance",
          "session-open-effect"
        ],
        "directiveMaxScores": {}
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
          "rsi-overbought",
          "support-resistance-levels",
          "session-open-effect"
        ],
        "directiveMaxScores": {
          "speed-momentum": 120,
          "rsi-oversold": 120
        }
      },
      {
        "id": "sentiment",
        "name": "Market Context",
        "description": "Market Context",
        "weight": 0.25,
        "isRiskGate": false,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "news-sentiment-positive",
          "vix-regime"
        ],
        "directiveMaxScores": {}
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
          "vix-regime",
          "liquidity-check",
          "portfolio-performance",
          "session-open-effect"
        ],
        "directiveMaxScores": {}
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
          "rsi-oversold",
          "rsi-overbought"
        ],
        "directiveMaxScores": {
          "macd-crossover": 110,
          "rsi-oversold": 120
        }
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
          "news-sentiment-positive",
          "vix-regime",
          "analyst-adjustments"
        ],
        "directiveMaxScores": {}
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
          "vix-regime",
          "session-open-effect",
          "liquidity-check",
          "portfolio-performance"
        ],
        "directiveMaxScores": {}
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
          "rsi-overbought",
          "support-resistance-levels",
          "session-open-effect"
        ],
        "directiveMaxScores": {
          "speed-momentum": 120,
          "rsi-oversold": 120
        }
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
          "news-sentiment-positive",
          "analyst-adjustments"
        ],
        "directiveMaxScores": {}
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
          "vix-regime",
          "liquidity-check",
          "portfolio-performance",
          "session-open-effect"
        ],
        "directiveMaxScores": {}
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
          "rsi-oversold",
          "rsi-overbought"
        ],
        "directiveMaxScores": {
          "macd-crossover": 110,
          "rsi-oversold": 120
        }
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
          "news-sentiment-positive",
          "analyst-adjustments",
          "earnings-proximity"
        ],
        "directiveMaxScores": {}
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
          "vix-regime",
          "session-open-effect",
          "liquidity-check",
          "portfolio-performance"
        ],
        "directiveMaxScores": {}
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
          "rsi-overbought",
          "support-resistance-levels",
          "session-open-effect"
        ],
        "directiveMaxScores": {
          "speed-momentum": 120,
          "rsi-oversold": 120
        }
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
          "news-sentiment-positive",
          "analyst-adjustments"
        ],
        "directiveMaxScores": {}
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
          "vix-regime",
          "liquidity-check",
          "portfolio-performance",
          "session-open-effect"
        ],
        "directiveMaxScores": {}
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
          "rsi-overbought",
          "support-resistance-levels",
          "session-open-effect"
        ],
        "directiveMaxScores": {
          "speed-momentum": 120,
          "rsi-oversold": 120
        }
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
          "news-sentiment-positive",
          "analyst-adjustments"
        ],
        "directiveMaxScores": {}
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
          "vix-regime",
          "liquidity-check",
          "portfolio-performance",
          "session-open-effect"
        ],
        "directiveMaxScores": {}
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
          "rsi-overbought",
          "support-resistance-levels",
          "session-open-effect"
        ],
        "directiveMaxScores": {
          "speed-momentum": 120,
          "rsi-oversold": 120
        }
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
          "news-sentiment-positive",
          "social-buzz"
        ],
        "directiveMaxScores": {}
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
          "vix-regime",
          "liquidity-check",
          "portfolio-performance",
          "earnings-proximity"
        ],
        "directiveMaxScores": {}
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
          "rsi-overbought",
          "support-resistance-levels",
          "session-open-effect"
        ],
        "directiveMaxScores": {
          "speed-momentum": 120,
          "rsi-oversold": 120
        }
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
        ],
        "directiveMaxScores": {
          "crypto-fear-greed": 60
        }
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
          "vix-regime",
          "liquidity-check",
          "portfolio-performance"
        ],
        "directiveMaxScores": {}
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
          "rsi-overbought",
          "support-resistance-levels",
          "session-open-effect"
        ],
        "directiveMaxScores": {
          "speed-momentum": 120,
          "rsi-oversold": 120
        }
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
          "news-sentiment-positive",
          "analyst-adjustments"
        ],
        "directiveMaxScores": {}
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
          "vix-regime",
          "liquidity-check",
          "portfolio-performance"
        ],
        "directiveMaxScores": {}
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
        ],
        "directiveMaxScores": {
          "speed-momentum": 120,
          "macd-crossover": 110,
          "rsi-oversold": 120
        }
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
          "news-sentiment-positive",
          "analyst-adjustments",
          "social-buzz",
          "earnings-proximity"
        ],
        "directiveMaxScores": {}
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
          "vix-regime",
          "liquidity-check",
          "portfolio-performance",
          "earnings-momentum"
        ],
        "directiveMaxScores": {}
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
          "rsi-overbought",
          "support-resistance-levels",
          "volatility-tools"
        ],
        "directiveMaxScores": {
          "speed-momentum": 120,
          "rsi-oversold": 120
        }
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
          "news-sentiment-positive",
          "social-buzz",
          "analyst-adjustments"
        ],
        "directiveMaxScores": {}
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
          "vix-regime",
          "liquidity-check",
          "portfolio-performance"
        ],
        "directiveMaxScores": {}
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
          "rsi-overbought",
          "support-resistance-levels",
          "volatility-tools",
          "ema-structure",
          "session-open-effect"
        ],
        "directiveMaxScores": {
          "speed-momentum": 120,
          "rsi-oversold": 120
        }
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
          "news-sentiment-positive",
          "analyst-adjustments",
          "spy-qqq-relative-strength"
        ],
        "directiveMaxScores": {}
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
          "vix-regime",
          "liquidity-check",
          "portfolio-performance",
          "budget-gate"
        ],
        "directiveMaxScores": {}
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
          "rsi-overbought",
          "bollinger-band-squeeze",
          "volume-confirmation",
          "volatility-tools",
          "support-resistance-levels",
          "mean-reversion"
        ],
        "directiveMaxScores": {}
      },
      {
        "id": "sentiment",
        "name": "Sentiment",
        "description": "Sentiment",
        "weight": 0.35,
        "isRiskGate": false,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "news-sentiment-positive",
          "vix-regime"
        ],
        "directiveMaxScores": {}
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
          "vix-regime",
          "liquidity-check",
          "sp500-regime"
        ],
        "directiveMaxScores": {}
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
          "rsi-oversold",
          "rsi-overbought"
        ],
        "directiveMaxScores": {}
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
          "news-sentiment-positive",
          "analyst-adjustments"
        ],
        "directiveMaxScores": {}
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
          "vix-regime",
          "liquidity-check",
          "portfolio-performance"
        ],
        "directiveMaxScores": {}
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
          "rsi-overbought",
          "support-resistance-levels",
          "session-open-effect"
        ],
        "directiveMaxScores": {
          "speed-momentum": 120,
          "rsi-oversold": 120
        }
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
          "news-sentiment-positive",
          "analyst-adjustments"
        ],
        "directiveMaxScores": {}
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
          "vix-regime",
          "liquidity-check",
          "portfolio-performance",
          "session-open-effect",
          "rollover-risk"
        ],
        "directiveMaxScores": {}
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
          "rsi-overbought",
          "support-resistance-levels",
          "session-open-effect"
        ],
        "directiveMaxScores": {
          "speed-momentum": 120,
          "rsi-oversold": 120
        }
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
          "news-sentiment-positive",
          "analyst-adjustments"
        ],
        "directiveMaxScores": {}
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
          "vix-regime",
          "liquidity-check",
          "portfolio-performance",
          "session-open-effect",
          "rollover-risk"
        ],
        "directiveMaxScores": {}
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
        ],
        "directiveMaxScores": {}
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
          "news-sentiment-positive",
          "analyst-adjustments"
        ],
        "directiveMaxScores": {}
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
          "vix-regime",
          "liquidity-check",
          "portfolio-performance"
        ],
        "directiveMaxScores": {}
      }
    ]
  },
  "forex-session-v1": {
    "name": "Forex Session V1",
    "description": "Forex scoring protocol — session-based mean reversion with trend following. Works across EURUSD, GBPUSD, USDJPY, USDCAD, EURGBP.",
    "directionMode": "LONG_ONLY",
    "tradingStyle": "Session / Mean Reversion",
    "recommendedTimeframe": "5m–1h",
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
          "rsi-overbought",
          "bollinger-band-squeeze",
          "support-resistance-levels",
          "ema-structure",
          "macd-crossover",
          "session-open-effect"
        ],
        "directiveMaxScores": {}
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
          "session-open-effect",
          "news-sentiment-positive",
          "analyst-adjustments"
        ],
        "directiveMaxScores": {}
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
          "session-open-effect",
          "vix-regime",
          "liquidity-check",
          "spy-qqq-relative-strength"
        ],
        "directiveMaxScores": {}
      }
    ]
  },
  "cad-sniper-v1": {
    "name": "CAD Sniper V1",
    "description": "CAD-focused protocol for all 5 CAD crosses: USDCAD, EURCAD, GBPCAD, AUDCAD, NZDCAD. CAD is the commodity currency — oil correlation drives sustained trends ideal for speed scalping.",
    "directionMode": "LONG_ONLY",
    "tradingStyle": "Trend / Scalp",
    "recommendedTimeframe": "5s–15m",
    "avgHoldTime": "Seconds to minutes",
    "winRateTarget": "60–70%",
    "idealFor": "US/Canada session (14:30–21:00 GMT). Best during oil inventory releases (Wed 15:30 GMT) and BOC rate decisions. Avoid Canadian holidays when liquidity drops.",
    "groups": [
      {
        "id": "technical",
        "name": "CAD Technical Structure",
        "description": "CAD Technical Structure",
        "weight": 0.4,
        "isRiskGate": false,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "speed-momentum",
          "multi-timeframe-trend",
          "micro-sr-levels",
          "ema-structure",
          "bollinger-band-squeeze",
          "volume-confirmation",
          "support-resistance-levels",
          "session-open-effect"
        ],
        "directiveMaxScores": {
          "speed-momentum": 120,
          "multi-timeframe-trend": 120
        }
      },
      {
        "id": "sentiment",
        "name": "CAD Macro Drivers",
        "description": "CAD Macro Drivers",
        "weight": 0.2,
        "isRiskGate": false,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "cad-usd-oil-correlation",
          "news-sentiment-positive"
        ],
        "directiveMaxScores": {}
      },
      {
        "id": "risk",
        "name": "CAD Risk Gates",
        "description": "CAD Risk Gates",
        "weight": 0.4,
        "isRiskGate": true,
        "minMultiplier": 0.4,
        "maxMultiplier": 1.25,
        "directiveIds": [
          "vix-regime",
          "liquidity-check",
          "portfolio-performance",
          "spy-qqq-relative-strength"
        ],
        "directiveMaxScores": {}
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
          "rsi-overbought",
          "support-resistance-levels",
          "session-open-effect",
          "volatility-tools"
        ],
        "directiveMaxScores": {
          "speed-momentum": 120,
          "rsi-oversold": 120
        }
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
          "news-sentiment-positive"
        ],
        "directiveMaxScores": {}
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
          "vix-regime",
          "liquidity-check",
          "portfolio-performance",
          "spy-qqq-relative-strength"
        ],
        "directiveMaxScores": {}
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
        ],
        "directiveMaxScores": {
          "rsi-divergence": 110,
          "macd-divergence": 115,
          "obv-divergence": 120
        }
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
        ],
        "directiveMaxScores": {}
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
          "vix-regime",
          "market-regime",
          "liquidity-check"
        ],
        "directiveMaxScores": {}
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
        ],
        "directiveMaxScores": {
          "mtf-confluence-conservative": 115
        }
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
          "news-sentiment-positive",
          "analyst-adjustments"
        ],
        "directiveMaxScores": {}
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
          "vix-regime",
          "liquidity-check",
          "portfolio-performance",
          "session-open-effect"
        ],
        "directiveMaxScores": {}
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
        ],
        "directiveMaxScores": {
          "mtf-confluence-weighted": 110,
          "macd-crossover": 110,
          "rsi-oversold": 120
        }
      },
      {
        "id": "sentiment",
        "name": "Market Bias",
        "description": "Market Bias",
        "weight": 0.25,
        "isRiskGate": false,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "vix-regime",
          "news-sentiment-positive"
        ],
        "directiveMaxScores": {}
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
          "vix-regime",
          "liquidity-check",
          "portfolio-performance",
          "budget-gate"
        ],
        "directiveMaxScores": {}
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
        ],
        "directiveMaxScores": {
          "vwap-confluence-simple": 105
        }
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
          "session-open-effect",
          "news-sentiment-positive"
        ],
        "directiveMaxScores": {}
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
          "vix-regime",
          "liquidity-check",
          "portfolio-performance"
        ],
        "directiveMaxScores": {}
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
        ],
        "directiveMaxScores": {
          "vwap-confluence-bands": 110,
          "rsi-oversold": 120
        }
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
          "market-regime",
          "news-sentiment-positive"
        ],
        "directiveMaxScores": {}
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
          "vix-regime",
          "liquidity-check",
          "portfolio-performance",
          "rollover-risk"
        ],
        "directiveMaxScores": {}
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
        ],
        "directiveMaxScores": {}
      },
      {
        "id": "sentiment",
        "name": "Gap Context",
        "description": "Gap Context",
        "weight": 0.25,
        "isRiskGate": false,
        "minMultiplier": 0.3,
        "maxMultiplier": 1.2,
        "directiveIds": [
          "news-sentiment-positive",
          "vix-regime"
        ],
        "directiveMaxScores": {}
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
          "vix-regime",
          "liquidity-check",
          "portfolio-performance",
          "budget-gate"
        ],
        "directiveMaxScores": {}
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
        ],
        "directiveMaxScores": {
          "earnings-momentum": 90,
          "rsi-oversold": 120
        }
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
          "analyst-adjustments",
          "news-sentiment-positive",
          "earnings-proximity"
        ],
        "directiveMaxScores": {}
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
          "vix-regime",
          "liquidity-check",
          "portfolio-performance",
          "budget-gate"
        ],
        "directiveMaxScores": {}
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
    "idealFor": "Demo validation on MetaQuotes-Demo account #10011309743. EURUSD, GBPUSD, XAUUSD. 0.01 lot entries. Tight stops at 1.5× ATR. Risk gates protect the $1K balance from over-trading and session risk.",
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
          "rsi-overbought",
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
          "momentum-exhaustion",
          "overhead-supply-pressure"
        ],
        "directiveMaxScores": {
          "speed-momentum": 120,
          "rsi-oversold": 120,
          "macd-crossover": 110,
          "atr-dip": 95
        }
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
        ],
        "directiveMaxScores": {}
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
          "session-open-effect",
          "position-size-confidence",
          "target-achieved",
          "time-stop",
          "market-regime"
        ],
        "directiveMaxScores": {
          "liquidity-check": 80,
          "session-open-effect": 110
        }
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
        ],
        "directiveMaxScores": {}
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
          "news-sentiment-positive",
          "earnings-proximity",
          "earnings-momentum",
          "social-buzz"
        ],
        "directiveMaxScores": {}
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
          "portfolio-performance",
          "spy-qqq-relative-strength",
          "dilution-impact",
          "vix-strategy",
          "liquidity-check",
          "budget-gate",
          "rollover-risk",
          "dxy-regime"
        ],
        "directiveMaxScores": {}
      }
    ]
  },
  "eurusd-macro-v1": {
    "name": "EURUSD Macro-Pair V1",
    "description": "Rate-differential and macro-data-driven protocol for EURUSD.",
    "directionMode": "BOTH",
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
        ],
        "directiveMaxScores": {}
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
        ],
        "directiveMaxScores": {}
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
          "news-sentiment-positive",
          "conviction-growth"
        ],
        "directiveMaxScores": {}
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
        ],
        "directiveMaxScores": {}
      }
    ]
  },
  "usdjpy-risk-v1": {
    "name": "USDJPY Risk-Pair V1",
    "description": "Risk-sentiment yen protocol",
    "directionMode": "BOTH",
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
          "vix-regime",
          "market-regime"
        ],
        "directiveMaxScores": {}
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
        ],
        "directiveMaxScores": {}
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
        ],
        "directiveMaxScores": {}
      }
    ]
  },
  "gbpusd-news-v1": {
    "name": "GBPUSD News-Pair V1",
    "description": "News-surprise cable protocol",
    "directionMode": "BOTH",
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
          "news-sentiment-positive",
          "conviction-growth"
        ],
        "directiveMaxScores": {}
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
        ],
        "directiveMaxScores": {}
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
        ],
        "directiveMaxScores": {}
      }
    ]
  },
  "usdcad-oil-v1": {
    "name": "USDCAD Oil-Pair V1",
    "description": "Oil-correlation protocol replacing cad-sniper-v1",
    "directionMode": "BOTH",
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
        ],
        "directiveMaxScores": {}
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
        ],
        "directiveMaxScores": {}
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
        ],
        "directiveMaxScores": {}
      }
    ]
  },
  "commodity-pairs-v1": {
    "name": "Commodity-Pairs Macro V1",
    "description": "Commodity currency strength",
    "directionMode": "BOTH",
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
        ],
        "directiveMaxScores": {}
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
        ],
        "directiveMaxScores": {}
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
        ],
        "directiveMaxScores": {}
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
  }
};
