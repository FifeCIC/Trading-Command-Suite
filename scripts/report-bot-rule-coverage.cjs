#!/usr/bin/env node
/**
 * report-bot-rule-coverage.cjs — "is THIS bot actually configured, or is it just wearing the
 * defaults?" and "which bots are the same bot twice?"
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS (owner question, 2026-11-13)
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * > *"does that also mean that you've registered the inclusion of the rule as a setting for every
 * > bot, within the database? Rather than it being a default, for every bot? … are they ALL
 * > defaulting to ALL rules and does that also mean they're all using the same values for most
 * > rules rather than us having the option to tweak rules on a per bot basis?"*
 *
 * Both halves are answerable only by reading the rows, and the honest answer on 2026-11-13 was
 * **worse than expected**: `maxTradeRiskPct` was NULL on all 64 active bots (so the newest knob was
 * a default for everyone), `params` was NULL on all 489 directive entries (so every directive
 * instance ran its module default), and seven bots on one protocol were byte-identical.
 *
 * None of that errored or looked wrong in any single screen. It is the repo's recurring shape —
 * plausible configuration, no error, nothing underneath — and it needs a table, not a paragraph.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHAT IT REPORTS, AND WHY EACH ANSWER IS A DIFFERENT QUESTION
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 *   1. PER-RULE COVERAGE — for each behavioural column: how many active bots hold an EXPLICIT value
 *      vs inherit a default. A rule with 0 explicit values and N bots is a default for everyone.
 *      ⚠️ `non-null` is NOT the same as "configured": `maxPositions` reads 64/64 non-null yet has
 *      ONE distinct value, i.e. 64 bots agreeing is indistinguishable from 64 bots never choosing.
 *      So distinct-value counts are printed beside it — same trap as a status column that is
 *      always its default.
 *
 * REGISTER: docs/SETTLED-DECISIONS.md row 172 · ISSUE: #1257 (the ceiling), #1165 (scoring params)
 *
 *   2. IDENTICAL BOTS — bots grouped by their full effective treatment. A group of 7 with 1 variant
 *      is 7 copies of one configuration; a group of 14 with 3 variants is a family. That number is
 *      the difference between a fleet and a duplicate list, and nothing else reports it.
 *
 *   3. PROTOCOL SHARING — which protocols are used by more than one active bot. Directive VALUES
 *      live on `protocol_directive_entry` (per PROTOCOL, not per bot), so every bot on one protocol
 *      scores identically no matter how its own columns are set. This is the load-bearing fact
 *      behind "can I tweak a rule per bot": for scoring, no — not without a protocol copy.
 *
 * ⚠️ READ-ONLY. No write path, no `--fix`. Choosing a per-bot value is an operator decision.
 */
const fs = require('fs');
const path = require('path');

function loadEnv() {
  const envPath = path.join(__dirname, '..', 'nest', '.env');
  const env = {};
  if (!fs.existsSync(envPath)) return env;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  return env;
}

const num = (v) => (typeof v === 'bigint' ? Number(v) : v);
const isNull = (v) => v === null || v === undefined;

/**
 * groupIdentical() — pure. Bots → [{ key, bots: [] }] grouped by effective treatment.
 *
 * `keyFields` is passed in so the caller decides what "identical" means, and a self-test can drive
 * it with fabricated rows. Effective treatment folds NULL into the label `<inherit>` so two bots that
 * both inherit are correctly reported as identical rather than as "differing in NULL".
 */
function groupIdentical(bots, keyFields) {
  const groups = new Map();
  for (const b of bots) {
    const key = keyFields.map((f) => (isNull(b[f]) ? '<inherit>' : String(b[f]))).join(' | ');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(b);
  }
  return [...groups.entries()]
    .map(([key, members]) => ({ key, bots: members }))
    .sort((a, b) => b.bots.length - a.bots.length || a.key.localeCompare(b.key));
}

/** coverageRows() — pure. [{ field, total, nonNull, distinct }] → the table rows, incl. the verdict. */
function coverageRows(stats) {
  return stats.map((s) => {
    let verdict;
    if (s.nonNull === 0) verdict = 'DEFAULT FOR EVERYONE — no bot sets it';
    else if (s.distinct <= 1) verdict = 'ONE VALUE — indistinguishable from a default';
    else if (s.nonNull < s.total) verdict = `PARTIAL — ${s.total - s.nonNull} bot(s) inherit`;
    else verdict = 'PER-BOT — every bot has a value and they differ';
    return { ...s, verdict };
  });
}

