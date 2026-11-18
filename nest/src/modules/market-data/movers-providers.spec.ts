/**
 * movers-providers.spec.ts — the parsers, pinned against the payloads actually measured.
 *
 * ⚠️ Every failure this feed has produced looked like data rather than an error: a throttle body read
 * as "no movers", a warrant at $0.007 read as a mover, a missing volume read as zero. These cases are
 * the shapes of those failures, taken from live responses on 2026-11-18.
 */
import {
  fmpMoversUrl,
  newestQuoteTime,
  parseFmpMovers,
  parseYahooScreener,
  yahooScreenerUrl,
} from './movers-providers';
import type { RawMover } from './market-movers.service';

/** A trimmed copy of a real `day_gainers` quote, keeping every field the parser reads. */
const yahooQuote = (over: Record<string, unknown> = {}) => ({
  symbol: 'TENB',
  shortName: 'Tenable Holdings, Inc.',
  longName: 'Tenable Holdings, Inc.',
  fullExchangeName: 'NasdaqGS',
  exchange: 'NMS',
  quoteType: 'EQUITY',
  regularMarketPrice: 43.255,
  regularMarketChangePercent: 12.070537,
  regularMarketVolume: 1510874,
  regularMarketOpen: 39.05,
  regularMarketPreviousClose: 38.6,
  regularMarketDayHigh: 43.72,
  regularMarketDayLow: 39.05,
  averageDailyVolume3Month: 4226676,
  earningsTimestamp: 1793217600,
  regularMarketTime: 1795021735,
  exchangeDataDelayedBy: 15,
  ...over,
});

const yahooBody = (quotes: unknown[], delayedBy = 15) => ({
  finance: { result: [{ quotes, exchangeDataDelayedBy: delayedBy }], error: null },
});

describe('parseYahooScreener', () => {
  it('maps every enrichment field the strategy needs, in one call', () => {
    const { rows } = parseYahooScreener(yahooBody([yahooQuote()]), 'winner');
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.ticker).toBe('TENB');
    expect(r.price).toBe(43.255);
    expect(r.changePct).toBeCloseTo(12.07, 2);
    expect(r.volume).toBe(1510874);
    // The four the strategy cannot work without:
    expect(r.open).toBe(39.05);                       // opening-range / gap
    expect(r.volume3MonthAvg).toBe(4226676);          // RVOL denominator
    expect(r.earningsAt).toBe(1793217600);            // catalyst
    expect(r.previousClose).toBe(38.6);
    expect(r.name).toBe('Tenable Holdings, Inc.');
    expect(r.quoteType).toBe('EQUITY');
  });

  it('reports the exchange delay it declares, taking the worst row', () => {
    const { delayedByMinutes } = parseYahooScreener(
      yahooBody([yahooQuote({ exchangeDataDelayedBy: 0 }), yahooQuote({ symbol: 'X', exchangeDataDelayedBy: 20 })]),
      'winner',
    );
    expect(delayedByMinutes).toBe(20);
  });

  it('⚠️ THROWS on a payload with no result, rather than returning an empty list', () => {
    // Yahoo answers 200 with an error object for a bad scrIds. Returning [] would be a confident
    // "no movers today" produced by a failed request.
    expect(() => parseYahooScreener({ finance: { result: null, error: { description: 'bad id' } } }, 'winner'))
      .toThrow(/no result/i);
    expect(() => parseYahooScreener(null, 'winner')).toThrow(/no result/i);
  });

  it('drops rows with no ticker and keeps the rest', () => {
    const { rows } = parseYahooScreener(
      yahooBody([yahooQuote({ symbol: '' }), yahooQuote({ symbol: 'aapl' })]),
      'winner',
    );
    expect(rows.map((r) => r.ticker)).toEqual(['AAPL']);
  });

  it('⚠️ leaves a missing field NULL, never zero', () => {
    const { rows } = parseYahooScreener(
      yahooBody([yahooQuote({ regularMarketVolume: null, averageDailyVolume3Month: undefined })]),
      'winner',
    );
    expect(rows[0].volume).toBeNull();
    expect(rows[0].volume3MonthAvg).toBeNull();
    expect(rows[0].volume).not.toBe(0);
  });
});

describe('parseFmpMovers', () => {
  const fmpRow = {
    symbol: 'SVRE',
    price: 0.8435,
    name: 'SaverOne 2014 Ltd',
    change: 0.4337,
    changesPercentage: 105.83211,
    exchange: 'NASDAQ',
  };

  it('parses the fields FMP actually sends', () => {
    const rows = parseFmpMovers([fmpRow], 'winner');
    expect(rows[0].ticker).toBe('SVRE');
    expect(rows[0].changePct).toBeCloseTo(105.83, 2);
  });

  it('⚠️ reports volume and open as NULL — the payload has no such field', () => {
    // A fabricated volume would pass the volume filter and become a liquidity claim nobody made.
    const rows = parseFmpMovers([fmpRow], 'winner');
    expect(rows[0].volume).toBeNull();
    expect(rows[0].open).toBeNull();
    expect(rows[0].volume3MonthAvg).toBeNull();
  });

  it('an error body is an empty list here — the SERVICE treats an empty provider result as a failure', () => {
    expect(parseFmpMovers({ 'Error Message': 'premium endpoint' }, 'winner')).toEqual([]);
    expect(parseFmpMovers(null, 'winner')).toEqual([]);
  });
});

describe('newestQuoteTime', () => {
  const at = (quoteTime: number | null): RawMover => ({
    ticker: 'X', price: 1, changePct: 1, volume: 1, direction: 'winner', quoteTime,
  });

  it('⚠️ uses the NEWEST tick, not the oldest', () => {
    // maxAgeMinutes answers "is this feed alive?", not "did every symbol trade in the last minute?".
    // An illiquid name legitimately goes quiet; using the oldest tick would call a live feed stale.
    expect(newestQuoteTime([at(100), at(300), at(200)])).toBe(new Date(300 * 1000).toISOString());
  });

  it('is null when no row carries a time — which staleness() reads as stale', () => {
    expect(newestQuoteTime([at(null), at(null)])).toBeNull();
    expect(newestQuoteTime([])).toBeNull();
  });
});

describe('urls', () => {
  it('clamps the Yahoo count into the range the endpoint accepts', () => {
    expect(yahooScreenerUrl('day_gainers', 5000)).toContain('count=250');
    expect(yahooScreenerUrl('day_losers', 0)).toContain('count=1');
    expect(yahooScreenerUrl('day_gainers', 60)).toContain('scrIds=day_gainers');
  });

  it('⚠️ uses the /stable path — the legacy /api/v3 path answers 403 on a current key', () => {
    expect(fmpMoversUrl('winner')).toContain('/stable/biggest-gainers');
    expect(fmpMoversUrl('loser')).toContain('/stable/biggest-losers');
    expect(fmpMoversUrl('winner')).not.toContain('/api/v3/');
  });
});
