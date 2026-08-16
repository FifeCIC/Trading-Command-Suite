#!/usr/bin/env node
/**
 * prune-orphan-entries.cjs — one-off for issue #619.
 * Deletes protocol_directive_entry rows whose directiveId is no longer present
 * in ANY seed group (orphaned by the #626 protocol cleanup). The seed upsert
 * never deletes removed directives, so these rows would otherwise linger with
 * stale maxScores and confuse the maxScore audit.
 */

process.env.DATABASE_URL = 'mysql://tradingcs:tradingcs_dev_2026@localhost:3306/tradingcs';
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const SEED = 'C:/wamp64/www/trading-command-suite/nest/src/modules/scoring/protocols-seed-data.ts';
const seedSrc = fs.readFileSync(SEED, 'utf8');
const seedIds = new Set();
{
  const groupRe = /"directiveIds":\s*\[([^\]]*)\]/g;
  const idRe = /"([^"]+)"/g;
  let m;
  while ((m = groupRe.exec(seedSrc)) !== null) {
    let im;
    while ((im = idRe.exec(m[1])) !== null) seedIds.add(im[1]);
  }
}

(async () => {
  const rows = await prisma.protocolDirectiveEntry.findMany({ select: { id: true, directiveId: true } });
  const orphaned = rows.filter((r) => !seedIds.has(r.directiveId));
  console.log(`Total entries: ${rows.length}; orphaned (not in seed): ${orphaned.length}`);
  for (const o of orphaned) console.log(`  deleting ${o.directiveId} (${o.id})`);
  if (orphaned.length > 0) {
    const del = await prisma.protocolDirectiveEntry.deleteMany({
      where: { id: { in: orphaned.map((o) => o.id) } },
    });
    console.log(`Deleted ${del.count} orphaned entries.`);
  }
  await prisma.$disconnect();
})();
