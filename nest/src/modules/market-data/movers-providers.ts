/**
 * movers-providers.ts — the parsers and URLs for the market-wide movers feed, one per provider.
 * ============================================================================================
 *
 * ⚠️ WHY THE PARSING IS OUT HERE AND NOT INSIDE THE SERVICE. Every failure this feed has produced has
 * been a PARSING failure that looked like data: a throttle body `{"Note": "..."}` read as "no movers",
 * a warrant priced at $0.007 read as a mover. A parser that can be called with a literal payload is
 * testable; one welded to `fetch` is only testable by hoping the vendor cooperates.
 *
 * ── PROVIDER ORDER, AND WHY (measured 2026-11-18 during US regular hours) ──
 *
 * | Provider | Freshness at measurement | One call returns |
 * |---|---|---|
 * | **Yahoo** `screener/predefined/saved` | quotes timestamped **seconds** before the request | 95 gainers / 174 losers, each WITH volume, `averageDailyVolume3Month`, open, day range, 52-week bounds and `earningsTimestamp` |
 * | FMP `/stable/biggest-*` | live | 50 + 50 rows, but ONLY `symbol, price, name, change, changesPercentage, exchange` |
 * | Alpha Vantage `TOP_GAINERS_LOSERS` | **`last_updated` was the PREVIOUS SESSION's close** — a full trading day behind at 12:10 ET | 20 + 20, and the top rows were warrants (`BGLWW` +200%, vol 2,700) |
 *
 * So Yahoo is primary, FMP is the fallback, and Alpha Vantage is no longer wired: a feed one session
 * old is not a movers feed, and the code that used it had to say so in the UI rather than serve it.
 *
 * 🛑 **FMP CANNOT RUN THE VOLUME FILTER.** Its movers payload carries no volume and no open price.
 * That is not a reason to drop the filter silently — `volume: null` is reported, and the service marks
 * `filtersApplied.volumeFilterApplied: false` so a reader can see the list was only partly screened.
 * A filter that cannot run must say so (`development-philosophy` §7).
 *
 * ⚠️ **`exchangeDataDelayedBy` IS CARRIED, NOT ASSUMED AWAY.** Yahoo reports 15 for `NasdaqGS` on this
 * machine. Whether that delay applies to this account could not be verified here (the obvious
 * cross-check, FMP's `/stable/quote`, is premium on this plan), so the number is passed through and the
 * SERVICE decides against `movers.maxDelayMinutes`. A feed whose delay is unknown must not be treated
 * as real-time just because its timestamps look recent.
 */

import type { RawMover } from './market-movers.service';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) '
  + 'Chrome/131.0.0.0 Safari/537.36';

/**
 * ⚠️ THE USER-AGENT IS NOT OPTIONAL. Measured 2026-11-18 on the Yahoo bars adapter in this same repo:
 * `fetch(url)` with no UA returns **HTTP 429** and a 19-byte body, while the same request with a
 * browser UA returns 200 and the full payload. Yahoo answers differently depending on who is asking,
 * and the failure reads as "the provider is down" rather than "we never identified ourselves".
 */
export const YAHOO_HEADERS = {
  'User-Agent': UA,
  Accept: 'application/json,text/plain,*/*',
  'Accept-Language': 'en-US,en;q=0.9',
};

/** The three prebuilt screeners this feed uses. `day_gainers`/`day_losers` are the movers. */
export type ScreenerId = 'day_gainers' | 'day_losers' | 'most_actives';

export function yahooScreenerUrl(id: ScreenerId, count: number): string {
  const n = Math.max(1, Math.min(250, Math.floor(count)));
  return 'https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved'
    + `?scrIds=${encodeURIComponent(id)}&count=${n}&formatted=false`;
}

