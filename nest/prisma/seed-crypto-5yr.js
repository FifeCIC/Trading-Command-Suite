"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
const TIMEFRAME = '1d';
const PROVIDER = 'alpaca';
const START_DATE = new Date('2021-06-12');
const END_DATE = new Date('2026-06-12');
const CRYPTO_PAIRS = [
    {
        ticker: 'BTCUSD',
        name: 'Bitcoin / US Dollar',
        startPrice: 35000,
        volatility: 0.035,
        crashProb: 0.015,
        rallyProb: 0.02,
        targetPrices: [
            { date: new Date('2021-06-01'), price: 35000 },
            { date: new Date('2021-11-01'), price: 68000 },
            { date: new Date('2022-01-01'), price: 46000 },
            { date: new Date('2022-06-01'), price: 20000 },
            { date: new Date('2022-12-31'), price: 16500 },
            { date: new Date('2023-06-01'), price: 30000 },
            { date: new Date('2023-12-31'), price: 42000 },
            { date: new Date('2024-03-01'), price: 60000 },
            { date: new Date('2024-12-31'), price: 95000 },
            { date: new Date('2025-06-01'), price: 105000 },
            { date: new Date('2025-12-31'), price: 85000 },
            { date: new Date('2026-06-01'), price: 70000 },
        ],
    },
    {
        ticker: 'ETHUSD',
        name: 'Ethereum / US Dollar',
        startPrice: 2500,
        volatility: 0.04,
        crashProb: 0.018,
        rallyProb: 0.025,
        targetPrices: [
            { date: new Date('2021-06-01'), price: 2500 },
            { date: new Date('2021-11-01'), price: 4800 },
            { date: new Date('2022-01-01'), price: 3700 },
            { date: new Date('2022-06-01'), price: 1000 },
            { date: new Date('2022-12-31'), price: 1200 },
            { date: new Date('2023-06-01'), price: 1800 },
            { date: new Date('2023-12-31'), price: 2400 },
            { date: new Date('2024-03-01'), price: 3500 },
            { date: new Date('2024-12-31'), price: 4800 },
            { date: new Date('2025-06-01'), price: 4200 },
            { date: new Date('2025-12-31'), price: 3800 },
            { date: new Date('2026-06-01'), price: 3500 },
        ],
    },
];
function generateCryptoBars(config) {
    const bars = [];
    let seed = config.ticker.charCodeAt(0) * 100000 + config.ticker.charCodeAt(1) * 1000 + config.ticker.charCodeAt(2) * 10;
    function rand() {
        seed = (seed * 1664525 + 1013904223) & 0x7fffffff;
        return seed / 0x7fffffff;
    }
    let prevClose = config.startPrice;
    for (let d = new Date(START_DATE); d <= END_DATE; d.setDate(d.getDate() + 1)) {
        let targetPrice = config.targetPrices[config.targetPrices.length - 1].price;
        for (let i = 0; i < config.targetPrices.length - 1; i++) {
            const curr = config.targetPrices[i];
            const next = config.targetPrices[i + 1];
            if (d >= curr.date && d < next.date) {
                const rangeMs = next.date.getTime() - curr.date.getTime();
                const ratio = rangeMs > 0 ? (d.getTime() - curr.date.getTime()) / rangeMs : 0;
                targetPrice = curr.price + (next.price - curr.price) * ratio;
                break;
            }
        }
        const drift = (targetPrice - prevClose) * 0.02;
        const noise = (rand() - 0.5) * config.volatility * targetPrice;
        let event = 0;
        const r = rand();
        if (r < config.crashProb) {
            event = -targetPrice * (0.1 + rand() * 0.2);
        }
        else if (r < config.crashProb + config.rallyProb) {
            event = targetPrice * (0.1 + rand() * 0.15);
        }
        const dailyChange = drift + noise + event;
        const open = prevClose;
        const close = Math.max(1, open + dailyChange);
        const high = Math.max(open, close) + rand() * config.volatility * targetPrice * 0.8;
        const low = Math.min(open, close) - rand() * config.volatility * targetPrice * 0.8;
        const volume = Math.floor(1_000_000 + rand() * 50_000_000);
        bars.push({
            timestamp: new Date(d),
            open: Number(open.toFixed(2)),
            high: Number(high.toFixed(2)),
            low: Number(low.toFixed(2)),
            close: Number(close.toFixed(2)),
            volume,
        });
        prevClose = close;
    }
    return bars;
}
async function main() {
    console.log('Seeding crypto 5-year daily bars (BTCUSD, ETHUSD)…\n');
    for (const pair of CRYPTO_PAIRS) {
        let symbol = await prisma.symbol.findUnique({
            where: { ticker: pair.ticker },
        });
        if (!symbol) {
            symbol = await prisma.symbol.create({
                data: {
                    ticker: pair.ticker,
                    name: pair.name,
                    exchange: 'CRYPTO',
                    type: 'crypto',
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
        const bars = generateCryptoBars(pair);
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
        console.log(`     Price range: $${minPrice.toFixed(2)} – $${maxPrice.toFixed(2)}`);
    }
    const totalBars = await prisma.marketBar.count({ where: { timeframe: TIMEFRAME } });
    console.log(`\n✅ Crypto seed complete: ~${totalBars} daily bars total.`);
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
//# sourceMappingURL=seed-crypto-5yr.js.map