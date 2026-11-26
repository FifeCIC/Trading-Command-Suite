/**
 * Database Controller — monitoring endpoints
 * ===========================================
 * Exposes DB health and table statistics for the
 * data pipeline monitoring dashboard.
 */

import { BadRequestException, Controller, Get, Logger, Query, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { RETENTION_TABLES, resolveRetentionDays } from '../modules/system/retention.config';
import { TABLE_USAGE, type TableClass, type TableReadBy } from './table-usage.data';

interface TableStat {
  tableName: string;
  /**
   * ⚠️ READ `rowCountSource` BEFORE TRUSTING THIS NUMBER. `SHOW TABLE STATUS.Rows` is an InnoDB
   * ESTIMATE sampled from index statistics, not a count, and it is not close on a table with churn.
   * Measured 2026-11-18 on this database:
   *
   *   table         estimate    COUNT(*)    error
   *   newsarticle     34,821      52,048    −33%
   *   score           12,482      19,103    −35%
   *   position            25          11     +127%
   *   marketbar    1,975,125   1,973,101     ~0%  (large table, sampled more)
   *
   * A caller that wants a real number asks for it: `?tables=Score,Trade` switches these rows to
   * `COUNT(*)` and says so.
   */
  rowCount: number;
  /** 'exact' = COUNT(*) for this table · 'estimate' = SHOW TABLE STATUS.Rows (see above). */
  rowCountSource: 'exact' | 'estimate';
  dataSizeKb: number;
  indexSizeKb: number;
  totalSizeKb: number;
  lastInsert: string | null;
  engine: string | null;

  // ── declared usage (table-usage.data.ts) ──────────────────────────────────────────────────────
  /**
   * `undeclared` is a FINDING, not a blank: the table exists and nobody has said what it is for.
   * The page lists those first-class rather than hiding them, because a table with no declared role
   * is exactly the one that grows unnoticed.
   */
  class: TableClass | 'undeclared';
  purpose: string | null;
  writtenPer: string | null;
  readBy: TableReadBy | null;

  // ── declared retention (retention.config.ts — the ONE owner of windows) ───────────────────────
  /** Effective window in days after the `DATA_RETENTION_*` override. `null` = NO BOUND declared. */
  retentionDays: number | null;
  /** The write-time column the bound is applied to, or null when there is no bound. */
  retentionDateCol: string | null;
  /** The env key that overrides `retentionDays`, so the page can name how to change it. */
  retentionEnvKey: string | null;

  // ── growth, measured over the RETAINED window only ────────────────────────────────────────────
  /**
   * Rows per day across the span actually present: `COUNT(*) / (MAX(dateCol) − MIN(dateCol) + 1)`.
   *
   * ⚠️ THIS IS A LIFETIME AVERAGE OF WHAT SURVIVES, NOT TODAY'S RATE. On a table whose oldest row
   * is exactly its retention boundary the two are the same; on one that has never been pruned it is
   * the whole history. The page labels it "over retained window" for that reason.
   * `null` means it was not measured — no declared date column, or the count could not be read.
   */
  growthPerDay: number | null;
  /** Oldest row, from the same query as `growthPerDay`. `null` when unmeasured. */
  oldest: string | null;
}

/**
 * resolveRequestedTables — turn the `?tables=` parameter into REAL table names, or refuse.
 *
 * Extracted so the rules can be tested without a database (see the spec beside this file). Three of
 * them are not obvious and each was a way the endpoint could have produced a wrong answer:
 *
 * 1. **An unknown name is a 400, never skipped.** A silently-dropped name arrives at the page as a
 *    table with no row count, which is indistinguishable from an empty table.
 * 2. **The allowlist is the schema's own table list**, not a regex. `^[A-Za-z0-9_]+$` would still
 *    admit a name that does not exist; intersecting with what `SHOW TABLE STATUS` just returned
 *    means only a real table can reach the SQL.
 * 3. **Duplicates are collapsed.** The request becomes `(SELECT COUNT(*) …) AS \`score\`, (…) AS
 *    \`score\``, and MySQL rejects a duplicate column alias — a 500 with a MySQL error, not a 400
 *    that names the mistake.
 *
 * @param tablesParam raw `?tables=a,b,c` value, or undefined
 * @param realNames lowercased name → the name as the server spells it
 * @returns real names in request order, deduplicated
 * @throws BadRequestException naming every unknown table
 */
export function resolveRequestedTables(
  tablesParam: string | undefined,
  realNames: Map<string, string>,
  declared: readonly string[] = [],
): string[] {
  const raw = (tablesParam ?? '').trim().toLowerCase();

  // `declared` is a KEYWORD, not a table name: it expands to every table the registry declares, so
  // the page never keeps its own list of tables to count (a second copy of `table-usage.data.ts`
  // would be the exact duplication this endpoint's sibling warns about). Names that are declared but
  // absent from the database are DROPPED here, not refused — the caller reports them as
  // `summary.declaredMissing`, which is a finding the page can show. Refusing would make a renamed
  // table take the whole registry down.
  if (raw === 'declared') {
    return [...new Set(declared.map((n) => n.toLowerCase()))]
      .filter((n) => realNames.has(n))
      .map((n) => realNames.get(n) as string);
  }

  const requested = (tablesParam ?? '')
    .split(',')
    .map((n) => n.trim().toLowerCase())
    .filter(Boolean);
  if (!requested.length) return [];

  const unknown = [...new Set(requested)].filter((n) => !realNames.has(n));
  if (unknown.length) {
    throw new BadRequestException(`not a table in this database: ${unknown.join(', ')}`);
  }

  return [...new Set(requested)].map((n) => realNames.get(n) as string);
}

@Controller('database')
export class DatabaseController {  private readonly logger = new Logger(DatabaseController.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /api/database/table-stats — row counts, sizes, and freshness for every table.
   *
   * Since 2026-11-25 this is also the **table registry**: each row carries what the table is FOR
   * (`table-usage.data.ts`), whether it has a retention window (`retention.config.ts` — the one
   * owner), and its measured growth. The three facts live in three places on purpose; this handler
   * is the join, not a fourth copy. A table with no usage entry reports `class: 'undeclared'` rather
   * than an empty purpose, because "nobody has said what this is" and "it has no purpose" are
   * different findings and only one of them is true.
   *
   * ⚠️ THIS IS THE ONLY HANDLER FOR THIS ROUTE. A second controller
   * (`modules/system/database-stats.controller.ts`) declared `@Controller('database')` +
   * `@Get('table-stats')` as well, in a DIFFERENT response shape (`{ tables: Record<model,
   * {lastInsert}> }`, no counts, no sizes). Nest lets the first module in `AppModule.imports`
   * win — `DatabaseModule` is registered before `SystemModule` — so this handler has always been
   * the live one and that controller was unreachable code. It was deleted 2026-11-18 (#1292)
   * rather than left in place: it held a 26-model hardcoded list that reads like the source of
   * this endpoint's data, so any future edit to it would have looked like a fix and changed
   * nothing.
   *
   * ⚠️ FAILURE MUST NOT LOOK LIKE AN EMPTY DATABASE. Both failure paths used to return
   * `{ tables: [], summary: zeros }`, which the page renders as a complete list of zero tables —
   * the "cannot judge rendered as fine" defect. They now throw, so `apiGet()` rejects and the
   * page's `feedUnavailable()` shows its "statistics could not be read" alert (INV-NO-EMPTY-SWALLOW).
   *
   * @param tablesParam optional comma-separated table names. Supplying it replaces the InnoDB row
   *   estimate with a real `COUNT(*)` for those tables — one extra round trip, measured 2026-11-18
   *   at **~0.5 s for 19 tables** (against ~2.9 s for all 130, which is why it is opt-in and
   *   narrowed rather than always-on). Names that are not real tables are rejected, not ignored:
   *   a silently-skipped name looks identical to a table with no rows.
   */
  @Get('table-stats')
  async tableStats(@Query('tables') tablesParam?: string): Promise<{
    database: string | null;
    tables: TableStat[];
    summary: {
      totalTables: number;
      totalRows: number;
      totalDataKb: number;
      totalIndexKb: number;
      unboundedLarge: number;
      hotPathLarge: number;
      undeclared: number;
      declaredMissing: string[];
      growthMeasured: boolean;
    };
  }> {
    if (!this.prisma.isAvailable) {
      throw new ServiceUnavailableException(
        'database client is not available — table statistics were not read',
      );
    }

    try {
      // ⚠️ `SHOW TABLE STATUS` with NO `FROM` clause reports the CONNECTION'S default schema.
      // It used to read `FROM \`tradingcs\`` — this deployment's database name, as a literal in
      // source. On any other install that throws, and the throw was caught and returned as an empty
      // table list. Verified 2026-11-18: the bare form returns the same 130 rows on this machine.
      //
      // ⚠️ `Update_time` is the last WRITE, not the last INSERT, and InnoDB may return NULL for it;
      // the field is named `lastInsert` for wire compatibility with the page, which labels the
      // column "Last Insert". A NULL here is genuinely unknown, never "0".
      const rows = await this.prisma.$queryRaw<Array<{
        Name: string;
        Rows: bigint | number;
        Data_length: bigint | number;
        Index_length: bigint | number;
        Update_time: string | null;
        Engine: string | null;
      }>>`SHOW TABLE STATUS`;

      // The page builds a phpMyAdmin deep link per table, and it used to hardcode `db=tradingcs`.
      // Reporting the real schema name here removes the second copy of that literal.
      const dbRows = await this.prisma.$queryRaw<Array<{ db: string | null }>>`SELECT DATABASE() AS db`;
      const database = dbRows[0]?.db ?? null;

      // ── exact counts, opt-in and narrowed ────────────────────────────────────────────────
      const realNames = new Map(rows.map((r) => [String(r.Name).toLowerCase(), String(r.Name)]));
      const exactCounts = new Map<string, number>();
      const targetTables = resolveRequestedTables(tablesParam, realNames, Object.keys(TABLE_USAGE));

      if (targetTables.length) {
        const sql =
          'SELECT ' +
          targetTables.map((n) => `(SELECT COUNT(*) FROM \`${n}\`) AS \`${n.toLowerCase()}\``).join(', ');
        const counted = await this.prisma.$queryRawUnsafe<Array<Record<string, bigint | number>>>(sql);
        for (const [name, value] of Object.entries(counted[0] ?? {})) {
          exactCounts.set(String(name).toLowerCase(), Number(value));
        }
      }

      // ── growth, measured over the RETAINED window ────────────────────────────────────────────
      // ⚠️ ONE query, built from `RETENTION_TABLES` — never from the request. A per-table query in a
      // loop over ~12 tables was the obvious shape and it is 12 round trips for one page load; a
      // UNION ALL is one. Identifiers are validated before interpolation even though they can only
      // come from code, because this is the same file's SQL-injection surface (see resolveRequestedTables).
      //
      // ⚠️ A FAILURE HERE MUST NOT FAIL THE PAGE. A registry without growth is still a registry, and
      // returning 503 because one COUNT timed out would hide the retention windows too. But it must
      // be VISIBLE: `growthMeasured: false` makes the page say the column is unknown, never empty.
      let growthMeasured = false;
      const growth = new Map<string, { growthPerDay: number; oldest: string }>();
      const retentionNames = Object.keys(RETENTION_TABLES);
      if (retentionNames.length) {
        try {
          const parts = retentionNames.map((t) => {
            const dateCol = RETENTION_TABLES[t].dateCol;
            if (!/^[A-Za-z0-9_]+$/.test(t) || !/^[A-Za-z0-9_]+$/.test(dateCol)) {
              throw new Error(`refusing unsafe identifier in retention config: ${t}.${dateCol}`);
            }
            return (
              `SELECT '${t}' AS t, COUNT(*) AS n, MIN(\`${dateCol}\`) AS oldest, MAX(\`${dateCol}\`) AS newest ` +
              `FROM \`${t}\``
            );
          });
          const counted = await this.prisma.$queryRawUnsafe<
            Array<{ t: string; n: bigint | number; oldest: Date | string | null; newest: Date | string | null }>
          >(parts.join(' UNION ALL '));

          for (const r of counted) {
            if (r.oldest == null) continue;
            const oldest = new Date(r.oldest);
            const newest = r.newest == null ? oldest : new Date(r.newest);
            const spanDays = Math.max(1, Math.floor((newest.getTime() - oldest.getTime()) / 86_400_000) + 1);
            growth.set(String(r.t), {
              growthPerDay: Math.round(Number(r.n) / spanDays),
              oldest: oldest.toISOString(),
            });
          }
          growthMeasured = true;
        } catch (err) {
          this.logger.warn(
            `growth could not be measured — the table registry will show growth as unknown, not zero: ${(err as Error).message}`,
          );
        }
      }

      const tables: TableStat[] = rows.map((r) => {
        const dataLen = Number(r.Data_length ?? 0);
        const indexLen = Number(r.Index_length ?? 0);
        const exact = exactCounts.get(String(r.Name).toLowerCase());
        const key = String(r.Name).toLowerCase();
        const usage = TABLE_USAGE[key];
        const retention = RETENTION_TABLES[key];
        const measured = growth.get(key);
        return {
          tableName: r.Name,
          rowCount: exact ?? Number(r.Rows ?? 0),
          rowCountSource: exact === undefined ? 'estimate' : 'exact',
          dataSizeKb: Math.round(dataLen / 1024),
          indexSizeKb: Math.round(indexLen / 1024),
          totalSizeKb: Math.round((dataLen + indexLen) / 1024),
          lastInsert: r.Update_time ?? null,
          engine: r.Engine ?? null,
          class: usage?.class ?? 'undeclared',
          purpose: usage?.purpose ?? null,
          writtenPer: usage?.writtenPer ?? null,
          readBy: usage?.readBy ?? null,
          retentionDays: retention ? resolveRetentionDays(key) : null,
          retentionDateCol: retention?.dateCol ?? null,
          retentionEnvKey: retention?.envKey ?? null,
          growthPerDay: measured?.growthPerDay ?? null,
          oldest: measured?.oldest ?? null,
        };
      });

      const presentNames = new Set(tables.map((t) => t.tableName.toLowerCase()));
      const declaredMissing = Object.keys(TABLE_USAGE).filter((t) => !presentNames.has(t));

      return {
        database,
        tables,
        summary: {
          totalTables: tables.length,
          // ⚠️ A MIX unless every table was requested by name: exact rows for the requested ones,
          // estimates for the rest. The per-table `rowCountSource` says which each one is; this
          // total says only "about this many".
          totalRows: tables.reduce((s, t) => s + t.rowCount, 0),
          totalDataKb: tables.reduce((s, t) => s + t.dataSizeKb, 0),
          totalIndexKb: tables.reduce((s, t) => s + t.indexSizeKb, 0),
          /**
           * Tables over 5 MB with NO declared window — the growth risk the registry exists to show.
           * ⚠️ SIZE, not rows: `SHOW TABLE STATUS` sizes are exact while its row counts are InnoDB
           * estimates, so a row threshold would make this number drift with sampling.
           */
          unboundedLarge: tables.filter((t) => t.retentionDays === null && t.totalSizeKb >= 5 * 1024).length,
          /** Tables over 5 MB that the loop reads repeatedly — where an index matters. Size for the same reason. */
          hotPathLarge: tables.filter((t) => t.readBy === 'hot-path' && t.totalSizeKb >= 5 * 1024).length,
          /** Real tables nobody has described. A to-do list, not a blank. */
          undeclared: tables.filter((t) => t.class === 'undeclared').length,
          /** Declared but absent from the database — a rename or a drop that the declaration missed. */
          declaredMissing,
          /**
           * Whether the growth figures were measured at all. `false` is why every `growthPerDay` is
           * null, and the page must say so rather than render an empty column as "no growth".
           */
          growthMeasured,
        },
      };
    } catch (err) {
      // ⚠️ A 400 raised inside the `try` must not be rewrapped as "the database is unavailable" —
      // a bad `tables` value is the CALLER's mistake and says nothing about the database.
      if (err instanceof BadRequestException) throw err;
      this.logger.warn(`Table stats query failed: ${(err as Error).message}`);
      // ⚠️ NOT `{ tables: [] }`. An empty array is a claim that the database holds no tables; the
      // truth is that we could not read them. See the doc comment on this handler.
      throw new ServiceUnavailableException(
        `table statistics could not be read: ${(err as Error).message}`,
      );
    }
  }
}
