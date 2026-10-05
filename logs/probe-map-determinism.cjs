// SCRATCH — is the pipeline map DETERMINISTIC? Compare a before/after pair section by section.
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');

const before = JSON.parse(fs.readFileSync(path.join(ROOT, 'logs', 'map-before.json'), 'utf8'));
const after = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'PIPELINE-MAP.json'), 'utf8'));

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

for (const key of ['scanned', 'pipeline']) {
  console.log(`${key}: ${same(before[key], after[key]) ? 'SAME' : 'DIFFERENT'}`);
}
console.log(`resources: ${same(before.resources, after.resources) ? 'SAME' : 'DIFFERENT'}`);

const b2 = before.phase2 || {};
const a2 = after.phase2 || {};
for (const key of ['tsFiles', 'declarations', 'sites', 'files', 'mathsGroups', 'maths', 'nodes', 'unreferenced']) {
  const ok = same(b2[key], a2[key]);
  let detail = '';
  if (!ok && Array.isArray(b2[key]) && Array.isArray(a2[key])) {
    detail = `  lengths ${b2[key].length} -> ${a2[key].length}`;
    if (b2[key].length === a2[key].length) {
      const firstDiff = b2[key].findIndex((v, i) => !same(v, a2[key][i]));
      detail += `  first differing index ${firstDiff}`;
      detail += `\n     before: ${JSON.stringify(b2[key][firstDiff]).slice(0, 300)}`;
      detail += `\n     after : ${JSON.stringify(a2[key][firstDiff]).slice(0, 300)}`;
    }
  }
  console.log(`phase2.${key}: ${ok ? 'SAME' : 'DIFFERENT'}${detail}`);
}
