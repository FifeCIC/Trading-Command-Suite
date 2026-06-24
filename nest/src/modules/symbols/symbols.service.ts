import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, Symbol } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ModeService } from '../../config/mode.service';
import { CreateSymbolDto } from './dto/create-symbol.dto';
import { UpdateSymbolDto } from './dto/update-symbol.dto';

@Injectable()
export class SymbolsService {
  private readonly logger = new Logger(SymbolsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly modeService: ModeService,
  ) {}

  async create(dto: CreateSymbolDto): Promise<Symbol> {
    if (!this.prisma.isAvailable) {
      throw new Error(
        'Database is not available. Cannot create symbol in fallback mode.',
      );
    }

    const data: Prisma.SymbolCreateInput = {
      ticker: dto.ticker.toUpperCase(),
      name: dto.name,
      exchange: dto.exchange,
      type: dto.type,
      tags: dto.tags ?? [],
      aliases: dto.aliases ?? {},
      active: true,
    };

    return this.prisma.symbol.create({ data });
  }

  async findAll(): Promise<Symbol[]> {
    if (!this.prisma.isAvailable) {
      this.logger.warn('Database unavailable — returning empty symbol list.');
      return [];
    }

    try {
      return await this.prisma.symbol.findMany({
        orderBy: [{ ticker: 'asc' }],
      });
    } catch (error) {
      this.logger.warn(
        `Database unavailable while listing symbols: ${String(error)}`,
      );
      return [];
    }
  }

  /** Find symbols that have a specific tag in their JSON tags array. */
  async findByTag(tag: string): Promise<Symbol[]> {
    if (!this.prisma.isAvailable) return [];

    // MySQL JSON_CONTAINS: check if tags array contains the given tag string
    const symbols = await this.prisma.$queryRawUnsafe<Symbol[]>(
      `SELECT * FROM Symbol WHERE JSON_CONTAINS(tags, ?) ORDER BY ticker ASC`,
      JSON.stringify(tag),
    );
    return symbols;
  }

  async findOne(id: string): Promise<Symbol> {
    if (!this.prisma.isAvailable) {
      throw new Error(
        'Database is not available. Cannot retrieve symbol in fallback mode.',
      );
    }

    const symbol = await this.prisma.symbol.findUnique({ where: { id } });
    if (!symbol) {
      throw new NotFoundException(`Symbol ${id} not found`);
    }

    return symbol;
  }

  async update(id: string, dto: UpdateSymbolDto): Promise<Symbol> {
    if (!this.prisma.isAvailable) {
      throw new Error(
        'Database is not available. Cannot update symbol in fallback mode.',
      );
    }

    await this.findOne(id);

    const data: Prisma.SymbolUpdateInput = {
      ...(dto.ticker ? { ticker: dto.ticker.toUpperCase() } : {}),
      ...(dto.name ? { name: dto.name } : {}),
      ...(dto.exchange ? { exchange: dto.exchange } : {}),
      ...(dto.type ? { type: dto.type } : {}),
      ...(dto.tags !== undefined ? { tags: dto.tags } : {}),
      ...(dto.aliases !== undefined ? { aliases: dto.aliases } : {}),
    };

    return this.prisma.symbol.update({
      where: { id },
      data,
    });
  }

  async setActive(id: string, active: boolean): Promise<Symbol> {
    if (!this.prisma.isAvailable) {
      throw new Error(
        'Database is not available. Cannot update symbol in fallback mode.',
      );
    }

    await this.findOne(id);

    return this.prisma.symbol.update({
      where: { id },
      data: { active },
    });
  }

  async getOverview(ticker: string) {
    const upperTicker = ticker.toUpperCase();

    // Find symbol
    const symbol = await this.prisma.symbol.findFirst({
      where: { ticker: upperTicker },
    });
    if (!symbol) throw new NotFoundException(`Symbol ${upperTicker} not found`);

    // Latest quote (if available)
    let price = null;
    try {
      const marketBar = await (this.prisma as any).marketBar.findFirst({
        where: { symbolId: symbol.id },
        orderBy: { timestamp: 'desc' },
      });
      if (marketBar) {
        price = {
          last: Number(marketBar.close),
          change: 0,
          changePct: 0,
          provider: 'finnhub',
          timestamp: marketBar.timestamp?.toISOString() || null,
        };
      }
    } catch { /* no market data */ }

    // Positions
    let positions: any[] = [];
    try {
      const allPositions = await (this.prisma as any).position.findMany();
      positions = allPositions.filter((p: any) =>
        p.symbolId === symbol.id || p.symbolTicker === upperTicker
      );
    } catch { /* no positions */ }

    // Freshness
    const freshness = {
      status: price ? 'fresh' : 'stale',
      lastBar: price?.timestamp || null,
      timeframe: '1h',
    };

    return {
      symbol: {
        id: symbol.id,
        ticker: symbol.ticker,
        name: symbol.name,
        exchange: symbol.exchange,
        type: symbol.type,
      },
      price,
      starred: symbol.active,
      positions: positions.map((p) => ({
        provider: p.provider || 'unknown',
        accountId: p.accountId || 'default',
        quantity: p.quantity,
        avgPrice: Number(p.avgPrice || 0),
        pnl: Number(p.unrealizedPnl || 0),
      })),
      freshness,
    };
  }

  async getProtocols(ticker: string) {
    const upperTicker = ticker.toUpperCase();

    const symbol = await this.prisma.symbol.findFirst({
      where: { ticker: upperTicker },
    });
    if (!symbol) throw new NotFoundException(`Symbol ${upperTicker} not found`);

    // Find strategies that include this symbol
    let strategies: any[] = [];
    try {
      const all = await (this.prisma as any).strategy.findMany({
        include: { scores: true },
      });
      strategies = all.filter((s: any) => {
        const config = (s.config as any) || {};
        const symbols = config.symbols || config.symbolFocus || [];
        return symbols.includes(upperTicker) || symbols.includes(symbol.id);
      });
    } catch {
      strategies = [];
    }

    const protocols = strategies.map((s) => {
      const scores = (s.scores || []).map((sc: any) => Number(sc.score || 0)).reverse();
      const currentScore = scores[scores.length - 1] || 0;
      const firstSpark = scores[0] || currentScore;
      const trend = currentScore > firstSpark ? 'rising' : currentScore < firstSpark ? 'falling' : 'flat';

      let signal = 'watch';
      if (currentScore >= 70) signal = 'entry';
      else if (currentScore <= 30) signal = 'exit';

      return {
        id: s.id,
        name: s.name || 'Untitled',
        type: (s.config as any)?.hasRiskConfig ? 'trading-strategy' : 'protocol',
        intendedTimeframe: (s.config as any)?.timeframe || '1H',
        score: currentScore,
        signal,
        exitUrgency: currentScore <= 30 ? 'high' : currentScore <= 50 ? 'medium' : 'low',
        confidence: Math.min(0.95, currentScore / 100 + 0.1),
        lastRun: s.updatedAt?.toISOString() || null,
        trend,
        sparkline: scores,
      };
    });

    return { symbol: upperTicker, protocols, count: protocols.length };
  }
}
