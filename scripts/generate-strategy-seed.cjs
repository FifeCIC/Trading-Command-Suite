#!/usr/bin/env node
/**
 * generate-strategy-seed.cjs — read the LIVE bot fleet and emit it as seed data.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS (#1258, 2026-11-13)
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * `strategy-seed-data.ts` declared THREE bots. The database held 75 (64 active). So a reinstall, a
 * `db push` accident, or moving to a second machine reduced the fleet to three — and the seed
 * endpoint reported `unchanged: 3`, which reads as success. The owner's own words: *"we do not want
 * to give my bots away."*
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHAT IT WRITES, AND WHY IT IS A SEPARATE FILE
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * `nest/src/modules/trading/strategy-seed-generated.local.ts` — every bot's NUMERIC TREATMENT, generated
 * from the rows. `strategy-seed-data.ts` then composes: its hand-written entries WIN over the
 * generated ones, keyed by `name`, because those carry `theory` prose a generator cannot invent.
 *
 * ⚠️ WHY NOT EDIT `strategy-seed-data.ts` IN PLACE. It is hand-authored: three bots carry a
 * `theory` written from measurements, with comments explaining choices. A generator that rewrote it
 * would destroy that on the next run, and a file that is half-generated and half-authored cannot be
 * regenerated safely twice. Two files, one merge, no ambiguity about which is which.
 *
 * ⚠️ THE HONEST GAP THIS LEAVES. The generated entries have **no `theory`** — because none was
 * recorded for those bots, and manufacturing a plausible thesis is the prose form of this repo's
 * worst bug (a confident claim with nothing behind it). The file header says so, and the audit
 * (`report-bot-rule-coverage.cjs`) can count how many bots carry prose.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHAT IS DELIBERATELY NOT GENERATED
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 *   `id`             — per-install. Regenerated on every seed; `magic` is the stable handle.
 *   `slug`           — derived from `name` by `botSlug()` at write time.
 *   `duplicatedFromId` — A/B lineage, meaning only within one install.
 *   `createdAt` / `updatedAt` — bookkeeping.
 *   scores, trades, queue rows — history, not configuration.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * USAGE
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *   node scripts/generate-strategy-seed.cjs            # write the file
 *   node scripts/generate-strategy-seed.cjs --check    # exit 1 if the file is stale
 *   node scripts/generate-strategy-seed.cjs --stdout   # print, write nothing
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
// ── DECISION (2026-11-13, owner) — write to a GITIGNORED local path, never the tracked one ──
// WHAT:      The generator writes strategy-seed-generated.local.ts; the repo tracks nothing.
// WHY:       The repository is PUBLIC and the fleet's numbers ARE the strategies. 24e70aeb published
//            72 of them. Owner: *"avoid giving away all strategies."*
// INSTEAD OF: strategy-seed-generated.ts (tracked).
// REVERSE BY: Pointing this back at the tracked name — but do not, without making the repo private.
// REGISTER:  docs/SETTLED-DECISIONS.md row 177
const OUT = path.join(ROOT, 'nest', 'src', 'modules', 'trading', 'strategy-seed-generated.local.ts');
const HAND_AUTHORED = path.join(ROOT, 'nest', 'src', 'modules', 'trading', 'strategy-seed-data.ts');

function loadEnv() {
  const p = path.join(ROOT, 'nest', '.env');
  const env = {};
  if (!fs.existsSync(p)) return env;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  return env;
}

/**
 * Names declared by hand in `strategy-seed-data.ts` — those keep their prose and are skipped here.
 *
 * ⚠️ THE SLICE STARTS AT THE ARRAY, NOT AT THE EXPORT. `export const DEFAULT_TRADING_STRATEGIES`
 * is now the MERGE below the hand-authored list (#1258), so slicing from it found no entries and
 * every hand-authored bot was also generated — caught by `--check` reporting the file stale, which
 * is exactly what that flag is for. Keep this anchored on the literal the author writes.
 */