export function fmpMoversUrl(direction: 'winner' | 'loser'): string {
  // ⚠️ `/stable/…`, NOT `/api/v3/stock_market/…`. The legacy path returns **HTTP 403** on a key created
  // under the current plan; the `/stable` path returns 200 for the SAME key. Measured 2026-11-18.
  return `https://financialmodelingprep.com/stable/${direction === 'winner' ? 'biggest-gainers' : 'biggest-losers'}`;
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function strOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

/** What one provider returned, before our filters. */
export interface ProviderResult {
  provider: 'yahoo' | 'fmp';
  winners: RawMover[];
  losers: RawMover[];
  mostActive: RawMover[];
  /** The provider's own idea of when its data was current. `null` when it gives none. */
  lastUpdated: string | null;
  /** Exchange delay the provider declares, in minutes. `null` when unstated. */
  delayedByMinutes: number | null;
  /** Rows the provider offered, before filtering. */
  raw: number;
}

/**
 * parseYahooScreener() — one screener response into rows.
 *
 * ⚠️ IT THROWS ON AN EMPTY PAYLOAD RATHER THAN RETURNING `[]`. Yahoo returns 200 with a
 * `finance.error` object for a bad `scrIds`; reading that as "no movers today" is the false-empty this
 * file exists to prevent.
 */
export function parseYahooScreener(
  body: unknown,
  direction: RawMover['direction'],
): { rows: RawMover[]; delayedByMinutes: number | null } {
  const b = body as Record<string, any> | null;
  const result = b?.finance?.result?.[0];
  if (!result) {
    const msg = b?.finance?.error?.description ?? 'no finance.result[0] in the payload';
    throw new Error(`Yahoo screener returned no result: ${String(msg).slice(0, 200)}`);
  }
  const quotes: Array<Record<string, any>> = Array.isArray(result.quotes) ? result.quotes : [];
  let delayedByMinutes: number | null = null;

  const rows: RawMover[] = [];
  for (const q of quotes) {
    const ticker = strOrNull(q.symbol)?.toUpperCase();
    if (!ticker) continue;
    const delayed = numOrNull(q.exchangeDataDelayedBy);
    if (delayed !== null) delayedByMinutes = Math.max(delayedByMinutes ?? 0, delayed);
    rows.push({
      ticker,
      price: numOrNull(q.regularMarketPrice),
      changePct: numOrNull(q.regularMarketChangePercent),
      volume: numOrNull(q.regularMarketVolume),
      direction,
      // ── Enrichment the strategy needs, and which this feed gives for free ──
      name: strOrNull(q.shortName) ?? strOrNull(q.longName) ?? null,
      exchange: strOrNull(q.fullExchangeName) ?? strOrNull(q.exchange) ?? null,
      quoteType: strOrNull(q.quoteType),
      open: numOrNull(q.regularMarketOpen),
      previousClose: numOrNull(q.regularMarketPreviousClose),
      dayHigh: numOrNull(q.regularMarketDayHigh),
      dayLow: numOrNull(q.regularMarketDayLow),
      volume3MonthAvg: numOrNull(q.averageDailyVolume3Month),
      earningsAt: numOrNull(q.earningsTimestamp),
      quoteTime: numOrNull(q.regularMarketTime),
    });
  }
  return { rows, delayedByMinutes };
}

/**
 * parseFmpMovers() — one FMP movers response into rows.
 *
 * ⚠️ EVERY ROW COMES BACK WITH `volume: null` AND `open: null`, because the payload has no such fields.
 * That is reported, not filled in: a fabricated volume would pass the volume filter and become a
 * liquidity claim nobody made.
 */
export function parseFmpMovers(body: unknown, direction: RawMover['direction']): RawMover[] {
  const arr = Array.isArray(body) ? body : [];
  const rows: RawMover[] = [];
  for (const r of arr as Array<Record<string, any>>) {
    const ticker = strOrNull(r.symbol)?.toUpperCase();
    if (!ticker) continue;
    rows.push({
      ticker,
      price: numOrNull(r.price),
      changePct: numOrNull(r.changesPercentage),
      volume: null,
      direction,
      name: strOrNull(r.name),
      exchange: strOrNull(r.exchange),
      open: null,
      previousClose: null,
      dayHigh: null,
      dayLow: null,
      volume3MonthAvg: null,
      earningsAt: null,
      quoteTime: null,
    });
  }
  return rows;
}

/**
 * newestQuoteTime() — the freshest `regularMarketTime` in a set of rows, as an ISO string.
 *
 * ⚠️ YAHOO GIVES NO LIST-LEVEL TIMESTAMP, so one has to be derived, and the choice must be stated:
 * the NEWEST tick is used, because the question `movers.maxAgeMinutes` answers is *"is this feed
 * alive?"* — not *"did every symbol in it trade in the last minute?"*. An illiquid name legitimately
 * goes quiet for twenty minutes; using the OLDEST tick would mark a perfectly live feed stale.
 */
export function newestQuoteTime(rows: RawMover[]): string | null {
  let newest = 0;
  for (const r of rows) {
    if (typeof r.quoteTime === 'number' && r.quoteTime > newest) newest = r.quoteTime;
  }
  return newest > 0 ? new Date(newest * 1000).toISOString() : null;
}
