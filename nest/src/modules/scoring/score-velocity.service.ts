/**
 * ScoreVelocityService — #519 Score Momentum Indicator
 * =====================================================
 * Reads Score table snapshots and computes second-order signals:
 * velocity, acceleration, volatility, and directive drift.
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

export interface ScoreVelocity {
  symbol: string;
  currentScore: number;
  /** Score change per hour over the window */
  velocityPtsPerHour: number;
  /** Change in velocity since previous tick */
  acceleration: number;
  /** Standard deviation of scores in the window */
  volatility: number;
  /** Number of snapshots in the window */
  sampleCount: number;
  /** Window duration in minutes */
  windowMinutes: number;
  /** Top directive contributors to score change */
  directiveDrift: Array<{ directiveId: string; name: string; change: number }>;
  /** Overall signal */
  signal: 'surge' | 'collapse' | 'fading' | 'indecision' | 'steady' | 'insufficient_data';
  signalLabel: string;
}

@Injectable()
export class ScoreVelocityService {
  private readonly logger = new Logger(ScoreVelocityService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getVelocity(symbol: string, windowSize = 5): Promise<ScoreVelocity> {
    if (!this.prisma.isAvailable) {
      return this.empty(symbol, 'Database unavailable');
    }

    // Resolve symbol to ID
    const sym = await this.prisma.symbol.findFirst({ where: { ticker: symbol } });
    if (!sym) return this.empty(symbol, 'Symbol not found');

    // Get last N+1 snapshots (need N+1 to compute change from oldest to newest)
    const rows = await this.prisma.score.findMany({
      where: { symbolId: sym.id },
      orderBy: { timestamp: 'desc' },
      take: windowSize + 1,
    });

    if (rows.length < 2) return this.empty(symbol, `Need ≥2 snapshots, have ${rows.length}`);

    // Sort oldest→newest for calculation
    const sorted = [...rows].reverse();
    const newest = sorted[sorted.length - 1];
    const oldest = sorted[0];

    const timeSpanHours = (newest.timestamp.getTime() - oldest.timestamp.getTime()) / 3600000;
    if (timeSpanHours <= 0) return this.empty(symbol, 'Zero time span');

    const scoreDelta = newest.value - oldest.value;
    const velocity = scoreDelta / timeSpanHours;

    // Acceleration: compare last two velocity readings
    let acceleration = 0;
    if (sorted.length >= 3) {
      const prevOldest = sorted[0];
      const prevNewest = sorted[sorted.length - 2];
      const prevSpan = (prevNewest.timestamp.getTime() - prevOldest.timestamp.getTime()) / 3600000;
      if (prevSpan > 0) {
        const prevVelocity = (prevNewest.value - prevOldest.value) / prevSpan;
        acceleration = velocity - prevVelocity;
      }
    }

    // Volatility: stddev of all scores in window
    const scores = sorted.map(r => r.value);
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    const variance = scores.reduce((sum, s) => sum + (s - mean) ** 2, 0) / scores.length;
    const volatility = Math.sqrt(variance);

    // Directive drift: compare breakdowns
    const directiveDrift = this.computeDrift(oldest.breakdown, newest.breakdown);

    // Signal classification
    const { signal, signalLabel } = this.classify(velocity, acceleration, volatility, newest.value);

    return {
      symbol,
      currentScore: newest.value,
      velocityPtsPerHour: Math.round(velocity * 10) / 10,
      acceleration: Math.round(acceleration * 100) / 100,
      volatility: Math.round(volatility * 10) / 10,
      sampleCount: sorted.length,
      windowMinutes: Math.round(timeSpanHours * 60),
      directiveDrift,
      signal,
      signalLabel,
    };
  }

  private computeDrift(
    oldBreakdown: any,
    newBreakdown: any,
  ): Array<{ directiveId: string; name: string; change: number }> {
    if (!oldBreakdown || !newBreakdown) return [];
    const drift: Array<{ directiveId: string; name: string; change: number }> = [];

    // Handle both array and object breakdown formats
    const flatten = (b: any): Map<string, { name: string; score: number }> => {
      const map = new Map<string, { name: string; score: number }>();
      if (Array.isArray(b)) {
        for (const d of b) map.set(d.directiveId || d.id, { name: d.name || d.directiveId, score: d.score ?? 0 });
      } else if (typeof b === 'object') {
        for (const [groupId, directives] of Object.entries(b)) {
          if (Array.isArray(directives)) {
            for (const d of directives as any[]) {
              map.set(d.directiveId, { name: d.name || d.directiveId, score: d.score ?? 0 });
            }
          }
        }
      }
      return map;
    };

    const oldMap = flatten(oldBreakdown);
    const newMap = flatten(newBreakdown);

    for (const [id, curr] of newMap) {
      const prev = oldMap.get(id);
      if (prev) {
        const change = curr.score - prev.score;
        if (Math.abs(change) >= 0.5) {
          drift.push({ directiveId: id, name: curr.name, change: Math.round(change * 10) / 10 });
        }
      }
    }

    return drift.sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, 5);
  }

  private classify(
    velocity: number, acceleration: number, volatility: number, currentScore: number,
  ): { signal: ScoreVelocity['signal']; signalLabel: string } {
    if (velocity > 50 && currentScore > 40) return { signal: 'surge', signalLabel: 'Score Surge — conviction building fast' };
    if (velocity < -50) return { signal: 'collapse', signalLabel: 'Score Collapse — thesis breaking down' };
    if (acceleration < 0 && velocity > 0) return { signal: 'fading', signalLabel: 'Fading Momentum — score still rising but slowing' };
    if (volatility > 20) return { signal: 'indecision', signalLabel: 'Indecision — high score volatility, choppy market' };
    if (Math.abs(velocity) < 5 && volatility < 5) return { signal: 'steady', signalLabel: 'Steady — stable conviction, no change' };
    return { signal: 'steady', signalLabel: 'Neutral momentum' };
  }

  private empty(symbol: string, reason: string): ScoreVelocity {
    return {
      symbol, currentScore: 0, velocityPtsPerHour: 0, acceleration: 0,
      volatility: 0, sampleCount: 0, windowMinutes: 0, directiveDrift: [],
      signal: 'insufficient_data', signalLabel: reason,
    };
  }
}
