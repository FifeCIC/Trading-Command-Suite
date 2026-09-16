/**
 * measure-future-lead-bound.cjs — the DECISIVE test for the broker-clock story.
 *
 * WHY THIS EXISTS
 * ---------------
 * `measure-broker-clock-offset.cjs` measured the MetaQuotes bridge reporting
 * `serverUtcOffsetSeconds = 9900` (2h45m) against a true offset of 10800 (3h) —
 * exactly ONE 900-second rounding step short. The proposed mechanism is:
 *
 *     utc_iso(epoch) = epoch_utc - measured_offset
 *                    = (true_utc + 10800) - 9900
 *                    = true_utc + 900
 *
 * so every MT5-sourced timestamp lands at most 900s in the future.
 *
 * THAT GIVES A FALSIFIABLE PREDICTION: **no future lead may exceed 900 seconds.**
 *
 *   - If the max lead is <= 900s  -> the story is CONSISTENT, and the bound is
 *     explained by the rounding step. (Consistent, not yet proven — see below.)
 *   - If any lead exceeds 900s    -> the story is REFUTED or INCOMPLETE. Something
 *     else is also writing future timestamps, and the offset would have to be
 *     wrong by more than one step.
 *
 * This is the difference between "a plausible mechanism" and "a mechanism that
 * survives the one measurement that could kill it". A story that cannot fail is
 * not evidence.
 *
 * ⚠️ WHAT THIS DOES *NOT* PROVE
 * ----------------------------
 * Confirming the bound does not by itself prove the tick-lag bias, because a
 * different bug could also produce sub-900s leads. What it DOES do is rule out the
 * whole-hour skew class (the #750/#780 broker-clock mix-up, and #844's local-time
 * default) as the cause of the CURRENT rows. Both of those would produce ~3600s
 * leads. To discriminate further, the offset must be correlated against the lead
 * at a known instant — see the closing note.
 *
 * Run: node nest/scripts/measure-future-lead-bound.cjs
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const ONE_STEP_SECONDS = 900; // the bridge's rounding step

(async () => {
  console.log('Decisive bound test: can any future lead exceed the 900s rounding step?');
  console.log('');

  // ⚠️ COLUMN NAMES INTROSPECTED, NOT RECALLED (5th `Unknown column` of the session).
  // `marketbar` keys its symbol by `symbolId` (FK), NOT `symbol` — unlike `position`,
  // `trade` and `directiveoutcome`, which all carry a plain `symbol` string. Verified
  // with `node nest/scripts/introspect-columns.cjs`. Do not "tidy" these to match.
  const rows = await prisma.$queryRawUnsafe(`
    SELECT 'position.openedAt' AS source, id, symbol AS sym, openedAt AS ts
      FROM position WHERE openedAt > UTC_TIMESTAMP()
    UNION ALL
    SELECT 'trade.openedAt', id, symbol, openedAt
      FROM trade WHERE openedAt > UTC_TIMESTAMP()
    UNION ALL
    SELECT 'trade.closedAt', id, symbol, closedAt
      FROM trade WHERE closedAt > UTC_TIMESTAMP()
    UNION ALL
    SELECT 'trade.createdAt', id, symbol, createdAt
      FROM trade WHERE createdAt > UTC_TIMESTAMP()
    UNION ALL
    SELECT 'marketbar.timestamp', id, symbolId, timestamp
      FROM marketbar WHERE timestamp > UTC_TIMESTAMP()
    UNION ALL
    SELECT 'directiveoutcome.predictedAt', id, symbol, predictedAt
      FROM directiveoutcome WHERE predictedAt > UTC_TIMESTAMP()
  `);

  if (rows.length === 0) {
    console.log('No future-dated rows at all. Nothing to bound — and the invariant');
    console.log('should now PASS. Re-run the contract probe to confirm.');
    await prisma.$disconnect();
    return;
  }

  const nowMs = Date.now();
  const bySource = new Map();
  let absoluteMax = 0;
  let maxRow = null;

  for (const r of rows) {
    const lead = Math.floor((new Date(r.ts).getTime() - nowMs) / 1000);
    const list = bySource.get(r.source) || { count: 0, max: 0, over: 0 };
    list.count += 1;
    list.max = Math.max(list.max, lead);
    if (lead > ONE_STEP_SECONDS) list.over += 1;
    bySource.set(r.source, list);
    if (lead > absoluteMax) {
      absoluteMax = lead;
      maxRow = r;
    }
  }

  console.log('source                          rows   max lead   rows > 900s');
  console.log('─'.repeat(64));
  for (const [source, s] of [...bySource.entries()].sort()) {
    console.log(
      `${source.padEnd(30)} ${String(s.count).padStart(4)}   ${String(s.max).padStart(6)}s   ${String(s.over).padStart(9)}`,
    );
  }
  console.log('');

  const overCount = [...bySource.values()].reduce((a, s) => a + s.over, 0);

  console.log('── VERDICT ──────────────────────────────────────────────────────────────');
  console.log(`absolute max lead = ${absoluteMax}s (${(absoluteMax / 60).toFixed(1)} min)`);
  console.log(`rows beyond one 900s step = ${overCount}`);
  console.log('');
  if (overCount === 0) {
    console.log('CONSISTENT with the offset-rounding bias: every lead fits inside the');
    console.log('single 900s step the bridge can be wrong by.');
    console.log('This RULES OUT a whole-hour skew (#844 local default, #750/#780 broker');
    console.log('mix-up) as the cause of these rows — those would show ~3600s leads.');
    console.log('It does NOT by itself prove tick lag; see the script header.');
  } else {
    console.log('INCONSISTENT: rows exceed one rounding step, so the bias cannot be the');
    console.log('whole story. The offset must be wrong by more than one 900s step for');
    console.log('at least some writes. Do NOT record the tick-lag explanation as settled.');
    console.log(`Worst offender: ${maxRow.source} ${maxRow.sym} lead=${absoluteMax}s`);
  }

  await prisma.$disconnect();
})().catch(async (e) => {
  console.error('FAILED:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
