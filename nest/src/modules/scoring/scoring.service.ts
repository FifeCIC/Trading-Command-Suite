/**
 * Scoring Service
 * ===============
 * Orchestrates the full scoring pipeline:
 * 1. Loads active symbols from DB.
 * 2. Fetches market bars (or uses deterministic fallback if none).
 * 3. Runs all directives via DirectivesService.
 * 4. Aggregates via dominance/cancellation-aware weighted average.
 * 5. Returns ranked output.
 *
 * Dominance & Cancellation Rules:
 * - Directives declare signalClass (bullish/bearish/neutral) and priority (1-100).
 * - A directive with priority >= 80 can suppress lower-priority opposing signals.
 * - When bullish and bearish signals conflict, weighted voting determines bias.
 * - Confluence bonus: when multiple high-priority directives agree, score is amplified.
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { ModeService } from '../../config/mode.service';
import { DirectivesService } from '../directives/directives.service';
import { ScoreHistoryService } from './score-history.service';
import {
  DirectiveInput,
  MarketBar,
} from '../directives/interfaces/directive.interface';

/** Canonical directive weights from docs/CANONICAL-DIRECTIVE-REFERENCE.md */
const STRATEGY_WEIGHTS: Record<string, number> = {
  'rsi-oversold': 24,
  'macd-crossover': 22,
  'ema-structure': 20,
  'atr-dip': 18,
  'volume-confirmation': 16,
};

const ENTRY_THRESHOLD = 60;
const WATCH_THRESHOLD = 40;

export interface DirectiveBreakdown {
  directiveId: string;
  name: string;
  score: number;
  weight: number;
  contribution: number;
  confidence: number;
  reason: string;
  signalClass: 'bullish' | 'bearish' | 'neutral';
  priority: number;
}

export interface RankedSymbol {
  symbolId: string;
  ticker: string;
  score: number;
  confidence: number;
  freshness: string;
  signal: string;
  breakdown: DirectiveBreakdown[];
  timestamp: string;
}

export interface RankedResult {
  mode: string;
  services: { database: boolean; queue: boolean; redis: boolean };
  strategy: { name: string; entryThreshold: number; watchThreshold: number };
  ranked: RankedSymbol[];
}

@Injectable()
export class ScoringService {
  private readonly logger = new Logger(ScoringService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly modeService: ModeService,
    private readonly directivesService: DirectivesService,
    private readonly scoreHistoryService: ScoreHistoryService,
  ) {}

