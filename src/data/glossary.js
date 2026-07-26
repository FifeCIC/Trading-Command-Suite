/**
 * Trading Glossary
 * ================
 * Beginner-friendly definitions for trading jargon used throughout the app.
 * Used by GlossaryLink/GlossaryPopover to render inline hover tooltips.
 *
 * Each entry:
 *   term       — the exact word/phrase as it appears in text (case-insensitive matching)
 *   definition — plain-language explanation (1-3 sentences)
 *   category   — optional grouping for glossary index page
 *   aliases    — alternative forms of the term (e.g. "ATR" → "Average True Range")
 */

const GLOSSARY = [
  // ── Price Action ──
  {
    term: 'pullback',
    definition: 'A temporary move against the main trend. Think of it as the market "pulling back" like a slingshot before continuing in the original direction.',
    category: 'Price Action',
    aliases: ['pullbacks', 'pull back', 'retracement'],
  },
  {
    term: 'retracement',
    definition: 'See pullback — a short-term reversal within a larger trend.',
    category: 'Price Action',
    aliases: ['retracements'],
  },
  {
    term: 'recent high',
    definition: 'The highest price a symbol has reached over a given lookback period (e.g. 20 bars). Used as a reference point to measure how far price has fallen.',
    category: 'Price Action',
    aliases: ['recent highs', 'swing high', 'peak'],
  },
  {
    term: 'recent low',
    definition: 'The lowest price a symbol has reached over a given lookback period. Used as a reference for bounce/breakdown signals.',
    category: 'Price Action',
    aliases: ['recent lows', 'swing low', 'trough'],
  },
  {
    term: 'breakout',
    definition: 'When price moves decisively above a resistance level or below a support level, often with increased volume. Signals a potential new trend.',
    category: 'Price Action',
    aliases: ['breakouts', 'break out'],
  },
  {
    term: 'support',
    definition: 'A price level where buying interest has historically been strong enough to stop the price from falling further. Think of it as a "floor."',
    category: 'Price Action',
    aliases: ['support level', 'support zone'],
  },
  {
    term: 'resistance',
    definition: 'A price level where selling pressure has historically been strong enough to stop the price from rising further. Think of it as a "ceiling."',
    category: 'Price Action',
    aliases: ['resistance level', 'resistance zone'],
  },

  // ── Indicators ──
  {
    term: 'ATR',
    definition: 'Average True Range — measures market volatility by averaging the true range over a set number of periods. Higher ATR = more volatile (larger price swings). Used to normalize other indicators so they work across different symbols.',
    category: 'Indicators',
    aliases: ['Average True Range', 'atr', 'true range'],
  },
  {
    term: 'ATR-normalized',
    definition: 'A value divided by ATR so it can be compared across different symbols. Without normalization, a $1 move in a $20 stock means something very different than a $1 move in a $500 stock.',
    category: 'Indicators',
    aliases: ['ATR normalized', 'atr-normalized'],
  },
  {
    term: 'RSI',
    definition: 'Relative Strength Index — an oscillator (0–100) that measures the speed of price moves. Above 70 = potentially overbought (price may drop). Below 30 = potentially oversold (price may rise).',
    category: 'Indicators',
    aliases: ['Relative Strength Index', 'rsi'],
  },
  {
    term: 'MACD',
    definition: 'Moving Average Convergence Divergence — a trend-following indicator that shows the relationship between two moving averages. A signal line crossover can indicate a trend change.',
    category: 'Indicators',
    aliases: ['macd', 'Moving Average Convergence Divergence'],
  },
  {
    term: 'moving average',
    definition: 'The average price over a set number of bars, recalculated as each new bar forms. Smooths out price noise to show the underlying trend. Common periods: 20 (short-term), 50 (medium), 200 (long-term).',
    category: 'Indicators',
    aliases: ['MA', 'moving averages', 'SMA', 'EMA', 'simple moving average', 'exponential moving average'],
  },
  {
    term: 'volume',
    definition: 'The number of shares/contracts traded during a given period. High volume confirms the strength of a move; low volume suggests weak conviction.',
    category: 'Indicators',
    aliases: ['trading volume', 'vol'],
  },
  {
    term: 'Bollinger Bands',
    definition: 'A volatility indicator: a middle moving average line with upper and lower bands set 2 standard deviations away. Price near the upper band = potentially overextended upward. Near the lower band = potentially overextended downward.',
    category: 'Indicators',
    aliases: ['bollinger bands', 'BB', 'Bollinger'],
  },
  {
    term: 'oscillator',
    definition: 'An indicator that moves between two extreme values (e.g. 0–100). Oscillators help identify overbought/oversold conditions and potential reversals.',
    category: 'Indicators',
    aliases: ['oscillators'],
  },

  // ── Scoring ──
  {
    term: 'composite score',
    definition: 'A combined score from multiple directive calculations, weighted and summed into a single number. Think of it as a "grade" for how well the current setup matches your strategy rules.',
    category: 'Scoring',
    aliases: ['composite', 'composite scoring', 'SEES score'],
  },
  {
    term: 'directive',
    definition: 'A single scoring rule that evaluates one specific aspect of a trading setup (e.g. "is the pullback deep enough?", "is the trend healthy?"). Each directive returns a score; they combine into a composite.',
    category: 'Scoring',
    aliases: ['directives', 'scoring directive', 'scoring directives'],
  },
  {
    term: 'SEES',
    definition: 'Strategy Execution & Evaluation System — the core scoring engine that runs directives against market data and produces composite scores for each symbol/protocol combination.',
    category: 'Scoring',
    aliases: ['SEES score', 'SEES scoring', 'Strategy Execution & Evaluation System'],
  },
  {
    term: 'max score',
    definition: 'The highest possible score a directive can award. The actual score is divided by max score to get a percentage. Not all setups will reach max — it represents ideal conditions.',
    category: 'Scoring',
    aliases: ['maxScore', 'max possible', 'maximum score'],
  },
  {
    term: 'direction bias',
    definition: 'Whether a directive favors long (buy) or short (sell) positions. Neutral means it works for both directions. A directive with bullish bias will score long setups higher.',
    category: 'Scoring',
    aliases: ['direction', 'bias', 'directional bias'],
  },
  {
    term: 'signal class',
    definition: 'The category of trading signal produced: bullish (favor buying), bearish (favor selling), or neutral (no directional opinion). Derived from the composite score and direction bias.',
    category: 'Scoring',
    aliases: ['signal', 'signal classification'],
  },

  // ── Risk ──
  {
    term: 'drawdown',
    definition: 'The decline from a peak to a trough in your account value, usually expressed as a percentage. A 10% drawdown means your account dropped 10% from its highest point. Key risk metric.',
    category: 'Risk',
    aliases: ['drawdowns', 'max drawdown', 'maximum drawdown'],
  },
  {
    term: 'position size',
    definition: 'How much capital you allocate to a single trade. Proper position sizing ensures no single trade can significantly damage your account if it goes wrong.',
    category: 'Risk',
    aliases: ['position sizing', 'lot size'],
  },
  {
    term: 'stop loss',
    definition: 'A pre-set price level where a losing trade is automatically closed. Your "exit door" — limits how much you can lose on any single trade.',
    category: 'Risk',
    aliases: ['stop-loss', 'SL', 'stop', 'protective stop'],
  },
  {
    term: 'take profit',
    definition: 'A pre-set price level where a winning trade is automatically closed to lock in gains. Your "cash-out" point.',
    category: 'Risk',
    aliases: ['take-profit', 'TP', 'profit target'],
  },
  {
    term: 'risk-reward ratio',
    definition: 'The amount you stand to gain vs. lose on a trade. A 1:2 ratio means you risk $1 to potentially make $2. Higher ratios are generally better.',
    category: 'Risk',
    aliases: ['R:R', 'risk/reward', 'risk reward', 'RRR'],
  },

  // ── Market Structure ──
  {
    term: 'trend',
    definition: 'The general direction the market is moving. Uptrend = higher highs and higher lows. Downtrend = lower highs and lower lows. "The trend is your friend" — trading with the trend has higher odds.',
    category: 'Market Structure',
    aliases: ['trends', 'trending', 'uptrend', 'downtrend'],
  },
  {
    term: 'momentum',
    definition: 'The rate of acceleration of price — how quickly prices are changing. Strong momentum = prices moving fast in one direction. Weak momentum = sluggish or choppy movement.',
    category: 'Market Structure',
    aliases: ['price momentum', 'mom'],
  },
  {
    term: 'volatility',
    definition: 'How much and how quickly prices move. High volatility = large price swings (more risk AND opportunity). Low volatility = quiet, range-bound markets.',
    category: 'Market Structure',
    aliases: ['volatile', 'market volatility', 'price volatility'],
  },
  {
    term: 'range',
    definition: 'A period where price bounces between a clear high and low without trending. Range-bound markets favor mean-reversion strategies.',
    category: 'Market Structure',
    aliases: ['trading range', 'range-bound', 'range bound', 'consolidation'],
  },
  {
    term: 'correlation',
    definition: 'How closely two symbols move together. Positive correlation (+0.8) = they tend to move in the same direction. Negative correlation (-0.5) = they tend to move opposite. Zero = no relationship.',
    category: 'Market Structure',
    aliases: ['correlated', 'market correlation', 'correlations'],
  },

  // ── Timeframes ──
  {
    term: 'timeframe',
    definition: 'The period each candle/bar represents. 1m = each bar is 1 minute. 1d = each bar is 1 day. Shorter timeframes have more noise; longer ones show the bigger picture.',
    category: 'Timeframes',
    aliases: ['time frame', 'time frames', 'bar period', 'candle period'],
  },
  {
    term: 'lookback period',
    definition: 'How many bars of history an indicator or directive examines. A 20-bar lookback means it looks at the last 20 candles to calculate its value.',
    category: 'Timeframes',
    aliases: ['lookback', 'look back', 'period', 'calculation period'],
  },

  // ── Order Types ──
  {
    term: 'market order',
    definition: 'An order to buy or sell immediately at the current best available price. Fastest execution but no price control.',
    category: 'Order Types',
    aliases: ['market', 'market execution'],
  },
  {
    term: 'limit order',
    definition: 'An order to buy or sell at a specific price or better. You control the price but execution is not guaranteed if the market never reaches your level.',
    category: 'Order Types',
    aliases: ['limit', 'limit entry'],
  },
  {
    term: 'slippage',
    definition: 'The difference between the price you expected and the price you actually got. Common in fast-moving markets or with large orders.',
    category: 'Order Types',
    aliases: ['slippage cost'],
  },

  // ── General Trading ──
  {
    term: 'bullish',
    definition: 'Expecting prices to go up. A bullish bias means you favor buying (going long).',
    category: 'General',
    aliases: ['bull', 'bulls', 'bull market'],
  },
  {
    term: 'bearish',
    definition: 'Expecting prices to go down. A bearish bias means you favor selling (going short).',
    category: 'General',
    aliases: ['bear', 'bears', 'bear market'],
  },
  {
    term: 'long',
    definition: 'Buying a position expecting the price to rise. "Going long" = buying.',
    category: 'General',
    aliases: ['going long', 'long position', 'longs'],
  },
  {
    term: 'short',
    definition: 'Selling a borrowed position expecting the price to fall, aiming to buy it back cheaper. "Going short" = selling first, buying later.',
    category: 'General',
    aliases: ['going short', 'short position', 'shorts', 'shorting'],
  },
  {
    term: 'spread',
    definition: 'The difference between the buy (ask) and sell (bid) price. Smaller spreads mean lower trading costs. Major forex pairs typically have the tightest spreads.',
    category: 'General',
    aliases: ['bid-ask spread', 'bid ask', 'trading spread'],
  },
  {
    term: 'pip',
    definition: 'The smallest standard price movement in forex. For most pairs, 1 pip = 0.0001. A move from 1.1050 to 1.1060 is 10 pips.',
    category: 'General',
    aliases: ['pips', 'pipette', 'point'],
  },
  {
    term: 'forex',
    definition: 'Foreign Exchange — the global market for trading currencies. The largest financial market in the world by volume. Symbols like EURUSD represent one currency against another.',
    category: 'General',
    aliases: ['FX', 'foreign exchange', 'currency pair', 'forex market'],
  },
  {
    term: 'backtesting',
    definition: 'Running a strategy against historical data to see how it would have performed. Important caveat: past performance does not guarantee future results.',
    category: 'General',
    aliases: ['backtest', 'back-test', 'historical testing'],
  },

  // ── Directive Categories ──
  {
    term: 'entry directive',
    definition: 'Scans the market for favorable conditions to open a position. Looks for setups like pullbacks, breakouts, or momentum shifts — moments where the odds favor a successful trade. Think of entry directives as a quality checklist before you click "buy" or "sell."',
    category: 'Directive Categories',
    aliases: ['entry', 'entry directives'],
  },
  {
    term: 'exit directive',
    definition: 'Monitors open positions for signs that the trade has run its course — weakening momentum, reversal patterns, or risk thresholds being hit. A good exit is just as important as a good entry.',
    category: 'Directive Categories',
    aliases: ['exit', 'exit directives'],
  },
  {
    term: 'trend directive',
    definition: 'Determines if the market is moving consistently in one direction (uptrend or downtrend) or if it\'s choppy and directionless. Uses moving averages, price structure (higher highs/lower lows), or ADX. The golden rule: "The trend is your friend."',
    category: 'Directive Categories',
    aliases: ['trend', 'trend directives'],
  },
  {
    term: 'momentum directive',
    definition: 'Measures the speed and strength of price changes. Strong momentum in your trade\'s direction is good — it suggests the move has force behind it. Weakening momentum can be an early warning of a reversal. Like a car\'s speedometer: it tells you how fast you\'re going, not where you\'re headed.',
    category: 'Directive Categories',
    aliases: ['momentum', 'momentum directives'],
  },
  {
    term: 'volume directive',
    definition: 'Checks whether trading activity confirms or contradicts the price move. High volume on a breakout = strong conviction. Low volume = the move may be weak and likely to fail. Volume is the "fuel" behind price moves.',
    category: 'Directive Categories',
    aliases: ['volume', 'volume directives'],
  },
  {
    term: 'risk directive',
    definition: 'Measures things like volatility, correlation exposure, or position size relative to your account. Helps answer: "How much can I lose if this goes wrong?" A high risk score doesn\'t necessarily mean "don\'t trade" — it means "size accordingly and be aware."',
    category: 'Directive Categories',
    aliases: ['risk', 'risk directives'],
  },
  {
    term: 'macro directive',
    definition: 'Factors in broad economic conditions beyond individual symbols: interest rates, GDP, commodity prices, correlations, and sentiment. These "big picture" factors often drive entire markets — e.g. a strong USD tends to pressure gold and emerging market currencies.',
    category: 'Directive Categories',
    aliases: ['macro', 'macro directives'],
  },
];

/**
 * Build a lookup map keyed by lowercase term/aliases for O(1) access.
 */
const glossaryMap = new Map();
GLOSSARY.forEach((entry) => {
  const key = entry.term.toLowerCase();
  if (!glossaryMap.has(key)) glossaryMap.set(key, entry);
  (entry.aliases || []).forEach((alias) => {
    const aKey = alias.toLowerCase();
    if (!glossaryMap.has(aKey)) glossaryMap.set(aKey, entry);
  });
});

/**
 * Look up a glossary entry by term or alias (case-insensitive).
 * @param {string} word
 * @returns {object|undefined}
 */
export function lookupGlossary(word) {
  return glossaryMap.get(word.toLowerCase());
}

/**
 * Get all glossary entries (for glossary index page).
 * @returns {Array}
 */
export function getAllGlossary() {
  return GLOSSARY;
}

export default GLOSSARY;
