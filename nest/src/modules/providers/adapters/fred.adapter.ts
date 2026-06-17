/**
 * FRED (Federal Reserve Economic Data) Provider Adapter
 * ======================================================
 * Free tier: unlimited. Requires free API key from research.stlouisfed.org.
 *
 * Base URL: https://api.stlouisfed.org/fred
 *
 * Provides macro economic indicators: GDP, CPI, Fed Funds Rate,
 * Unemployment, NFP, Retail Sales, Industrial Production, PCE.
 *
 * Config (.env):
 *   FRED_API_KEY=your_free_key (get at https://fred.stlouisfed.org/docs/api/api_key.html)
 */

import { Injectable, Logger } from '@nestjs/common';

const BASE_URL = 'https://api.stlouisfed.org/fred';

// FRED series IDs for key indicators
const SERIES_IDS: Record<string, string> = {
  fed_funds_rate: 'FEDFUNDS',          // Federal Funds Rate
  gdp: 'GDP',                          // Gross Domestic Product (quarterly)
  cpi_yoy: 'CPIAUCSL',                 // Consumer Price Index (monthly)
  core_pce: 'PCEPILFE',                // Core PCE (monthly)
  unemployment: 'UNRATE',              // Unemployment Rate
  nfp: 'PAYEMS',                       // Non-Farm Payrolls
  retail_sales: 'RSAFS',               // Retail Sales
  industrial_production: 'INDPRO',     // Industrial Production
};

export interface MacroObservation {
  date: string;
  value: number;
}

export interface MacroIndicator {
  id: string;
  name: string;
  category: string;
  unit: string;
  currentValue: number;
  previousValue: number | null;
  series: MacroObservation[];
  source: string;
}

@Injectable()
export class FredAdapter {
  readonly name = 'FRED';
  readonly id = 'fred';
  private readonly logger = new Logger(FredAdapter.name);
  private readonly apiKey = process.env.FRED_API_KEY || '';
  private readonly baseUrl = BASE_URL;

  private hasCredentials(): boolean {
    return !!this.apiKey;
  }

  async healthCheck(): Promise<boolean> {
    if (!this.hasCredentials()) return false;
    try {
      const url = `${this.baseUrl}/series?series_id=GDP&api_key=${this.apiKey}&file_type=json`;
      const res = await fetch(url);
      return res.ok;
    } catch {
      return false;
    }
  }

  async getObservation(seriesId: string, limit = 12): Promise<MacroObservation[] | null> {
    if (!this.hasCredentials()) return null;
    try {
      const url = `${this.baseUrl}/series/observations?series_id=${seriesId}&api_key=${this.apiKey}&file_type=json&sort_order=desc&limit=${limit}`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json();
      return (data.observations || [])
        .filter((o: any) => o.value !== '.')
        .map((o: any) => ({ date: o.date, value: parseFloat(o.value) }))
        .reverse();
    } catch (err) {
      this.logger.warn(`FRED fetch failed for ${seriesId}: ${err}`);
      return null;
    }
  }

  async getAllIndicators(): Promise<MacroIndicator[]> {
    const indicators: MacroIndicator[] = [];
    const mapping: Array<{ id: string; name: string; category: string; unit: string }> = [
      { id: 'fed_funds_rate', name: 'Fed Funds Rate', category: 'Interest Rates', unit: '%' },
      { id: 'gdp', name: 'US GDP', category: 'GDP', unit: 'B$' },
      { id: 'cpi_yoy', name: 'US CPI (YoY)', category: 'Inflation', unit: '%' },
      { id: 'core_pce', name: 'Core PCE (YoY)', category: 'Inflation', unit: '%' },
      { id: 'unemployment', name: 'Unemployment Rate', category: 'Employment', unit: '%' },
      { id: 'nfp', name: 'Non-Farm Payrolls', category: 'Employment', unit: 'K' },
      { id: 'retail_sales', name: 'Retail Sales', category: 'GDP', unit: 'M$' },
      { id: 'industrial_production', name: 'Industrial Production', category: 'GDP', unit: 'Index' },
    ];

    for (const item of mapping) {
      const seriesId = SERIES_IDS[item.id];
      if (!seriesId) continue;
      const observations = await this.getObservation(seriesId);
      if (!observations || observations.length < 2) continue;
      const current = observations[observations.length - 1];
      const previous = observations[observations.length - 2];
      indicators.push({
        id: item.id,
        name: item.name,
        category: item.category,
        unit: item.unit,
        currentValue: current.value,
        previousValue: previous.value,
        series: observations,
        source: 'FRED',
      });
    }

    return indicators;
  }
}
