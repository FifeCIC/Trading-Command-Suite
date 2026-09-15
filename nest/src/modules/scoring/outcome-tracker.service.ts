import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../database/prisma.service';

// ── Configuration ────────────────────────────────────────────
// Set OUTCOME_TRACKING_ENABLED=false to disable all outcome recording.
// OUTCOME_TRACKING_DEDUP_WINDOW_MS controls the dedup window (default 5 min).
// These can be overridden via environment variables for production tuning.

const OUTCOME_TRACKING_ENABLED =
  process.env.OUTCOME_TRACKING_ENABLED !== 'false'; // default true
const OUTCOME_TRACKING_DEDUP_WINDOW_MS = process.env.OUTCOME_TRACKING_DEDUP_WINDOW_MS
  ? parseInt(process.env.OUTCOME_TRACKING_DEDUP_WINDOW_MS, 10)
  : 300_000; // 5 minutes

/**
 * Rows matured per sweep. The sweep is oldest-first, so a saturated batch means
 * the queue head contains rows that cannot fill (symbol delisted, no bars) and
 * every row behind them is waiting. 500 left a 37k backlog draining for ~18h
 * (2026-09-10); this is deliberately larger and reports saturation.
 *
 * ── MST-012 (2026-09-15) — REDUCED 1000 → 250: the sweep was starving the pool ──
 *
 * ⚠️ THE DEFECT THIS FIXES
 * Each row costs ~2 queries and they were issued **serially with no yield**, so a
 * 1000-row batch held the API on a run of ~2,000 sequential queries for **57
 * seconds** (measured: 14:45:00 → 14:45:57). Prisma's pool is 13 connections with a
 * 10s checkout timeout, and the pool queue is FIFO — so during those 57 seconds
 * every OTHER endpoint's query queued behind the sweep and timed out:
 *
 *   ERROR [ProtocolsController] Failed to load protocols:
 *     Timed out fetching a new connection from the connection pool.
 *     (Current connection pool timeout: 10, connection limit: 13)
 *
 * The whole API became unresponsive once per 15-minute sweep, and the sweep itself
 * was slowed by its own contention — a self-inflicted denial of service that looked
 * like a stalled pipeline from the outside.
 *
 * A smaller batch keeps the API responsive; the symbol cache below removes half the
 * queries, so 250 rows now cost ~250-500 queries instead of 2,000.
 */
const MATURATION_BATCH = 250;

/**
 * How long a ticker → symbol.id resolution stays cached (MST-012).
 *
 * ⚠️ WHY THIS EXISTS
 * `getPriceAt` called `symbol.findFirst({ ticker })` for EVERY horizon of EVERY row.
 * For a 1000-row batch at four horizons that is up to 4,000 identical lookups of a
 * table whose contents change perhaps once a week — roughly half of all the queries
 * the sweep made, and the half that produced the same answer every time.
 *
 * `symbol.ticker` is stable configuration, not market data, so a long TTL is safe.
 * The cache is per-process and best-effort: a miss simply re-queries, and an unknown
 * ticker is cached as `null` so a delisted symbol stops being retried thousands of
 * times per hour (HOOD, MARA, ASTS and TSLA between them accounted for thousands of
 * futile lookups — see #826).
 */
