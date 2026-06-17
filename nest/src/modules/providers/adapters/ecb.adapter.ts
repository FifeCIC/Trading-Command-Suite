/**
 * ECB (European Central Bank) Provider Adapter
 * =============================================
 * Free: no API key required. Public SDMX REST API.
 *
 * Base URL: https://data-api.ecb.europa.eu/service
 *
 * Provides: ECB refinancing rate, Eurozone inflation, GDP.
 *
 * Note: ECB SDMX API returns XML by default. This adapter
 * requests JSON and parses the statistical data format.
 */

import { Injectable, Logger } from '@nestjs/common';

export interface EcbObservation {
  date: string;
  value: number;
}

@Injectable()
export class EcbAdapter {
  readonly name = 'ECB';
  readonly id = 'ecb';
  private readonly logger = new Logger(EcbAdapter.name);
  private readonly baseUrl = 'https://data-api.ecb.europa.eu/service';

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/dataflow`, { signal: AbortSignal.timeout(5000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Fetch ECB main refinancing rate.
   * Dataset: FM (Financial Markets), series: FM.B.U2.EUR.4F.KR.MRR_FR.LEV
   */
  async getRefinancingRate(limit = 12): Promise<EcbObservation[] | null> {
    try {
      // ECB key interest rate — simplified endpoint
      const url = `${this.baseUrl}/data/FM/M.U2.EUR.4F.KR.MRR_FR.LEV?format=jsondata&detail=dataonly&lastNObservations=${limit}`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json();
      return this.parseEcbResponse(data);
    } catch (err) {
      this.logger.warn(`ECB rate fetch failed: ${err}`);
      return null;
    }
  }

  /**
   * Fetch Eurozone HICP (inflation).
   */
  async getInflation(limit = 12): Promise<EcbObservation[] | null> {
    try {
      const url = `${this.baseUrl}/data/ICP/M.U2.N.000000.4.ANR?format=jsondata&detail=dataonly&lastNObservations=${limit}`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json();
      return this.parseEcbResponse(data);
    } catch (err) {
      this.logger.warn(`ECB inflation fetch failed: ${err}`);
      return null;
    }
  }

  private parseEcbResponse(data: any): EcbObservation[] {
    const observations: EcbObservation[] = [];
    try {
      const ds = data?.dataSets?.[0];
      const structure = data?.structure?.dimensions?.observation;
      if (!ds || !structure) return [];
      const timeDim = structure.find((d: any) => d.role === 'time');
      const timeIdx = structure.indexOf(timeDim);
      const valueIdx = structure.length; // values come after dimensions
      const times = timeDim?.values || [];
      for (let i = 0; i < times.length; i++) {
        const val = ds.series?.['0:0:0:0:0']?.observations?.[i]?.[0];
        if (val != null && val !== 'NaN') {
          observations.push({ date: times[i].id || times[i], value: parseFloat(val) });
        }
      }
    } catch {
      // Fallback: return empty
    }
    return observations;
  }
}
