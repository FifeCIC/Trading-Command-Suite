import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { TradingPlan } from '@prisma/client';

@Injectable()
export class PlanService {
  private readonly logger = new Logger(PlanService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll(status?: string): Promise<TradingPlan[]> {
    return this.prisma.tradingPlan.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string): Promise<TradingPlan | null> {
    return this.prisma.tradingPlan.findUnique({
      where: { id },
      include: { steps: { orderBy: { sortOrder: 'asc' } } },
    });
  }

  async addStep(
    planId: string,
    data: {
      action: string;
      symbol: string;
      quantity?: number;
      targetPrice?: number;
      stopLoss?: number;
      deadline?: string;
      conditions?: string;
      notes?: string;
    },
  ) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = (this.prisma as any).planStep;
    const maxStep = await db.findFirst({
      where: { planId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    return db.create({
      data: {
        planId,
        action: data.action,
        symbol: data.symbol.toUpperCase(),
        quantity: data.quantity ?? null,
        targetPrice: data.targetPrice ?? null,
        stopLoss: data.stopLoss ?? null,
        deadline: data.deadline ? new Date(data.deadline) : null,
        conditions: data.conditions ?? null,
        notes: data.notes ?? null,
        sortOrder: (maxStep?.sortOrder ?? -1) + 1,
      },
    });
  }

  async updateStep(
    stepId: string,
    data: {
      status?: string;
      executedPrice?: number;
      notes?: string;
      sortOrder?: number;
    },
  ) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = (this.prisma as any).planStep;
    return db.update({
      where: { id: stepId },
      data: {
        ...data,
        executedAt: data.status === 'executed' ? new Date() : undefined,
      },
    });
  }

  async removeStep(stepId: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this.prisma as any).planStep.delete({ where: { id: stepId } });
  }

  async create(data: {
    title: string;
    type?: string;
    content: unknown;
    notes?: string;
    status?: string;
    symbols?: string[];
  }): Promise<TradingPlan> {
    return this.prisma.tradingPlan.create({
      data: {
        title: data.title,
        type: data.type ?? 'plan',
        content: data.content as object,
        notes: data.notes ?? null,
        status: data.status ?? 'draft',
        symbols: data.symbols ?? [],
      },
    });
  }

  async update(
    id: string,
    data: {
      title?: string;
      content?: unknown;
      notes?: string;
      status?: string;
      symbols?: string[];
    },
  ): Promise<TradingPlan> {
    return this.prisma.tradingPlan.update({
      where: { id },
      data: {
        ...data,
        content: data.content as object | undefined,
      },
    });
  }

  async remove(id: string): Promise<TradingPlan> {
    return this.prisma.tradingPlan.delete({ where: { id } });
  }
}
