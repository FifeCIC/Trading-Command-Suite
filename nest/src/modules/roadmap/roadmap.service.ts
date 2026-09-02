/**
 * RoadmapService — merges the build-time GitHub snapshot with the
 * interactive board state (epic #681, Phase D).
 *
 * Fractional position math + dependency validation mirror the portable
 * frontend core (src/core/roadmap/roadmap-core.js) so the API enforces
 * the same rules the UI enforces.
 */
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import * as fs from 'node:fs';
import * as path from 'node:path';

const POS_SCALE = 1_000_000;

interface SnapshotCard {
  number: number;
  title: string;
  state: string;
  labels: string[];
  assignee: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  comments: number;
  columnId: string;
}

interface Snapshot {
  generatedAt: string;
  columns: { id: string; title: string; kind: string }[];
  cards: SnapshotCard[];
}

function round6(v: number): number {
  return Math.round(v * POS_SCALE) / POS_SCALE;
}

@Injectable()
export class RoadmapService {
  private readonly logger = new Logger(RoadmapService.name);
  private datasetCache: { mtime: number; data: Snapshot } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /** Walk up from __dirname (dist or src layout) to the repo root dataset. */
  private findDatasetPath(): string {
    let dir = __dirname;
    for (let i = 0; i < 8; i++) {
      const candidate = path.join(dir, 'src', 'core', 'roadmap', 'roadmap-data.json');
      if (fs.existsSync(candidate)) return candidate;
      dir = path.dirname(dir);
    }
    return path.join(process.cwd(), '..', 'src', 'core', 'roadmap', 'roadmap-data.json');
  }

  private loadDataset(): Snapshot {
    const p = this.findDatasetPath();
    const mtime = fs.statSync(p).mtimeMs;
    if (!this.datasetCache || this.datasetCache.mtime !== mtime) {
      this.datasetCache = { mtime, data: JSON.parse(fs.readFileSync(p, 'utf8')) };
    }
    return this.datasetCache.data;
  }

  /** Snapshot ∪ interactive state, merged into one board payload. */
  async getBoard() {
    const dataset = this.loadDataset();
    const [dbColumns, dbCards] = await Promise.all([
      this.prisma.roadmapColumn.findMany(),
      this.prisma.roadmapCard.findMany(),
    ]);
    const dbColMap = new Map(dbColumns.map((c) => [c.id, c]));
    const dbCardMap = new Map(dbCards.map((c) => [c.number, c]));

    const extraCols = dbColumns
      .filter((c) => !dataset.columns.some((d) => d.id === c.id))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    const columns = [
      ...dataset.columns.map((d) => {
        const db = dbColMap.get(d.id);
        return { id: d.id, title: db?.title ?? d.title, kind: db?.kind ?? d.kind };
      }),
      ...extraCols.map((c) => ({ id: c.id, title: c.title, kind: c.kind })),
    ];

    const maxPosByCol = new Map<string, number>();
    for (const db of dbCards) {
      const p = Number(db.position);
      if (p > (maxPosByCol.get(db.columnId) ?? 0)) maxPosByCol.set(db.columnId, p);
    }

    const cards = dataset.cards.map((c) => {
      const db = dbCardMap.get(c.number);
      if (db) {
        return {
          ...c,
          columnId: db.columnId,
          position: Number(db.position),
          ownerAgent: db.ownerAgent ?? c.assignee,
          blockedBy: (db.blockedBy as number[]) ?? [],
        };
      }
      // New card: append to the bottom of its derived column (deterministic).
      const next = round6((maxPosByCol.get(c.columnId) ?? 0) + 1);
      maxPosByCol.set(c.columnId, next);
      return { ...c, position: next, ownerAgent: c.assignee, blockedBy: [] as number[] };
    });

    return { generatedAt: dataset.generatedAt, columns, cards };
  }