  async rankAll(_strategyId?: string, limit = 20): Promise<RankedResult> {
    const modeInfo = this.modeService.getModeInfo();
    const base = {
      mode: modeInfo.mode,
      services: {
        database: modeInfo.database,
        queue: modeInfo.queue,
        redis: modeInfo.redis,
      },
      strategy: {
        name: 'Conviction Dip Accumulation',
        entryThreshold: ENTRY_THRESHOLD,
        watchThreshold: WATCH_THRESHOLD,
      },
    };

    if (!this.prisma.isAvailable) {
      return { ...base, ranked: [] };
    }

    const symbols = await this.prisma.symbol.findMany({
      where: { active: true },
      select: { id: true, ticker: true, name: true },
      take: limit,
    });

    if (symbols.length === 0) {
      return { ...base, ranked: [] };
    }

    const ranked: RankedSymbol[] = [];

    for (const symbol of symbols) {
      const bars = await this.loadBars(symbol.id);
      const input: DirectiveInput = { symbol: symbol.ticker, bars };
      const results = this.directivesService.runAll(input);

      // Phase 1: Build breakdown with signalClass and priority
      const breakdown: DirectiveBreakdown[] = [];
      const signalGroups: { bullish: number; bearish: number; neutral: number } = {
        bullish: 0, bearish: 0, neutral: 0,
      };

      for (const [id, result] of results) {
        const weight = STRATEGY_WEIGHTS[id] ?? 0;
        const directive = this.directivesService.get(id);
        const priority = directive?.priority ?? 50;
        const signalClass = result.signalClass ?? 'neutral';

        // Track weighted signal votes
        if (signalClass === 'bullish') signalGroups.bullish += weight;
        else if (signalClass === 'bearish') signalGroups.bearish += weight;
        else signalGroups.neutral += weight;

        breakdown.push({
          directiveId: id,
          name: directive?.name ?? id,
          score: result.score,
          weight,
          contribution: 0, // computed in phase 2
          confidence: result.confidence,
          reason: result.reason,
          signalClass,
          priority,
        });
      }

      // Phase 2: Apply dominance/cancellation rules

      // Rule A: High-priority suppression — directives with priority >= 80 can
      // suppress lower-priority (< 60) opposing signals entirely
      const highPriorityBullish = breakdown.filter(
        (d) => d.signalClass === 'bullish' && d.priority >= 80,
      );
      const highPriorityBearish = breakdown.filter(
        (d) => d.signalClass === 'bearish' && d.priority >= 80,
      );

      let suppressedIds = new Set<string>();
      if (highPriorityBullish.length > 0 && highPriorityBearish.length === 0) {
        // High-priority bullish dominates — suppress all low-priority bearish
        for (const d of breakdown) {
          if (d.signalClass === 'bearish' && d.priority < 60) {
            suppressedIds.add(d.directiveId);
          }
        }
      } else if (highPriorityBearish.length > 0 && highPriorityBullish.length === 0) {
        // High-priority bearish dominates — suppress all low-priority bullish
        for (const d of breakdown) {
          if (d.signalClass === 'bullish' && d.priority < 60) {
            suppressedIds.add(d.directiveId);
          }
        }
      }

      // Rule B: Weighted signal voting — if one side outweighs the other by
      // a significant margin (2:1), suppress the minority
      const totalWeight = breakdown.reduce((s, d) => s + d.weight, 0);
      const bullRatio = totalWeight > 0 ? signalGroups.bullish / totalWeight : 0;
      const bearRatio = totalWeight > 0 ? signalGroups.bearish / totalWeight : 0;

      if (bullRatio > bearRatio * 2 && bullRatio > 0.4) {
        // Bullish consensus — suppress low-confidence bearish
        for (const d of breakdown) {
          if (d.signalClass === 'bearish' && d.confidence < 0.5 && !suppressedIds.has(d.directiveId)) {
            suppressedIds.add(d.directiveId);
          }
        }
      } else if (bearRatio > bullRatio * 2 && bearRatio > 0.4) {
        // Bearish consensus — suppress low-confidence bullish
        for (const d of breakdown) {
          if (d.signalClass === 'bullish' && d.confidence < 0.5 && !suppressedIds.has(d.directiveId)) {
            suppressedIds.add(d.directiveId);
          }
        }
      }

      // Phase 3: Compute weighted score with suppressed directives zeroed
      let totalScore = 0;
      let totalConfidence = 0;
      let weightSum = 0;

      for (const d of breakdown) {
        const effectiveScore = suppressedIds.has(d.directiveId) ? 0 : d.score;
        const contribution = (effectiveScore * d.weight) / 100;
        d.contribution = Number(contribution.toFixed(1));
        totalScore += contribution;
        totalConfidence += d.confidence * d.weight;
        weightSum += d.weight;
      }

      // Rule C: Confluence bonus — if multiple high-priority directives agree
      // and the dominant signal class is clear, add a small bonus
      const highPriorityAgreeing = (highPriorityBullish.length > 0 && bullRatio > bearRatio)
        || (highPriorityBearish.length > 0 && bearRatio > bullRatio);

      let confluenceBonus = 0;
      if (highPriorityAgreeing && highPriorityBullish.length + highPriorityBearish.length >= 2) {
        confluenceBonus = 5; // +5 bonus for confluence
      }

      const avgConfidence = weightSum > 0 ? totalConfidence / weightSum : 0;
      const finalScore = Math.min(100, Math.max(0, totalScore + confluenceBonus));
      const signal =
        finalScore >= ENTRY_THRESHOLD
          ? 'entry'
          : finalScore >= WATCH_THRESHOLD
            ? 'watch'
            : 'defensive';

      ranked.push({
        symbolId: symbol.id,
        ticker: symbol.ticker,
        score: Number(finalScore.toFixed(1)),
        confidence: Number(avgConfidence.toFixed(2)),
        freshness: bars.length > 0 ? 'live' : 'deterministic',
        signal,
        breakdown,
        timestamp: new Date().toISOString(),
      });
    }

    ranked.sort((a, b) => b.score - a.score);

    // Persist score snapshots for history endpoints
    try {
      const strategy = await this.findOrCreateDefaultStrategy();
      if (strategy) {
        const strategyId = strategy.id;
        for (const s of ranked) {
          await this.scoreHistoryService.storeSnapshot(
            s.symbolId,
            strategyId,
            s.score,
            { breakdown: s.breakdown, confidence: s.confidence, mode: base.mode },
          );
        }
        this.logger.debug(`Stored ${ranked.length} score snapshots (strategyId=${strategyId})`);
      }
    } catch (err) {
      this.logger.warn(`Failed to persist score snapshots: ${String(err)}`);
    }

    return { ...base, ranked: ranked.slice(0, limit) };
  }

