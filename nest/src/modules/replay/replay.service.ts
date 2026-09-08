import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { ProtocolGatingService } from '../scoring/protocol-gating.service';
import { resolveMt5BridgeUrl } from '../providers/mt5/mt5-bridge.config';

export interface ReplayConfig {
  symbol: string;
  timeframe: string;
  from: string;
  to: string;
  protocolIds?: string[];
  windowSize?: number;
  /** Override BUY threshold (default: top 20th percentile of scores) */
  buyThreshold?: number;
  /** Override SELL threshold (default: bottom 20th percentile of scores) */
  sellThreshold?: number;
  /** Use relative scoring: rank each signal within its distribution (default: true) */
  relativeScoring?: boolean;
}

export interface ReplayBar {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ReplayStep {
  timestamp: Date;
  bar: ReplayBar;
  composite: number;
  signal: string;
  normalizedScore: number;
  activeDirectives: number;
  totalDirectives: number;
  /** Forward returns: what happened AFTER this signal */
  forwardReturn1?: number;
  forwardReturn3?: number;
  forwardReturn5?: number;
  forwardReturn10?: number;
  /** Was this signal directionally correct? */
  signalCorrect?: boolean;
  directiveBreakdown?: Array<{
    name: string;
    score: number;
    maxScore: number;
    signalClass: string;
    reason: string;
  }>;
  protocolResults?: Array<{
    protocolId: string;
    composite: number;
    signal: string;
    passed: boolean;
    checks?: any;
  }>;
}

export interface ReplayResult {
  symbol: string;
  timeframe: string;
  from: string;
  to: string;
  totalBars: number;
  steps: ReplayStep[];
  summary: {
    avgComposite: number;
    maxComposite: number;
    minComposite: number;
    buySignals: number;
    sellSignals: number;
    holdSignals: number;
    totalDirectivesRun: number;
    directivesPerBar: number;
  };
  /** Backtesting outcomes — signal accuracy and forward returns */
  outcomes?: {
    buyAccuracy: number;
    sellAccuracy: number;
    avgBuyReturn1: number;
    avgSellReturn1: number;
    avgBuyReturn5: number;
    avgSellReturn5: number;
    bestBuyReturn: number;
    worstBuyReturn: number;
    signalCount: number;
    missedOpportunities: number;
    falsePositives: number;
    lowScoreAccuracy: number;
    midScoreAccuracy: number;
  };
}

@Injectable()
export class ReplayService {
  private readonly logger = new Logger(ReplayService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly protocolGating: ProtocolGatingService,
  ) {}

  /** Load bars for a symbol within a date range */
  async loadBars(
    symbol: string,
    timeframe: string,
    from: Date,
    to: Date,
  ): Promise<ReplayBar[]> {
    // Find symbol in DB
    const sym = await this.prisma.symbol.findFirst({
      where: { ticker: symbol.toUpperCase() },
    });

    if (!sym) {
      this.logger.warn(`Symbol ${symbol} not found in DB`);
      return [];
    }

    const rows = await this.prisma.marketBar.findMany({
      where: {
        symbolId: sym.id,
        timeframe,
        timestamp: { gte: from, lte: to },
      },
      orderBy: { timestamp: 'asc' },
    });

    if (rows.length < 30) {
      // Try MT5 bridge fallback
      try {
        const mt5Bars = await this.fetchMT5Bars(symbol, timeframe, 200);
        if (mt5Bars.length > 0) {
          // Import into DB for future use
          const importData = mt5Bars.map((b) => ({
            symbolId: sym.id,
            provider: 'mt5',
            timeframe,
            timestamp: b.timestamp,
            open: b.open,
            high: b.high,
            low: b.low,
            close: b.close,
            volume: b.volume,
          }));
          try {
            await this.prisma.marketBar.createMany({
              data: importData,
              skipDuplicates: true,
            });
          } catch { /* dupes ok */ }
          this.logger.log(
            `MT5 fallback: imported ${mt5Bars.length} bars for ${symbol}`,
          );
          return mt5Bars.filter(
            (b) => b.timestamp >= from && b.timestamp <= to,
          );
        }
      } catch (err) {
        this.logger.warn(
          `MT5 fallback failed: ${(err as Error).message}`,
        );
      }
    }

    return rows.map((r) => ({
      timestamp: r.timestamp,
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.close),
      volume: Number(r.volume),
    }));
  }

  /** Fetch bars from MT5 bridge */
  private async fetchMT5Bars(
    symbol: string,
    timeframe: string,
    limit: number,
  ): Promise<ReplayBar[]> {
    try {
      const res = await fetch(
        `${resolveMt5BridgeUrl()}/candles?symbol=${encodeURIComponent(symbol)}&timeframe=${timeframe}&limit=${limit}`,
      );
      const data = await res.json();
      return (data.bars || []).map((b: any) => ({
        timestamp: new Date(b.timestamp || b.time),
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume || 0,
      }));
    } catch {
      return [];
    }
  }

