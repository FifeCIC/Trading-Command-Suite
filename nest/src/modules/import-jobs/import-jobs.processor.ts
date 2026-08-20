import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../database/prisma.service';
import { IMPORT_QUEUE, ImportJobPayload } from './import-jobs.constants';
import { ImportJobsService } from './import-jobs.service';

/**
 * BullMQ worker for the `market-imports` queue.
 *
 * NO-DEMO-DATA POLICY: this processor NEVER fabricates bars and never stamps
 * provider health itself. It delegates to ImportJobsService.importRealBars(),
 * which pulls real OHLCV data from the provider chain (MT5 → Alpha Vantage →
 * Trading212 → Yahoo) and only marks a provider healthy after real bars were
 * stored. If no provider returns real data, the run is marked `failed`.
 *
 * Note: the queue is currently disabled (QueueModule returns a lazy "disabled"
 * connection and ImportJobsService.enqueueImport() executes imports directly),
 * so this worker is inert in local dev. It must stay real so that re-enabling
 * the queue in production is safe.
 */
@Processor(IMPORT_QUEUE)
export class ImportJobsProcessor extends WorkerHost {
  private readonly logger = new Logger(ImportJobsProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly importJobs: ImportJobsService,
  ) {
    super();
  }

  async process(
    job: Job<ImportJobPayload>,
  ): Promise<{ runId: string; status: string }> {
    const { runId, symbolId, timeframe } = job.data;

    try {
      const result = await this.importJobs.importRealBars(symbolId, timeframe);

      const completed = result.source === 'real';
      await this.prisma.importRun.update({
        where: { id: runId },
        data: {
          status: completed ? 'completed' : 'failed',
          completedAt: new Date(),
          error: completed
            ? null
            : `No provider returned real bars for this symbol (source: ${result.source})`,
        },
      });

      if (!completed) {
        this.logger.warn(
          `Import run ${runId}: no real data imported — marked failed, no bars written`,
        );
      }

      return {
        runId,
        status: completed ? 'completed' : 'failed',
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unknown import processor error';
      this.logger.error(`Import run ${runId} failed: ${message}`);

      await this.prisma.importRun.update({
        where: { id: runId },
        data: {
          status: 'failed',
          completedAt: new Date(),
          error: message,
        },
      });

      throw error;
    }
  }
}