  /**
   * Find the first active strategy, or create the default "Conviction Dip Accumulation" strategy.
   * Returns null when Prisma is unavailable.
   */
  private async findOrCreateDefaultStrategy(): Promise<{ id: string } | null> {
    if (!this.prisma.isAvailable) return null;

    const existing = await this.prisma.strategy.findFirst({
      where: { active: true },
      select: { id: true },
    });

    if (existing) return existing;

    return this.prisma.strategy.create({
      data: {
        name: 'Conviction Dip Accumulation',
        description:
          'Soft long-only, share-buying. Accumulate on quality dips; hold through normal drawdown.',
        config: {
          entryThreshold: 60,
          watchThreshold: 40,
          defenseThreshold: 25,
          weights: STRATEGY_WEIGHTS,
        },
        active: true,
      },
      select: { id: true },
    });
  }

  /**
   * QA Test Mode: minute-to-minute scoring with modifier amplifier.
   * Applies change_multiplier, parity_amplitude, and max_nudge per the
   * SEES First Minute-To-Minute Test Plan.
   */
  async qaMinToMin(limit = 20) {
    const result = await this.rankAll(undefined, limit);

    const qaSettings = {
      enabled: true,
      mode: 'hybrid',
      changeMultiplier: 12,
      parityAmplitude: 6,
      maxNudge: 15,
      debugLogging: true,
    };

    const debugLog: string[] = [];
    const debug = (msg: string) => {
      if (qaSettings.debugLogging) {
        debugLog.push(`[QA ${new Date().toISOString()}] ${msg}`);
        this.logger.debug(msg);
      }
    };

    debug(`QA modifier active — multiplier=${qaSettings.changeMultiplier}, amplitude=${qaSettings.parityAmplitude}, maxNudge=${qaSettings.maxNudge}`);

    const modified = result.ranked.map((symbol) => {
      const originalScore = symbol.score;
      const seed = originalScore * qaSettings.changeMultiplier;
      const oscillation = Math.sin((Date.now() / 1000 + originalScore) * 0.47) * qaSettings.parityAmplitude;
      const nudge = Math.max(-qaSettings.maxNudge, Math.min(qaSettings.maxNudge, oscillation));

      const modifiedScore = Math.min(100, Math.max(0, originalScore + nudge));
      const change = modifiedScore - originalScore;

      if (Math.abs(change) >= 0.5) {
        debug(`${symbol.ticker}: ${originalScore.toFixed(1)} → ${modifiedScore.toFixed(1)} (${change > 0 ? '+' : ''}${change.toFixed(1)})`);
      }

      return {
        ...symbol,
        score: Number(modifiedScore.toFixed(1)),
        qa: {
          originalScore: Number(originalScore.toFixed(1)),
          nudge: Number(nudge.toFixed(2)),
          change: Number(change.toFixed(2)),
          oscillation: Number(oscillation.toFixed(2)),
        },
      };
    });

    modified.sort((a, b) => b.score - a.score);

    const bounded = modified.every((s) => s.score >= 0 && s.score <= 100);
    const moved = modified.filter((s) => Math.abs(s.qa.change) >= 0.5).length;
    debug(`QA complete — ${moved} symbols moved, scores bounded: ${bounded}`);

    return {
      ...result,
      ranked: modified.slice(0, limit),
      qaSettings,
      qaSummary: {
        totalSymbols: modified.length,
        symbolsMoved: moved,
        scoresBounded: bounded,
        debugLog: debugLog.slice(-10),
      },
    };
  }

  private async loadBars(symbolId: string): Promise<MarketBar[]> {
    try {
      const rows = await this.prisma.marketBar.findMany({
        where: { symbolId },
        orderBy: { timestamp: 'asc' },
        take: 100,
      });

      return rows.map((r) => ({
        timestamp: r.timestamp,
        open: Number(r.open),
        high: Number(r.high),
        low: Number(r.low),
        close: Number(r.close),
        volume: Number(r.volume),
      }));
    } catch {
      this.logger.warn(
        `No market bars for ${symbolId} — directives will score 0.`,
      );
      return [];
    }
  }
}
