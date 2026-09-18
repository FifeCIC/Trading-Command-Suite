import { Injectable, Logger } from '@nestjs/common';
import { SwapCostService } from './swap-cost.service';
import { WeekendGapRiskService } from '../risk/weekend-gap-risk.service';
import { normalizeSide, isSideKnown, type PositionSide } from '../../common/utils/position-pnl';

/**
 * What a caller must supply for one position. Normalised HERE so both callers (the automation
 * loop's broker positions and the MT5 endpoint's bridge positions) cannot disagree.
 */
export interface WeekendPositionInput {
  symbol: string;
  /** MT5 tickets exceed 32 bits, and Trading212 ids are strings — never narrowed to a number. */
  ticket: number | string;
  /**
   * ⚠️ `number | 'buy' | 'sell'` — **both arms are real**. The bridge sends the STRING form
   * (`"type": "buy"`), while older call sites assumed the numeric MT5 code (0 = buy). Comparing
   * the string to `0` is always false, so this field previously reported every position as SELL.
   * Pass it through `normalizeSide()`; never compare it. See #869 Finding B.
   */
  side: PositionSide;
  volume: number;
  openPrice: number;
  currentPrice: number;
  profit: number;
  swap?: number;
  /**
   * Position value in the broker's money, when the caller already knows it.
   * Preferred over `volume × contractSize × price`, which needs a contract size the caller may not
   * have. `BrokerPosition.marketValue` supplies this directly.
   */
  marketValue?: number | null;
  /**
   * Per-lot contract size, used only when `marketValue` is absent. Without it `volume × price` is a
   * RATIO, not money — 0.1 lots × 1.09 = 0.109, which is why the exposure total was not a currency
   * amount. See #869 Finding C.
   */
  contractSize?: number | null;
}

/** How a position's exposure figure was arrived at, so a total can say what it is. */
export type ExposureBasis = 'market-value' | 'contract-size' | 'not-money';

export interface WeekendPosition {
  symbol: string;
  ticket: number | string;
  direction: 'BUY' | 'SELL';
  /**
   * Whether the broker actually stated a direction. `false` means `normalizeSide()` fell back to
   * 'buy' because nothing was reported — the direction is then a DEFAULT, not a reading, and a
   * consumer acting on it (swap sign, gap direction) would be acting on an assumption.
   */
  sideKnown: boolean;
  volume: number;
  openPrice: number;
  currentPrice: number;
  profit: number;
  swap: number;
  exposure: number;
  exposureBasis: ExposureBasis;
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
  /**
   * ⚠️ Total exposure, and WHAT IT IS. `totalExposureBasis` is `'not-money'` when any position
   * could not be valued in currency — a bare total with no unit is how an earlier version reported
   * "totalExposure: 0.44" as though it were £0.44. Consumers must render the basis, not assume it.
   */
  totalExposure: number;
  totalExposureBasis: ExposureBasis;
  totalSwapCostTonight: number;
  totalGapRisk: number;
  /**
   * Positions whose direction the broker did not state. Non-zero means the direction column is a
   * default for those rows, so a swap or gap figure derived from it is provisional.
   */
  unknownSideCount: number;
  summary: {
    holdCount: number;
    reduceCount: number;
    closeCount: number;
    totalPositions: number;
  };
  nextMarketOpen: string | null;
}

/**
 * Value one position in money, and say which basis was used.
 *
 * ⚠️ Order matters: `marketValue` first (the broker's own figure), then
 * `volume × contractSize × price`. `volume × price` alone is NOT a fallback — it is a ratio that
 * reads like money, so it is reported as `not-money` instead of being returned as a number.
 */
export function positionExposure(pos: WeekendPositionInput): { value: number; basis: ExposureBasis } {
  if (typeof pos.marketValue === 'number' && Number.isFinite(pos.marketValue)) {
    return { value: Math.abs(pos.marketValue), basis: 'market-value' };
  }
  const cs = Number(pos.contractSize);
  if (Number.isFinite(cs) && cs > 0 && Number.isFinite(pos.currentPrice) && Number.isFinite(pos.volume)) {
    return { value: Math.abs(pos.volume * cs * pos.currentPrice), basis: 'contract-size' };
  }
  return { value: 0, basis: 'not-money' };
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
    positions: WeekendPositionInput[],
  ): Promise<WeekendChecklist> {
    const today = new Date();
    const dayOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][today.getUTCDay()];
    const isFriday = today.getUTCDay() === 5;

    const enriched: WeekendPosition[] = [];
    let totalExposure = 0;
    let totalSwapCost = 0;
    let totalGapRisk = 0;
    let unknownSideCount = 0;
    // If ANY position could not be valued in money the total cannot claim to be money.
    let worstBasis: ExposureBasis = 'market-value';

    for (const pos of positions) {
      // ⚠️ `normalizeSide()` handles the numeric MT5 codes AND the string form the bridge actually
      // sends. The retired expression was `pos.type === 0 ? 'BUY' : 'SELL'`, which is false for
      // `"buy"` and therefore reported every long position as SELL (#869 Finding B).
      const direction = normalizeSide(pos.side) === 'buy' ? 'BUY' as const : 'SELL' as const;
      const sideKnown = isSideKnown(pos.side);
      if (!sideKnown) unknownSideCount++;

      const exposure = positionExposure(pos);
      if (exposure.basis === 'not-money') worstBasis = 'not-money';
      else if (exposure.basis === 'contract-size' && worstBasis === 'market-value') worstBasis = 'contract-size';
      totalExposure += exposure.value;

      const positionValue = exposure.value;

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
        sideKnown,
        volume: pos.volume,
        openPrice: pos.openPrice,
        currentPrice: pos.currentPrice,
        profit: Math.round(pos.profit * 100) / 100,
        swap: Math.round((pos.swap ?? 0) * 100) / 100,
        exposure: Math.round(exposure.value * 100) / 100,
        exposureBasis: exposure.basis,
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
      // A total is only money when every position in it was money. Reporting a mixed sum as a
      // currency amount is the defect this field exists to prevent.
      totalExposureBasis: worstBasis,
      totalSwapCostTonight: Math.round(totalSwapCost * 100) / 100,
      totalGapRisk: Math.round(totalGapRisk * 100) / 100,
      unknownSideCount,
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
