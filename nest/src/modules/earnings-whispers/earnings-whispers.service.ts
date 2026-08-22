import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { parseEarningsWhispers, type ParsedEarningsWhisper } from './earnings-whispers.parser';

const DEFAULT_SOURCE_SLUG = 'earnings-whispers';

@Injectable()
export class EarningsWhispersService {
  private readonly logger = new Logger(EarningsWhispersService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Parse an Earnings Whispers email dump. Optionally persists a batch + entries
   * into the generalised earnings_analysis tables, linked to the Earnings Whispers
   * source (auto-created on first use). Never throws on parse failure.
   */
  async parseAndSave(text: string, save: boolean) {
    const entries = parseEarningsWhispers(text);
    let saved = false;
    let batchId: string | null = null;

    if (save && this.prisma.isAvailable && entries.length > 0) {
      try {
        const sourceId = await this.resolveSourceId(DEFAULT_SOURCE_SLUG);
        const batch = await this.prisma.earningsAnalysisBatch.create({
          data: {
            sourceId,
            rawText: text,
            entryCount: entries.length,
            status: 'parsed',
          },
        });
        batchId = batch.id;
        await this.prisma.earningsAnalysis.createMany({
          data: entries.map((e) => this.toDbRow(e, batch.id, sourceId)),
        });
        saved = true;
      } catch (err) {
        this.logger.warn(`Could not persist earnings whispers: ${String(err)}`);
      }
    }

    return { count: entries.length, entries, saved, batchId };
  }

  /** List recent batches (with source) + entries (newest first). */
  async list() {
    const batches = this.prisma.isAvailable
      ? await this.prisma.earningsAnalysisBatch.findMany({
          include: { source: true },
          orderBy: { createdAt: 'desc' },
          take: 20,
        }).then((rows) =>
          rows.map((b) => ({
            id: b.id,
            createdAt: b.createdAt,
            entryCount: b.entryCount,
            status: b.status,
            sourceId: b.sourceId,
            sourceName: b.source?.name ?? null,
            sourceSlug: b.source?.slug ?? null,
          })),
        )
      : [];
    const entries = this.prisma.isAvailable
      ? await this.prisma.earningsAnalysis.findMany({
          orderBy: { createdAt: 'desc' },
          take: 50,
        })
      : [];
    return { batches, entries };
  }

  /** Find (or create) the source row for a slug. */
  private async resolveSourceId(slug: string): Promise<string> {
    const existing = await this.prisma.source.findUnique({ where: { slug } });
    if (existing) return existing.id;
    const created = await this.prisma.source.create({
      data: {
        name: 'Earnings Whispers',
        slug,
        kind: 'earnings',
        url: 'https://www.earningswhispers.com/',
        description: 'Earnings Whispers email: consensus vs whisper EPS, guidance, beat %, implied move per symbol.',
      },
    });
    this.logger.log(`Created source "${created.name}" (${created.id})`);
    return created.id;
  }

  private toDbRow(
    e: ParsedEarningsWhisper,
    batchId: string,
    sourceId: string,
  ): Prisma.EarningsAnalysisCreateManyInput {
    return {
      batchId,
      sourceId,
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
