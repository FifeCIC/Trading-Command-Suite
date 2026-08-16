#!/usr/bin/env node
/**
 * strip-seed-maxscores.cjs — one-off cleanup for issue #619.
 *
 * Removes the now-dead per-protocol `directiveMaxScores` overrides from
 * `protocols-seed-data.ts`. Since the 2026-08-13 single-source refactor,
 * maxScore is derived from the directive class in
 * `protocol-db.service.ts#seedProtocolsToDatabase`, so these overrides are
 * dead data that can silently drift from the class values and confuse audits.
 *
 * Safety gate: before stripping, every `directiveId` referenced in the seed
 * is cross-checked against every `readonly id = '…'` defined in the
 * implementations dir (standalone files + stub + mt5-indicators). If any id
 * does not resolve, the script aborts without writing — because the class
 * value always wins, an unresolvable id would otherwise fall back to 100.
 *
 * Usage:  node nest/scripts/strip-seed-maxscores.cjs
 */

const fs = require('fs');
const path = require('path');

const NEST = path.resolve('C:/wamp64/www/trading-command-suite/nest');
const SEED_FILE = path.join(NEST, 'src', 'modules', 'scoring', 'protocols-seed-data.ts');
const IMPL_DIR = path.join(NEST, 'src', 'modules', 'directives', 'implementations');

function read(f) { return fs.readFileSync(f, 'utf8'); }

// ── 1. Enumerate all directive ids defined by any class in implementations/ ──
const definedIds = new Set();
const files = fs.readdirSync(IMPL_DIR).filter((f) => f.endsWith('.ts'));
for (const f of files) {
  const src = read(path.join(IMPL_DIR, f));
  const re = /readonly\s+id\s*=\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src)) !== null) definedIds.add(m[1]);
}

// ── 2. Enumerate all directiveIds referenced in the seed ──
const seedSrc = read(SEED_FILE);
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

const unresolved = [...seedIds].filter((id) => !definedIds.has(id));
console.log(`Seed directiveIds: ${seedIds.size}`);
console.log(`Defined directive classes: ${definedIds.size}`);
if (unresolved.length > 0) {
  console.error('ABORT — seed references directive ids with no defined class:');
  for (const id of unresolved) console.error('  - ' + id);
  process.exit(1);
}
console.log('All seed directiveIds resolve to a defined class. Safe to strip.');

// ── 3. Strip the dead directiveMaxScores blocks ──
const before = (seedSrc.match(/"directiveMaxScores":/g) || []).length;

// Interface field
let out = seedSrc.replace(/[ \t]*directiveMaxScores: Record<string, number>;\r?\n/, '');

// Field occurrences: always the LAST field of a group object, preceded by the
// closing bracket of `directiveIds` with a trailing comma. Remove the comma
// and the whole `"directiveMaxScores": {…}` block (values are flat numbers,
// so no nested braces).
out = out.replace(/,\r?\n[ \t]*"directiveMaxScores":\s*\{[^}]*\}/g, '');

const after = (out.match(/"directiveMaxScores":/g) || []).length;

if (after !== 0) {
  console.error(`ABORT — ${after} directiveMaxScores block(s) remain; regex incomplete.`);
  process.exit(1);
}

fs.writeFileSync(SEED_FILE, out);
console.log(`Stripped ${before} directiveMaxScores block(s). Remaining: ${after}.`);
