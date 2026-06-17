import { Injectable, Logger } from '@nestjs/common';

/**
 * Simple forward calendar events for predictive scoring.
 * In production, this would come from Finnhub API, economic calendar APIs, etc.
 */

export interface CalendarEvent {
  date: string;          // ISO date
  type: 'earnings' | 'economic' | 'dividend' | 'split';
  symbol?: string;       // for earnings/dividends
  currency?: string;     // for economic events (USD, EUR, GBP)
  name: string;
  importance: 'high' | 'medium' | 'low';
  expectedImpact: number;  // -1 to +1 (negative to positive)
  note?: string;
}

export interface ScorePrediction {
  symbol: string;
  scoreNow: number;
  predictions: {
    daysAhead: number;
    date: string;
    predictedScore: number;
    confidence: 'high' | 'medium' | 'low';
    delta: number;
    catalysts: string[];
  }[];
}

/** Seed calendar — known upcoming events. Update periodically. */
const SEED_CALENDAR: CalendarEvent[] = [
  // Earnings
  { date: '2026-06-19', type: 'earnings', symbol: 'NVDA', name: 'NVIDIA Earnings', importance: 'high', expectedImpact: 0.3, note: 'AI chip demand continues strong' },
  { date: '2026-06-25', type: 'earnings', symbol: 'MSFT', name: 'Microsoft Earnings', importance: 'high', expectedImpact: 0.2 },
  { date: '2026-07-15', type: 'earnings', symbol: 'AAPL', name: 'Apple Earnings', importance: 'high', expectedImpact: 0.15 },
  { date: '2026-07-18', type: 'earnings', symbol: 'TSLA', name: 'Tesla Earnings', importance: 'high', expectedImpact: -0.1, note: 'Margin pressure concerns' },
  { date: '2026-07-22', type: 'earnings', symbol: 'GOOGL', name: 'Alphabet Earnings', importance: 'high', expectedImpact: 0.2 },
  // Economic
  { date: '2026-06-18', type: 'economic', currency: 'USD', name: 'FOMC Interest Rate Decision', importance: 'high', expectedImpact: -0.2, note: 'Potential rate hold — hawkish tone' },
  { date: '2026-06-20', type: 'economic', currency: 'USD', name: 'US CPI (Inflation)', importance: 'high', expectedImpact: 0.1, note: 'Expected to moderate slightly' },
  { date: '2026-06-25', type: 'economic', currency: 'USD', name: 'US GDP (Final)', importance: 'medium', expectedImpact: 0.1 },
  { date: '2026-07-01', type: 'economic', currency: 'USD', name: 'ISM Manufacturing PMI', importance: 'medium', expectedImpact: 0.05 },
  { date: '2026-07-03', type: 'economic', currency: 'USD', name: 'Non-Farm Payrolls', importance: 'high', expectedImpact: 0.1 },
  { date: '2026-07-15', type: 'economic', currency: 'GBP', name: 'UK CPI', importance: 'high', expectedImpact: -0.1, note: 'Persistent services inflation' },
  { date: '2026-08-01', type: 'economic', currency: 'USD', name: 'FOMC Rate Decision', importance: 'high', expectedImpact: 0.1, note: 'Markets pricing first cut possibility' },
  // Dividends
  { date: '2026-06-20', type: 'dividend', symbol: 'AAPL', name: 'Apple Dividend', importance: 'low', expectedImpact: 0.02 },
  { date: '2026-07-01', type: 'dividend', symbol: 'MSFT', name: 'Microsoft Dividend', importance: 'low', expectedImpact: 0.02 },
];

/** Default symbols for predictive scoring */
const DEFAULT_SYMBOLS = ['BTCUSD', 'NVDA', 'AAPL', 'MSFT', 'TSLA', 'EURUSD', 'SPY'];

@Injectable()
export class PredictiveScoringService {
  private readonly logger = new Logger(PredictiveScoringService.name);

  /**
   * Generate score predictions for given symbols at specified horizons.
   * This is a prototype — predictions are based on scheduled events only.
   */
  getPredictions(
    symbols: string[] = DEFAULT_SYMBOLS,
    horizonDays = 7,
  ): ScorePrediction[] {
    const horizons = [1, 3, 7, 30].filter((h) => h <= horizonDays);
    const now = new Date();
    const results: ScorePrediction[] = [];

    for (const symbol of symbols) {
      const scoreNow = this.getCurrentScore(symbol);
      const predictions = horizons.map((daysAhead) => {
        const targetDate = new Date(now);
        targetDate.setDate(targetDate.getDate() + daysAhead);
        const dateStr = targetDate.toISOString().split('T')[0];

        // Find events between now and target date for this symbol
        const relevantEvents = SEED_CALENDAR.filter((e) => {
          return e.date <= dateStr && e.date > now.toISOString().split('T')[0] &&
            (e.symbol === symbol || (e.type === 'economic' && this.symbolUsesCurrency(symbol, e.currency)));
        });

        const catalysts = relevantEvents.map((e) => e.name);
        const totalImpact = relevantEvents.reduce((sum, e) => sum + e.expectedImpact, 0);
        const hasHighImportance = relevantEvents.some((e) => e.importance === 'high');

        // Calculate predicted score
        // Each ±0.1 impact = ±5 score points (capped)
        const scoreDelta = Math.round(totalImpact * 50);
        const predictedScore = Math.max(0, Math.min(100, scoreNow + scoreDelta));

        // Confidence based on event certainty
        let confidence: 'high' | 'medium' | 'low' = 'low';
        if (relevantEvents.length > 0 && hasHighImportance) {
          confidence = 'high';
        } else if (relevantEvents.length > 0) {
          confidence = 'medium';
        } else if (daysAhead <= 3) {
          confidence = 'medium'; // near-term, even without events, current trend is informative
        }

        return {
          daysAhead,
          date: dateStr,
          predictedScore,
          confidence,
          delta: predictedScore - scoreNow,
          catalysts,
        };
      });

      results.push({ symbol, scoreNow, predictions });
    }

    return results;
  }

  /**
   * Mock current score — in production, this would query the real scoring engine.
   * Uses symbol-specific base scores for realistic demo.
   */
  private getCurrentScore(symbol: string): number {
    const base: Record<string, number> = {
      BTCUSD: 72, NVDA: 78, AAPL: 65, MSFT: 70,
      TSLA: 52, EURUSD: 58, SPY: 68, GOOGL: 66,
    };
    return base[symbol] ?? 50 + Math.floor(Math.random() * 30);
  }

  /** Simple currency-to-symbol mapping */
  private symbolUsesCurrency(symbol: string, currency?: string): boolean {
    if (!currency) return false;
    const map: Record<string, string> = {
      BTCUSD: 'USD', NVDA: 'USD', AAPL: 'USD', MSFT: 'USD',
      TSLA: 'USD', SPY: 'USD', GOOGL: 'USD', EURUSD: 'EUR',
    };
    return map[symbol] === currency;
  }
}
