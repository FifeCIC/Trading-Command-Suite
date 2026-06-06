import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Symbol } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { CreateSymbolDto } from './dto/create-symbol.dto';
import { UpdateSymbolDto } from './dto/update-symbol.dto';

@Injectable()
export class SymbolsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateSymbolDto): Promise<Symbol> {
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
    return this.prisma.symbol.findMany({
      orderBy: [{ ticker: 'asc' }],
    });
  }

  async findOne(id: string): Promise<Symbol> {
    const symbol = await this.prisma.symbol.findUnique({ where: { id } });
    if (!symbol) {
      throw new NotFoundException(`Symbol ${id} not found`);
    }

    return symbol;
  }

  async update(id: string, dto: UpdateSymbolDto): Promise<Symbol> {
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
    await this.findOne(id);

    return this.prisma.symbol.update({
      where: { id },
      data: { active },
    });
  }
}
