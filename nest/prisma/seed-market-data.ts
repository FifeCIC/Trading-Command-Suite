/**
 * Seed Market Data
 * ================
 * Populates MarketBar table with OHLCV data for MVP symbols.
 * Uses the same mock generation logic as AlpacaAdapter.getMockCandles()
 * so the scoring pipeline has real-looking input.
 *
 * Run: npx ts-node prisma/seed-market-data.ts
 *      or via npm script: npm run seed:market-data
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const BASE_PRICES: Record<string, number> = {
  AAPL: 175.5,
  NVDA: 485.25,
  TSLA: 248.75,
};

const TICKERS = ['AAPL', 'NVDA', 'TSLA'];
const TIMEFRAME = '1h';
const BAR_COUNT = 100;
const PROVIDER = 'alpaca';

function generateBars(ticker: string, count: number) {
  const basePrice = BASE_PRICES[ticker] || 100;
  const now = Date.now();
  const hourMs = 60 * 60 * 1000;
  const bars: Array<{
    timestamp: Date;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }> = [];

  // Use a deterministic-ish seed based on ticker for reproducibility
  let seed = ticker.charCodeAt(0) * 10000 + ticker.charCodeAt(1) * 100 + ticker.charCodeAt(2);

  function pseudoRandom() {
    seed = (seed * 16807 + 0) % 2147483647;
    return (seed - 1) / 2147483646;
  }

  for (let i = count - 1; i >= 0; i--) {
    const timestamp = new Date(now - i * hourMs);
    const volatility = basePrice * 0.02;
    const open = basePrice + (pseudoRandom() - 0.5) * volatility;
    const close = basePrice + (pseudoRandom() - 0.5) * volatility;
    const high = Math.max(open, close) + pseudoRandom() * volatility * 0.5;
    const low = Math.min(open, close) - pseudoRandom() * volatility * 0.5;
    const volume = Math.floor(1_000_000 + pseudoRandom() * 5_000_000);

    bars.push({ timestamp, open, high, low, close, volume });
  }

  return bars;
}

async function main() {
  console.log('Seeding market data…\n');

  // Get existing symbols from DB
  const symbols = await prisma.symbol.findMany({
    where: { ticker: { in: TICKERS } },
  });

  if (symbols.length === 0) {
    console.log('No symbols found in DB. Run `npx prisma db seed` first to create symbols.');
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log(`Found ${symbols.length} symbols:\n`);

  for (const symbol of symbols) {
    // Check if bars already exist for this symbol
    const existingCount = await prisma.marketBar.count({
      where: { symbolId: symbol.id, timeframe: TIMEFRAME, provider: PROVIDER },
    });

    if (existingCount >= BAR_COUNT) {
      console.log(`  ⏭  ${symbol.ticker}: ${existingCount} bars already seeded, skipping.`);
      continue;
    }

    // Delete old bars if regenerating
    if (existingCount > 0) {
      await prisma.marketBar.deleteMany({
        where: { symbolId: symbol.id, timeframe: TIMEFRAME, provider: PROVIDER },
      });
      console.log(`  🗑  ${symbol.ticker}: cleared ${existingCount} old bars`);
    }

    const bars = generateBars(symbol.ticker, BAR_COUNT);

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

    console.log(`  ✓ ${symbol.ticker}: seeded ${BAR_COUNT} ${TIMEFRAME} bars`);
  }

  // Verify
  const totalBars = await prisma.marketBar.count();
  console.log(`\n✅ MarketBar table now has ${totalBars} total bars.`);
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
