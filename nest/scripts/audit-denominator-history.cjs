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
 *
 * ── PLANNED IN #1252 ──
 * MISSING:    `score_history` DOES NOT EXIST. Measured 2026-11-08: `db-schema --pattern '%histor%'`
 *             returns 0 tables (query succeeded, so this is an answer, not a failure), and this
 *             script now fails honestly with `Table 'tradingcs.score_history' doesn't exist`.
 *             The persisted series it was written against is gone; `score` and `score_snapshot` are
 *             what exist. So the analysis needs re-basing, not re-running.
 * TODAY:      the script RUNS (its `mysql2` dependency was undeclared — it now uses the repo's one
 *             MySQL layer, `scripts/lib/mysql-cli.cjs`), and it reports the missing table rather
 *             than crashing on a missing module.
 * WHEN BUILT: decide which table carries the denominator history today, then re-base the query.
 *             Do not delete this script to make the failure go away — the question it asks (#781:
 *             "signals were originally around 250") is still unanswered.
 */

// ⚠️ `mysql2` was NEVER A DECLARED DEPENDENCY — it is in neither package.json, so this script could
// not run anywhere (measured 2026-11-07: `Cannot find module 'mysql2/promise'`). It now uses the
// repo's ONE MySQL layer, which shells out to the client and needs no dependency at all.
const { connect, query } = require('../../scripts/lib/mysql-cli.cjs');

// `query(sql, conn)` needs the connection PIECES; `connect()` reads them from `nest/.env` and
// throws by name rather than guessing.
const CONN = connect();

/** Rows as objects, from the client's tab-separated output. */
function rows(sql) {
  const text = query(sql, CONN);
  const lines = text.split(/\r?\n/).filter((l) => l.length);
  if (!lines.length) return [];
  const headers = lines[0].split('\t');
  return lines.slice(1).map((l) => {
    const cells = l.split('\t');
    return Object.fromEntries(headers.map((h, i) => [h, cells[i]]));
  });
}

(async () => {

  const out = { at: new Date().toISOString() };

  // ── 1. Columns on score_history so we know what is actually persisted ──
  const cols = rows(
    `SELECT COLUMN_NAME, DATA_TYPE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'score_history'
     ORDER BY ORDINAL_POSITION`
  );
  out.columns = cols.map((c) => `${c.COLUMN_NAME}:${c.DATA_TYPE}`);

  // ── 2. rawMax distribution by day -> look for the step change ──
  // Interpolate nothing; take rows and bucket in JS. Limit keeps it cheap.
  // ⚠️ NOT named `rows` — that is the parser above.
  const history = rows(
    `SELECT DATE(createdAt) AS d, rawMax, opportunityMax, signalPct
     FROM score_history
     WHERE createdAt > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 21 DAY)
       AND rawMax IS NOT NULL
     ORDER BY createdAt DESC
     LIMIT 20000`
  );
  out.rowCount = history.length;

  const byDay = {};
  for (const r of history) {
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

  console.log(JSON.stringify(out, null, 2));
})().catch((e) => {
  console.log(JSON.stringify({ error: String(e.message || e) }, null, 2));
  process.exit(1);
});
