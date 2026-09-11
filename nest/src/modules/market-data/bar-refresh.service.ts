/**
 * BarRefreshService
 * ==================
 * Periodically fetches fresh OHLCV bars from the MT5 bridge
 * and upserts them into the marketBar table. Supports two modes:
 *
 *   LIVE:   fetches bars/symbol across all needed timeframes, every 5 min
 *           Default 200 bars to satisfy directives requiring deep lookback.
 *   RECORD: fetches 500+ bars/symbol, on-demand — for backtesting
 *
 * Config via environment variables:
 *   BAR_REFRESH_LIVE_LIMIT      — bars per symbol in live mode (default 200)
 *   BAR_REFRESH_RECORD_LIMIT    — bars per symbol in record mode (default 500)
 *   BAR_REFRESH_INTERVAL_MS     — live refresh interval in ms (default 300000)
 *
 * ── Three-Layer Data Provisioning Pipeline ──────────────────────────────
 *
 * This service is Layer 0 (pre-warming).  The full pipeline:
 *
 *   LAYER 0 — BarRefreshService (this file)
 *     Pre-warms the marketBar table with 200 bars across 5 timeframes
 *     (5m, 15m, 1h, 4h, 1d) every 5 minutes.  This ensures the cache
 *     is hot before any directive runs.
 *
 *   LAYER 1 — IDirective.minBars (per-directive declaration)
 *     Each directive declares `readonly minBars: Record<string, number>`
 *     mapping timeframe → minimum bar count.  Example:
 *       price-action:     { '1d': 200 }
 *       btc-halving-cycle: { '1d': 365 }
 *       mtf-confluence:    { '1d': 200, '1h': 50, '15m': 30 }
 *     File: directives/interfaces/directive.interface.ts
 *
 *   LAYER 2 — ProtocolDbService.getRequiredBars(protocolSlug)
 *     Walks all directive IDs in a protocol, collects their minBars,
 *     computes the MAX per timeframe, and returns a Record<string,number>.
 *     File: scoring/protocol-db.service.ts
 *
 *   LAYER 3 — Automation loop / Protocol Gating controller
 *     Uses getRequiredBars() to call getBars(sym, tf, requiredBars[tf])
 *     dynamically — no more hardcoded "getBars(sym, tf, 100)".
 *     Files: automation/automation-loop.service.ts,
 *            scoring/protocol-gating.controller.ts
 *
 * BEFORE this pipeline existed, directives like price-action (needing 200
 * daily bars) would starve with "need 200 bars, have 25".  The hardcoded
 * getBars(sym, tf, 100) couldn't satisfy any directive needing >100 bars.
 *
 * TIMEFRAMES expanded from ['5m','1h'] to ['5m','15m','1h','4h','1d']
 * on 2026-07-28 to support multi-timeframe directives and gold strategies.
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AdapterFactory } from '../providers/adapter-factory';
import { Mt5ConnectionManager } from '../providers/mt5/mt5-connection-manager.service';
import { resolveMt5BridgeUrl } from '../providers/mt5/mt5-bridge.config';
import { SymbolResolverService } from '../symbols/symbol-resolver.service';
import { isBarBeyondItsOwnLength, alignBarTimestamp } from '../../common/utils/timeframe';

// Avoid importing the concrete adapter class
interface BarProvider {
  getCandles?(symbol: string, timeframe: string, limit: number): Promise<any[]>;
}

// ── Configuration ──────────────────────────────────────────

const LIVE_LIMIT = process.env.BAR_REFRESH_LIVE_LIMIT
  ? parseInt(process.env.BAR_REFRESH_LIVE_LIMIT, 10)
  : 200;  // Enough to satisfy directives like price-action (200) in one cycle

const RECORD_LIMIT = process.env.BAR_REFRESH_RECORD_LIMIT
  ? parseInt(process.env.BAR_REFRESH_RECORD_LIMIT, 10)
  : 500;  // Deep lookback for backtesting

const REFRESH_INTERVAL_MS = process.env.BAR_REFRESH_INTERVAL_MS
  ? parseInt(process.env.BAR_REFRESH_INTERVAL_MS, 10)
  : 300_000; // 5 minutes

/**
 * Timeframes to refresh — must cover every cadence a protocol can RESOLVE to.
 *
 * ⚠️ WHY `1m` IS HERE (#758 follow-up)
 * ------------------------------------
 * This list was `['5m','15m','1h','4h','1d']`, but `selectBaseTimeframe()` resolves a
 * protocol's `recommendedTimeframe` onto this set, and several protocols declare a
 * SUB-MINUTE horizon: `xau-speed-v1`, `spy-speed-v1`, `qqq-speed-v1`, `ftse-speed-v1`
 * and `vix-spike-v1` all carry `'5s–30s'`, which resolves to **`1m`**.
 *
 * `1m` was never fetched, and the DB held ZERO `1m` bars — so those protocols asked the
 * canonical loader for a cadence that did not exist, received an empty array, and their
 * scoring silently produced nothing. Seven active protocols sat `stalled` for ~6 hours
 * reporting `symbolsScored: 2` while writing no rows at all.
 *
 * Nothing failed loudly because an empty bar array is a legitimate state (a new symbol
 * has no history yet). The gap was only findable by comparing the resolved cadence
 * against the fetched set — which is exactly what the `starvedSymbols` diagnostic now
 * does automatically.
 *
 * The rule this encodes: **every cadence `selectBaseTimeframe` can return must be
 * fetchable.** If that mapping changes, this list has to change with it — the
 * `timeframe-refresh-coverage` guard in validate-pipeline-contracts.cjs enforces it.
 */
