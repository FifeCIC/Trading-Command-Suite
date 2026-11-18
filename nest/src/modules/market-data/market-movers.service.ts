/**
 * market-movers.service.ts — a MARKET-WIDE winners/losers feed, from a ready-made provider (#1283).
 *
 * ── WHY THIS IS SEPARATE FROM `getTopMovers()` ──
 * Owner, 2026-11-16: *"we would ideally use a ready made source of top movers: top winners and top
 * losers. It doesn't make sense to only process our registered symbols for the strategy I want the
 * app to support. That doesn't mean it's not a good idea to have a page that shows us the top movers
 * out of the symbols that are registered — those are two separate purposes/features."*
 *
 * They are two different questions and must not share an implementation:
 *
 *   getTopMovers()            → "what is TCS doing with OUR symbols?"      (registered universe)
 *   MarketMoversService       → "what should we consider at all?"          (whole market, upstream)
 *
 * The first is bounded by what we already hold — measured 2026-11-15: `symbol_protocol_assignment`
 * 54 rows / 31 symbols, `watchlist_item` **0 items**. A discovery strategy built on that universe can
 * only ever see symbols it was already pointed at, which is the whole defect.
 *
 * ── THE SOURCE, AND WHY THIS ONE (measured 2026-11-16) ──
 *
 * | Provider | Movers endpoint | State on this machine |
 * |---|---|---|
 * | Trading 212 | **none** — v0 API is account / portfolio / orders / instruments / quotes only | n/a |
 * | FMP | `/stable/biggest-gainers`, `biggest-losers`, `most-actives` | **HTTP 401** — premium on this plan. (`/stable/profile` returns 200, so the KEY is valid and the endpoints are not entitled) |
 * | Alpha Vantage | `TOP_GAINERS_LOSERS` | ✅ **works**, key already in `nest/.env` |
 *
 * ── 🛑 TWO MEASURED HAZARDS THIS FILE EXISTS TO HANDLE ──
 *
 * **1. SIXTY PERCENT OF THE RAW LIST IS NOT TRADEABLE.** Measured 2026-11-16 on one live response:
 * 12 of 20 top gainers and 11 of 20 top losers were warrants (`...W`) or rights (`...R`) —
 * `BZFDW` at $0.02, `BEATW` at $0.011, `DAICW` at $0.0069 with volume **3,056**. Feeding that list
 * into a strategy would open positions in instruments we cannot route and would not want.
 *
 * ⚠️ **AND THE COMPANY NAME DOES NOT TELL YOU.** FMP's profile for `BZFDW` returns
 * `companyName: "BuzzFeed, Inc."` — no mention of "warrant" — while `HCICR` returns
 * "...Share Rights". So a name-based filter misses some and catches others. **The TICKER SUFFIX is
 * the only reliable classifier, and even that is a heuristic**, which is why every exclusion is
 * REPORTED with its reason rather than silently dropped (see `excluded[]` in the result).
 *
 * **2. THE LIST CAN BE DAYS OLD.** Measured 2026-11-16 at 17:00 UTC (12:00 ET, market open): the
 * response carried `last_updated: 2026-11-13 16:15:59 US/Eastern` — **the previous Friday's close**.
 * A movers list that is three days stale is not a movers list, it is a history lesson, and entering
 * at Monday's open on Friday's gainers is the exact wrong trade. So the age is always returned, and
 * a list older than `movers.maxAgeMinutes` is marked `stale: true` and must be REFUSED by any caller
 * that would trade on it.
 *
 * ── ⚠️ FILTERS ARE SETTINGS, NEVER CONSTANTS ──
 * Every threshold below is a declared setting (`settings-registry.ts`, owner `market-movers`) so the
 * owner can change it from the UI without a redeploy. That is the standing requirement: no decision
 * lives only in code.
 */
import { Injectable, Logger } from '@nestjs/common';
import { SettingsResolverService } from '../../common/settings/settings-resolver.service';
import { SymbolDiscoveryService } from './symbol-discovery.service';
import {
  YAHOO_HEADERS,
  fmpMoversUrl,
  newestQuoteTime,
  parseFmpMovers,
  parseYahooScreener,
  yahooScreenerUrl,
  type ProviderResult,
} from './movers-providers';

