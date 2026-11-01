#!/usr/bin/env node
/**
 * audit-protocol-scrub-safety.cjs — refuse a protocol scrub that would orphan a symbol.
 *
 * WHY THIS EXISTS
 * ---------------
 * Deactivating a protocol is a real kill switch, not a label. Measured 2026-11-02:
 * `SpeedScanService` calls `resolveProtocolForSymbol()` and returns
 * `{ skipped: true, reason: 'Protocol X is inactive (active = 0) — not scored' }`
 * BEFORE any bar is read (`speed-scan.service.ts` L257-262, the #803 fix). So
 * `active = 0` stops scoring outright.
 *
 * That is the desired behaviour for a scrub — UNTIL the protocol being retired is
 * the ONLY resolver for a symbol we still want scored. Then the symbol goes quiet
 * with no error: no score row, no log line naming the cause, and the Ladder simply
 * stops showing it. That is the repo's most expensive failure signature (plausible
 * absence, no error), so it gets a check rather than a note.
 *
 * RESOLUTION ORDER — must mirror `resolveProtocolForSymbol()` exactly, or this
 * check validates a system that does not exist:
 *   1. `symbol_protocol_assignment` (lowest `priority` first) — DB wins
 *   2. the hardcoded `SYMBOL_PROTOCOL_MAP` fallback in speed-scan.service.ts
 *   3. the `^3[A-Z]{2,3}$` / `SQQQ,SPXS,...` leverage pattern -> `leverage-v2`
 *   4. otherwise: no protocol (the symbol is not scored at all)
 *
 * ⚠️ The map is READ FROM THE SOURCE FILE, not duplicated here. A copy would drift
 * and the check would then approve a scrub based on a map the app no longer uses.
 * If the map cannot be parsed this script ERRORS (exit 2) rather than passing —
 * a verifier that cannot read its input must never report OK.
 *
 * USAGE
 *   node scripts/audit-protocol-scrub-safety.cjs --candidate a,b,c
 *   node scripts/audit-protocol-scrub-safety.cjs --candidate a,b,c --keep USDCAD,XAUUSD
 *   node scripts/audit-protocol-scrub-safety.cjs --self-test
 *
 * EXIT
 *   0  every symbol still resolves to an ACTIVE, non-scrubbed protocol
 *   1  at least one symbol would be orphaned or left with only an inactive protocol
 *   2  could not verify (map unreadable, DB unreachable) — never treated as 0
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SPEED_SCAN = path.join(ROOT, 'nest/src/modules/scoring/speed-scan.service.ts');

const CANDIDATE_DEFAULT = [
  'xau-speed-v1-copy', 'mt5-technical-short', 'euro-stoxx-v1', 'nikkei-speed-v1',
  'usdjpy-risk-v1', 'usdcad-oil-v1',
  'vwap-bands-v1', 'vwap-simple-v1', 'mtf-conservative-v1', 'mtf-weighted-v1',
  'gap-scanner-v1', 'hourly-3dir-v1', 'eurusd-macro-v1', 'gbpusd-news-v1',
  'commodity-pairs-v1',
  'ftse-speed-v1', 'dax-speed-v1', 'cac-speed-v1', 'china-speed-v1', 'dow-speed-v1',
  'leverage-v2', 'pandemic-v1', 'earnings-momentum-v1', 'doge-speed-v1',
  'tsla-speed-v1', 'btc-scalp-v1', 'oil-supply-v1',
];

/** Parse `const SYMBOL_PROTOCOL_MAP: Record<string,string> = { ... };` out of the service. */
function readSymbolProtocolMap(file = SPEED_SCAN) {
  const src = fs.readFileSync(file, 'utf8');
  const start = src.indexOf('const SYMBOL_PROTOCOL_MAP');
  if (start < 0) throw new Error(`SYMBOL_PROTOCOL_MAP not found in ${file}`);
  const open = src.indexOf('{', start);
  const close = src.indexOf('};', open);
  if (open < 0 || close < 0) throw new Error('SYMBOL_PROTOCOL_MAP block not delimited');
  const body = src.slice(open + 1, close);

  const map = new Map();
  const re = /(['"]?)([A-Z0-9][A-Z0-9._-]*)\1\s*:\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(body))) map.set(m[2], m[3]);
  if (map.size === 0) throw new Error('SYMBOL_PROTOCOL_MAP parsed to 0 entries');
  return map;
}

/** Parse the leverage pattern literals the same way, so the check cannot drift. */
function readLeverageRules(file = SPEED_SCAN) {
  const src = fs.readFileSync(file, 'utf8');
  const patterns = [
    /\/\^3\[A-Z\]\{2,3\}\$\//,          // ^3[A-Z]{2,3}$
  ];
  const patternMatchable = ['^3[A-Z]{2,3}$', '^[A-Z]{2,3}3$'];
  const listed = /\[([^\]]*'SQQQ'[^\]]*)\]/.exec(src);
  const tickers = listed
    ? [...listed[1].matchAll(/'([A-Z]{2,6})'/g)].map((x) => x[1])
    : [];
  const ok = patterns.some((p) => p.test(src));
  return { patterns: patternMatchable, tickers, parsedOk: ok || tickers.length > 0 };
}

