/**
 * MetaStack Performance Service
 * ==============================
 * A MetaStack is the complete automation unit: Watchlist + Protocol + Scoring Strategy + Trading Strategy.
 * This service rates MetaStacks by actual trade outcomes — PnL per runtime hour, profit factor, drawdown, etc.
 *
 * Rating formula:
 *   effectivenessRate = totalPnl / Math.max(runtimeHours, 0.25)
 *   confidenceFactor  = clamp(tradeCount / 100, 0.1, 1.0)
 *   consistencyFactor = 1 - abs(winRate - 0.5) * 0.3
 *   rating = effectivenessRate × recencyDecay × confidenceFactor × consistencyFactor
 *
 * Bands:
 *   > 80   ★★★★★  Elite
 *   > 60   ★★★★☆  Strong
 *   > 40   ★★★☆☆  Average
 *   > 20   ★★☆☆☆  Weak
 *   ≤ 20   ★☆☆☆☆  Untested
 *
 * Configuration Signature: A SHA-256 hash of (watchlist symbols + protocol directive set + scoring params + trading params).
 * When any component changes, the signature changes — the UI can warn that this MetaStack has diverged
 * from the version that produced its performance history.
 */

import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../../database/prisma.service';

export interface MetaStackRating {
  scoringStrategyId: string;
  metaStackName: string;
  protocolId: string;
  watchlistName: string;
  brokerId: string;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  totalPnl: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number;
  winRate: number;
  maxDrawdown: number;
  runtimeHours: number;
  effectivenessRate: number;
  rating: number;
  band: string;
  stars: string;
  firstTradeAt: string | null;
  lastTradeAt: string | null;
  recencyDecay: number;
  confidenceFactor: number;
  /** Current configuration signature of the MetaStack components. */
  fingerprint: string;
  /** Whether the current signature matches the one at rating time. */
  fingerprintChanged: boolean;
}

export interface MetaStackRatingsResponse {
  metaStacks: MetaStackRating[];
  computedAt: string;
  totalMetaStacks: number;
  activeMetaStacks: number;
}