/** One row of the provider's movers feed, before our filters. */
export interface RawMover {
  ticker: string;
  price: number | null;
  changePct: number | null;
  volume: number | null;
  direction: 'winner' | 'loser' | 'active';
  /**
   * ── ENRICHMENT (2026-11-18) ──
   * The fields the parabolic-momentum strategy needs, carried straight from the feed so no per-symbol
   * call is required. Every one is `null`-able: FMP's movers payload supplies NONE of them, and a
   * missing value must stay missing rather than become a zero someone later reads as a measurement.
   */
  name?: string | null;
  exchange?: string | null;
  quoteType?: string | null;
  /** Session open — with `previousClose`, this is the gap the strategy is built on. */
  open?: number | null;
  previousClose?: number | null;
  dayHigh?: number | null;
  dayLow?: number | null;
  /** Denominator for RVOL: `volume ÷ volume3MonthAvg` (scaled by elapsed session time by the caller). */
  volume3MonthAvg?: number | null;
  /** Unix seconds of the next/most recent earnings event — the catalyst check. */
  earningsAt?: number | null;
  /** Unix seconds of the quote itself. Used to derive the list's freshness. */
  quoteTime?: number | null;
}

/** Why a row did not make it into the tradable list. Never silent. */
export interface ExcludedMover {
  ticker: string;
  reason: 'instrument' | 'price' | 'volume' | 'unparseable';
  detail: string;
}

export interface MarketMovers {
  source: string;
  /** Which provider actually answered. `null` only if every provider failed, which throws instead. */
  provider: 'yahoo' | 'fmp';
  /** The provider's own timestamp for the data — NOT when we fetched it. */
  lastUpdated: string | null;
  /** Age in minutes of `lastUpdated` at the moment of the response. `null` if unreadable. */
  ageMinutes: number | null;
  /** True when age exceeds `movers.maxAgeMinutes`. A caller that trades MUST refuse on true. */
  stale: boolean;
  /**
   * The exchange delay the provider declares, in minutes, and whether that exceeds
   * `movers.maxDelayMinutes`.
   *
   * ⚠️ SEPARATE FROM `stale`, AND NOT A DUPLICATE OF IT. `stale` asks "is this feed alive?";
   * `delayed` asks "how old is each quote even when the feed is alive?". Yahoo reports 15 minutes for
   * `NasdaqGS` here, and a 15-minute delay is inconsequential for a daily view and decisive for an
   * intraday momentum entry. Neither gate implies the other.
   */
  delayedByMinutes: number | null;
  delayed: boolean;
  fetchedAt: string;
  cached: boolean;
  counts: { raw: number; kept: number; excluded: number };
  winners: RawMover[];
  losers: RawMover[];
  mostActive: RawMover[];
  excluded: ExcludedMover[];
  /** The settings actually applied, echoed so a reader can see what produced this list. */
  filtersApplied: Record<string, number | boolean>;
  /**
   * What the discovery did to the `symbol` table. ⚠️ DISCOVERY NEVER ACTIVATES A SYMBOL — see
   * `SymbolDiscoveryService`. `null` when persistence is switched off.
   */
  persisted: { created: number; existing: number } | null;
}

/**
 * classifyInstrument() — a ticker suffix to an instrument kind.
 *
 * ⚠️ THIS IS A HEURISTIC AND IS TREATED AS ONE. Standard US conventions:
 *   `...W` warrant · `...R` right · `...U` unit · `...WS`/`...WT` warrant variants
 *   `...+` or `...-A` a share class (EONR+ measured on NYSE Arca)
 *
 * It cannot be certain — a real ticker could legitimately end in W (e.g. `W` itself, or `WW`). That
 * is why it only ever EXCLUDES with a stated reason and the excluded rows are returned, so a false
 * exclusion is visible rather than invisible.
 */
export function classifyInstrument(ticker: string): 'common' | 'warrant' | 'right' | 'unit' | 'share-class' {
  const t = (ticker ?? '').trim().toUpperCase();
  if (!t) return 'common';
  if (t.includes('+') || /[-.][A-Z]$/.test(t)) return 'share-class';
  if (/(WS|WT|W)$/.test(t)) return 'warrant';
  if (/R$/.test(t)) return 'right';
  if (/U$/.test(t)) return 'unit';
  return 'common';
}

/**
 * applyFilters() — pure, so the whole policy is testable with no network and no clock.
 *
 * ⚠️ ORDER MATTERS AND IS DELIBERATE: instrument first, then price, then volume. If a warrant is
 * also sub-$1, the reason recorded is "instrument" — because that is the reason it can never be
 * traded, whereas price is a preference the owner may change.
 */
