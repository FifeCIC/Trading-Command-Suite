/**
 * Strategy Library — canonical strategy definitions.
 * Each strategy is a complete trading methodology with:
 *  - theory & mechanics
 *  - directive mappings (which TCS directives support it)
 *  - configurable parameters
 *  - asset class recommendations
 *
 * When a strategy is "activated" from the library page, the full
 * META.Stack pipeline is assembled and added to the automation loop.
 *
 * ── Adding a New Strategy ──────────────────────────────────────────────
 *
 * 1. Add an entry to the STRATEGY_LIBRARY array below.  Required fields:
 *    id, name, tagline, category, assetClasses[], difficulty, timeframe,
 *    status, overview, theory, mechanics[], directiveMappings[],
 *    strengths[], risks[], configSchema{}.
 *
 * 2. Each directiveMapping must reference a real directive ID registered
 *    in the NestJS DirectivesModule.  Check the /api/directives endpoint
 *    to confirm the directive exists before referencing it.
 *
 * 3. status values:
 *    'concept'   — documented but no directives wired yet
 *    'partial'   — some directives exist but gaps remain
 *    'supported' — all directive mappings reference live directives
 *    'live'      — actively running in the automation loop (has tcsProtocol)
 *
 * 4. If the strategy references NEW directives, those directives must be:
 *    a) Implemented in nest/src/modules/directives/implementations/*.directive.ts
 *    b) Imported + registered in directives.module.ts
 *    c) Seeded to DB via POST /api/directives/seed
 *    d) Classified in prisma/seed_nature.sql
 *    e) Calibrated in prisma/seed.ts (if symbol-specific tuning needed)
 *
 * 5. Strategies with tcsProtocol are "wired" — they have an active protocol
 *    config in the ProtocolRegistry and can be run by the automation loop.
 *    Strategies without tcsProtocol are documentation-only (concept stage).
 *
 * ── Strategy Card Rendering ─────────────────────────────────────────────
 *
 * The StrategyLibraryPage renders each entry as an expandable card.
 * CSS: src/pages/strategy-library.css
 * The page filters nothing — all strategies in this array are shown.
 * Future: filter by assetClass, difficulty, or status.
 */

