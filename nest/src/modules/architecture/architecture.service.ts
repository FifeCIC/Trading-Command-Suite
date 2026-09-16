import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../../database/prisma.service';
import { APP_VERSION } from '../../version';

@Injectable()
export class ArchitectureService {
  private readonly logger = new Logger(ArchitectureService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * getFacts() — GET /api/architecture/facts
   *
   * The agent-facing answer to "how many X are there?", so no document has to remember.
   *
   * WHY IT EXISTS
   * -------------
   * A 2026-09-16 audit found version strings, protocol counts, adapter counts and table totals rotted
   * across eleven documents — all true when written, none re-derived. A count in prose is a second copy
   * of something the system already knows, and the second copy is the one that rots. This endpoint is
   * the queried source, so a doc can point at it instead of quoting a number.
   *
   * TWO HALVES, AND THE SPLIT IS THE POINT
   * --------------------------------------
   *   - `file` — facts derived from files. NOT computed here: they are generated into
   *     `docs/generated-facts.json` by `scripts/docs-facts.cjs`, and the backend `prebuild` runs
   *     `--check`, so the published copy cannot silently drift. Reading one artefact beats
   *     re-implementing the same counts in TypeScript, which would be a second copy — the very
   *     defect this exists to remove (see shared-core.instructions.md).
   *   - `live` — row counts. These change continuously, so they are deliberately never published
   *     in a document and never gated by a build: a gate that cannot pass trains people to ignore it.
   *
   * ⚠️ MISSING IS NOT EMPTY
   * -----------------------
   * If the generated file is unreadable this returns `file.available = false` WITH the reason and the
   * regenerate command — never `{}`. An empty object reads as "there are no facts", which is a
   * different statement from "the facts file could not be read", and collapsing the two is exactly how
   * a silent failure gets mistaken for a clean result (the *plausible numbers, no error* class). The
   * same rule applies to `live`: a failed query reports the error, it does not report zero.
   */
  async getFacts() {
    return {
      version: APP_VERSION,
      measuredAt: new Date().toISOString(),
      file: this.readGeneratedFacts(),
      live: await this.readLiveCounts(),
      endpoints: {
        version: '/api/version',
        directives: '/api/directives',
        protocols: '/api/scoring/protocols',
        gatedProtocols: '/api/scoring/gated/protocols',
      },
    };
  }

  /**
   * Locate and read `docs/generated-facts.json`.
   *
   * The file sits at the repo root, but this code runs from `nest/dist/src/modules/architecture`, so
   * the relative depth differs between a built run and a dev run. Rather than hard-code a depth that
   * would silently break on one of them, walk up until the file is found. Bounded, so a missing file
   * cannot cause an unbounded search.
   */
  private readGeneratedFacts() {
    const regenerate = 'npm run docs:facts';
    let dir = __dirname;
    for (let i = 0; i < 6; i += 1) {
      const candidate = path.join(dir, 'docs', 'generated-facts.json');
      if (fs.existsSync(candidate)) {
        try {
          const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8'));
          return {
            available: true,
            source: path.relative(process.cwd(), candidate).replace(/\\/g, '/'),
            schemaVersion: parsed.schemaVersion,
            facts: parsed.facts,
            note: parsed.note,
          };
        } catch (e) {
          // Readable but malformed is its own failure, and must not look like "no facts".
          return {
            available: false,
            reason: `generated facts exist but could not be parsed: ${(e as Error).message}`,
            regenerate,
          };
        }
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return {
      available: false,
      reason: 'docs/generated-facts.json was not found (is the API running from a packaged build without docs/?)',
      regenerate,
    };
  }

  /**
   * Live row counts. Never published in a document and never build-gated — see getFacts().
   *
   * Uses raw SQL rather than Prisma model delegates so the query names the TABLE, not a model class:
   * several of these tables are unmodelled (see `.github/instructions/database-schema.instructions.md`),
   * and a count should not fail merely because Prisma has no model for it.
   */
  private async readLiveCounts() {
    try {
      const rows = await this.prisma.$queryRawUnsafe<Array<{ k: string; v: bigint }>>(
        `SELECT 'tables' AS k, COUNT(*) AS v FROM information_schema.tables WHERE table_schema = DATABASE()
         UNION ALL SELECT 'symbols', COUNT(*) FROM symbol
         UNION ALL SELECT 'protocols', COUNT(*) FROM protocol
         UNION ALL SELECT 'directives', COUNT(*) FROM directive
         UNION ALL SELECT 'tradingStrategies', COUNT(*) FROM trading_strategy
         UNION ALL SELECT 'scoringStrategies', COUNT(*) FROM scoring_strategy`,
      );
      // BigInt is not JSON-serialisable — Nest would throw on the response, so convert explicitly.
      const counts: Record<string, number> = {};
      for (const r of rows) counts[r.k] = Number(r.v);
      return {
        available: true,
        note: 'Live values change continuously — query, never quote.',
        counts,
        unmodelledTables: 'run: npm --prefix nest run db:check',
      };
    } catch (e) {
      this.logger.warn(`live fact query failed: ${(e as Error).message}`);
      return {
        available: false,
        reason: (e as Error).message,
        note: 'The query failed — this is NOT a count of zero.',
      };
    }
  }

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
