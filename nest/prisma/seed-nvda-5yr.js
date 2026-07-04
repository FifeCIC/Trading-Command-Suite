"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
const SYMBOL_TICKER = 'NVDA';
const TIMEFRAME = '1d';
const PROVIDER = 'alpaca';
const START_DATE = new Date('2021-06-12');
const END_DATE = new Date('2026-06-12');
const YEARLY_PRICE_TARGETS = [
    { date: new Date('2021-01-01'), price: 15 },
    { date: new Date('2021-06-01'), price: 20 },
    { date: new Date('2021-12-31'), price: 35 },
    { date: new Date('2022-06-01'), price: 22 },
    { date: new Date('2022-12-31'), price: 15 },
    { date: new Date('2023-06-01'), price: 40 },
    { date: new Date('2023-12-31'), price: 50 },
    { date: new Date('2024-06-01'), price: 120 },
    { date: new Date('2024-12-31'), price: 140 },
    { date: new Date('2025-06-01'), price: 160 },
    { date: new Date('2025-12-31'), price: 140 },
    { date: new Date('2026-06-01'), price: 125 },
];
function interpolatePrice(date) {
    const ms = date.getTime();
    let prev = YEARLY_PRICE_TARGETS[0];
    for (const target of YEARLY_PRICE_TARGETS) {
        if (target.date > date) {
            const rangeMs = target.date.getTime() - prev.date.getTime();
            const ratio = rangeMs > 0 ? (ms - prev.date.getTime()) / rangeMs : 0;
            return prev.price + (target.price - prev.price) * ratio;
        }
        prev = target;
    }
    return prev.price;
}
function generateSyntheticBars() {
    const bars = [];
    const bars_ = bars;
    let seed = 14042000;
    function rand() {
        seed = (seed * 1664525 + 1013904223) & 0x7fffffff;
        return seed / 0x7fffffff;
    }
    let prevClose = 15;
    for (let d = new Date(START_DATE); d <= END_DATE; d.setDate(d.getDate() + 1)) {
        if (d.getDay() === 0 || d.getDay() === 6)
            continue;
        const targetPrice = interpolatePrice(d);
        const drift = (targetPrice - prevClose) / 10;
        const volatility = targetPrice * 0.025;
        const dailyReturn = drift + (rand() - 0.5) * volatility;
        const crashChance = rand();
        const finalReturn = crashChance < 0.02
            ? dailyReturn - targetPrice * (0.05 + rand() * 0.15)
            : crashChance > 0.98
                ? dailyReturn + targetPrice * (0.03 + rand() * 0.10)
                : dailyReturn;
        const open = prevClose;
        const close = Math.max(1, open + finalReturn);
        const high = Math.max(open, close) + rand() * volatility * 0.6;
        const low = Math.min(open, close) - rand() * volatility * 0.6;
        const volume = Math.floor(10_000_000 + rand() * 80_000_000);
        bars_.push({
            timestamp: new Date(d),
            open: Number(open.toFixed(2)),
            high: Number(high.toFixed(2)),
            low: Number(low.toFixed(2)),
            close: Number(close.toFixed(2)),
            volume,
        });
        prevClose = close;
    }
    return bars_;
}
async function main() {
    console.log(`Seeding NVDA 5-year daily bars (${START_DATE.toISOString().slice(0, 10)} to ${END_DATE.toISOString().slice(0, 10)})…\n`);
    const symbol = await prisma.symbol.findUnique({
        where: { ticker: SYMBOL_TICKER },
    });
    if (!symbol) {
        console.log(`Symbol ${SYMBOL_TICKER} not found. Run 'npx prisma db seed' first to create symbols.`);
        await prisma.$disconnect();
        process.exit(1);
    }
    const existingCount = await prisma.marketBar.count({
        where: { symbolId: symbol.id, timeframe: TIMEFRAME, provider: PROVIDER },
    });
    if (existingCount >= 1000) {
        console.log(`  ⏭  ${SYMBOL_TICKER}: ${existingCount} daily bars already exist, skipping.`);
        await prisma.$disconnect();
        return;
    }
    if (existingCount > 0) {
        await prisma.marketBar.deleteMany({
            where: { symbolId: symbol.id, timeframe: TIMEFRAME, provider: PROVIDER },
        });
        console.log(`  🗑  Cleared ${existingCount} old bars`);
    }
    const bars = generateSyntheticBars();
    console.log(`  📊 Generated ${bars.length} synthetic NVDA daily bars`);
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
    const totalNow = await prisma.marketBar.count({
        where: { symbolId: symbol.id, timeframe: TIMEFRAME },
    });
    console.log(`\n✅ NVDA 5yr seed complete: ${totalNow} daily bars in MarketBar.`);
    console.log(`   Price range: ~$${bars[0].open.toFixed(2)} → ~$${bars[bars.length - 1].close.toFixed(2)}`);
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
//# sourceMappingURL=seed-nvda-5yr.js.map