import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class ArchitectureService {
  private readonly logger = new Logger(ArchitectureService.name);

  constructor(private prisma: PrismaService) {}

  /** Get the full section index for the AF page navigation */
  async getIndex() {
    return this.prisma.architectureSection.findMany({
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        sectionKey: true,
        title: true,
        description: true,
        _count: { select: { entries: { where: { status: 'active' } } } },
      },
    });
  }

  /** Get all entries for a section */
  async getSection(sectionKey: string) {
    const section = await this.prisma.architectureSection.findUnique({
      where: { sectionKey },
      include: {
        entries: {
          where: { status: 'active' },
          orderBy: { sortOrder: 'asc' },
          select: { id: true, content: true, tags: true, sortOrder: true, updatedAt: true },
        },
      },
    });
    return section ?? { sectionKey, title: sectionKey, entries: [] };
  }

  /** Search entries by query text + optional tag filter */
  async search(q: string, tag?: string) {
    const where: any = {
      status: 'active',
      content: { contains: q },
    };
    if (tag) where.tags = { contains: tag };

    return this.prisma.architectureEntry.findMany({
      where,
      orderBy: [{ sectionId: 'asc' }, { sortOrder: 'asc' }],
      select: {
        id: true,
        content: true,
        tags: true,
        sectionId: true,
        updatedAt: true,
        section: { select: { sectionKey: true, title: true } },
      },
      take: 50,
    });
  }

  /** Filtered entry list */
  async getEntries(status?: string, tag?: string, sectionKey?: string) {
    const where: any = {};
    if (status) where.status = status;
    else where.status = 'active';
    if (tag) where.tags = { contains: tag };
    if (sectionKey) {
      const section = await this.prisma.architectureSection.findUnique({ where: { sectionKey } });
      if (section) where.sectionId = section.id;
    }

    return this.prisma.architectureEntry.findMany({
      where,
      orderBy: [{ sectionId: 'asc' }, { sortOrder: 'asc' }],
      select: { id: true, content: true, tags: true, status: true, sectionId: true, updatedAt: true },
    });
  }

  /** Add a new entry (AI agents use this) */
  async addEntry(sectionKey: string, content: string, tags?: string, sortOrder?: number) {
    let section = await this.prisma.architectureSection.findUnique({ where: { sectionKey } });
    if (!section) {
      section = await this.prisma.architectureSection.create({
        data: { sectionKey, title: sectionKey, sortOrder: 99 },
      });
    }

    const maxOrder = await this.prisma.architectureEntry.aggregate({
      where: { sectionId: section.id },
      _max: { sortOrder: true },
    });

    return this.prisma.architectureEntry.create({
      data: {
        sectionId: section.id,
        content,
        tags: tags ?? null,
        sortOrder: sortOrder ?? (maxOrder._max.sortOrder ?? 0) + 1,
      },
    });
  }

  /** Update an existing entry */
  async updateEntry(id: string, content?: string, tags?: string, status?: string) {
    const existing = await this.prisma.architectureEntry.findUnique({ where: { id } });
    if (!existing) return null;

    // Save revision before updating
    await this.prisma.architectureRevision.create({
      data: {
        entryId: id,
        previousContent: existing.content,
        changedBy: 'agent',
      },
    });

    return this.prisma.architectureEntry.update({
      where: { id },
      data: {
        ...(content !== undefined && { content }),
        ...(tags !== undefined && { tags }),
        ...(status !== undefined && { status }),
      },
    });
  }

  /** Archive an entry (soft-delete) */
  async archiveEntry(id: string) {
    return this.prisma.architectureEntry.update({
      where: { id },
      data: { status: 'archived' },
    });
  }

  /** Get revision history for an entry */
  async getRevisions(entryId: string) {
    return this.prisma.architectureRevision.findMany({
      where: { entryId },
      orderBy: { changedAt: 'desc' },
      take: 50,
    });
  }

  /** Get system boundaries */
  getBoundaries() {
    return {
      frontend: 'React 18 + Vite, port 5173. Pages in src/pages/. Nav in src/core/nav-tree.js.',
      backend: 'NestJS, port 3201. Modules in nest/src/modules/. Prisma ORM.',
      bridge: 'Python MT5 bridge, port 5000. Scripts in scripts/mt5-bridge/.',
      database: 'MySQL via Prisma. Connection in nest/.env. Schema in nest/prisma/schema.prisma.',
      docs: 'Google Drive: G:\\My Drive\\Project Management\\Live\\Trading-Command-Suite-Documentation\\.',
    };
  }
}
