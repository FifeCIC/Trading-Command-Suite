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
  /**
   * Focus rank — 1 is the first protocol to look at (#1187, owner request 2026-11-03).
   *
   * ⚠️ PRESENTATION ONLY. Nothing in scoring, gating, sizing or execution reads it, and nothing
   * should: a rank that changed what a protocol SCORES would make the number depend on the
   * operator's attention. It exists so the few protocols under active work sort to the top of
   * lists and carry a badge, which stops a manual test being run against a protocol nobody is
   * working on.
   *
   * ⚠️ It is NOT `active`. `active = 0` is a kill switch for score writes (#803), and on
   * 2026-11-03 the owner activated every protocol — so `active` separates nothing and cannot be
   * used to answer "which are mine?".
   */
  focusRank?: number;
  /**
   * THEORY (#689) — the written intent: what this protocol is FOR, what a good day looks like, and
   * its known weakness. Prose a human reads.
   *
   * ⚠️ SEEDED since 2026-11-03. It was DB-only before this: the seeder READ `protocol.theory` and
   * never WROTE it, so 9 protocols' prose had no path through a clean install and would have been
   * lost. Measured the same day: 9 of 54 protocols had any theory text at all.
   *
   * ⚠️ Not every protocol needs one, but a protocol with NO theory and a database row claiming
   * otherwise is the prose form of this repo's worst bug. Empty is honest; invented is not.
   */
  theory?: string | null;
  avgHoldTime: string | null;
  winRateTarget: string | null;
  idealFor: string | null;
  groups: SeedProtocolGroup[];
}

