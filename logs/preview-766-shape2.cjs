// One-off (#766): preview of shape-2 extended to COMPUTED scores on could-not-measure
// paths. Mirrors validate-pipeline-contracts.cjs scanFabricatedReadings shape 2 exactly,
// but replaces the literal-only score match with a generic expression match, so we can
// count the blast radius before making the build gate stricter.
const fs = require('fs');
const path = require('path');
const ROOT = 'C:\\wamp64\\www\\trading-command-suite\\nest\\src\\modules\\directives\\implementations';

function isCommentLine(l) { return /^\s*(\/\/|\*|\/\*)/.test(l); }

const hits = [];
for (const f of fs.readdirSync(ROOT)) {
  if (!/\.(directive|stub|directives)\.ts$/.test(f) || /\.spec\.ts$/.test(f)) continue;
  const raw = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const rawLines = raw.split(/\r?\n/);
  const lines = rawLines.map((l) => (isCommentLine(l) ? '' : l.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')));
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/\breturn\s*\{/.test(line)) continue;
    const block = lines.slice(i, i + 12).join('\n');
    const reasonMatch = block.match(/reason\s*:\s*(`[^`]*`|'[^']*'|"[^"]*")/);
    if (!reasonMatch) continue;
    const reason = reasonMatch[1].toLowerCase().replace(/\$\{[^}]*\}/g, '25');
    const admitsNoData = /insufficient|no data|not enough|need \d+\+? bars|could not|failed|unavailable|not scored/.test(reason);
    if (!admitsNoData) continue;
    const scoreMatch = block.match(/\bscore\s*:\s*([^\n,}]+)/);
    if (!scoreMatch) continue;
    const expr = scoreMatch[1].trim();
    if (expr === '0') continue;
    const literal = /^-?\d+(\.\d+)?$/.test(expr);
    hits.push({ file: f, line: i + 1, expr, literal, reason: reasonMatch[1].slice(0, 90) });
  }
}
console.log(`${hits.length} hit(s):\n`);
for (const h of hits) console.log(`[${h.literal ? 'LITERAL' : 'COMPUTED'}] ${h.file}:${h.line}  score: ${h.expr}\n    reason: ${h.reason}`);
