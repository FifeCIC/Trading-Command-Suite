/**
 * DirectiveImpactService — #283 Directive Performance Audit
 * ==========================================================
 * Analyzes Score table snapshots to rank directives by real-world impact.
 *
 * ── Impact Score Formula ──────────────────────────────────
 * Impact = avgContribution × volatility
 *
 * A directive that consistently scores high AND moves with the market gets
 * a high impact score. One that scores high but never moves (stale) gets zero.
 *
 * ── Tier Thresholds ──────────────────────────────────────
 * Heavyweight  ≥ 500  — dominant market movers (ideal for protocol building)
 * Mover        100–499 — significant contributors
 * Steady       20–99   — consistent background signal
 * Lightweight  < 20    — negligible contribution
 *
 * ── Data Source ──────────────────────────────────────────
 * Reads Score.breakdown JSON (per-directive scores) from the last N snapshots.
 * The breakdown is written by ProtocolGatingService.scoreWithGating().
 *
 * ── Use Case ─────────────────────────────────────────────
 * Identify heavyweight directives to group into protocols for amplified
 * signal swings. The endpoint also suggests "top protocol candidates."
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

export interface DirectiveImpact {
  directiveId: string;
  name: string;
  readiness: string;
  /** Average score contribution across the window */
  avgContribution: number;
  /** Maximum score contribution seen */
  maxContribution: number;
  /** Standard deviation of contribution — how much it moves */
  volatility: number;
  /** % of snapshots where this directive scored > 0 */
  hitRate: number;
  /** Slope of contribution over time (positive = growing influence) */
  trend: number;
  /** Composite impact score: avg × volatility — combines magnitude + movement */
  impactScore: number;
  /** Category based on impact score */
  tier: 'heavyweight' | 'mover' | 'steady' | 'lightweight';
}

export interface DirectiveImpactReport {
  symbol: string;
  sampleCount: number;
  windowMinutes: number;
  generatedAt: string;
  directives: DirectiveImpact[];
  summary: {
    heavyweightCount: number;
    moverCount: number;
    steadyCount: number;
    lightweightCount: number;
    topProtocolCandidates: Array<{ directiveId: string; name: string; impactScore: number }>;
  };
}

