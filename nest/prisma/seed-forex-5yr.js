"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
const TIMEFRAME = '1d';
const PROVIDER = 'alpaca';
const START_DATE = new Date('2021-06-12');
const END_DATE = new Date('2026-06-12');
const FOREX_PAIRS = [
    { ticker: 'EURUSD', name: 'Euro / US Dollar', meanPrice: 1.10, rangeHigh: 1.25, rangeLow: 0.95, yearlyTrend: -0.02 },
    { ticker: 'GBPUSD', name: 'British Pound / US Dollar', meanPrice: 1.28, rangeHigh: 1.42, rangeLow: 1.05, yearlyTrend: -0.01 },
    { ticker: 'USDJPY', name: 'US Dollar / Japanese Yen', meanPrice: 140, rangeHigh: 160, rangeLow: 100, yearlyTrend: 3 },
    { ticker: 'AUDUSD', name: 'Australian Dollar / US Dollar', meanPrice: 0.70, rangeHigh: 0.80, rangeLow: 0.55, yearlyTrend: -0.01 },
    { ticker: 'USDCAD', name: 'US Dollar / Canadian Dollar', meanPrice: 1.30, rangeHigh: 1.45, rangeLow: 1.18, yearlyTrend: 0.01 },
    { ticker: 'NZDUSD', name: 'New Zealand Dollar / US Dollar', meanPrice: 0.62, rangeHigh: 0.72, rangeLow: 0.50, yearlyTrend: -0.01 },
];
function generateForexBars(config) {
    const bars = [];
    let seed = config.ticker.charCodeAt(0) * 100000 + config.ticker.charCodeAt(1) * 1000 + config.ticker.charCodeAt(2) * 10;
    function rand() {
        seed = (seed * 1664525 + 1013904223) & 0x7fffffff;
        return seed / 0x7fffffff;
    }
    let prevClose = config.meanPrice;
    const dailyVol = (config.rangeHigh - config.rangeLow) * 0.008;
    const dailyTrend = config.yearlyTrend / 252;
    const meanLevel = config.meanPrice;
    for (let d = new Date(START_DATE); d <= END_DATE; d.setDate(d.getDate() + 1)) {
        if (d.getDay() === 0 || d.getDay() === 6)
            continue;
        const reversionPull = (meanLevel - prevClose) * 0.03;
        const trendDrift = dailyTrend;
        const noise = (rand() - 0.5) * dailyVol;
        const shock = rand();
        let shockEffect = 0;
        if (shock < 0.01)
            shockEffect = (rand() - 0.5) * dailyVol * 3;
        else if (shock < 0.03)
            shockEffect = (rand() - 0.5) * dailyVol * 1.5;
        const dailyChange = reversionPull + trendDrift + noise + shockEffect;
        const open = prevClose;
        const close = open + dailyChange;
        const high = Math.max(open, close) + rand() * dailyVol * 0.5;
        const low = Math.min(open, close) - rand() * dailyVol * 0.5;
        const volume = Math.floor(500_000 + rand() * 5_000_000);
        bars.push({
            timestamp: new Date(d),
            open: Number(open.toFixed(5)),
            high: Number(high.toFixed(5)),
            low: Number(low.toFixed(5)),
            close: Number(close.toFixed(5)),
            volume,
        });
        prevClose = close;
    }
    return bars;
}
async function main() {
    console.log('Seeding 6 forex pairs with 5-year daily bars…\n');
    for (const pair of FOREX_PAIRS) {
        let symbol = await prisma.symbol.findUnique({
            where: { ticker: pair.ticker },
        });
        if (!symbol) {
            symbol = await prisma.symbol.create({
                data: {
                    ticker: pair.ticker,
                    name: pair.name,
                    exchange: 'FOREX',
                    type: 'forex',
                    active: true,
                },
            });
            console.log(`  ✓ Created symbol: ${pair.ticker}`);
        }
        const existingCount = await prisma.marketBar.count({
            where: { symbolId: symbol.id, timeframe: TIMEFRAME },
        });
        if (existingCount >= 1000) {
            console.log(`  ⏭  ${pair.ticker}: ${existingCount} bars already exist, skipping.`);
            continue;
        }
        if (existingCount > 0) {
            await prisma.marketBar.deleteMany({
                where: { symbolId: symbol.id, timeframe: TIMEFRAME },
            });
        }
        const bars = generateForexBars(pair);
        console.log(`  📊 ${pair.ticker}: generating ${bars.length} daily bars`);
        await prisma.marketBar.createMany({
            data: bars.map((bar) => ({
                symbolId: symbol.id,
                provider: PROVIDER,
                timeframe: TIMEFRAME,
                timestamp: bar.timestamp,
                open: bar.open,
                high: bar.high,
                low: bar.low,
                close: bar.close,
                volume: bar.volume,
            })),
        });
        const prices = bars.map((b) => b.close);
        const minPrice = Math.min(...prices);
        const maxPrice = Math.max(...prices);
        console.log(`     Price range: ${minPrice.toFixed(5)} – ${maxPrice.toFixed(5)}`);
    }
    const totalForexBars = await prisma.marketBar.count({
        where: { timeframe: TIMEFRAME },
    });
    console.log(`\n✅ Forex seed complete: ~${totalForexBars} daily bars total.`);
}
main()
    .then(async () => {
    await prisma.$disconnect();
})
    .catch(async (error) => {
    console.error('Seed failed:', error);
    await prisma.$disconnect();
    process.exit(1);
});
//# sourceMappingURL=seed-forex-5yr.js.map