export function applyFilters(
  rows: RawMover[],
  f: { minPrice: number; minVolume: number; excludeWarrants: boolean },
): { kept: RawMover[]; excluded: ExcludedMover[] } {
  const kept: RawMover[] = [];
  const excluded: ExcludedMover[] = [];
  for (const r of rows) {
    const kind = classifyInstrument(r.ticker);
    if (f.excludeWarrants && kind !== 'common') {
      excluded.push({ ticker: r.ticker, reason: 'instrument', detail: `${kind} — not routable` });
      continue;
    }
    if (r.price == null) {
      excluded.push({ ticker: r.ticker, reason: 'unparseable', detail: 'no usable price in the feed' });
      continue;
    }
    if (r.price < f.minPrice) {
      excluded.push({ ticker: r.ticker, reason: 'price', detail: `${r.price} < minPrice ${f.minPrice}` });
      continue;
    }
    if (r.volume == null) {
      excluded.push({ ticker: r.ticker, reason: 'unparseable', detail: 'no usable volume in the feed' });
      continue;
    }
    if (r.volume < f.minVolume) {
      excluded.push({ ticker: r.ticker, reason: 'volume', detail: `${r.volume} < minVolume ${f.minVolume}` });
      continue;
    }
    kept.push(r);
  }
  return { kept, excluded };
}

/**
 * staleness() — how old the provider's data is, and whether that disqualifies it.
 *
 * ⚠️ A MISSING OR UNPARSEABLE TIMESTAMP IS `stale: true`. Absence of a timestamp is not evidence of
 * freshness, and the failure mode here is trading on a list that could be any age. This is the
 * `development-philosophy` §7 rule: "cannot judge" must never render as "fine".
 */
export function staleness(
  lastUpdated: string | null,
  now: Date,
  maxAgeMinutes: number,
): { ageMinutes: number | null; stale: boolean } {
  if (!lastUpdated) return { ageMinutes: null, stale: true };
  // AV sends "2026-11-13 16:15:59 US/Eastern". `Date` cannot parse the zone suffix reliably, and a
  // silent NaN here would read as "fresh", so the suffix is stripped and the string treated as
  // ET-relative only for the AGE estimate — the raw string is always returned beside it.
  const cleaned = lastUpdated.replace(/\s*US\/Eastern\s*$/i, '').trim().replace(' ', 'T');
  const t = Date.parse(cleaned);
  if (!Number.isFinite(t)) return { ageMinutes: null, stale: true };
  const ageMinutes = Math.round((now.getTime() - t) / 60000);
  return { ageMinutes, stale: ageMinutes > maxAgeMinutes };
}

@Injectable()
export class MarketMoversService {
  private readonly logger = new Logger(MarketMoversService.name);

  /**
   * ⚠️ THE CACHE IS NOT AN OPTIMISATION, IT IS A RATE-LIMIT REQUIREMENT.
   * Alpha Vantage's free tier is a small number of requests per day. A page that refetches per view,
   * or a strategy that polls, would exhaust it and start receiving an error body that looks like
   * data (`{"Note": "..."}`) unless it is checked for.
   */
  private cache: { at: number; payload: MarketMovers } | null = null;
  private static readonly CACHE_TTL_MS = 5 * 60_000;

  constructor(
    private readonly settings: SettingsResolverService,
    private readonly discovery: SymbolDiscoveryService,
  ) {}