const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'];

export type BarRefreshMode = 'live' | 'record';

export interface BarRefreshStatus {
  running: boolean;
  mode: BarRefreshMode;
  intervalMs: number;
  liveLimit: number;
  recordLimit: number;
  /** Active timeframes being refreshed. */
  timeframes: string[];
  lastRefresh: string | null;
  lastUpserted: number;
  lastSymbols: number;
  lastDurationMs: number;
  /**
   * Symbols whose newest bar is older than the staleness window (#759).
   *
   * ⚠️ WHY THIS IS REPORTED, NOT JUST LOGGED
   * ----------------------------------------
   * A symbol with stale bars does not error — it scores. The directives simply
   * evaluate an old window and return a plausible number, or the bar array is
   * short enough that the protocol hits its zero-bar fallback and returns the
   * hardcoded `composite: 50`. Measured: BTCUSD held 177 hourly bars ending
   * 2026-07-18 (7 weeks stale) with no 15m and no 1d at all, so both BTC
   * protocols appeared in the UI as "scoring" while returning nothing — and the
   * only way to find it was to query marketbar by hand.
   *
   * This is the same class of fault as the session gate: silent, plausible, and
   * invisible from every surface. Report the STATE, so it cannot hide.
   */
  starvedSymbols?: Array<{
    ticker: string;
    newestBar: string | null;
    ageHours: number | null;
    /** Timeframes the resolver expects but the symbol has NO rows for. */
    missingTimeframes: string[];
  }>;
  /**
   * Non-null when the starvation query itself failed. Without this an empty
   * `starvedSymbols` means either "everything is fresh" or "the query threw" —
   * and those need opposite responses (#761).
   */
  starvedSymbolsError?: string | null;
}

@Injectable()
export class BarRefreshService {
  private readonly logger = new Logger(BarRefreshService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private mode: BarRefreshMode = 'live';

  // Status tracking
  private lastRefresh: Date | null = null;
  private lastUpserted = 0;
  private lastSymbols = 0;
  private lastDurationMs = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly adapterFactory: AdapterFactory,
    private readonly symbolResolver: SymbolResolverService,
    private readonly mt5Conn: Mt5ConnectionManager,
  ) {}

  /** Start periodic live refresh. Safe to call multiple times. */
  start(intervalMs: number = REFRESH_INTERVAL_MS): void {
    if (this.timer) {
      this.logger.warn('BarRefreshService already running — skipping duplicate start');
      return;
    }
    this.mode = 'live';
    this.logger.log(`Starting LIVE bar refresh every ${intervalMs / 1000}s (limit=${LIVE_LIMIT} bars)`);
    this.refresh().catch(err => this.logger.error(`Initial bar refresh failed: ${err.message}`));
    this.timer = setInterval(() => {
      this.refresh().catch(err => this.logger.error(`Bar refresh failed: ${err.message}`));
    }, intervalMs);
  }