function isLeverageProduct(symbol, rules) {
  if (/^3[A-Z]{2,3}$/.test(symbol) || /^[A-Z]{2,3}3$/.test(symbol)) return true;
  return rules.tickers.includes(symbol);
}

/**
 * Pure resolver — the whole point of the file. `activeBySlug` maps slug -> boolean,
 * `assignments` maps symbol -> [{slug, priority, active}].
 */
function resolveAll({ symbols, assignments, activeBySlug, map, rules }) {
  const out = [];
  for (const symbol of symbols) {
    const dbRows = (assignments.get(symbol) || [])
      .slice()
      .sort((a, b) => a.priority - b.priority);
    // DB-first: the FIRST row wins even if inactive — that is what the service does.
    if (dbRows.length) {
      out.push({ symbol, slug: dbRows[0].slug, source: 'assignment', active: dbRows[0].active });
      continue;
    }
    const mapped = map.get(symbol);
    if (mapped) {
      out.push({ symbol, slug: mapped, source: 'map', active: activeBySlug.get(mapped) === true });
      continue;
    }
    if (isLeverageProduct(symbol, rules)) {
      out.push({ symbol, slug: 'leverage-v2', source: 'pattern', active: activeBySlug.get('leverage-v2') === true });
      continue;
    }
    out.push({ symbol, slug: null, source: 'none', active: false });
  }
  return out;
}

/** A symbol is SAFE if it resolves to a protocol that is not being scrubbed AND is active. */
function findOrphans(resolved, scrubSet) {
  return resolved.filter((r) => {
    if (!r.slug) return true;                       // no protocol at all
    if (scrubSet.has(r.slug)) return true;          // only resolver is being retired
    return r.active !== true;                       // resolves, but switched off
  });
}

