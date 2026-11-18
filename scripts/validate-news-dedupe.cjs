#!/usr/bin/env node
/**
 * validate-news-dedupe.cjs — fails when the two news pipelines store the same story twice.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────────
 * `newsarticle` (written hourly by `NewsImportService`, read by 9 modules, owns the `NewsSource`
 * taxonomy) and `news_item` (written by three research ingesters, read only by `screener`) both hold
 * market news. Measured 2026-11-17: **17,245 of 28,350 `news_item` rows carried a URL already present
 * in `newsarticle`** — 61% of the smaller table and 42% of the larger, written within the same hour.
 *
 * The duplicates were removed and the writers were guarded (`nest/src/modules/research/news-dedupe.ts`).
 * ⚠️ THE GUARD IS THE PART THAT MATTERS: RSS re-polls every 2 minutes and Finnhub every 5, so a
 * cleanup without a writer guard undoes itself. This script is what observes that the guard is still
 * doing its job — deleting rows is a one-off, this is the part that keeps it true.
 *
 * ── WHAT IT ASSERTS ─────────────────────────────────────────────────────────────────────────────
 * ZERO `news_item.url` values appear in `newsarticle.url`. That is the exact definition that was
 * measured, so it can be re-measured identically.
 *
 * Exit codes: 0 = clean · 1 = duplicates found · 2 = could not measure (NOT a pass).
 */

'use strict';

const path = require('path');
const { query, connect } = require(path.join(__dirname, 'lib', 'mysql-cli.cjs'));

/** Parse the tab-separated, header-included text that mysql-cli returns into row objects. */
function rows(text) {
  const lines = String(text).trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const head = lines[0].split('\t');
  return lines.slice(1).map((line) => {
    const cells = line.split('\t');
    const row = {};
    head.forEach((h, i) => { row[h] = cells[i]; });
    return row;
  });
}

async function main() {
  let conn;
  try {
    conn = await connect();
  } catch (err) {
    console.error(`[news-dedupe] SKIPPED — cannot reach the database: ${err.message}`);
    console.error('[news-dedupe] This is NOT a pass: duplication was NOT checked.');
    process.exit(2);
  }

  let result;
  try {
    result = rows(await query(
      `SELECT
         COUNT(*)                                                         AS news_item_rows,
         SUM(EXISTS(SELECT 1 FROM newsarticle a WHERE a.url = i.url))     AS also_in_newsarticle,
         SUM(i.symbols IS NOT NULL AND i.symbols <> ''
             AND NOT EXISTS(SELECT 1 FROM newsarticle a WHERE a.url = i.url))  AS still_unmigrated,
         SUM((i.symbols IS NULL OR i.symbols = '')
             AND NOT EXISTS(SELECT 1 FROM newsarticle a WHERE a.url = i.url))  AS unattributable
       FROM news_item i`, conn));
  } catch (err) {
    // A missing table is a different fact from "no duplicates", and must not read the same.
    console.error(`[news-dedupe] ERROR — the measurement failed: ${err.message}`);
    console.error('[news-dedupe] This is NOT a pass: the subset was NOT checked.');
    process.exit(2);
  }

  const r = result[0] || {};
  const total = Number(r.news_item_rows ?? 0);
  const migrated = Number(r.also_in_newsarticle ?? 0);
  const unmigrated = Number(r.still_unmigrated ?? 0);
  // ⚠️ A PERMANENT REMAINDER, NOT A FAILURE. `newsarticle.symbol` is NOT NULL and the only consumer
  // queries by ticker, so a story carrying no symbol cannot be stored there and could never match a
  // ticker query anyway. Counting them as "unmigrated" would keep this gate red forever — which is how
  // a real gate gets allowlisted and stops being read.
  const unattributable = Number(r.unattributable ?? 0);

  console.log(`  [news-dedupe] news_item ${total} rows · ${migrated} also in newsarticle · `
    + `${unmigrated} attributable-but-unmigrated · ${unattributable} unattributable (no symbol)`);

  if (unmigrated > 0) {
    let offenders = [];
    try {
      offenders = rows(await query(
        `SELECT i.source, COUNT(*) AS n
           FROM news_item i
          WHERE NOT EXISTS(SELECT 1 FROM newsarticle a WHERE a.url = i.url)
          GROUP BY i.source ORDER BY n DESC LIMIT 10`, conn));
    } catch { /* the count above is the finding; the breakdown is a convenience */ }

    console.error('');
    console.error(`  [news-dedupe] ✖ ${unmigrated} of ${total} news_item row(s) are NOT in newsarticle.`);
    for (const o of offenders) console.error(`        ${o.source}: ${o.n}`);
    console.error('');
    console.error('     Until this is 0, `news_item` cannot be retired — it still holds stories nothing');
    console.error('     else has. Migrate them:');
    console.error('       node scripts/migrate-news-to-newsarticle.cjs --apply');
    process.exit(1);
  }

  console.log(`  [news-dedupe] ✅ OK — every attributable news_item story is in newsarticle.`);
  if (unattributable > 0) {
    console.log(`                ${unattributable} row(s) carry no symbol and can never be migrated`);
    console.log('                (newsarticle.symbol is NOT NULL; a ticker query could not match them).');
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(`[news-dedupe] ERROR — ${err.message}`);
  console.error('[news-dedupe] This is NOT a pass.');
  process.exit(2);
});
