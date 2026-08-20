/**
 * Mt5BridgeConfig — single source of truth for the MT5 bridge URL.
 * =====================================================================
 * Previously 10 call sites mixed `MT5_BRIDGE_URL || localhost:5000` with
 * `|| localhost:5001` defaults, and three hardcoded `localhost:5000/candles`
 * URLs bypassed the env var entirely — so the candle feed and the order path
 * could silently point at different bridges.
 *
 * Everything that talks to the bridge goes through here:
 *   - `resolveMt5BridgeUrl()` — pure helper for module-level/static contexts.
 *   - `Mt5BridgeConfig` — injectable provider (exported from ProvidersModule)
 *     with `url` and `candlesUrl()`.
 */
import { Injectable } from '@nestjs/common';

export const MT5_BRIDGE_DEFAULT_URL = 'http://localhost:5000';

/** Resolve the bridge base URL from env, with one shared default. */
export function resolveMt5BridgeUrl(): string {
  return process.env.MT5_BRIDGE_URL || MT5_BRIDGE_DEFAULT_URL;
}

@Injectable()
export class Mt5BridgeConfig {
  get url(): string {
    return resolveMt5BridgeUrl();
  }

  /** Canonical candle endpoint for a symbol/timeframe. */
  candlesUrl(symbol: string, timeframe: string, limit: number | string): string {
    return `${this.url}/candles?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}&limit=${encodeURIComponent(String(limit))}`;
  }
}
