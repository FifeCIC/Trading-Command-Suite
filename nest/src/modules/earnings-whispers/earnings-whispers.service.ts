import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { parseEarningsWhispers, type ParsedEarningsWhisper } from './earnings-whispers.parser';

@Injectable()
export class EarningsWhispersService {
  private readonly logger = new Logger(EarningsWhispersService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Parse an Earnings Whispers email dump. Optionally persists a batch + entries.
   * Never throws on parse failure — missing fields stay null and the raw text is kept.
   */
  async parseAndSave(text: string, save: boolean) {
    const entries = parseEarningsWhispers(text);
    let saved = false;
    let batchId: string | null = null;

    if (save && this.prisma.isAvailable && entries.length > 0) {
      try {
        const batch = await this.prisma.earningsWhisperBatch.create({
          data: {
            source: 'earnings-whispers',
            rawEmail: text,
            entryCount: entries.length,
            status: 'parsed',
          },
        });
        batchId = batch.id;
        await this.prisma.earningsWhisper.createMany({
          data: entries.map((e) => this.toDbRow(e, batch.id)),
        });
        saved = true;
      } catch (err) {
        this.logger.warn(`Could not persist earnings whispers: ${String(err)}`);
      }
    }

    return { count: entries.length, entries, saved, batchId };
  }

  /** List recent batches + entries (newest first). */
  async list() {
    const batches = this.prisma.isAvailable
      ? await this.prisma.earningsWhisperBatch.findMany({
          orderBy: { createdAt: 'desc' },
          take: 20,
        })
      : [];
    const entries = this.prisma.isAvailable
      ? await this.prisma.earningsWhisper.findMany({
          orderBy: { createdAt: 'desc' },
          take: 50,
        })
      : [];
    return { batches, entries };
  }

  private toDbRow(e: ParsedEarningsWhisper, batchId: string): Prisma.EarningsWhisperCreateManyInput {
    return {
      batchId,
      symbol: e.symbol,
      name: e.name,
      headline: e.headline,
      reportDate: e.reportDate ? new Date(`${e.reportDate}T12:00:00.000Z`) : new Date(),
      reportTime: e.reportTime,
      reportDateLabel: e.reportDateLabel,
      consensusEps: e.consensusEps,
      consensusRevenue: e.consensusRevenue,
      consensusRevenueLabel: e.consensusRevenueLabel,
      whisperEps: e.whisperEps,
      guidanceEpsLow: e.guidanceEpsLow,
      guidanceEpsHigh: e.guidanceEpsHigh,
      guidanceRevLow: e.guidanceRevLow,
      guidanceRevHigh: e.guidanceRevHigh,
      beatPct: e.beatPct,
      beatSide: e.beatSide,
      shortInterestChangePct: e.shortInterestChangePct,
      shortInterestDirection: e.shortInterestDirection,
      impliedMovePct: e.impliedMovePct,
      recentAvgMovePct: e.recentAvgMovePct,
      stockChangePct: e.stockChangePct,
      priceVs200dmaPct: e.priceVs200dmaPct,
      dma200Price: e.dma200Price,
      meta: (e.meta ?? {}) as Prisma.InputJsonValue,
      rawText: e.rawText,
    };
  }
}