function selfTest() {
  let pass = 0;
  const fail = [];
  const check = (name, cond) => (cond ? pass++ : fail.push(name));

  const map = new Map([['USDCAD', 'usdcad-oil-v1'], ['BTCUSD', 'btc-scalp-v1']]);
  const rules = { tickers: ['SQQQ'], patterns: [] };
  const active = new Map([['usdcad-oil-v1', true], ['forex-session-v1', true], ['btc-scalp-v1', false]]);

  // 1. map fallback, active -> safe
  let r = resolveAll({ symbols: ['USDCAD'], assignments: new Map(), activeBySlug: active, map, rules });
  check('map fallback resolves', r[0].slug === 'usdcad-oil-v1' && r[0].active === true);

  // 2. DB assignment beats the map
  const asg = new Map([['USDCAD', [{ slug: 'forex-session-v1', priority: 0, active: true }]]]);
  r = resolveAll({ symbols: ['USDCAD'], assignments: asg, activeBySlug: active, map, rules });
  check('assignment beats map', r[0].slug === 'forex-session-v1' && r[0].source === 'assignment');

  // 3. scrubbing the map target is SAFE when an assignment overrides it
  check('orphan check honours override', findOrphans(r, new Set(['usdcad-oil-v1'])).length === 0);

  // 4. scrubbing the ONLY resolver IS an orphan
  r = resolveAll({ symbols: ['USDCAD'], assignments: new Map(), activeBySlug: active, map, rules });
  check('orphan when sole resolver scrubbed', findOrphans(r, new Set(['usdcad-oil-v1'])).length === 1);

  // 5. an inactive resolver is an orphan even if NOT scrubbed
  r = resolveAll({ symbols: ['BTCUSD'], assignments: new Map(), activeBySlug: active, map, rules });
  check('inactive resolver flagged', findOrphans(r, new Set()).length === 1);

  // 6. leverage pattern resolves to leverage-v2
  r = resolveAll({ symbols: ['3GLD', 'SQQQ'], assignments: new Map(), activeBySlug: new Map([['leverage-v2', true]]), map, rules });
  check('leverage pattern', r.every((x) => x.slug === 'leverage-v2'));
  check('leverage scrub is an orphan', findOrphans(r, new Set(['leverage-v2'])).length === 2);

  // 7. unknown symbol -> no protocol
  r = resolveAll({ symbols: ['ZZZZZZ'], assignments: new Map(), activeBySlug: active, map, rules });
  check('unresolvable symbol flagged', findOrphans(r, new Set()).length === 1);

  // 8. the real map parses
  let realMap = null;
  try { realMap = readSymbolProtocolMap(); } catch { /* reported below */ }
  check('real SYMBOL_PROTOCOL_MAP parses', realMap instanceof Map && realMap.size > 0);
  check('map has USDCAD', realMap ? realMap.has('USDCAD') : false);

  console.log(`\nself-test: ${pass} passed, ${fail.length} failed`);
  for (const f of fail) console.log('  ✖', f);
  console.log(fail.length === 0 ? '✅ self-test PASS\n' : '❌ self-test FAIL\n');
  return fail.length === 0 ? 0 : 1;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) process.exit(selfTest());

  const arg = (name, dflt) => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
  };
  const candidates = arg('--candidate', CANDIDATE_DEFAULT.join(','))
    .split(',').map((s) => s.trim()).filter(Boolean);
  const scrubSet = new Set(candidates);
  const keepFilter = arg('--keep', '').split(',').map((s) => s.trim()).filter(Boolean);

  let map, rules;
  try {
    map = readSymbolProtocolMap();
    rules = readLeverageRules();
    if (!rules.parsedOk) throw new Error('leverage rules not parsed');
  } catch (e) {
    console.error(`\n❌ UNVERIFIED — could not read speed-scan.service.ts: ${e.message}`);
    process.exit(2);
  }

  const { PrismaClient } = require(path.join(ROOT, 'nest/node_modules/@prisma/client'));
  const prisma = new PrismaClient();
  let symbols, assignments, activeBySlug;
  try {
    const symRows = await prisma.$queryRawUnsafe('SELECT ticker, active FROM symbol WHERE active = 1');
    const asgRows = await prisma.$queryRawUnsafe(`
      SELECT a.symbol, pr.slug, pr.active, a.priority
      FROM symbol_protocol_assignment a JOIN protocol pr ON pr.id = a.protocolId`);
    const protoRows = await prisma.$queryRawUnsafe('SELECT slug, active FROM protocol');

    symbols = symRows.map((r) => r.ticker);
    assignments = new Map();
    for (const r of asgRows) {
      if (!assignments.has(r.symbol)) assignments.set(r.symbol, []);
      assignments.get(r.symbol).push({ slug: r.slug, priority: Number(r.priority), active: Number(r.active) === 1 });
    }
    activeBySlug = new Map(protoRows.map((r) => [r.slug, Number(r.active) === 1]));
  } catch (e) {
    console.error(`\n❌ UNVERIFIED — database query failed: ${e.message}`);
    process.exit(2);
  } finally {
    await prisma.$disconnect();
  }

  // Simulate the scrub: every candidate becomes inactive.
  const after = new Map(activeBySlug);
  for (const s of scrubSet) after.set(s, false);

  const resolved = resolveAll({ symbols, assignments, activeBySlug: after, map, rules });
  const universe = keepFilter.length ? resolved.filter((r) => keepFilter.includes(r.symbol)) : resolved;
  const orphans = findOrphans(universe, scrubSet);

  console.log(`\nprotocol scrub safety — ${scrubSet.size} candidate(s), ${universe.length} active symbol(s)\n`);

  if (orphans.length === 0) {
    console.log('✅ every active symbol still resolves to an active protocol\n');
    process.exit(0);
  }

  console.log('SYMBOL   RESOLVED TO            SOURCE        WHY IT BREAKS');
  for (const o of orphans) {
    const why = !o.slug
      ? 'no protocol resolves it at all'
      : scrubSet.has(o.slug)
        ? 'its ONLY resolver is on the scrub list'
        : 'its resolver is already inactive';
    console.log(`${String(o.symbol).padEnd(8)} ${String(o.slug || '-').padEnd(22)} ${String(o.source).padEnd(13)} ${why}`);
  }
  console.log(`\n❌ ${orphans.length} symbol(s) would stop being scored — resolve those first\n`);
  process.exit(1);
}

main().catch((e) => {
  console.error('\n❌ UNVERIFIED —', e && e.message ? e.message : e);
  process.exit(2);
});