function handAuthoredNames() {
  const src = fs.readFileSync(HAND_AUTHORED, 'utf8');
  const start = src.indexOf('const HAND_AUTHORED_TRADING_STRATEGIES');
  if (start === -1) {
    // A silent empty set would generate duplicates of the prose-carrying bots. Say so, loudly.
    throw new Error(
      'strategy-seed-data.ts does not declare HAND_AUTHORED_TRADING_STRATEGIES — the generator ' +
        'cannot tell hand-authored bots from generated ones, so it refuses rather than duplicating them',
    );
  }
  const body = src.slice(start);
  return new Set([...body.matchAll(/^\s{4}name: '([^']+)'/gm)].map((m) => m[1]));
}

const num = (v) => (typeof v === 'bigint' ? Number(v) : v);
const lit = (v) => {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return String(v);
  return `'${String(v).replace(/'/g, "\\'")}'`;
};

/**
 * sessionWindow: the DB stores `'all-hours'`, a JSON array of tags, or NULL.
 *
 * ⚠️ NULL is written here as `'all-hours'` WITH A COMMENT SAYING SO — deliberately, not silently.
 * The seed type excludes `null` (#982: every entry must DECLARE its slot), and per the docblock in
 * `strategy-seed-data.ts` the gate treats `'all-hours'` and NULL identically, so behaviour is
 * unchanged. Emitting `'all-hours'` without the note would turn "nobody chose" into "chose all
 * hours", which is the same defect class as a default wearing a rule's clothes.
 */
function sessionLiteral(raw) {
  if (raw === null || raw === undefined) return { code: `'all-hours'`, note: 'null in the database (unfilled) → all-hours, which the gate treats identically' };
  if (raw === 'all-hours' || raw === 'bypass') return { code: `'all-hours'`, note: null };
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return { code: `[${arr.map((t) => `'${t}'`).join(', ')}]`, note: null };
  } catch { /* fall through */ }
  return { code: `'all-hours'`, note: `unparseable sessionWindow ${JSON.stringify(raw)} → all-hours` };
}

/**
 * buildEntries() — pure. (rows, subscriptions, skipNames) → the entry objects.
 *
 * Pure so `--check` and `--stdout` produce byte-identical output to the write path, and so a
 * self-test can drive it with fabricated rows.
 */
function buildEntries(rows, subsByBot, skipNames) {
  const out = [];
  for (const r of rows) {
    if (skipNames.has(r.name)) continue;
    const subs = subsByBot[r.id] || [];
    const legs = subs
      .filter((s) => s.protocolId !== r.protocolId)
      .map((s) => ({ protocolId: s.protocolId, role: s.role }));
    const ses = sessionLiteral(r.sessionWindow);
    out.push({
      name: r.name,
      symbol: r.symbol,
      magic: num(r.magic),
      protocolId: r.protocolId,
      brokerId: r.brokerId,
      mode: r.mode,
      timeframe: r.timeframe,
      baseSize: num(r.baseSize),
      slPct: num(r.slPct),
      tpPct: num(r.tpPct),
      minComposite: num(r.minComposite),
      sessionWindowCode: ses.code,
      sessionWindowNote: ses.note,
      requireDirection: r.requireDirection ?? null,
      maxHoldHours: r.maxHoldHours === null || r.maxHoldHours === undefined ? null : num(r.maxHoldHours),
      exitBeforeUtc: r.exitBeforeUtc ?? null,
      active: !!num(r.active),
      allocationAmount: r.allocationAmount === null ? null : num(r.allocationAmount),
      maxTradeRiskPct: r.maxTradeRiskPct === null ? null : num(r.maxTradeRiskPct),
      cooldownMinutes: num(r.cooldownMinutes),
      maxPyramidTiers: num(r.maxPyramidTiers),
      maxPositions: num(r.maxPositions),
      simTsl: num(r.simTslEnabled)
        ? { enabled: true, activationPct: num(r.simTslActivationPct), distancePct: num(r.simTslDistancePct) }
        : null,
      exhaustion: num(r.exhaustionObserveEnabled)
        ? { enabled: true, decelPct: r.exhaustionDecelPct === null ? null : num(r.exhaustionDecelPct) }
        : null,
      legs,
    });
  }
  return out;
}