// ── self-test ─────────────────────────────────────────────────────────────────────────────────
if (process.argv.includes('--self-test')) {
  let pass = 0;
  const fail = [];
  const check = (name, fn) => {
    try { fn() ? pass++ : fail.push(name); } catch (e) { fail.push(`${name} (${e.message})`); }
  };

  check('identical bots group together — NULL folds to <inherit>', () => {
    const g = groupIdentical(
      [{ n: 'a', v: null }, { n: 'b', v: null }, { n: 'c', v: 2 }],
      ['v'],
    );
    return g.length === 2 && g[0].bots.length === 2 && g[0].key === '<inherit>';
  });

  check('a differing value splits the group', () => {
    const g = groupIdentical([{ v: 1 }, { v: 2 }], ['v']);
    return g.length === 2 && g.every((x) => x.bots.length === 1);
  });

  check('the key uses EVERY field it is given, not just the first', () => {
    const g = groupIdentical([{ a: 1, b: 1 }, { a: 1, b: 2 }], ['a', 'b']);
    return g.length === 2;
  });

  check('coverage: zero explicit values is reported as a default for everyone', () => {
    const r = coverageRows([{ field: 'x', total: 64, nonNull: 0, distinct: 0 }]);
    return /DEFAULT FOR EVERYONE/.test(r[0].verdict);
  });

  check('coverage: 64 non-null with ONE distinct value is NOT reported as configured', () => {
    // The real measurement that motivated this: `maxPositions` is 64/64 non-null, 1 distinct.
    const r = coverageRows([{ field: 'maxPositions', total: 64, nonNull: 64, distinct: 1 }]);
    return /ONE VALUE/.test(r[0].verdict);
  });

  check('coverage: partial is named as partial', () => {
    const r = coverageRows([{ field: 'x', total: 64, nonNull: 40, distinct: 4 }]);
    return /PARTIAL/.test(r[0].verdict);
  });

  check('coverage: a genuinely per-bot rule reads PER-BOT', () => {
    const r = coverageRows([{ field: 'slPct', total: 64, nonNull: 64, distinct: 8 }]);
    return /PER-BOT/.test(r[0].verdict);
  });

  const total = pass + fail.length;
  for (const f of fail) console.error(`  FAIL  ${f}`);
  if (fail.length) {
    console.error(`\n${pass}/${total} passed`);
    process.exit(1);
  }
  console.log(`  ${pass}/${total} passed`);
  process.exit(0);
}

// ── live report ───────────────────────────────────────────────────────────────────────────────
const env = loadEnv();
if (!env.DATABASE_URL) {
  console.error('✖ nest/.env has no DATABASE_URL — cannot read the database (this is NOT "no bots").');
  process.exit(2);
}
process.env.DATABASE_URL = env.DATABASE_URL;

const { PrismaClient } = require(path.resolve(__dirname, '..', 'nest', 'node_modules', '@prisma/client'));
const prisma = new PrismaClient();

/** The columns a bot actually trades with. Kept here (not imported) so a schema change is visible. */
const BEHAVIOURAL = [
  'baseSize', 'slPct', 'tpPct', 'minComposite', 'maxTradeRiskPct', 'sizingModel', 'sizingRiskPct',
  'maxSize', 'maxPositions', 'maxHoldHours', 'cooldownMinutes', 'maxPyramidTiers', 'takeProfitAmount',
  'allocationAmount', 'requireDirection', 'minRarityBand', 'timeframe', 'maxDailyLoss',
];
/** What makes two bots the SAME bot: the size, the exits, the bar and the risk ceiling. */
const IDENTITY_FIELDS = ['baseSize', 'slPct', 'tpPct', 'minComposite', 'maxTradeRiskPct', 'maxHoldHours', 'timeframe'];

