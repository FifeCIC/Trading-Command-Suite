import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

type EnqueueImportInput = {
  symbolId: string;
  timeframe: string;
  provider: string;
  source: string;
};

@Injectable()
export class ImportJobsService {
  private readonly logger = new Logger(ImportJobsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async enqueueImport(input: EnqueueImportInput): Promise<{ runId: string; queueJobId: string }> {
    const symbol = await this.prisma.symbol.findUnique({ where: { id: input.symbolId } });
    if (!symbol) {
      throw new NotFoundException(`Symbol ${input.symbolId} not found`);
    }

    const run = await this.prisma.importRun.create({
      data: {
        symbolId: input.symbolId,
        provider: input.provider,
        timeframe: input.timeframe,
        status: 'queued',
        source: input.source,
      },
    });

    this.logger.warn('Import queue is disabled in local mode (Redis not configured). Run record created without enqueue.');

    return {
      runId: run.id,
      queueJobId: 'disabled',
    };
  }

  async listRecent(limit = 20) {
    try {
      return await this.prisma.importRun.findMany({
        orderBy: [{ requestedAt: 'desc' }],
        take: limit,
        include: {
          symbol: {
            select: {
              id: true,
              ticker: true,
              name: true,
            },
          },
        },
      });
    } catch (error) {
      this.logger.warn(`Database unavailable while loading import runs: ${String(error)}`);
      return [];
    }
  }
}
