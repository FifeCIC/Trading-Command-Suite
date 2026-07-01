import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class InvestigationService {
  private readonly logger = new Logger(InvestigationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async investigate(symbol: string, trigger: string) {
    this.logger.log(`Investigating ${symbol} (trigger: ${trigger})`);

    // Gather available data — use existing API endpoints
    const price = 0; // Will be populated from live quote on next refresh
    const findings: any[] = [];

    // Store investigation
    const investigation = await this.prisma.stockInvestigation.create({
      data: {
        symbol: symbol.toUpperCase(),
        trigger,
        priceAtTime: price,
        keyFindings: findings,
        summary: `Investigation opened for ${symbol.toUpperCase()} — triggered by ${trigger}. Awaiting data collection.`,
        actionItems: [],
        newsCount: 0,
        sources: [],
        status: 'open',
      },
    });

    this.logger.log(`Investigation ${investigation.id} created for ${symbol}`);
    return investigation;
  }

  async findAll(symbol?: string, limit = 20) {
    const where: any = {};
    if (symbol) where.symbol = symbol.toUpperCase();
    return this.prisma.stockInvestigation.findMany({
      where,
      orderBy: { investigatedAt: 'desc' },
      take: limit,
    });
  }

  async findOne(id: string) {
    return this.prisma.stockInvestigation.findUnique({ where: { id } });
  }

  async updateStatus(id: string, status: string, outcome?: string) {
    return this.prisma.stockInvestigation.update({
      where: { id },
      data: {
        status,
        ...(outcome ? { outcome } : {}),
        ...(status === 'closed' ? { followedUpAt: new Date() } : {}),
      },
    });
  }

  async deleteStale(daysOld = 30) {
    const cutoff = new Date(Date.now() - daysOld * 86400000);
    const result = await this.prisma.stockInvestigation.deleteMany({
      where: {
        status: 'open',
        investigatedAt: { lt: cutoff },
      },
    });
    this.logger.log(`Cleaned ${result.count} stale investigations`);
    return result;
  }
}
