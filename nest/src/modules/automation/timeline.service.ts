/**
 * TimelineService — event-aware decision engine for the automation loop.
 *
 * Provides:
 *  - getActiveEvents() — all events active now + within lookahead window
 *  - getSymbolEvents() — events relevant to a specific symbol
 *  - computeRiskMultiplier() — aggregate risk from active events
 *
 * Event sources:
 *  1. Economic calendar — from DB (user-configured) + hardcoded recurring events
 *  2. Earnings — from Finnhub/Polygon adapter when available
 *  3. Session windows — computed from current UTC time
 *  4. Seasonality — from SeasonalityService (hour×day win rates)
 *  5. Protocol windows — from protocol definitions (ideal trading hours)
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { SeasonalityService } from '../scoring/seasonality.service';
import { AdapterFactory } from '../providers/adapter-factory';
import { MarketSessionsService, type SessionTimelineEvent } from '../calendar/market-sessions.service';

export interface RiskEvent {
  id: string;
  type: string;
  scope: 'global' | 'broker' | 'symbol' | 'session' | 'protocol';
  brokerId?: string;
  symbol?: string;
  session?: string;
  protocolId?: string;
  action: 'block' | 'gate' | 'boost' | 'reduce' | 'info';
  riskMultiplier?: number;
  thresholdAdjust?: number;
  label: string;
  description?: string;
  icon?: string;
  color?: string;
  startsAt: string;
  endsAt?: string;
  durationMin?: number;
  source: 'system' | 'calendar' | 'earnings' | 'seasonality' | 'protocol';
  createdAt: string;
  data?: Record<string, any>;
}

@Injectable()
export class EventRiskService {
  private readonly logger = new Logger(EventRiskService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly seasonalityService: SeasonalityService,
    private readonly adapterFactory: AdapterFactory,
    private readonly marketSessions: MarketSessionsService,
  ) {}

  // ── Main API ──────────────────────────────────────────

  async getActiveEvents(lookaheadMinutes = 120): Promise<RiskEvent[]> {
    const now = new Date();
    const lookahead = new Date(now.getTime() + lookaheadMinutes * 60000);
    const pastWindow = new Date(now.getTime() - 120 * 60000);

    const events: RiskEvent[] = [];

    // 1. DB-stored events (economic calendar, custom events)
    events.push(...await this.getDbEvents(now, lookahead));

    // 2. Earnings from provider adapters
    events.push(...await this.getEarningsEvents(now, lookahead));

    // 3. Session windows
    events.push(...this.getSessionEvents(now, lookahead));

    // 4. Seasonality (current hour only — computed on demand per symbol)
    // Done per-symbol in getSymbolEvents()

    // 5. Hardcoded recurring economic events
    events.push(...this.getRecurringEconomicEvents(now, lookahead));

    return events.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }

  async getSymbolEvents(symbol: string, lookaheadHours = 48): Promise<RiskEvent[]> {
    const all = await this.getActiveEvents(lookaheadHours * 60);
    const relevant = all.filter(e =>
      e.scope === 'global' ||
      (e.scope === 'symbol' && e.symbol === symbol)
    );

    // Add seasonality for this symbol
    try {
      const seasonEvents = await this.getSeasonalityEvents(symbol);
      relevant.push(...seasonEvents);
    } catch { /* seasonality fetch may fail if MT5 bridge is down */ }

    return relevant;
  }

  computeRiskMultiplier(events: RiskEvent[]): number {
    let multiplier = 1.0;
    for (const event of events) {
      if (event.action === 'block') return 0;
      if (event.action === 'gate' || event.action === 'reduce') {
        multiplier *= (event.riskMultiplier ?? 0.5);
      }
      if (event.action === 'boost') {
        multiplier *= (event.riskMultiplier ?? 1.2);
      }
    }
    return Math.max(0, Math.min(2, multiplier));
  }

  // ── Event Sources ─────────────────────────────────────

  private async getDbEvents(now: Date, lookahead: Date): Promise<RiskEvent[]> {
    if (!this.prisma.isAvailable) return [];
    try {
      const rows = await (this.prisma as any).timelineEvent.findMany({
        where: {
          startsAt: { gte: now, lte: lookahead },
        },
        orderBy: { startsAt: 'asc' },
      });
      return rows.map((e: any) => ({
        id: e.id,
        type: e.type,
        scope: e.scope,
        brokerId: e.brokerId ?? undefined,
        symbol: e.symbol ?? undefined,
        session: e.session ?? undefined,
        protocolId: e.protocolId ?? undefined,
        action: e.action,
        riskMultiplier: e.riskMultiplier ?? undefined,
        thresholdAdjust: e.thresholdAdjust ?? undefined,
        label: e.label,
        description: e.description ?? undefined,
        icon: e.icon ?? undefined,
        color: e.color ?? undefined,
        startsAt: e.startsAt instanceof Date ? e.startsAt.toISOString() : String(e.startsAt),
        endsAt: e.endsAt instanceof Date ? e.endsAt.toISOString() : e.endsAt ?? undefined,
        durationMin: e.durationMin ?? undefined,
        source: e.source,
        createdAt: e.createdAt instanceof Date ? e.createdAt.toISOString() : String(e.createdAt),
        data: e.metadata ?? undefined,
      }));
    } catch (err) {
      this.logger.warn(`Failed to load DB timeline events: ${(err as Error).message}`);
      return [];
    }
  }

  private async getEarningsEvents(now: Date, lookahead: Date): Promise<RiskEvent[]> {
    const finnhub = this.adapterFactory.create('finnhub');
    if (!finnhub?.getEarningsCalendar) return [];

    try {
      const earnings = await finnhub.getEarningsCalendar(undefined, 1);
      return (earnings || [])
        .filter((e: any) => {
          const date = new Date(e.date || e.reportDate);
          return date >= now && date <= lookahead;
        })
        .map((e: any) => ({
          id: `earnings-${e.symbol}-${e.date || e.reportDate}`,
          type: 'EARNINGS',
          scope: 'symbol' as const,
          symbol: e.symbol,
          action: 'block' as const,
          label: `${e.symbol} earnings`,
          description: `Earnings report for ${e.symbol}${e.epsEstimate != null ? ` (est. EPS $${e.epsEstimate})` : ''}`,
          icon: '📊',
          color: '#e74c3c',
          startsAt: new Date(e.date || e.reportDate).toISOString(),
          source: 'earnings' as const,
          createdAt: new Date().toISOString(),
          data: e,
        }));
    } catch {
      return [];
    }
  }

  private getSessionEvents(now: Date, lookahead: Date): RiskEvent[] {
    // Session windows now come from the canonical DST-aware MarketSessionsService.
    // This replaces the old hardcoded-UTC session logic (NY was pinned to 13:00 UTC,
    // 30min early in EDT; DST was ignored). All session state is derived from the
    // session's own IANA timezone, so it stays correct year-round.
    const lookaheadMinutes = Math.round((lookahead.getTime() - now.getTime()) / 60000);
    const sessionEvents: SessionTimelineEvent[] =
      this.marketSessions.getTimelineEvents(now, Math.max(0, lookaheadMinutes));

    return sessionEvents.map((e) => {
      const ev: RiskEvent = {
        id: e.id,
        type: e.type,
        scope: 'session',
        session: e.session,
        action: e.action,
        riskMultiplier: e.riskMultiplier,
        thresholdAdjust: e.thresholdAdjust,
        label: e.label,
        description: e.description,
        icon: e.icon,
        color: e.color,
        startsAt: e.startsAt,
        endsAt: e.endsAt,
        source: 'system',
        createdAt: e.createdAt,
      };
      return ev;
    });
  }

  private async getSeasonalityEvents(symbol: string): Promise<RiskEvent[]> {
    try {
      const result = await this.seasonalityService.compute(symbol);
      const now = new Date();
      const day = now.getUTCDay();
      const hour = now.getUTCHours();
      const bullishPct = result.heatmap[day]?.[hour] ?? 0;
      const samples = result.samples[day]?.[hour] ?? 0;

      if (samples < 5) return []; // Not enough data

      const events: RiskEvent[] = [];
      if (bullishPct >= 0.60) {
        events.push({
          id: `season-${symbol}-bullish`,
          type: 'BULLISH_HOUR',
          scope: 'symbol',
          symbol,
          action: 'boost',
          riskMultiplier: 1.1,
          thresholdAdjust: -5,
          label: `${symbol} bullish hour (${(bullishPct * 100).toFixed(0)}%)`,
          description: `${samples} samples this hour/day — historically closes above open ${(bullishPct * 100).toFixed(0)}% of the time`,
          icon: '📈',
          color: '#22c55e',
          startsAt: now.toISOString(),
          endsAt: new Date(now.getTime() + 3600000).toISOString(),
          source: 'seasonality',
          createdAt: new Date().toISOString(),
          data: { bullishPct, samples, day, hour },
        });
      } else if (bullishPct <= 0.40) {
        events.push({
          id: `season-${symbol}-bearish`,
          type: 'BEARISH_HOUR',
          scope: 'symbol',
          symbol,
          action: 'reduce',
          riskMultiplier: 0.85,
          thresholdAdjust: 10,
          label: `${symbol} bearish hour (${(bullishPct * 100).toFixed(0)}%)`,
          description: `${samples} samples this hour/day — historically closes above open only ${(bullishPct * 100).toFixed(0)}% of the time`,
          icon: '📉',
          color: '#ef4444',
          startsAt: now.toISOString(),
          endsAt: new Date(now.getTime() + 3600000).toISOString(),
          source: 'seasonality',
          createdAt: new Date().toISOString(),
          data: { bullishPct, samples, day, hour },
        });
      }
      return events;
    } catch {
      return [];
    }
  }

  // ── Recurring Economic Events ─────────────────────────

  private getRecurringEconomicEvents(now: Date, lookahead: Date): RiskEvent[] {
    const events: RiskEvent[] = [];

    // NFP: first Friday of each month at 13:30 UTC
    const nfpDate = this.getFirstFriday(now.getUTCFullYear(), now.getUTCMonth() + 1);
    if (this.isSameDay(nfpDate, now) && now.getUTCHours() < 14) {
      events.push(this.makeEconomicEvent('NFP', 'Non-Farm Payrolls', 0.3, 20, '👷', nfpDate));
    }

    // FOMC: roughly every 6 weeks — simplistic check (actual schedule varies)
    const fomcDates = this.getFomcDates(now.getUTCFullYear());
    for (const fomcDate of fomcDates) {
      if (fomcDate >= now && fomcDate <= lookahead) {
        events.push(this.makeEconomicEvent('FOMC', 'FOMC Interest Rate Decision', 0.5, 15, '🏛️', fomcDate));
      }
    }

    return events;
  }

  private makeEconomicEvent(
    type: string, label: string, riskMultiplier: number,
    thresholdAdjust: number, icon: string, date: Date,
  ): RiskEvent {
    const start = new Date(date);
    start.setUTCHours(13, 30, 0, 0);
    const end = new Date(start.getTime() + 2 * 3600000);
    return {
      id: `econ-${type}-${start.toISOString().split('T')[0]}`,
      type,
      scope: 'global',
      action: 'reduce',
      riskMultiplier,
      thresholdAdjust,
      label,
      description: `${label} at 13:30 UTC — elevated volatility expected`,
      icon,
      color: '#e74c3c',
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      source: 'calendar',
      createdAt: new Date().toISOString(),
    };
  }

  private getFirstFriday(year: number, month: number): Date {
    const first = new Date(Date.UTC(year, month - 1, 1));
    const dayOfWeek = first.getUTCDay();
    const daysUntilFriday = (5 - dayOfWeek + 7) % 7;
    return new Date(Date.UTC(year, month - 1, 1 + daysUntilFriday));
  }

  private isSameDay(a: Date, b: Date): boolean {
    return a.getUTCFullYear() === b.getUTCFullYear() &&
      a.getUTCMonth() === b.getUTCMonth() &&
      a.getUTCDate() === b.getUTCDate();
  }

  private getFomcDates(year: number): Date[] {
    // Approximate FOMC schedule — 8 meetings per year, roughly every 6-7 weeks
    const schedules: Record<number, number[][]> = {
      2026: [[1, 28], [3, 18], [5, 6], [6, 17], [7, 29], [9, 16], [11, 4], [12, 16]],
      2027: [[1, 27], [3, 17], [5, 5], [6, 16], [7, 28], [9, 15], [11, 3], [12, 15]],
    };
    const dates = schedules[year] || [];
    return dates.map(([month, day]) => new Date(Date.UTC(year, month - 1, day)));
  }
}
