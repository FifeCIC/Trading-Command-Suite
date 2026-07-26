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
];

/**
 * Look up a strategy by ID.
 */
export function getStrategy(id) {
  return STRATEGY_LIBRARY.find((s) => s.id === id) || null;
}
