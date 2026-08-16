#!/usr/bin/env node
/**
 * verify-seed-maxscores.cjs — one-off verification for issue #619.
 * Compares every protocol_directive_entry.maxScore in the DB against the
 * directive class maxScore (extracted from source). Expects zero mismatches.
 */

const fs = require('fs');
const path = require('path');

const NEST = 'C:/wamp64/www/trading-command-suite/nest';
const IMPL = path.join(NEST, 'src', 'modules', 'directives', 'implementations');

// 1. Extract id → maxScore from every directive source file (standalone + stub + mt5).
const classMax = {};
for (const f of fs.readdirSync(IMPL).filter((f) => f.endsWith('.ts'))) {
  const src = fs.readFileSync(path.join(IMPL, f), 'utf8');
  const ids = [...src.matchAll(/readonly\s+id\s*=\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
  const maxes = [...src.matchAll(/readonly\s+maxScore\s*=\s*(\d+)/g)].map((m) => parseInt(m[1], 10));
  if (ids.length !== maxes.length) {
    console.warn(`WARN ${f}: ${ids.length} ids vs ${maxes.length} numeric maxScores — skipped pairing`);
    continue;
  }
  ids.forEach((id, i) => { classMax[id] = maxes[i]; });
}
console.log(`Extracted ${Object.keys(classMax).length} class id→maxScore mappings`);

// 2. Query the DB.
process.env.DATABASE_URL = 'mysql://tradingcs:tradingcs_dev_2026@localhost:3306/tradingcs';
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  const rows = await prisma.protocolDirectiveEntry.findMany({
    select: { directiveId: true, maxScore: true },
  });
  const mismatches = [];
  for (const r of rows) {
    const expected = classMax[r.directiveId];
    if (expected === undefined) mismatches.push(`${r.directiveId}: DB=${r.maxScore} (no class mapping)`);
    else if (expected !== r.maxScore) mismatches.push(`${r.directiveId}: DB=${r.maxScore}, class=${expected}`);
  }
  console.log(`DB entries: ${rows.length}`);
  if (mismatches.length === 0) {
    console.log('PASS — every protocol_directive_entry.maxScore matches the directive class maxScore.');
  } else {
    console.log(`MISMATCHES (${mismatches.length}):`);
    for (const m of mismatches) console.log('  ' + m);
  }
  await prisma.$disconnect();
})();
