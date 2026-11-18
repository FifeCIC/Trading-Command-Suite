#!/usr/bin/env node
/**
 * migrate-news-to-newsarticle.cjs — move the research ingesters' stories into the canonical table (#1290).
 *
 * ── WHY ──────────────────────────────────────────────────────────────────────────────────────────
 * Two news pipelines hold market news:
 *
 *   `newsarticle`  written hourly by `NewsImportService`, read by **9** modules, owns the `NewsSource`
 *                  taxonomy plus `category` / `impact`, and is what the UI's tape renders.
 *   `news_item`    written by three research ingesters (RSS 120 s, Finnhub 300 s, Alpha Vantage daily),
 *                  read by **`screener` only**, as a fallback.
 *
 * Measured 2026-11-17: 17,245 URLs existed in BOTH. That duplication is already removed — the writers
 * are guarded (`news-dedupe.ts`) so a duplicate can no longer be created. What remains is the
 * STRUCTURAL split: 11,339 stories that exist only in `news_item`, reachable by one consumer through a
 * fallback path that nobody would think to look for.
 *
 * ── WHAT THIS DOES, AND IN WHAT ORDER ───────────────────────────────────────────────────────────
 * ADDITIVE ONLY. It reads `news_item` and inserts rows into `newsarticle`. It deletes nothing and
 * changes no writer. That means the system keeps working at every point, and an interrupted run is
 * simply resumed by running it again — every insert is `INSERT IGNORE` on `newsarticle.url`, which is
 * UNIQUE.
 *
 * ⚠️ ONLY THE FIRST SYMBOL SURVIVES, AND THAT IS THE SCHEMA'S LIMIT, NOT A CHOICE MADE HERE.
 * `newsarticle.url` is **UNIQUE**, so one row per symbol is impossible: a second row for the same URL
 * is discarded by `INSERT IGNORE`. Measured 2026-11-18: **102 of 10,396** attributed stories carry
 * more than one ticker, and every one of them kept only its first (`NVDA,DIA` → `NVDA`).
 *
 * ⚠️ THE FIRST VERSION OF THIS SCRIPT CLAIMED "one row per symbol" AND THAT CLAIM WAS FALSE. The rows
 * were built per symbol, the insert silently kept one, and the run reported success — the exact
 * "plausible output, no error" shape this repository keeps finding. The mapper now returns ONE row and
 * REPORTS the dropped secondary tickers, so the limitation is a number in the output rather than a
 * sentence in a comment. Storing secondary tickers needs a join table (`newsarticle_symbol`), which is
 * a schema change and belongs in its own issue.
 *
 * ⚠️ ROWS WITH NO SYMBOL ARE SKIPPED, and that is a decision, not an oversight: `newsarticle.symbol`
 * is `NOT NULL`, and the only consumer queries by ticker, so an unattributed story could never match
 * anyway. They stay in `news_item` and are reported.
 *
 * ⚠️ `category` IS LEFT AT THE COLUMN DEFAULT. The classifier (`news-taxonomy.ts`) is a backend module
 * and copying its rules into a script is exactly the drift this repo warns about. Backfilled rows are
 * `general`; anything written from here on is classified properly by the ingester itself. The count of
 * `general` rows is a known, stated gap rather than a silent one.
 *
 * Usage:
 *   node scripts/migrate-news-to-newsarticle.cjs              # dry run (default) — changes nothing
 *   node scripts/migrate-news-to-newsarticle.cjs --apply      # write
 *   node scripts/migrate-news-to-newsarticle.cjs --self-test  # prove the mapping, no database
 */

'use strict';

const { query, connect } = require('./lib/mysql-cli.cjs');

