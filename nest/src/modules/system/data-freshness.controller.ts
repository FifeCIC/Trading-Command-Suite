import { Controller, Get, Logger } from '@nestjs/common';
import { getProviderRateConfig, RefreshPolicy } from '../../common/rate-limit/provider-rate-limits';

interface SourceStatus {
  id: string;
  label: string;
  connected: boolean;
  mode?: string;
  lastActivity?: string | null;
  detail?: string;
  refreshPolicy: RefreshPolicy;
}

interface DataFreshnessResponse {
  timestamp: string;
  sources: SourceStatus[];
  summary: {
    totalSources: number;
    connectedSources: number;
    hasLiveData: boolean;
  };
}

@Controller('data')
export class DataFreshnessController {
  private readonly logger = new Logger(DataFreshnessController.name);

  @Get('freshness')
  async getFreshness(): Promise<DataFreshnessResponse> {
    const sources: SourceStatus[] = [];

    // ── Trading212 ──────────────────────────────────────────
    const t212Config = getProviderRateConfig('trading212');
    const t212Key = process.env.TRADING212_DEMO_API_KEY || process.env.TRADING212_API_KEY;
    const t212Mode = process.env.TRADING212_MODE || 'unknown';
    sources.push({
      id: 'trading212',
      label: 'Trading212',
      connected: !!t212Key,
      mode: t212Mode,
      lastActivity: t212Key ? new Date().toISOString() : null,
      detail: t212Key ? `Mode: ${t212Mode}` : 'No API key',
      refreshPolicy: t212Config?.refreshPolicy || 'manual-only',
    });

    // ── MT5 Bridge ──────────────────────────────────────────
    try {
      const mt5Config = getProviderRateConfig('mt5');
      const BRIDGE_URL = process.env.MT5_BRIDGE_URL || 'http://localhost:5000';
      const mt5Ok = await fetch(`${BRIDGE_URL}/health`)
        .then((r) => r.ok)
        .catch(() => false);
      sources.push({
        id: 'mt5',
        label: 'MT5 Bridge',
        connected: mt5Ok,
        lastActivity: mt5Ok ? new Date().toISOString() : null,
        detail: mt5Ok ? 'Running' : 'Not running',
        refreshPolicy: mt5Config?.refreshPolicy || 'auto',
      });
    } catch {
      sources.push({ id: 'mt5', label: 'MT5 Bridge', connected: false, detail: 'Not running', refreshPolicy: 'auto' });
    }

    // ── Market Data + Scoring (from scoring summary) ────────
    try {
      const sr = await fetch('http://localhost:3201/api/scoring/summary')
        .then((r) => r.json())
        .catch(() => null);
      const withData = sr?.summary?.symbolsWithData || 0;
      const withoutData = sr?.summary?.symbolsWithoutData || 0;
      const total = withData + withoutData;

      sources.push({
        id: 'market-data',
        label: 'Market Data',
        connected: withData > 0,
        lastActivity: withData > 0 ? new Date().toISOString() : null,
        detail: withData > 0 ? `${withData}/${total} have bars` : `0/${total} have bars`,
        refreshPolicy: 'auto-on-data',
      });

      sources.push({
        id: 'scoring',
        label: 'Scoring',
        connected: withData > 0,
        lastActivity: new Date().toISOString(),
        detail: `${total} symbols tracked`,
        refreshPolicy: 'auto-on-data',
      });
    } catch {
      sources.push({ id: 'market-data', label: 'Market Data', connected: false, detail: 'Error', refreshPolicy: 'auto-on-data' });
      sources.push({ id: 'scoring', label: 'Scoring', connected: false, detail: 'Error', refreshPolicy: 'auto-on-data' });
    }

    const connectedSources = sources.filter((s) => s.connected).length;
    const hasLiveData = sources.some((s) => s.connected);

    return {
      timestamp: new Date().toISOString(),
      sources,
      summary: { totalSources: sources.length, connectedSources, hasLiveData },
    };
  }
}
