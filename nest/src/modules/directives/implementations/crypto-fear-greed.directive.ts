/**
 * Crypto Fear & Greed Index
 * ==========================
 * Fetches the Alternative.me Crypto Fear & Greed Index.
 * Contrarian: extreme fear = bullish, extreme greed = bearish.
 *
 * maxScore: 60 — modest ceiling because sentiment is informative
 * but shouldn't dominate the protocol.
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
} from '../interfaces/directive.interface';
import { checkFidelity, lookaheadResult } from '../lookahead';

const API_URL = 'https://api.alternative.me/fng/';
const CACHE_TTL_MS = 3600_000; // 1 hour

interface FngCache {
  value: number;
  classification: string;
  fetchedAt: number;
}

@Injectable()
export class CryptoFearGreedDirective implements IDirective {
  readonly id = 'crypto-fear-greed';
  readonly name = 'Crypto Fear & Greed Index';
  readonly description =
    'Contrarian sentiment from the Alternative.me Fear & Greed Index. Extreme fear (<25) = bullish. Extreme greed (>75) = bearish.';
  readonly category = 'oscillator' as const;
  readonly priority = 55;
  readonly maxScore = 60;
  readonly minScore = 1;
  readonly minBars = { '1d': 1 };
  readonly version = '2.1.0'; // #1139 — refuses to score a historical bar from a live fetch
  readonly requiredDataFeeds = ['fear-greed'];
  readonly readiness = 'ready' as const;
  readonly directionBias = 'neutral' as const;

  private readonly logger = new Logger(CryptoFearGreedDirective.name);
  private cache: FngCache | null = null;

  async fetchFng(): Promise<FngCache | null> {
    // Return cached value if fresh
    if (this.cache && Date.now() - this.cache.fetchedAt < CACHE_TTL_MS) {
      return this.cache;
    }

    try {
      const res = await fetch(API_URL, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) {
        this.logger.warn(`F&G API returned ${res.status}`);
        return this.cache; // Return stale cache rather than nothing
      }
      const data = await res.json() as any;
      const item = data?.data?.[0];
      if (!item) {
        this.logger.warn('F&G API returned no data');
        return this.cache;
      }

      this.cache = {
        value: parseInt(item.value, 10) || 50,
        classification: item.value_classification || 'Neutral',
        fetchedAt: Date.now(),
      };
      return this.cache;
    } catch (err: any) {
      this.logger.warn(`F&G API fetch failed: ${err.message}`);
      return this.cache; // Stale cache
    }
  }

  calculate(input: DirectiveInput): DirectiveResult {
    // This directive runs synchronously — we use the cached value.
    // The cache is populated by the first call.
    const fng = this.cache;
    if (!fng) {
      // Trigger async fetch for next time
      this.fetchFng().catch(() => {});
      return {
        score: 0,
        confidence: 0.1,
        reason: 'Fear & Greed Index not yet fetched. Will be available on next scoring run.',
        signalClass: 'neutral',
      };
    }

    const { value, classification } = fng;

    /**
     * ── LOOKAHEAD GUARD (#1139 item 2) ─────────────────────────────────────────────────────────────
     * The index is fetched live and cached for an hour; the directive never read `asOf`, so every
     * historical bar was scored against TODAY's value. A protocol using it could not be judged by its
     * backtest, and the number it produced was plausible with no error.
     *
     * The check is exact — `fetchedAt` vs the bar, with one bar duration as the arrival allowance
     * (`lookahead.ts`). Live scoring is unaffected: there, the value is fetched during the bar it is
     * scoring.
     */
    const fidelity = checkFidelity(fng.fetchedAt, input.asOf, input.timeframe);
    if (fidelity !== 'ok') {
      return lookaheadResult(
        'the Fear & Greed index',
        fng.fetchedAt,
        input.asOf,
        'The index is fetched live and cached for an hour, so there is no historical value for this bar.',
      );
    }
    const deviation = Math.abs(value - 50);

    // Contrarian scoring: further from 50 = stronger signal
    let score = Math.round(deviation * 1.2);
    score = Math.min(this.maxScore, score);

    // Direction
    let signalClass: 'bullish' | 'bearish' | 'neutral';
    if (value <= 25) {
      signalClass = 'bullish'; // Extreme fear = buy
    } else if (value >= 75) {
      signalClass = 'bearish'; // Extreme greed = sell
    } else {
      signalClass = 'neutral';
    }

    const confidence = Math.min(0.9, deviation / 50);

    const age = Math.round((Date.now() - fng.fetchedAt) / 60000);
    return {
      score,
      confidence: Number(confidence.toFixed(2)),
      reason: `Fear & Greed: ${value}/100 (${classification}). ${signalClass === 'bullish' ? 'Contrarian buy signal — extreme fear.' : signalClass === 'bearish' ? 'Contrarian sell signal — extreme greed.' : 'Neutral sentiment.'} Fetched ${age}m ago.`,
      signalClass,
    };
  }
}
