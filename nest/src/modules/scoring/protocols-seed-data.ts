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

/**
 * ── THE SHORT LEG OF EACH SHIPPED PROTOCOL (#1185, shape B, 2026-11-02) ────────────────────────
 *
 * The owner's design: one bot holding a LONG protocol and a SHORT protocol, summarised as ONE
 * strategy.
 *
 * 🛑 **A SHORT LEG IS NOT A COPY.** The first version of this code derived each short leg as a plain
 * copy of its long counterpart with `directionMode` flipped — and `validate-protocol-directions.cjs`
 * refused the build with six conflicts:
 *
 *     xau-speed-v1-short (SHORT_ONLY) contains rsi-oversold (bullish)
 *     forex-session-v1-short (SHORT_ONLY) contains ema-structure (bullish)
 *     momentum-stock-v1-short (SHORT_ONLY) contains rsi-oversold (bullish) …
 *
 * The direction contract (mirrored from `directive-inclusion.ts`) is: **bullish → LONG_ONLY only,
 * bearish → SHORT_ONLY only, neutral → either.** A bullish directive inside a SHORT_ONLY protocol is
 * "added" in the seed and then silently dropped at scoring time, so the pair would have looked like
 * two legs of one strategy while actually scoring different directive sets. The gate caught it before
 * anything shipped — which is the difference between a declared pair and a real one.
 *
 * So the short leg is DERIVED WITH SUBSTITUTIONS: a bullish directive is replaced by its bearish
 * mirror where one exists, and dropped where none does. Everything else — groups, weights,
 * multipliers, neutral and undirected directives — is copied verbatim, so the two legs remain the
 * same strategy taken both ways.
 *
 * ⚠️ `BULLISH_DIRECTIVES` is declared here rather than imported: the directive classes are Nest
 * providers and a seed-data file cannot instantiate them. The guard is the build —
 * `validate-protocol-directions.cjs` runs in `prebuild` and fails on any bullish id inside a
 * SHORT_ONLY protocol, so this list going stale is a red build, not a silent drift.
 * Measured 2026-11-02 from the compiled classes: 11 bullish, 2 bearish, 94 neutral, 37 undirected
 * (undirected is treated as direction-capable and is allowed in both).
 */
const BULLISH_DIRECTIVES = new Set([
  'earnings-momentum', 'earnings-proximity', 'ema-structure', 'falling-risk-pyramid',
  'momentum-continuation-combo', 'momentum-exhaustion', 'panic-exhaustion-absorption',
  'rsi-oversold', 'target-achieved', 'three-soldiers-pattern', 'volume-surge',
]);

/** Bullish id → its bearish mirror, or `null` when there is no honest mirror (so it is dropped). */
const SHORT_LEG_SUBSTITUTION: Record<string, string | null> = {
  // The only true mirror in the registry today: oversold↔overbought is one threshold read from the
  // other side. Everything else below has no bearish counterpart, so the short leg runs WITHOUT it
  // rather than with a directive that would be dropped at scoring time anyway.
  'rsi-oversold': 'rsi-overbought',
  'ema-structure': null,
  'earnings-momentum': null,
  'earnings-proximity': null,
  'momentum-continuation-combo': null,
  'momentum-exhaustion': null,
  'panic-exhaustion-absorption': null,
  'falling-risk-pyramid': null,
  'target-achieved': null,
  'three-soldiers-pattern': null,
  'volume-surge': null,
};

for (const slug of [...Object.keys(PROTOCOL_SEED_DATA)]) {
  const base = PROTOCOL_SEED_DATA[slug];
  if (!base || base.directionMode === 'SHORT_ONLY') continue; // idempotent: never `-short-short`

  const groups: SeedProtocolGroup[] = base.groups.map((g) => {
    const ids = new Set<string>();
    for (const directiveId of g.directiveIds) {
      if (!BULLISH_DIRECTIVES.has(directiveId)) { ids.add(directiveId); continue; }
      const mirror = SHORT_LEG_SUBSTITUTION[directiveId];
      if (mirror) ids.add(mirror);
    }
    const next: SeedProtocolGroup = { ...g, directiveIds: [...ids] };
    if (g.directiveInstances) {
      // Named instances of a bullish directive go for the same reason: they would be dropped at
      // scoring time and the pair would silently differ.
      next.directiveInstances = g.directiveInstances.filter(
        (inst) => !BULLISH_DIRECTIVES.has(inst.directiveId),
      );
    }
    return next;
  });

  PROTOCOL_SEED_DATA[`${slug}-short`] = {
    ...base,
    name: `${base.name} (Short)`,
    description:
      `SHORT leg of ${base.name}. Same groups, weights and multipliers; bullish directives are ` +
      `substituted or dropped because a SHORT_ONLY protocol may not contain one (#1185).`,
    directionMode: 'SHORT_ONLY',
    groups,
  };
}
