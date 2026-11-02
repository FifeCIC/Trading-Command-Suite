#!/usr/bin/env node
/**
 * repair-unaligned-bars.cjs — snap off-boundary bars onto their cadence, merging duplicates.
 *
 * WHY THIS EXISTS
 * ---------------
 * `POST /api/imports/refresh/:symbolId` (`importRealBars`) stored raw provider timestamps while
 * `importBars()` aligned. Measured 2026-11-02 by running a bar repair through it:
 * `import-bars-alignment.spec.ts` went red with 1h/4h offsets of
 * `[0, 2, 3, 4, 5, 6, 7, 8, 17, 18, 20, 30]` minutes, and QQQ held two distinct `1d` boundaries.
 *
 * The service is fixed (`import-jobs.service.ts` now calls `alignBarTimestamp`), but the rows it
 * already wrote are still off-boundary. Unaligned rows defeat the unique key
 * `(symbolId, timeframe, timestamp)`, so one bar exists twice and every reader sees phantom bars.
 *
 * ⚠️ MERGE RULE, STATED: when an off-boundary row snaps onto a timestamp that already exists, the
 * pair is merged — high/low widened, volume summed, the LATER timestamp's close kept — and the
 * off-boundary row is deleted. That preserves the price range the two rows together describe
 * rather than silently dropping one. It is a repair, not a re-import: re-importing would be
 * cleaner, but the provider no longer serves some of these windows.
 *
 * ⚠️ DRY RUN BY DEFAULT. `--apply` is required to write.
 *
 * USAGE
 *   node scripts/repair-unaligned-bars.cjs
 *   node scripts/repair-unaligned-bars.cjs --apply
 */

const ROOT = require('path').resolve(__dirname, '..');
const { alignBarTimestamp } = require(`${ROOT}/nest/dist/src/common/utils/timeframe.js`);

async function main() {
  const apply = process.argv.includes('--apply');
  const { PrismaClient } = require(`${ROOT}/nest/node_modules/@prisma/client`);
  const prisma = new PrismaClient();

  try {
    // ⚠️ SELECT BY `importedAt`, NOT BY `timestamp`. Measured 2026-11-02: a first version of
    // this script scanned `timestamp >= NOW() - 30 days` and reported "0 off-boundary" while the
    // #783 spec still failed — because the damage is a bar whose TIMESTAMP is old (QQQ's daily
    // history reaches back to March) but which was WRITTEN yesterday. The window that matters is
    // when the row arrived, which is what `importedAt` records and what the spec filters on.
    const since = process.env.SINCE_IMPORTED || '2026-11-01';
    const rows = await prisma.$queryRawUnsafe(`
      SELECT b.id, b.symbolId, b.provider, b.timeframe, b.timestamp,
             b.open, b.high, b.low, b.close, b.volume, s.ticker
      FROM marketbar b JOIN symbol s ON s.id = b.symbolId
      WHERE b.timeframe IN ('1m','5m','15m','1h','4h','1d')
        AND b.importedAt >= ?
      ORDER BY b.symbolId, b.timeframe, b.timestamp`, since);

    const off = [];
    for (const r of rows) {
      const aligned = alignBarTimestamp(r.timestamp, r.timeframe, r.provider);
      if (!aligned) continue;
      if (new Date(r.timestamp).getTime() !== aligned.getTime()) {
        off.push({ ...r, aligned });
      }
    }

    console.log(`\nscanned ${rows.length} bar(s) in the last 30 days · ${off.length} off-boundary\n`);
    if (off.length === 0) {
      console.log('✅ nothing to repair\n');
      return;
    }

    const bySymbol = new Map();
    for (const r of off) {
      const k = `${r.ticker} ${r.timeframe}`;
      bySymbol.set(k, (bySymbol.get(k) || 0) + 1);
    }
    for (const [k, n] of [...bySymbol.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
      console.log(`  ${k.padEnd(16)} ${String(n).padStart(5)} row(s)`);
    }

    if (!apply) {
      console.log('\n(dry run — pass --apply to write)\n');
      return;
    }

    let merged = 0;
    let moved = 0;
    for (const r of off) {
      const existing = await prisma.$queryRawUnsafe(
        `SELECT id, high, low, volume, close FROM marketbar
         WHERE symbolId = ? AND timeframe = ? AND timestamp = ? AND id <> ?`,
        r.symbolId, r.timeframe, r.aligned, r.id,
      );
      if (existing.length) {
        const e = existing[0];
        await prisma.$executeRawUnsafe(
          `UPDATE marketbar SET
             high = GREATEST(high, ?), low = LEAST(low, ?), volume = COALESCE(volume,0) + COALESCE(?,0), close = ?
           WHERE id = ?`,
          Number(r.high), Number(r.low), Number(r.volume), Number(r.close), e.id,
        );
        await prisma.$executeRawUnsafe(`DELETE FROM marketbar WHERE id = ?`, r.id);
        merged++;
      } else {
        await prisma.$executeRawUnsafe(`UPDATE marketbar SET timestamp = ? WHERE id = ?`, r.aligned, r.id);
        moved++;
      }
    }

    console.log(`\n✔ ${moved} row(s) snapped · ✔ ${merged} merged into an existing boundary row`);

    // Read back: the two assertions the spec makes, stated in UTC so a session timezone cannot
    // make an aligned row look misaligned (MySQL's HOUR() returns session-local, which cost a
    // round of confusion on 2026-11-02).
    const check = await prisma.$queryRawUnsafe(`
      SELECT
        SUM(CASE WHEN timeframe IN ('1h','4h') AND MINUTE(CONVERT_TZ(timestamp,'+00:00','+00:00')) <> 0 THEN 1 ELSE 0 END) AS offHour,
        COUNT(*) AS scanned
      FROM marketbar WHERE importedAt >= ?`, since);
    console.log(`off-minute 1h/4h rows imported since ${since}: ${Number(check[0].offHour)} of ${Number(check[0].scanned)}`);
    console.log('');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error('❌', e && e.message ? e.message : e);
  process.exit(1);
});
