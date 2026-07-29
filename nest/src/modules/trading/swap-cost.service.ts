import { Injectable, Logger } from '@nestjs/common';
import { AdapterFactory } from '../providers/adapter-factory';

export interface SwapRates {
  symbol: string;
  swapLong: number;   // Points charged/credited for long positions (per lot per day)
  swapShort: number;  // Points charged/credited for short positions (per lot per day)
  swapMode: number;   // 0=points, 1=base currency, 2=interest, 3=margin currency
  contractSize: number;
  digits: number;
}

export interface SwapForecast {
  symbol: string;
  direction: 'BUY' | 'SELL';
  volume: number;
  dailySwap: number;          // Single-day swap cost (negative = cost, positive = credit)
  isTripleSwapDay: boolean;   // True if today is a triple-swap day (Wed→Thu for most brokers)
  tripleSwapCost: number;     // What the swap will actually be tonight
  weekendProjection: number;  // Swap cost if held through weekend (Fri→Mon)
  swapMode: string;           // Human-readable swap mode
  currency: string;           // Account currency
}

@Injectable()
export class SwapCostService {
  private readonly logger = new Logger(SwapCostService.name);

  constructor(private readonly adapterFactory: AdapterFactory) {}

  /**
   * Fetch swap rates for a symbol from the MT5 bridge.
   */
  async getSwapRates(symbol: string): Promise<SwapRates | null> {
    const mt5 = this.adapterFactory.create('mt5');
    if (!mt5) {
      this.logger.warn('MT5 adapter not available for swap rate lookup');
      return null;
    }

    try {
      const data = await (mt5 as any).bridgeGet(`/symbol/${symbol.toUpperCase()}/info`);
      if (!data || data.error) return null;
      return {
        symbol: data.name || symbol,
        swapLong: data.swapLong ?? 0,
        swapShort: data.swapShort ?? 0,
        swapMode: data.swapMode ?? 0,
        contractSize: data.contractSize ?? 100000,
        digits: data.digits ?? 5,
      };
    } catch (err) {
      this.logger.error(`Failed to fetch swap rates for ${symbol}: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Calculate comprehensive swap forecast for a position.
   *
   * @param symbol   Trading symbol (e.g. XAUUSD, EURUSD)
   * @param volume   Position volume in lots
   * @param direction BUY or SELL
   */
  async forecastSwap(
    symbol: string,
    volume: number,
    direction: 'BUY' | 'SELL',
  ): Promise<SwapForecast | null> {
    const rates = await this.getSwapRates(symbol);
    if (!rates) return null;

    const isLong = direction === 'BUY';
    const swapPoints = isLong ? rates.swapLong : rates.swapShort;

    // Calculate daily swap in account currency
    // swapPoints is in points (e.g., -2.5 for EURUSD means -$0.25 per 0.01 lot if digits=5)
    // Formula: swapPoints × volume × contractSize / (10^digits)
    const pointValue = 1 / Math.pow(10, rates.digits);
    const dailySwap = swapPoints * volume * rates.contractSize * pointValue;

    // Triple swap: most forex brokers charge 3× on Wednesday→Thursday
    const today = new Date();
    const dayOfWeek = today.getUTCDay(); // 0=Sun, 3=Wed, 5=Fri
    const isTripleSwapDay = dayOfWeek === 3; // Wednesday

    const tripleSwapCost = isTripleSwapDay ? dailySwap * 3 : dailySwap;
    const swapModeLabels: Record<number, string> = {
      0: 'points',
      1: 'base currency',
      2: 'interest',
      3: 'margin currency',
    };

    // Weekend projection: if holding through Friday, estimate Fri→Mon (2-3 days of swap)
    // Most brokers charge 1× on Friday but some charge 3× for weekend
    const daysToMonday = dayOfWeek === 5 ? 3 : dayOfWeek === 4 ? 4 : dayOfWeek === 3 ? 5 : 0;
    const weekendProjection = daysToMonday > 0
      ? dailySwap * Math.min(daysToMonday, 3)
      : 0;

    return {
      symbol: symbol.toUpperCase(),
      direction,
      volume,
      dailySwap: Math.round(dailySwap * 100) / 100,
      isTripleSwapDay,
      tripleSwapCost: Math.round(tripleSwapCost * 100) / 100,
      weekendProjection: Math.round(weekendProjection * 100) / 100,
      swapMode: swapModeLabels[rates.swapMode] || `unknown (${rates.swapMode})`,
      currency: 'USD', // MT5 account default; could be configured
    };
  }

  /**
   * Evaluate whether swap cost is eating into profits.
   * Returns a warning if swap > 20% of current profit.
   */
  evaluateSwapDrag(
    dailySwap: number,
    currentProfit: number,
  ): { ratio: number; warning: boolean; message: string } {
    if (currentProfit <= 0) {
      return { ratio: 1, warning: true, message: 'Position not profitable — swap is pure cost' };
    }

    const ratio = Math.abs(dailySwap) / currentProfit;
    const warning = ratio > 0.2;

    return {
      ratio: Math.round(ratio * 100) / 100,
      warning,
      message: warning
        ? `Swap cost is ${(ratio * 100).toFixed(0)}% of current profit — consider closing before triple-swap day`
        : `Swap cost is ${(ratio * 100).toFixed(0)}% of current profit`,
    };
  }
}