export const PROTOCOL_SEED_DATA: Record<string, SeedProtocol> = {
  "xau-speed-v1-long": {
    "name": "Gold Speed Scalp V1 (Long)",
    "description": "Sub-minute gold (XAUUSD) scalping protocol. Gold is the ultimate fear gauge — volatile during CPI, FOMC, NFP, geopolitics. Tight spreads, massive liquidity. Reacts to USD strength and real rates.",
    "directionMode": "LONG_ONLY",
    "tradingStyle": "Tick Scalp",
    "recommendedTimeframe": "5s–30s",
    // FOCUS 2 of 3 (#1187). Ranked by MEASURED evidence, not preference: this arm has no positive
    // backtest on record yet, but it is the one carrying the live XAGUSD position that moved straight
    // into profit, which no other arm has. The short leg inherits this rank from the spread below.
    "focusRank": 2,
    // #689 THEORY — the prose written 2026-08-26 and until 2026-11-03 stored ONLY in the database.
    // It lives here now because a re-seed must restore it (database-seed-discipline: a value that is
    // not in the seed does not survive a reinstall). Copied verbatim from
    // `scripts/db/protocol-theory-seed.sql` — do not paraphrase it here, or the two copies drift.
    "theory": "The gold speed family — one directive set scored across four timeframes (M5 scalps, M15 day trades, 1H swings, 4H positions). The strategy intended inside the structure: catch fast directional gold moves with momentum/velocity directives tuned to gold's volatility profile, with volume confirmation as the honesty check. A good day: a clean directional push with volume behind it — the rarity percentile then marks it as exceptional (the family's all-time best hit rarity 100). Known ceiling: signal pct tops out around 77% because several directives are mutually exclusive by design (they cannot all fire on the same bar — that is intended, not a bug). The four timeframe siblings differ only in bar data, which is how one strategy is stress-tested across holding periods.",
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
  "momentum-stock-v1-long": {
    "name": "Momentum Stocks V1 (Long)",
    "description": "Group protocol for stocks with 100%+ annual gains and continued high expectations. Trend-following bias — winners keep winning until they don't. Higher sentiment weight than index protocols — these stocks are driven by narrative.",
    "directionMode": "LONG_ONLY",
    "tradingStyle": "Day Trade / Swing",
    "recommendedTimeframe": "5m–1d",
    // FOCUS 3 of 3 (#1187). Ranked last of the three on MEASURED evidence: its NVDA baseline is
    // −2,878 on the canonical window, the only arm of the three that is negative. It stays in the
    // focus set because the owner wants a stock strategy and NVDA is the instrument, not because the
    // numbers justify prominence. Do not read rank 3 as "about to be dropped".
    "focusRank": 3,
    "theory": "Momentum stocks — the names that carry a narrative, where price is driven by expectation rather than book value. Technical group reads trend continuation; sentiment group reads whether the narrative is still being believed. A good day: a leader holds structure after a gap and continues, and the sentiment layer does not contradict it. Known weakness: these names reverse hard on the first doubt, so the protocol is long-only by design and its ceiling on a quiet tape is low — a flat day should read as flat, not as a failure.",
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
  "forex-session-v1-long": {
    "name": "Forex Session V1 (Long)",
    "description": "Forex scoring protocol — session-based mean reversion with trend following. Works across EURUSD, GBPUSD, USDJPY, USDCAD, EURGBP.",
    "directionMode": "LONG_ONLY",
    "tradingStyle": "Session / Mean Reversion",
    "recommendedTimeframe": "5m",
    // FOCUS 1 of 3 (#1187). Ranked first on MEASURED evidence: USDJPY 1h is the only arm of the
    // three with a positive canonical baseline — 316 trades, 72% win rate, trade profit factor 3.47,
    // +9,728.72 net. Rank follows the number, not the enthusiasm; if the evidence moves, move this.
    "focusRank": 1,
    // #689 THEORY — written 2026-08-26, DB-only until 2026-11-03, and the text one re-seed DESTROYED
    // before the `update` clause was made conditional. Verbatim from
    // `scripts/db/protocol-theory-seed.sql`.
    "theory": "Session-timed forex for the major pairs. Targets London/NY session trends: technical group for trend structure, sentiment group for cross-pair context, and session timing as the timing layer. This is the most active protocol in the app (hundreds of actionable snapshots per week). A good day: a major pair trending through a session with clean structure and no conflicting sentiment. Known weakness: session-open-effect is zero outside its 30-minute window, so for most of the day that directive's maxScore sits unpaid in the denominator — typical scores cap near 50% and only reach the high band inside the open window. If this protocol ever feels too quiet outside sessions, that is the timing layer working as designed, not a fault.",
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

/**
 * `slug-long` → `slug-short`, `Name (Long)` → `Name (Short)`.
 *
 * ⚠️ The pair shares a BASE and the direction token is the last token. Appending naively would
 * produce `xau-speed-v1-long-short` and `Gold Speed Scalp V1 (Long) (Short)` — measured 2026-11-05,
 * when the database had already been renamed to `<base>-long` / `<base>-short` and the seed was
 * still generating the naive form. The two disagreed, so `strategy-pair-integrity.spec.ts` could no
 * longer resolve three bot legs and the seed's own `name`/`slug` would have converged the database
 * back to the old shape on the next re-seed.
 */
const DIRECTION_TOKEN = /\s*\((?:Long|Short)\)\s*$/;

function shortSlugFor(slug: string): string {
  return slug.endsWith('-long') ? `${slug.slice(0, -'-long'.length)}-short` : `${slug}-short`;
}

function shortNameFor(name: string): string {
  return `${name.replace(DIRECTION_TOKEN, '')} (Short)`;
}

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

  PROTOCOL_SEED_DATA[shortSlugFor(slug)] = {
    ...base,
    name: shortNameFor(base.name),
    description:
      `SHORT leg of ${base.name}. Same groups, weights and multipliers; bullish directives are ` +
      `substituted or dropped because a SHORT_ONLY protocol may not contain one (#1185).`,
    directionMode: 'SHORT_ONLY',
    groups,
    /**
     * ⚠️ The short leg gets its OWN theory, not the parent's, and it is GENERATED so every future
     * pair carries it. Measured 2026-11-03: all three derived short legs had `theory = NULL` while
     * two of the three parents had real prose — so half of every pair was silent about what it was
     * for. A pair with one explained half reads as one strategy that happens to have two engines.
     *
     * The wording deliberately does NOT claim the short side is the mirror of the long: it is a
     * different behaviour (a forced move) rather than the same behaviour inverted, and saying so is
     * the point of having two protocols instead of one with a direction flag.
     */
    theory:
      `SHORT leg of ${base.name}. Same groups, weights and multipliers; bullish directives are ` +
      `substituted (rsi-oversold → rsi-overbought) or dropped, so this leg reads the DOWN-side of ` +
      `the same question rather than the mirror of the long. Theory: it harvests the FAST, forced ` +
      `move — liquidation, stop cascades, panic — which is a different behaviour from the slow ` +
      `grind the long leg waits for (#1185). If both legs win at the same rate and at the same ` +
      `speed, there is no asymmetry and this is one strategy split in two.`,
    // ⚠️ The short leg keeps the PARENT's focus rank on purpose (#1187): a pair is one strategy, so
    // "show me my focus protocols" must not return half of a pair. Two rows on one rank is fine HERE
    // — this column orders a LIST, and the sort tiebreaks on `slug`, so it is deterministic. That is
    // the opposite of `symbol_protocol_assignment.priority`, where a tie was a real ambiguity because
    // the resolver returned a single winner (#1181).
    focusRank: base.focusRank,
  };
}
