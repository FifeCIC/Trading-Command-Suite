/**
 * logs/pm-debug.cjs — why does the Prisma path find nothing?
 * Measure the layers separately: raw file → after stripComments → regex matches → table mapping.
 */
const fs = require('node:fs');
const path = require('node:path');
const { stripComments } = require('../nest/scripts/lib/comment-stripper.cjs');

const ROOT = path.resolve(__dirname, '..');
const f = path.join(ROOT, 'nest', 'src', 'modules', 'market-data', 'market-data.service.ts');
const raw = fs.readFileSync(f, 'utf8');
const stripped = stripComments(raw);

console.log('== raw length      :', raw.length);
console.log('== stripped length :', stripped.length, stripped.length === raw.length ? '(same)' : `(LOST ${raw.length - stripped.length} chars)`);

const RECEIVER = /prisma(?:\s+as\s+any\))?\.(\w+)\.(\w+)\s*\(/g;
const RECEIVER_OLD = /\bprisma\.(\w+)\.(\w+)\s*\(/g;

console.log('\n== marketBar call sites, RAW text      :', (raw.match(/marketBar\.\w+/g) || []).length);
console.log('== marketBar call sites, STRIPPED text :', (stripped.match(/marketBar\.\w+/g) || []).length);
console.log('== receiver regex on STRIPPED          :', [...stripped.matchAll(RECEIVER)].length);
console.log('== old receiver regex on STRIPPED      :', [...stripped.matchAll(RECEIVER_OLD)].length);

console.log('\n== first 6 receiver matches on the STRIPPED text ==');
for (const m of [...stripped.matchAll(RECEIVER)].slice(0, 6)) {
  console.log(`   ${m[1]}.${m[2]}`);
}

console.log('\n== does stripComments keep a known line? ==');
const probe = 'const a = 1; // note about marketBar\nconst b = await this.prisma.marketBar.findMany();';
console.log('   input :', JSON.stringify(probe));
console.log('   output:', JSON.stringify(stripComments(probe)));

// ── THE NEXT LAYER: does the model map actually contain the key the call sites use? ──
const SCHEMA = path.join(ROOT, 'nest', 'prisma', 'schema.prisma');
const st = fs.readFileSync(SCHEMA, 'utf8');
const blocks = [...st.matchAll(/model\s+(\w+)\s*\{([\s\S]*?)\n\}/g)];
console.log('\n== schema models matched by the block regex :', blocks.length);
const camel = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const map = new Map();
for (const b of blocks) {
  const mapped = b[2].match(/@@map\("([^"]+)"\)/);
  map.set(camel(b[1]), mapped ? mapped[1] : b[1]);
}
console.log('== map size :', map.size);
console.log('== map.get("marketBar") :', JSON.stringify(map.get('marketBar')));
const realModel = /model\s+(\w*[Mm]arket[Bb]ar\w*)/.exec(st);
console.log('== the schema model is actually named :', realModel ? realModel[1] : '(NOT FOUND)');
console.log('== first 6 map keys :', [...map.keys()].slice(0, 6).join(', '));

