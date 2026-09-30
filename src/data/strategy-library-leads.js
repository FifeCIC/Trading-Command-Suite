/**
 * strategy-library-leads.js — STRATEGY IDEAS CAPTURED FROM THE GITHUB BACKLOG.
 * ==============================================================================
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM `strategy-library.js`
 * ---------------------------------------------------------
 * The owner asked (2026-10-01) to clear the strategy issues out of GitHub and
 * *"copy them to the apps own Strategy Library"*, so the repo becomes manageable and the
 * ideas live where they are actually used.
 *
 * ⚠️ These entries are KEPT APART from the hand-authored library entries ON PURPOSE. They are
 * backlog-sourced leads, not designed methodologies: each carries `sourceIssue` so the original
 * reasoning, the alternatives and the discussion remain one click away. Merging them into the main
 * array would erase that provenance, and provenance is the only thing that makes a one-paragraph
 * idea safe to act on later.
 *
 * `strategy-library.js` spreads this array into `STRATEGY_LIBRARY`, so these render on
 * `/trading/strategy-library` exactly like the others. One array is rendered; two files keep the
 * origin honest.
 *
 * ── status ────────────────────────────────────────────────────────────────────
 *   ALL of these are `'concept'`, and that is a measurement rather than modesty: none has a
 *   directive mapping that resolves, and none has a `tcsProtocol`. Per the tiers in
 *   `docs/readiness-tiers.md`, `concept` means *documented, nothing wired*.
 *
 * ── requiresNewDirectives — the field that answers "what does the app need first?" ──────
 *   The owner asked which ideas *"need the app to have some work done i.e. new directives"*.
 *   That answer belongs ON the entry, not in a chat message nobody will find again. Each name here
 *   is a directive that does NOT exist yet; the idea cannot reach `'partial'` until it does.
 *   Check against `GET /api/directives` before treating any of them as missing.
 */