  async getMovers(opts: { force?: boolean } = {}): Promise<MarketMovers> {
    const now = new Date();
    if (!opts.force && this.cache && now.getTime() - this.cache.at < MarketMoversService.CACHE_TTL_MS) {
      return { ...this.cache.payload, cached: true };
    }

    const minPrice = await this.num('movers.minPrice', 1);
    const minVolume = await this.num('movers.minVolume', 100_000);
    const maxAgeMinutes = await this.num('movers.maxAgeMinutes', 60);
    const maxDelayMinutes = await this.num('movers.maxDelayMinutes', 15);
    const excludeWarrants = await this.bool('movers.excludeWarrants', true);
    const limit = await this.num('movers.limit', 20);
    const persist = await this.bool('movers.persistDiscovered', true);
    const preferred = await this.str('movers.provider', 'auto');

    const result = await this.fetchFromProviders(preferred, limit);

    const f = { minPrice, minVolume, excludeWarrants };
    const w = applyFilters(result.winners, f);
    const l = applyFilters(result.losers, f);
    const a = applyFilters(result.mostActive, f);

    /**
     * ⚠️ FMP SUPPLIES NO VOLUME, SO THE VOLUME FILTER CANNOT RUN ON ITS ROWS — and saying so is the
     * difference between a partly-screened list and a lie. `applyFilters` has already excluded every
     * FMP row as `unparseable` (no volume), so this is not a theoretical caveat: it is why the fallback
     * returns a shorter list, and a caller must be able to see that.
     */
    const volumeFilterApplied = result.provider === 'yahoo';

    const { ageMinutes, stale } = staleness(result.lastUpdated, now, maxAgeMinutes);
    const delayed = result.delayedByMinutes !== null && result.delayedByMinutes > maxDelayMinutes;

    const payload: MarketMovers = {
      source: `${result.provider}:${result.provider === 'yahoo' ? 'screener/predefined/saved' : 'stable/biggest-*'}`,
      provider: result.provider,
      lastUpdated: result.lastUpdated,
      ageMinutes,
      stale,
      delayedByMinutes: result.delayedByMinutes,
      delayed,
      fetchedAt: now.toISOString(),
      cached: false,
      counts: {
        raw: result.raw,
        kept: w.kept.length + l.kept.length + a.kept.length,
        excluded: w.excluded.length + l.excluded.length + a.excluded.length,
      },
      winners: w.kept.slice(0, limit),
      losers: l.kept.slice(0, limit),
      mostActive: a.kept.slice(0, limit),
      excluded: [...w.excluded, ...l.excluded, ...a.excluded],
      filtersApplied: {
        minPrice,
        minVolume,
        excludeWarrants,
        maxAgeMinutes,
        maxDelayMinutes,
        limit,
        volumeFilterApplied,
      },
      persisted: null,
    };

    /**
     * ⚠️ PERSIST WHAT SURVIVED THE FILTERS — NOT WHAT THE PROVIDER OFFERED. Recording the raw list would
     * fill `symbol` with the warrants and penny stocks this feed is 55–60% made of, and every one of
     * them would then be a known ticker that some later query treats as part of the universe.
     */
    if (persist) {
      const seen = [...w.kept, ...l.kept, ...a.kept].map((r) => ({
        ticker: r.ticker,
        name: r.name ?? null,
        exchange: r.exchange ?? null,
        type: r.quoteType ?? null,
      }));
      payload.persisted = await this.discovery.recordDiscovered(seen);
    }

    if (stale) {
      this.logger.warn(
        `Market movers are STALE — provider last_updated ${result.lastUpdated ?? '(none)'} `
        + `is ${ageMinutes ?? 'unknown'} min old (limit ${maxAgeMinutes}). Not tradable.`,
      );
    }
    if (delayed) {
      this.logger.warn(
        `Market movers are DELAYED by ${result.delayedByMinutes} min (limit ${maxDelayMinutes}). `
        + 'Fine for a daily view; not fine for an intraday entry.',
      );
    }

    this.cache = { at: now.getTime(), payload };
    return payload;
  }