const SYMBOL_ID_CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * How far FORWARD of a horizon we will look for the next available bar (#830).
 *
 * ⚠️ WHY THIS EXISTS — the 15-minute window could not reach beyond a market close
 *
 * `getPriceAt` used to search only `max(15min, 2 x bar interval)` ahead of the
 * horizon. For anything that does not trade 24/7, a horizon landing outside market
 * hours has no bar in that window — so the price stayed null, the row could not
 * complete, and it sat in the queue until the 25h grace expired.
 *
 * Measured 2026-09-15 against 60 real unfilled horizons:
 *
 *   nearest bar within 15 min : 17
 *   nearest bar beyond 15 min : 43   <- permanently unfillable as written
 *   no bars at all            : 0    <- NOT ONE row was missing data
 *   median gap to nearest bar : 310 min      max gap: 585 min
 *
 * The targets were `Sep 14 20:02-23:00 UTC` = `21:02-24:00 BST`, when SPY, QQQ,
 * US500, USTEC, GER40, UK100 and CHINA50 are all shut. The price existed — at the
 * next session — and was simply never consulted.
 *
 * This conflated two very different situations behind one `null`:
 *   - "the market is closed; the price exists at the next session"  -> recoverable
 *   - "the symbol has stopped trading; no price exists at all"      -> genuinely null
 *
 * 72 hours is chosen deliberately: long enough to cross a weekend (FX closes Friday
 * evening and reopens Sunday, ~48h) so predictions made into a Friday close still
 * resolve, and short enough that a delisted symbol (last bar weeks ago) still finds
 * nothing and correctly returns null. It is NOT a licence to match across arbitrary
 * gaps — see `marketGapResolutions`, which counts how many resolutions were delayed.
 *
 * Resolving to the next available price is the correct semantic here, not a fudge:
 * the meaningful question when the market is shut is "was the direction right at the
 * next tradeable moment?" — the same next-available-price rule backtests use.
 */
const HORIZON_MAX_FORWARD_MS = 72 * 60 * 60 * 1000;


type DedupKey = string; // `${directiveId}::${symbol}`

/**
 * Canonicalise a timeframe label to the form stored on `MarketBar`.
 *
 * 2026-09-10 (MST-007 / #733): outcome rows were recorded with MT5-style labels
 * (`M15`, `H1`, `D1`) while `MarketBar.timeframe` holds `15m`, `1h`, `1d`. The
 * lookup filters on equality, so **every such row matured to NULL forever** —
 * 35,472 of 40,120 rows in the live table carried `M15` and not one had a single
 * horizon price. Normalising here makes historical rows resolvable as well as
 * protecting against a producer that speaks MT5 casing.
 */
export function canonicalTimeframe(timeframe: string): string {
  const t = String(timeframe ?? '').trim();
  const mt5 = /^([MHD])(\d+)$/i.exec(t);      // M5 / M15 / H1 / H4 / D1
  if (mt5) {
    const unit = mt5[1].toUpperCase();
    const n = Number(mt5[2]);
    return unit === 'M' ? `${n}m` : unit === 'H' ? `${n}h` : `${n}d`;
  }
  return t.toLowerCase();                      // already canonical ('15m', '1d')
}

@Injectable()
export class OutcomeTrackerService {
  private readonly logger = new Logger(OutcomeTrackerService.name);

  /** Tracks last recorded timestamp per directive+symbol for dedup. */
  private readonly lastRecorded = new Map<DedupKey, number>();

  /**
   * Ticker → symbol.id cache (MST-012). `null` means "resolved, does not exist",
   * which is cached deliberately so a delisted symbol is not re-queried forever.
   * See SYMBOL_ID_CACHE_TTL_MS for why this matters to pool health.
   */
  private readonly symbolIdCache = new Map<string, { id: string | null; at: number }>();

  /**
   * How many price lookups in the CURRENT sweep had to cross a market gap — i.e.
   * the horizon landed outside trading hours and the price came from the next
   * session (#830). Exposed so the distortion is visible rather than assumed
   * absent: these are real observations, but they are longer-dated than the
   * horizon label suggests, and any accuracy figure should know how many there are.
   */
  private marketGapResolutions = 0;

  /**
   * Cumulative drop counters for the observation filter (#825), split by REASON
   * because the two mean different things:
   *   - `zeroDropped`   — the directive scored 0/null. Nothing to track. Benign.
   *   - `windowDropped` — a real observation discarded because the same key was
   *                       written inside the dedup window. **This is the one that
   *                       thins the sample**, and it is the reason accuracy figures
   *                       taken before 2026-09-15 are not trustworthy.
   *
   * Reported as a running ratio rather than per-pass: a per-pass line fires on every
   * scoring tick and becomes noise, which is how the original DEBUG line went unseen.
   */
  private zeroDropped = 0;
  private windowDropped = 0;
  private readonly recordedTotal = { n: 0 };

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Report the running record:drop ratio (#825).
   *
   * ⚠️ WHY A RATIO AND NOT A PER-PASS COUNT
   * The old line fired on every pass at DEBUG and was therefore invisible. A ratio
   * over a meaningful window is the smallest signal that would have exposed a ~75%
   * silent drop, and it costs one log line per N observations instead of one per tick.
   */
  private logDropRate(): void {
    const dropped = this.windowDropped;
    // Only speak once the sample is meaningful, and then only every 200 window-drops,
    // so the line stays proportional to the problem rather than to the tick rate.
    if (dropped === 0 || dropped % 200 !== 0) return;
    const kept = this.recordedTotal.n;
    const considered = kept + dropped;
    const pct = considered > 0 ? Math.round((dropped / considered) * 100) : 0;
    this.logger.warn(
      `Outcome filter: ${dropped} observations discarded by the ${OUTCOME_TRACKING_DEDUP_WINDOW_MS / 1000}s ` +
      `dedup window, ${kept} recorded (${pct}% of candidates dropped). ` +
      `Zero-score drops (benign): ${this.zeroDropped}. ` +
      `A high ratio means outcome data is a SAMPLE, not a record — see #825.`,
    );
  }

  /**
   * Resolve a ticker to `symbol.id`, memoised for SYMBOL_ID_CACHE_TTL_MS.
   * Returns null when the ticker has no `symbol` row (a delisted or never-imported
   * symbol) — the caller then has no bar data to find and must not retry.
   */
  private async resolveSymbolId(ticker: string): Promise<string | null> {
    const key = String(ticker ?? '').toUpperCase();
    if (!key) return null;

    const hit = this.symbolIdCache.get(key);
    if (hit && Date.now() - hit.at < SYMBOL_ID_CACHE_TTL_MS) return hit.id;

    const row = await this.prisma.symbol.findFirst({
      where: { ticker: key },
      select: { id: true },
    });
    const id = row?.id ?? null;
    this.symbolIdCache.set(key, { id, at: Date.now() });
    return id;
  }

  /**
   * Store DirectiveOutcome records after a scoring run.
   * Called from the scoring pipeline after directives produce scores.
   *
   * Deduplication: directive+symbol combos are only recorded once per
   * OUTCOME_TRACKING_DEDUP_WINDOW_MS (default 5 min). Zero/null scores
   * are skipped since they carry no signal to track.
   */
  async recordOutcomes(
    outcomes: {
      directiveId: string;
      symbol: string;
      /**
       * ⚠️ REQUIRED, and deliberately not optional (#821).
       *
       * This was `strategyId?: string` and the caller omitted it, so the field wrote
       * `null` on all 16,673 rows. An optional attribution field on a measurement table
       * is a silent-failure generator: TypeScript cannot complain, the insert succeeds,
       * and every downstream per-protocol query returns empty rather than erroring.
       *
       * Making it required converts that class of bug into a COMPILE ERROR, which is
       * the guard this needs — a runtime check would only fire on the one code path
       * somebody remembered to instrument.
       *
       * Must be the protocol SLUG, to match `score.strategyId`.
       */
      strategyId: string;
      timeframe: string;
      score: number;
      signalClass: string;
      confidence: number;
      predictedAt: Date;
      priceAtPredict: number;
    }[],
  ): Promise<number> {
    if (!OUTCOME_TRACKING_ENABLED) {
      this.logger.debug('Outcome tracking disabled — skipping');
      return 0;
    }

    if (!this.prisma.isAvailable || outcomes.length === 0) return 0;

    const now = Date.now();
    const windowMs = OUTCOME_TRACKING_DEDUP_WINDOW_MS;

    // ── #825 — the dedup key MUST identify a strategy, and the drop reasons must be
    // countable. Both were wrong, and both were silent.
    //
    // ⚠️ DEFECT 1 — the key was `${directiveId}::${symbol}`, with no strategy.
    // A directive participates in MANY protocols — that is the normal case, and
    // `strategyId` exists on the row precisely so those can be told apart (#821).
    // Without it, a directive firing under protocol A suppressed the SAME directive
    // under protocol B for five minutes. **One protocol's observation cancelled
    // another's**, so per-protocol measurement was distorted in a way that depended
    // on which protocol happened to score first.
    //
    // ⚠️ DEFECT 2 — every drop logged at DEBUG and the counters were merged. Live
    // log, every scoring pass: "All N outcomes filtered (dedup/zero-score)" at
    // DEBUG. With a 300s window against a ~120s cadence, roughly 3 of every 4 passes
    // per key were dropped — silently, at a level that is off in normal operation.
    // A dropped observation is indistinguishable from a quiet market, which is why
    // this survived.
    //
    // Zero-score and window drops are now counted SEPARATELY: they mean different
    // things ("no signal to record" vs "we chose not to record this one") and only
    // the second is a measurement defect.
    let zeroScoreDropped = 0;
    let windowDropped = 0;

    const deduped = outcomes.filter((o) => {
      // Skip zero/null scores — no signal to track
      if (o.score == null || o.score === 0) {
        zeroScoreDropped++;
        return false;
      }

      // #825 — strategyId is part of the identity, not an optional extra.
      const key: DedupKey = `${o.strategyId}::${o.directiveId}::${o.symbol}`;
      const lastTs = this.lastRecorded.get(key);

      // If recorded within dedup window, skip
      if (lastTs !== undefined && (now - lastTs) < windowMs) {
        windowDropped++;
        return false;
      }

      // Mark as recorded (will be updated after successful DB write)
      this.lastRecorded.set(key, now);
      return true;
    });

    if (deduped.length === 0) {
      this.zeroDropped += zeroScoreDropped;
      this.windowDropped += windowDropped;
      this.logDropRate();
      return 0;
    }

    this.zeroDropped += zeroScoreDropped;
    this.windowDropped += windowDropped;
    this.logDropRate();

    try {
      const created = await this.prisma.directiveOutcome.createMany({
        data: deduped.map((o) => ({
          directiveId: o.directiveId,
          symbol: o.symbol,
          // #821 — required at the type level, so this cannot silently become null again.
          strategyId: o.strategyId,
          // Store the canonical label so the maturity lookup always matches.
          timeframe: canonicalTimeframe(o.timeframe),
          score: o.score,
          signalClass: o.signalClass,
          confidence: o.confidence,
          predictedAt: o.predictedAt,
          priceAtPredict: o.priceAtPredict,
        })),
        skipDuplicates: true,
      });
      this.logger.log(
        `Recorded ${created.count} directive outcomes` +
        (windowDropped > 0 ? ` (${windowDropped} held by the dedup window)` : ''),
      );
      this.recordedTotal.n += created.count;
      return created.count;
    } catch (err) {
      this.logger.error(`Failed to record outcomes: ${(err as Error).message}`);
      return 0;
    }
  }

  /**
   * Compute outcomes for matured predictions.
   * Finds records where outcomeComputedAt is null and predictedAt is old enough,
   * then fills T+15m, T+1h, T+4h, T+24h prices from MarketBar.
   *
   * Runs every 15 minutes — the shortest horizon (T+15m) is the finest
   * granularity, so a daily batch would delay the short horizons by up to 24h.
   * Each pass is idempotent (fills only due-and-null horizons), so frequent runs
   * stay cheap. (MST-007) Without this sweep no directive outcome is ever
   * matured, so directive "performance"/accuracy stays permanently empty.
   */
  @Cron('*/15 * * * *', { name: 'directive-outcome-maturation' })
  async computeOutcomes(): Promise<number> {
    if (!this.prisma.isAvailable) return 0;

    const now = Date.now();
    // ⚠️ THREE separate counters, deliberately (MST-012). `count` is rows visited,
    // `filled` is rows where at least one horizon gained a price, `finalised` is rows
    // that left the queue. Collapsing these into one number is what produced the
    // false-success `Matured 1000` line — see the comment at the write site.
    const computed = { count: 0, filled: 0, finalised: 0 };
    // Reset the market-gap tally so the reported figure describes THIS sweep (#830).
    this.marketGapResolutions = 0;

    // MST-007 — independent per-horizon maturity. Each horizon (T+15m/1h/4h/24h)
    // is filled as soon as its own due time has passed, instead of waiting for
    // the 24h mark and filling all four in a single update. This stops a missing
    // T+24h bar from holding the shorter horizons hostage.
    // ── MST-011 (2026-09-15) — only queue rows with a NEWLY-DUE missing horizon ────────
    //
    // ⚠️ THE DEFECT THIS FIXES
    // The previous predicate was just `outcomeComputedAt IS NULL`, which keeps a row in the
    // queue for its ENTIRE lifetime — 24 hours — because `outcomeComputedAt` is only set once
    // everything has filled. With `take: MATURATION_BATCH` and `orderBy: predictedAt ASC`,
    // rows awaiting their T+24h horizon therefore occupy the batch for a day each.
    //
    // Measured 2026-09-15: the oldest 1000 rows held **ZERO** of the 628 attributed rows, so
    // per-protocol accuracy could never resolve — every new row sat behind ~2,300 older rows
    // parked on their 24h horizon. Same class as #733 and #821: a plausible-looking absence.
    //
    // The fix adds `OR (horizon is DUE and still NULL)`. A row drops OUT of the queue as soon
    // as everything currently due is filled, and returns exactly once — when its next horizon
    // falls due. Turns a 24h residency into 4 brief visits, so the batch always contains
    // actionable rows rather than parked ones.
    //
    // `gracePassed` (25h) still finalises rows that can never fill, so nothing is stranded.
    const pending = await this.prisma.directiveOutcome.findMany({
      where: {
        outcomeComputedAt: null,
        predictedAt: { lte: new Date(now - 15 * 60 * 1000) },
        OR: [
          { predictedAt: { lte: new Date(now - 15 * 60 * 1000) }, priceT15m: null },
          { predictedAt: { lte: new Date(now - 60 * 60 * 1000) }, priceT1h: null },
          { predictedAt: { lte: new Date(now - 4 * 60 * 60 * 1000) }, priceT4h: null },
          { predictedAt: { lte: new Date(now - 24 * 60 * 60 * 1000) }, priceT24h: null },
        ],
      },
      take: MATURATION_BATCH,
      orderBy: { predictedAt: 'asc' },
    });

    if (pending.length === MATURATION_BATCH) {
      // A saturated batch is not a quiet one — report the true backlog so rows
      // stuck behind an unfillable queue head are visible instead of silent.
      const backlog = await this.prisma.directiveOutcome
        .count({ where: { outcomeComputedAt: null, predictedAt: { lte: new Date(now - 15 * 60 * 1000) } } })
        .catch(() => null);
      this.logger.warn(
        `Outcome maturation batch saturated (${MATURATION_BATCH} rows)` +
        (backlog != null ? ` — ${backlog} rows pending` : ''),
      );
    }

    for (const rec of pending) {
      try {
        const predicted = rec.predictedAt.getTime();

        let t15m = rec.priceT15m;
        let t1h = rec.priceT1h;
        let t4h = rec.priceT4h;
        let t24h = rec.priceT24h;

        // Fill each horizon only once its own due time has passed and it is
        // still null (idempotent across runs).
        if (t15m == null && now >= predicted + 15 * 60 * 1000) {
          t15m = await this.getPriceAt(rec.symbol, rec.timeframe, new Date(predicted + 15 * 60 * 1000));
        }
        if (t1h == null && now >= predicted + 60 * 60 * 1000) {
          t1h = await this.getPriceAt(rec.symbol, rec.timeframe, new Date(predicted + 60 * 60 * 1000));
        }
        if (t4h == null && now >= predicted + 4 * 60 * 60 * 1000) {
          t4h = await this.getPriceAt(rec.symbol, rec.timeframe, new Date(predicted + 4 * 60 * 60 * 1000));
        }
        if (t24h == null && now >= predicted + 24 * 60 * 60 * 1000) {
          t24h = await this.getPriceAt(rec.symbol, rec.timeframe, new Date(predicted + 24 * 60 * 60 * 1000));
        }

        // directionCorrect becomes available as soon as T+1h is known.
        let directionCorrect = rec.directionCorrect;
        if (directionCorrect == null && t1h != null && rec.signalClass !== 'neutral') {
          directionCorrect = rec.signalClass === 'bullish'
            ? t1h > rec.priceAtPredict
            : t1h < rec.priceAtPredict;
        }

        const allFilled = t15m != null && t1h != null && t4h != null && t24h != null;
        // Permanently-missing data (e.g. symbol stopped trading) must not rescan
        // forever — finalise 1h past the last horizon regardless.
        const gracePassed = now >= predicted + 25 * 60 * 60 * 1000;

        // ── MST-012 (2026-09-15) — count what was FILLED, not what was touched ──────
        //
        // ⚠️ THE DEFECT THIS FIXES
        // `computed.count++` sat outside any test of whether a price was actually
        // obtained, so `Matured 1000 directive outcomes` meant only "1000 rows were
        // visited and re-written" — frequently writing back the SAME nulls it read.
        //
        // Measured 2026-09-15: the log reported `Matured 1000` on every one of ~8
        // consecutive sweeps while `MAX(outcomeComputedAt)` did not advance for over
        // two hours and NO attributed row ever resolved. The line read as success and
        // was the reason the starvation below went unnoticed for a full day.
        //
        // Same class as #733 / #821 / #825: a plausible-looking success that is
        // indistinguishable from a no-op. A count is only meaningful if it counts the
        // thing the reader assumes it counts.
        const filledSomething =
          t15m !== rec.priceT15m || t1h !== rec.priceT1h ||
          t4h !== rec.priceT4h || t24h !== rec.priceT24h ||
          directionCorrect !== rec.directionCorrect;
        const finalised = allFilled || gracePassed;

        await this.prisma.directiveOutcome.update({
          where: { id: rec.id },
          data: {
            priceT15m: t15m,
            priceT1h: t1h,
            priceT4h: t4h,
            priceT24h: t24h,
            directionCorrect,
            outcomeComputedAt: finalised ? new Date() : null,
          },
        });
        computed.count++;
        if (filledSomething) computed.filled++;
        if (finalised) computed.finalised++;
      } catch (err) {
        this.logger.warn(`Failed to compute outcome ${rec.id}: ${(err as Error).message}`);
      }
    }

    // Report visited / filled / finalised separately. `visited` alone is not progress:
    // a sweep that visits 1000 rows and fills 0 is a stalled queue, and must not log
    // the same way as one that filled 1000.
    if (computed.count > 0) {
      // A low fill rate has TWO possible causes and they must be distinguishable in
      // the log (#830): either the queue is stalled, or the horizons land outside
      // market hours and the prices genuinely are not there yet. `gap` is how many
      // resolutions came from a bar later than the nominal tolerance — i.e. crossed a
      // close. A high gap count with high fills means the widened window is working;
      // high fills with gap 0 means everything resolved on time.
      const level = computed.filled === 0 ? 'warn' : 'log';
      this.logger[level](
        `Outcome maturation: visited ${computed.count}, filled ${computed.filled}, ` +
        `finalised ${computed.finalised} (of ${pending.length} in batch)` +
        (computed.filled > 0 ? `, ${this.marketGapResolutions} via next-session bar` : ''),
      );
    }
    return computed.filled;
  }

  /**
   * Get the first close at/after the horizon, searching forward far enough to cross
   * a market close (#830).
   *
   * `symbol` is a ticker; MarketBar.symbolId is a UUID foreign key.
   *
   * BEFORE: window was `max(15min, 2 x bar interval)`, so a horizon inside closed
   *         market hours never resolved — 72% of unfilled outcomes (#830).
   * AFTER:  window extends to HORIZON_MAX_FORWARD_MS (72h, covers a weekend).
   *         Nil is now returned only when genuinely no bar exists.
   */
  private async getPriceAt(symbol: string, timeframe: string, targetTime: Date): Promise<number | null> {
    try {
      // MST-012 — memoised. This was a per-horizon `symbol.findFirst`, i.e. up to
      // 4,000 identical queries per 1000-row batch, which is what put the sweep in
      // contention with the rest of the API for the 13-connection pool.
      const symbolId = await this.resolveSymbolId(symbol);
      if (!symbolId) return null;
      // Always query with the canonical label — outcome rows may carry MT5-style
      // labels (`M15`) that `MarketBar` never uses (`15m`).
      const barTimeframe = canonicalTimeframe(timeframe);
      // The NOMINAL window, kept only to classify a resolution as "on time" or
      // "delayed across a close". It is no longer the search bound.
      const nominalToleranceMs = Math.max(15 * 60_000, timeframeToMilliseconds(barTimeframe) * 2);
      const bar = await this.prisma.marketBar.findFirst({
        where: {
          symbolId,
          timeframe: barTimeframe,
          timestamp: {
            gte: targetTime,
            lte: new Date(targetTime.getTime() + HORIZON_MAX_FORWARD_MS),
          },
        },
        orderBy: { timestamp: 'asc' },
        select: { close: true, timestamp: true },
      });
      if (!bar) return null;
      // Count rather than discard: a delayed resolution is still a valid observation,
      // but the sweep should be able to report how many of its fills crossed a close
      // so the sample's true character is knowable (#830).
      if (bar.timestamp.getTime() - targetTime.getTime() > nominalToleranceMs) {
        this.marketGapResolutions++;
      }
      return bar.close;
    } catch (err) {
      // Never swallow silently: a query bug here is invisible otherwise, which is
      // exactly how the timeframe mismatch survived unnoticed (MST-007, #733).
      this.logger.debug(
        `Outcome price lookup failed for ${symbol} ${canonicalTimeframe(timeframe)}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Get accuracy aggregation for a directive.
   */
  async getAccuracy(params: {
    directiveId?: string;
    symbol?: string;
    timeframe?: string;
    days?: number;
  }) {
    if (!this.prisma.isAvailable) return { accuracy: 0, totalPredictions: 0 };

    const days = params.days ?? 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const where: any = {
      predictedAt: { gte: since },
      directionCorrect: { not: null },
    };
    if (params.directiveId) where.directiveId = params.directiveId;
    if (params.symbol) where.symbol = params.symbol;
    if (params.timeframe) where.timeframe = params.timeframe;

    const records = await this.prisma.directiveOutcome.findMany({
      where,
      select: {
        directiveId: true,
        symbol: true,
        timeframe: true,
        directionCorrect: true,
        signalClass: true,
      },
    });

    const total = records.length;
    const correct = records.filter((r) => r.directionCorrect).length;

    // Group by timeframe
    const byTimeframe: Record<string, { accuracy: number; count: number }> = {};
    const bySymbol: Record<string, { accuracy: number; count: number }> = {};
    for (const r of records) {
      if (!byTimeframe[r.timeframe]) byTimeframe[r.timeframe] = { accuracy: 0, count: 0 };
      byTimeframe[r.timeframe].count++;
      if (r.directionCorrect) byTimeframe[r.timeframe].accuracy++;

      if (!bySymbol[r.symbol]) bySymbol[r.symbol] = { accuracy: 0, count: 0 };
      bySymbol[r.symbol].count++;
      if (r.directionCorrect) bySymbol[r.symbol].accuracy++;
    }

    // Normalize
    for (const k of Object.keys(byTimeframe)) {
      byTimeframe[k].accuracy = byTimeframe[k].count > 0
        ? Math.round((byTimeframe[k].accuracy / byTimeframe[k].count) * 1000) / 1000
        : 0;
    }
    for (const k of Object.keys(bySymbol)) {
      bySymbol[k].accuracy = bySymbol[k].count > 0
        ? Math.round((bySymbol[k].accuracy / bySymbol[k].count) * 1000) / 1000
        : 0;
    }

    return {
      directiveId: params.directiveId ?? 'all',
      period: `${days}d`,
      totalPredictions: total,
      correctPredictions: correct,
      accuracy: total > 0 ? Math.round((correct / total) * 1000) / 1000 : 0,
      byTimeframe,
      bySymbol,
    };
  }

  /**
   * Trim raw outcomes older than retentionDays.
   */
  async trimOldOutcomes(retentionDays = 90): Promise<number> {
    if (!this.prisma.isAvailable) return 0;

    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const result = await this.prisma.directiveOutcome.deleteMany({
      where: { predictedAt: { lt: cutoff } },
    });
    if (result.count > 0) {
      this.logger.log(`Trimmed ${result.count} old outcomes (older than ${retentionDays}d)`);
    }
    return result.count;
  }
}

function timeframeToMilliseconds(timeframe: string): number {
  const match = /^(\d+)(m|h|d)$/i.exec(timeframe);
  if (!match) return 60 * 60_000;
  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  return value * (unit === 'm' ? 60_000 : unit === 'h' ? 60 * 60_000 : 24 * 60 * 60_000);
}
