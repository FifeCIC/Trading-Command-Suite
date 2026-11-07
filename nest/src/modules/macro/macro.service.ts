/* ── PLANNED IN #1228 ──
 * MISSING:  reachability. Nothing in src/ or nest/src/ names this file — no import, no route,
 *           no dynamic load. Either it is dead code, or it is a capability nobody wired up, and
 *           those two need opposite responses.
 * TODAY:    found by the name-reference scan in scripts/audit-code-health.cjs (see
 *           docs/CODE-HEALTH.md). Decide DELETE / WIRE UP / KEEP+explain, record it on the
 *           issue, then re-bank: node scripts/audit-code-health.cjs --write
 * WHEN BUILT: the file is either gone, or reachable and named by something.
 * CODE-HEALTH-MARKER — written by scripts/audit-code-health.cjs; re-run it rather than editing.
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class MacroService {
  private readonly logger = new Logger(MacroService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getIndicators(): Promise<any[]> {
    if (!this.prisma.isAvailable) return [];

    const rows = await this.prisma.macroIndicator.findMany({
      orderBy: [{ category: 'asc' }, { date: 'desc' }],
    });

    // Deduplicate: return latest value per indicator
    const latest = new Map<string, any>();
    for (const row of rows) {
      if (!latest.has(row.indicator)) {
        latest.set(row.indicator, row);
      }
    }

    return Array.from(latest.values()).map((r) => ({
      id: r.indicator,
      name: r.name,
      category: r.category,
      unit: r.unit,
      value: r.value,
      previous: r.previous,
      date: r.date.toISOString().split('T')[0],
      source: r.source,
    }));
  }

  async getHistory(indicator: string, periods = 12): Promise<any[]> {
    if (!this.prisma.isAvailable) return [];

    const rows = await this.prisma.macroIndicator.findMany({
      where: { indicator },
      orderBy: { date: 'desc' },
      take: periods,
    });

    return rows.map((r) => ({
      date: r.date.toISOString().split('T')[0],
      value: r.value,
      previous: r.previous,
    })).reverse();
  }
}
