#!/usr/bin/env node
/**
 * delete-directive.cjs — Cleanup/repair tooling for removing a directive.
 *
 * Deletes a directive from the database and reports remaining SOURCE
 * references that must be removed by hand (stub class, module registration,
 * group lists, suitability registry, seed data, controller maps).
 *
 * Usage:
 *   $env:DATABASE_URL = "mysql://tradingcs:tradingcs_dev_2026@localhost:3306/tradingcs"
 *   node scripts/delete-directive.cjs <directiveId>
 *
 * DB tables cleaned:
 *   - directive                                  (registry row)
 *   - global_setting                             (directive:{id}:* config keys)
 *   - protocol_directive_entry                   (per-protocol assignments)
 */
const { PrismaClient } = require('C:/wamp64/www/trading-command-suite/nest/node_modules/@prisma/client');

const id = process.argv[2];
if (!id) {
  console.error('Usage: node delete-directive.cjs <directiveId>');
  process.exit(1);
}

const prisma = new PrismaClient();

(async () => {
  console.log(`Deleting directive "${id}" from DB...\n`);

  // 1. protocol_directive_entry (per-protocol assignments)
  const entries = await prisma.$executeRawUnsafe(
    `DELETE FROM protocol_directive_entry WHERE directiveId = ?`, id,
  );
  console.log(`  protocol_directive_entry rows deleted: ${entries}`);

  // 2. global_setting directive config keys
  const gs = await prisma.$executeRawUnsafe(
    `DELETE FROM global_setting WHERE \`key\` LIKE ?`, `directive:${id}:%`,
  );
  console.log(`  global_setting keys deleted: ${gs}`);

  // 3. directive table row
  const d = await prisma.$executeRawUnsafe(
    `DELETE FROM directive WHERE id = ?`, id,
  );
  console.log(`  directive rows deleted: ${d}`);

  await prisma.$disconnect();
  console.log('\nDone. Remember to also remove SOURCE references:');
  console.log('  - placeholder-directives.stub.ts (class)');
  console.log('  - directives.module.ts (import/providers/constructor/register)');
  console.log('  - directive-groups.ts');
  console.log('  - directive-suitability.registry.ts');
  console.log('  - directives.controller.ts (category + STUB_IDS maps)');
  console.log('  - protocols-seed-data.ts (use scripts/remove-seed-directive.cjs)');
})().catch((e) => { console.error(e.message); process.exit(1); });
