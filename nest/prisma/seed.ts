import "dotenv/config";
import { PrismaClient } from '@prisma/client';
import { seedFaq } from './seed-faq';
import { STRATEGY_SEEDS } from '../src/modules/strategies/strategy-seeds';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding Trading Command Suite database…');

  const symbols = [
    { ticker: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ', type: 'stock' },
    { ticker: 'NVDA', name: 'NVIDIA Corporation', exchange: 'NASDAQ', type: 'stock' },
    { ticker: 'TSLA', name: 'Tesla Inc.', exchange: 'NASDAQ', type: 'stock' },
  ];

  for (const symbol of symbols) {
    const existing = await prisma.symbol.findUnique({
      where: { ticker: symbol.ticker },
    });

    if (existing) {
      console.log(`  • ${symbol.ticker} already exists, skipping.`);
      continue;
    }

    await prisma.symbol.create({ data: symbol });
    console.log(`  ✓ ${symbol.ticker}`);
  }

  console.log('Seed complete.');

  // Seed FAQ entries
  const faqCount = await seedFaq(prisma);
  console.log(`  ✓ ${faqCount} FAQ entries seeded.`);

  // Seed symbol calibrations
  const calibrations = [
    { symbol: 'DOGEUSD', directiveId: 'news-sentiment', weightMultiplier: 3.0, reason: 'DOGE is 3x more sensitive to social sentiment and news' },
    { symbol: 'DOGEUSD', directiveId: 'volume-surge', weightMultiplier: 1.5, reason: 'Whale activity precedes DOGE moves more than typical crypto' },
    { symbol: 'DOGEUSD', directiveId: 'panic-exhaustion', weightMultiplier: 2.0, reason: 'DOGE capitulations are sharper and reverse faster than other assets' },
    { symbol: 'XAUUSD', directiveId: 'news-sentiment', weightMultiplier: 1.5, reason: 'Geopolitical news heavily affects gold prices' },
    { symbol: 'XAUUSD', directiveId: 'rsi-oversold', weightMultiplier: 0.7, reason: 'Gold trends strongly — mean-reversion less reliable than trend following' },
    { symbol: 'NVDA', directiveId: 'earnings-proximity', weightMultiplier: 2.5, reason: 'NVDA earnings are massive events with strong pre/post drift' },
    { symbol: 'NVDA', directiveId: 'momentum-roc', weightMultiplier: 1.3, reason: 'NVDA trends persist longer than typical stocks' },
    { symbol: 'NVDA', directiveId: 'volume-confirmation', weightMultiplier: 1.2, reason: 'NVDA volume patterns are more informative for direction' },
    { symbol: 'NVDA', directiveId: 'news-sentiment', weightMultiplier: 1.8, reason: 'AI news cycle directly affects NVDA sentiment' },
    { symbol: 'BTCUSD', directiveId: 'session-timing-filter', weightMultiplier: 0.6, reason: 'Crypto trades 24/7 — traditional session boundaries matter less' },
    { symbol: 'BTCUSD', directiveId: 'volume-surge', weightMultiplier: 1.4, reason: 'BTC volume spikes precede larger moves than in forex' },
    { symbol: 'BTCUSD', directiveId: 'market-entropy', weightMultiplier: 1.2, reason: 'BTC regime shifts between trending and ranging matter more' },
    { symbol: 'EURUSD', directiveId: 'session-timing-filter', weightMultiplier: 1.3, reason: 'EUR/USD is heavily session-dependent — London/NY overlap is key' },
    { symbol: 'EURUSD', directiveId: 'ema-structure', weightMultiplier: 1.1, reason: 'EMA structure slightly more reliable on the most liquid forex pair' },
    { symbol: 'TECH100', directiveId: 'momentum-roc', weightMultiplier: 1.3, reason: 'Tech index momentum persists longer than other indices' },
    { symbol: 'TECH100', directiveId: 'volume-surge', weightMultiplier: 1.2, reason: 'Tech selloffs show distinct volume patterns' },
  ];

  let calCount = 0;
  for (const cal of calibrations) {
    await prisma.symbolCalibration.upsert({
      where: { symbol_directiveId: { symbol: cal.symbol, directiveId: cal.directiveId } },
      create: cal,
      update: cal,
    });
    calCount++;
  }
  console.log(`  ✓ ${calCount} symbol calibrations seeded.`);

  // Seed strategies from strategy-seeds.ts
  console.log('\nSeeding strategies…');
  let stratCount = 0;
  for (const seed of STRATEGY_SEEDS) {
    const existing = await prisma.strategy.findFirst({
      where: { name: seed.name },
    });

    let strategy;
    if (existing) {
      strategy = await prisma.strategy.update({
        where: { id: existing.id },
        data: {
          description: seed.description,
          config: {
            entryThreshold: 60,
            watchThreshold: 40,
            scope: seed.scope,
            templateType: seed.templateType || null,
            intendedTimeframe: seed.intendedTimeframe || null,
            symbols: seed.symbols || seed.scope,
            category: seed.category,
            riskLevel: seed.riskLevel,
            timeHorizon: seed.timeHorizon,
          },
        },
      });
    } else {
      strategy = await prisma.strategy.create({
        data: {
          name: seed.name,
          description: seed.description,
          version: '1.0.0',
          config: {
            entryThreshold: 60,
            watchThreshold: 40,
            scope: seed.scope,
            templateType: seed.templateType || null,
            intendedTimeframe: seed.intendedTimeframe || null,
            symbols: seed.symbols || seed.scope,
            category: seed.category,
            riskLevel: seed.riskLevel,
            timeHorizon: seed.timeHorizon,
          },
          active: true,
        },
      });
    }

    // Seed directives for this strategy
    for (const directiveId of seed.directiveIds) {
      const existing = await prisma.directive.findFirst({
        where: { strategyId: strategy.id, type: directiveId },
      });
      if (existing) {
        await prisma.directive.update({
          where: { id: existing.id },
          data: { active: true },
        });
      } else {
        await prisma.directive.create({
          data: {
            strategyId: strategy.id,
            name: directiveId,
            type: directiveId,
            weight: 1.0,
            config: {},
            active: true,
          },
        });
      }
    }

    stratCount++;
    console.log(`  ✓ ${seed.name} (${seed.directiveIds.length} directives)`);
  }
  console.log(`  ✓ ${stratCount} strategies seeded.`);
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
