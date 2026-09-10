#!/usr/bin/env node
/**
 * #763 — normalise merged watchlist symbol arrays to ONE entry per ticker.
 *
 * WHY
 * ---
 * `consolidate-watchlists.sql` merged five duplicate watchlists onto their UUID-identified
 * row using JSON_MERGE_PRESERVE. That was the right call — it loses nothing, and for
 * `dxy-sensitive` it recovered `USDCNH`/`USDSEK`, which existed only on the row the old
 * `LIMIT 1` query had a coin-flip chance of reading. But concatenating two arrays means
 * every symbol now appears twice: once as a rich object (from the slug row) and once as a
 * bare ticker (from the uuid row).
 *
 * The application resolver dedupes, so this is not a runtime bug. It is still worth
 * removing:
 *   - an array listing the same symbol twice reads as corruption, and the next person to
 *     open the table cannot tell duplication from intent;
 *   - any consumer that does NOT dedupe would double-count (e.g. a basket-weighting or
 *     a count displayed to the operator).
 *
 * STRATEGY
 * --------
 * Prefer the RICH `{ name, ticker, type, exchange }` form, because it carries display data
 * the bare form has already lost. Fill in any ticker that exists only as a bare string.
 * One entry per ticker, order of first appearance preserved.
 *
 * Idempotent: running twice produces the same arrays.
 *
 * Usage:  node scripts/normalise-watchlists.cjs [--dry-run]
 */

const path = require('path');
const { PrismaClient } = require(path.join(__dirname, '..', 'node_modules', '@prisma', 'client'));

const DRY_RUN = process.argv.includes('--dry-run');

/** Pull a ticker out of either storage form. */
function tickerOf(entry) {
  if (typeof entry === 'string') return entry.trim().toUpperCase();
  const t = entry && (entry.ticker || entry.symbol);
  return typeof t === 'string' ? t.trim().toUpperCase() : null;
}

/** Normalise one array to one entry per distinct ticker, richest form wins. */
function normalise(symbols) {
  if (!Array.isArray(symbols)) return symbols;

  const order = [];
  const richest = new Map(); // ticker -> entry

  for (const entry of symbols) {
    const ticker = tickerOf(entry);
    if (!ticker) continue;

    if (!richest.has(ticker)) {
      order.push(ticker);
      richest.set(ticker, entry);
      continue;
    }

    // Upgrade a bare string to the object form when we later see one, so display
    // metadata (name/exchange/type) is never the thing that gets dropped.
    const current = richest.get(ticker);
    const currentIsBare = typeof current === 'string';
    const candidateIsRich = typeof entry === 'object' && entry !== null;
    if (currentIsBare && candidateIsRich) {
      // Keep the original bare form's position but adopt the richer payload.
      richest.set(ticker, { ...entry, ticker });
    }
  }

  return order.map((t) => richest.get(t));
}

(async () => {
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.$queryRawUnsafe(`SELECT id, name, symbols FROM watchlist`);

    let changed = 0;
    let symbolsRemoved = 0;

    for (const row of rows) {
      let parsed;
      try {
        parsed = typeof row.symbols === 'string' ? JSON.parse(row.symbols) : row.symbols;
      } catch {
        console.warn(`  SKIP ${row.name} (${row.id}) — symbols is not valid JSON`);
        continue;
      }
      if (!Array.isArray(parsed)) continue;

      const before = parsed.length;
      const after = normalise(parsed);
      if (after.length === before) continue;

      changed += 1;
      symbolsRemoved += before - after.length;
      console.log(`  ${row.name}: ${before} → ${after.length} entries`);

      if (!DRY_RUN) {
        await prisma.$executeRawUnsafe(
          `UPDATE watchlist SET symbols = CAST(? AS JSON), updatedAt = NOW() WHERE id = ?`,
          JSON.stringify(after),
          row.id,
        );
      }
    }

    console.log(
      `\n[normalise-watchlists] ${DRY_RUN ? 'DRY RUN — ' : ''}${changed} watchlist(s) ${DRY_RUN ? 'would be' : ''} normalised, ${symbolsRemoved} duplicate entr${symbolsRemoved === 1 ? 'y' : 'ies'} removed`,
    );
  } finally {
    await prisma.$disconnect();
  }
})().catch((err) => {
  console.error('[normalise-watchlists] failed:', err.message);
  process.exit(1);
});
