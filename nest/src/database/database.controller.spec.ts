/**
 * resolveRequestedTables — `?tables=` must either return every name asked for, or refuse.
 * ==========================================================================================
 * ⚠️ WHY THIS EXISTS (#1292, 2026-11-18). `SHOW TABLE STATUS.Rows` is an InnoDB ESTIMATE, and the
 * page had just been fixed to stop presenting it as a row count. Making the endpoint return real
 * `COUNT(*)` values introduced three new ways to be silently wrong, and each one produces a number
 * that looks fine:
 *
 *   1. an unrecognised name SKIPPED      → the page renders that table with no count, which reads
 *                                          exactly like a table holding no rows
 *   2. a name validated by a regex only  → any well-formed string reaches the SQL, so the guarantee
 *                                          comes from string shape rather than from the schema
 *   3. duplicate names not collapsed     → `… AS score, … AS score` is a MySQL "Duplicate column
 *                                          name" error: a 500 that names none of the cause
 *
 * The third is why the dedupe is asserted by LENGTH and not only by contents — a length assertion
 * is the only one that fails when the duplicate survives.
 */
import { BadRequestException } from '@nestjs/common';
import { resolveRequestedTables } from './database.controller';

/** The real server-side spelling: MySQL table names here are lowercase. */
const realNames = new Map<string, string>([
  ['symbol', 'symbol'],
  ['score', 'score'],
  ['marketbar', 'marketbar'],
  ['order', 'order'],
  ['order_item', 'order_item'],
]);

describe('resolveRequestedTables', () => {
  it('returns the real server-side spelling, in request order', () => {
    expect(resolveRequestedTables('Score,symbol,MarketBar', realNames)).toEqual([
      'score',
      'symbol',
      'marketbar',
    ]);
  });

  it('is case- and whitespace-tolerant', () => {
    expect(resolveRequestedTables('  SCORE ,  Symbol ', realNames)).toEqual(['score', 'symbol']);
  });

  it('absent, empty and comma-only values all mean "no exact counts", not "every table"', () => {
    // An empty result must NOT be read as "no tables requested → do them all". 130 COUNT(*) calls
    // cost ~2.9 s; 19 cost ~0.5 s. Widening here would silently make the page slow.
    expect(resolveRequestedTables(undefined, realNames)).toEqual([]);
    expect(resolveRequestedTables('', realNames)).toEqual([]);
    expect(resolveRequestedTables('   ', realNames)).toEqual([]);
    expect(resolveRequestedTables(',,,', realNames)).toEqual([]);
  });

  it('⚠️ an unknown name is REFUSED and named, never skipped', () => {
    // The failure this guards: skipping a typo leaves the page showing that table with `—` rows,
    // which is the same rendering as a genuinely empty table.
    expect(() => resolveRequestedTables('score,not_a_table', realNames)).toThrow(BadRequestException);
    expect(() => resolveRequestedTables('score,not_a_table', realNames)).toThrow(/not_a_table/);
  });

  it('reports EVERY unknown name, not just the first', () => {
    expect(() => resolveRequestedTables('nope,score,alsonope', realNames)).toThrow(/nope.*alsonope/);
  });

  it('⚠️ accepts a name that is well formed but is not a real table', () => {
    // The regex this replaces (`^[A-Za-z0-9_]+$`) would have ACCEPTED `information_schema` and
    // `fake_table`. The allowlist is the schema's own table list, so both must be refused.
    for (const bad of ['information_schema', 'fake_table', 'mysql']) {
      expect(() => resolveRequestedTables(bad, realNames)).toThrow(BadRequestException);
    }
  });

  it('⚠️ collapses duplicates — the SQL aliases columns, and MySQL rejects a repeated alias', () => {
    const out = resolveRequestedTables('score,Score,SCORE,symbol', realNames);
    expect(out).toEqual(['score', 'symbol']);
    // Length is the assertion that actually fails when the duplicate survives.
    expect(out).toHaveLength(2);
  });

  it('keeps an underscore-bearing name intact', () => {
    expect(resolveRequestedTables('order_item', realNames)).toEqual(['order_item']);
  });

  /**
   * `declared` — added 2026-11-25 with the table registry.
   *
   * ⚠️ WHY A KEYWORD AND NOT A LIST ON THE PAGE. The page used to hold its own array of tables to
   * count. That is a second copy of `table-usage.data.ts`, and the copy that is NOT corrected is the
   * one that produces the wrong number. The keyword also settles an ordering question the page could
   * not: declaration order is irrelevant here, so the result is filtered, never merged.
   */
  it('⚠️ `declared` expands to the declared set, intersected with the real schema', () => {
    expect(
      resolveRequestedTables('declared', realNames, ['Score', 'gone', 'marketbar']),
    ).toEqual(['score', 'marketbar']);
  });

  it('`declared` is case-insensitive as a keyword', () => {
    expect(resolveRequestedTables('  DECLARED ', realNames, ['symbol'])).toEqual(['symbol']);
  });

  it('⚠️ a declared-but-absent table is DROPPED, not refused', () => {
    // The opposite of the `?tables=` rule above, deliberately: one bad name in a HAND request is a
    // typo the caller must fix, while one stale entry in the DECLARATION must not take the whole
    // registry offline. It is reported as `summary.declaredMissing` instead of being silent.
    expect(resolveRequestedTables('declared', realNames, ['not_there'])).toEqual([]);
  });

  it('`declared` collapses duplicates across spellings', () => {
    const out = resolveRequestedTables('declared', realNames, ['score', 'Score', 'score']);
    expect(out).toEqual(['score']);
    expect(out).toHaveLength(1);
  });

  it('an empty declaration counts nothing rather than everything', () => {
    // Widening to "all tables" here would make every registry load pay the 2.9 s all-tables count.
    expect(resolveRequestedTables('declared', realNames, [])).toEqual([]);
  });
});