@Injectable()
export class StackPerformanceService {
  private readonly logger = new Logger(StackPerformanceService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Compute ratings for all MetaStacks ────────────────────

  async computeAllRatings(): Promise<MetaStackRatingsResponse> {
    const scoringStrategies = await this.prisma.scoringStrategy.findMany({
      where: { enabled: true },
    });

    const now = new Date();
    const ratings: MetaStackRating[] = [];

    for (const strat of scoringStrategies) {
      const rating = await this.computeMetaStackRating(
        strat.id, strat.name, strat.protocolId,
        strat.watchlistName, strat.brokerId, strat.activatedAt,
      );
      ratings.push(rating);
    }

    ratings.sort((a, b) => b.rating - a.rating);

    return {
      metaStacks: ratings,
      computedAt: now.toISOString(),
      totalMetaStacks: ratings.length,
      activeMetaStacks: ratings.filter((r) => r.totalTrades > 0).length,
    };
  }

  // ── Compute rating for a single MetaStack ──────────────────

  async computeMetaStackRating(
    scoringStrategyId: string,
    metaStackName: string,
    protocolId: string,
    watchlistName: string,
    brokerId: string,
    activatedAt: Date | null,
  ): Promise<MetaStackRating> {
    // Compute current fingerprint from component state
    const fingerprint = await this.computeFingerprint(scoringStrategyId);

    // Fetch all trades attributed to this MetaStack
    const trades = await this.prisma.trade.findMany({
      where: { scoringStrategyId },
      orderBy: { openedAt: 'asc' },
    }).catch(() => []);

    if (trades.length === 0) {
      return this.emptyRating(scoringStrategyId, metaStackName, protocolId, watchlistName, brokerId, fingerprint);
    }

    // Compute stats
    let totalPnl = 0;
    let grossProfit = 0;
    let grossLoss = 0;
    let winningTrades = 0;
    let losingTrades = 0;
    let peakEquity = 0;
    let currentEquity = 0;
    let maxDrawdown = 0;

    const pnlHistory: number[] = [];

    for (const t of trades) {
      const pnl = t.pnl || 0;
      totalPnl += pnl;
      currentEquity += pnl;

      if (pnl > 0) {
        winningTrades++;
        grossProfit += pnl;
      } else if (pnl < 0) {
        losingTrades++;
        grossLoss += Math.abs(pnl);
      }

      pnlHistory.push(currentEquity);
      if (currentEquity > peakEquity) {
        peakEquity = currentEquity;
      }
      const drawdown = peakEquity - currentEquity;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }

    const totalTrades = trades.length;
    const winRate = totalTrades > 0 ? winningTrades / totalTrades : 0;
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? 999 : 0);

    // Runtime: from first trade (or activation) to last trade (or now)
    const firstTradeAt = trades[0]?.openedAt || null;
    const lastTradeAt = trades[trades.length - 1]?.openedAt || null;
    const startTime = activatedAt || firstTradeAt || new Date();
    const endTime = lastTradeAt || new Date();
    const runtimeMs = endTime.getTime() - startTime.getTime();
    const runtimeHours = Math.max(runtimeMs / (1000 * 60 * 60), 0.25); // min 15 min

    // ── Rating formula ──────────────────────────────────────

    // Effectiveness: PnL per runtime hour
    const effectivenessRate = totalPnl / runtimeHours;

    // Confidence: ramps from 0.1 at 0 trades to 1.0 at 100+ trades
    const confidenceFactor = Math.min(1.0, Math.max(0.1, totalTrades / 100));

    // Recency: exponential decay — trades older than 30 days count less
    const now = Date.now();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    const recencyDecay = lastTradeAt
      ? Math.exp(-Math.max(0, now - lastTradeAt.getTime()) / thirtyDaysMs)
      : 0.5;

    // Consistency: penalise extreme win rates (could be overfitting)
    const consistencyFactor = 1 - Math.abs(winRate - 0.5) * 0.3;

    // Raw rating: effectiveness × confidence × recency × consistency
    // Normalise effectiveness to a 0-100 scale (assume $50/hr = 100)
    const normalizedEffectiveness = Math.min(100, Math.max(0, (effectivenessRate / 50) * 100));
    const rating = Math.round(
      normalizedEffectiveness * recencyDecay * confidenceFactor * consistencyFactor
    );

    // ── Band ─────────────────────────────────────────────────
    let band: string;
    let stars: string;
    if (rating > 80) { band = 'Elite'; stars = '★★★★★'; }
    else if (rating > 60) { band = 'Strong'; stars = '★★★★☆'; }
    else if (rating > 40) { band = 'Average'; stars = '★★★☆☆'; }
    else if (rating > 20) { band = 'Weak'; stars = '★★☆☆☆'; }
    else { band = 'Untested'; stars = '★☆☆☆☆'; }

    // Persist to StackPerformance table
    try {
      await this.prisma.stackPerformance.upsert({
        where: { scoringStrategyId },
        create: {
          scoringStrategyId,
          totalTrades,
          winningTrades,
          losingTrades,
          totalPnl: Math.round(totalPnl * 100) / 100,
          grossProfit: Math.round(grossProfit * 100) / 100,
          grossLoss: Math.round(grossLoss * 100) / 100,
          maxDrawdown: Math.round(maxDrawdown * 100) / 100,
          peakEquity: Math.round(peakEquity * 100) / 100,
          currentEquity: Math.round(currentEquity * 100) / 100,
          firstTradeAt,
          lastTradeAt,
          runtimeHours: Math.round(runtimeHours * 100) / 100,
          effectivenessRate: Math.round(effectivenessRate * 100) / 100,
          profitFactor: Math.round(profitFactor * 100) / 100,
          winRate: Math.round(winRate * 10000) / 10000,
          sharpeApprox: 0,
          rating,
          fingerprint,
          computedAt: new Date(),
        },
        update: {
          totalTrades,
          winningTrades,
          losingTrades,
          totalPnl: Math.round(totalPnl * 100) / 100,
          grossProfit: Math.round(grossProfit * 100) / 100,
          grossLoss: Math.round(grossLoss * 100) / 100,
          maxDrawdown: Math.round(maxDrawdown * 100) / 100,
          peakEquity: Math.round(peakEquity * 100) / 100,
          currentEquity: Math.round(currentEquity * 100) / 100,
          firstTradeAt,
          lastTradeAt,
          runtimeHours: Math.round(runtimeHours * 100) / 100,
          effectivenessRate: Math.round(effectivenessRate * 100) / 100,
          profitFactor: Math.round(profitFactor * 100) / 100,
          winRate: Math.round(winRate * 10000) / 10000,
          rating,
          fingerprint,
          computedAt: new Date(),
        },
      });
    } catch (err) {
      this.logger.warn(`Failed to persist StackPerformance for ${scoringStrategyId}: ${(err as Error).message}`);
    }

    // Check if fingerprint changed from last persisted rating
    const lastPersisted = await this.prisma.stackPerformance.findUnique({
      where: { scoringStrategyId },
      select: { fingerprint: true },
    }).catch(() => null);
    const fingerprintChanged = lastPersisted
      ? lastPersisted.fingerprint !== fingerprint
      : false;

    return {
      scoringStrategyId,
      metaStackName,
      protocolId,
      watchlistName,
      brokerId,
      totalTrades,
      winningTrades,
      losingTrades,
      totalPnl: Math.round(totalPnl * 100) / 100,
      grossProfit: Math.round(grossProfit * 100) / 100,
      grossLoss: Math.round(grossLoss * 100) / 100,
      profitFactor: Math.round(profitFactor * 100) / 100,
      winRate: Math.round(winRate * 10000) / 10000,
      maxDrawdown: Math.round(maxDrawdown * 100) / 100,
      runtimeHours: Math.round(runtimeHours * 100) / 100,
      effectivenessRate: Math.round(effectivenessRate * 100) / 100,
      rating,
      band,
      stars,
      firstTradeAt: firstTradeAt?.toISOString() || null,
      lastTradeAt: lastTradeAt?.toISOString() || null,
      recencyDecay: Math.round(recencyDecay * 100) / 100,
      confidenceFactor: Math.round(confidenceFactor * 100) / 100,
      fingerprint,
      fingerprintChanged,
    };
  }