  /** Stop periodic refresh. */
  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.logger.log('BarRefreshService stopped');
  }

  /** Get current status for API. */
  getStatus(): BarRefreshStatus {
    return {
      running: this.timer !== null,
      mode: this.mode,
      intervalMs: REFRESH_INTERVAL_MS,
      liveLimit: LIVE_LIMIT,
      recordLimit: RECORD_LIMIT,
      timeframes: TIMEFRAMES,
      lastRefresh: this.lastRefresh?.toISOString() ?? null,
      lastUpserted: this.lastUpserted,
      lastSymbols: this.lastSymbols,
      lastDurationMs: this.lastDurationMs,
      starvedSymbols: this.staleCache?.rows,
      starvedSymbolsError: this.staleError,
    };
  }

  /**
   * Symbols whose newest bar is stale, or which are missing a timeframe the
   * refresh pipeline is supposed to provide (#759). Cached briefly — this is a
   * diagnostic, not a hot path, and it must never slow a tick down.
   */
  private staleCache: { at: number; rows: NonNullable<BarRefreshStatus['starvedSymbols']> } | null = null;

  /** Last error from the starvation query, if any. Distinguishes "nothing stale" from "query broken". */
  private staleError: string | null = null;

  /**
   * Find symbols that are starving: stale newest-bar, or a timeframe with zero
   * rows. A symbol in either state cannot produce a trustworthy score, and the
   * failure is silent everywhere else in the app.
   *
   * @param staleAfterHours a symbol whose newest bar is older than this is reported
   */
  async getStarvedSymbols(staleAfterHours = 24): Promise<NonNullable<BarRefreshStatus['starvedSymbols']>> {
    const now = Date.now();
    if (this.staleCache && now - this.staleCache.at < 60_000) return this.staleCache.rows;

    const rows: NonNullable<BarRefreshStatus['starvedSymbols']> = [];
    try {
      // Only symbols that are actually IN the scoring pipeline matter — a registry
      // entry nobody scores is not starving, it is simply unused. Restricting to
      // protocol-assigned symbols keeps the report actionable instead of listing
      // all ~240 registry rows.
      //
      // NOTE: this deliberately uses an EXISTS subquery rather than a JOIN. A JOIN
      // would only reach symbols that already have an assignment row, which is the
      // one population guaranteed to be in the refresh set — so the report could
      // never describe the symbols it exists to find (#761).
      //
      // The COLLATE on every comparison is load-bearing. `symbol` and the referencing
      // tables were created with different collations (utf8mb4_0900_ai_ci vs
      // utf8mb4_unicode_ci), so a bare `=` raises ER_CANT_AGGREGATE_2COLLATIONS.
      // That error used to be swallowed by the catch below and surfaced as an empty
      // report — the failure mode this whole method exists to prevent. Do not remove.
      const assigned: Array<{ ticker: string }> = await (this.prisma as any).$queryRawUnsafe(
        `SELECT s.ticker, s.id AS symbolId
           FROM symbol s
          WHERE s.active = 1
            AND (EXISTS (SELECT 1 FROM symbol_protocol_assignment a
                          WHERE a.symbol COLLATE utf8mb4_unicode_ci = s.ticker COLLATE utf8mb4_unicode_ci)
                 OR EXISTS (SELECT 1 FROM trading_strategy t
                             WHERE t.symbol COLLATE utf8mb4_unicode_ci = s.ticker COLLATE utf8mb4_unicode_ci
                               AND t.active = 1)
                 OR EXISTS (SELECT 1 FROM position p
                             WHERE p.symbol COLLATE utf8mb4_unicode_ci = s.ticker COLLATE utf8mb4_unicode_ci))`,
      );
      for (const row of assigned) {
        const agg: Array<{ timeframe: string; n: number; newest: Date | null }> =
          await (this.prisma as any).$queryRawUnsafe(
            `SELECT timeframe, COUNT(*) AS n, MAX(timestamp) AS newest
               FROM marketbar WHERE symbolId = ? GROUP BY timeframe`,
            (row as any).symbolId,
          );
        const have = new Map(agg.map((a) => [a.timeframe, a]));
        const missingTimeframes = TIMEFRAMES.filter((tf) => !(have.get(tf)?.n));

        const newest = agg.reduce<Date | null>((acc, a) => {
          if (!a.newest) return acc;
          return !acc || a.newest > acc ? a.newest : acc;
        }, null);
        const ageHours = newest ? (now - newest.getTime()) / 3_600_000 : null;

        const stale = ageHours === null || ageHours > staleAfterHours;
        if (stale || missingTimeframes.length > 0) {
          rows.push({
            ticker: String(row.ticker),
            newestBar: newest ? newest.toISOString() : null,
            ageHours: ageHours === null ? null : Math.round(ageHours),
            missingTimeframes,
          });
        }
      }
      rows.sort((a, b) => (b.ageHours ?? Infinity) - (a.ageHours ?? Infinity));
      this.staleError = null; // clear on success so a recovered query stops reporting a fault
    } catch (err: any) {
      // Diagnostic only — never throw into a tick. But DO record the failure: an
      // empty report and a broken report are indistinguishable to a caller, and
      // a silently broken report is worse than no report. This exact mistake hid
      // a collation error that made the whole method return [] (#761).
      this.staleError = err?.message ? String(err.message) : String(err);
      this.logger.warn(`getStarvedSymbols failed: ${this.staleError}`);
    }

    this.staleCache = { at: now, rows };
    return rows;
  }

  /**
   * Resolve symbols for bar refresh.
   * Delegates to the shared SymbolResolverService (feature: bar-refresh).
   */
  async resolveRefreshSymbols(): Promise<string[]> {
    const selection = await this.symbolResolver.getSymbolsForFeature('bar-refresh');
    return selection.symbols;
  }

  /**
   * Run one LIVE refresh cycle.
   * Fetches limited bars for active symbols — keeps directives fed.
   */
  async refresh(): Promise<{ upserted: number; symbols: string[]; errors: string[] }> {
    const startMs = Date.now();
    const symbols = await this.resolveRefreshSymbols();
    const result = await this.doRefresh(symbols, LIVE_LIMIT);

    this.lastRefresh = new Date();
    this.lastUpserted = result.upserted;
    this.lastSymbols = symbols.length;
    this.lastDurationMs = Date.now() - startMs;

    // Refresh the starvation diagnostic as part of the cycle (#759). Doing it here
    // rather than on-demand means the status endpoint is always current without
    // paying the query cost synchronously in a request, and a symbol that stops
    // receiving bars is reported within one refresh interval instead of never.
    try {
      await this.getStarvedSymbols();
    } catch (err: any) {
      this.logger.warn(`starvation diagnostic failed: ${err?.message ?? err}`);
    }

    return result;
  }

  /**
   * Run a RECORD refresh for backtesting data.
   * Fetches many bars for watchlist symbols — opt-in, on-demand.
   * @param symbols Optional symbol list; defaults to all active DB symbols.
   */
  async recordBars(symbols?: string[]): Promise<{ upserted: number; symbols: string[]; errors: string[] }> {
    const startMs = Date.now();
    let targetSymbols = symbols?.length ? symbols : [];

    if (!targetSymbols.length) {
      // Default: all active DB symbols
      try {
        if (this.prisma.isAvailable) {
          const active = await this.prisma.symbol.findMany({
            where: { active: true },
            select: { ticker: true },
          });
          targetSymbols = active.map(s => s.ticker.toUpperCase());
        }
      } catch {
        targetSymbols = [];
      }
    }

    if (!targetSymbols.length) {
      this.logger.warn('No symbols for record refresh');
      return { upserted: 0, symbols: [], errors: [] };
    }

    this.logger.log(`RECORD refresh: ${targetSymbols.length} symbols, limit=${RECORD_LIMIT} bars`);
    const prevMode = this.mode;
    this.mode = 'record';
    const result = await this.doRefresh(targetSymbols, RECORD_LIMIT);
    this.mode = prevMode;

    this.lastRefresh = new Date();
    this.lastUpserted = result.upserted;
    this.lastSymbols = targetSymbols.length;
    this.lastDurationMs = Date.now() - startMs;

    return result;
  }

  /**
   * Core refresh logic — fetches bars for given symbols and upserts into DB.
   */
  private async doRefresh(
    symbols: string[],
    limit: number,
  ): Promise<{ upserted: number; symbols: string[]; errors: string[] }> {
    const errors: string[] = [];
    let upserted = 0;

    if (symbols.length === 0) {
      this.logger.warn('No symbols to refresh — returning early');
      return { upserted: 0, symbols: [], errors: [] };
    }

    // Get bridge adapter for candle data
    const broker = this.adapterFactory.create('mt5') as BarProvider;
    if (!broker?.getCandles) {
      this.logger.warn('MT5 adapter unavailable — skipping bar refresh');
      return { upserted: 0, symbols, errors: ['MT5 adapter unavailable'] };
    }

    // ── Provider routing (#760) ───────────────────────────────────────────
    //
    // ⚠️ THIS LOOP USED TO BE MT5-ONLY, AND THAT SILENTLY STRANDED CRYPTO
    // -------------------------------------------------------------------
    // `binance.adapter.ts` implements `getCandles()`, and the crypto symbols in the
    // registry were populated from it — but every fetch here called
    // `create('mt5')` and wrote `provider: 'mt5'`. So BTC/ETH/DOGE/SOL were fetched
    // ONCE, long ago, and then aged out: `BTCUSD` last saw data 54 days ago,
    // `DOGEUSD` 39, `BTC-USD` 16. The adapter existed and worked; nothing called it.
    //
    // The fix is a routing table, not a rewrite: each symbol declares which provider
    // serves it. `symbol_route` already exists for exactly this purpose (it is how
    // UK100/GER40/FRA40/XAGUSD pick a broker), so crypto routes through the same
    // mechanism rather than inventing a parallel one.
    //
    // Unrouted symbols default to mt5 — the behaviour every existing symbol had — so
    // this change cannot alter a symbol that was already working.
    const providerFor = new Map<string, string>();
    const providerAdapters = new Map<string, BarProvider>();
    const getProviderAdapter = (provider: string): BarProvider | null => {
      const cached = providerAdapters.get(provider);
      if (cached) return cached;
      const made = this.adapterFactory.create(provider) as BarProvider;
      if (!made?.getCandles) return null;
      providerAdapters.set(provider, made);
      return made;
    };
    try {
      const routes: Array<{ symbol: string; provider: string | null }> =
        await (this.prisma as any).$queryRawUnsafe(
          `SELECT symbol, provider FROM symbol_route WHERE enabled = 1`,
        );
      for (const r of routes) {
        if (r.provider) providerFor.set(String(r.symbol).toUpperCase(), r.provider);
      }
    } catch { /* table may be older than this change — default to mt5 */ }

    // Multi-broker fallback (#665) — when the primary bridge has no candles
    // or only stale ones (broker-side gaps), try the other configured
    // bridges and keep the freshest set.
    const primaryUrl = resolveMt5BridgeUrl();
    const fallbackUrls = this.mt5Conn.getBrokerIds()
      .map((id) => this.mt5Conn.getUrl(id))
      .filter((url) => url !== primaryUrl);
    // Staleness tolerance per cadence, for the multi-broker fallback below.
    //
    // ⚠️ `1m` MUST be listed (#780). Without it, `1m` fell through to the 24h
    // default — so a genuinely stale 1m feed (e.g. `UK100` returning a date four
    // months old) was correctly rejected, but for the wrong reason, and the
    // tolerance bore no relation to the cadence. Keep this in step with
    // `barLengthMs()` below.
    const TF_STALE_MS: Record<string, number> = {
      '1m': 1 * 3600_000,
      '5m': 2 * 3600_000,
      '15m': 4 * 3600_000,
      '1h': 12 * 3600_000,
      '4h': 24 * 3600_000,
      '1d': 72 * 3600_000,
    };
    const newestOf = (bs: any[]) => Math.max(
      ...bs.map((b: any) => new Date(b.timestamp).getTime()).filter((t: number) => !Number.isNaN(t)),
    );
    const isStaleSet = (bs: any[], tf: string) => {
      if (!bs || !bs.length) return true;
      const threshold = TF_STALE_MS[tf] ?? 24 * 3600_000;
      return Date.now() - newestOf(bs) > threshold;
    };

    // ── Bar-length guard (#780) ────────────────────────────────────────────
    //
    // A bar is stamped by its **OPEN** time, so the currently-forming bar is
    // legitimately AHEAD of the wall clock by up to one bar length:
    //
    //     forming 15m bar opens 19:15 while the clock reads 19:02  -> +13min : correct
    //     forming  1m bar opens 19:02 while the clock reads 19:01  -> +1 min : correct
    //
    // Anything beyond one bar length cannot be a real bar, and persisting it is
    // PERMANENTLY HARMFUL: the upsert below only touches rows it fetched
    // (`ON DUPLICATE KEY UPDATE`), and a bridge never serves a future bar — so
    // once such a row exists **nothing can ever overwrite it**. It stays
    // `MAX(timestamp)` for that symbol indefinitely, making the feed look
    // future-dated and defeating every staleness check downstream.
    //
    // Measured live: 226 such rows were written while the bridges were DOWN
    // (bridges were not listening at all), which made 17 symbols read as
    // permanently future-dated. They also propagated into `directiveoutcome`
    // via `predictedAt`, which copies the evaluated bar's open time.
    //
    // Skipping is the correct response — not clamping, which would invent a
    // timestamp the broker never produced. Warn, because a dropped bar is also
    // the signature of a genuine clock-skew regression (#750) and must not pass
    // silently.
    //
    // The rule itself lives in `common/utils/timeframe.ts` so the probe and any
    // future writer share ONE definition (ADR-014).
    let impossibleBars = 0;
    const fetchBridgeCandles = async (url: string, symbol: string, tf: string, count: number): Promise<any[]> => {
      try {
        const res = await fetch(
          `${url}/candles?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(tf)}&limit=${count}`,
          { signal: AbortSignal.timeout(10_000) },
        );
        if (!res.ok) return [];
        const data: any = await res.json();
        if (!Array.isArray(data?.bars)) return [];
        return data.bars.map((b: any) => ({
          timestamp: b.timestamp,
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
          volume: b.volume ?? 0,
        }));
      } catch {
        return [];
      }
    };

    // Fetch and upsert bars for each symbol+timeframe combo
    for (const symbol of symbols) {
      // Which provider serves this symbol? Defaults to mt5 — the behaviour every
      // symbol had before routing existed (#760).
      const providerName = providerFor.get(symbol.toUpperCase()) ?? 'mt5';
      const activeBroker = getProviderAdapter(providerName);
      if (!activeBroker) {
        errors.push(`${symbol}: provider '${providerName}' has no candle support — skipped`);
        continue;
      }

      for (const tf of TIMEFRAMES) {
        try {
          let bars = await activeBroker.getCandles(symbol, tf, limit);
          // The multi-broker bridge fallback is MT5-specific — a second MT5 bridge
          // cannot serve a Binance-routed symbol, so only apply it for mt5.
          const primaryBad = !bars || bars.length === 0 || isStaleSet(bars, tf);
          if (primaryBad && providerName === 'mt5' && fallbackUrls.length > 0) {
            for (const url of fallbackUrls) {
              const alt = await fetchBridgeCandles(url, symbol, tf, limit);
              if (!alt || !alt.length) continue;
              if (!bars || !bars.length || newestOf(alt) > newestOf(bars)) bars = alt;
            }
          }
          if (!bars || bars.length === 0) continue;

          const dbSymbol = await this.prisma.symbol.findFirst({ where: { ticker: symbol } });
          if (!dbSymbol) continue;

          let count = 0;
          for (const bar of bars) {
            if (!bar.timestamp || bar.open === undefined) continue;

            // ⚠️ ALIGN TO THE CADENCE BOUNDARY (#785). Storing the raw timestamp let a
            // bulk refresh write every higher timeframe at `:45` — 5,854 `4h` rows, 5,785
            // `1d`, 5,780 `1h` — because `:45` and `:00` are different timestamps, so the
            // unique key could not reject the duplicate (#783's mechanism, second writer).
            // Worse, a `:45` bar written at 18:25 for a 4h cadence lands at 20:45 — two
            // hours in the FUTURE — which makes `computeMarketStatus()` fail closed and
            // reads the market as shut.
            //
            // Flooring makes the duplicate collapse onto the real boundary row, so the
            // ON DUPLICATE KEY UPDATE below overwrites it instead of inserting a twin.
            const aligned = alignBarTimestamp(bar.timestamp, tf, providerName);
            if (!aligned) {
              impossibleBars++;
              this.logger.warn(
                `Skipped bar with unparseable timestamp for ${symbol} (${tf}): ${String(bar.timestamp)}. ` +
                `A malformed timestamp must never be coerced — coercion writes a bar that looks real (#783).`,
              );
              continue;
            }

            // Never persist a bar dated beyond its own bar length (#780) — see
            // `isBarBeyondItsOwnLength`. Such a row is unoverwritable and would
            // pin `MAX(timestamp)` for this symbol forever.
            //
            // Judged on the ALIGNED value: aligning can only move a timestamp EARLIER
            // (floor), so this check is strictly more permissive after alignment and can
            // never reject a bar that the raw value would have allowed.
            if (isBarBeyondItsOwnLength(aligned, tf)) {
              impossibleBars++;
              this.logger.warn(
                `Skipped impossible bar for ${symbol} (${tf}): timestamp ${aligned.toISOString()} ` +
                `is more than one bar length ahead of now. A bridge never serves a future bar, so this row ` +
                `would be unoverwritable and would pin the symbol's newest-bar time. ` +
                `If this repeats, suspect bridge clock skew (#750) or a dead bridge returning stale data (#780).`,
              );
              continue;
            }
            try {
              await this.prisma.$executeRaw`
                INSERT INTO marketbar (id, symbolId, provider, timeframe, timestamp, open, high, low, close, volume)
                VALUES (UUID(), ${dbSymbol.id}, ${providerName}, ${tf}, ${aligned},
                        ${bar.open}, ${bar.high}, ${bar.low}, ${bar.close}, ${bar.volume ?? 0})
                ON DUPLICATE KEY UPDATE open=${bar.open}, high=${bar.high}, low=${bar.low}, close=${bar.close}, volume=${bar.volume ?? 0}
              `;
              count++;
            } catch { /* duplicate — skip */ }
          }
          if (count > 0) this.logger.debug(`Upserted ${count} bars for ${symbol} (${tf}) via ${providerName}`);
          upserted += count;
        } catch (err) {
          const msg = `${symbol}/${tf}: ${(err as Error).message}`;
          this.logger.warn(`Bar refresh failed for ${msg}`);
          errors.push(msg);
        }
      }
    }

    // ── Also upsert synthetic "current" bars from live quotes ──
    for (const symbol of symbols) {
      try {
        const dbSymbol = await this.prisma.symbol.findFirst({ where: { ticker: symbol } });
        if (!dbSymbol) continue;

        const broker2 = this.adapterFactory.create('mt5') as any;
        const quote = broker2?.getQuote ? await broker2.getQuote(symbol) : null;
        if (!quote?.bid || !quote?.ask) continue;

        const midPrice = (quote.bid + quote.ask) / 2;
        // Floor to the current 5m bucket so the synthetic bar matches the
        // timestamp MT5 will use for the real closed bar. This makes the
        // ON DUPLICATE KEY UPDATE hit the same row every refresh (instead of
        // inserting a new flat bar every 5 min), and lets the real bar
        // overwrite the placeholder once it closes.
        //
        // This one needs no `isBarBeyondItsOwnLength` check (#780): it is derived from
        // the LOCAL clock, so it is at most one 5m bucket ahead of now — i.e. a
        // legitimate forming bar, indistinguishable from what the bridge serves.
        const now = new Date();
        now.setUTCSeconds(0, 0);
        now.setUTCMinutes(Math.floor(now.getUTCMinutes() / 5) * 5);

        await this.prisma.$executeRaw`
          INSERT INTO marketbar (id, symbolId, provider, timeframe, timestamp, open, high, low, close, volume)
          VALUES (UUID(), ${dbSymbol.id}, 'mt5', '5m', ${now}, ${midPrice}, ${midPrice}, ${midPrice}, ${midPrice}, 1)
          ON DUPLICATE KEY UPDATE close=${midPrice}, high=GREATEST(high,${midPrice}), low=LEAST(low,${midPrice})
        `;
      } catch { /* quote fetch may fail if broker doesn't support it */ }
    }

    // Surface skipped impossible bars prominently. A dropped bar must not look
    // like a clean refresh: 226 of them once pinned 17 symbols' newest-bar time
    // (#780), and a burst is the signature of a clock-skew regression (#750).
    if (impossibleBars > 0) {
      this.logger.warn(
        `Bar refresh: SKIPPED ${impossibleBars} impossible bar(s) dated beyond their own bar length. ` +
        `These were not written. Investigate the bridge clock or a dead-bridge fallback before trusting ` +
        `this symbol's freshness (#780 / #750).`,
      );
    }

    this.logger.log(
      `Bar refresh complete (${this.mode}): ${upserted} bars for ${symbols.length} symbols` +
      (impossibleBars ? `, ${impossibleBars} impossible skipped` : '') +
      (errors.length ? ` (${errors.length} errors)` : ''),
    );
    return { upserted, symbols, errors };
  }
}
