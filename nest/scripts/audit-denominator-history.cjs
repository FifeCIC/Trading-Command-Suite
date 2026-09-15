#!/usr/bin/env node
/**
 * audit-denominator-history.cjs — what did the Signal denominator actually do over time?
 * (#781 / owner query: "signals were originally around 250")
 *
 * WHY: the percentage dropping is consistent with the denominator changing from the OBSERVED
 * directional max (which SHRINKS when directives read neutral, inflating the %) to the
 * CONFIGURED capacity (stable). That was a deliberate #758 fix. This script looks for the
 * step-change in the persisted series rather than assuming it.
 *
 * `score_history.rawMax` is the PERSISTED denominator (#758 wired capacityMaxTotal into it).
 *
 * ⚠️ MYSQL CLOCK IS +1h vs the OS, so every raw comparison widened; classification is done in
 * JS from returned rows, never in SQL.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

(async () => {
  const url = process.env.DATABASE_URL || 'mysql://tradingcs:tradingcs_dev_2026@localhost:3306/tradingcs';
  const u = new URL(url);
  const conn = await mysql.createConnection({
    host: u.hostname, port: u.port || 3306,
    user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ''),
  });

  const out = { at: new Date().toISOString() };

  // ── 1. Columns on score_history so we know what is actually persisted ──
  const [cols] = await conn.query(
    `SELECT COLUMN_NAME, DATA_TYPE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'score_history'
     ORDER BY ORDINAL_POSITION`,
  );
  out.columns = cols.map((c) => `${c.COLUMN_NAME}:${c.DATA_TYPE}`);

  // ── 2. rawMax distribution by day -> look for the step change ──
  // Interpolate nothing; take rows and bucket in JS. Limit keeps it cheap.
  const [rows] = await conn.query(
    `SELECT DATE(createdAt) AS d, rawMax, opportunityMax, signalPct
     FROM score_history
     WHERE createdAt > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 21 DAY)
       AND rawMax IS NOT NULL
     ORDER BY createdAt DESC
     LIMIT 20000`,
  );
  out.rowCount = rows.length;

  const byDay = {};
  for (const r of rows) {
    const day = r.d ? String(r.d).slice(0, 10) : 'unknown';
    byDay[day] = byDay[day] ?? { n: 0, rawMax: {}, oppMax: {} };
    byDay[day].n++;
    const rm = Number(r.rawMax);
    const om = Number(r.opportunityMax);
    if (Number.isFinite(rm)) byDay[day].rawMax[rm] = (byDay[day].rawMax[rm] ?? 0) + 1;
    if (Number.isFinite(om)) byDay[day].oppMax[om] = (byDay[day].oppMax[om] ?? 0) + 1;
  }

  const topMode = (obj) => {
    const e = Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, 3);
    return e.map(([k, v]) => `${k}×${v}`).join(' | ') || '-';
  };

  out.byDay = Object.entries(byDay)
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([day, v]) => ({ day, rows: v.n, topRawMax: topMode(v.rawMax), topOppMax: topMode(v.oppMax) }));

  await conn.end();
  console.log(JSON.stringify(out, null, 2));
})().catch((e) => {
  console.log(JSON.stringify({ error: String(e.message || e) }, null, 2));
  process.exit(1);
});
