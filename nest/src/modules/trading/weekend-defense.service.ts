import { Injectable, Logger } from '@nestjs/common';
import { SwapCostService } from './swap-cost.service';
import { WeekendGapRiskService } from '../risk/weekend-gap-risk.service';

export interface WeekendPosition {
  symbol: string;
  ticket: number;
  direction: 'BUY' | 'SELL';
  volume: number;
  openPrice: number;
  currentPrice: number;
  profit: number;
  swap: number;
  dailySwapCost: number | null;
  isTripleSwapDay: boolean;
  swapDragPct: number | null;   // Swap cost as % of profit
  projectedGapRisk: number | null;
  projectedGapRiskPct: number | null;
  recommendation: 'HOLD' | 'REDUCE' | 'CLOSE';
  reason: string;
}

export interface WeekendChecklist {
  generatedAt: string;
  dayOfWeek: string;
  isFriday: boolean;
  positions: WeekendPosition[];
  totalExposure: number;
  totalSwapCostTonight: number;
  totalGapRisk: number;
  summary: {
    holdCount: number;
    reduceCount: number;
    closeCount: number;
    totalPositions: number;
  };
  nextMarketOpen: string | null;
}

@Injectable()
export class WeekendDefenseService {
  private readonly logger = new Logger(WeekendDefenseService.name);

  constructor(
    private readonly swapCost: SwapCostService,
    private readonly gapRisk: WeekendGapRiskService,
  ) {}

  /**
   * Build a comprehensive end-of-week checklist for all open positions.
   * Aggregates swap forecasts, gap risk projections, and provides a
   * recommendation (HOLD/REDUCE/CLOSE) for each position.
   */
  async buildChecklist(
    positions: Array<{
      symbol: string;
      ticket: number;
      type: number; // 0=BUY, 1=SELL
      volume: number;
      price_open: number;
      price_current: number;
      profit: number;
      swap: number;
    }>,
  ): Promise<WeekendChecklist> {
    const today = new Date();
    const dayOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][today.getUTCDay()];
    const isFriday = today.getUTCDay() === 5;

    const enriched: WeekendPosition[] = [];
    let totalExposure = 0;
    let totalSwapCost = 0;
    let totalGapRisk = 0;

    for (const pos of positions) {
      const direction = pos.type === 0 ? 'BUY' as const : 'SELL' as const;
      const positionValue = pos.volume * pos.price_current;
      totalExposure += Math.abs(positionValue);

      // Get swap forecast
      const swapForecast = await this.swapCost.forecastSwap(
        pos.symbol, pos.volume, direction,
      ).catch(() => null);

      // Get gap risk projection
      const gapExposure = await this.gapRisk.projectExposure(
        pos.symbol, direction, Math.abs(positionValue),
      ).catch(() => null);

      const dailySwapCost = swapForecast?.dailySwap ?? null;
      const tripleSwapCost = swapForecast?.tripleSwapCost ?? null;
      const isTripleSwap = swapForecast?.isTripleSwapDay ?? false;
      const effectiveSwap = isTripleSwap ? tripleSwapCost : dailySwapCost;

      if (effectiveSwap) totalSwapCost += Math.abs(effectiveSwap);
      if (gapExposure?.projectedGapRisk) totalGapRisk += gapExposure.projectedGapRisk;

      // Swap drag: what % of profit is swap eating?
      const swapDragPct = pos.profit > 0 && dailySwapCost
        ? Math.round(Math.abs(dailySwapCost) / pos.profit * 10000) / 100
        : null;

      // Recommendation logic
      let recommendation: 'HOLD' | 'REDUCE' | 'CLOSE' = 'HOLD';
      const reasons: string[] = [];

      // Close if: swap > profit (swap is eating all gains)
      if (pos.profit > 0 && dailySwapCost && Math.abs(dailySwapCost) > pos.profit * 0.5) {
        recommendation = 'CLOSE';
        reasons.push(`swap ($${Math.abs(dailySwapCost).toFixed(2)}/day) exceeds 50% of profit ($${pos.profit.toFixed(2)})`);
      }

      // Close if: gap risk > 10% of position value
      if (gapExposure && gapExposure.projectedGapRiskPct > 10) {
        recommendation = 'CLOSE';
        reasons.push(`gap risk ${gapExposure.projectedGapRiskPct}% exceeds 10% threshold`);
      }

      // Reduce if: triple swap day AND swap drag > 20%
      if (isTripleSwap && swapDragPct && swapDragPct > 20) {
        recommendation = recommendation === 'CLOSE' ? 'CLOSE' : 'REDUCE';
        reasons.push(`triple-swap Wednesday: swap is ${swapDragPct}% of profit`);
      }

      // Reduce if: gap risk > 5%
      if (gapExposure && gapExposure.projectedGapRiskPct > 5 && recommendation === 'HOLD') {
        recommendation = 'REDUCE';
        reasons.push(`gap risk ${gapExposure.projectedGapRiskPct}%`);
      }

      // Hold if: position is profitable, swap is low, gap risk is low
      if (reasons.length === 0) {
        reasons.push(pos.profit > 0
          ? 'profitable, low swap, low gap risk'
          : 'monitor — unprofitable but costs are manageable');
      }

      enriched.push({
        symbol: pos.symbol,
        ticket: pos.ticket,
        direction,
        volume: pos.volume,
        openPrice: pos.price_open,
        currentPrice: pos.price_current,
        profit: Math.round(pos.profit * 100) / 100,
        swap: Math.round(pos.swap * 100) / 100,
        dailySwapCost: dailySwapCost ? Math.round(dailySwapCost * 100) / 100 : null,
        isTripleSwapDay: isTripleSwap,
        swapDragPct,
        projectedGapRisk: gapExposure?.projectedGapRisk ?? null,
        projectedGapRiskPct: gapExposure?.projectedGapRiskPct ?? null,
        recommendation,
        reason: reasons.join('; '),
      });
    }

    return {
      generatedAt: new Date().toISOString(),
      dayOfWeek,
      isFriday,
      positions: enriched,
      totalExposure: Math.round(totalExposure * 100) / 100,
      totalSwapCostTonight: Math.round(totalSwapCost * 100) / 100,
      totalGapRisk: Math.round(totalGapRisk * 100) / 100,
      summary: {
        holdCount: enriched.filter(p => p.recommendation === 'HOLD').length,
        reduceCount: enriched.filter(p => p.recommendation === 'REDUCE').length,
        closeCount: enriched.filter(p => p.recommendation === 'CLOSE').length,
        totalPositions: enriched.length,
      },
      nextMarketOpen: isFriday ? 'Monday 00:00 GMT (forex)' : null,
    };
  }
}
