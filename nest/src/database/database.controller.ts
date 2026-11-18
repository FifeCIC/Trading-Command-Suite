/**
 * Database Controller — monitoring endpoints
 * ===========================================
 * Exposes DB health and table statistics for the
 * data pipeline monitoring dashboard.
 */

import { BadRequestException, Controller, Get, Logger, Query, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from './prisma.service';

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
): string[] {
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
      const targetTables = resolveRequestedTables(tablesParam, realNames);

      if (targetTables.length) {
        const sql =
          'SELECT ' +
          targetTables.map((n) => `(SELECT COUNT(*) FROM \`${n}\`) AS \`${n.toLowerCase()}\``).join(', ');
        const counted = await this.prisma.$queryRawUnsafe<Array<Record<string, bigint | number>>>(sql);
        for (const [name, value] of Object.entries(counted[0] ?? {})) {
          exactCounts.set(String(name).toLowerCase(), Number(value));
        }
      }

      const tables: TableStat[] = rows.map((r) => {
        const dataLen = Number(r.Data_length ?? 0);
        const indexLen = Number(r.Index_length ?? 0);
        const exact = exactCounts.get(String(r.Name).toLowerCase());
        return {
          tableName: r.Name,
          rowCount: exact ?? Number(r.Rows ?? 0),
          rowCountSource: exact === undefined ? 'estimate' : 'exact',
          dataSizeKb: Math.round(dataLen / 1024),
          indexSizeKb: Math.round(indexLen / 1024),
          totalSizeKb: Math.round((dataLen + indexLen) / 1024),
          lastInsert: r.Update_time ?? null,
          engine: r.Engine ?? null,
        };
      });

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
