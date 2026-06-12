/**
 * FAQ Service
 * ===========
 * Searchable FAQ database for user-facing questions about the system.
 * Supports category filtering, full-text search across questions/answers/tags,
 * and relevance-ranked results.
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { ModeService } from '../../config/mode.service';

@Injectable()
export class FaqService {
  private readonly logger = new Logger(FaqService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly modeService: ModeService,
  ) {}

  /**
   * List FAQ entries with optional search and category filter.
   * Search matches case-insensitively against question, answer, and tags.
   * Results ranked: question match > answer match > tag match.
   */
  async findAll(search?: string, category?: string) {
    const modeInfo = this.modeService.getModeInfo();
    const where: any = {};

    if (category) {
      where.category = category;
    }

    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      where.OR = [
        { question: { contains: q } },
        { answer: { contains: q } },
        { tags: { contains: q } },
      ];
    }

    const entries = await this.prisma.faqEntry.findMany({
      where,
      orderBy: [{ category: 'asc' }, { order: 'asc' }],
    });

    // Sort by relevance if searching
    if (search?.trim()) {
      const q = search.trim().toLowerCase();
      entries.sort((a, b) => {
        const scoreA = this.relevanceScore(a, q);
        const scoreB = this.relevanceScore(b, q);
        return scoreB - scoreA;
      });
    }

    return {
      mode: modeInfo.mode,
      count: entries.length,
      entries,
    };
  }

  /**
   * Compute a relevance score for a search result.
   */
  private relevanceScore(entry: any, query: string): number {
    let score = 0;
    if (entry.question.toLowerCase().includes(query)) score += 10;
    if (entry.answer.toLowerCase().includes(query)) score += 5;
    if (entry.tags.toLowerCase().includes(query)) score += 2;
    return score;
  }

  /**
   * Get a single FAQ entry by ID.
   */
  async findOne(id: string) {
    const entry = await this.prisma.faqEntry.findUnique({ where: { id } });
    return { mode: this.modeService.getMode(), entry };
  }

  /**
   * List distinct categories with entry counts.
   */
  async getCategories() {
    const entries = await this.prisma.faqEntry.findMany({
      select: { category: true },
    });

    const counts: Record<string, number> = {};
    for (const e of entries) {
      counts[e.category] = (counts[e.category] || 0) + 1;
    }

    const categories = Object.entries(counts).map(([name, count]) => ({
      name,
      count,
    }));

    return { mode: this.modeService.getMode(), categories };
  }
}
