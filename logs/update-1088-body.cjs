// Tick #1088's five acceptance boxes in its body (#1088 close-out).
const fs = require('fs');
const j = JSON.parse(fs.readFileSync('logs/1088-body.json', 'utf8'));
let b = j.body;
const prefixes = [
  '- [ ] Decide the source of truth',
  '- [ ] A weekday holiday on the FX venue reports',
  '- [ ] The correction is',
  '- [ ] Leave any early-close handling explicit',
  '- [ ] Guard: a canary proving',
];
for (const t of prefixes) {
  if (!b.includes(t)) { console.error('MISSING: ' + t); process.exit(1); }
  b = b.replace(t, t.replace('- [ ]', '- [x]'));
}
fs.writeFileSync('logs/1088-body-new.md', b, 'utf8');
console.log('ticked 5 acceptance boxes');
