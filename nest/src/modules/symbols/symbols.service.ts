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
}
