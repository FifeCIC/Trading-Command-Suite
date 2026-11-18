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
});
