/**
 * Seasonal Affinity Service
 * ==========================
 * Computes date-driven protocol weight adjustments. Each protocol
 * can declare a `seasonalAffinity` map that boosts or dampens its
 * scoring weight based on the current month and special date ranges.
 *
 * Used by:
 * - ScoringService.rankAll() — applies seasonal weight to composite scores
 * - SpeedScanService.scan() — applies seasonal weight to scan results
 *
 * Protocol: protocol-calendar (Q-prompt)
 */

import { Injectable, Logger } from '@nestjs/common';
import { SeasonalAffinity, DateRangeOverride } from '../directives/directive-groups';
import { ProtocolDbService } from './protocol-db.service';

// ── Types ──────────────────────────────────────────────────

export interface AffinityResult {
  weight: number;          // Final weight adjustment (-1.0 to +1.0)
  source: 'monthly' | 'date-range' | 'none';
  label?: string;          // Date range label if applicable
  month: number;           // Current month (0-11)
  day: number;             // Current day (1-31)
}

// ── Service ────────────────────────────────────────────────

@Injectable()
export class SeasonalAffinityService {
  private readonly logger = new Logger(SeasonalAffinityService.name);

  constructor(private readonly protocolDb: ProtocolDbService) {}

  getAffinity(protocolId: string, date?: Date): AffinityResult {
    const now = date ?? new Date();
    const month = now.getMonth();
    const day = now.getDate();

    const protocol = this.protocolDb.getCached(protocolId);
    if (!protocol?.seasonalAffinity) {
      return { weight: 0, source: 'none', month, day };
    }

    const affinity = protocol.seasonalAffinity;

    // Check date range overrides first (they take precedence)
    if (affinity.dateRanges) {
      for (const range of affinity.dateRanges) {
        if (this.isDateInRange(month, day, range)) {
          return {
            weight: range.weight,
            source: 'date-range',
            label: range.label,
            month,
            day,
          };
        }
      }
    }

    // Fall back to monthly weight
    const monthlyWeight = affinity.monthly[month] ?? 0;

    return {
      weight: monthlyWeight,
      source: 'monthly',
      month,
      day,
    };
  }

  /**
   * Compute a seasonally-adjusted score multiplier.
   * The weight is applied as: adjustedScore = baseScore * (1 + weight)
   *
   * Examples:
   *   weight +0.10 → multiplier 1.10 (10% boost in favorable season)
   *   weight -0.15 → multiplier 0.85 (15% penalty in unfavorable season)
   *   weight 0.00  → multiplier 1.00 (neutral)
   */
  getMultiplier(protocolId: string, date?: Date): number {
    const { weight } = this.getAffinity(protocolId, date);
    return 1.0 + weight;
  }

  /**
   * Check if a date falls within a seasonal range.
   * Handles ranges that wrap around the new year (e.g., Dec 24 → Jan 2).
   */
  private isDateInRange(
    month: number,
    day: number,
    range: DateRangeOverride,
  ): boolean {
    const start = range.start.month * 100 + range.start.day;
    const end = range.end.month * 100 + range.end.day;
    const current = month * 100 + day;

    if (start <= end) {
      // Normal range: Jan 10 → Jan 20
      return current >= start && current <= end;
    } else {
      // Wrap-around range: Dec 24 → Jan 2
      return current >= start || current <= end;
    }
  }

  /**
   * Get affinity results for all protocols that have seasonal affinity
   * defined. Useful for dashboards and debugging.
   */
  getAllAffinities(date?: Date): Array<{ protocolId: string; name: string } & AffinityResult> {
    const results: Array<{ protocolId: string; name: string } & AffinityResult> = [];

    for (const [protocolId, protocol] of Object.entries(this.protocolDb.getAllCached()) as [string, any][]) {
      if (protocol.seasonalAffinity) {
        const affinity = this.getAffinity(protocolId, date);
        results.push({
          protocolId,
          name: protocol.name,
          ...affinity,
        });
      }
    }

    return results.sort((a, b) => b.weight - a.weight);
  }
}