  /**
   * fetchFromProviders() — Yahoo first, FMP second, and the failure of the first is REPORTED in the
   * reason the second is used rather than swallowed.
   *
   * ⚠️ `movers.provider` CAN PIN ONE. `auto` is the default because the standing requirement is that
   * when a ready-made source stops working the feed keeps working; pinning exists so the owner can
   * compare the two on purpose rather than by accident.
   */
  private async fetchFromProviders(preferred: string, limit: number): Promise<ProviderResult> {
    const order: Array<'yahoo' | 'fmp'> = preferred === 'yahoo'
      ? ['yahoo']
      : preferred === 'fmp'
        ? ['fmp']
        : ['yahoo', 'fmp'];

    const failures: string[] = [];
    for (const provider of order) {
      try {
        const r = provider === 'yahoo' ? await this.fetchYahoo(limit) : await this.fetchFmp(limit);
        if (failures.length) {
          this.logger.warn(`movers: fell back to ${provider} after ${failures.join('; ')}`);
        }
        return r;
      } catch (err) {
        failures.push(`${provider}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    /**
     * ⚠️ EVERY PROVIDER FAILING IS AN ERROR, NOT AN EMPTY LIST. The caller must be able to tell
     * "no movers today" from "we could not ask" — the whole reason this file has a staleness model.
     */
    throw new Error(`No movers provider answered. ${failures.join(' | ')}`);
  }

  private async fetchYahoo(limit: number): Promise<ProviderResult> {
    const count = Math.max(25, Math.min(250, limit * 3));
    const [gain, lose, active] = await Promise.all([
      this.getJson(yahooScreenerUrl('day_gainers', count)),
      this.getJson(yahooScreenerUrl('day_losers', count)),
      this.getJson(yahooScreenerUrl('most_actives', count)).catch(() => null),
    ]);
    const g = parseYahooScreener(gain, 'winner');
    const l = parseYahooScreener(lose, 'loser');
    // `most_actives` is a bonus, not a requirement — a failure there must not lose the winners.
    const a = active ? parseYahooScreener(active, 'active') : { rows: [], delayedByMinutes: null };
    const all = [...g.rows, ...l.rows, ...a.rows];
    return {
      provider: 'yahoo',
      winners: g.rows,
      losers: l.rows,
      mostActive: a.rows,
      lastUpdated: newestQuoteTime(all),
      delayedByMinutes: g.delayedByMinutes ?? l.delayedByMinutes ?? a.delayedByMinutes ?? null,
      raw: all.length,
    };
  }

  private async fetchFmp(limit: number): Promise<ProviderResult> {
    const key = (process.env.FMP_API_KEY ?? '').trim();
    if (!key) throw new Error('FMP_API_KEY is not set');
    const [gain, lose] = await Promise.all([
      this.getJson(fmpMoversUrl('winner'), key),
      this.getJson(fmpMoversUrl('loser'), key),
    ]);
    const w = parseFmpMovers(gain, 'winner');
    const l = parseFmpMovers(lose, 'loser');
    return {
      provider: 'fmp',
      winners: w,
      losers: l,
      mostActive: [],
      /**
       * ⚠️ FMP'S MOVERS PAYLOAD CARRIES NO TIMESTAMP AT ALL. `null` here is read by `staleness()` as
       * `stale: true` — deliberately, because "we cannot tell how old this is" must never be treated as
       * fresh. So the fallback is usable to LOOK at and is correctly refused by any trading caller.
       */
      lastUpdated: null,
      delayedByMinutes: null,
      raw: w.length + l.length,
    };
  }

  /** One JSON GET with the browser UA Yahoo requires, and an error body that is never read as data. */
  private async getJson(url: string, fmpKey?: string): Promise<unknown> {
    const headers: Record<string, string> = { ...YAHOO_HEADERS };
    if (fmpKey) {
      headers.apikey = fmpKey;
      delete headers['Accept-Language'];
    }
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url.split('?')[0]}`);
    const body = (await res.json()) as Record<string, unknown>;
    /**
     * ⚠️ RATE-LIMIT AND ERROR BODIES ARE NOT DATA. Alpha Vantage answered 200 with `{"Note": "..."}`;
     * FMP answers 200 with `{"Error Message": "..."}` for a premium endpoint. Reading either as an empty
     * list produces a confident "no movers today".
     */
    const note = body?.['Note'] ?? body?.['Information'] ?? body?.['Error Message'] ?? body?.['message'];
    if (typeof note === 'string' && note.length) {
      throw new Error(`provider refused the request: ${note.slice(0, 240)}`);
    }
    return body;
  }

  private async str(key: string, fallback: string): Promise<string> {
    try {
      const v = await this.settings.get(key);
      const s = String(v ?? '').trim().toLowerCase();
      return s.length ? s : fallback;
    } catch {
      return fallback;
    }
  }

  private async num(key: string, fallback: number): Promise<number> {
    try {
      const v = await this.settings.get(key);
      const n = Number(v);
      return Number.isFinite(n) ? n : fallback;
    } catch {
      return fallback;
    }
  }

  private async bool(key: string, fallback: boolean): Promise<boolean> {
    try {
      const v = await this.settings.get(key);
      if (typeof v === 'boolean') return v;
      const s = String(v ?? '').trim().toLowerCase();
      if (s === 'true' || s === '1') return true;
      if (s === 'false' || s === '0') return false;
      return fallback;
    } catch {
      return fallback;
    }
  }
}
