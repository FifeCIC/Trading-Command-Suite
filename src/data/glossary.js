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
  {
    term: 'Opportunity Score',
    definition: 'The additive "everything counts" score — direction, conditions, forecasts, liquidity and analyst notes all add up into one number. Used to rank and screen the whole universe ("find the golden needle in a haystack of silver needles"). It measures how attractive a setup is, not whether it is time to trade.',
    category: 'Scoring',
    aliases: ['opportunity', 'opportunity score'],
  },
  {
    term: 'Signal Score',
    definition: 'The directional conviction score — only directives with a bullish or bearish opinion contribute. It answers "which way, and how strongly, right now", and drives the BUY/HOLD/SELL signal and the automation loop.',
    category: 'Scoring',
    aliases: ['signal score', 'directional score'],
  },
  {
    term: 'directional-only composite',
    definition: 'A composite built only from directives that hold a directional opinion (bullish or bearish), excluding neutral conditions and gates. This is what the Signal Score represents — pure directional conviction rather than the raw additive total.',
    category: 'Scoring',
    aliases: ['directional composite', 'directional-only'],
  },
  {
    term: 'directional denominator',
    definition: 'The maximum possible Signal Score — the sum of weights for directives that carry a direction (bullish/bearish). Because it counts only directional directives, it is smaller than the protocol\'s full weight.',
    category: 'Scoring',
    aliases: ['directional max', 'directional ceiling'],
  },
  {
    term: 'dynamic denominator',
    definition: 'The property of the Signal Score denominator that changes with which directional directives actually fire on a given symbol. When fewer directional directives fire, the denominator is smaller — so the percentage is measured against what actually fired, not the full directional ceiling. (Known refinement: a stable denominator would score against the full ceiling instead.)',
    category: 'Scoring',
    aliases: ['dynamic max', 'variable denominator'],
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

  // ── Architecture & Pipeline ─────────────────────────────────────────────
  // Vocabulary for HOW the pipeline is shaped, as opposed to what it measures.
  // Sources: the multi-agent AI trading literature (see architecture-framework / theory notes).
  {
    term: 'assembly line',
    definition: 'A pipeline in which each stage does ONE job and hands its result to the next stage, in a fixed sequence. A useful way to read the app: directives measure, the gate decides, the queue routes, the bridge executes. Naming it matters because an assembly line stage should never do a later stage\'s job — when the gate starts sizing positions, or the bridge starts deciding direction, the line has been broken.',
    category: 'Architecture & Pipeline',
    aliases: ['pipeline', 'assembly-line'],
  },
  {
    term: 'separation of concerns',
    definition: 'The principle that each component owns ONE decision, so a fault has one place to live. In this app: directives produce measurements, the gate vetoes, the queue routes by protocol subscription, the bridge talks to the broker. A component that quietly does two jobs is the most expensive kind of technical debt, because fixing one copy still leaves the other wrong.',
    category: 'Architecture & Pipeline',
    aliases: ['concerns', 'single responsibility'],
  },
  {
    term: 'pipeline topology',
    definition: 'The SHAPE of a pipeline — which stages exist and the order they may run in. Two systems can use the same stages and still differ completely in topology: a line (A→B→C) cannot express a veto that must happen twice, and a graph with conditional routing cannot be read as a simple list. Worth naming because a change to the order is a change to the topology, not a tweak.',
    category: 'Architecture & Pipeline',
    aliases: ['topology', 'pipeline shape'],
  },
  {
    term: 'deterministic order',
    definition: 'Running the same stages in the same sequence every cycle, so two runs on the same data produce the same result. Not a performance detail: this app enforces bar ordering and one cadence per bar array with machine-checked invariants (INV-BAR-ORDER, INV-CADENCE) because a silently reordered window produces plausible numbers with no error — the hardest class of bug to notice.',
    category: 'Architecture & Pipeline',
    aliases: ['deterministic sequencing', 'stable order'],
  },
  {
    term: 'node',
    definition: 'One stage of a pipeline, treated as a single unit with one input and one output — the standard term in multi-agent and graph-based systems (a Signal Node, a Risk Node, a Decision Node). Reading this app as nodes helps: each has a name, an input contract and an output contract, and a node that cannot describe its contract is probably doing two things.',
    category: 'Architecture & Pipeline',
    aliases: ['nodes', 'stage', 'pipeline stage'],
  },
  {
    term: 'orchestrator',
    definition: 'The component that decides WHAT runs WHEN — it holds no market logic of its own. Here it is the automation loop: it wakes on a cadence, asks scoring for a result, asks the gate, then routes what survives. Keeping the orchestrator logic-free is what stops scheduling bugs from looking like trading bugs.',
    category: 'Architecture & Pipeline',
    aliases: ['orchestration', 'orchestration layer', 'orchestrated'],
  },
  {
    term: 'state machine',
    definition: 'A design where the system can only be in a set of named states and may only move between them on defined triggers. The signal and position lifecycles follow this shape (candidate → gated → queued → sent → filled/rejected → closed). Its value is that an illegal transition becomes impossible to express rather than merely discouraged.',
    category: 'Architecture & Pipeline',
    aliases: ['state-machine', 'state diagram'],
  },
  {
    term: 'pipeline state',
    definition: 'The object carried from stage to stage so later stages do not re-derive what earlier ones already know (the multi-agent literature calls it the state dictionary). In this app the equivalent is the scoring envelope plus its blockers and hints — passing that forward is what lets a card explain WHY a trade was blocked without re-running the gate.',
    category: 'Architecture & Pipeline',
    aliases: ['state dictionary', 'shared state', 'envelope'],
  },
  {
    term: 'conditional edge',
    definition: 'A routing step that chooses the next stage from a condition rather than running a fixed sequence — pass → execute, fail → hold. The pre-trade gates are conditional edges: they do not alter the input, they decide which path it takes. Naming them this way keeps a gate a ROUTER rather than a modifier.',
    category: 'Architecture & Pipeline',
    aliases: ['conditional routing', 'branch', 'router'],
  },
  {
    term: 'monolithic',
    definition: 'One component that does everything — the anti-pattern this architecture is built to avoid. A single script holding data, scoring, risk and execution cannot be tested in parts, cannot fail in parts, and cannot be reasoned about when it misbehaves; the failure is always "something in there is wrong".',
    category: 'Architecture & Pipeline',
    aliases: ['monolith', 'big ball of mud'],
  },

  // ── AI-Assisted Systems ─────────────────────────────────────────────────
  // The vocabulary needed to describe an AI stage honestly. This app is deliberately
  // deterministic-core first; these terms exist so the framing is ready when an AI stage is added.
  {
    term: 'deterministic core',
    definition: 'The part of a system whose output is fully reproducible from its input — same data in, same decision out, every time. This app is a deterministic core by design: a scoring pipeline, gates and a bridge whose behaviour can be tested and argued about. The value of the term is that it defines what is being PROTECTED when an AI stage is added around it.',
    category: 'AI-Assisted Systems',
    aliases: ['deterministic system', 'reproducible core'],
  },
  {
    term: 'probabilistic',
    definition: 'A component that returns a distribution of plausible answers rather than one guaranteed answer — every LLM is probabilistic, even at temperature 0. The word matters because it explains why an AI stage can never be the last line of defence: a probabilistic component must be wrapped in deterministic checks, never trusted to enforce them.',
    category: 'AI-Assisted Systems',
    aliases: ['probabilistic model', 'non-deterministic'],
  },
  {
    term: 'LLM as the brain',
    definition: 'An architecture where a language model makes the final BUY/SELL/HOLD call, with the quantitative and risk stages feeding it context. The honest framing for this app: the brain is the part being ADDED, not the part being replaced. A system whose edge depends on the model cannot be tested without the model, so the deterministic core must be profitable and verifiable on its own BEFORE a brain is bolted on top.',
    category: 'AI-Assisted Systems',
    aliases: ['decision node', 'the brain', 'AI decision layer'],
  },
  {
    term: 'advisory-only AI',
    definition: 'An AI stage that proposes and explains but cannot place an order — its output is a suggestion a rule or a person must still accept. The safest first use of a model here: it can disagree with the pipeline, it can rank the candidates the gates already cleared, but it cannot widen a position, ignore a veto, or bypass the duplicate guard.',
    category: 'AI-Assisted Systems',
    aliases: ['advisory AI', 'suggest-only', 'human-in-the-loop'],
  },
  {
    term: 'guardrail',
    definition: 'A rule that constrains what an automated system may do, enforced OUTSIDE the component making the decision. Guardrails are what make autonomy acceptable; in this app they are the pre-trade gates, the bridge size and position caps, the duplicate-order window and the market-closed check. A guardrail that lives only in a prompt is not a guardrail, it is a request.',
    category: 'AI-Assisted Systems',
    aliases: ['guardrails', 'hard limit', 'safety rail'],
  },
  {
    term: 'hard-coded guardrail',
    definition: 'A guardrail written in code rather than expressed to a model — a fixed cap, a fixed floor, a fixed veto. Deliberately unglamorous: its point is that it cannot be argued with, cannot be reinterpreted, and fails closed when the rest of the system is confused.',
    category: 'AI-Assisted Systems',
    aliases: ['static guardrail', 'hard limit'],
  },
  {
    term: 'structured output',
    definition: 'Requiring a model to answer in a fixed schema — action, size, rationale — so ordinary code can act on the result. Without it you get prose that must be parsed by guesswork; with it, the model\'s answer is validated the same way any other input is, and an unparseable answer is a rejected answer rather than a crash.',
    category: 'AI-Assisted Systems',
    aliases: ['structured response', 'JSON schema output', 'constrained decoding'],
  },
  {
    term: 'rationale',
    definition: 'The plain-English explanation a model gives for its decision, shown alongside the decision itself. For an AI stage this is not a nicety — it is the only way a human can audit a probabilistic step, and it is the reason this app already keeps a Decision Trail: the record exists so a decision can be explained after the fact, whoever made it.',
    category: 'AI-Assisted Systems',
    aliases: ['reasoning', 'explanation', 'why'],
  },
  {
    term: 'cognitive console',
    definition: 'A UI surface that streams a system\'s reasoning as it happens, rather than only its results. This app\'s Decision Trail is the deterministic half of the same idea — what was considered, what was rejected, and why. Naming it makes the gap clear: the trail records RULES that fired, where a cognitive console would also record a model\'s live narration.',
    category: 'AI-Assisted Systems',
    aliases: ['reasoning console', 'live reasoning view'],
  },
  {
    term: 'retrieval-augmented generation',
    definition: 'Answering with retrieved documents as context instead of relying on what the model memorised — often shortened to RAG. The app already does the deterministic version of this for directives: a directive reads stored news, fundamentals or insider rows for ITS symbol rather than asking a model what it remembers. The retrieval half is the part that survives a model change.',
    category: 'AI-Assisted Systems',
    aliases: ['RAG', 'retrieval augmentation', 'grounded generation'],
  },
  {
    term: 'embeddings',
    definition: 'Turning text into numbers that represent its MEANING, so articles can be compared by similarity rather than by keyword. Useful to know because it is the usual next step for news: keyword matching finds articles that share words, embeddings find articles that share subject.',
    category: 'AI-Assisted Systems',
    aliases: ['embedding', 'vector representation'],
  },
  {
    term: 'vector database',
    definition: 'A store built for similarity search over embeddings — give it one vector, get the nearest stored ones. The trade-off against this app\'s SQL tables is honest: a vector store is better at "find related news", worse at "find every row for this symbol between two timestamps", which is why the reference above is a hybrid rather than a replacement.',
    category: 'AI-Assisted Systems',
    aliases: ['vector store', 'vector DB', 'Pinecone'],
  },
  {
    term: 'hallucination',
    definition: 'A confident, fluent, WRONG output from a model — most often a fabricated fact or figure rather than an obvious error. It is the reason a probabilistic stage cannot write to the database unchecked: a hallucinated price is indistinguishable from a real one once it is stored.',
    category: 'AI-Assisted Systems',
    aliases: ['hallucinated', 'confabulation', 'fabrication'],
  },
  {
    term: 'model error',
    definition: 'A wrong decision caused by the model rather than by the data or the code — one of the four failure classes an automated system must expect, alongside bad data, software failure and an unintended order. Worth distinguishing because the fix differs: bad data is an import bug, a model error is a reasoning bug, and only one of those is fixed by a retry.',
    category: 'AI-Assisted Systems',
    aliases: ['model risk', 'inference error'],
  },
  {
    term: 'inference',
    definition: 'Running a model to get an output. Inference LATENCY is the delay before the answer arrives, and it is why trading systems avoid remote model calls mid-cycle: a ten-second wait is not a slow decision, it is a stale one — the price the decision was based on has already moved.',
    category: 'AI-Assisted Systems',
    aliases: ['infer', 'inference latency', 'sub-second inference'],
  },
  {
    term: 'prompt',
    definition: 'The instruction text given to a model, including whatever context is supplied with it. An engineered prompt is assembled from the pipeline state (indicators, risk constraints, retrieved news) rather than written by hand — which is exactly why a model stage should receive the SAME state the deterministic stages used, and not a fresh summary of it.',
    category: 'AI-Assisted Systems',
    aliases: ['prompts', 'prompt engineering', 'engineered prompt'],
  },
  {
    term: 'AGI',
    definition: 'Artificial general intelligence — a system able to learn and perform any intellectual task a person can, rather than one narrow job. Useful as a horizon marker, not a plan: a trading system that is correct WITHOUT general intelligence is a prerequisite, because an AGI stage would still inherit the same problem — its output must be verifiable against something that does not depend on it.',
    category: 'AI-Assisted Systems',
    aliases: ['artificial general intelligence', 'general AI'],
  },

  // ── Data & Operations ───────────────────────────────────────────────────
  {
    term: 'time-series table',
    definition: 'A table whose rows are ordered events (bars, fills, scores) and whose queries are almost always "for this symbol, between these times". Databases built for this partition storage by time (TimescaleDB calls the partitions hypertables) because a single huge table makes recent-data queries scan history they do not need.',
    category: 'Data & Operations',
    aliases: ['hypertable', 'time series', 'partitioned table'],
  },
  {
    term: 'pub/sub',
    definition: 'Publish/subscribe — a component broadcasts an event on a channel and interested consumers receive it, without the sender knowing who is listening. The alternative is polling, where every consumer asks repeatedly and most answers are "nothing new". This app still polls for most surfaces, which is why a short refresh interval feels alive and a slow one feels stale.',
    category: 'Data & Operations',
    aliases: ['publish-subscribe', 'event channel', 'pubsub'],
  },
  {
    term: 'backpressure',
    definition: 'What happens when work arrives faster than it can be processed: without a policy, the queue grows, memory grows, and everything slows together. The term is useful because "the system is slow" and "the system is being pushed harder than it can drain" look identical from outside and need different fixes.',
    category: 'Data & Operations',
    aliases: ['queue pressure', 'overload'],
  },
  {
    term: 'dead letter',
    definition: 'A message that repeatedly fails and is set aside instead of blocking the queue forever — the dead-letter queue is where poison messages go to be inspected. Without one, a single bad item can stall every item behind it while reporting no error at all.',
    category: 'Data & Operations',
    aliases: ['dead-letter queue', 'DLQ', 'poison message'],
  },
  {
    term: 'saga',
    definition: 'A multi-step operation that cannot be rolled back with one transaction, so each step gets a defined COMPENSATING action (if the order was sent but the record failed, the compensation is a reconciliation, not an undo). Trading is inherently a saga: the broker has already acted, so "cancel" means "reconcile", never "un-run".',
    category: 'Data & Operations',
    aliases: ['compensating transaction', 'saga pattern'],
  },
  {
    term: 'runbook',
    definition: 'A short, ordered procedure for a known failure — what to check, in what order, and when to stop. Valuable precisely because the person reading it is under pressure and the system is already misbehaving; it is the difference between diagnosing a fault and guessing at one.',
    category: 'Data & Operations',
    aliases: ['run book', 'playbook', 'incident procedure'],
  },
  {
    term: 'volatility scaling',
    definition: 'Adjusting position size to how much the instrument actually moves, so a quiet and a violent market carry comparable risk. Without it, a fixed lot size means the same trade is several times riskier on one symbol than another — the usual inputs are ATR or a model of volatility such as GARCH.',
    category: 'Data & Operations',
    aliases: ['volatility-adjusted sizing', 'risk parity sizing'],
  },
  {
    term: 'GARCH',
    definition: 'A family of models that forecast volatility from the fact that volatility clusters — big moves follow big moves. Used for sizing rather than direction: it answers "how much might this move", never "which way".',
    category: 'Data & Operations',
    aliases: ['GARCH model', 'volatility forecasting'],
  },
  {
    term: 'drawdown-adjusted return',
    definition: 'A performance figure that accounts for the pain taken to earn it — return divided by the drawdown suffered (or by volatility, as in Sharpe/Sortino). Raw return alone flatters a strategy that made 20% via a 40% plunge; the adjustment is what makes two strategies comparable at all.',
    category: 'Data & Operations',
    aliases: ['risk-adjusted return', 'Sharpe', 'Sortino', 'Calmar'],
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