/** render() — pure. entries → the TypeScript source. */
function render(entries) {
  const lines = [];
  lines.push(`/**`);
  lines.push(` * strategy-seed-generated.local.ts — ⚠️ GENERATED FILE, DO NOT EDIT BY HAND.`);
  lines.push(` * ⚠️ GITIGNORED ON PURPOSE: the numbers in this file ARE the strategies, and the`);
  lines.push(` * repository is public — so it is generated locally and never committed (#1258, register 177).`);
  lines.push(` *`);
  lines.push(` * Every bot in the live fleet, emitted from \`trading_strategy\` + \`strategy_protocol\` by`);
  lines.push(` * \`scripts/generate-strategy-seed.cjs\` on ${new Date().toISOString().slice(0, 10)}.`);
  lines.push(` *`);
  lines.push(` * Regenerate:  node scripts/generate-strategy-seed.cjs`);
  lines.push(` * Verify:      node scripts/generate-strategy-seed.cjs --check   (exit 1 when stale)`);
  lines.push(` *`);
  lines.push(` * ─────────────────────────────────────────────────────────────────────────────────────────`);
  lines.push(` * WHY THIS FILE EXISTS (#1258)`);
  lines.push(` *`);
  lines.push(` * \`strategy-seed-data.ts\` declared three bots; the database held ${entries.length + 3 > 0 ? '' : ''}the rest. A \`db push\``);
  lines.push(` * accident or a fresh install silently reduced the fleet to three, and the seed endpoint`);
  lines.push(` * reported \`unchanged: 3\` — which reads as success.`);
  lines.push(` *`);
  lines.push(` * \`strategy-seed-data.ts\` COMPOSES: its hand-written entries win over these, keyed by name,`);
  lines.push(` * because they carry \`theory\` prose a generator cannot invent.`);
  lines.push(` *`);
  lines.push(` * ⚠️ THESE ENTRIES CARRY NO \`theory\`, DELIBERATELY. None was recorded for these bots, and`);
  lines.push(` * writing a plausible thesis for a strategy that has none is the prose form of the defect`);
  lines.push(` * this repo keeps paying for — a confident claim with nothing behind it that stops anyone`);
  lines.push(` * looking. A bot with no theory is reported as such rather than given a fiction.`);
  lines.push(` *`);
  lines.push(` * ⚠️ Regenerating OVERWRITES this file. If a value must be hand-tuned, tune it in the`);
  lines.push(` * database and regenerate, or move the bot into \`strategy-seed-data.ts\` where prose and`);
  lines.push(` * hand-authority belong.`);
  lines.push(` */`);
  lines.push('');
  // ⚠️ import type — a VALUE import would make this file and strategy-seed-data.ts a runtime
  // cycle, because that file imports GENERATED_TRADING_STRATEGIES back. Type-only is erased.
  lines.push(`import type { SeedTradingStrategy } from './strategy-seed-data';`);
  lines.push('');
  lines.push(`export const GENERATED_TRADING_STRATEGIES: SeedTradingStrategy[] = [`);
  for (const e of entries) {
    lines.push(`  {`);
    lines.push(`    name: ${lit(e.name).replace(/^'|'$/g, "'").replace(/^'(.*)'$/, "'$1'")},`);
    lines.push(`    symbol: '${e.symbol}',`);
    lines.push(`    magic: ${e.magic},`);
    lines.push(`    protocolId: '${e.protocolId}',`);
    lines.push(`    brokerId: '${e.brokerId}',`);
    lines.push(`    mode: '${e.mode}',`);
    lines.push(`    timeframe: '${e.timeframe}',`);
    lines.push(`    baseSize: ${e.baseSize},`);
    lines.push(`    slPct: ${e.slPct},`);
    lines.push(`    tpPct: ${e.tpPct},`);
    lines.push(`    minComposite: ${e.minComposite},`);
    if (e.sessionWindowNote) lines.push(`    // sessionWindow: ${e.sessionWindowNote}`);
    lines.push(`    sessionWindow: ${e.sessionWindowCode},`);
    if (e.requireDirection) lines.push(`    requireDirection: '${e.requireDirection}',`);
    if (e.maxHoldHours !== null) lines.push(`    maxHoldHours: ${e.maxHoldHours},`);
    if (e.exitBeforeUtc) lines.push(`    exitBeforeUtc: '${e.exitBeforeUtc}',`);
    if (!e.active) lines.push(`    active: false,`);
    if (e.allocationAmount !== null) lines.push(`    allocationAmount: ${e.allocationAmount},`);
    if (e.maxTradeRiskPct !== null) lines.push(`    maxTradeRiskPct: ${e.maxTradeRiskPct},`);
    if (e.cooldownMinutes !== 5) lines.push(`    cooldownMinutes: ${e.cooldownMinutes},`);
    if (e.maxPyramidTiers !== 1) lines.push(`    maxPyramidTiers: ${e.maxPyramidTiers},`);
    if (e.maxPositions !== 1) lines.push(`    maxPositions: ${e.maxPositions},`);
    if (e.simTsl) lines.push(`    simTsl: { enabled: true, activationPct: ${e.simTsl.activationPct}, distancePct: ${e.simTsl.distancePct} },`);
    if (e.exhaustion) {
      lines.push(`    exhaustionObserveEnabled: true,`);
      if (e.exhaustion.decelPct !== null) lines.push(`    exhaustionDecelPct: ${e.exhaustion.decelPct},`);
    }
    if (e.legs.length) {
      lines.push(`    // #1185 — additional direction leg(s), read from \`strategy_protocol\`.`);
      lines.push(`    legs: [${e.legs.map((l) => `{ protocolId: '${l.protocolId}', role: '${l.role}' }`).join(', ')}],`);
    }
    lines.push(`  },`);
  }
  lines.push(`];`);
  lines.push('');
  return lines.join('\n');
}