export const STRATEGY_LIBRARY_LEADS = [
  {
    id: 'trade-a-surge',
    sourceIssue: 663,
    name: 'Trade a Surge',
    tagline: 'Identify a spike, monitor whether it holds, and trade the reaction both ways',
    category: 'Momentum / Mean-Reversion',
    assetClasses: ['CFD Indices', 'Metals', 'Crypto'],
    difficulty: 'Advanced',
    timeframe: '1m / 5m / 15m',
    status: 'concept',
    // ⚠️ `requiresNewDirectives` USED TO LIST THESE THREE. They were implemented 2026-10-01, so the
    // field is now EMPTY — leaving it populated beside a `directiveMappings` that names the same
    // three would be a self-contradicting entry, and the field is only useful while it is truthful.
    requiresNewDirectives: [],
    overview: `
A reaction trade rather than a trend trade. A fast, large move is detected, then WATCHED rather
than chased. The question the idea is built on is the owner's own: *what goes up fast and high has
to come back down* — but only if the spike fails to hold.`,
    theory: `
Two regimes follow a spike, and the same setup must resolve into one of them:
  1. **Continuation** — the level holds and the move extends. A breakout entry is correct.
  2. **Failure** — the move is retraced. A fade entry is correct.
Both are tradable; choosing at entry is guessing. So the design separates DETECTION from DECISION:
detection runs immediately, the decision waits for evidence that the spike held.
`,
    mechanics: [
      { title: 'Detect', body: 'Flag a move exceeding a volatility multiple (ATR-relative, not a fixed percent — the same 1% is noise on gold and a surge on an index).' },
      { title: 'Watch', body: 'Hold the flag for N bars with no entry. Record whether price closes back inside the spike range.' },
      { title: 'Resolve', body: 'Holds above → continuation candidate. Fails back inside → fade candidate. Neither → no trade, which is the common case.' },
      { title: 'Two-way', body: 'The hedge-CFD variant trades both directions. ⚠️ Needs a duplicate-position policy first — see #721 and the netting hazard in the change guide.' },
    ],
    directiveMappings: [
      // ⚠️ WIRED 2026-10-01 — the three directives now EXIST (`surge.directive.ts`, registered in
      // `directives.module.ts`). They moved from `requiresNewDirectives` to here, which is what
      // those two fields mean: one names what is missing, the other what exists.
      //
      // ⚠️ THE ENTRY STAYS `concept` ANYWAY. Directives existing is not the strategy working: not
      // one is attached to a live protocol, and ATTACHING them changes what a tradeable symbol
      // scores — a maths change needing a copied configuration and a monitored comparison. Status
      // moves to `partial` when a protocol is built, not when the code compiles.
      { directiveId: 'surge-detection', role: 'signal', note: 'The trigger. ATR-relative so one threshold works across instruments.' },
      { directiveId: 'spike-hold-confirmation', role: 'confirm', note: 'The decision. Held → continuation; failed → fade. Both outcomes are directional.' },
      { directiveId: 'surge-exhaustion', role: 'confirm', note: 'Deceleration. Direction is INVERTED from the surge — an up-move tiring reads bearish.' },
    ],
    strengths: ['Trades the reaction instead of predicting the spike', 'A no-trade outcome is a first-class result, not a missed opportunity'],
    risks: ['Surge detection is easy to back-fit; the threshold must be ATR-relative and fixed BEFORE looking', 'Trading both ways on a netting account merges into one position — the #1037 contested problem'],
    configSchema: { surgeAtrMultiplier: { type: 'number', default: 2.0 }, watchBars: { type: 'number', default: 5 } },
  },

  {
    id: 'btc-mstr-lead-lag',
    sourceIssue: 659,
    name: 'BTC → MSTR Lead/Lag',
    tagline: 'Trade a stock against the asset whose moves it amplifies',
    category: 'Cross-Asset / Equity',
    assetClasses: ['Mega-Cap Stocks', 'Crypto'],
    difficulty: 'Advanced',
    timeframe: 'Daily / Weekly',
    status: 'concept',
    requiresNewDirectives: ['cross-asset-lead-lag', 'beta-amplification'],
    overview: `
MSTR is a leveraged proxy for BTC — holders get the coin's exposure with an equity wrapper. The
observed asymmetry in the source issue (BTC's weekly win rate above MSTR's over the same window)
is the lead: if the proxy is weaker than what it tracks, the divergence is the signal.`,
    theory: `
A proxy that systematically underperforms the thing it proxies is either mispriced or carrying an
unpriced risk. Either way the SPREAD between the two is the tradable object — trading one leg
alone is trading a direction, and the idea is about a relationship.

⚠️ **The statistic in the source issue is 313 weeks to 2026-08-10 and is CITED, never measured
here.** A 165-vs-151 win-rate split over ~160 weeks is well within the range a random series
produces, so "BTC wins more often" is NOT yet a finding. It is a hypothesis with a number attached.
Test it before anyone builds on it.
`,
    mechanics: [
      { title: 'Measure the spread', body: 'Rolling ratio of the two instruments. Any signal is built on the RATIO, never on either leg alone.' },
      { title: 'Establish significance', body: 'The cited win-rate gap must survive a random-series comparison before it is treated as an edge.' },
      { title: 'Decide direction', body: 'Long the laggard / short the leader only when the ratio leaves a band that was itself derived from the same window.' },
    ],
    directiveMappings: [],
    strengths: ['Market-neutral in principle, so it does not depend on being right about BTC'],
    risks: ['⚠️ The cited statistic is unverified and plausibly noise — this is the first thing to test', 'MSTR is one instrument: single-name risk, gap risk overnight, no hedge against a filing'],
    configSchema: { ratioBandPct: { type: 'number', default: 5 }, lookbackWeeks: { type: 'number', default: 52 } },
  },

  {
    id: 'confluence-multi-indicator',
    sourceIssue: 644,
    name: 'Multi-Indicator Confluence',
    tagline: 'Require several independent signals to agree before entering',
    category: 'Confluence',
    assetClasses: ['FX Majors', 'Indices', 'Metals'],
    difficulty: 'Intermediate',
    timeframe: '15m / 1H / 4H',
    status: 'concept',
    requiresNewDirectives: ['trend-confluence', 'momentum-confluence', 'structure-confluence'],
    overview: `
The most-repeated pattern in retail strategy publishing: instead of one indicator, demand that
trend, momentum and structure **all** agree, and trade only the overlap. Fewer trades, each with
several reasons.`,
    theory: `
Confluence is a **precision instrument, not an accuracy one**, and that distinction is the whole
idea. Requiring three agreements raises the hit rate and cuts the trade count — it does not
manufacture edge, and it can easily reduce total return by removing the trades that carried it.

⚠️ The source issue asks *"is it any good?"* about a published TradingView script. That is an
evaluation request, NOT a design. There is no need to copy the script: Protocols already provide
weighted multi-directive aggregation, so the honest first step is to express the same idea as a
protocol and compare — rather than importing an indicator set this pipeline cannot verify.
`,
    mechanics: [
      { title: 'Three families, not three indicators', body: 'Trend, momentum and structure are the axes. Two indicators from one family is one opinion, not two — the commonest way confluence backtests well and fails live.' },
      { title: 'Require the overlap', body: 'Enter only where all families agree. No partial credit.' },
      { title: 'Count the cost', body: 'Record how many trades the requirement removed and what they earned. That number, not the win rate, decides whether confluence pays.' },
    ],
    directiveMappings: [],
    strengths: ['Expresses an intent the protocol scoring already supports — no new architecture needed'],
    risks: ['⚠️ Over-filters: the removal of trades may cost more than the precision gains', 'Families that share an input (e.g. two MAs and an RSI on the same bars) are not independent'],
    configSchema: { requireFamilies: { type: 'number', default: 3 } },
  },

  {
    id: 'news-catalyst-only',
    sourceIssue: 630,
    name: 'News-Catalyst Only',
    tagline: 'Trade the catalyst itself, and nothing else',
    category: 'Event-Driven',
    assetClasses: ['Stocks', 'Indices'],
    difficulty: 'Advanced',
    timeframe: '1m / 5m / Daily',
    status: 'concept',
    requiresNewDirectives: ['news-catalyst-strength', 'news-novelty'],
    overview: `
News is imported at scale in this app and used for **nothing**. This idea makes news the signal
rather than a filter: a protocol that trades purely on catalysts, with the entry queued for a
better price rather than taken at the spike.`,
    theory: `
Two properties decide whether a news item is tradable, and neither is "it sounds important":
  • **Novelty** — the first report moves price; the fifth does not.
  • **Strength** — a surprise against expectation, not the size of the number.

The honest constraint is data, and it must be stated before any build: the source issue notes
Benzinga (#410), Polygon (#409) and Twitter/X (#411) are all still **planned**. Without scheduled
earnings and a surprise measure there is no strength to compute, so this cannot leave \`concept\`
on the current feeds.
`,
    mechanics: [
      { title: 'Wait for the data', body: 'Novelty and surprise both need a real-time feed. ⚠️ Blocked on #410 / #409 / #411 — not on strategy work.' },
      { title: 'Queue, do not chase', body: 'Signal on the catalyst, request a better entry price, accept missing the ones that never pull back.' },
      { title: 'Fade the fifth report', body: 'Repeated coverage of one catalyst is treated as decreasing relevance, not confirmation.' },
    ],
    directiveMappings: [],
    strengths: ['Biggest unused data source in the app — the marginal value of a feed is currently zero'],
    risks: ['⚠️ Blocked on provider work, not on this idea', 'News entry without a stop is how a spike becomes a −322.67; the stop must be placed with the order'],
    configSchema: { minNoveltyScore: { type: 'number', default: 60 } },
  },

  {
    id: 'gold-cross-basket',
    sourceIssue: 596,
    name: 'Gold Cross Basket',
    tagline: 'Trade XAU against several currencies at once, on one broker',
    category: 'Metals / Multi-Pair',
    assetClasses: ['Metals', 'FX'],
    difficulty: 'Advanced',
    timeframe: '1H / 4H',
    status: 'concept',
    requiresNewDirectives: ['gold-basket-strength'],
    overview: `
Gold is quoted in several currencies on Pepperstone (XAUUSD, XAUEUR, XAUGBP, XAUAUD…). The USD
leg dominates all of them, so a basket trade can isolate the gold move from the dollar move that
every single pair carries.`,
    theory: `
XAUUSD is two trades in one instrument: a gold view and a USD view. Trading the single pair means
being right about both and only being paid for one. Holding the same gold exposure in several
quote currencies **cancels the common dollar leg**, leaving a purer gold position.

⚠️ It does not fully cancel — the crossing rates carry their own dynamics — so the basket is a
reduction in dollar sensitivity, not a hedge. Stating it as a hedge would be the overclaim.
`,
    mechanics: [
      { title: 'Hold the set', body: 'Equal risk per leg, in several quote currencies, entered together.' },
      { title: 'Treat as ONE position', body: '⚠️ All legs on one netting account share attribution and margin. See #807 and the change guide — a basket built from separate orders becomes one broker position with several claimants.' },
      { title: 'Size the basket, not the leg', body: 'Total risk is what matters; per-leg sizing that sums above the cap is the standard way this goes wrong.' },
    ],
    directiveMappings: [],
    strengths: ['Removes the dollar leg that every single XAU pair carries', 'One broker, so no cross-broker margin'],
    risks: ['⚠️ Netting: the legs are not independent positions, whatever the order history says', 'Correlated legs multiply the loss when gold itself moves against the book'],
    configSchema: { legs: { type: 'number', default: 3 }, riskPerLeg: { type: 'number', default: 0.3 } },
  },

  {
    id: 'earnings-whispers',
    sourceIssue: 512,
    name: 'Earnings Whispers',
    tagline: 'Trade the gap between expectation and whisper, not the reported number',
    category: 'Event-Driven / Equity',
    assetClasses: ['Mega-Cap Stocks'],
    difficulty: 'Advanced',
    timeframe: 'Daily',
    status: 'concept',
    requiresNewDirectives: ['earnings-surprise-expectation', 'whisper-divergence'],
    overview: `
The reported figure is not what moves a stock — the distance from what was EXPECTED is. A beat
that is smaller than the whisper sells off. This idea scores the divergence rather than the result.`,
    theory: `
Three numbers matter and they are frequently conflated:
  • **Reported** — the actual figure.
  • **Consensus** — the published estimate the market is priced against.
  • **Whisper** — the unofficial number traders actually expect.
Price reacts to (Reported − Whisper). Scoring against consensus answers a question the market has
already moved past, which is why a "beat" can fall and does.
`,
    mechanics: [
      { title: 'Score the divergence', body: 'Signal strength is Reported minus Whisper, normalised by the instrument’s own historical reaction.' },
      { title: 'Respect the timing', body: 'This trades a known future moment — the position should be small into the print and the risk defined before it, not after.' },
      { title: 'Refuse without a whisper', body: '⚠️ With no whisper source the idea degrades to trading consensus, which is a different and weaker strategy. Decline rather than substitute.' },
    ],
    directiveMappings: [],
    strengths: ['Explains the commonest confusion in event trading, which is itself worth having documented'],
    risks: ['⚠️ Whisper data is not available from the current feeds — same block as #630', 'Overnight gap risk cannot be stopped out intraday'],
    configSchema: { minWhisperDivergencePct: { type: 'number', default: 2 } },
  },

  {
    id: 'mtf-composite-scoring',
    sourceIssue: 727,
    name: 'Multi-Timeframe Composite',
    tagline: 'Aggregate trend, momentum and volatility across horizons into one score',
    category: 'Methodology',
    assetClasses: ['Any'],
    difficulty: 'Intermediate',
    timeframe: 'Multi',
    status: 'concept',
    requiresNewDirectives: [],
    overview: `
A METHODOLOGY rather than an instrument-specific strategy: score the same instrument on several
timeframes and combine into a single actionable number. In this app that is a description of what
Protocols already do, which is why it is recorded as a methodology rather than built.`,
    theory: `
The idea is that agreement across horizons is more meaningful than strength on one. Two ways to
combine, and they are not equivalent:
  • **Weighted average** — a strong 4H can outvote a weak 5m. Favours the higher timeframe.
  • **Minimum (weakest link)** — every horizon must clear a floor. Favours alignment and trades far
    less.

⚠️ **This is already the pipeline's design, so there is nothing to build here.** The value of the
entry is as a REFERENCE: it names the two combination rules and the choice between them, which is
the decision #674 and #610 are actually about. Recorded to stop the idea being re-filed.
`,
    mechanics: [
      { title: 'Pick the rule, once', body: 'Weighted average or weakest-link. This is a whole-strategy decision, not a parameter.' },
      { title: 'Fix the weights before measuring', body: 'Choosing horizon weights after seeing the result is fitting, not scoring.' },
      { title: 'Check the denominator', body: 'Combined scores across differing maxScores must be normalised — see `INV-STABLE-DENOMINATOR`.' },
    ],
    directiveMappings: [],
    strengths: ['Documents a decision the pipeline already makes, so it is not re-litigated'],
    risks: ['Nothing to build — if this is read as a work item it will duplicate the protocol layer'],
    configSchema: { combineRule: { type: 'string', default: 'weighted-average' } },
  },
];
