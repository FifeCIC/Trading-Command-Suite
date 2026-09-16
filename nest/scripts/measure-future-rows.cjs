/**
 * measure-future-rows.cjs — decide whether #844's fix is LIVE or merely DECLARED.
 *
 * WHY THIS EXISTS
 * ---------------
 * `INV-NO-FUTURE-ROWS` in `contract-probe.cjs` reports a COUNT (future-dated
 * `position`/`trade` rows). A count cannot distinguish two very different states:
 *
 *   A) the write path is FIXED — the remaining rows are legacy, stamped before the
 *      fix, and will age out on their own. Nothing more to do.
 *   B) the write path is NOT fixed — new rows are still being stamped an hour ahead,
 *      so the count will not fall no matter how long you wait.
 *
 * Both render identically as `position=3 trade=1`. This script separates them by
 * looking at WHEN the future-dated rows were created, relative to the fix.
 *
 * The decisive signal is `MIN(createdAt)` among the future-dated rows:
 *   - all of them predate the fix   -> (A)
 *   - any of them postdate the fix  -> (B)
 *
 * ⚠️ Both rows and their `createdAt` are themselves written through the same broken
 * default, so `createdAt` on an affected row is ALSO an hour ahead. That is exactly
 * why the test uses the ROW'S OWN created timestamp and compares it against the fix
 * time — if the row was written before the fix it cannot appear after it, even with a
 * one-hour distortion (the distortions are equal on both sides).
 *
 * Run: node nest/scripts/measure-future-rows.cjs
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const FIX_APPLIED_AT = new Date('2026-09-16T00:00:00Z');

(async () => {
  const now = new Date();
  console.log(`now = ${now.toISOString()}`);
  console.log(`fix applied at/before = ${FIX_APPLIED_AT.toISOString()}`);
  console.log('');

  // ── positions ────────────────────────────────────────────────────────────────────
  const futurePositions = await prisma.$queryRawUnsafe(
    `SELECT id, symbol, openedAt,
            TIMESTAMPDIFF(MINUTE, ?, openedAt) AS leadMinutes
       FROM position
      WHERE openedAt > ?
      ORDER BY openedAt DESC`,
    now,
    now,
  );
  console.log(`position rows dated in the future: ${futurePositions.length}`);
  for (const p of futurePositions.slice(0, 10)) {
    console.log(
      `   #${p.id} ${p.symbol}  openedAt=${new Date(p.openedAt).toISOString()}  lead=${p.leadMinutes}min`,
    );
  }

  // ── trades ───────────────────────────────────────────────────────────────────────
  const futureTrades = await prisma.$queryRawUnsafe(
    `SELECT id, symbol, openedAt, closedAt, createdAt,
            TIMESTAMPDIFF(MINUTE, ?, openedAt)  AS openLeadMinutes,
            TIMESTAMPDIFF(MINUTE, ?, closedAt)  AS closeLeadMinutes
       FROM trade
      WHERE openedAt > ? OR closedAt > ?
      ORDER BY openedAt DESC`,
    now,
    now,
    now,
    now,
  );
  console.log('');
  console.log(`trade rows dated in the future: ${futureTrades.length}`);
  for (const t of futureTrades.slice(0, 10)) {
    console.log(
      `   #${t.id} ${t.symbol}  openedAt=${t.openedAt ? new Date(t.openedAt).toISOString() : 'null'}  ` +
        `closedAt=${t.closedAt ? new Date(t.closedAt).toISOString() : 'null'}  ` +
        `lead(open)=${t.openLeadMinutes}min lead(close)=${t.closeLeadMinutes}min  ` +
        `createdAt=${t.createdAt ? new Date(t.createdAt).toISOString() : 'null'}`,
    );
  }

  // ── the decisive question: are any of them NEW? ──────────────────────────────────
  const newPositions = futurePositions.filter((p) => new Date(p.openedAt) > FIX_APPLIED_AT);
  const newTrades = futureTrades.filter((t) => new Date(t.openedAt) > FIX_APPLIED_AT);

  console.log('');
  console.log('── VERDICT ──────────────────────────────────────────────────────────────');
  // ⚠️ CORRECTED 2026-09-16. The first version of this script concluded "(B) WRITE
  // PATH STILL BROKEN — the column-default conversion did not cover whatever writes
  // these". That conclusion was WRONG, and it was the same class of error as the
  // retracted 504 attribution: a causal story attached to a correlation.
  //
  // `position.openedAt` / `trade.openedAt` / `trade.createdAt` were then confirmed by
  // `information_schema` to read `DEFAULT utc_timestamp(3)` — the #844 conversion DID
  // land and is visible in the live schema. But these rows do not USE the default:
  // they arrive with an EXPLICIT timestamp supplied by the MT5 bridge, so the default
  // was never the mechanism and could not have been. "Rows appeared after the fix"
  // is a correlation with the fix time, not evidence about the default.
  //
  // What the leads actually look like is the discriminator — see
  // `measure-future-lead-bound.cjs`, which tests whether every lead fits inside the
  // bridge's 900s offset-rounding step.
  if (newPositions.length === 0 && newTrades.length === 0) {
    console.log('(A) WRITE PATH FIXED. Every future-dated row predates the fix.');
    console.log('    They are legacy artefacts and will age out as the clock passes them.');
    console.log('    Nothing further to fix; the invariant stays HELD until the data clears.');
  } else {
    // ⚠️ Do NOT conclude "the default conversion failed". Check WHICH mechanism wrote
    // the row — a DB default only applies when the column is OMITTED on insert. An
    // application that passes an explicit value bypasses it entirely, and that is the
    // case here (the MT5 bridge supplies MT5-sourced timestamps).
    const leads = [
      ...newPositions.map((p) => Math.round(p.leadMinutes)),
      ...newTrades.map((t) => t.closeLeadMinutes),
    ].filter((n) => n !== null && n !== undefined);
    const maxLeadMin = leads.length ? Math.max(...leads) : 0;

    console.log('    NOTE: rows appeared after the fix, but check the MECHANISM before');
    console.log('    blaming the default — a default only applies when the column is OMITTED.');
    console.log(`    Max observed lead = ${maxLeadMin} min.`);
    if (maxLeadMin > 0 && maxLeadMin <= 20) {
      console.log('    A lead of <= ~15 min is NOT the #844 local-time default (that is +60 min)');
      console.log('    and NOT the whole-hour broker skew (that is +180 min). It is consistent');
      console.log('    with the bridge offset-rounding step — see measure-future-lead-bound.cjs');
      console.log('    and measure-broker-clock-offset.cjs.');
    } else if (maxLeadMin >= 55 && maxLeadMin <= 65) {
      console.log('    A ~60 min lead IS the local-time default. The conversion did not reach');
      console.log('    the writer that produced these rows — find which path omits the column.');
    } else {
      console.log('    The lead does not match a known mechanism. Do NOT record a cause —');
      console.log('    the cause is UNKNOWN. Measure further before writing it down.');
    }
  }

  // ── and prove the default itself is now UTC, not local ───────────────────────────
  console.log('');
  console.log('── DEFAULT STILL LOCAL? (the mechanism, not the residue) ────────────────');
  const localDefaults = await prisma.$queryRawUnsafe(
    `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_DEFAULT
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND LOWER(COLUMN_DEFAULT) LIKE '%current_timestamp%'`,
  );
  console.log(`columns still defaulting to CURRENT_TIMESTAMP: ${localDefaults.length}`);
  for (const c of localDefaults.slice(0, 20)) {
    console.log(`   ${c.TABLE_NAME}.${c.COLUMN_NAME} -> ${c.COLUMN_DEFAULT}`);
  }
  if (localDefaults.length === 0) {
    console.log('   ✅ every column default is UTC_TIMESTAMP (or explicit) — no NEW row can be skewed');
  }

  await prisma.$disconnect();
})().catch(async (e) => {
  console.error('FAILED:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
