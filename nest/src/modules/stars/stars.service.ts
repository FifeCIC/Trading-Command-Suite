import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

export interface StarToggleResult {
  starred: boolean;
  starId?: string;
}

@Injectable()
export class StarsService {
  private readonly logger = new Logger(StarsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Toggle a star: create if it doesn't exist, delete if it does.
   * Returns the new state and optionally the star ID (if just created).
   */
  async toggle(
    itemType: string,
    itemId: string,
    userId = 'default',
  ): Promise<StarToggleResult> {
    if (!this.prisma.isAvailable) {
      throw new Error('Database is not available. Cannot toggle star.');
    }

    const existing = await this.prisma.userStar.findUnique({
      where: {
        userId_itemType_itemId: { userId, itemType, itemId },
      },
    });

    if (existing) {
      await this.prisma.userStar.delete({ where: { id: existing.id } });
      return { starred: false };
    }

    const created = await this.prisma.userStar.create({
      data: { userId, itemType, itemId },
    });
    return { starred: true, starId: created.id };
  }

  /**
   * Get all stars for a user, optionally filtered by item type.
   */
  async findAll(
    userId = 'default',
    types?: string[],
  ): Promise<{ byType: Record<string, string[]>; all: string[] }> {
    if (!this.prisma.isAvailable) {
      return { byType: {}, all: [] };
    }

    const where: any = { userId };
    if (types && types.length > 0) {
      where.itemType = { in: types };
    }

    const stars = await this.prisma.userStar.findMany({
      where,
      orderBy: { createdAt: 'asc' },
    });

    const byType: Record<string, string[]> = {};
    for (const s of stars) {
      if (!byType[s.itemType]) byType[s.itemType] = [];
      byType[s.itemType].push(s.itemId);
    }

    return {
      byType,
      all: stars.map((s) => s.id),
    };
  }

  /**
   * Get starred item IDs for a specific type.
   */
  async getStarredIds(itemType: string, userId = 'default'): Promise<string[]> {
    if (!this.prisma.isAvailable) return [];

    const stars = await this.prisma.userStar.findMany({
      where: { userId, itemType },
      select: { itemId: true },
    });
    return stars.map((s) => s.itemId);
  }

  /**
   * Remove a specific star by ID.
   */
  async remove(starId: string): Promise<void> {
    if (!this.prisma.isAvailable) return;
    await this.prisma.userStar.delete({ where: { id: starId } }).catch(() => {
      // swallow not-found
    });
  }

  /**
   * Bulk star: star multiple items at once.
   */
  async bulkStar(
    items: { itemType: string; itemId: string }[],
    userId = 'default',
  ): Promise<number> {
    if (!this.prisma.isAvailable) return 0;

    let count = 0;
    for (const { itemType, itemId } of items) {
      try {
        await this.prisma.userStar.upsert({
          where: { userId_itemType_itemId: { userId, itemType, itemId } },
          update: {},
          create: { userId, itemType, itemId },
        });
        count++;
      } catch {
        // skip duplicates
      }
    }
    return count;
  }

  /**
   * Bulk unstar: remove stars for multiple items.
   */
  async bulkUnstar(
    items: { itemType: string; itemId: string }[],
    userId = 'default',
  ): Promise<number> {
    if (!this.prisma.isAvailable) return 0;

    let count = 0;
    for (const { itemType, itemId } of items) {
      try {
        await this.prisma.userStar.deleteMany({
          where: { userId, itemType, itemId },
        });
        count++;
      } catch {
        // skip if not found
      }
    }
    return count;
  }
}
