"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FAQ_ENTRIES = void 0;
exports.seedFaq = seedFaq;
const client_1 = require("@prisma/client");
exports.FAQ_ENTRIES = [
    {
        question: 'How does the scoring system work?',
        answer: 'The scoring system runs multiple "directives" (RSI, MACD, EMA, ATR, Volume) against market data for each active symbol. Each directive returns a score from 0–100. These scores are weighted and combined into a final score. The system then ranks symbols from highest to lowest score. Scores ≥60 are "entry" signals, ≥40 are "watch", and <40 are "defensive".',
        category: 'scoring',
        tags: 'scoring,directives,ranked,how-it-works',
        order: 1,
    },
    {
        question: 'What does the normalized score mean?',
        answer: 'The normalized score shows your score as a percentage of the maximum possible given available data. For example, if only 3 of 5 directives could run because volume data is missing, the max possible is lower. A raw score of 47 when the max is 55 is actually 85% — much stronger than 47 when the max is 100 (47%). This prevents misleading signals when data is incomplete.',
        category: 'scoring',
        tags: 'scoring,normalized,data-completeness',
        order: 2,
    },
    {
        question: 'How is confidence calculated?',
        answer: 'Confidence (0–1) reflects how strongly the directives agree. If RSI, MACD, and EMA all point bullish with high individual confidence, the aggregate confidence is high. If they conflict (RSI bullish, MACD bearish), confidence drops. Confidence below 0.5 means the signals are mixed.',
        category: 'scoring',
        tags: 'scoring,confidence,aggregation',
        order: 3,
    },
    {
        question: "What does 'entry' vs 'watch' vs 'defensive' mean?",
        answer: 'Entry (score ≥60): Strong buy signal. Most or all directives agree. Watch (score ≥40): Moderate interest. Monitor for confirmation. Defensive (score <40): Weak or conflicting signals. Avoid new positions. No Data: No market data available for this symbol — check provider configuration.',
        category: 'scoring',
        tags: 'scoring,signals,entry,watch,defensive',
        order: 4,
    },
    {
        question: 'Why do scores change every time I refresh?',
        answer: 'Scores are recalculated on each request using the latest available market data. If you have real-time data, scores update with price movements. Cached results (15-second cache) prevent excessive recalculation.',
        category: 'scoring',
        tags: 'scoring,cache,real-time,refresh',
        order: 5,
    },
    {
        question: 'Where does the market data come from?',
        answer: 'Currently the system connects to Alpaca Markets for stock and crypto data. The free tier provides delayed quotes (15-min for stocks) and real-time crypto. Future providers include MT5 for forex and Alpha Vantage for fundamentals.',
        category: 'data-flow',
        tags: 'data,alpaca,providers,market-data',
        order: 1,
    },
    {
        question: 'How fresh is the data?',
        answer: 'Freshness depends on your provider and tier. Alpaca free tier: stocks have 15-minute delayed data, crypto is real-time. The /api/market-data/freshness endpoint shows exactly how old the data is for each symbol. Data older than 1 hour during market hours is marked "stale".',
        category: 'data-flow',
        tags: 'data,freshness,alpaca,delayed',
        order: 2,
    },
    {
        question: "What happens when there's no data for a symbol?",
        answer: 'The symbol appears in results with status "No Data" instead of a fake score. This happens when the symbol has no price bars in the database. Check that: 1. The symbol is active in the database, 2. An import has been triggered for it, 3. The provider has data for that symbol (e.g., Alpaca has US stocks and crypto).',
        category: 'data-flow',
        tags: 'data,symbols,no-data,troubleshooting',
        order: 3,
    },
    {
        question: 'How often is data imported?',
        answer: 'Import frequency is configurable. In fallback mode, data is fetched on-demand when scoring runs. With the queue enabled (QUEUE_MODE=local), imports can be scheduled. Rate limits from free-tier APIs determine the practical minimum interval — typically 15 minutes between full refresh cycles.',
        category: 'data-flow',
        tags: 'data,import,rate-limits,scheduling',
        order: 4,
    },
    {
        question: 'What providers are supported?',
        answer: 'Currently: Alpaca (stocks + crypto), Alpha Vantage (fundamentals), Trading212 (CFD). Planned: MT5 (forex). Each provider implements the IProviderAdapter interface and plugs into the AdapterFactory.',
        category: 'providers',
        tags: 'providers,alpaca,alpha-vantage,trading212,mt5',
        order: 1,
    },
    {
        question: 'How do I add API keys?',
        answer: 'Set environment variables in nest/.env:\nALPACA_API_KEY=your_key\nALPACA_API_SECRET=your_secret\nALPHA_VANTAGE_API_KEY=your_key\nThe system detects keys at startup and uses the corresponding provider.',
        category: 'providers',
        tags: 'providers,api-keys,configuration,env',
        order: 2,
    },
    {
        question: 'Can I use multiple free accounts?',
        answer: 'Yes — name them ALPACA_API_KEY_1, ALPACA_API_KEY_2, etc. The rate limit switching system rotates between them when one hits its limit. This maximizes free-tier data access.',
        category: 'providers',
        tags: 'providers,rate-limits,multi-account,free-tier',
        order: 3,
    },
    {
        question: 'What are the rate limits?',
        answer: 'Alpaca free tier: 200 requests/minute. Alpha Vantage free tier: 25 requests/day. The system tracks usage and switches providers when limits are approached. Check GET /api/providers/rate-limits for current status.',
        category: 'providers',
        tags: 'providers,rate-limits,alpaca,alpha-vantage',
        order: 4,
    },
    {
        question: 'How do I know if a provider is working?',
        answer: 'GET /api/providers/health shows connectivity status for each configured provider. It reports whether the API is reachable, the market is open, and any recent errors. The health check runs a real API call — not just a credential check.',
        category: 'providers',
        tags: 'providers,health,connectivity,monitoring',
        order: 5,
    },
    {
        question: 'What is a strategy?',
        answer: 'A strategy is a named collection of directives with specific weights that together form a trading approach. Example: "Conviction Dip Accumulation" uses RSI (24%), MACD (22%), EMA (20%), ATR (18%), and Volume (16%). Each strategy has entry/watch thresholds and can be optimized for different market conditions or timeframes. Strategies declare their data requirements so the system knows which are viable given your current provider setup.',
        category: 'strategies',
        tags: 'strategies,directives,weights,composition',
        order: 1,
    },
    {
        question: 'Which strategy should I use?',
        answer: 'It depends on your data access and trading style: Free tier Alpaca → "Conviction Dip Accumulation" (stocks, delayed data). MT5 forex → "Forex Mean Reversion" (forex pairs, real-time via MT5). Long-term investing → "Long-Term Equity Growth" (allows averaging down). Check GET /api/strategies to see which are viable with your current setup.',
        category: 'strategies',
        tags: 'strategies,selection,recommendation,viability',
        order: 2,
    },
    {
        question: 'Can I create my own strategy?',
        answer: 'Yes — define a new strategy with your choice of directives and weights. The strategy system is designed to be composable. In the future, a visual directive builder will let you create strategies without coding.',
        category: 'strategies',
        tags: 'strategies,custom,composition,roadmap',
        order: 3,
    },
    {
        question: 'What does averaging mean in a strategy context?',
        answer: 'Averaging (or averaging down) means buying more of a stock you already own when the price drops, reducing your average cost basis. The Long-Term Equity Growth strategy supports averaging when: price is ≥5% below your entry, confidence remains ≥60%, and price is near a support level. Limits: max 3 averaging rounds per symbol, max 25% of portfolio per symbol, 48-hour cooldown.',
        category: 'strategies',
        tags: 'strategies,averaging,averaging-down,risk',
        order: 4,
    },
    {
        question: 'How does multi-timeframe scoring work?',
        answer: 'The system scores symbols across three timeframes: Macro (Daily): 50% weight — long-term trend and structure. Meso (1-Hour): 35% weight — primary trading timeframe. Micro (15-Min): 15% weight — entry timing. Composite = (0.50 × macro) + (0.35 × meso) + (0.15 × micro). Falls back to single or dual-timeframe when data is missing.',
        category: 'strategies',
        tags: 'strategies,multi-timeframe,scoring,macro,meso,micro',
        order: 5,
    },
    {
        question: 'What is a directive?',
        answer: 'A directive is a single technical analysis rule that evaluates market data and returns a score from 0–100. Each directive implements one indicator or pattern — for example, "RSI Oversold Reversion" checks if RSI(14) < 30 and is curling upward. Directives are stateless (pure functions), cannot depend on each other, and must include a confidence score and human-readable reason.',
        category: 'directives',
        tags: 'directives,indicators,rules,scores',
        order: 1,
    },
    {
        question: 'How many directives exist?',
        answer: 'The canonical registry contains 40+ directives across categories: momentum, trend, volatility, volume, pattern, macro, temporal, crypto, equity-specific, fundamental, composite, and risk. Only 5 are active in the default strategy (weighted to sum to 100). The others have weight=0 and can be activated by adding them to a strategy.',
        category: 'directives',
        tags: 'directives,registry,categories,catalog',
        order: 2,
    },
    {
        question: 'How do I add a new directive?',
        answer: '1. Create a class implementing IDirective (id, name, calculate()). 2. Register it in directives-registry.ts. 3. Add it to a strategy with a weight. Directives must be stateless, return 0–100 scores, include confidence 0–1, and have unit tests with known input/output pairs.',
        category: 'directives',
        tags: 'directives,development,extension,idirective',
        order: 3,
    },
    {
        question: 'What do signalClass and priority mean?',
        answer: 'signalClass ("bullish"/"bearish"/"neutral") tells the aggregator which direction the directive is pointing. Priority (1–100) determines influence in the dominance/cancellation system. Directives with priority ≥80 can suppress lower-priority opposing signals. This prevents a weak bearish signal from canceling a strong bullish consensus.',
        category: 'directives',
        tags: 'directives,signalClass,priority,aggregation',
        order: 4,
    },
    {
        question: 'How is the app structured?',
        answer: 'The app has two parts: Frontend: React + Vite (port 5173), TanStack Query for data fetching. Backend: NestJS (port 3201), Prisma ORM, MySQL database. The backend is modular: providers/, directives/, scoring/, market-data/, import-jobs/, strategies/, and queue/. Architecture decisions are documented in the Architecture Framework page with 20 contracts.',
        category: 'architecture',
        tags: 'architecture,frontend,backend,structure,modular',
        order: 1,
    },
    {
        question: "What's the difference between fallback and full mode?",
        answer: 'Fallback mode: Runs with minimal dependencies — no queue, no Redis. Scoring uses whatever data is in the database. Full mode: Requires Redis + queue workers. Supports scheduled imports, real-time scoring, and background processing. Controlled by QUEUE_MODE in .env.',
        category: 'architecture',
        tags: 'architecture,modes,fallback,full,queue',
        order: 2,
    },
    {
        question: 'Can the system trade automatically?',
        answer: 'No — this is a scoring and analysis tool, not an execution platform. It generates buy/sell signals and position sizing suggestions, but does not place trades. Trading automation would require broker API integration and is a separate project scope.',
        category: 'architecture',
        tags: 'architecture,automation,trading,scope,limitations',
        order: 3,
    },
    {
        question: 'How do I start the app?',
        answer: 'Terminal 1 (backend): cd nest && npm run start:dev (port 3201). Terminal 2 (frontend): npm run dev (port 5173). Requires: MySQL running (WAMP/XAMPP), Node.js 18+. Database is auto-migrated on first start if PRISMA_AUTO_MIGRATE=true.',
        category: 'operations',
        tags: 'operations,startup,getting-started,setup',
        order: 1,
    },
    {
        question: 'How do I add symbols to track?',
        answer: '1. Via API: POST /api/symbols with { ticker: "AAPL", name: "Apple Inc.", type: "stock" }. 2. Via the Active Symbols page in the UI. 3. Seed script can populate initial symbols. Symbols must be "active" (active: true) to be included in scoring.',
        category: 'operations',
        tags: 'operations,symbols,adding,active',
        order: 2,
    },
    {
        question: 'How do I seed the database with initial data?',
        answer: 'npx prisma db seed (runs nest/prisma/seed.ts). This populates: symbols (AAPL, NVDA, TSLA), market bars, provider configs, FAQ entries, and default strategy. Safe to run multiple times — uses upsert.',
        category: 'operations',
        tags: 'operations,seed,database,initial-data',
        order: 3,
    },
    {
        question: 'How do I run the scoring manually?',
        answer: 'POST /api/scoring/run with { "symbols": ["AAPL", "NVDA"] } or GET /api/scoring/ranked?limit=10 for cached results. The SEES panel in the frontend auto-refreshes every 30 seconds.',
        category: 'operations',
        tags: 'operations,scoring,manual,api',
        order: 4,
    },
    {
        question: 'How do I check if everything is working?',
        answer: 'The Setup Wizard (/) runs through: database connectivity, provider health, active symbols count, scoring pipeline status. Or check individual endpoints: /api/providers/health, /api/scoring/summary, /api/market-data/freshness.',
        category: 'operations',
        tags: 'operations,health,setup-wizard,verification',
        order: 5,
    },
    {
        question: 'Backend won\'t start — port 3201 in use',
        answer: 'Another instance is already running. Kill it: Get-NetTCPConnection -LocalPort 3201 | Select -ExpandProperty OwningProcess | Stop-Process -Force. Or change PORT in nest/.env.',
        category: 'troubleshooting',
        tags: 'troubleshooting,port,conflict,startup',
        order: 1,
    },
    {
        question: 'Alpaca credentials not configured',
        answer: 'Set ALPACA_API_KEY and ALPACA_API_SECRET in nest/.env. You can get free paper trading keys at alpaca.markets. Without credentials, no real data flows — only seeded data works.',
        category: 'troubleshooting',
        tags: 'troubleshooting,alpaca,credentials,env',
        order: 2,
    },
    {
        question: 'Frontend shows "No data" for all symbols',
        answer: 'This means the database has no market bars for your active symbols. 1. Check symbols are active: GET /api/symbols. 2. Trigger an import: POST /api/imports/trigger/{symbolId}. 3. Run the seed: npx prisma db seed. 4. Verify provider is working: GET /api/providers/health.',
        category: 'troubleshooting',
        tags: 'troubleshooting,no-data,symbols,imports',
        order: 3,
    },
    {
        question: "Scores seem wrong or don't change",
        answer: 'Possible causes: Using seeded data (static, won\'t change). Alpaca free tier (15-min delayed, updates slowly). Cached results (15-second cache on ranked endpoint). Not enough bars for directives (need 50+ candles). Queue mode is off (QUEUE_MODE=local enables background imports).',
        category: 'troubleshooting',
        tags: 'troubleshooting,scores,stale,cache,queue',
        order: 4,
    },
    {
        question: 'npm run start:dev exits immediately with code 1',
        answer: 'Common causes: MySQL not running (start WAMP/XAMPP). .env file missing or misconfigured (check DATABASE_URL). Port conflict (check port 3201). Prisma client not generated (run: npx prisma generate). Check the terminal output for the specific error message.',
        category: 'troubleshooting',
        tags: 'troubleshooting,startup,crashes,mysql,prisma',
        order: 5,
    },
    {
        question: 'Prisma migration fails',
        answer: '1. npx prisma generate (regenerate client). 2. npx prisma migrate dev (apply pending migrations). 3. If stuck: delete nest/prisma/migrations, reset DB, npx prisma migrate dev --name init. The schema is in nest/prisma/schema.prisma.',
        category: 'troubleshooting',
        tags: 'troubleshooting,prisma,migration,schema',
        order: 6,
    },
    {
        question: "What's a market bar?",
        answer: 'A market bar (or candle) represents price action over a time period. Contains: open, high, low, close, volume, and timestamp. Example: a 1-hour bar for AAPL shows the opening price, highest price, lowest price, closing price, and volume traded during that hour.',
        category: 'glossary',
        tags: 'glossary,market-bar,candle,ohlcv',
        order: 1,
    },
    {
        question: 'What does OHLCV mean?',
        answer: 'Open, High, Low, Close, Volume — the five data points in every market bar. These are the inputs to every directive. All technical indicators (RSI, MACD, EMA, etc.) are derived from OHLCV data.',
        category: 'glossary',
        tags: 'glossary,ohlcv,market-data,basics',
        order: 2,
    },
    {
        question: "What's the difference between a directive and an indicator?",
        answer: 'An indicator is the mathematical calculation (e.g., RSI value = 28). A directive is a trading rule that interprets the indicator (e.g., "RSI < 30 and rising = oversold bounce opportunity, score 75"). Directives contain indicators plus decision logic.',
        category: 'glossary',
        tags: 'glossary,directive,indicator,distinction',
        order: 3,
    },
    {
        question: "What's a timeframe in trading context?",
        answer: 'The duration of each market bar. Common timeframes: 1m/5m/15m = intraday (short-term). 1H/4H = swing trading (medium-term). Daily/Weekly = position trading (long-term). Multi-timeframe scoring combines signals across horizons.',
        category: 'glossary',
        tags: 'glossary,timeframe,intraday,swing,position',
        order: 4,
    },
    {
        question: "What's a provider adapter?",
        answer: 'A provider adapter translates a broker\'s specific API into the system\'s standard interface. Each adapter (Alpaca, Alpha Vantage, Trading212, MT5) implements the same contract: getQuote(), getCandles(), getProfile(), healthCheck(). This lets the system swap providers without changing scoring or strategy code.',
        category: 'glossary',
        tags: 'glossary,adapter,provider,interface,abstraction',
        order: 5,
    },
];
async function main() {
    const prisma = new client_1.PrismaClient();
    try {
        const count = await seedFaq(prisma);
        console.log(`✅ FAQ seed complete. ${count} entries seeded.`);
    }
    catch (err) {
        console.error('❌ FAQ seed failed:', err);
        process.exit(1);
    }
    finally {
        await prisma.$disconnect();
    }
}
main();
async function seedFaq(prisma) {
    let count = 0;
    for (const entry of exports.FAQ_ENTRIES) {
        await prisma.faqEntry.upsert({
            where: { id: `faq-${entry.category}-${entry.order}` },
            update: {
                question: entry.question,
                answer: entry.answer,
                tags: entry.tags,
            },
            create: {
                id: `faq-${entry.category}-${entry.order}`,
                question: entry.question,
                answer: entry.answer,
                category: entry.category,
                tags: entry.tags,
                order: entry.order,
            },
        });
        count++;
    }
    return count;
}
//# sourceMappingURL=seed-faq.js.map