  /** Move card → column + index, with dependency enforcement and
   *  fractional positions (midpoint / rebalance). Persists every card in
   *  the target column. */
  async moveCard(number: number, targetColumnId: string, targetIndex: number) {
    const board = await this.getBoard();
    const { columns, cards } = board;
    const columnOrder = columns.map((c) => c.id);
    if (!columnOrder.includes(targetColumnId)) {
      throw new BadRequestException(`Unknown column ${targetColumnId}`);
    }
    const moving = cards.find((c) => c.number === number);
    if (!moving) throw new BadRequestException(`Unknown card #${number}`);

    // ── Dependency validation (mirror of roadmap-core.validateMove) ──
    const blockedByMap: Record<number, number[]> = {};
    for (const c of cards) {
      if (c.blockedBy?.length) blockedByMap[c.number] = c.blockedBy;
    }
    const targetColIdx = columnOrder.indexOf(targetColumnId);
    const finalOrder: { number: number; position: number }[] = cards
      .filter((c) => c.columnId === targetColumnId && c.number !== number)
      .sort((a, b) => a.position - b.position);
    const idx = Math.max(0, Math.min(targetIndex, finalOrder.length));
    finalOrder.splice(idx, 0, { number, position: 0 });

    const violations: string[] = [];
    for (const blockerNumber of blockedByMap[number] ?? []) {
      if (blockerNumber === number) {
        violations.push(`#${number} cannot block itself`);
        continue;
      }
      const blocker = cards.find((c) => c.number === blockerNumber);
      if (!blocker) continue; // unknown blocker — don't hard-block
      const blockerColIdx = columnOrder.indexOf(blocker.columnId);
      if (blockerColIdx < targetColIdx) continue;
      if (blockerColIdx > targetColIdx) {
        violations.push(`Blocked by #${blockerNumber} (in a later column)`);
        continue;
      }
      const bi = finalOrder.findIndex((c) => c.number === blockerNumber);
      const mi = finalOrder.findIndex((c) => c.number === number);
      if (bi === -1 || bi >= mi) {
        violations.push(`Blocked by #${blockerNumber} — it must sit above this card`);
      }
    }
    if (violations.length) throw new BadRequestException(violations.join(' · '));

    // ── Fractional positions (mirror of roadmap-core.applyMove) ──
    const existing = finalOrder
      .filter((c) => c.number !== number)
      .map((c) => c.position);
    let newPosition: number;
    let rebalanced = false;
    if (existing.length === 0) {
      newPosition = 1;
    } else if (idx === 0) {
      newPosition = round6(existing[0] - 1);
    } else if (idx >= existing.length) {
      newPosition = round6(existing[existing.length - 1] + 1);
    } else {
      const m = round6((existing[idx - 1] + existing[idx]) / 2);
      if (m === existing[idx - 1] || m === existing[idx]) {
        newPosition = m;
        rebalanced = true;
      } else {
        newPosition = m;
      }
    }

    const finalPositions = rebalanced
      ? finalOrder.map((c, i) => ({ number: c.number, position: round6(i + 1) }))
      : [
          ...existing.map((_, i) => ({
            number: finalOrder.filter((c) => c.number !== number)[i].number,
            position: existing[i],
          })),
          { number, position: round6(newPosition) },
        ];

    await this.prisma.$transaction(
      finalPositions.map((p) =>
        this.prisma.roadmapCard.upsert({
          where: { number: p.number },
          update: { columnId: targetColumnId, position: p.position },
          create: {
            number: p.number,
            columnId: targetColumnId,
            position: p.position,
            blockedBy: [],
          },
        }),
      ),
    );
    return this.getBoard();
  }

  async setOwner(number: number, agent: string | null) {
    await this.prisma.roadmapCard.upsert({
      where: { number },
      update: { ownerAgent: agent || null },
      create: {
        number,
        columnId: 'triage',
        position: 1,
        ownerAgent: agent || null,
        blockedBy: [],
      },
    });
    return this.getBoard();
  }

  async setDependencies(number: number, blockedBy: number[]) {
    await this.prisma.roadmapCard.upsert({
      where: { number },
      update: { blockedBy },
      create: { number, columnId: 'triage', position: 1, blockedBy },
    });
    return this.getBoard();
  }

  async createColumn(title: string, kind = 'sprint') {
    const slug =
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || `sprint-${Date.now()}`;
    let id = slug;
    let i = 2;
    while (await this.prisma.roadmapColumn.findUnique({ where: { id } })) {
      id = `${slug}-${i++}`;
    }
    await this.prisma.roadmapColumn.create({ data: { id, title, kind } });
    return this.getBoard();
  }

  /** Renames default columns by upserting an override; sprint columns
   *  update in place. */
  async renameColumn(id: string, title: string) {
    await this.prisma.roadmapColumn.upsert({
      where: { id },
      update: { title },
      create: { id, title, kind: 'phase' },
    });
    return this.getBoard();
  }
}
