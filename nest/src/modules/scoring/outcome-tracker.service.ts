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
 */
const MATURATION_BATCH = 1000;

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

  constructor(private readonly prisma: PrismaService) {}

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
      strategyId?: string;
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

    // Filter: skip zero/null scores + deduplicate within time window
    const deduped = outcomes.filter((o) => {
      // Skip zero/null scores — no signal to track
      if (o.score == null || o.score === 0) return false;

      const key: DedupKey = `${o.directiveId}::${o.symbol}`;
      const lastTs = this.lastRecorded.get(key);

      // If recorded within dedup window, skip
      if (lastTs !== undefined && (now - lastTs) < windowMs) {
        return false;
      }

      // Mark as recorded (will be updated after successful DB write)
      this.lastRecorded.set(key, now);
      return true;
    });

    if (deduped.length === 0) {
      this.logger.debug(`All ${outcomes.length} outcomes filtered (dedup/zero-score)`);
      return 0;
    }

    const skipped = outcomes.length - deduped.length;
    if (skipped > 0) {
      this.logger.debug(`Dedup: ${skipped}/${outcomes.length} outcomes skipped (within ${windowMs / 1000}s window or zero-score)`);
    }

    try {
      const created = await this.prisma.directiveOutcome.createMany({
        data: deduped.map((o) => ({
          directiveId: o.directiveId,
          symbol: o.symbol,
          strategyId: o.strategyId ?? null,
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
      this.logger.log(`Recorded ${created.count} directive outcomes (${skipped} deduped)`);
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
    const computed = { count: 0 };

    // MST-007 — independent per-horizon maturity. Each horizon (T+15m/1h/4h/24h)
    // is filled as soon as its own due time has passed, instead of waiting for
    // the 24h mark and filling all four in a single update. This stops a missing
    // T+24h bar from holding the shorter horizons hostage.
    const pending = await this.prisma.directiveOutcome.findMany({
      where: {
        outcomeComputedAt: null,
        predictedAt: { lte: new Date(now - 15 * 60 * 1000) },
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

        await this.prisma.directiveOutcome.update({
          where: { id: rec.id },
          data: {
            priceT15m: t15m,
            priceT1h: t1h,
            priceT4h: t4h,
            priceT24h: t24h,
            directionCorrect,
            outcomeComputedAt: allFilled || gracePassed ? new Date() : null,
          },
        });
        computed.count++;
      } catch (err) {
        this.logger.warn(`Failed to compute outcome ${rec.id}: ${(err as Error).message}`);
      }
    }

    if (computed.count > 0) {
      this.logger.log(`Matured ${computed.count} directive outcomes`);
    }
    return computed.count;
  }

  /**
   * Get the first close at/after the horizon in a bounded freshness window.
   * `symbol` is a ticker; MarketBar.symbolId is a UUID foreign key.
   */
  private async getPriceAt(symbol: string, timeframe: string, targetTime: Date): Promise<number | null> {
    try {
      const resolved = await this.prisma.symbol.findFirst({
        where: { ticker: symbol.toUpperCase() },
        select: { id: true },
      });
      if (!resolved) return null;
      // Always query with the canonical label — outcome rows may carry MT5-style
      // labels (`M15`) that `MarketBar` never uses (`15m`).
      const barTimeframe = canonicalTimeframe(timeframe);
      const toleranceMs = Math.max(15 * 60_000, timeframeToMilliseconds(barTimeframe) * 2);
      const bar = await this.prisma.marketBar.findFirst({
        where: {
          symbolId: resolved.id,
          timeframe: barTimeframe,
          timestamp: {
            gte: targetTime,
            lte: new Date(targetTime.getTime() + toleranceMs),
          },
        },
        orderBy: { timestamp: 'asc' },
        select: { close: true },
      });
      return bar?.close ?? null;
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
