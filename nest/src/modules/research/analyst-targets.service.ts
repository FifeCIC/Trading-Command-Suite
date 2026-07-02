import { Injectable, Logger } from '@nestjs/common';
import { ProvidersService } from '../providers/providers.service';

export interface AnalystTargetResult {
  symbol: string;
  companyName: string;
  currentPrice: number;
  avgTarget: number;
  highTarget: number;
  lowTarget: number;
  consensus: string;
  analystCount: number;
  upside: number;
  source: string;
}

@Injectable()
export class AnalystTargetsService {
  private readonly logger = new Logger(AnalystTargetsService.name);

  constructor(
    private readonly providers: ProvidersService,
  ) {}

  /**
   * Fetch analyst price targets for multiple symbols.
   * Tries Finnhub first, falls back to FMP.
   */
  async getTargets(symbols: string[], sort?: string, order?: string): Promise<{
    source: string;
    count: number;
    targets: AnalystTargetResult[];
  }> {
    const results: AnalystTargetResult[] = [];

    for (const symbol of symbols) {
      try {
        const target = await this.getTargetForSymbol(symbol.toUpperCase());
        if (target) results.push(target);
      } catch (err) {
        this.logger.debug(`AnalystTargets: ${symbol} failed — ${(err as Error).message}`);
      }
    }

    // Sort
    if (sort) {
      const dir = order === 'asc' ? 1 : -1;
      results.sort((a, b) => {
        const aVal = (a as any)[sort] ?? 0;
        const bVal = (b as any)[sort] ?? 0;
        if (sort === 'symbol') return dir * String(aVal).localeCompare(String(bVal));
        return dir * (aVal - bVal);
      });
    }

    return {
      source: 'finnhub+fmp',
      count: results.length,
      targets: results,
    };
  }

  /**
   * Get analyst target for a single symbol.
   * Primary source: Finnhub via factory. Fallback: FMP via factory.
   */
  async getTargetForSymbol(symbol: string): Promise<AnalystTargetResult | null> {
    const sym = symbol.toUpperCase();
    const finnhub = this.providers.getAdapter('finnhub');
    const fmp = this.providers.getAdapter('fmp');

    // Try Finnhub first
    try {
      if (finnhub) {
        const pt = await (finnhub as any).getPriceTarget(sym);
        if (pt && pt.avgTarget > 0) {
          const currentPrice = pt.currentPrice ?? pt.avgTarget * 0.9;
          const upside = currentPrice > 0
            ? Math.round(((pt.avgTarget - currentPrice) / currentPrice) * 10000) / 100
            : 0;

          return {
            symbol: sym,
            companyName: pt.companyName || sym,
            currentPrice: Math.round(currentPrice * 100) / 100,
            avgTarget: Math.round(pt.avgTarget * 100) / 100,
            highTarget: Math.round((pt.highTarget ?? pt.avgTarget * 1.2) * 100) / 100,
            lowTarget: Math.round((pt.lowTarget ?? pt.avgTarget * 0.8) * 100) / 100,
            consensus: pt.consensus ?? this.classifyUpside(upside),
            analystCount: pt.analystCount ?? 0,
            upside,
            source: 'finnhub',
          };
        }
      }
    } catch (err) {
      this.logger.debug(`Finnhub price target failed for ${sym}, trying FMP`);
    }

    // Fallback to FMP
    try {
      const fpt = await (fmp as any).getPriceTarget(sym);
      if (fpt && fpt.targetConsensus > 0) {
        const currentPrice = fpt.currentPrice ?? fpt.targetConsensus * 0.9;
        const upside = currentPrice > 0
          ? Math.round(((fpt.targetConsensus - currentPrice) / currentPrice) * 10000) / 100
          : 0;

        return {
          symbol: sym,
          companyName: fpt.companyName || sym,
          currentPrice: Math.round(currentPrice * 100) / 100,
          avgTarget: Math.round(fpt.targetConsensus * 100) / 100,
          highTarget: Math.round((fpt.targetHigh ?? fpt.targetConsensus * 1.2) * 100) / 100,
          lowTarget: Math.round((fpt.targetLow ?? fpt.targetConsensus * 0.8) * 100) / 100,
          consensus: this.classifyUpside(upside),
          analystCount: fpt.numberOfAnalysts ?? 0,
          upside,
          source: 'fmp',
        };
      }
    } catch (err) {
      this.logger.debug(`FMP price target also failed for ${sym}`);
    }

    return null;
  }

  private classifyUpside(upside: number): string {
    if (upside > 30) return 'Strong Buy';
    if (upside > 15) return 'Buy';
    if (upside > 5) return 'Hold';
    if (upside > -5) return 'Hold';
    if (upside > -15) return 'Reduce';
    return 'Sell';
  }
}
