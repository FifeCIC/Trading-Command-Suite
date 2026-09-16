import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

export interface AiUsageStats {
  totalCost: number;
  totalCalls: number;
  totalTokens: number;
}

export interface AiFeatureBreakdown {
  [feature: string]: { cost: number; calls: number; tokens: number };
}

@Injectable()
export class AiUsageService {
  private readonly logger = new Logger(AiUsageService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Aggregate usage for a time period (today, week, month).
   * Returns zero values when no data exists — graceful degradation.
   */
  async getUsage(period: 'today' | 'week' | 'month' = 'today'): Promise<AiUsageStats> {
    try {
      const since = this.periodStart(period);
      const rows = await this.prisma.$queryRawUnsafe<Array<{ cost: number; tokensIn: number; tokensOut: number }>>(
        `SELECT COALESCE(SUM(cost), 0) as cost, COALESCE(SUM(tokensIn), 0) as tokensIn, COALESCE(SUM(tokensOut), 0) as tokensOut, COUNT(*) as cnt FROM ai_api_call WHERE createdAt >= ?`,
        since,
      );
      const r = rows[0] as any;
      return {
        totalCost: +((r?.cost || 0) as number).toFixed(6),
        totalCalls: Number(r?.cnt || 0),
        totalTokens: Number(r?.tokensIn || 0) + Number(r?.tokensOut || 0),
      };
    } catch {
      return { totalCost: 0, totalCalls: 0, totalTokens: 0 };
    }
  }

  /**
   * Cost breakdown by feature (briefing, analysis, explain, sentiment).
   */
  async getBreakdown(period: 'today' | 'week' | 'month' = 'today'): Promise<AiFeatureBreakdown> {
    try {
      const since = this.periodStart(period);
      const rows = await this.prisma.$queryRawUnsafe<Array<{ feature: string; cost: number; tokensIn: number; tokensOut: number }>>(
        `SELECT feature, cost, tokensIn, tokensOut FROM ai_api_call WHERE createdAt >= ?`,
        since,
      );

      const breakdown: AiFeatureBreakdown = {};
      for (const c of rows) {
        const f = c.feature || 'general';
        if (!breakdown[f]) breakdown[f] = { cost: 0, calls: 0, tokens: 0 };
        breakdown[f].cost += c.cost || 0;
        breakdown[f].calls += 1;
        breakdown[f].tokens += (c.tokensIn || 0) + (c.tokensOut || 0);
      }

      for (const k of Object.keys(breakdown)) {
        breakdown[k].cost = +breakdown[k].cost.toFixed(6);
      }

      return breakdown;
    } catch {
      return {};
    }
  }

  /**
   * Log an AI API call for later cost tracking.
   * Fire-and-forget — never throws.
   */
  async logCall(params: {
    feature?: string;
    model: string;
    tokensIn: number;
    tokensOut: number;
    cost?: number;
    durationMs?: number;
    success: boolean;
    error?: string;
  }) {
    try {
      const cost =
        params.cost ??
        (params.tokensIn / 1_000_000) * 0.14 +
        (params.tokensOut / 1_000_000) * 0.28;

      const id = crypto.randomUUID();
      await this.prisma.$executeRawUnsafe(
        `INSERT INTO ai_api_call (id, feature, model, tokensIn, tokensOut, cost, durationMs, success, error, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
        id,
        params.feature || 'general',
        params.model,
        params.tokensIn,
        params.tokensOut,
        +cost.toFixed(8),
        params.durationMs ?? null,
        params.success,
        params.error ?? null,
      );
    } catch (err) {
      this.logger.warn(`Failed to log AI call: ${(err as Error).message}`);
    }
  }

  private periodStart(period: 'today' | 'week' | 'month'): Date {
    const now = new Date();
    switch (period) {
      case 'today':
        return new Date(now.getFullYear(), now.getMonth(), now.getDate());
      case 'week':
        const d = new Date(now);
        d.setDate(d.getDate() - 7);
        return d;
      case 'month':
        return new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
    }
  }
}