(async () => {
  const bots = await prisma.$queryRawUnsafe(
    `SELECT id, name, symbol, ${BEHAVIOURAL.map((c) => `\`${c}\``).join(', ')}
     FROM trading_strategy WHERE active = 1 ORDER BY symbol, name`,
  );

  console.log(`\n═══ ACTIVE BOTS: ${bots.length} ═══\n`);

  // 1 — per-rule coverage
  const stats = [];
  for (const field of BEHAVIOURAL) {
    const nonNull = bots.filter((b) => !isNull(b[field])).length;
    const distinct = new Set(bots.filter((b) => !isNull(b[field])).map((b) => String(b[field]))).size;
    stats.push({ field, total: bots.length, nonNull, distinct });
  }
  console.log('PER-RULE COVERAGE  (non-null ≠ configured — read "distinct")');
  console.log('  rule                 non-null  distinct  verdict');
  for (const r of coverageRows(stats)) {
    console.log(
      `  ${r.field.padEnd(20)} ${String(r.nonNull).padStart(5)}/${String(r.total).padEnd(3)} ${String(r.distinct).padStart(7)}  ${r.verdict}`,
    );
  }

  // 2 — identical bots
  const groups = groupIdentical(bots, IDENTITY_FIELDS);
  const dupes = groups.filter((g) => g.bots.length > 1);
  const redundant = dupes.reduce((s, g) => s + g.bots.length - 1, 0);
  console.log(`\nIDENTICAL BOTS  (grouped by ${IDENTITY_FIELDS.join(', ')})`);
  console.log(`  ${groups.length} distinct configuration(s) across ${bots.length} bots — ${redundant} bot(s) duplicate another`);
  for (const g of dupes.slice(0, 8)) {
    console.log(`  ×${g.bots.length}  ${g.key}`);
    for (const b of g.bots.slice(0, 4)) console.log(`        · ${b.symbol}  ${b.name}`);
    if (g.bots.length > 4) console.log(`        · … ${g.bots.length - 4} more`);
  }

  // 3 — protocol sharing (directive values are per-PROTOCOL, so this bounds per-bot control)
  const share = await prisma.$queryRawUnsafe(`
    SELECT sp.protocolId, COUNT(DISTINCT sp.strategyId) bots
    FROM strategy_protocol sp JOIN trading_strategy ts ON ts.id = sp.strategyId AND ts.active = 1
    GROUP BY sp.protocolId HAVING bots > 1 ORDER BY bots DESC`);
  console.log('\nPROTOCOL SHARING  (directive VALUES live on the protocol, not the bot)');
  for (const s of share) console.log(`  ${String(s.protocolId).padEnd(30)} ${String(num(s.bots)).padStart(2)} active bots share one scoring configuration`);

  const params = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) total, SUM(params IS NOT NULL) withParams FROM protocol_directive_entry WHERE active = 1`,
  );
  const pTotal = num(params[0].total);
  const pSet = num(params[0].withParams);
  console.log(
    `  directive entries with an explicit params blob: ${pSet}/${pTotal}` +
      (pSet === 0 ? '  ← every instance runs its MODULE DEFAULT' : ''),
  );

  const noSub = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*) n FROM trading_strategy ts
    WHERE ts.active = 1 AND NOT EXISTS (SELECT 1 FROM strategy_protocol sp WHERE sp.strategyId = ts.id)`);
  console.log(`  active bots with NO protocol subscription (can never receive a signal): ${num(noSub[0].n)}`);

  // 4 — SEED COVERAGE (#1258). A bot that exists only in the database is lost on any reinstall, and
  // nothing else reports that: `seedDefaults()` converges what it is given and says nothing about
  // what it was never given.
  const seedSrc = fs.readFileSync(
    path.join(__dirname, '..', 'nest', 'src', 'modules', 'trading', 'strategy-seed-data.ts'), 'utf8');
  const genPath = path.join(__dirname, '..', 'nest', 'src', 'modules', 'trading', 'strategy-seed-generated.ts');
  const genSrc = fs.existsSync(genPath) ? fs.readFileSync(genPath, 'utf8') : '';
  const seededNames = new Set(
    [...(seedSrc + genSrc).matchAll(/^\s+name: '([^']+)'/gm)].map((m) => m[1]),
  );
  const inSeed = bots.filter((b) => seededNames.has(b.name));
  const missing = bots.filter((b) => !seededNames.has(b.name));
  console.log('\nSEED COVERAGE  (a bot absent from the seed is lost on reinstall — #1258)');
  console.log(`  active bots in the database : ${bots.length}`);
  console.log(`  …present in the seed        : ${inSeed.length}`);
  console.log(`  …seed entries with no bot   : ${seededNames.size - inSeed.length} (created on the next install)`);
  if (missing.length) {
    console.log(`  ⚠️ ${missing.length} active bot(s) exist ONLY in the database:`);
    for (const b of missing.slice(0, 12)) console.log(`      ${b.symbol} ${b.name}`);
    if (missing.length > 12) console.log(`      … ${missing.length - 12} more`);
    console.log('  → run: node scripts/generate-strategy-seed.cjs');
  } else {
    console.log('  ✅ every active bot is in the seed');
  }

  console.log('');
  await prisma.$disconnect();
})().catch((e) => {
  console.error(`✖ ${e.message}`);
  prisma.$disconnect().catch(() => {});
  process.exit(1);
});
