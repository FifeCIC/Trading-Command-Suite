/**
 * toSymbolList.spec.ts — the watchlist JSON reader distinguishes EMPTY from UNPARSEABLE (#1351).
 *
 * `readWatchlistFromFile()` falls back to `src/data/watchlists/<name>.json` when the table has not
 * been seeded. It used to read the parsed JSON as `any`, so nothing checked the shape — and the two
 * outcomes it can return are not interchangeable:
 *
 *   []      a REAL answer: the file lists nothing. The caller may treat that as "no symbols".
 *   null    NO answer: the file is missing, unreadable, or is not the shape a watchlist has.
 *
 * Collapsing them is the repo's most repeated defect — `[]` is information, `null` is the absence of
 * information. The original code kept them apart through `.filter(Boolean)` returning an empty array
 * and the shape guards returning `null`, and this suite locks that so a future narrowing cannot
 * quietly merge them.
 */
import { toSymbolList } from './automation-loop.service';

describe('toSymbolList() — a watchlist file entry as a ticker', () => {
  it('accepts bare tickers', () => {
    expect(toSymbolList(['AAPL', 'NVDA'])).toEqual(['AAPL', 'NVDA']);
  });

  it('accepts objects carrying `ticker` or `symbol`', () => {
    expect(toSymbolList([{ ticker: 'AAPL' }, { symbol: 'NVDA' }])).toEqual(['AAPL', 'NVDA']);
  });

  it('accepts a mixture, which is what the real files hold', () => {
    expect(toSymbolList(['AAPL', { ticker: 'NVDA' }, { symbol: 'TSLA' }])).toEqual(['AAPL', 'NVDA', 'TSLA']);
  });

  it('drops an entry that names nothing, rather than inventing a ticker', () => {
    expect(toSymbolList([{ ticker: 42 }, {}, null, 'AAPL', ''])).toEqual(['AAPL']);
  });

  it('returns an EMPTY ARRAY for an empty list — that is an answer, not an absence', () => {
    expect(toSymbolList([])).toEqual([]);
  });

  it('returns an empty array when every entry is unusable, matching the old `.filter(Boolean)`', () => {
    // ⚠️ This is the case a "return null when nothing usable" rewrite would silently change: the
    // caller treats null as "no file" and falls through to the table. An empty array is a real,
    // if unhelpful, contents.
    expect(toSymbolList([{}, { ticker: 1 }])).toEqual([]);
  });

  it('returns NULL when the value is not an array — "cannot judge", never "empty"', () => {
    expect(toSymbolList({ symbols: ['AAPL'] })).toBeNull();
    expect(toSymbolList('AAPL')).toBeNull();
    expect(toSymbolList(null)).toBeNull();
    expect(toSymbolList(undefined)).toBeNull();
    expect(toSymbolList(7)).toBeNull();
  });
});
