import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { SystemLogService } from './log.service';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../database/prisma.service';
import { BacktestArchiveService } from './backtest-archive.service';
import { Prisma } from '@prisma/client';
import { RETENTION_TABLES, resolveRetentionDays } from './retention.config';
/**
 * Data retention service — prunes old data to prevent unbounded growth.
 *
 * Triggered via API: POST /api/system/data-retention/prune?table=directiveoutcome&days=30
 * Scheduled: Cron daily at 3 AM prunes all configured tables.
 *
 * ⚠️ The per-table config now lives in `retention.config.ts` — the ONE owner. It was declared here
 * and mirrored in two other files (`backtest-archive` said "keep in sync"; `system-health` said
 * "mirrored from DataRetentionService"), with nothing enforcing it.
 */

/** How long after boot the catch-up retention pass runs (#1244). */
const BOOT_PRUNE_DELAY_MS = 90_000;

@Injectable()
export class DataRetentionService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DataRetentionService.name);


  constructor(
    private readonly prisma: PrismaService,
    private readonly archive: BacktestArchiveService,
    private readonly systemLog: SystemLogService,
  ) {}

  /**
   * ⚠️ THE 03:00 CRON CANNOT FIRE ON THIS MACHINE, SO RETENTION ALSO RUNS AT BOOT (#1244).
   *
   * Measured 2026-11-07: the job IS registered with a valid expression — reading the decorator
   * metadata off the compiled class gives `scheduledPruneAll → "0 03 * * *"` — and yet **not one of
   * the 43 log files in `nest/logs` contains activity in the 02:00 hour followed by 03:00 or 04:00.**
   * No process has ever been alive across the boundary. The API is rebuilt several times a day by
   * agents and by `build-api.ps1`, so a once-a-day-at-03:00 job is a job that never runs.
   *
   * What that looked like from the outside: `directiveoutcome` held **5.21 days** of rows against a
   * **3-day** window, and `score_snapshot` 92.3 days against 90 — data ageing past its bound while
   * the schedule was, correctly, "configured".
   *
   * So the prune now ALSO runs shortly after boot. It is idempotent (it only deletes rows beyond the
   * declared window), it takes about 5 s, and it is `void`-ed for the same reason the boot audits are
   * (#1232): the HTTP port must not wait on housekeeping.
   *
   * ⚠️ The 03:00 cron is KEPT. Boot covers the restart-often case; 03:00 covers the run-for-days case.
   * Removing either leaves one of those two machines unpruned.
   */
  onApplicationBootstrap() {
    // ⚠️ NO `isAvailable` GUARD HERE. I added one first, and it produced exactly the defect #905
    // already fixed in the ceiling audit: at `onApplicationBootstrap` time that flag can still be
    // false, so the pass returned immediately and reported nothing — converting "cannot run yet" into
    // "ran and found nothing to do". The pass logs its own failures per table, which is the honest
    // report; a guard in front of it is a silent no-op wearing a guard's clothes.
    //
    // Let module init and the first scoring tick settle before adding 11 DELETE statements.
    const timer = setTimeout(() => {
      void this.scheduledPruneAll();
    }, BOOT_PRUNE_DELAY_MS);
    if (typeof timer.unref === 'function') timer.unref();
  }

  /** Scheduled daily prune — runs at 3 AM for all tables. */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async scheduledPruneAll() {
    this.logger.log('Running scheduled data retention pruning...');
    let grandTotal = 0;
    const summary: Array<{ table: string; deleted: number; label: string }> = [];
    const failures: Array<{ table: string; error: string }> = [];

    for (const [table, config] of Object.entries(RETENTION_TABLES)) {
      try {
        const result = await this.pruneTable(table);
        if (result.deleted > 0) {
          this.logger.log(`  ${table}: ${result.deleted} rows pruned (${config.label})`);
          summary.push({ table, deleted: result.deleted, label: config.label });
          grandTotal += result.deleted;
        }
      } catch (err) {
        this.logger.error(`  ${table}: prune failed — ${(err as Error).message}`);
        failures.push({ table, error: (err as Error).message });
      }
      await new Promise(r => setTimeout(r, 500));
    }

    // ── Per-symbol score throttling ──
    try {
      const throttled = await this.throttleScores(100);
      if (throttled > 0) {
        this.logger.log(`  score: ${throttled} excess rows throttled (per-symbol cap)`);
        summary.push({ table: 'score (throttle)', deleted: throttled, label: 'per-symbol cap 100' });
        grandTotal += throttled;
      }
    } catch (err) {
      this.logger.error(`  score throttle failed — ${(err as Error).message}`);
      failures.push({ table: 'score (throttle)', error: (err as Error).message });
    }

    this.logger.log(`Scheduled prune complete — ${grandTotal} total rows deleted.`);

    // ⚠️ THE RESULT IS WRITTEN TO THE DURABLE FILE LOG, NOT ONLY TO STDOUT (#1241).
    //
    // Measured 2026-11-07: `nest/logs/*.log` contained **zero** occurrences of "Running scheduled
    // data retention" across ten days, while the data proved the prune HAD run — every table sat at
    // or inside its declared window to within a day (`apiactivitylog` oldest 29.9 d against a 30 d
    // window). The evidence was not missing because the job did not run; it was missing because this
    // service logs through the Nest `Logger`, which writes to stdout, and `build-api.ps1` TRUNCATES
    // `console-build-api.log` on every restart. A daily job in a process that is rebuilt several
    // times a day therefore leaves no trace at all.
    //
    // Retention is the one thing here that DELETES data, so its own record has to survive a restart.
    this.systemLog.info(
      'data-retention',
      `Scheduled prune: ${grandTotal} row(s) removed across ${summary.length} table(s)` +
        (summary.length ? ` — ${summary.map((s) => `${s.table} ${s.deleted}`).join(', ')}` : ' — nothing outside its window') +
        (failures.length ? ` · ${failures.length} FAILED: ${failures.map((f) => `${f.table} (${f.error})`).join(', ')}` : ''),
      'system',
    );
  }

  /**
   * Throttle Score table — keep only the most recent N scores per (symbolId, strategyId).
   * Prevents unbounded growth from high-frequency scoring (2-min ticks × 22 strategies × N symbols).
   */
  async throttleScores(keepPerGroup = 100): Promise<number> {
    if (!this.prisma.isAvailable) return 0;
    const startTime = Date.now();
    let totalDeleted = 0;

    try {
      // Find all (symbolId, strategyId) pairs that have more than keepPerGroup scores
      const groups = await this.prisma.$queryRawUnsafe<Array<{ symbolId: string; strategyId: string; cnt: number }>>(
        `SELECT symbolId, strategyId, COUNT(*) as cnt
         FROM Score
         GROUP BY symbolId, strategyId
         HAVING cnt > ${keepPerGroup}
         LIMIT 500`
      );

      for (const g of groups) {
        // Find the cutoff timestamp: the Nth most recent score
        const rows = await this.prisma.$queryRawUnsafe<Array<{ id: string; timestamp: Date }>>(
          `SELECT id, timestamp FROM Score
           WHERE symbolId = ? AND strategyId = ?
           ORDER BY timestamp DESC
           LIMIT 1 OFFSET ${keepPerGroup}`,
          g.symbolId, g.strategyId
        );

        if (rows.length === 0) continue;
        const cutoff = (rows[0].timestamp as Date).toISOString().slice(0, 19).replace('T', ' ');

        // Batch delete older scores
        let batchDeleted = 0;
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const result = await this.prisma.$executeRawUnsafe(
            `DELETE FROM Score WHERE symbolId = ? AND strategyId = ? AND timestamp < '${cutoff}' LIMIT 5000`,
            g.symbolId, g.strategyId
          );
          if (result === 0) break;
          batchDeleted += result;
          await new Promise(r => setTimeout(r, 100));
        }
        totalDeleted += batchDeleted;
      }
    } catch (err) {
      this.logger.error(`Score throttling failed: ${(err as Error).message}`);
    }

    if (totalDeleted > 0) {
      this.logger.log(`Score throttle: removed ${totalDeleted} excess rows across groups in ${Date.now() - startTime}ms`);
    }
    return totalDeleted;
  }

  /** Prune a specific table — batch DELETE to avoid table locks. */
  async pruneTable(table: string, retentionDays?: number): Promise<{ table: string; deleted: number; cutoff: Date }> {
    const config = RETENTION_TABLES[table];
    if (!config) return { table, deleted: 0, cutoff: new Date() };

    const days = retentionDays ?? resolveRetentionDays(table);
    const cutoff = new Date(Date.now() - days * 86400000);
    const batchSize = 5000;
    let totalDeleted = 0;

    try {
      const cutoffStr = cutoff.toISOString().slice(0, 19).replace('T', ' ');

      // ── Archive before pruning (#354) — and for THIS table, the archive IS the remover ────────
      //
      // ⚠️ A FAILED ARCHIVE BEFORE A DELETE IS LOGGED, NOT SWALLOWED (2026-09-16).
      // This was `.catch(() => {})`. Archiving is best-effort by design — a corrupt export must not
      // wedge retention — but "we destroyed the rows and the backup also failed" is a materially
      // different situation from "we backed the rows up first", and the silent version makes the two
      // indistinguishable in the log. Retention is the one place in the system that deletes data, so
      // it reports its own failures.
      //
      // ⚠️⚠️ #1244 — `exportAndPrune()` DELETES TOO, AND THAT IS WHY THE COUNT WAS WRONG.
      // Measured 2026-11-07: `POST prune?table=directiveoutcome` reported `deleted: 30000` while the
      // table went 170,740 → 98,302 — **72,438 rows actually left**. This call was fire-and-forget
      // and has its OWN `DELETE FROM … WHERE dateCol < cutoff LIMIT n` loop, so two removers raced
      // for the same rows and each counted only what IT deleted. The operator-facing number was the
      // smaller half of the truth, in the one place that deletes data.
      //
      // Now it is awaited and its count is THE count, with the local loop skipped for this table. If
      // the archive fails, the local loop still runs — retention must not stop because a backup did.
      let archiveOwnedTheDelete = false;
      if (table === 'directiveoutcome') {
        try {
          const archived = await this.archive.exportAndPrune(table, config.dateCol, days);
          totalDeleted = archived.exported;
          archiveOwnedTheDelete = true;
          if (archived.exported > 0) {
            this.logger.log(
              `${table}: ${archived.exported} row(s) exported AND removed by the archive path` +
                `${archived.filePath ? ` → ${archived.filePath}` : ''}`,
            );
          }
        } catch (err) {
          this.logger.error(
            `Archive-before-prune FAILED for ${table} (${(err as Error).message}) — falling back to a ` +
            `plain delete. Retention proceeds; the export for these rows does not exist.`,
          );
        }
      }

      if (!archiveOwnedTheDelete) {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const result = await this.prisma.$executeRawUnsafe(
            `DELETE FROM \`${table}\` WHERE \`${config.dateCol}\` < '${cutoffStr}' LIMIT ${batchSize}`
          );
          if (result === 0) break;
          totalDeleted += result;
          await new Promise(r => setTimeout(r, 200));
        }
      }

      if (totalDeleted > 0) {
        // ⚠️ NAMES THE COLUMN AND THE CUTOFF. "Pruned 4,000 rows older than 3d" does not say older
        // than 3d BY WHAT — and when that column was `predictedAt`, a bug that mis-stamped it caused
        // rows to be deleted the moment they were created, while the log read like routine housekeeping.
        this.logger.log(
          `Pruned ${totalDeleted} rows from ${table} (${config.label}), \`${config.dateCol}\` < ` +
          `${cutoff.toISOString()} (${days}d).`,
        );
      }
    } catch (err) {
      this.logger.error(`Prune failed for ${table}: ${(err as Error).message}`);
    }

    return { table, deleted: totalDeleted, cutoff };
  }

  /**
   * What a prune WOULD delete, per table, without deleting anything (#1241).
   *
   * ⚠️ THIS DID NOT EXIST, AND ITS ABSENCE IS THE REASON #1241 COULD BE WRITTEN AT ALL.
   * The log prune has had a dry run since #1023 — "every prune has a dry run, and the report names
   * each entry" — and `retention.config.ts` states the rule behind it: a retention run once destroyed
   * the evidence of the defect being investigated, and nothing warned first. The database prune had
   * no equivalent, so the only way to find out what it would do was to let it delete.
   *
   * ⚠️ `COUNT(*)` on an indexed date column, not a full scan: the same predicate the DELETE uses, so
   * the number is the number that would actually go.
   *
   * ⚠️ `rows` and `oldest` are reported beside `wouldDelete` on purpose. A window that says "0 rows
   * would be deleted" is ambiguous — the table may be empty, or it may be exactly at the boundary,
   * or it may have no data at all in that column. The three together are checkable; the count alone
   * is not.
   */
  async getRetentionReport(now: Date = new Date()) {
    const tables: Array<{
      table: string;
      label: string;
      dateCol: string;
      retentionDays: number;
      cutoff: string;
      wouldDelete: number;
      rows: number;
      oldest: string | null;
      ageDays: number | null;
    }> = [];

    for (const [table, config] of Object.entries(RETENTION_TABLES)) {
      const retentionDays = resolveRetentionDays(table);
      const cutoff = new Date(now.getTime() - retentionDays * 86400000);
      const cutoffStr = cutoff.toISOString().slice(0, 19).replace('T', ' ');

      let wouldDelete = 0;
      let rows = 0;
      let oldest: string | null = null;
      try {
        const r = await this.prisma.$queryRawUnsafe<Array<{ n: bigint | number; oldest: Date | null }>>(
          `SELECT COUNT(*) AS n, MIN(\`${config.dateCol}\`) AS oldest FROM \`${table}\``,
        );
        rows = Number(r[0]?.n ?? 0);
        oldest = r[0]?.oldest ? new Date(r[0].oldest).toISOString() : null;

        const d = await this.prisma.$queryRawUnsafe<Array<{ n: bigint | number }>>(
          `SELECT COUNT(*) AS n FROM \`${table}\` WHERE \`${config.dateCol}\` < '${cutoffStr}'`,
        );
        wouldDelete = Number(d[0]?.n ?? 0);
      } catch (err) {
        // A table that cannot be counted is reported as uncountable, never as "0 to delete".
        // ⚠️ FULL error, never a bare `.message`: Prisma raw failures carry an EMPTY message and put
        // the actual reason on `meta`/`code`, so `.message` alone logs a blank line. This file family
        // already lost ten minutes to exactly that once (#905, collation).
        this.logger.warn(`Retention report: could not count ${table} — ${String(err)} ${JSON.stringify((err as { meta?: unknown }).meta ?? null)}`);
        wouldDelete = -1;
      }

      tables.push({
        table,
        label: config.label,
        dateCol: config.dateCol,
        retentionDays,
        cutoff: cutoff.toISOString(),
        wouldDelete,
        rows,
        oldest,
        ageDays: oldest ? (now.getTime() - new Date(oldest).getTime()) / 86400000 : null,
      });
    }

    return {
      generatedAt: now.toISOString(),
      tables,
      scheduledAt: '03:00 daily (CronExpression.EVERY_DAY_AT_3AM)',
      note:
        'wouldDelete is the exact count for the predicate the prune uses. -1 means the table could ' +
        'NOT be counted — which is not the same as 0.',
    };
  }

  /** Prune all configured tables. */
  async pruneAll(): Promise<Array<{ table: string; deleted: number; cutoff: Date; label: string }>> {
    const results: Array<{ table: string; deleted: number; cutoff: Date; label: string }> = [];
    for (const [table, config] of Object.entries(RETENTION_TABLES)) {
      const r = await this.pruneTable(table);
      results.push({ ...r, label: config.label });
      await new Promise(res => setTimeout(res, 300));
    }
    return results;
  }

  /** Get table stats — uses INFORMATION_SCHEMA for fast approximate row counts. */
  async getStats() {
    const stats: Record<string, { count: number; countIsApprox: boolean; oldest: string | null; newest: string | null; retentionDays: number; label: string; sizeEstimate: string }> = {};

    // ⚠️ `count` HERE IS AN ESTIMATE, AND IT WAS WRONG BY 67% WHEN MEASURED (#1244).
    //
    // `INFORMATION_SCHEMA.TABLE_ROWS` is an InnoDB SAMPLE, not a count. Measured 2026-11-07 on
    // `directiveoutcome`: this endpoint said **162,456 rows** while `SELECT COUNT(*)` said **97,118**
    // — a 65,338-row overstatement, on the surface an operator would read to decide whether retention
    // had worked. The first before/after comparison for the prune fix was wrong because of it.
    //
    // The estimate is kept — it is instant on 10M+ rows and that is why it is here — but it is now
    // LABELLED as an estimate, and `GET /api/system/data-retention/report` gives exact `COUNT(*)`
    // figures for the same tables. A number must not imply a precision it does not have.
    let tableRows: Record<string, number> = {};
    try {
      const rows = await this.prisma.$queryRawUnsafe<Array<{ TABLE_NAME: string; TABLE_ROWS: number }>>(
        `SELECT TABLE_NAME, TABLE_ROWS FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE()`,
      );
      for (const r of rows) tableRows[r.TABLE_NAME] = Number(r.TABLE_ROWS);
    } catch { /* fallback to zero */ }

    for (const [table, config] of Object.entries(RETENTION_TABLES)) {
      const retentionDays = parseInt(process.env[config.envKey] || String(config.defaultDays), 10);
      const count = tableRows[table] || 0;

      // Date range — uses MIN/MAX which are indexed, still fast
      let oldest: string | null = null;
      let newest: string | null = null;
      try {
        const dateCol = config.dateCol;
        const dateRows = await this.prisma.$queryRawUnsafe<Array<{ first: Date | null; last: Date | null }>>(
          `SELECT MIN(\`${dateCol}\`) as first, MAX(\`${dateCol}\`) as last FROM \`${table}\``,
        );
        oldest = dateRows[0]?.first ? new Date(dateRows[0].first).toISOString() : null;
        newest = dateRows[0]?.last ? new Date(dateRows[0].last).toISOString() : null;
      } catch { /* date range unavailable */ }

      stats[table] = {
        count,
        countIsApprox: true,
        oldest,
        newest,
        retentionDays,
        label: config.label,
        sizeEstimate: count > 1_000_000 ? `${(count / 1_000_000).toFixed(1)}M` : count > 1_000 ? `${(count / 1_000).toFixed(1)}K` : String(count),
      };
    }
    return stats;
  }
}
