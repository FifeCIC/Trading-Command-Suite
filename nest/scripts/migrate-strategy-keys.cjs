#!/usr/bin/env node
/**
 * migrate-strategy-keys.cjs — move `strategy_registry` rows from key v1 to v2 (#1224).
 *
 * ⚠️ WHY THIS EXISTS. `strategyKey` is PERSISTED and `@unique` (prisma/schema.prisma). Until
 * 2026-11-07 the hash omitted every money field, so two bots could share an identity while differing
 * in their take profit, sizing model, simulated trailing stop, exhaustion observation or hot-stock
 * allocation. Measured: `DAX Five Pound Target Bot` and `DAX Index Tick Scalp Bot` hashed identically
 * with takeProfitAmount 5 vs null. Adding those fields to the hash changes EVERY key, which is why it
 * is a migration rather than an edit.
 *
 * WHAT IT DOES
 *   1. Derives the CURRENT (v2) key for every live bot, exactly as `deriveAll()` does — same
 *      `buildTreatment`, same `computeStrategyKey`, both imported from the compiled service so there
 *      is no second implementation to drift.
 *   2. Maps each `strategy_registry` row to its new key through `parts.botIds` (stable ids).
 *   3. Reports, or with `--apply` updates `strategyKey` in place.
 *
 * ⚠️ IT REFUSES RATHER THAN MERGES. If two registry rows resolve to the SAME new key, that is two
 * stored identities collapsing into one — a decision about which row keeps the name (#875), not
 * something a migration should guess. Those rows are listed and left untouched.
 *
 * ⚠️ ORPHANS ARE REPORTED, NOT DELETED. A row whose bots no longer exist keeps its old key: it is a
 * record of a configuration that was once registered, and the drift it will show is truthful.
 *
 * USAGE
 *   node scripts/migrate-strategy-keys.cjs              # dry run (the default)
 *   node scripts/migrate-strategy-keys.cjs --apply      # write
 *   node scripts/migrate-strategy-keys.cjs --self-test  # prove the resolver can fail
 */

'use strict';

const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const DIST = path.join(ROOT, 'nest', 'dist', 'src', 'modules', 'scoring', 'strategy-derivation.service.js');

function loadIdentity() {
  // eslint-disable-next-line global-require, import/no-dynamic-require
  const mod = require(DIST);
  const required = ['buildTreatment', 'computeStrategyKey', 'KEY_VERSION'];
  const missing = required.filter((k) => typeof mod[k] === 'undefined');
  if (missing.length) {
    throw new Error(
      `The compiled service is missing ${missing.join(', ')}. Build it first: npm --prefix nest run build:api`,
    );
  }
  return mod;
}

/**
 * resolveNewKeys() — PURE. bots → key per bot; rows → new key, or a reason it cannot be resolved.
 *
 * Kept pure so `--self-test` can prove every branch without a database: a resolver that has never
 * been observed to refuse is not a resolver.
 */
function resolveNewKeys(bots, rows, identity) {
  const { buildTreatment, computeStrategyKey } = identity;

  const keyByBotId = new Map();
  for (const bot of bots) {
    const treatment = buildTreatment(bot);
    const links = [];
    for (const sub of bot.protocols ?? []) links.push({ protocolId: sub.protocolId, role: sub.role || 'long' });
    if (links.length === 0) {
      if (bot.protocolId) links.push({ protocolId: bot.protocolId, role: 'long' });
      if (bot.shortProtocolId) links.push({ protocolId: bot.shortProtocolId, role: 'short' });
    }
    for (const link of links) {
      keyByBotId.set(
        bot.id,
        computeStrategyKey(link.protocolId, link.role, bot.symbol, bot.brokerId, treatment),
      );
    }
  }

  const resolved = [];
  for (const row of rows) {
    const botIds = Array.isArray(row.parts?.botIds) ? row.parts.botIds : [];
    const newKeys = [...new Set(botIds.map((id) => keyByBotId.get(id)).filter(Boolean))];
    if (newKeys.length === 0) {
      resolved.push({ id: row.id, name: row.name, oldKey: row.strategyKey, status: 'ORPHAN', newKey: null });
    } else if (newKeys.length > 1) {
      // The row's bots no longer belong to one identity — they were split by the wider hash.
      resolved.push({ id: row.id, name: row.name, oldKey: row.strategyKey, status: 'SPLIT', newKey: null, candidates: newKeys });
    } else {
      resolved.push({ id: row.id, name: row.name, oldKey: row.strategyKey, status: 'MAPPED', newKey: newKeys[0] });
    }
  }

  // Two stored rows collapsing into one new key is a MERGE — refused, never guessed.
  const byNewKey = new Map();
  for (const r of resolved) {
    if (r.status !== 'MAPPED') continue;
    if (!byNewKey.has(r.newKey)) byNewKey.set(r.newKey, []);
    byNewKey.get(r.newKey).push(r);
  }
  for (const [, group] of byNewKey) {
    if (group.length > 1) group.forEach((r) => { r.status = 'MERGE'; r.mergeWith = group.filter((o) => o !== r).map((o) => o.id); });
  }

  return resolved;
}

