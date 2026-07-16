/**
 * Backfill: populates scoringStrategyId on TradingStrategy rows
 * by matching on protocolId to find the corresponding ScoringStrategy.
 *
 * Usage:
 *   Push-Location nest
 *   $env:DATABASE_URL = "mysql://..."
 *   npx ts-node prisma/backfill-scoring-strategy-fk.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🔧 Backfilling scoringStrategyId on TradingStrategy...\n');

  // Get all trading strategies without a scoringStrategyId
  const tradingStrats = await (prisma as any).tradingStrategy.findMany({
    where: { scoringStrategyId: null },
    select: { id: true, name: true, protocolId: true, symbol: true },
  });

  console.log(`Found ${tradingStrats.length} trading strategies needing backfill\n`);

  if (tradingStrats.length === 0) {
    console.log('✅ All trading strategies already have scoringStrategyId. Nothing to do.');
    return;
  }

  let matched = 0;
  let skipped = 0;

  for (const ts of tradingStrats) {
    // Find a matching scoring strategy by protocolId
    const ss = await (prisma as any).scoringStrategy.findFirst({
      where: { protocolId: ts.protocolId },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, name: true },
    });

    if (ss) {
      await (prisma as any).tradingStrategy.update({
        where: { id: ts.id },
        data: { scoringStrategyId: ss.id },
      });
      console.log(`  ✅ ${ts.name} (${ts.symbol}) → ${ss.name}`);
      matched++;
    } else {
      console.log(`  ⚠️  ${ts.name} (${ts.symbol}): no ScoringStrategy found for protocol '${ts.protocolId}' — skipped`);
      skipped++;
    }
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`🔧 Backfill complete!`);
  console.log(`   Matched:  ${matched}`);
  console.log(`   Skipped:  ${skipped}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

main()
  .catch((e) => {
    console.error('Backfill failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
