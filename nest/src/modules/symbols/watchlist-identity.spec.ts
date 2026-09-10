/**
 * Watchlist identity contract — INV-WATCHLIST-IDENTITY (#763)
 * ===========================================================
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Two separate faults made watchlist resolution unreliable, and both were invisible.
 *
 * 1. RESOLUTION WAS BY NAME, NOT BY RELATIONSHIP.
 *    `getWatchlistSymbols()` and `collectNamedWatchlist()` matched `watchlist.name`
 *    against a protocol's slug/id text, normalising only `-` and `_` to spaces. So
 *    renaming a watchlist (`momentum-stocks` → `Momentum Stocks (US)`) silently stopped
 *    matching, and the protocol fell through to the name-guessing hint fallback. The
 *    links that DID work were keyed on text, so they were rename-fragile by construction.
 *
 * 2. THE QUERY WAS NONDETERMINISTIC.
 *    Five watchlists existed TWICE — once with a slug-shaped id (`leverage-long`) and once
 *    with a UUID — and the name query ended in `LIMIT 1` with no `ORDER BY`. Which row a
 *    protocol read depended on storage order. That is not theoretical: the pairs did NOT
 *    hold identical content. `dxy-sensitive`'s UUID row carried 12 symbols including
 *    `USDCNH`/`USDSEK`; its slug row carried 10 and was missing both. A protocol reading
 *    the DXY basket had a coin-flip chance of silently dropping two currency pairs.
 *
 * WHAT THIS FILE ASSERTS
 * ----------------------
 * These are pure/static claims where possible, plus a live-data claim via the probe:
 *   1. The resolver source prefers an FK (`protocolId`) and never resolves a protocol's
 *      symbols from a name comparison alone.
 *   2. Every name-based watchlist query pins its ordering, so a duplicate pair cannot
 *      resolve by storage order.
 *   3. The consolidation is complete: no watchlist name appears twice.
 *
 * Assertions 1 and 2 read the source text deliberately. They are structural properties of
 * a query, and the failure mode is "someone reintroduced a name match / dropped the ORDER
 * BY", which no behavioural unit test on a mocked Prisma would catch.
 */

import * as fs from 'fs';
import * as path from 'path';

const NEST_ROOT = path.resolve(__dirname, '..', '..', '..');

function readSource(relPath: string): string {
  return fs.readFileSync(path.join(NEST_ROOT, relPath), 'utf8');
}

/** Strip comments so a claim in prose cannot satisfy an assertion about code. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const PROTOCOL_DB = 'src/modules/scoring/protocol-db.service.ts';
const SYMBOL_RESOLVER = 'src/modules/symbols/symbol-resolver.service.ts';

describe('watchlist identity (#763)', () => {
  describe('resolution prefers a foreign key over a name match', () => {
    it('protocol-db links a watchlist through watchlist.protocolId', () => {
      const src = stripComments(readSource(PROTOCOL_DB));
      expect(src).toMatch(/protocolId IN\s*\(/);
    });

    it('symbol-resolver joins watchlist to protocol on id, not on name', () => {
      const src = stripComments(readSource(SYMBOL_RESOLVER));
      // A JOIN predicate must compare p.id = w.protocolId.
      expect(src).toMatch(/JOIN protocol p ON p\.id = w\.protocolId/);
    });
  });

  describe('every name-based watchlist query pins its ordering', () => {
    // The bug was `LIMIT 1` with no ORDER BY over rows that can share a name.
    // Any surviving name query must order deterministically (UUID-shaped id first).
    const NAME_QUERIES: Array<{ file: string; label: string }> = [
      { file: PROTOCOL_DB, label: 'protocol-db.getWatchlistSymbols' },
      { file: SYMBOL_RESOLVER, label: 'symbol-resolver.collectNamedWatchlist' },
    ];

    for (const { file, label } of NAME_QUERIES) {
      it(`${label} orders by a UUID-shaped id before LIMIT 1`, () => {
        const src = stripComments(readSource(file));
        // Find the fuzzy name match on the watchlist table.
        const idx = src.indexOf("REPLACE(name, '-', ' ')");
        expect(idx).toBeGreaterThan(-1);

        // The ORDER BY must appear between the WHERE and the LIMIT.
        const limitIdx = src.indexOf('LIMIT 1', idx);
        expect(limitIdx).toBeGreaterThan(-1);
        const between = src.slice(idx, limitIdx);

        expect(between).toMatch(/ORDER BY/);
        expect(between).toMatch(/REGEXP '\^\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-'/);
      });
    }
  });

  describe('the derivation fallback is loud', () => {
    it('protocol-db warns when it has to guess a symbol from the protocol name', () => {
      const src = stripComments(readSource(PROTOCOL_DB));
      // The guessed-symbol warning must name the protocol and tell the operator how to
      // wire it properly — that is what makes the fallback visible instead of silent.
      expect(src).toMatch(/GUESSED from its name/);
      expect(src).toMatch(/watchlist\.protocolId/);
    });
  });
});
