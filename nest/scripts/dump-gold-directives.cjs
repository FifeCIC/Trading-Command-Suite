#!/usr/bin/env node
// Dump metadata for the 12 GOLD-protocol directives (issue #637 matrix input).
const fs = require('fs');
const path = require('path');

const IMPL = 'C:/wamp64/www/trading-command-suite/nest/src/modules/directives/implementations';
const WANT = new Set([
  'speed-momentum', 'bollinger-band-squeeze', 'volume-confirmation',
  'volatility-tools', 'rsi-oversold', 'rsi-overbought',
  'support-resistance-levels', 'session-open-effect', 'gold-round-numbers',
  'gold-macro-correlation', 'gold-session-profile', 'liquidity-check',
]);

const out = [];
for (const f of fs.readdirSync(IMPL).filter((x) => x.endsWith('.ts'))) {
  const s = fs.readFileSync(path.join(IMPL, f), 'utf8');
  const ids = [...s.matchAll(/readonly\s+id\s*=\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
  const hit = ids.find((i) => WANT.has(i));
  if (!hit) continue;
  const grab = (re) => { const m = s.match(re); return m ? m[1].trim() : '?'; };
  out.push([
    hit,
    grab(/readonly\s+maxScore\s*=\s*([^;]+);/),
    grab(/readonly\s+minScore\s*=\s*([^;]+);/),
    grab(/readonly\s+readiness\s*=\s*['"]([^'"]+)['"]/),
    grab(/readonly\s+directionBias\s*=\s*['"]([^'"]+)['"]/),
    grab(/readonly\s+signalClass\s*=\s*['"]([^'"]+)['"]/),
    f,
  ]);
}

for (const row of out.sort((a, b) => a[0].localeCompare(b[0]))) {
  console.log(row.join(' | '));
}
console.log('\nFound ' + out.length + ' of ' + WANT.size + ' wanted directives.');
