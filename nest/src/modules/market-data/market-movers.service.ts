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

/** One row of the provider's movers feed, before our filters. */
export interface RawMover {
  ticker: string;
  price: number | null;
  changePct: number | null;
  volume: number | null;
  direction: 'winner' | 'loser' | 'active';
}

/** Why a row did not make it into the tradable list. Never silent. */
export interface ExcludedMover {
  ticker: string;
  reason: 'instrument' | 'price' | 'volume' | 'unparseable';
  detail: string;
}

export interface MarketMovers {
  source: string;
  /** The provider's own timestamp for the data — NOT when we fetched it. */
  lastUpdated: string | null;
  /** Age in minutes of `lastUpdated` at the moment of the response. `null` if unreadable. */
  ageMinutes: number | null;
  /** True when age exceeds `movers.maxAgeMinutes`. A caller that trades MUST refuse on true. */
  stale: boolean;
  fetchedAt: string;
  cached: boolean;
  counts: { raw: number; kept: number; excluded: number };
  winners: RawMover[];
  losers: RawMover[];
  mostActive: RawMover[];
  excluded: ExcludedMover[];
  /** The settings actually applied, echoed so a reader can see what produced this list. */
  filtersApplied: Record<string, number | boolean>;
}

const AV_URL = 'https://www.alphavantage.co/query';

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

/** `"212.5%"` → `212.5`. Separated so the parse is testable without a network call. */
export function parsePct(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string' || v.trim() === '') return null;
  const n = Number(v.replace(/[%,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * `"77115"` → `77115`.
 *
 * ⚠️ `Number('') === 0` AND 0 IS FINITE — so an empty string must be rejected BEFORE the numeric
 * check, or a missing value is reported as a real zero. Measured 2026-11-16: this exact ordering
 * failure made `parseNum('')` return 0, which would read as "volume 0" (a thin symbol) rather than
 * "the feed omitted volume" (an unparseable row). Same trap as `clampInt()` in
 * `movers-treatment.service.ts` and `Number(null) === 0` in `validate-threshold-in-range.cjs`
 * (register row 181). The spec pins it.
 */
export function parseNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string' || v.trim() === '') return null;
  const n = Number(v.replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
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

  constructor(private readonly settings: SettingsResolverService) {}

  async getMovers(opts: { force?: boolean } = {}): Promise<MarketMovers> {
    const now = new Date();
    if (!opts.force && this.cache && now.getTime() - this.cache.at < MarketMoversService.CACHE_TTL_MS) {
      return { ...this.cache.payload, cached: true };
    }

    const minPrice = await this.num('movers.minPrice', 1);
    const minVolume = await this.num('movers.minVolume', 100_000);
    const maxAgeMinutes = await this.num('movers.maxAgeMinutes', 60);
    const excludeWarrants = await this.bool('movers.excludeWarrants', true);
    const limit = await this.num('movers.limit', 20);

    const apiKey = (process.env.ALPHA_VANTAGE_API_KEY ?? '').trim();
    if (!apiKey) {
      // "cannot judge", said out loud — never an empty list that reads as "no movers today".
      throw new Error(
        'ALPHA_VANTAGE_API_KEY is not set, so the market-wide movers feed cannot be read. '
        + 'This is a CONFIGURATION absence, not an absence of movers.',
      );
    }

    const url = `${AV_URL}?function=TOP_GAINERS_LOSERS&apikey=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) {
      throw new Error(`Alpha Vantage TOP_GAINERS_LOSERS returned HTTP ${res.status}`);
    }
    const body = (await res.json()) as Record<string, unknown>;

    /**
     * ⚠️ RATE-LIMIT AND ERROR BODIES ARE NOT DATA. AV returns HTTP 200 with
     * `{ "Note": "..." }` or `{ "Information": "..." }` when throttled. Without this check the
     * parser sees no `top_gainers` key, returns an empty list, and the caller reports
     * "no movers" — a false empty.
     */
    if (body['Note'] || body['Information'] || body['Error Message']) {
      const msg = String(body['Note'] ?? body['Information'] ?? body['Error Message']);
      throw new Error(`Alpha Vantage refused the request: ${msg.slice(0, 300)}`);
    }

    const pick = (key: string, dir: RawMover['direction']): RawMover[] =>
      (Array.isArray(body[key]) ? (body[key] as Array<Record<string, unknown>>) : [])
        .map((r) => ({
          ticker: String(r['ticker'] ?? '').trim().toUpperCase(),
          price: parseNum(r['price']),
          changePct: parsePct(r['change_percentage']),
          volume: parseNum(r['volume']),
          direction: dir,
        }))
        .filter((r) => r.ticker.length > 0);

    const rawWinners = pick('top_gainers', 'winner');
    const rawLosers = pick('top_losers', 'loser');
    const rawActive = pick('most_actively_traded', 'active');

    const f = { minPrice, minVolume, excludeWarrants };
    const w = applyFilters(rawWinners, f);
    const l = applyFilters(rawLosers, f);
    const a = applyFilters(rawActive, f);

    const lastUpdated = typeof body['last_updated'] === 'string' ? body['last_updated'] : null;
    const { ageMinutes, stale } = staleness(lastUpdated, now, maxAgeMinutes);

    const payload: MarketMovers = {
      source: 'alpha-vantage:TOP_GAINERS_LOSERS',
      lastUpdated,
      ageMinutes,
      stale,
      fetchedAt: now.toISOString(),
      cached: false,
      counts: {
        raw: rawWinners.length + rawLosers.length + rawActive.length,
        kept: w.kept.length + l.kept.length + a.kept.length,
        excluded: w.excluded.length + l.excluded.length + a.excluded.length,
      },
      winners: w.kept.slice(0, limit),
      losers: l.kept.slice(0, limit),
      mostActive: a.kept.slice(0, limit),
      excluded: [...w.excluded, ...l.excluded, ...a.excluded],
      filtersApplied: { minPrice, minVolume, excludeWarrants, maxAgeMinutes, limit },
    };

    if (stale) {
      this.logger.warn(
        `Market movers are STALE — provider last_updated ${lastUpdated ?? '(none)'} `
        + `is ${ageMinutes ?? 'unknown'} min old (limit ${maxAgeMinutes}). Not tradable.`,
      );
    }

    this.cache = { at: now.getTime(), payload };
    return payload;
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