// ── self-test ─────────────────────────────────────────────────────────────────────────────────
if (process.argv.includes('--self-test')) {
  let pass = 0;
  const fails = [];
  const check = (name, fn) => { try { fn() ? pass++ : fails.push(name); } catch (e) { fails.push(`${name} (${e.message})`); } };

  const row = (o = {}) => ({
    id: 'r1', name: 'Test Bot', symbol: 'XAUUSD', magic: 234100, protocolId: 'p-long', brokerId: 'mt5',
    mode: 'auto', timeframe: '5m', baseSize: 0.01, slPct: 1, tpPct: 2, minComposite: 10,
    sessionWindow: '["us"]', requireDirection: 'BUY', maxHoldHours: 24, exitBeforeUtc: null,
    active: 1, allocationAmount: null, maxTradeRiskPct: 20, cooldownMinutes: 5, maxPyramidTiers: 1,
    maxPositions: 1, simTslEnabled: 0, simTslActivationPct: null, simTslDistancePct: null,
    exhaustionObserveEnabled: 0, exhaustionDecelPct: null, ...o,
  });

  check('hand-authored names are SKIPPED (they keep their prose)', () => {
    const e = buildEntries([row()], {}, new Set(['Test Bot']));
    return e.length === 0;
  });
  check('a plain row becomes one entry with its numbers', () => {
    const e = buildEntries([row()], {}, new Set());
    return e.length === 1 && e[0].baseSize === 0.01 && e[0].slPct === 1 && e[0].magic === 234100;
  });
  check('NULL sessionWindow becomes all-hours WITH a note — not silently', () => {
    const e = buildEntries([row({ sessionWindow: null })], {}, new Set());
    return e[0].sessionWindowCode === "'all-hours'" && /unfilled/.test(e[0].sessionWindowNote || '');
  });
  check('a JSON tag array is preserved', () => {
    const e = buildEntries([row({ sessionWindow: '["asian"]' })], {}, new Set());
    return e[0].sessionWindowCode === "['asian']";
  });
  check('additional subscriptions become legs, the primary does NOT', () => {
    const subs = { r1: [{ protocolId: 'p-long', role: 'long' }, { protocolId: 'p-short', role: 'short' }] };
    const e = buildEntries([row()], subs, new Set());
    return e[0].legs.length === 1 && e[0].legs[0].protocolId === 'p-short';
  });
  check('an inactive bot is carried as active:false, not dropped', () => {
    const e = buildEntries([row({ active: 0 })], {}, new Set());
    return e.length === 1 && e[0].active === false;
  });
  check('render emits a valid-looking TS array with one entry per bot', () => {
    const src = render(buildEntries([row(), row({ id: 'r2', name: 'Second' })], {}, new Set()));
    return (src.match(/^  \{$/gm) || []).length === 2 && src.includes('GENERATED_TRADING_STRATEGIES');
  });
  check('render states that the entries carry no theory — the honest gap', () => {
    const src = render(buildEntries([row()], {}, new Set()));
    return /NO `theory`, DELIBERATELY/.test(src);
  });

  const total = pass + fails.length;
  for (const f of fails) console.error(`  FAIL  ${f}`);
  console.log(`  ${pass}/${total} passed`);
  process.exit(fails.length ? 1 : 0);
}

// ── main ─────────────────────────────────────────────────────────────────────────────────────
if (process.argv.includes('--stdout') || process.argv.includes('--check')) {
  // `--check` needs no database: it compares the FILE against a fresh render only when a DB is
  // reachable. Without one it reports UNVERIFIED rather than passing — a check that inspects
  // nothing and reports OK is worse than no check.
}

(async () => {
  const env = loadEnv();
  if (!env.DATABASE_URL) {
    console.error('✖ nest/.env has no DATABASE_URL — cannot read the fleet. UNVERIFIED, not OK.');
    process.exit(2);
  }
  process.env.DATABASE_URL = env.DATABASE_URL;
  const { PrismaClient } = require(path.resolve(ROOT, 'nest', 'node_modules', '@prisma/client'));
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.$queryRawUnsafe(`
      SELECT id, name, symbol, magic, protocolId, brokerId, mode, timeframe,
             baseSize, slPct, tpPct, minComposite, sessionWindow, requireDirection,
             maxHoldHours, exitBeforeUtc, active, allocationAmount, maxTradeRiskPct,
             cooldownMinutes, maxPyramidTiers, maxPositions,
             simTslEnabled, simTslActivationPct, simTslDistancePct,
             exhaustionObserveEnabled, exhaustionDecelPct
      FROM trading_strategy ORDER BY symbol, name`);
    const subs = await prisma.$queryRawUnsafe(`SELECT strategyId, protocolId, role FROM strategy_protocol`);
    const subsByBot = {};
    for (const s of subs) (subsByBot[s.strategyId] = subsByBot[s.strategyId] || []).push(s);

    const entries = buildEntries(rows, subsByBot, handAuthoredNames());
    const src = render(entries);

    if (process.argv.includes('--stdout')) { process.stdout.write(src); await prisma.$disconnect(); return; }

    if (process.argv.includes('--check')) {
      if (!fs.existsSync(OUT)) { console.error('✖ stale — the generated seed does not exist'); process.exit(1); }
      // Compare the ENTRY SECTION only: the header carries the generation DATE, which changes daily
      // and would fail the check every midnight for no reason. A date is not a claim about content.
      const strip = (s) => s.slice(s.indexOf('export const GENERATED_TRADING_STRATEGIES'));
      if (strip(fs.readFileSync(OUT, 'utf8')) !== strip(src)) {
        console.error('✖ stale — regenerate: node scripts/generate-strategy-seed.cjs');
        process.exit(1);
      }
      console.log(`✅ generated seed is current (${entries.length} bots)`);
      await prisma.$disconnect();
      return;
    }

    fs.writeFileSync(OUT, src);
    console.log(`✅ wrote ${path.relative(ROOT, OUT)} — ${entries.length} bot(s) from the live fleet`);
    console.log(`   ${rows.length - entries.length} bot(s) skipped (hand-authored in strategy-seed-data.ts)`);
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
})().catch((e) => { console.error(`✖ ${e.message}`); process.exit(1); });
