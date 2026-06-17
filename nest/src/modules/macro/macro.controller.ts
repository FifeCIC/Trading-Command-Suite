import { Controller, Get, Logger } from '@nestjs/common';
import { FredAdapter } from '../providers/adapters/fred.adapter';
import { EcbAdapter } from '../providers/adapters/ecb.adapter';

export interface MacroIndicatorDto {
  id: string;
  name: string;
  category: string;
  unit: string;
  currentValue: number | null;
  previousValue: number | null;
  change: number | null;
  series: { date: string; value: number }[];
  source: string;
  impact: string;
}

@Controller('macro')
export class MacroController {
  private readonly logger = new Logger(MacroController.name);

  constructor(
    private readonly fred: FredAdapter,
    private readonly ecb: EcbAdapter,
  ) {}

  @Get('indicators')
  async getIndicators(): Promise<MacroIndicatorDto[]> {
    const results: MacroIndicatorDto[] = [];

    // ── FRED indicators ──────────────────────────────────
    try {
      const fredIndicators = await this.fred.getAllIndicators();
      for (const ind of fredIndicators) {
        const change = ind.previousValue != null ? +(ind.currentValue - ind.previousValue).toFixed(2) : null;
        results.push({
          id: ind.id,
          name: ind.name,
          category: ind.category,
          unit: ind.unit,
          currentValue: ind.currentValue,
          previousValue: ind.previousValue,
          change,
          series: ind.series.map((s) => ({ date: s.date, value: s.value })),
          source: 'FRED',
          impact: this.impactLevel(ind.id),
        });
      }
    } catch (err) {
      this.logger.warn(`FRED fetch failed: ${err}`);
    }

    // ── ECB indicators ───────────────────────────────────
    try {
      const rate = await this.ecb.getRefinancingRate();
      const inflation = await this.ecb.getInflation();

      if (rate && rate.length >= 2) {
        const cur = rate[rate.length - 1];
        const prev = rate[rate.length - 2];
        results.push({
          id: 'ecb_rate',
          name: 'ECB Refinancing Rate',
          category: 'Interest Rates',
          unit: '%',
          currentValue: cur.value,
          previousValue: prev.value,
          change: +(cur.value - prev.value).toFixed(2),
          series: rate.map((s) => ({ date: s.date, value: s.value })),
          source: 'ECB',
          impact: 'high',
        });
      }

      if (inflation && inflation.length >= 2) {
        const cur = inflation[inflation.length - 1];
        const prev = inflation[inflation.length - 2];
        results.push({
          id: 'eu_inflation',
          name: 'Eurozone Inflation (HICP)',
          category: 'Inflation',
          unit: '%',
          currentValue: cur.value,
          previousValue: prev.value,
          change: +(cur.value - prev.value).toFixed(2),
          series: inflation.map((s) => ({ date: s.date, value: s.value })),
          source: 'ECB',
          impact: 'high',
        });
      }
    } catch (err) {
      this.logger.warn(`ECB fetch failed: ${err}`);
    }

    this.logger.log(`Returning ${results.length} macro indicators`);
    return results;
  }

  private impactLevel(id: string): string {
    const high = ['fed_funds_rate', 'cpi_yoy', 'core_pce', 'unemployment', 'nfp', 'gdp'];
    const medium = ['retail_sales', 'industrial_production'];
    return high.includes(id) ? 'high' : medium.includes(id) ? 'medium' : 'low';
  }
}