  // ── Get rating for a single MetaStack ──────────────────────

  async getMetaStackRating(scoringStrategyId: string): Promise<MetaStackRating | null> {
    const strat = await this.prisma.scoringStrategy.findUnique({
      where: { id: scoringStrategyId },
    });
    if (!strat) return null;

    return this.computeMetaStackRating(
      strat.id, strat.name, strat.protocolId,
      strat.watchlistName, strat.brokerId, strat.activatedAt,
    );
  }

  // ── Fingerprint: hash of MetaStack component state ──────────
  // When any component changes, the fingerprint changes — UI can warn users.

  async computeFingerprint(scoringStrategyId: string): Promise<string> {
    try {
      const scoring = await this.prisma.scoringStrategy.findUnique({
        where: { id: scoringStrategyId },
        select: { protocolId: true, watchlistName: true, brokerId: true, tradeThreshold: true, baseSize: true, slPct: true, tpPct: true, mode: true },
      });
      if (!scoring) return 'unknown';

      // Include the watchlist symbols (they define what's traded)
      let watchlistSymbols: string[] = [];
      try {
        const wl = await this.prisma.watchlist.findFirst({
          where: { name: scoring.watchlistName },
          select: { symbols: true },
        });
        if (wl?.symbols) {
          watchlistSymbols = (wl.symbols as any[]).map((s: any) => s?.ticker || s?.symbol || String(s)).sort();
        }
      } catch { /* watchlist may not be in DB */ }

      const payload = JSON.stringify({
        protocolId: scoring.protocolId,
        watchlistName: scoring.watchlistName,
        watchlistSymbols,
        brokerId: scoring.brokerId,
        tradeThreshold: scoring.tradeThreshold,
        baseSize: scoring.baseSize,
        slPct: scoring.slPct,
        tpPct: scoring.tpPct,
        mode: scoring.mode,
      });

      return createHash('sha256').update(payload).digest('hex').slice(0, 16);
    } catch {
      return 'hash-error';
    }
  }

  // ── Compare fingerprint: check if MetaStack changed since last trade ──

  async checkFingerprintChange(scoringStrategyId: string): Promise<{
    changed: boolean;
    currentFingerprint: string;
    lastTradeFingerprint: string | null;
    message: string | null;
  }> {
    const currentFingerprint = await this.computeFingerprint(scoringStrategyId);

    // Get the fingerprint at time of last rating persist
    const lastPerf = await this.prisma.stackPerformance.findUnique({
      where: { scoringStrategyId },
      select: { computedAt: true },
    }).catch(() => null);

    if (!lastPerf) {
      return { changed: false, currentFingerprint, lastTradeFingerprint: null, message: null };
    }

    // For now, we don't store historical fingerprints — this is a placeholder
    // for a future where StackPerformance stores the fingerprint at compute time.
    // When we add `fingerprint` column to StackPerformance, this becomes:
    //   changed = lastPerf.fingerprint !== currentFingerprint
    return {
      changed: false,
      currentFingerprint,
      lastTradeFingerprint: null,
      message: 'Fingerprint tracking active — historical comparison requires schema update.',
    };
  }

  // ── Empty rating for MetaStacks with no trades ─────────────

  private emptyRating(
    scoringStrategyId: string,
    metaStackName: string,
    protocolId: string,
    watchlistName: string,
    brokerId: string,
    fingerprint: string,
  ): MetaStackRating {
    return {
      scoringStrategyId,
      metaStackName,
      protocolId,
      watchlistName,
      brokerId,
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      totalPnl: 0,
      grossProfit: 0,
      grossLoss: 0,
      profitFactor: 0,
      winRate: 0,
      maxDrawdown: 0,
      runtimeHours: 0,
      effectivenessRate: 0,
      rating: 0,
      band: 'Untested',
      stars: '★☆☆☆☆',
      firstTradeAt: null,
      lastTradeAt: null,
      recencyDecay: 1,
      confidenceFactor: 0.1,
      fingerprint,
      fingerprintChanged: false,
    };
  }
}
