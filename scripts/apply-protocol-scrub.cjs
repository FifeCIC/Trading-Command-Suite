#!/usr/bin/env node
/**
 * apply-protocol-scrub.cjs — deactivate a reviewed list of protocols, reversibly.
 *
 * WHY DEACTIVATION AND NOT DELETION
 * ---------------------------------
 * Deletion is not available for a real protocol. `protocol-db.service.ts` refuses any slug
 * without a `-copy` suffix, and `seedProtocolsToDatabase()` is upsert-only, so deleting a
 * SEEDED row is undone by the next seed run or reinstall. Editing the 48-key, 86 KB
 * `protocols-seed-data.ts` by hand is the only durable path, and its documented regeneration
 * tool (`scripts/dump-protocol-seed.cjs`) does not exist (#791).
 *
 * `protocol.active` is different: it is USER STATE and is deliberately never seeded
 * (DECISION marker in protocol-db.service.ts, 2026-10-01), so a toggle survives a re-seed.
 * It is also a real kill switch — `SpeedScanService` skips the symbol before reading a bar
 * (#803). That makes `active = 0` the correct, reversible form of "scrub".
 *
 * SAFETY
 *   - Before-state is written to logs/protocol-scrub-before-<stamp>.json, so `--revert` is exact.
 *   - `--dry-run` prints the change and writes nothing.
 *   - Refuses to act if any slug is unknown, so a typo cannot silently do nothing.
 *
 * USAGE
 *   node scripts/apply-protocol-scrub.cjs --dry-run
 *   node scripts/apply-protocol-scrub.cjs
 *   node scripts/apply-protocol-scrub.cjs --revert logs/protocol-scrub-before-<stamp>.json
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/**
 * The reviewed scrub list, 2026-11-02. Grouped by the reason it was chosen, because the
 * reason is the thing a future reader needs — the list alone looks arbitrary.
 *
 * ⚠️ `btc-scalp-v1` is deliberately ABSENT. It was a Tier-3 candidate until
 * `audit-protocol-scrub-safety.cjs` showed it is the ONLY resolver for BTC, ETH and SOL —
 * retiring it would have made three kept instruments go quiet with no error. That is the
 * guard earning its place on its first run.
 */
const SCRUB = {
  debris: [
    'xau-speed-v1-copy',      // named "(copy)"; 0 symbols, 0 bots, yet ACTIVE
    'mt5-technical-short',    // 0 symbols, 0 bots; SHORT twin of the same directives
    'euro-stoxx-v1',          // ACTIVE with 0 symbols and 0 bots
    'nikkei-speed-v1',        // ACTIVE with 0 symbols and 0 bots
    'usdjpy-risk-v1',         // ACTIVE with 0 symbols and 0 bots
    'usdcad-oil-v1',          // named USDCAD but resolves WTI
  ],
  neverWired: [
    'vwap-bands-v1', 'vwap-simple-v1',           // 0 symbols, 0 bots; ~90% the same directives
    'mtf-conservative-v1', 'mtf-weighted-v1',    // 0 symbols, 0 bots
    'gap-scanner-v1',                            // 0 symbols, 0 bots
    'hourly-3dir-v1',                            // EURUSD, 0 bots; dup of forex-session-v1's EURUSD
    'eurusd-macro-v1', 'gbpusd-news-v1',         // 0 symbols; dups of forex-session-v1 pairs
    'commodity-pairs-v1',                        // 0 symbols, 0 bots
  ],
  outsideKeepList: [
    'ftse-speed-v1', 'dax-speed-v1', 'cac-speed-v1', 'china-speed-v1', 'dow-speed-v1',
    'leverage-v2',            // scores 73 leverage symbols every run; no bot
    'pandemic-v1', 'earnings-momentum-v1',
    'doge-speed-v1', 'tsla-speed-v1',   // momentum-stock-v1 already owns TSLA
    'oil-supply-v1',          // 0 symbols; oil-speed-v1 is the wired one
  ],
};

const ALL = Object.values(SCRUB).flat();

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const revertAt = argv.indexOf('--revert');

  const { PrismaClient } = require(path.join(ROOT, 'nest/node_modules/@prisma/client'));
  const prisma = new PrismaClient();

  try {
    if (revertAt >= 0) {
      const file = argv[revertAt + 1];
      if (!file || !fs.existsSync(file)) throw new Error(`before-state file not found: ${file}`);
      const before = JSON.parse(fs.readFileSync(file, 'utf8'));
      let restored = 0;
      for (const row of before.protocols) {
        await prisma.$executeRawUnsafe(
          `UPDATE protocol SET active = ?, updatedAt = NOW(3) WHERE slug = ?`,
          row.active, row.slug,
        );
        restored++;
      }
      console.log(`✅ reverted ${restored} protocol(s) from ${path.basename(file)}`);
      return;
    }

    const rows = await prisma.$queryRawUnsafe(
      `SELECT id, slug, name, active FROM protocol WHERE slug IN (${ALL.map(() => '?').join(',')})`,
      ...ALL,
    );
    const found = new Map(rows.map((r) => [r.slug, r]));
    const missing = ALL.filter((s) => !found.has(s));
    if (missing.length) {
      throw new Error(`unknown slug(s) — refusing to act: ${missing.join(', ')}`);
    }

    const toChange = [];
    for (const slug of ALL) {
      const r = found.get(slug);
      if (Number(r.active) === 1) toChange.push({ slug, name: r.name, active: 1 });
    }

    console.log(`\nprotocol scrub — ${ALL.length} listed, ${toChange.length} currently ACTIVE\n`);
    for (const r of toChange) console.log(`  active=1 -> 0   ${r.slug.padEnd(24)} ${r.name}`);

    if (dryRun) {
      console.log('\n--dry-run: nothing written\n');
      return;
    }
    if (toChange.length === 0) {
      console.log('\nnothing to do (already inactive)\n');
      return;
    }

    const beforeFile = path.join(ROOT, 'logs', `protocol-scrub-before-${stamp()}.json`);
    fs.mkdirSync(path.dirname(beforeFile), { recursive: true });
    fs.writeFileSync(beforeFile, JSON.stringify({ capturedAt: new Date().toISOString(), protocols: toChange }, null, 2));

    for (const r of toChange) {
      await prisma.$executeRawUnsafe(
        `UPDATE protocol SET active = 0, updatedAt = NOW(3) WHERE slug = ?`,
        r.slug,
      );
    }

    // Read back — a command reporting success is a claim; the table is the evidence.
    const after = await prisma.$queryRawUnsafe(
      `SELECT slug, active FROM protocol WHERE slug IN (${ALL.map(() => '?').join(',')})`,
      ...ALL,
    );
    const stillActive = after.filter((r) => Number(r.active) === 1).map((r) => r.slug);
    const total = await prisma.$queryRawUnsafe('SELECT COUNT(*) n FROM protocol');
    const activeNow = await prisma.$queryRawUnsafe('SELECT COUNT(*) n FROM protocol WHERE active = 1');

    console.log(`\nread-back: ${after.length} rows, still active: ${stillActive.length ? stillActive.join(',') : 'none'}`);
    console.log(`library now: ${Number(total[0].n)} protocols, ${Number(activeNow[0].n)} active`);
    console.log(`before-state: ${path.relative(ROOT, beforeFile)}`);
    console.log(`revert: node scripts/apply-protocol-scrub.cjs --revert ${path.relative(ROOT, beforeFile)}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error('\n❌', e && e.message ? e.message : e);
  process.exit(1);
});
