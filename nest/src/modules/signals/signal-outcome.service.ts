import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

/**
 * SignalOutcomeService — #717 structured signal-outcome logging.
 * ================================================================
 * Persists WHY a signal is (or isn't) trade-ready, keyed to the signal's
 * Score row id, so blocker scenarios can be counted over time:
 *   - signal_outcome_log: one row per persisted signal (preTradeReady + counts)
 *   - signal_outcome_meta: typed entries — blocker | conflict | warning —
 *     each with a STABLE entryKey (not a free string) so the same scenario
 *     (symbol + protocol + key) can be aggregated.
 *
 * These are LOG tables (analysis data), not configuration. Protocol /
 * directive / decision config stays in seed data + backed-up DB tables.
 */

export interface OutcomeInput {
  scoreId: string;
  symbol: string;
  protocolId: string | null;
  preTradeReady: boolean;
  blockers: string[];
  conflicts: Array<{ type: string; severity: string; description: string; directives: string[] }>;
  warnings: string[];
}

/** Stable blocker keys — never change these without migrating old rows. */
const BLOCKER_KEYS: Array<{ match: string; key: string }> = [
  { match: 'High-severity directive conflict', key: 'conflict-high' },
  { match: 'Hard gate:', key: 'hard-gate' },
  { match: 'Risk multiplier critically low', key: 'risk-critical' },
  { match: 'Gated composite below', key: 'below-gate' },
  { match: 'Mixed signal', key: 'mixed-signal' },
];

export function blockerKey(message: string): string {
  const hit = BLOCKER_KEYS.find(b => message.startsWith(b.match));
  return hit?.key ?? 'other';
}

@Injectable()
export class SignalOutcomeService {
  private readonly logger = new Logger(SignalOutcomeService.name);

  /** Write-on-change: skip consecutive identical outcomes (dedupe signature). */
  private lastSig = new Map<string, string>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Persist one signal's outcome (log row + typed meta rows). Idempotent by
   * write-on-change: identical consecutive runs for the same symbol+protocol
   * are skipped so the log only grows on state changes.
   */
  async recordOutcome(out: OutcomeInput): Promise<void> {
    if (!this.prisma.isAvailable || !out.scoreId) return;
    try {
      const sig = [
        out.preTradeReady ? 1 : 0,
        ...out.blockers.map(blockerKey).sort(),
        ...out.conflicts.map(c => `${c.type}:${c.severity}`).sort(),
        out.warnings.length,
      ].join('|');
      const k = `${out.symbol}|${out.protocolId ?? 'any'}`;
      if (this.lastSig.get(k) === sig) return;

      const logId = `ol-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await (this.prisma as any).$executeRawUnsafe(
        `INSERT INTO signal_outcome_log
           (id, scoreId, symbol, protocolId, preTradeReady, blockerCount, conflictCount, warningCount, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        logId, out.scoreId, out.symbol, out.protocolId ?? null,
        out.preTradeReady ? 1 : 0,
        out.blockers.length, out.conflicts.length, out.warnings.length,
      );

      const rows: Array<[string, string, string | null, string, string | null]> = [];
      for (const b of out.blockers) {
        rows.push(['blocker', blockerKey(b), null, b, null]);
      }
      for (const c of out.conflicts) {
        rows.push([
          'conflict',
          `conflict-${c.type}`,
          c.severity,
          c.description,
          c.directives.length > 0 ? c.directives.join(',') : null,
        ]);
      }
      for (const w of out.warnings) {
        rows.push(['warning', 'warning', null, w.slice(0, 500), null]);
      }
      if (rows.length > 0) {
        let sql = `INSERT INTO signal_outcome_meta (id, logId, entryType, entryKey, severity, message, directiveIds, createdAt) VALUES `;
        const values: any[] = [];
        rows.forEach((r, i) => {
          sql += `${i > 0 ? ',' : ''} (UUID(), ?, ?, ?, ?, ?, ?, NOW())`;
          values.push(logId, r[0], r[1], r[2], r[3], r[4]);
        });
        await (this.prisma as any).$executeRawUnsafe(sql, ...values);
      }

      this.lastSig.set(k, sig);
    } catch (err) {
      this.logger.warn(`Signal outcome logging failed: ${(err as Error).message}`);
    }
  }

  /**
   * Count outcome scenarios over a window — powers "why is XAUUSD always
   * blocked?" analysis. e.g. countOutcomes({ symbol:'XAUUSD', entryKey:'conflict-high' }).
   */
  async countOutcomes(params: {
    symbol?: string;
    protocolId?: string;
    entryKey?: string;
    days?: number;
  }): Promise<Array<{ symbol: string; protocolId: string | null; entryType: string; entryKey: string; count: number; lastSeenAt: string | null }>> {
    try {
      const days = params.days ?? 7;
      const rows: any[] = await (this.prisma as any).$queryRawUnsafe(
        `SELECT l.symbol, l.protocolId, m.entryType, m.entryKey,
                CAST(COUNT(*) AS SIGNED) AS cnt, MAX(l.createdAt) AS lastSeenAt
         FROM signal_outcome_meta m
         JOIN signal_outcome_log l ON l.id = m.logId
         WHERE l.createdAt >= DATE_SUB(NOW(), INTERVAL ? DAY)
           AND (? IS NULL OR l.symbol = ?)
           AND (? IS NULL OR l.protocolId = ?)
           AND (? IS NULL OR m.entryKey = ?)
         GROUP BY l.symbol, l.protocolId, m.entryType, m.entryKey
         ORDER BY cnt DESC
         LIMIT 100`,
        days,
        params.symbol ?? null, params.symbol ?? null,
        params.protocolId ?? null, params.protocolId ?? null,
        params.entryKey ?? null, params.entryKey ?? null,
      );
      return rows.map((r: any) => ({
        symbol: r.symbol,
        protocolId: r.protocolId,
        entryType: r.entryType,
        entryKey: r.entryKey,
        count: Number(r.cnt),
        lastSeenAt: r.lastSeenAt instanceof Date ? r.lastSeenAt.toISOString() : String(r.lastSeenAt ?? ''),
      }));
    } catch {
      return [];
    }
  }
}