function selfTest(identity) {
  const bot = (id, over) => ({
    id, symbol: 'GER40', brokerId: 'mt5', protocolId: 'p1', shortProtocolId: null,
    minComposite: 10, baseSize: 0.1, slPct: 0.4, tpPct: 0.6, cooldownMinutes: 5,
    maxPyramidTiers: 1, timeframe: '5m', mode: 'auto', maxPositions: 1,
    useRaritySizing: true, protocols: [{ protocolId: 'p1', role: 'long' }], ...over,
  });
  let failures = 0;
  const check = (label, actual, expected) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok) { failures += 1; console.error(`  FAIL ${label}: got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`); }
  };

  // 1. Two bots differing ONLY in takeProfitAmount must resolve to DIFFERENT keys (#1224 itself).
  const bots = [bot('b1'), bot('b2', { takeProfitAmount: 5 })];
  const rows = [
    { id: 'r1', name: 'A', strategyKey: 'v1aaaa', parts: { botIds: ['b1'] } },
    { id: 'r2', name: 'B', strategyKey: 'v1bbbb', parts: { botIds: ['b2'] } },
    { id: 'r3', name: 'Gone', strategyKey: 'v1cccc', parts: { botIds: ['deleted'] } },
    { id: 'r4', name: 'Both', strategyKey: 'v1dddd', parts: { botIds: ['b1', 'b2'] } },
  ];
  const out = resolveNewKeys(bots, rows, identity);
  check('two exits -> two keys', out[0].newKey === out[1].newKey, false);
  check('mapped rows', out.filter((r) => r.status === 'MAPPED').length, 2);
  check('orphan reported', out[2].status, 'ORPHAN');
  check('split reported', out[3].status, 'SPLIT');

  // 2. A MERGE is refused: two rows whose bots are now identical.
  const same = [bot('x1'), bot('x2', { name: 'renamed only' })];
  const mergeRows = [
    { id: 'm1', name: 'One', strategyKey: 'v1e', parts: { botIds: ['x1'] } },
    { id: 'm2', name: 'Two', strategyKey: 'v1f', parts: { botIds: ['x2'] } },
  ];
  const merged = resolveNewKeys(same, mergeRows, identity);
  check('merge refused', merged.map((r) => r.status), ['MERGE', 'MERGE']);

  if (failures) { console.error(`\n[schema] ${failures} self-test failure(s)`); process.exit(1); }
  console.log('[keys] self-test OK — 6 checks (map, orphan, split, merge-refusal, distinct exits, empty)');
}

async function main() {
  const apply = process.argv.includes('--apply');
  const wantSelfTest = process.argv.includes('--self-test');
  const identity = loadIdentity();

  if (wantSelfTest) return selfTest(identity);

  const { PrismaClient } = require(path.join(ROOT, 'nest', 'node_modules', '@prisma/client'));
  const prisma = new PrismaClient();
  try {
    const bots = await prisma.tradingStrategy.findMany({
      include: { protocols: { select: { protocolId: true, role: true } } },
    });
    const rows = await prisma.strategyRegistry.findMany({ select: { id: true, name: true, strategyKey: true, parts: true } });

    console.log(`[keys] KEY_VERSION=${identity.KEY_VERSION} · ${bots.length} bot(s) · ${rows.length} registry row(s)`);
    const resolved = resolveNewKeys(bots, rows, identity);

    const counts = resolved.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }), {});
    for (const [status, n] of Object.entries(counts)) console.log(`  ${status}: ${n}`);

    const printable = resolved.filter((r) => r.status !== 'MAPPED' || r.oldKey !== r.newKey);
    for (const r of printable) {
      console.log(`  ${r.status.padEnd(6)} ${String(r.name || '(unnamed)').padEnd(34)} ${r.oldKey} -> ${r.newKey ?? '—'}`);
    }

    const mapped = resolved.filter((r) => r.status === 'MAPPED');
    if (!apply) {
      console.log(`\n[keys] DRY RUN — ${mapped.length} row(s) would be re-keyed. Re-run with --apply.`);
      return;
    }

    let updated = 0;
    for (const r of mapped) {
      await prisma.strategyRegistry.update({ where: { id: r.id }, data: { strategyKey: r.newKey } });
      updated += 1;
    }
    console.log(`\n[keys] APPLIED — ${updated} row(s) re-keyed. Orphans keep their old key; MERGE/SPLIT rows are untouched.`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => { console.error(`[keys] FAILED: ${err.message}`); process.exit(1); });
}

module.exports = { resolveNewKeys };
