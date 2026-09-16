#!/usr/bin/env node
/**
 * fix-local-time-defaults.cjs — convert `DEFAULT CURRENT_TIMESTAMP` to `DEFAULT (UTC_TIMESTAMP())`.
 *
 * ⚠️ WHY (#844). MySQL evaluates `CURRENT_TIMESTAMP` in the SESSION timezone, which is `SYSTEM` =
 * **UTC+1** on this machine. The application writes UTC. So every row that OMITS such a column is
 * stamped an hour in the future — silently, with no error, and it looks like a normal timestamp.
 *
 * Measured before this change: **113 columns across 104 tables**, including `position.openedAt`,
 * `trade.openedAt`, `trade.createdAt` and `directiveoutcome.createdAt` (the retention column, which
 * made the pruning window an hour longer than configured).
 *
 * ⚠️ WHY NOT `SET GLOBAL time_zone='+00:00'`. That fixes every default in one statement — and also
 * silently changes the clock for EVERY OTHER project on this shared WAMP/MySQL instance (Intranet,
 * OmniCore, StreamerOps). A cross-project change made to repair one project's bug is the pattern
 * this repo keeps paying for. Contained to `tradingcs` instead.
 *
 * ⚠️ THE `ON UPDATE` LIMITATION, MEASURED NOT ASSUMED. MySQL ACCEPTS
 * `DEFAULT (UTC_TIMESTAMP(3)) ON UPDATE CURRENT_TIMESTAMP(3)` — verified on a scratch table — but
 * the `ON UPDATE` half STILL FIRES IN LOCAL TIME (+60.00 min measured). So this script converts the
 * DEFAULT on those columns and reports them, because the update path cannot be fixed by DDL at all:
 * it needs the value written explicitly by the application.
 *
 * Idempotent: columns already on a UTC_TIMESTAMP expression default are skipped.
 *
 * Usage:  node nest/scripts/fix-local-time-defaults.cjs [--dry-run]
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DRY = process.argv.includes('--dry-run');

for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const { PrismaClient } = require('@prisma/client');

(async () => {
  const p = new PrismaClient();
  console.log(`fix-local-time-defaults${DRY ? ' (dry run)' : ''}\n`);

  const tz = await p.$queryRawUnsafe(
    `SELECT @@session.time_zone AS tz, NOW() AS n, UTC_TIMESTAMP() AS u`,
  );
  const offsetH = (tz[0].n - tz[0].u) / 3600000;
  console.log(`  session time_zone = ${tz[0].tz}   offset from UTC = ${offsetH}h`);
  if (offsetH === 0) {
    console.log('  note: the session is already UTC, so the defaults are harmless — continuing anyway,');
    console.log('        because a machine in another timezone would not be.');
  }

  const cols = await p.$queryRawUnsafe(
    `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_DEFAULT, EXTRA, DATA_TYPE
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND COLUMN_DEFAULT LIKE '%CURRENT_TIMESTAMP%'
      ORDER BY TABLE_NAME, COLUMN_NAME`,
  );
  console.log(`\n  columns with a CURRENT_TIMESTAMP default: ${cols.length}`);

  // The expression form must match the column's precision: DATETIME(3) wants UTC_TIMESTAMP(3).
  const exprFor = (c) => {
    const m = /CURRENT_TIMESTAMP\((\d+)\)/.exec(String(c.COLUMN_DEFAULT));
    return m ? `(UTC_TIMESTAMP(${m[1]}))` : '(UTC_TIMESTAMP())';
  };

  let altered = 0;
  let failed = 0;
  const onUpdate = [];

  for (const c of cols) {
    const table = String(c.TABLE_NAME);
    const col = String(c.COLUMN_NAME);
    const expr = exprFor(c);
    const hasOnUpdate = /on update/i.test(String(c.EXTRA));
    if (hasOnUpdate) onUpdate.push(`${table}.${col}`);

    // ⚠️ `ALTER COLUMN … SET DEFAULT` is INSTANT in MySQL 8 — metadata only, no table rebuild, no
    // data touched. That matters because several of these tables are raw-managed (#769) and a
    // rebuild would be a far bigger operation than this fix warrants.
    const sql = `ALTER TABLE \`${table}\` ALTER COLUMN \`${col}\` SET DEFAULT ${expr}`;
    if (DRY) {
      console.log(`  would: ${table}.${col}  -> DEFAULT ${expr}${hasOnUpdate ? '   (ON UPDATE stays local)' : ''}`);
      altered++;
      continue;
    }
    try {
      await p.$executeRawUnsafe(sql);
      altered++;
    } catch (e) {
      failed++;
      console.log(`  ❌ ${table}.${col}: ${e.message.split('\n')[0].slice(0, 120)}`);
    }
  }

  if (!DRY) {
    // Verify against the database, not against the attempt — an ALTER that silently did nothing
    // would otherwise be reported as success.
    const after = await p.$queryRawUnsafe(
      `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_DEFAULT LIKE '%CURRENT_TIMESTAMP%'`,
    );
    const remaining = Number(after[0].n);
    console.log(`\n  converted: ${altered}   failed: ${failed}`);
    console.log(`  columns still on CURRENT_TIMESTAMP (verified from the DB): ${remaining}`);
    if (remaining !== failed) {
      console.log(`  ⚠️ expected ${failed} to remain — the count does not match, so inspect before trusting this run.`);
    }

    // Prove the fix end-to-end: insert into a scratch table copying one real column definition.
    const probe = await p.$queryRawUnsafe(
      `SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_DEFAULT LIKE '%UTC_TIMESTAMP%' LIMIT 1`,
    );
    if (probe.length) {
      const { TABLE_NAME, COLUMN_NAME } = probe[0];
      const colType = (await p.$queryRawUnsafe(
        `SELECT COLUMN_TYPE, COLUMN_DEFAULT FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        TABLE_NAME, COLUMN_NAME,
      ))[0];
      await p.$executeRawUnsafe('DROP TABLE IF EXISTS tmp_default_verify');
      await p.$executeRawUnsafe(
        `CREATE TABLE tmp_default_verify (id INT PRIMARY KEY, v ${colType.COLUMN_TYPE} NOT NULL DEFAULT ${colType.COLUMN_DEFAULT})`,
      );
      await p.$executeRawUnsafe('INSERT INTO tmp_default_verify (id) VALUES (1)');
      const r = await p.$queryRawUnsafe('SELECT v, UTC_TIMESTAMP() AS u FROM tmp_default_verify');
      const driftMin = (r[0].v - r[0].u) / 60000;
      await p.$executeRawUnsafe('DROP TABLE IF EXISTS tmp_default_verify');
      console.log(
        `\n  end-to-end: ${TABLE_NAME}.${COLUMN_NAME} definition, inserted with the column omitted ->` +
          ` drift ${driftMin.toFixed(2)} min ${Math.abs(driftMin) < 1 ? '✅ UTC' : '❌ STILL LOCAL'}`,
      );
    }
  }

  if (onUpdate.length) {
    console.log(`\n  ⚠️ ${onUpdate.length} column(s) ALSO carry ON UPDATE CURRENT_TIMESTAMP, which MySQL`);
    console.log('     cannot express as a function. Their INSERT path is now UTC; the UPDATE path still');
    console.log('     fires in local time unless the application writes the value explicitly:');
    for (const c of onUpdate) console.log(`       ${c}`);
  }

  console.log('');
  await p.$disconnect();
  process.exit(failed > 0 ? 1 : 0);
})();