  /** Run replay — step through bars and score each one */
  async runReplay(config: ReplayConfig): Promise<ReplayResult> {
    const { symbol, timeframe, from, to, protocolIds, windowSize = 30 } =
      config;
    const fromDate = new Date(from);
    const toDate = new Date(to);
    if (!protocolIds?.length) {
      throw new Error('Replay requires at least one protocolId for canonical META.Stack scoring.');
    }

    // Load bars
    const bars = await this.loadBars(symbol, timeframe, fromDate, toDate);

    if (bars.length < windowSize) {
      this.logger.warn(
        `Only ${bars.length} bars for ${symbol} (need ${windowSize}+)`,
      );
      return {
        symbol,
        timeframe,
        from,
        to,
        totalBars: bars.length,
        steps: [],
        summary: {
          avgComposite: 0,
          maxComposite: 0,
          minComposite: 0,
          buySignals: 0,
          sellSignals: 0,
          holdSignals: 0,
          totalDirectivesRun: 0,
          directivesPerBar: 0,
        },
        outcomes: {
          buyAccuracy: 0, sellAccuracy: 0,
          avgBuyReturn1: 0, avgSellReturn1: 0,
          avgBuyReturn5: 0, avgSellReturn5: 0,
          bestBuyReturn: 0, worstBuyReturn: 0,
          signalCount: 0, missedOpportunities: 0, falsePositives: 0,
          lowScoreAccuracy: 0, midScoreAccuracy: 0,
        },
      };
    }

    const steps: ReplayStep[] = [];
    let totalComposite = 0;
    let maxComposite = -Infinity;
    let minComposite = Infinity;
    let buyCount = 0;
    let sellCount = 0;
    let holdCount = 0;
    let totalDirectivesRun = 0;

    // Step through bars using the canonical protocol evaluator (2026-09-08).
    for (let i = windowSize - 1; i < bars.length; i++) {
      const currentBar = bars[i];
      const windowBars = bars.slice(Math.max(0, i - windowSize + 1), i + 1);
      const gatedResults = await Promise.all(
        protocolIds.map(protocolId =>
          this.protocolGating.scoreWithGating(symbol, windowBars, protocolId),
        ),
      );
      const selected = gatedResults.reduce((best, current) =>
        current.signalPct > best.signalPct ? current : best,
      );
      const normalizedScore = selected.signalPct;
      const signal = selected.signal;
      const breakdown = Object.values(selected.breakouts).flat().map(d => ({
        name: d.name,
        score: d.score,
        maxScore: d.maxScore,
        signalClass: d.signalClass,
        reason: d.reason,
      }));
      const activeCount = breakdown.filter(d => d.score > 0).length;

      if (signal === 'BUY' || signal === 'STRONG_BUY') buyCount++;
      else if (signal === 'SELL' || signal === 'STRONG_SELL') sellCount++;
      else holdCount++;

      totalComposite += normalizedScore;
      maxComposite = Math.max(maxComposite, normalizedScore);
      minComposite = Math.min(minComposite, normalizedScore);
      totalDirectivesRun += selected.meta.directiveCount;

      const protocolResults: ReplayStep['protocolResults'] = gatedResults.map((result, index) => ({
        protocolId: protocolIds[index],
        composite: result.signalPct,
        signal: result.signal,
        passed: result.signal !== 'HOLD' && !result.riskGate?.hardGateTriggered,
        checks: {
          scoreOk: { passed: result.signal !== 'HOLD', required: 40, actual: result.signalPct },
          directionOk: { passed: result.meta.directionalEvidence.selected !== 'none' },
          riskOk: { passed: !result.riskGate?.hardGateTriggered },
        },
      }));

      steps.push({
        timestamp: currentBar.timestamp,
        bar: currentBar,
        composite: selected.composite,
        signal,
        normalizedScore,
        activeDirectives: activeCount,
        totalDirectives: selected.meta.directiveCount,
        directiveBreakdown: breakdown.slice(0, 10),
        protocolResults,
      });
    }

    // Relative percentiles may be reported as analytics, but must not replace
    // canonical protocol actions. The former z-score reclassification was a
    // second signal trigger and was removed on 2026-09-08.

    // ── Forward-return analysis ─────────────────────────
    // Compute what happened AFTER each signal
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const stepBarIdx = bars.findIndex(b => b.timestamp.getTime() === step.timestamp.getTime());
      if (stepBarIdx < 0) continue;

      const computeReturn = (ahead: number): number | undefined => {
        const futureIdx = stepBarIdx + ahead;
        if (futureIdx >= bars.length) return undefined;
        if (step.bar.close <= 0) return undefined;
        return ((bars[futureIdx].close - step.bar.close) / step.bar.close) * 100;
      };

      step.forwardReturn1 = computeReturn(1);
      step.forwardReturn3 = computeReturn(3);
      step.forwardReturn5 = computeReturn(5);
      step.forwardReturn10 = computeReturn(10);

      // Signal accuracy: BUY correct if price went up, SELL correct if price went down
      const fwd1 = step.forwardReturn1;
      if (fwd1 !== undefined) {
        if (step.signal === 'BUY' || step.signal === 'STRONG_BUY') step.signalCorrect = fwd1 > 0;
        else if (step.signal === 'SELL' || step.signal === 'STRONG_SELL') step.signalCorrect = fwd1 < 0;
      }
    }