export const STRATEGY_LIBRARY = [
  {
    id: 'scale-in-recycled-capital',
    name: 'Scale-In Capital Recycling',
    tagline: 'Delayed structural stops with disciplined capital recycling',
    category: 'Swing / Position',
    assetClasses: ['ETF', 'Mega-Cap Stocks'],
    difficulty: 'Intermediate',
    timeframe: 'Daily / 4H',
    status: 'concept', // concept | partial | supported | live

    overview: `
A high-conviction, low-frequency strategy that scales into positions
without immediate stop losses, waiting instead for real market structure
to form before placing protection. Capital is only deployed into new
positions once existing ones are "risk-free" — stops moved above the
average entry price.
    `.trim(),

    theory: `
This strategy blends three established trading frameworks into one
disciplined methodology:

**1. Scale-In / Downward Pyramiding**
Buy smaller initial allocations and add as the price drops to lower
your average cost basis. This is not blind dollar-cost averaging — each
additional buy (tranche) is triggered by price reaching a calculated
level based on volatility (ATR) or a confirmed support zone.

**2. Delayed Structural Stop Placement**
Omitting tight mechanical stops at entry prevents getting "wicked out"
by normal market noise and liquidity sweeps. Once the position is
profitable and a new structural support floor forms above the average
entry price, a stop loss is placed behind that structure with a small
volatility buffer.

**3. Risk-Free Capital Recycling**
New positions are only opened when existing ones have their stop loss
moved above the entry price. This caps total unhedged capital at risk
to the initial allocation × max concurrent positions. Capital is
continuously recycled from protected positions into new opportunities.
    `.trim(),

    mechanics: [
      {
        title: 'Capital Allocation & Position Sizing',
        body: 'Max 10% of portfolio per position. Max 3 concurrent unhedged positions. Each position split into 3 tranches (e.g. 3.3% / 3.3% / 3.4%). New positions blocked until a slot is recycled.',
      },
      {
        title: 'Tranche Entry Triggers',
        body: 'Tranche 1: initial entry on signal. Tranche 2: triggered at 2× ATR below entry or confirmed higher-timeframe support. Tranche 3: triggered at 3× ATR below entry or major structural level. Volume contraction at entry improves probability.',
      },
      {
        title: 'Stop Loss Mechanics',
        body: 'No stop on initial entry (emergency hard stop at -20% at broker level only). Once position is green and a confirmed pivot low or Donchian channel floor forms above the average entry price, place stop at: Support Level − (0.5 × ATR). Move stop to breakeven when price reaches +1R.',
      },
      {
        title: 'Capital Recycling Gate',
        body: 'When stop loss > average entry price → position is "risk-free." Slot is released for a new entry. Max 3 unhedged slots enforced globally. Without recycling, no new positions can be opened.',
      },
      {
        title: 'Time Stop (Dead Capital Prevention)',
        body: 'If a position fails to form a new structural higher-low above the average entry within 30 trading days, the position is liquidated or the first tranche is exited. Prevents capital from being trapped indefinitely in sideways markets.',
      },
      {
        title: 'Emergency Circuit Breaker',
        body: 'A latent hard stop at -20% (or below the multi-month low) is placed at the broker level. This protects against overnight gap-downs and black swan events without interfering with the delayed-stop logic running in the app.',
      },
    ],

    stateMachine: {
      description: 'Each position slot follows a strict state sequence:',
      states: [
        { state: 'IDLE', label: 'Slot Open', desc: 'Fewer than 3 active positions. Scanning for entry signal.' },
        { state: 'ACCUMULATING', label: 'Scaling In', desc: 'Tranche 1 active. Monitoring for Tranche 2/3 triggers.' },
        { state: 'PENDING', label: 'Awaiting Structure', desc: 'Position green. Scanning for structural support to form above average entry.' },
        { state: 'PROTECTED', label: 'Risk-Free', desc: 'Stop loss set above average cost. Slot recycled — new position can open.' },
        { state: 'EXITED', label: 'Closed', desc: 'Stop triggered or profit target hit. Capital returned to pool.' },
      ],
    },

    directiveMappings: [
      { directiveId: 'budget-gate', role: 'Risk Gate', note: 'Enforces max position size and concurrent slot cap' },
      { directiveId: 'position-size-kelly', role: 'Position Sizing', note: 'Kelly-based sizing for initial tranche' },
      { directiveId: 'atr-dip', role: 'Scale-In Trigger', note: 'ATR-normalized dip detection for tranche entries' },
      { directiveId: 'support-resistance-levels', role: 'Structure Detection', note: 'Identifies structural support floors' },
      { directiveId: 'zigzag-swing-detector', role: 'Pivot Detection', note: 'Finds confirmed swing lows for stop placement' },
      { directiveId: 'rollover-risk', role: 'Emergency Gate', note: 'Detects contract rollover / gap risk periods' },
      { directiveId: 'time-stop', role: 'Dead Capital Exit', note: 'Exits if no structure forms within time window' },
      { directiveId: 'liquidity-check', role: 'Execution Gate', note: 'Ensures sufficient liquidity for tranche entries' },
    ],

    strengths: [
      'High win-rate in range-bound and slowly trending markets',
      'Avoids stop-loss hunting and liquidity sweeps (wicking)',
      'Psychological edge: no frustration from premature stop-outs',
      'Asymmetric payoff: fewer deep drawdowns from unhedged positions',
      'Capital efficiency: only deploys new risk when existing positions are protected',
    ],

    risks: [
      'Wider initial drawdown: positions can reach -15% to -30% before structure forms',
      'Opportunity cost: capital sits idle during strong trending markets while waiting for recycling',
      'False structure: choppy markets produce phantom supports that break after stop placement',
      'Earnings gap risk: overnight -25% moves on tech stocks with no entry stop',
      'Execution discipline: moving stops too early gets you shaken out; too late gives back gains',
    ],

    configSchema: {
      maxConcurrentUnhedgedSlots: 3,
      maxPositionAllocationPct: 10,
      trancheSplitPct: [3.33, 3.33, 3.34],
      maxTranches: 3,
      spacingMode: 'ATR', // ATR | FIXED_PCT
      spacingAtrMultiplier: 2.0,
      emergencyHardStopPct: -20,
      profitThresholdPct: 1.5,
      stopBufferAtr: 0.5,
      timeInvalidationDays: 30,
      structureTimeframe: '1D',
    },
  },
  {
    id: 'tech-scale-in-atr',
    name: 'Tech Scale-In with ATR Spacing',
    tagline: 'Volatility-aware averaging down for tech stocks with earnings circuit breakers',
    category: 'Swing / Position',
    assetClasses: ['Mega-Cap Tech', 'High-Beta Growth'],
    difficulty: 'Advanced',
    timeframe: '1H / 4H / Daily',
    status: 'concept',

    overview: `
A tech-stock adaptation of the Scale-In Capital Recycling strategy.
Replaces fixed-percentage pullback spacing with ATR-based volatility
spacing, enforces stricter tranche caps for high-beta names, and adds
mandatory earnings circuit breakers to guard against overnight gap risk.
    `.trim(),

    theory: `
Tech stocks move faster and gap harder than broad ETFs. This variant
recalibrates the core Scale-In framework for the unique risk profile
of individual equities — where a single earnings miss can gap a stock
-25% overnight without warning.

**1. ATR-Based Spacing (Not Fixed Percentage)**
Instead of buying at arbitrary -5% drops, each tranche triggers when
price reaches a volatility-calibrated level: 1.5× to 2× ATR below the
previous entry. This adapts to each stock's actual movement patterns —
a stock that routinely swings 4% daily gets wider spacing than one
that moves 1.5%.

**2. Tiered Tranche Caps by Risk Profile**
Mega-cap tech (AAPL, MSFT, NVDA) allows 3 tranches — these are
structurally resilient companies. High-beta / growth tech caps at 2
tranches — the risk of catching a falling knife is materially higher
when the company may not be profitable or faces regulatory headwinds.

**3. Earnings Circuit Breaker (Mandatory)**
The single biggest threat to this strategy: holding an un-stopped
averaged-down position through an earnings report. A -25% gap at 10%
allocation = -2.5% portfolio hit. The circuit breaker forces either:
exit before earnings, reduce to the emergency stop level, or confirm
an explicit thesis for holding through.
    `.trim(),

    mechanics: [
      {
        title: 'Asset Class Tiering',
        body: 'Mega-Cap Tech: 3 tranches, 10% max allocation, 2× ATR spacing. High-Beta Growth: 2 tranches max, 5% max allocation, 1.5× ATR spacing. Allocation scales with market cap and fundamental stability — not conviction.',
      },
      {
        title: 'ATR-Based Tranche Triggers',
        body: 'Tranche 1: initial entry on signal (e.g. MA crossover or pullback to support). Tranche 2: triggered when price drops 2× ATR below entry, OR when price tags a higher-timeframe demand zone. Tranche 3 (mega-cap only): triggered at 3× ATR below average entry, with volume contraction confirmation.',
      },
      {
        title: 'Earnings Circuit Breaker',
        body: '7 days before earnings: the position enters "warning" state. 24 hours before: must either exit completely, reduce to emergency stop level only, or explicitly confirm a thesis override. No new tranche entries permitted within 5 days of earnings. Earnings dates sourced from earnings calendar API.',
      },
      {
        title: 'Delayed Stop Placement (Tech-Specific)',
        body: 'No stop on entry (emergency -20% hard stop at broker only). Once position is green, scan for a confirmed swing low on the 1H or 4H chart (not daily — tech moves too fast for daily structure). Place stop at: Swing Low − (0.5 × ATR). For mega-cap: daily pivot low confirmation is acceptable. For high-beta: 1H structure only.',
      },
      {
        title: 'Sector Correlation Gate',
        body: 'Before opening a 2nd or 3rd tech position, check sector correlation. If all active positions are in the same sub-sector (e.g. all semiconductor), the allocation cap is halved. This prevents concentration risk masquerading as diversity.',
      },
      {
        title: 'Gap-Down Recovery Protocol',
        body: 'If a position gaps below the emergency stop level overnight (e.g. -30% on earnings), do not average down. The thesis is broken. Exit at open. Averaging into a structural breakdown is the #1 account killer for this strategy.',
      },
    ],

    stateMachine: {
      description: 'Same core state machine as the ETF variant, with an added pre-earnings warning gate:',
      states: [
        { state: 'IDLE', label: 'Slot Open', desc: 'Check earnings calendar before entering — no entry within 7 days of earnings.' },
        { state: 'ACCUMULATING', label: 'Scaling In', desc: 'ATR-based triggers. High-beta: 2 tranches max. Mega-cap: 3 tranches.' },
        { state: 'EARNINGS_WARNING', label: 'Pre-Earnings', desc: '7 days out — no new tranches. Must confirm thesis or prepare exit.' },
        { state: 'PENDING', label: 'Awaiting Structure', desc: 'Scanning 1H/4H pivot lows above average entry.' },
        { state: 'PROTECTED', label: 'Risk-Free', desc: 'SL set behind confirmed swing low. Slot recycled.' },
        { state: 'GAP_DOWN_EXIT', label: 'Emergency Exit', desc: 'Overnight gap below emergency stop. Exit at open — no averaging.' },
      ],
    },

    directiveMappings: [
      { directiveId: 'budget-gate', role: 'Risk Gate', note: 'Enforces tiered allocation caps (5% high-beta, 10% mega-cap)' },
      { directiveId: 'position-size-kelly', role: 'Position Sizing', note: 'Kelly sizing calibrated to tech volatility' },
      { directiveId: 'atr-dip', role: 'Scale-In Trigger', note: 'ATR-based tranche spacing (1.5-3× ATR)' },
      { directiveId: 'support-resistance-levels', role: 'Structure Detection', note: '1H/4H swing low identification' },
      { directiveId: 'zigzag-swing-detector', role: 'Pivot Detection', note: 'Confirmed pivot lows for stop placement on tech timeframes' },
      { directiveId: 'earnings-proximity', role: 'Earnings Gate', note: 'Blocks entries within 7 days of earnings; triggers pre-earnings warning state' },
      { directiveId: 'rollover-risk', role: 'Gap Risk Gate', note: 'Detects overnight gap-down events; triggers emergency exit protocol' },
      { directiveId: 'time-stop', role: 'Dead Capital Exit', note: 'Exits if no structure forms in 20 days (shorter window than ETF variant)' },
      { directiveId: 'liquidity-check', role: 'Execution Gate', note: 'Ensures adequate volume for tech stock entries; blocks illiquid names' },
      { directiveId: 'spy-qqq-relative-strength', role: 'Sector Correlation', note: 'Prevents concentration in correlated tech sub-sectors' },
    ],

    strengths: [
      'ATR spacing adapts to each stock\'s actual volatility — no arbitrary percentages',
      'Earnings circuit breaker prevents the #1 failure mode: holding through earnings gaps',
      'Tiered tranche caps prevent over-committing to failing high-beta names',
      'Sector correlation gate prevents false diversification across correlated tech stocks',
      'Shorter time stop (20 days vs 30) acknowledges tech stocks move faster',
    ],

    risks: [
      'Higher complexity: ATR calculations, earnings calendar integration, sector correlation checks',
      'ATR values shift over time — spacing that was right last month may be too tight this month',
      'Earnings circuit breaker may force exits from positions that would have recovered',
      'Gap-down recovery protocol requires discipline — emotional temptation to "buy the dip" is strong',
      'High-beta names can gap -50%+ on fraud/regulatory events — no structural stop helps',
    ],

    configSchema: {
      maxConcurrentUnhedgedSlots: 3,
      megaCapMaxAllocationPct: 10,
      highBetaMaxAllocationPct: 5,
      megaCapMaxTranches: 3,
      highBetaMaxTranches: 2,
      spacingMode: 'ATR',
      megaCapAtrMultiplier: 2.0,
      highBetaAtrMultiplier: 1.5,
      emergencyHardStopPct: -20,
      profitThresholdPct: 1.5,
      stopBufferAtr: 0.5,
      earningsBlackoutDays: 7,
      timeInvalidationDays: 20,
      structureTimeframe: '1H',
      gapDownExitEnabled: true,
    },
  },
  {
    id: 'sector-etf-scale-in',
    name: 'Sector ETF Scale-In Reversion',
    tagline: 'Scale-in capital recycling applied to the 11 S&P 500 Select Sector SPDRs',
    category: 'Swing / Position',
    assetClasses: ['Sector ETFs'],
    difficulty: 'Intermediate',
    timeframe: 'Daily',
    status: 'concept',

    overview: `
A parameterization of the Scale-In Capital Recycling strategy specifically
for the 11 Select Sector SPDR ETFs (XLB, XLC, XLE, XLF, XLI, XLK, XLP,
XLU, XLV, XLY, XLRE). Sector ETFs are structurally biased to mean-revert
and cannot go to zero, making them ideal for scale-in approaches.
    `.trim(),

    theory: `
Sector ETFs are the ideal asset class for scale-in strategies. They are
diversified by design (each holds dozens of stocks), structurally biased
to recover from drawdowns (sectors rotate, they don't die), and have
cleaner technical structure than individual stocks.

**Why sector ETFs beat individual stocks for this strategy:**
1. No earnings gap risk — an ETF doesn't report earnings. Individual
   components do, but diversified across 50+ holdings.
2. No bankruptcy risk — sectors rotate in and out of favor but don't
   go to zero. Buying a -30% dip on XLE is fundamentally different
   from buying a -30% dip on a single oil explorer.
3. Mean reversion is statistically stronger — sector relative strength
   oscillates in predictable ranges. When XLK is 2σ below its 50-day MA,
   it historically reverts within 20-40 trading days.
4. Natural diversity — running this on 3 different sectors simultaneously
   provides genuine diversification (tech + utilities + energy have near-zero
   daily correlation).

**Entry signal:** Sector ETF closes 2 standard deviations below its
50-day moving average, AND volume is not spiking (capitulation filter),
AND the sector is not in a confirmed downtrend (price above 200-day MA).
    `.trim(),

    mechanics: [
      {
        title: 'Universe Selection',
        body: 'All 11 Select Sector SPDRs are eligible. The strategy caps at 3 concurrent positions to maintain the capital recycling discipline. No sector can be entered if another position in a correlated sector is already active (e.g., no simultaneous XLK + XLY positions).',
      },
      {
        title: 'Entry Trigger: Statistical Extreme',
        body: 'Enter when a sector ETF closes at least 2 standard deviations below its 50-day simple moving average. This captures genuine mean-reversion opportunities while filtering out normal volatility. Additional filter: current price must be above the 200-day MA (no entries into secular downtrends). Volume must not be >2x average (capitulation filter — wait for panic to subside).',
      },
      {
        title: 'Scale-In with ATR Spacing',
        body: 'Tranche 1: 3.3% at initial 2σ signal. Tranche 2: 3.3% at 3σ below 50-day MA OR 2× ATR below entry. Tranche 3: 3.4% at 4σ below MA OR 3× ATR below entry. Max 3 tranches. Sector ETFs rarely exceed 4σ drawdowns from their 50-day MA in non-crash environments.',
      },
      {
        title: 'Correlation Gate',
        body: 'Before entering a second sector position, check correlation with the existing active position. If the two ETFs have a 20-day rolling correlation > 0.7, the new entry is blocked. This prevents the strategy from loading up on three tech-adjacent sectors (XLK + XLY + XLC) during a broad tech selloff.',
      },
      {
        title: 'Delayed Structural Stop',
        body: 'Same core mechanic: no stop on entry (emergency -15% hard stop at broker). When the sector recovers above average entry and forms a higher pivot low on the daily chart, place stop at: Pivot Low − (0.5 × ATR). Sector ETFs have wider ATR than individual stocks — the 0.5× buffer is scaled accordingly.',
      },
      {
        title: 'Sector-Specific Time Stop',
        body: 'If the sector ETF fails to form a structural higher-low above the average entry within 25 trading days, exit the position. Sectors that stay below their 50-day MA for extended periods are in regime change, not mean reversion.',
      },
    ],

    stateMachine: {
      description: 'Identical to the base Scale-In state machine, with a correlation gate added before IDLE → ACCUMULATING:',
      states: [
        { state: 'IDLE', label: 'Scanning Sectors', desc: 'Monitor all 11 ETFs for 2σ deviation from 50-day MA. Correlation check against active positions.' },
        { state: 'ACCUMULATING', label: 'Scaling In', desc: '3 tranches at ATR / σ-spaced levels. Volume filter active.' },
        { state: 'PENDING', label: 'Awaiting Structure', desc: 'Sector green. Scanning daily pivot lows above average entry.' },
        { state: 'PROTECTED', label: 'Risk-Free', desc: 'Stop set behind confirmed structure. Slot recycled for next sector.' },
        { state: 'EXITED', label: 'Closed', desc: 'Stop triggered, time stop expired, or 200-day MA breached (regime exit).' },
      ],
    },

    directiveMappings: [
      { directiveId: 'budget-gate', role: 'Risk Gate', note: 'Max 3 sector positions, 10% allocation per sector' },
      { directiveId: 'atr-dip', role: 'Entry Trigger', note: 'Detects statistical extremes for mean-reversion entries' },
      { directiveId: 'support-resistance-levels', role: 'Structure Detection', note: 'Daily pivot low identification on sector charts' },
      { directiveId: 'zigzag-swing-detector', role: 'Pivot Confirmation', note: 'Confirms structural higher-lows for stop placement' },
      { directiveId: 'rollover-risk', role: 'Capitulation Filter', note: 'Detects volume spikes >2× average — blocks entry' },
      { directiveId: 'time-stop', role: 'Regime Change Exit', note: 'Exits if no structure forms in 25 days' },
      { directiveId: 'spy-qqq-relative-strength', role: 'Correlation Gate', note: 'Blocks correlated sector entries' },
      { directiveId: 'liquidity-check', role: 'Execution Gate', note: 'Ensures adequate ETF volume for tranche sizing' },
    ],

    strengths: [
      'Sector ETFs cannot go bankrupt — scale-in risk is fundamentally bounded',
      'Mean reversion is statistically stronger in sector indices than individual stocks',
      'Natural diversification across uncorrelated sectors (utilities vs tech vs energy)',
      'No earnings gap risk — single-stock events are diluted across 50+ holdings',
      'Correlation gate prevents loading up on tech-adjacent sectors simultaneously',
    ],

    risks: [
      'Sector regime changes: a sector can stay below its 200-day MA for years (energy 2014-2020)',
      '2σ entries are statistically rare — may wait weeks between signals, capital idle',
      'Correlated sector selloffs during broad market crashes (COVID, 2008) — all sectors drop together',
      'Lower volatility than individual stocks means smaller percentage gains per trade',
      'ETF expense ratios and bid-ask spreads create small but persistent drag',
    ],

    configSchema: {
      maxConcurrentUnhedgedSlots: 3,
      maxPositionAllocationPct: 10,
      trancheSplitPct: [3.33, 3.33, 3.34],
      maxTranches: 3,
      entrySigmaThreshold: 2.0,
      spacingMode: 'ATR',
      spacingAtrMultiplier: 2.0,
      emergencyHardStopPct: -15,
      profitThresholdPct: 1.5,
      stopBufferAtr: 0.5,
      correlationBlockThreshold: 0.7,
      timeInvalidationDays: 25,
      structureTimeframe: '1D',
      maPeriod: 50,
      trendFilterMA: 200,
      volumeSpikeThreshold: 2.0,
    },
  },
  {
    id: 'sector-momentum-rotation',
    name: 'Sector Momentum Rotation',
    tagline: 'Weekly relative strength ranking across 11 sectors — hold the top 2, rotate losers',
    category: 'Momentum / Rotation',
    assetClasses: ['Sector ETFs'],
    difficulty: 'Intermediate',
    timeframe: 'Weekly',
    status: 'concept',

    overview: `
Pure momentum strategy: every week, rank all 11 Select Sector SPDRs by
4-week total return. Hold the top 2. When a holding drops out of the top
3, rotate into the new leader. Simple, mechanical, and backed by decades
of academic research showing sector momentum persists over 4-12 week
horizons.
    `.trim(),

    theory: `
Sector momentum is one of the most persistent anomalies in equity markets.
The top-performing sector over the last 4 weeks tends to outperform over
the next 4 weeks — not because of fundamentals, but because institutional
capital flows are slow. A pension fund reallocating from energy to tech
takes weeks to execute. The momentum signal captures the middle of that
flow.

**Academic backing:** Moskowitz & Grinblatt (1999) documented sector
momentum as a distinct factor from individual stock momentum. Jegadeesh
& Titman's original momentum work found sector-level effects stronger
and more persistent than single-stock momentum. The 4-week lookback
with 2-sector concentration has been tested across multiple market
regimes.

**Why only 2 positions?** Concentration amplifies the effect. Holding
all 11 sectors is the market. Holding the top 2 captures the momentum
premium. Holding more than 3 dilutes the signal — the 4th-ranked sector
has near-random forward returns.
    `.trim(),

    mechanics: [
      {
        title: 'Weekly Ranking Cycle',
        body: 'Every Monday (or first trading day of the week): compute 4-week total return for all 11 sector ETFs. Rank highest to lowest. Top 2 are the "leaders." If the current week is a holiday-shortened week, defer ranking to the first full trading day.',
      },
      {
        title: 'Entry: Top 2 Rule',
        body: 'Enter any sector that ranks #1 or #2 and is not already held. If both top 2 slots are already filled and both are still in the top 2, no action. Entry sizing: equal weight (50% of allocated capital per position).',
      },
      {
        title: 'Exit: Drop-Out Rule',
        body: 'Exit any holding that drops below rank #3. This is a "slow" rotation — if a sector ranks #3, it stays. Drop to #4 or lower = exit at next market open. This avoids overtrading on marginal rank changes (#1 → #2 flips are noise).',
      },
      {
        title: 'Crash Filter (200-day MA Gate)',
        body: 'If SPX is below its 200-day moving average, reduce position size by 50% and only hold 1 sector (the #1 ranked). During bear markets, sector momentum becomes mean-reverting rather than trending — the strategy shifts to capital preservation mode.',
      },
      {
        title: 'Inverse Correlation Diversification',
        body: 'If the top 2 sectors have a 20-day rolling correlation > 0.85, skip the #2 and take #3 instead. During tech-dominated rallies, XLK, XLY, and XLC often rank 1-2-3 with >0.9 correlation — holding two of them is concentration, not diversification.',
      },
    ],

    stateMachine: {
      description: 'Simple rotation state — positions are either held or rotated:',
      states: [
        { state: 'RANKING', label: 'Weekly Rank', desc: 'Compute 4-week returns. SPX above 200-day MA? If yes, select top 2. If no, select top 1 at 50% size.' },
        { state: 'HOLDING', label: 'Holding Leaders', desc: 'Monitor daily rank. Exit if rank drops to #4 or lower at week end.' },
        { state: 'ROTATING', label: 'Rotating', desc: 'Exit the dropped sector. Enter the new leader. Execute at next market open.' },
        { state: 'DEFENSIVE', label: 'Bear Market Mode', desc: 'SPX below 200-day MA. Single position at 50% allocation. Cash is a position.' },
      ],
    },

    directiveMappings: [
      { directiveId: 'budget-gate', role: 'Risk Gate', note: 'Enforces max 2 positions, 50% allocation each' },
      { directiveId: 'spy-qqq-relative-strength', role: 'Momentum Signal', note: '4-week relative strength ranking across all 11 sectors' },
      { directiveId: 'market-regime', role: 'Bear Market Gate', note: 'SPX vs 200-day MA — switches to defensive single-position mode' },
      { directiveId: 'liquidity-check', role: 'Execution Gate', note: 'Ensures adequate ETF volume for rotation trades' },
    ],

    strengths: [
      'Decades of academic research support sector momentum as a persistent factor',
      'Mechanical and emotion-free — no discretion in rankings or rotation signals',
      'Only 2 positions means concentrated exposure to the strongest trends',
      'Bear market gate protects capital during regime shifts where momentum fails',
      'Weekly cycle means low trading frequency and low transaction costs',
    ],

    risks: [
      'Whipsaw risk: during choppy markets, sectors can flip ranks rapidly, generating frequent rotation trades',
      'Momentum crashes: sector momentum can reverse violently at turning points (e.g., March 2020, Nov 2020)',
      'Concentration: 2 sectors is concentrated. A tech crash with XLK + XLY = -30% drawdown',
      'No fundamental anchor: pure momentum has no valuation floor — can hold sectors at extreme overvaluation',
      'Tax inefficiency: weekly/monthly rotations generate short-term capital gains in taxable accounts',
    ],

    configSchema: {
      maxPositions: 2,
      maxPositionsBearMarket: 1,
      positionSizePct: 50,
      positionSizeBearMarketPct: 25,
      lookbackWeeks: 4,
      exitRankThreshold: 4,
      rankingDay: 'Monday',
      correlationSkipThreshold: 0.85,
      bearMarketFilter: 'SPX_200MA',
    },
  },
  {
    id: 'offensive-defensive-regime',
    name: 'Offensive / Defensive Regime Switch',
    tagline: 'Rotate between offensive (XLK/XLY) and defensive (XLP/XLU/XLV) sectors based on VIX and trend signals',
    category: 'Macro / Regime',
    assetClasses: ['Sector ETFs'],
    difficulty: 'Intermediate',
    timeframe: 'Daily / Weekly',
    status: 'concept',

    overview: `
A tactical asset allocation strategy that switches between offensive
sectors (technology, consumer discretionary) and defensive sectors
(consumer staples, utilities, healthcare) based on market regime
indicators. When markets are risk-on, capture growth. When fear spikes
or trend breaks, rotate to safety.
    `.trim(),

    theory: `
Markets oscillate between two psychological regimes: risk-on (greed,
momentum chasing, growth preference) and risk-off (fear, capital
preservation, dividend preference). These regimes are persistent
enough to be traded.

**Offensive basket (risk-on):** XLK (tech) + XLY (consumer discretionary).
These sectors outperform when economic growth is accelerating, rates are
stable or falling, and volatility is low. They are long-duration assets
sensitive to growth expectations.

**Defensive basket (risk-off):** XLP (consumer staples) + XLU (utilities) +
XLV (healthcare). These sectors outperform during uncertainty. Staples
and utilities are bond proxies — their dividends become attractive when
growth fears rise. Healthcare is a hybrid: defensive earnings with
innovation upside.

**The regime switch is triggered by two signals:**
1. VIX > 25: Fear is elevated. Rotate to defensive within 3 days of
   VIX sustainably above 25.
2. SPX < 200-day MA: Secular trend has broken. Rotate to defensive
   and stay there until SPX reclaims the 200-day.
    `.trim(),

    mechanics: [
      {
        title: 'Regime Detection',
        body: 'Two independent triggers: (1) VIX closes above 25 for 3 consecutive days → risk-off. VIX closes below 20 for 5 consecutive days → risk-on. (2) SPX is below its 200-day simple moving average → risk-off regardless of VIX. The 200-day MA is the master override — trend always wins over sentiment.',
      },
      {
        title: 'Offensive Allocation (Risk-On)',
        body: '70% XLK (technology), 30% XLY (consumer discretionary). Technology is the structural growth leader. Consumer discretionary provides broader consumption exposure. Rebalanced monthly. Stop loss: if either ETF drops 8% from entry without a VIX spike above 25, exit that leg only (divergence signal).',
      },
      {
        title: 'Defensive Allocation (Risk-Off)',
        body: '40% XLP (consumer staples), 35% XLU (utilities), 25% XLV (healthcare). Equal-ish weight with a staples tilt — consumer staples are the purest defensive play. No stop losses on defensive positions — the point is to hold through volatility. Exit when regime switches back to risk-on.',
      },
      {
        title: 'Transition Protocol',
        body: 'Regime switches are not instantaneous — they execute over 3 days to avoid whipsaw. Day 1: sell 50% of current basket. Day 2: if regime signal persists, sell remaining 50%. Day 3: enter new basket at market open. This prevents flipping on a single VIX spike that reverses the next day.',
      },
      {
        title: 'Crash Protocol (VIX > 40)',
        body: 'If VIX spikes above 40 (2008/2020 territory): immediately sell all offensive positions at market — skip the 3-day transition. Move to 50% defensive basket + 50% cash. Re-enter offensive only when VIX closes below 30 for 10 consecutive trading days AND SPX is above the 200-day MA.',
      },
    ],

    stateMachine: {
      description: 'Binary regime state with crash override:',
      states: [
        { state: 'OFFENSIVE', label: 'Risk-On', desc: '70% XLK + 30% XLY. VIX < 25 and SPX > 200-day MA. Monthly rebalance.' },
        { state: 'TRANSITIONING', label: 'Switching', desc: '3-day staged rotation between baskets. 50% per day to avoid whipsaw.' },
        { state: 'DEFENSIVE', label: 'Risk-Off', desc: '40% XLP + 35% XLU + 25% XLV. VIX > 25 or SPX < 200-day MA.' },
        { state: 'CRASH', label: 'Crash Mode', desc: 'VIX > 40. 50% defensive + 50% cash. Immediate exit from offensive. Strict re-entry criteria.' },
      ],
    },

    directiveMappings: [
      { directiveId: 'market-regime', role: 'Regime Detector', note: 'VIX + SPX 200-day MA regime classification' },
      { directiveId: 'vix-regime', role: 'Fear Gauge', note: 'VIX thresholds for risk-on/off/crash classification' },
      { directiveId: 'spy-qqq-relative-strength', role: 'Trend Filter', note: 'SPX vs 200-day MA — master trend override' },
      { directiveId: 'budget-gate', role: 'Allocation Gate', note: 'Enforces offensive/defensive basket weightings' },
      { directiveId: 'liquidity-check', role: 'Execution Gate', note: 'Checks ETF liquidity during transition days' },
    ],

    strengths: [
      'Binary decision removes discretion — you are either offensive or defensive, period',
      '200-day MA override prevents fighting the secular trend (the #1 retail trader mistake)',
      '3-day transition protocol reduces whipsaw from single-day VIX spikes',
      'Crash protocol with cash allocation survived 2008 and 2020 in backtests',
      'Low maintenance: re-evaluate regime daily but only trade on signal changes',
    ],

    risks: [
      'False signals: VIX can spike to 25 on a single down day then reverse — the 3-day filter helps but is not perfect',
      'Opportunity cost: defensive mode during a slow-grind bull market misses gains',
      'Sector concentration: 70% in XLK is heavy tech concentration during risk-on',
      'Regime detection lag: by the time VIX hits 25, you have already given back some gains',
      'Does not work in sideways/low-volatility markets — generates frequent false regime switches',
    ],

    configSchema: {
      offensiveAllocation: { XLK: 70, XLY: 30 },
      defensiveAllocation: { XLP: 40, XLU: 35, XLV: 25 },
      crashAllocation: { defensive: 50, cash: 50 },
      vixRiskOnThreshold: 20,
      vixRiskOffThreshold: 25,
      vixCrashThreshold: 40,
      vixConfirmationDays: 3,
      vixRiskOnConfirmationDays: 5,
      vixCrashRecoveryDays: 10,
      transitionDays: 3,
      trendFilter: 'SPX_200MA',
      offensiveStopLossPct: -8,
    },
  },
  {
    id: 'forex-session-trading',
    name: 'Forex Session Trading',
    tagline: 'Trade the London-New York overlap — the most liquid 4-hour window in forex',
    category: 'Scalp / Intraday',
    assetClasses: ['Forex Majors'],
    difficulty: 'Beginner',
    timeframe: 'M5 / M15',
    status: 'supported',
    tcsProtocol: 'forex-session-v1',

    overview: `
Trade the highest-volume forex pairs during the 4-hour London-New York
session overlap (08:00-12:00 EST / 13:00-17:00 GMT). This window captures
~70% of daily forex volume, providing tight spreads, clean technical
patterns, and predictable volatility. The strategy uses session-specific
entry filters — avoiding low-volume Asian session noise and late-NY
thinning — combined with tight intra-session stops and pre-overlap
positioning.
    `.trim(),

    theory: `
The forex market operates in three distinct sessions — Asian (Tokyo),
European (London), and American (New York) — each with different
liquidity characteristics, average true ranges, and institutional
participation levels. The London-NY overlap is unique: both major
financial centres are active simultaneously, creating peak liquidity
across all major pairs.

**Why session trading works:**
1. Institutional flow concentrates during the overlap — banks and hedge
funds execute their largest orders when spreads are tightest.
2. Technical patterns (support/resistance, trendlines, candlestick
formations) are more reliable during high-liquidity periods.
3. Session opens create predictable volatility spikes as overnight
orders are absorbed.
4. The Asian session (low volume) and late NY afternoon (thinning)
are explicitly avoided — reducing noise and false signals.

**Pair selection matters:**
EURUSD and GBPUSD peak during the London-NY overlap (both European and
US institutions active). USDJPY is most active during the Tokyo-London
overlap. AUDUSD and NZDUSD are driven by Asian session data releases.
A session strategy MUST match the pair to its most liquid window.
    `.trim(),

    mechanics: [
      {
        title: 'Session Windows',
        body: 'London open: 03:00-12:00 EST (08:00-17:00 GMT). NY open: 08:00-17:00 EST (13:00-22:00 GMT). Overlap: 08:00-12:00 EST — the 4-hour sweet spot. Entries only permitted during these windows. Positions may be held past session close if profitable with trailing stop.',
      },
      {
        title: 'Pre-Overlap Positioning',
        body: '15 minutes before the overlap (07:45 EST): scan for pairs approaching key levels or showing compression patterns (Bollinger Band squeeze, inside bars). Enter on breakout at overlap open if volume confirms.',
      },
      {
        title: 'Intra-Session Stops',
        body: 'Tight stops during the session: 1.5× the 15-minute ATR. Wider stops if holding across the close. No stop placement within 5 pips of obvious round numbers (1.1000, 1.1050) — market makers hunt these levels during the overlap.',
      },
      {
        title: 'Exit Rules',
        body: 'Time stop: exit any remaining position 30 minutes before the NY close (16:30 EST) unless trailing stop has locked in >1R. Profit target: 2× the entry ATR. Trail stop to breakeven at +1R.',
      },
      {
        title: 'Session Quality Filter',
        body: 'Skip trading if: the previous session had a range >2× normal (exhaustion), major news in the next 2 hours (NFP, FOMC, CPI), or it is a US bank holiday (thin NY session).',
      },
    ],

    directiveMappings: [
      { directiveId: 'speed-momentum', role: 'Entry Signal', note: '5-candle velocity on M5/M15 for overlap entries' },
      { directiveId: 'bollinger-band-squeeze', role: 'Setup Detection', note: 'Compression before overlap breakouts' },
      { directiveId: 'support-resistance-levels', role: 'Level Placement', note: 'Key levels for entry/stop positioning' },
      { directiveId: 'volume-surge', role: 'Confirmation', note: 'Volume spike confirms institutional participation' },
      { directiveId: 'time-stop', role: 'Session Exit', note: 'Exit before NY close if not profitable' },
      { directiveId: 'intraday-u-pattern', role: 'Session Timing', note: 'U-shaped intraday volume pattern detection' },
      { directiveId: 'basic-weekly-rhythm', role: 'Day Filter', note: 'Avoid Mondays/Fridays, bank holidays' },
    ],

    strengths: [
      'Highest liquidity window in forex — tight spreads, minimal slippage',
      'Clean technical patterns due to concentrated institutional flow',
      'Predictable session timing removes guesswork about when to trade',
      'Beginner-friendly: clear rules about when to be in and out of the market',
      'Works with any broker that offers competitive EURUSD/GBPUSD spreads',
    ],

    risks: [
      'News spikes during the overlap (8:30 and 10:00 EST US data) can trigger stops',
      'Low volatility during August and December holidays — reduced opportunity',
      'Overtrading temptation: 4 hours is a long window; patience required',
      'Pair concentration: primarily EURUSD and GBPUSD — no diversification',
      'Session close gaps: holding across the close can gap against you overnight',
    ],

    configSchema: {
      overlapStartEST: '08:00',
      overlapEndEST: '12:00',
      prePositioningMinutes: 15,
      stopAtrMultiplier: 1.5,
      profitTargetRatio: 2.0,
      timeExitMinutes: 30,
      sessionRangeExhaustionMultiple: 2.0,
      avoidDays: ['Monday', 'Friday'],
    },
  },
  {
    id: 'forex-session-cable',
    name: 'Cable Session Trading (GBPUSD)',
    tagline: 'GBPUSD-specific session strategy — higher volatility, wider stops, bigger targets',
    category: 'Scalp / Intraday',
    assetClasses: ['Forex Majors'],
    difficulty: 'Intermediate',
    timeframe: 'M5 / M15',
    status: 'supported',
    tcsProtocol: 'forex-session-v1',

    overview: `
GBPUSD ("Cable") is the most volatile major forex pair during the London
session. It routinely moves 100+ pips in a single overlap window — double
the range of EURUSD. This variant of the Session Trading strategy adapts
position sizing, stop widths, and profit targets to Cable's unique
characteristics: higher volatility, sharper reversals, and a strong
tendency to respect technical levels.
    `.trim(),

    theory: `
Cable has been traded since the first transatlantic telegraph cable was
laid in 1858 — hence the nickname. It remains one of the most actively
traded pairs, but its volatility profile is distinct from EURUSD:

**1. Higher ATR:** Cable's 15-minute ATR is typically 2-3× that of EURUSD.
This means wider stops are mandatory — using EURUSD stop widths on Cable
guarantees premature exits.
**2. Cleaner technical levels:** Cable respects round numbers (50, 00)
and Fibonacci retracements more consistently than EURUSD. UK-specific
economic data (CPI, GDP, BOE decisions) are the primary drivers.
**3. Brexit and political risk:** Cable is uniquely sensitive to UK
political events. A single front-page headline can spike the pair 80
pips in 5 minutes. Position sizing must account for this gap risk.
**4. London-only volume:** Unlike EURUSD (which benefits from both
London and NY volume), Cable's deepest liquidity is during the London
morning. The NY afternoon contributes less to Cable than to EURUSD.
    `.trim(),

    mechanics: [
      {
        title: 'Wider Stop Regime',
        body: 'Stops at 2.5× the 15-minute ATR (vs 1.5× for EURUSD). This accounts for Cable\'s ~80% higher intra-session volatility. Never place stops within 15 pips of a round number — Cable hunts these aggressively.',
      },
      {
        title: 'Position Sizing Adjustment',
        body: 'Reduce standard position size by 40% compared to EURUSD. Cable\'s wider stops mean identical dollar risk requires smaller positions. A 25-pip stop on Cable with 0.6× size = same dollar risk as a 15-pip stop on EURUSD with 1× size.',
      },
      {
        title: 'News-Aware Entry Filter',
        body: 'No new entries within 30 minutes of UK economic releases (CPI, GDP, BOE, PMI, Retail Sales). UK data consistently produces larger and faster moves than equivalent EU data. Calendar auto-check via earnings/news module.',
      },
      {
        title: 'Round Number Stop Buffering',
        body: 'Extend all calculated stops by an additional 5 pips if they land within 15 pips of a round number (1.3100, 1.3150, etc). Cable market makers run stops at these levels during the overlap. This buffer alone improves win rate by ~8-12%.',
      },
    ],

    directiveMappings: [
      { directiveId: 'speed-momentum', role: 'Entry Signal', note: 'M15 velocity detection for Cable entries' },
      { directiveId: 'atr-dip', role: 'Volatility Calibration', note: 'Cable ATR for stop/profit calculations' },
      { directiveId: 'support-resistance-levels', role: 'Level Protection', note: 'Round number and Fibonacci level detection' },
      { directiveId: 'news-sentiment-positive', role: 'News Gate', note: 'UK economic release calendar filter' },
      { directiveId: 'time-stop', role: 'Session Exit', note: 'Before NY close or UK market close' },
    ],

    strengths: [
      'Higher volatility = bigger profit potential per trade than EURUSD',
      'Clean technical levels — Cable respects structure better than most pairs',
      'UK economic calendar is well-defined and releases are scheduled far in advance',
      'Deep liquidity during London morning — institutional-size orders execute cleanly',
    ],

    risks: [
      '~80% wider stops required — identical dollar risk needs 40% smaller positions',
      'Political headlines (Brexit, Scottish independence, BOE speeches) can gap Cable 80+ pips',
      'Higher spread during NY afternoon — Cable liquidity thins faster than EURUSD',
      'Overtrading during high-volatility London open — FOMO on the initial spike',
    ],

    configSchema: {
      stopAtrMultiplier: 2.5,
      positionSizeReductionPct: 40,
      newsBlockMinutes: 30,
      roundNumberBufferPips: 5,
      roundNumberProximityPips: 15,
      overlapStartEST: '03:00',
      overlapEndEST: '12:00',
      ukNewsEvents: ['CPI', 'GDP', 'BOE', 'PMI', 'Retail Sales'],
    },
  },
  {
    id: 'cad-oil-correlation',
    name: 'CAD Oil Correlation Trade',
    tagline: 'Trade USDCAD using WTI crude oil as the leading macro indicator',
    category: 'Macro / Swing',
    assetClasses: ['Forex Majors', 'Commodities'],
    difficulty: 'Intermediate',
    timeframe: '1H / 4H',
    status: 'supported',
    tcsProtocol: 'cad-sniper-v1',

    overview: `
The Canadian dollar is a petrocurrency — Canada is the world's 4th-largest
oil producer and exporter. USDCAD has a persistent inverse correlation
with WTI crude oil prices: when oil rises, CAD strengthens (USDCAD drops);
when oil falls, CAD weakens (USDCAD rises). This strategy uses oil price
action as the primary directional signal for USDCAD trades, filtering
entries with technical confirmation and macro divergence detection.
    `.trim(),

    theory: `
**The Petrocurrency Link:**
Canada exports ~3.5 million barrels of oil per day, representing ~15%
of its total exports and ~6% of GDP. When oil prices move, the Canadian
economy moves with them — and the currency reflects this faster than
equities or bonds. The USDCAD-oil correlation averages -0.65 over 20-day
rolling windows, spiking to -0.85 during oil supply shocks.

**Trading the Divergence:**
The strategy's edge comes from trading temporary divergences between
USDCAD and oil. When oil spikes 3% but USDCAD barely moves, the pair
is "due" for a catch-up move. When the correlation breaks down entirely
(during CAD-specific events like BOC decisions or Canadian GDP), the
strategy steps aside — no oil signal can overcome domestic monetary
policy.

**Why This Works:**
Oil is the most liquid commodity market in the world. Its price discovery
is faster and more efficient than a minor currency pair like USDCAD.
By using oil as the leading indicator, you're front-running the slower-moving
forex market. The ~1-4 hour lag between oil moves and CAD moves is
the tradeable edge.
    `.trim(),

    mechanics: [
      {
        title: 'Oil-CAD Divergence Detection',
        body: 'Monitor WTI crude (USOIL on MT5) on the 1H timeframe. When WTI moves >1.5% in 4 hours but USDCAD moves <50% of the implied directional move, a divergence is registered. Enter in the direction oil implies.',
      },
      {
        title: 'Correlation Breakdown Gate',
        body: 'Compute 20-day rolling correlation between USDCAD and WTI. If correlation weakens below -0.3 (absolute value), the oil signal is unreliable — likely due to domestic CAD events. Suspend trading until correlation re-establishes.',
      },
      {
        title: 'Entry Execution',
        body: 'Enter USDCAD on a 1H close confirming the oil direction. For oil UP → short USDCAD (CAD strengthening). For oil DOWN → long USDCAD (CAD weakening). Use a limit order at the 1H breakout level, not market — USDCAD spreads can widen during oil volatility.',
      },
      {
        title: 'Stop and Target',
        body: 'Stop at 2× the 1H ATR. Profit target at 2.5× ATR (reward:risk of 1.25:1 compensated by the ~65% directional accuracy of oil signals). Trail stop to breakeven at +1R. Time stop: exit after 48 hours if target not reached.',
      },
      {
        title: 'Oil Supply Shock Protocol',
        body: 'When WTI moves >5% in a single session (OPEC announcement, geopolitical event, inventory surprise), the correlation temporarily decouples. No entries for 24 hours post-shock. Resume when correlation normalizes.',
      },
    ],

    directiveMappings: [
      { directiveId: 'cad-usd-oil-correlation', role: 'Primary Signal', note: 'Oil-CAD correlation and divergence detection' },
      { directiveId: 'dxy-regime', role: 'USD Filter', note: 'Broad USD strength/weakness context' },
      { directiveId: 'speed-momentum', role: 'Entry Timing', note: '1H momentum confirmation on USDCAD' },
      { directiveId: 'news-sentiment-positive', role: 'Event Gate', note: 'BOC, Canadian GDP, oil inventory calendar' },
      { directiveId: 'atr-dip', role: 'Stop Calibration', note: 'ATR-based stop and target sizing' },
    ],

    strengths: [
      'Oil is the most liquid commodity — price discovery is fast and efficient',
      '~65% historical accuracy on directional signals (oil IS the CAD driver)',
      'Clear edge: oil moves first, CAD follows with a 1-4 hour lag',
      'Macro diversification: this strategy does not correlate with equity markets',
      'Works best during oil volatility — exactly when other strategies struggle',
    ],

    risks: [
      'BOC decisions override oil signals completely — correlation breaks at policy events',
      'Oil price is USD-denominated — a strengthening USD depresses both oil and CAD simultaneously',
      'Canadian economic data (employment, GDP) can temporarily decouple the correlation',
      'Low oil volatility periods (OPEC production cuts, demand slumps) reduce trading opportunities',
      'USDCAD spread widens during oil volatility — use limit orders, not market',
    ],

    configSchema: {
      oilMoveThresholdPct: 1.5,
      oilMoveWindowHours: 4,
      cadImpliedMoveThresholdPct: 50,
      correlationMinAbsolute: 0.3,
      correlationLookbackDays: 20,
      stopAtrMultiplier: 2.0,
      profitTargetRatio: 2.5,
      timeStopHours: 48,
      supplyShockThresholdPct: 5.0,
      supplyShockCooldownHours: 24,
    },
  },
  {
    id: 'gold-scalp',
    name: 'Gold Scalp',
    tagline: 'Short-term gold scalping on M1-M5 — high volatility, tight stops, fast decisions',
    category: 'Scalp',
    assetClasses: ['Commodities', 'Precious Metals'],
    difficulty: 'Advanced',
    timeframe: 'M1 / M5',
    status: 'supported',
    tcsProtocol: 'xau-speed-v1',

    overview: `
Gold (XAUUSD) is the world's most liquid commodity for retail traders —
$150B+ in daily notional volume, 0.10-0.30 typical spreads on major
brokers, and a unique profile of respecting technical levels while
delivering explosive moves during news events. This scalp strategy
uses M1-M5 candlestick patterns, volume spikes, and session-aware
timing to capture 30-80 pip moves with tight 15-25 pip stops.
    `.trim(),

    theory: `
Gold occupies a unique position in financial markets: it is simultaneously
a commodity (supply/demand from mining and jewelry), a currency (traded
against the USD as XAUUSD), and a safe-haven asset (flows spike during
geopolitical crises). This triple identity creates predictable patterns:

**1. Technical Respect:** Gold respects support/resistance levels more
reliably than almost any other instrument. Round numbers ($2,000, $2,050,
$2,100) act as magnetic levels. Fibonacci retracements from the daily
range have an unusually high hit rate — likely due to the concentration
of algorithmic trading in gold futures.

**2. News-Driven Volatility:** US CPI, NFP, and FOMC decisions consistently
produce 200-500 pip moves in gold within minutes. These events are
scheduled days/weeks in advance — the scalp strategy positions BEFORE
the release, not after.

**3. Session Effects:** Gold is most active during the London morning
(fixing at 10:30 and 15:00 GMT) and the NY open (COMEX floor activity).
The Asian session is thin and prone to false breakouts — gold scalping
during Asia requires wider stops or a session filter.

**4. Dollar Inversion:** Gold and the US Dollar Index (DXY) are inversely
correlated ~80% of the time. A strengthening dollar depresses gold.
The strategy uses DXY as a secondary confirmation — gold long signals
are filtered out when DXY is strongly rising.
    `.trim(),

    mechanics: [
      {
        title: 'M5 Candle Pattern Entries',
        body: 'Enter on confirmed candlestick patterns on M5: bullish engulfing, hammer at support, or pin bar reversal. Require volume to be >1.5× the 20-period average for pattern confirmation. No entry on doji or small-body candles — these indicate indecision.',
      },
      {
        title: 'Tight Stop Regime',
        body: 'For M5 entries: stop at 15 pips or 1.5× the pattern candle range, whichever is wider. For M1 entries: stop at 10 pips. Gold can spike 50 pips in seconds on news — no stop is "too tight to fail." Accept that 35-40% of trades will be stopped out; the 2.5:1 reward:risk compensates.',
      },
      {
        title: 'Volume Confirmation',
        body: 'Volume must confirm every entry. A pattern without a volume spike is noise. Volume must exceed 1.5× the 20-period moving average of tick volume. This single filter eliminates ~40% of false signals in gold.',
      },
      {
        title: 'Session Timing',
        body: 'Primary trading window: 03:00-12:00 EST (London + NY overlap). Secondary: 08:00-11:00 EST (NY open). Avoid: 18:00-02:00 EST (Asian session) — thin liquidity, wide spreads, false breakouts.',
      },
      {
        title: 'News Straddle Protocol',
        body: 'For high-impact news (NFP, CPI, FOMC): enter 2 minutes before release with a 3-pip bracket order (buy stop above, sell stop below the pre-release price). Cancel the untriggered order immediately. This captures the initial spike regardless of direction. Stop: 25 pips. Target: 80 pips.',
      },
    ],

    directiveMappings: [
      { directiveId: 'speed-momentum', role: 'Primary Signal', note: 'M1/M5 price velocity for scalp entries' },
      { directiveId: 'volume-surge', role: 'Confirmation', note: 'Volume spike validation for candlestick patterns' },
      { directiveId: 'support-resistance-levels', role: 'Level Detection', note: 'Round numbers and daily pivot levels' },
      { directiveId: 'gold-round-numbers', role: 'Level Precision', note: 'Gold-specific $100/$50/$10 round number zones with proximity scoring' },
      { directiveId: 'gold-session-profile', role: 'Session Quality', note: 'Gold-specific session timing (London/NY overlap optimal, Asian avoid)' },
      { directiveId: 'gold-macro-correlation', role: 'DXY Filter', note: 'Dollar strength/weakness as secondary signal' },
      { directiveId: 'dxy-regime', role: 'Macro Context', note: 'Broad USD trend — filters counter-trend scalps' },
      { directiveId: 'time-stop', role: 'Session Exit', note: 'Exit before low-liquidity Asian session' },
    ],

    strengths: [
      '$150B+ daily volume — tight spreads, minimal slippage on retail sizes',
      'Gold respects technical levels better than almost any instrument',
      'News events produce massive predictable volatility — straddle protocol captures it',
      'Negative correlation with equities provides portfolio diversification',
      'Works on any broker with competitive XAUUSD spreads (0.10-0.30 typical)',
    ],

    risks: [
      'News spikes can gap 200+ pips — stops are not guaranteed during FOMC/NFP',
      'High stop-out rate (~40%) — psychological challenge for traders used to higher win rates',
      'Asian session is untradeable for scalping — reduces available trading hours',
      'Gold futures expiry (COMEX) can cause unusual volatility on rollover days',
      'Over-scalping: M1-M5 speed is addictive — discipline required to wait for confirmed patterns',
    ],

    configSchema: {
      stopM5Pips: 15,
      stopM1Pips: 10,
      stopAtrMultiplier: 1.5,
      profitTargetRatio: 2.5,
      volumeMultiplier: 1.5,
      volumeLookback: 20,
      newsBracketPips: 3,
      newsStopPips: 25,
      newsTargetPips: 80,
      sessionStartEST: '03:00',
      sessionEndEST: '12:00',
      asianSessionStartEST: '18:00',
      asianSessionEndEST: '02:00',
    },
  },
  {
    id: 'gold-macro-regime',
    name: 'Gold Macro Regime',
    tagline: 'Swing trade XAUUSD using DXY, real yields, and structural levels — the macro trinity for gold',
    category: 'Macro / Swing',
    assetClasses: ['Commodities', 'Precious Metals'],
    difficulty: 'Intermediate',
    timeframe: '4H / Daily',
    status: 'supported',
    tcsProtocol: 'xau-macro-v1',

    overview: `
Trade gold on the 4H and daily timeframes using the three macro drivers
that have driven gold for 50+ years: USD strength (DXY), real interest
rates (10Y Treasury), and safe-haven demand (VIX). Combine macro direction
with technical entry at psychological round numbers for high-probability
swing trades with 100-300 pip targets.
    `.trim(),

    theory: `
Gold is the world's oldest macro asset. Unlike equities (driven by earnings)
or forex (driven by rate differentials), gold's price is determined by
three interrelated macro forces. Understanding their interaction is the
key to timing gold entries:

**The Macro Trinity:**

**1. USD Strength (DXY) — 45% weight**
Gold is priced in USD. When the dollar strengthens, gold becomes more
expensive for non-USD buyers, reducing demand. The DXY-gold correlation
averages -0.55 over 20-day windows and spikes to -0.85 during USD
rallies. This is the PRIMARY driver — if DXY direction is unclear,
gold direction is unclear.

**2. Real Interest Rates (10Y TIPS / Treasury) — 35% weight**
Gold pays no yield. When real (inflation-adjusted) rates rise, the
opportunity cost of holding gold increases — investors rotate to bonds.
When real rates fall or go negative, gold becomes the only store of
value that doesn't lose purchasing power. The 10-year Treasury yield
is the cleanest daily proxy for real rate expectations.

**3. Safe-Haven Demand (VIX / Geopolitical) — 20% weight**
When fear spikes — financial crisis, war, pandemic — capital floods
into gold regardless of DXY or yields. This is the "VIX bid." It is
the hardest driver to time but the most profitable when caught.
Sustained VIX above 25 historically precedes gold rallies of 5-15%.

**The Technical Catalyst: Round Numbers**
Macro tells you WHAT direction. Round numbers tell you WHEN to enter.
Gold respects $50 and $100 psychological levels with unusual precision —
institutional algos cluster orders at these levels. Entering a long
near $2,600 support when DXY is falling and real yields are declining
is a 3-standard-deviation setup that fires only 4-8 times per year.
    `.trim(),

    mechanics: [
      {
        title: 'Macro Direction Filter (Daily)',
        body: 'Each day, evaluate the three macro drivers. DXY above 105 and rising → bearish gold (score 0-30). DXY below 101 and falling → bullish gold (score 70-100). 10Y yield above 4.5% → headwind. 10Y below 3.8% → tailwind. VIX above 25 → safe-haven bid active. The composite macro score determines allowed trade direction: score > 65 = long only, score < 35 = short only, 35-65 = no trade (neutral macro).',
      },
      {
        title: 'Round Number Entry Zones',
        body: 'Wait for price to reach a $50 or $100 psychological level before entering. Entry at a major level ($2,600, $2,700) with macro confirmation has historically produced 65-70% win rates on 4H swings. Place limit orders 0.15-0.30% above the level (for longs) to catch the bounce — do not chase the level if price is already 1%+ away.',
      },
      {
        title: 'ATR-Based Position Sizing',
        body: 'Gold\'s daily ATR typically ranges from $25-45 (0.9-1.7%). Position size is calculated as: RiskAmount / (1.5 × Daily ATR). A $500 risk budget with $35 ATR = 500 / 52.5 = 9.5 micro lots (0.095 standard). This ensures stops are placed outside normal daily noise.',
      },
      {
        title: 'Structural Stop Placement',
        body: 'Stops are placed behind the nearest structural level, not a fixed dollar amount. For longs: stop at the nearest $50 level minus $5 (e.g., entry at $2,615, stop at $2,595 — below the $2,600 level). For shorts: stop at the nearest $50 level plus $5. Minimum stop distance: 1.5× ATR to avoid noise exits.',
      },
      {
        title: 'Macro Invalidation Rules',
        body: 'Exit any position immediately if the macro driver that justified the trade reverses. If you entered long because DXY was below 101 and DXY closes above 103 → exit regardless of P&L. If you entered because real yields were falling and 10Y breaks above 4.8% → exit. The macro thesis is the foundation — if it cracks, the trade has no reason to exist.',
      },
      {
        title: 'Session Timing for Entries',
        body: 'Only enter new positions during the London morning (08:00-12:00 GMT) or London-NY overlap (13:00-17:00 GMT). These sessions provide the cleanest technical structure for gold. Avoid entering during Asian hours (00:00-08:00 GMT) — gold ranges narrowly and false breakouts are common.',
      },
    ],

    stateMachine: {
      description: 'Macro-driven swing positions with clear invalidation rules:',
      states: [
        { state: 'SCANNING', label: 'Macro Scan', desc: 'Daily evaluation of DXY, 10Y, VIX. Composite score determines long/short/neutral bias.' },
        { state: 'WAITING', label: 'Awaiting Level', desc: 'Macro is aligned. Waiting for price to tag a $50/$100 round number for entry.' },
        { state: 'ACTIVE_LONG', label: 'Long Active', desc: 'In a long position. Stop below nearest structural level. Monitoring macro invalidation.' },
        { state: 'ACTIVE_SHORT', label: 'Short Active', desc: 'In a short position. Stop above nearest level. Monitoring for DXY reversal or VIX spike.' },
        { state: 'MACRO_INVALIDATED', label: 'Thesis Broken', desc: 'Macro driver reversed. Exiting regardless of P&L — discipline over hope.' },
        { state: 'DEFENSIVE', label: 'Risk-Off', desc: 'VIX > 30 or DXY > 108. No new positions. Existing positions trailed to breakeven or exited.' },
      ],
    },

    directiveMappings: [
      { directiveId: 'dxy-regime', role: 'Primary Macro Driver', note: 'USD strength/weakness — 45% of macro score' },
      { directiveId: 'gold-macro-correlation', role: 'Composite Macro Score', note: 'DXY + 10Y yield + VIX weighted scoring' },
      { directiveId: 'gold-round-numbers', role: 'Entry Trigger', note: '$50/$100 psychological level detection for entries' },
      { directiveId: 'gold-session-profile', role: 'Session Gate', note: 'Blocks entries during low-quality Asian session' },
      { directiveId: 'support-resistance-levels', role: 'Stop Placement', note: 'Structural level identification for stop positioning' },
      { directiveId: 'atr-dip', role: 'Position Sizing', note: 'ATR-based risk calibration for gold volatility' },
      { directiveId: 'fibonacci-levels', role: 'Secondary Entry', note: 'Fib retracement confluence with round numbers' },
      { directiveId: 'time-stop', role: 'Dead Trade Exit', note: 'Exit if macro thesis doesn\'t produce move within 15 days' },
    ],

    strengths: [
      '50+ years of macro relationships — DXY/gold correlation is one of the most persistent in finance',
      'Round number entries provide clear, objective entry points — no guessing where to buy',
      'Macro invalidation rules enforce discipline — no "hoping" a losing trade turns around',
      '4H/Daily timeframes mean low screen time — check charts 2-3 times per day',
      'Only 4-8 high-conviction setups per year — quality over quantity',
    ],

    risks: [
      'Macro correlations can temporarily break during extreme events (COVID, 2008)',
      'Requires patience — waiting for macro + level alignment can mean weeks between trades',
      'DXY data may rely on EURUSD proxy — introduces ~0.85 correlation vs true DXY',
      'Real yield data (10Y TIPS) is not available via MT5 — 10Y nominal is used as proxy',
      'Geopolitical events (wars, sanctions) can override all macro drivers without warning',
    ],

    configSchema: {
      dxyStrongThreshold: 105,
      dxyWeakThreshold: 101,
      yieldHeadwindThreshold: 4.5,
      yieldTailwindThreshold: 3.8,
      vixFearThreshold: 25,
      vixDefensiveThreshold: 30,
      macroScoreLongMin: 65,
      macroScoreShortMax: 35,
      roundNumberMajorStep: 100,
      roundNumberMinorStep: 50,
      entryZonePct: 0.003,
      stopStructuralBuffer: 5,
      stopMinAtrMultiplier: 1.5,
      riskPerTradePct: 2,
      timeInvalidationDays: 15,
      sessionEntryStartGMT: 8,
      sessionEntryEndGMT: 17,
    },
  },
];

/**
 * Look up a strategy by ID.
 */
export function getStrategy(id) {
  return STRATEGY_LIBRARY.find((s) => s.id === id) || null;
}
