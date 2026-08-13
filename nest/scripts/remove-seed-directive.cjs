// One-off mechanical removal of a directive id from protocols-seed-data.ts.
// Handles the "last element in array" comma correctly.
const fs = require('fs');
const FILE = 'C:/wamp64/www/trading-command-suite/nest/src/modules/scoring/protocols-seed-data.ts';
const DIRECTIVE = process.argv[2];
if (!DIRECTIVE) { console.error('Usage: node remove-seed-directive.cjs <directiveId>'); process.exit(1); }

let text = fs.readFileSync(FILE, 'utf8');
const lines = text.split('\n');
const out = [];
let removed = 0;
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const m = line.match(/^(\s*)"([a-z0-9-]+)"(,)?\r?$/);
  if (m && m[2] === DIRECTIVE) {
    removed++;
    const hadComma = !!m[3];
    if (!hadComma && out.length > 0) {
      // It was the last element — strip trailing comma from the previous line
      out[out.length - 1] = out[out.length - 1].replace(/,(\s*)$/, '$1');
    }
    continue; // drop the line
  }
  out.push(line);
}
fs.writeFileSync(FILE, out.join('\n'));
console.log(`Removed ${removed} occurrences of "${DIRECTIVE}" from ${FILE}`);