@Injectable()
export class DirectiveImpactService {
  private readonly logger = new Logger(DirectiveImpactService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getImpactReport(symbol: string, windowSize = 10): Promise<DirectiveImpactReport> {
    if (!this.prisma.isAvailable) {
      return this.emptyReport(symbol, 'Database unavailable');
    }

    const sym = await this.prisma.symbol.findFirst({ where: { ticker: symbol } });
    if (!sym) return this.emptyReport(symbol, 'Symbol not found');

    const rows = await this.prisma.score.findMany({
      where: { symbolId: sym.id },
      orderBy: { timestamp: 'desc' },
      take: windowSize,
    });

    if (rows.length < 3) return this.emptyReport(symbol, `Need ≥3 snapshots, have ${rows.length}`);

    const sorted = [...rows].reverse(); // oldest→newest
    const timeSpanMinutes =
      ((sorted[sorted.length - 1].timestamp.getTime() - sorted[0].timestamp.getTime()) / 60000);

    // ── Aggregate per-directive stats ──────────────────────
    const directiveMap = new Map<string, {
      name: string;
      contributions: number[];
      readiness: string;
    }>();

    for (const row of sorted) {
      const flat = this.flattenBreakdown(row.breakdown as any);
      for (const [id, info] of flat) {
        let entry = directiveMap.get(id);
        if (!entry) {
          entry = { name: info.name, contributions: [], readiness: info.readiness || 'ready' };
          directiveMap.set(id, entry);
        }
        entry.contributions.push(info.score);
        if (info.readiness) entry.readiness = info.readiness;
      }
    }

    // ── Compute impact metrics ─────────────────────────────
    const directives: DirectiveImpact[] = [];

    for (const [id, entry] of directiveMap) {
      const contribs = entry.contributions;
      if (contribs.length < 2) continue;

      const sum = contribs.reduce((a, b) => a + b, 0);
      const avg = sum / contribs.length;
      const max = Math.max(...contribs);
      const nonZero = contribs.filter(c => c > 0).length;
      const hitRate = nonZero / contribs.length;

      // Volatility: stddev
      const variance = contribs.reduce((s, c) => s + (c - avg) ** 2, 0) / contribs.length;
      const volatility = Math.sqrt(variance);

      // Trend: simple linear regression slope
      const n = contribs.length;
      const xMean = (n - 1) / 2;
      const yMean = avg;
      let num = 0;
      let den = 0;
      for (let i = 0; i < n; i++) {
        num += (i - xMean) * (contribs[i] - yMean);
        den += (i - xMean) ** 2;
      }
      const trend = den !== 0 ? num / den : 0;

      // Impact score: avg × volatility — magnitude × movement
      const impactScore = Math.round(avg * volatility * 10) / 10;

      // Tier classification
      let tier: DirectiveImpact['tier'];
      if (impactScore >= 500) tier = 'heavyweight';
      else if (impactScore >= 100) tier = 'mover';
      else if (impactScore >= 20) tier = 'steady';
      else tier = 'lightweight';

      directives.push({
        directiveId: id,
        name: entry.name,
        readiness: entry.readiness,
        avgContribution: Math.round(avg * 10) / 10,
        maxContribution: Math.round(max * 10) / 10,
        volatility: Math.round(volatility * 10) / 10,
        hitRate: Math.round(hitRate * 100),
        trend: Math.round(trend * 1000) / 1000,
        impactScore,
        tier,
      });
    }

    // Sort by impact score descending
    directives.sort((a, b) => b.impactScore - a.impactScore);

    // ── Summary ────────────────────────────────────────────
    const tiers = {
      heavyweightCount: directives.filter(d => d.tier === 'heavyweight').length,
      moverCount: directives.filter(d => d.tier === 'mover').length,
      steadyCount: directives.filter(d => d.tier === 'steady').length,
      lightweightCount: directives.filter(d => d.tier === 'lightweight').length,
      topProtocolCandidates: directives
        .filter(d => d.tier === 'heavyweight' || d.tier === 'mover')
        .slice(0, 8)
        .map(d => ({ directiveId: d.directiveId, name: d.name, impactScore: d.impactScore })),
    };

    return {
      symbol,
      sampleCount: sorted.length,
      windowMinutes: Math.round(timeSpanMinutes),
      generatedAt: new Date().toISOString(),
      directives,
      summary: tiers,
    };
  }

  // ── Helpers ──────────────────────────────────────────────

  private flattenBreakdown(breakdown: any): Map<string, { name: string; score: number; readiness?: string }> {
    const map = new Map<string, { name: string; score: number; readiness?: string }>();
    if (!breakdown) return map;

    if (Array.isArray(breakdown)) {
      for (const d of breakdown) {
        map.set(d.directiveId || d.id, {
          name: d.name || d.directiveId,
          score: d.score ?? 0,
          readiness: d.readiness,
        });
      }
    } else if (typeof breakdown === 'object') {
      for (const [, directives] of Object.entries(breakdown)) {
        if (Array.isArray(directives)) {
          for (const d of directives as any[]) {
            map.set(d.directiveId || d.id, {
              name: d.name || d.directiveId,
              score: d.score ?? 0,
              readiness: d.readiness,
            });
          }
        }
      }
    }
    return map;
  }

  private emptyReport(symbol: string, reason: string): DirectiveImpactReport {
    return {
      symbol,
      sampleCount: 0,
      windowMinutes: 0,
      generatedAt: new Date().toISOString(),
      directives: [],
      summary: {
        heavyweightCount: 0, moverCount: 0, steadyCount: 0, lightweightCount: 0,
        topProtocolCandidates: [],
      },
    };
  }
}
