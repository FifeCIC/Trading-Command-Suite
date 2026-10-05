// SCRATCH — how many "unreferenced" nodes are actually called SOMEWHERE under the same name?
// A name match is not a reference (see the five `placeOrder` declarations), but a node with ZERO
// name occurrences outside its own file is a much stronger candidate for genuinely dead code.
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'nest', 'src');

const report = fs.readFileSync(path.join(ROOT, 'logs', 'phase2-report.md'), 'utf8');
const start = report.indexOf('## Nodes with no consumer');
const rows = report.slice(start).split('\n').filter((l) => /^- `nest/.test(l))
  .map((l) => { const m = l.match(/^- `([^:]+):(\d+) (\S+)`/); return m && { file: m[1], line: +m[2], name: m[3] }; })
  .filter(Boolean);

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.isDirectory()) walk(path.join(d, e.name));
    else if (/\.ts$/.test(e.name) && !/\.spec\.ts$/.test(e.name)) files.push(path.join(d, e.name));
  }
})(SRC);

let calledByName = 0;
const examples = [];
for (const r of rows) {
  const re = new RegExp(`(?<![\\w$.])${r.name.replace(/[$]/g, '\\$')}\\s*\\(`, 'g');
  let hits = 0;
  for (const f of files) {
    const rel = path.relative(ROOT, f).replace(/\\/g, '/');
    if (rel === r.file) continue;              // its own file proves nothing
    hits += (fs.readFileSync(f, 'utf8').match(re) || []).length;
  }
  if (hits > 0) { calledByName++; if (examples.length < 12) examples.push(`${r.file}:${r.line} ${r.name} — ${hits} same-name call(s) elsewhere`); }
}
console.log(`unreferenced nodes        : ${rows.length}`);
console.log(`with a same-name call     : ${calledByName}   <-- either a resolver gap or a same-name sibling`);
console.log(`with NO same-name call    : ${rows.length - calledByName}   <-- the strong candidates for genuinely dead`);
console.log('\nsample of the ambiguous ones:');
for (const e of examples) console.log('  ' + e);
