/**
 * Probe: what would changing the base bar window actually affect?
 *
 * WHY THIS EXISTS (#1013). The base (live) cadence window is sized by
 * `getRequiredBars(slug)[tf] ?? getRequiredBars(slug)['1d'] ?? N` in THREE places.
 * `??` is a fall-through, but the documented intent is a MAXIMUM — 74 of 108
 * directives declare their real requirement under the generic key `'1d'` because
 * a directive cannot know the runtime cadence.
 *
 * Changing that resolution changes what a scored symbol scores, so it must not be
 * applied blind. This probe enumerates every protocol, computes the window today
 * and under the proposed rule, and reports exactly which protocols would change
 * and by how much. Read-only: writes nothing.
 *
 * Run:  node logs/probe-bar-window.cjs
 */
const fs = require('fs');
const path = require('path');

const NEST = path.resolve(__dirname, '..', 'nest');
const DIST = path.join(NEST, 'dist', 'src');
const IMPL = path.join(DIST, 'modules', 'directives', 'implementations');

if (!fs.existsSync(DIST)) {
  console.log(`dist not found at ${DIST} — build first (npm --prefix nest run build:api).`);
  process.exit(2);
}

const { selectBaseTimeframe } = require(path.join(DIST, 'common', 'utils', 'timeframe.js'));

// ── 1. directive id -> minBars, from the compiled classes ──────────────────
const minBarsById = new Map();
let instCount = 0;
let instFailed = 0;
for (const f of fs.readdirSync(IMPL).filter((x) => x.endsWith('.js') && !x.includes('.spec.'))) {
  let mod;
  try { mod = require(path.join(IMPL, f)); } catch { continue; }
  for (const cls of Object.values(mod)) {
    if (typeof cls !== 'function') continue;
    try {
      const inst = new cls();
      if (inst && inst.id && inst.minBars) { minBarsById.set(inst.id, inst.minBars); instCount++; }
    } catch { instFailed++; }
  }
}
console.log(`directives instantiated: ${instCount} (with minBars), ${instFailed} threw on construction\n`);

// ── 2. protocol -> directive ids, from the seed ────────────────────────────
// The seed is the composition source of truth: ProtocolDbService's cache is built
// from it (the DB's protocol_directive_entry.groupId is orphaned from
// protocol_directive_group.groupId, so the DB cannot answer this).
let seed = null;
for (const cand of ['protocols-seed-data', 'protocol-seed-data', 'protocols-seed']) {
  const p = path.join(DIST, 'modules', 'scoring', `${cand}.js`);
  if (!fs.existsSync(p)) continue;
  try { seed = require(p); } catch { continue; }
  if (seed) { console.log(`seed module: ${cand}.js — exports: ${Object.keys(seed).join(', ')}\n`); break; }
}
if (!seed) {
  console.log('seed module not found in dist — cannot enumerate composition. Exports seen:');
  const dir = path.join(DIST, 'modules', 'scoring');
  console.log(fs.readdirSync(dir).filter((x) => /seed/i.test(x)).join('\n') || '  (none matching /seed/)');
  process.exit(3);
}

// Find the slug -> protocol map whatever it is called, then normalise its groups.
const protocols = (() => {
  for (const v of Object.values(seed)) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
    const first = Object.values(v)[0];
    if (first && typeof first === 'object' && (first.groups || first.directives)) return v;
  }
  return null;
})();

if (!protocols) {
  const sample = Object.values(seed).find((v) => v && typeof v === 'object');
  console.log('could not identify the protocol map. Sample shape:');
  console.log(JSON.stringify(sample, null, 2).slice(0, 1200));
  process.exit(4);
}

const directiveIdsOf = (proto) => {
  const out = new Set();
  const groups = proto.groups ?? proto.directiveGroups ?? [];
  if (Array.isArray(groups)) {
    for (const g of groups) for (const d of g.directiveIds ?? g.directives ?? []) out.add(typeof d === 'string' ? d : d.id);
  }
  if (Array.isArray(proto.directives)) for (const d of proto.directives) out.add(typeof d === 'string' ? d : d.id);
  return [...out];
};

const requiredBarsOf = (proto) => {
  const required = {};
  for (const did of directiveIdsOf(proto)) {
    const mb = minBarsById.get(did);
    if (!mb) continue;
    for (const [tf, n] of Object.entries(mb)) required[tf] = Math.max(required[tf] || 0, n);
  }
  return Object.keys(required).length ? required : { '1d': 100 };
};

// ── 3. compare ─────────────────────────────────────────────────────────────
const rows = [];
for (const [slug, proto] of Object.entries(protocols)) {
  if (!proto || typeof proto !== 'object') continue;
  const tf = selectBaseTimeframe(proto.recommendedTimeframe) || '5m';
  const required = requiredBarsOf(proto);
  const current = required[tf] ?? required['1d'] ?? 100;
  const proposed = Math.max(required[tf] ?? 0, required['1d'] ?? 0) || 100;
  rows.push({ slug, tf, base: required[tf] ?? null, generic: required['1d'] ?? null, current, proposed, changed: current !== proposed });
}

const changed = rows.filter((r) => r.changed);
console.log(`protocols: ${rows.length}   CHANGED by the proposed rule: ${changed.length}\n`);
const pad = (s, n) => String(s).padEnd(n);
console.log(`  ${pad('protocol', 30)} ${pad('tf', 5)} ${pad('base', 6)} ${pad('1d', 6)} ${pad('now', 6)} ${pad('proposed', 9)} delta`);
console.log('  ' + '-'.repeat(76));
for (const r of changed.sort((a, b) => (b.proposed - b.current) - (a.proposed - a.current))) {
  console.log(`  ${pad(r.slug, 30)} ${pad(r.tf, 5)} ${pad(r.base ?? '-', 6)} ${pad(r.generic ?? '-', 6)} ${pad(r.current, 6)} ${pad(r.proposed, 9)} +${r.proposed - r.current}`);
}
console.log('\n  Unchanged protocols are unaffected by construction: when base >= 1d the');
console.log('  max equals today\'s value, and when base is absent the max equals 1d.');
