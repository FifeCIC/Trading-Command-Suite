import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class PlannerService {
  private readonly logger = new Logger(PlannerService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Fund Allocations ────────────────────────────────────

  async getFundAllocations() {
    return this.prisma.fundAllocation.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async createFundAllocation(data: {
    name: string;
    amount: number;
    currency?: string;
    source?: string;
    notes?: string;
    allocations?: any[];
  }) {
    return this.prisma.fundAllocation.create({
      data: {
        name: data.name,
        amount: data.amount,
        currency: data.currency ?? 'GBP',
        source: data.source ?? 'earnings',
        notes: data.notes ?? null,
        allocations: data.allocations ?? [],
      },
    });
  }

  async updateFundAllocation(id: string, data: any) {
    return this.prisma.fundAllocation.update({ where: { id }, data });
  }

  async deleteFundAllocation(id: string) {
    return this.prisma.fundAllocation.delete({ where: { id } });
  }

  // ── Trading Style Preferences ───────────────────────────

  async getTradingStyles() {
    return this.prisma.tradingStylePreference.findMany({
      orderBy: { sortOrder: 'asc' },
    });
  }

  async toggleTradingStyle(styleKey: string, enabled: boolean) {
    return this.prisma.tradingStylePreference.update({
      where: { styleKey },
      data: { enabled },
    });
  }

  async updateStylePreferences(styleKey: string, preferences: any) {
    return this.prisma.tradingStylePreference.update({
      where: { styleKey },
      data: { preferences },
    });
  }

  async seedDefaultStyles() {
    const defaults = [
      { styleKey: 'speed-trading', label: 'Xtrend Speed Trading', description: 'Fast-paced short-term trading on MT5 using the Speed protocol', category: 'active', sortOrder: 1 },
      { styleKey: 'stocks-portfolio', label: 'Stocks Portfolio', description: 'Long-term equity portfolio management via Trading212', category: 'portfolio', sortOrder: 2 },
      { styleKey: 'cfd-trading', label: 'CFD Trading', description: 'Contract-for-difference trading with leverage via MT5', category: 'active', sortOrder: 3 },
      { styleKey: 'swing-trading', label: 'Swing Trading', description: 'Multi-day position holds capturing trend swings', category: 'active', sortOrder: 4 },
      { styleKey: 'day-trading', label: 'Day Trading', description: 'Intraday positions closed before market close', category: 'active', sortOrder: 5 },
      { styleKey: 'scalping', label: 'Scalping', description: 'Ultra-short-term trades targeting small price movements', category: 'active', sortOrder: 6 },
      { styleKey: 'position-trading', label: 'Position Trading', description: 'Long-term macro-driven positions held weeks to months', category: 'portfolio', sortOrder: 7 },
      { styleKey: 'crypto-trading', label: 'Crypto Trading', description: 'Digital asset trading on supported exchanges', category: 'specialty', sortOrder: 8 },
      { styleKey: 'options-trading', label: 'Options Trading', description: 'Options strategies including covered calls and spreads', category: 'specialty', sortOrder: 9 },
      { styleKey: 'automated-trading', label: 'Automated Trading', description: 'Algorithm-driven execution via the automation loop', category: 'automation', sortOrder: 10 },
    ];

    let seeded = 0;
    for (const style of defaults) {
      const existing = await this.prisma.tradingStylePreference.findUnique({ where: { styleKey: style.styleKey } });
      if (!existing) {
        await this.prisma.tradingStylePreference.create({ data: style });
        seeded++;
      }
    }
    return { seeded, total: defaults.length };
  }

  // ── Trading Objectives ──────────────────────────────────

  async getObjectives(status?: string) {
    const where: any = {};
    if (status) where.status = status;
    return this.prisma.tradingObjective.findMany({
      where,
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async createObjective(data: {
    title: string;
    description?: string;
    category: string;
    targetAmount?: number;
    currentAmount?: number;
    currency?: string;
    targetDate?: string;
    linkedStrategy?: string;
    linkedAccount?: string;
    notes?: string;
  }) {
    return this.prisma.tradingObjective.create({
      data: {
        title: data.title,
        description: data.description ?? null,
        category: data.category,
        targetAmount: data.targetAmount ?? null,
        currentAmount: data.currentAmount ?? 0,
        currency: data.currency ?? 'GBP',
        targetDate: data.targetDate ? new Date(data.targetDate) : null,
        linkedStrategy: data.linkedStrategy ?? null,
        linkedAccount: data.linkedAccount ?? null,
        notes: data.notes ?? null,
        progressPct: data.targetAmount && data.currentAmount
          ? Math.round((data.currentAmount / data.targetAmount) * 100)
          : 0,
      },
    });
  }

  async updateObjective(id: string, data: any) {
    if (data.currentAmount != null && data.targetAmount != null && data.targetAmount > 0) {
      data.progressPct = Math.round((data.currentAmount / data.targetAmount) * 100);
    }
    return this.prisma.tradingObjective.update({ where: { id }, data });
  }

  async deleteObjective(id: string) {
    return this.prisma.tradingObjective.delete({ where: { id } });
  }

  async seedBuiltInObjectives() {
    const defaults = [
      {
        title: 'Active MT5 Trading',
        description: 'Get TCS actively trading via MT5 with the automation loop running live strategies',
        category: 'active-trading',
        targetAmount: null,
        currentAmount: 0,
        currency: 'GBP',
        linkedStrategy: 'MT5 Automation Loop',
        linkedAccount: 'MT5',
        notes: 'Core objective: have the automation loop executing real trades on MT5 with risk management active',
      },
      {
        title: 'Grow Xtrend Account: £59 → £500',
        description: 'Turn the £59 starting balance in the Xtrend account into £500 using speed trading strategies',
        category: 'account-growth',
        targetAmount: 500,
        currentAmount: 59,
        currency: 'GBP',
        linkedStrategy: 'Speed Trading',
        linkedAccount: 'Xtrend',
        notes: 'Use the Speed protocol with tight risk management. Target: 8.5x growth.',
      },
      {
        title: 'Fix T212 Portfolio Slow Growth',
        description: 'Get the Trading212 portfolio out of slow-growth mode by identifying underperformers and reallocating',
        category: 'portfolio-recovery',
        targetAmount: null,
        currentAmount: 0,
        currency: 'GBP',
        linkedStrategy: 'Portfolio Optimization',
        linkedAccount: 'Trading212',
        notes: 'Cross-reference SEES scores with current holdings. Identify positions to trim and sectors to increase.',
      },
      {
        title: 'Build to £10,000 Trading Capital',
        description: 'Long-term goal: accumulate £10,000 in total trading capital across all accounts',
        category: 'long-term',
        targetAmount: 10000,
        currentAmount: 0,
        currency: 'GBP',
        linkedStrategy: null,
        linkedAccount: null,
        notes: 'Compound growth across MT5, T212, and Xtrend. Track total equity monthly.',
      },
    ];

    let seeded = 0;
    for (const obj of defaults) {
      const existing = await this.prisma.tradingObjective.findFirst({
        where: { title: obj.title, isBuiltIn: true },
      });
      if (!existing) {
        await this.prisma.tradingObjective.create({
          data: {
            ...obj,
            isBuiltIn: true,
            status: 'active',
            targetDate: obj.category === 'long-term' ? new Date('2028-01-01') : null,
          },
        });
        seeded++;
      }
    }
    return { seeded, total: defaults.length };
  }
}