/** Map a `news_item.source` string onto the `NewsSource.name` row it belongs to. */
const SOURCE_MAP = {
  'fh:finnhub': 'Finnhub',
  'av:alphavantage': 'Alpha Vantage',
  'rss:yahoo-finance': 'Yahoo',
  'rss:seeking-alpha': 'SeekingAlpha',
  'rss:marketwatch': 'MarketWatch',
  'rss:cnbc': 'CNBC',
  'rss:benzinga': 'Benzinga',
};

/** `severity` is an int; `impact` is a band. 3+ means a big story. */
function impactOf(severity) {
  const n = Number(severity);
  if (!Number.isFinite(n)) return 'low';
  if (n >= 3) return 'high';
  if (n >= 1) return 'medium';
  return 'low';
}

/** `news_item.sentiment` is TEXT ('bullish' / 'bearish' / null). `newsarticle.sentiment` is a float. */
function sentimentOf(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (s === 'bullish' || s === 'positive') return 1;
  if (s === 'bearish' || s === 'negative') return -1;
  // NULL on every stored row (measured 2026-11-18), so 0 is the honest reading — not an opinion.
  return 0;
}

function symbolsOf(raw) {
  return String(raw ?? '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s) => s.length > 0 && s.length <= 20);
}

/**
 * Map one `news_item` row to the `newsarticle` rows it deserves.
 *
 * Returns `{ rows, skipped }`. A skip carries a REASON — an unreadable row must not vanish silently.
 */
function mapItem(item, sourceIdByName) {
  const url = String(item?.url ?? '').trim();
  const title = String(item?.title ?? '').trim();
  if (!url) return { rows: [], skipped: 'no url' };
  if (!title) return { rows: [], skipped: 'no title' };
  // `newsarticle.url` is varchar(250); the source column allows 500. Measured 0 rows exceed 250 today,
  // but a future one must be REPORTED rather than truncated into a different URL.
  if (url.length > 250) return { rows: [], skipped: 'url too long for newsarticle' };

  const symbols = symbolsOf(item?.symbols);
  if (symbols.length === 0) return { rows: [], skipped: 'no symbol (newsarticle.symbol is NOT NULL)' };

  const sourceName = SOURCE_MAP[String(item?.source ?? '').trim()];
  const sourceId = sourceName ? sourceIdByName[sourceName] : null;
  if (!sourceId) return { rows: [], skipped: `unmapped source: ${item?.source ?? '(none)'}` };

  const publishedAt = item?.publishedAt ? new Date(item.publishedAt) : null;
  if (!publishedAt || Number.isNaN(publishedAt.getTime())) {
    return { rows: [], skipped: 'no readable publishedAt' };
  }

  // ⚠️ ONE ROW, NOT ONE PER SYMBOL. `newsarticle.url` is UNIQUE, so a second row for the same story
  // is discarded by `INSERT IGNORE`. Building rows per symbol produced a run that reported success
  // while silently dropping every secondary ticker, so the mapper reports the loss instead.
  const secondaryDropped = Math.max(0, symbols.length - 1);
  const rows = [{
    symbol: symbols[0],
    sourceId,
    headline: title.slice(0, 2000),
    url,
    summary: item?.summary ? String(item.summary) : null,
    sentiment: sentimentOf(item?.sentiment),
    impact: impactOf(item?.severity),
    publishedAt,
  }];
  return { rows, skipped: null, secondaryDropped };
}

function selfTest() {
  let pass = 0, fail = 0;
  const t = (name, ok) => { ok ? (pass++, console.log(`  ✓ ${name}`)) : (fail++, console.log(`  ✗ ${name}`)); };
  const src = { Finnhub: 'id-fh', Yahoo: 'id-yh' };
  const base = {
    title: 'T', url: 'https://x/1', source: 'fh:finnhub', symbols: 'AAPL',
    severity: 1, sentiment: null, publishedAt: '2026-11-01T00:00:00Z', summary: 'S',
  };

  const one = mapItem(base, src);
  t('a single-symbol story becomes one row', one.rows.length === 1);
  t('severity 1 is impact medium', one.rows[0].impact === 'medium');
  t('a null sentiment is 0, not directional', one.rows[0].sentiment === 0);

  const multi = mapItem({ ...base, symbols: 'AAPL, MSFT ,goog' }, src);
  t('a CSV of symbols yields ONE row — url is UNIQUE', multi.rows.length === 1);
  t('the FIRST symbol is the one kept', multi.rows[0].symbol === 'AAPL');
  t('the dropped secondary tickers are COUNTED, not silent', multi.secondaryDropped === 2);
  t('a single-symbol story drops nothing', mapItem(base, src).secondaryDropped === 0);

  t('no symbols is SKIPPED with a reason', mapItem({ ...base, symbols: '' }, src).skipped.includes('no symbol'));
  t('an unmapped source is SKIPPED with the source named', mapItem({ ...base, source: 'rss:unknown' }, src).skipped.includes('unmapped source'));
  t('a missing url is SKIPPED', mapItem({ ...base, url: '' }, src).skipped === 'no url');
  t('a url over 250 chars is SKIPPED, never truncated', mapItem({ ...base, url: 'h' + 'x'.repeat(255) }, src).skipped.includes('too long'));
  t('an unreadable date is SKIPPED', mapItem({ ...base, publishedAt: 'not-a-date' }, src).skipped.includes('publishedAt'));

  t('severity 3 is impact high', mapItem({ ...base, severity: 3 }, src).rows[0].impact === 'high');
  t('severity 0 is impact low', mapItem({ ...base, severity: 0 }, src).rows[0].impact === 'low');
  t('bullish is +1', mapItem({ ...base, sentiment: 'bullish' }, src).rows[0].sentiment === 1);
  t('bearish is -1', mapItem({ ...base, sentiment: 'BEARISH' }, src).rows[0].sentiment === -1);

  console.log(`\n[self-test] ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

function sqlStr(v) {
  if (v === null || v === undefined) return 'NULL';
  return `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
}

(async () => {
  if (process.argv.includes('--self-test')) return selfTest();
  const apply = process.argv.includes('--apply');

  const conn = await connect();
  const sourceRows = (await query('SELECT id, name FROM newssource', conn))
    .trim().split(/\r?\n/).slice(1).map((l) => l.split('\t'));
  const sourceIdByName = Object.fromEntries(sourceRows.map(([id, name]) => [name, id]));

  const missing = [...new Set(Object.values(SOURCE_MAP))].filter((n) => !sourceIdByName[n]);
  if (missing.length) {
    // ⚠️ MIRRORS `news-import.service.ts:344` — the taxonomy row is created ON DEMAND there, so
    // find-or-create is the canonical behaviour rather than a convention invented here. It matters
    // that this is the same shape: `url` is NOT NULL and the service writes `''`, so a row created
    // here cannot differ from one created at ingest.
    //
    // ⚠️ ONLY ON `--apply`. A dry run that creates rows is not a dry run — a command reporting
    // "nothing written" while writing a taxonomy row is the exact defect these scripts exist to avoid.
    // For the dry run the names are mapped to a PLACEHOLDER id so the counts are still accurate, and
    // that substitution is stated in the output.
    if (apply) {
      console.log(`  creating ${missing.length} missing NewsSource row(s): ${missing.join(', ')}`);
      for (const name of missing) {
        await query(
          `INSERT IGNORE INTO newssource (id, name, url, reliabilityScore, patterns)
           VALUES (UUID(), ${sqlStr(name)}, '', 5.0, '{}')`, conn);
      }
      const refreshed = (await query('SELECT id, name FROM newssource', conn))
        .trim().split(/\r?\n/).slice(1).map((l) => l.split('\t'));
      for (const [id, name] of refreshed) sourceIdByName[name] = id;
    } else {
      console.log(`  DRY RUN: ${missing.length} NewsSource row(s) would be created on --apply: ${missing.join(', ')}`);
      for (const name of missing) sourceIdByName[name] = `(would-create:${name})`;
    }
  }

  /**
   * ⚠️ PARSED AS JSON, NOT AS TSV. `mysql --batch --raw` splits a row on TABS and the output on
   * NEWLINES, and `summary` is a TEXT column that contains newlines — so a line-based parse silently
   * shredded 490 rows into "no url" and 123 into "no title", against a SQL count of ZERO empty urls.
   * That is the shape this repo keeps finding: plausible output, no error, wrong underneath.
   * One JSON array in one column cannot be broken by a newline inside a value.
   */
  const jsonText = await query(
    `SELECT JSON_ARRAYAGG(JSON_OBJECT(
        'url', url, 'title', title, 'summary', summary, 'source', source,
        'symbols', symbols, 'sentiment', sentiment, 'severity', severity,
        'publishedAt', publishedAt))
     FROM news_item`, conn);
  // `mysql --batch` prints a header row — and for a multi-line statement the header is the WHOLE
  // query text, so counting lines is not safe. The payload is the first `[` onwards.
  const start = jsonText.indexOf('[');
  if (start === -1) throw new Error('the news_item read returned no JSON array — cannot migrate');
  const items = JSON.parse(jsonText.slice(start));

  const skipReasons = {};
  const rows = [];
  let secondaryDropped = 0;
  for (const item of items) {
    const { rows: mapped, skipped, secondaryDropped: dropped } = mapItem(item, sourceIdByName);
    if (skipped) { skipReasons[skipped] = (skipReasons[skipped] ?? 0) + 1; continue; }
    rows.push(...mapped);
    secondaryDropped += dropped ?? 0;
  }

  console.log(`\n  news_item rows read      ${items.length}`);
  console.log(`  newsarticle rows to add  ${rows.length}`);
  console.log('  skipped:');
  for (const [reason, n] of Object.entries(skipReasons).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(n).padStart(5)}  ${reason}`);
  }
  if (secondaryDropped > 0) {
    console.log(`\n  ⚠️  ${secondaryDropped} secondary ticker(s) cannot be stored: newsarticle.url is UNIQUE,`);
    console.log('      so a story keeps its FIRST symbol only. Needs a newsarticle_symbol join table.');
  }

  if (!apply) {
    console.log('\n  DRY RUN — nothing written. Re-run with --apply.\n');
    return;
  }

  // ⚠️ CHUNKED, AND SMALL ON PURPOSE. `mysql-cli` passes the SQL as a COMMAND-LINE ARGUMENT, and
  // Windows caps that at ~32 KB — measured: 200 rows of headlines and summaries failed with E2BIG
  // (`spawn ... pid 0`), which reads like a broken install. 40 keeps each statement comfortably
  // under the limit. `INSERT IGNORE` on the UNIQUE url makes this idempotent, so an interrupted run
  // is resumed by running it again rather than needing an offset.
  const CHUNK = 40;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const values = slice.map((r) => `(UUID(), ${sqlStr(r.symbol)}, ${sqlStr(r.sourceId)}, 'general',
      ${sqlStr(r.headline)}, ${sqlStr(r.url)}, ${sqlStr(r.summary)}, ${r.sentiment},
      ${sqlStr(r.impact)}, ${sqlStr(r.publishedAt.toISOString().slice(0, 23).replace('T', ' '))})`).join(',\n');
    await query(`INSERT IGNORE INTO newsarticle
      (id, symbol, sourceId, category, headline, url, summary, sentiment, impact, publishedAt)
      VALUES ${values}`, conn);
    inserted += slice.length;
    process.stdout.write(`\r  written ${inserted}/${rows.length}`);
  }
  console.log('\n');

  const after = await query('SELECT COUNT(*) n FROM newsarticle', conn);
  console.log(`  newsarticle now holds ${after.trim().split(/\r?\n/)[1]} row(s)`);
})();
