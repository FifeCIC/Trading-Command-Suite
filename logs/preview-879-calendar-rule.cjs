// Preview (#879 criterion 3): classes using CALENDAR getters (day/month/year) that emit a
// non-zero score and do NOT carry a MEASURED citation. This is the candidate build rule
// (INV-NO-UNMEASURED-CALENDAR-CLAIM); measure its blast radius before wiring it into prebuild.
const fs = require('fs');
const path = require('path');
const ROOT = 'C:\\wamp64\\www\\trading-command-suite\\nest\\src\\modules\\directives\\implementations';
const CALENDAR = /get(?:UTC)?(?:Day|Month|FullYear)\s*\(|getUTCDate\s*\(|getDate\s*\(/;
const MEASURED = /MEASURED/i;

function stripComments(s) { return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, ''); }

for (const f of fs.readdirSync(ROOT)) {
  if (!/\.(directive|stub|directives)\.ts$/.test(f)) continue;
  const raw = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const src = stripComments(raw);
  // class split
  const re = /export\s+class\s+(\w+)[^{]*\{/g;
  const starts = [];
  let m;
  while ((m = re.exec(src)) !== null) starts.push({ name: m[1], at: m.index });
  for (let i = 0; i < starts.length; i++) {
    const body = src.slice(starts[i].at, i + 1 < starts.length ? starts[i + 1].at : src.length);
    const idm = body.match(/readonly\s+id\s*=\s*'([^']+)'/);
    if (!idm) continue;
    if (!CALENDAR.test(body)) continue;
    // any non-zero literal score?
    let nonZero = false;
    for (const sm of body.matchAll(/score\s*:\s*([^\n,}]+)/g)) {
      const e = sm[1].trim();
      if (e === '0') continue;
      if (/^\d/.test(e) && Number(e) > 0) { nonZero = true; break; }
      // ternary with any non-zero literal
      if (/\?[^:]*\d/.test(e) || /\d[^:]*:/.test(e)) { nonZero = true; break; }
    }
    const hasMeasured = MEASURED.test(raw);
    console.log(`${nonZero ? (hasMeasured ? 'MEASURED ' : '**UNMEASURED**') : 'zero-only '} ${idm[1].padEnd(30)} ${f}`);
  }
}