    // ── Outcome aggregation ─────────────────────────────
    const buySteps = steps.filter(s => (s.signal === 'BUY' || s.signal === 'STRONG_BUY') && s.forwardReturn1 !== undefined);
    const sellSteps = steps.filter(s => (s.signal === 'SELL' || s.signal === 'STRONG_SELL') && s.forwardReturn1 !== undefined);
    const actionableSteps = [...buySteps, ...sellSteps];

    const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a,b) => a+b, 0) / arr.length : 0;

    const outcomes = {
      buyAccuracy: buySteps.length > 0 ? Math.round(buySteps.filter(s => s.signalCorrect).length / buySteps.length * 100) : 0,
      sellAccuracy: sellSteps.length > 0 ? Math.round(sellSteps.filter(s => s.signalCorrect).length / sellSteps.length * 100) : 0,
      avgBuyReturn1: Math.round(avg(buySteps.map(s => s.forwardReturn1!)) * 100) / 100,
      avgSellReturn1: Math.round(avg(sellSteps.map(s => s.forwardReturn1!)) * 100) / 100,
      avgBuyReturn5: Math.round(avg(buySteps.filter(s => s.forwardReturn5 !== undefined).map(s => s.forwardReturn5!)) * 100) / 100,
      avgSellReturn5: Math.round(avg(sellSteps.filter(s => s.forwardReturn5 !== undefined).map(s => s.forwardReturn5!)) * 100) / 100,
      bestBuyReturn: buySteps.length > 0 ? Math.round(Math.max(...buySteps.map(s => s.forwardReturn1!)) * 100) / 100 : 0,
      worstBuyReturn: buySteps.length > 0 ? Math.round(Math.min(...buySteps.map(s => s.forwardReturn1!)) * 100) / 100 : 0,
      signalCount: actionableSteps.length,
      // Missed opps: BUY signals where price rose >0.5% OR SELL signals where price fell >0.5% but system scored low
      missedOpportunities: steps
        .filter(s => s.normalizedScore < 15 && s.forwardReturn1 !== undefined)
        .filter(s => (s.signal !== 'BUY' && s.forwardReturn1! > 0.5) || (s.signal !== 'SELL' && s.forwardReturn1! < -0.5))
        .length,
      // False positives: wrong-direction signals with significant adverse moves
      falsePositives: steps
        .filter(s => s.signalCorrect === false && s.forwardReturn1 !== undefined)
        .filter(s => Math.abs(s.forwardReturn1!) > 0.5)
        .length,
      // Edge ratio: what % of signals with extreme scores were correct vs middle scores
      lowScoreAccuracy: (() => {
        const low = steps.filter(s => s.normalizedScore < 15 && s.signalCorrect !== undefined);
        return low.length > 0 ? Math.round(low.filter(s => s.signalCorrect).length / low.length * 100) : 0;
      })(),
      midScoreAccuracy: (() => {
        const mid = steps.filter(s => s.normalizedScore >= 15 && s.normalizedScore <= 25 && s.signalCorrect !== undefined);
        return mid.length > 0 ? Math.round(mid.filter(s => s.signalCorrect).length / mid.length * 100) : 0;
      })(),
    };

    const validSteps = steps.filter((s) => s.normalizedScore > 0);
    const avgComposite =
      steps.length > 0
        ? Math.round(totalComposite / steps.length)
        : 0;

    return {
      symbol,
      timeframe,
      from,
      to,
      totalBars: bars.length,
      steps,
      summary: {
        avgComposite,
        maxComposite: maxComposite === -Infinity ? 0 : maxComposite,
        minComposite: minComposite === Infinity ? 0 : minComposite,
        buySignals: buyCount,
        sellSignals: sellCount,
        holdSignals: holdCount,
        totalDirectivesRun,
        directivesPerBar:
          steps.length > 0
            ? Math.round(totalDirectivesRun / steps.length)
            : 0,
      },
      outcomes,
    };
  }

  /** List symbols with bar data available for replay */
  async getDataInventory() {
    const rows = await this.prisma.marketBar.groupBy({
      by: ['symbolId'],
      _count: { id: true },
      _min: { timestamp: true },
      _max: { timestamp: true },
    });

    const inventory = [];
    for (const row of rows) {
      const sym = await this.prisma.symbol.findUnique({
        where: { id: row.symbolId },
      });
      if (sym) {
        inventory.push({
          symbol: sym.ticker,
          barCount: row._count.id,
          earliestBar: row._min.timestamp,
          latestBar: row._max.timestamp,
        });
      }
    }
    return inventory.sort((a, b) => b.barCount - a.barCount);
  }
}
