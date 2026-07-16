/**
 * Seed script: populates the Protocol, ProtocolDirectiveGroup,
 * ProtocolDirectiveEntry, and SymbolProtocolAssignment tables
 * from the hardcoded PROTOCOL_REGISTRY and SYMBOL_PROTOCOL_MAP.
 *
 * Idempotent — safe to run multiple times. Uses upsert.
 *
 * Usage:
 *   $env:DATABASE_URL = "mysql://..."
 *   npx ts-node prisma/seed-protocols.ts
 *
 * Phase A.1 of META.Stack Architecture Refactor (#398)
 */

import { PrismaClient } from '@prisma/client';
import {
  PROTOCOL_REGISTRY,
  DIRECTIVE_GROUPS,
  SHORT_DIRECTIVE_GROUPS,
  BTC_SPEED_GROUPS,
} from '../src/modules/directives/directive-groups';

const prisma = new PrismaClient();

// ── Symbol→Protocol mapping (from speed-scan.service.ts) ──
const SYMBOL_PROTOCOL_MAP: Record<string, string> = {
  BTCUSD: 'btc-scalp-v1',
  'BTC-USD': 'btc-scalp-v1',
  ETHUSD: 'btc-scalp-v1',
  'ETH-USD': 'btc-scalp-v1',
  SOLUSD: 'btc-scalp-v1',
  XAUUSD: 'xau-speed-v1',
  XAGUSD: 'xau-speed-v1',
  USOIL: 'oil-speed-v1',
  UKOIL: 'oil-speed-v1',
  NATGAS: 'oil-speed-v1',
  SPX500: 'spy-speed-v1',
  SPY: 'spy-speed-v1',
  TECH100: 'qqq-speed-v1',
  QQQ: 'qqq-speed-v1',
  US30: 'dow-speed-v1',
  DJI: 'dow-speed-v1',
};

async function main() {
  console.log('🌱 Seeding Protocol tables from PROTOCOL_REGISTRY...\n');

  let protocolCount = 0;
  let groupCount = 0;
  let entryCount = 0;
  let assignmentCount = 0;

  for (const [slug, proto] of Object.entries(PROTOCOL_REGISTRY)) {
    // ── Upsert Protocol ──
    const protocol = await prisma.protocol.upsert({
      where: { slug },
      create: {
        slug,
        name: proto.name,
        description: proto.description ?? null,
        directionMode: proto.directionMode ?? 'LONG_ONLY',
        tradingStyle: proto.tradingStyle ?? null,
        recommendedTimeframe: proto.recommendedTimeframe ?? null,
        avgHoldTime: proto.avgHoldTime ?? null,
        winRateTarget: proto.winRateTarget ?? null,
        idealFor: proto.idealFor ?? null,
        isDefault: slug === 'built-in-default',
        seasonalAffinity: proto.seasonalAffinity
          ? (JSON.parse(JSON.stringify(proto.seasonalAffinity)) as any)
          : undefined,
      },
      update: {
        name: proto.name,
        description: proto.description ?? null,
        directionMode: proto.directionMode ?? 'LONG_ONLY',
        tradingStyle: proto.tradingStyle ?? null,
        recommendedTimeframe: proto.recommendedTimeframe ?? null,
        avgHoldTime: proto.avgHoldTime ?? null,
        winRateTarget: proto.winRateTarget ?? null,
        idealFor: proto.idealFor ?? null,
        seasonalAffinity: proto.seasonalAffinity
          ? (JSON.parse(JSON.stringify(proto.seasonalAffinity)) as any)
          : undefined,
      },
    });
    protocolCount++;
    console.log(`  ✅ Protocol: ${slug} (${proto.name})`);

    // ── Upsert Directive Groups ──
    const groups = proto.groups;
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      const dbGroup = await prisma.protocolDirectiveGroup.upsert({
        where: { protocolId_groupId: { protocolId: protocol.id, groupId: group.id } },
        create: {
          protocolId: protocol.id,
          groupId: group.id,
          name: group.name,
          description: group.description ?? null,
          weight: group.weight,
          isRiskGate: group.isRiskGate,
          minMultiplier: group.minMultiplier,
          maxMultiplier: group.maxMultiplier,
          sortOrder: i,
        },
        update: {
          name: group.name,
          description: group.description ?? null,
          weight: group.weight,
          isRiskGate: group.isRiskGate,
          minMultiplier: group.minMultiplier,
          maxMultiplier: group.maxMultiplier,
          sortOrder: i,
        },
      });
      groupCount++;
      console.log(`     📁 Group: ${group.id} (${group.name})`);

      // ── Upsert Directive Entries ──
      for (const directiveId of group.directiveIds) {
        const maxScore = group.directiveMaxScores?.[directiveId] ?? 100;
        await prisma.protocolDirectiveEntry.upsert({
          where: { groupId_directiveId: { groupId: dbGroup.id, directiveId } },
          create: {
            groupId: dbGroup.id,
            directiveId,
            maxScore,
          },
          update: { maxScore },
        });
        entryCount++;
      }
      console.log(`        📄 ${group.directiveIds.length} directives`);
    }
  }

  // ── Seed Symbol→Protocol Assignments ──
  console.log('\n🔗 Seeding Symbol→Protocol assignments...');
  for (const [symbol, protocolSlug] of Object.entries(SYMBOL_PROTOCOL_MAP)) {
    const protocol = await prisma.protocol.findUnique({ where: { slug: protocolSlug } });
    if (!protocol) {
      console.log(`  ⚠️  Protocol '${protocolSlug}' not found for symbol ${symbol} — skipping`);
      continue;
    }
    await prisma.symbolProtocolAssignment.upsert({
      where: { symbol_protocolId: { symbol, protocolId: protocol.id } },
      create: {
        symbol,
        protocolId: protocol.id,
        priority: 0,
      },
      update: {},
    });
    assignmentCount++;
  }
  console.log(`  ✅ ${assignmentCount} symbol→protocol assignments`);

  // ── Summary ──
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🌱 Seed complete!');
  console.log(`   Protocols:          ${protocolCount}`);
  console.log(`   Directive Groups:   ${groupCount}`);
  console.log(`   Directive Entries:  ${entryCount}`);
  console.log(`   Symbol Assignments: ${assignmentCount}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
