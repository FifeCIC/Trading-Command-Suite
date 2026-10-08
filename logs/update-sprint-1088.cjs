// Sprint #1081 body update — mark #1088 fixed (2026-10-08).
const fs = require('fs');
const j = JSON.parse(fs.readFileSync('logs/1081-body.json', 'utf8'));
let b = j.body;
// The box may arrive already ticked (a concurrent editor touched the sprint minutes earlier —
// observed, not assumed). Accept either state and enrich the line with what actually landed.
const anchor = '#1088 **NEW (2026-10-08)**: the FX venue has NO holidays';
if (!b.includes(anchor)) { console.error('MISSING #1088 line'); process.exit(1); }
const start = b.indexOf(anchor);
const lineEnd = b.indexOf('\n', start);
const line = b.slice(start - 6, lineEnd); // include the `- [x] ` prefix
b = b.replace(line,
  '- [x] #1088 ✅ **FIXED 2026-10-08 —** the FX venue now has a holiday axis (curated table, register row 73); the WEEKLY-session path had none, so Christmas 2026 read OPEN for every index CFD, metal and FX pair. Verified live: `market-status?exchange=FX&at=2026-12-25` → **closed, named**. Family-specific holidays and early closes are consciously NOT guessed (declared on the issue). Same family as #850');
fs.writeFileSync('logs/1081-body-new.md', b, 'utf8');
console.log('sprint body updated');
