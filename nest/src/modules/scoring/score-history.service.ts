/**
 * Score History Service
 * =====================
 * Stores and retrieves scoring result snapshots from the Score table.
 *
 * GET /api/scoring/history/:symbolId       → recent snapshots
 * GET /api/scoring/history/:symbolId/latest → most recent snapshot
 *
 * The Score model requires symbolId + strategyId as foreign keys.
 * strategyId is resolved dynamically (find-or-create) in the caller.
 */

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
// ⚠️ THE canonical classifier, not a local test. See the `signal` field's docblock for why a
// prefix test here demoted BOTH strong classes to `watch`.
import { classifySignal } from '../../common/utils/signal-direction';

export interface ScoreSnapshot {
  id: string;
  symbolId: string;
  strategyId: string;
  value: number;
  breakdown: any;
  timestamp: Date;
}

export interface ScoreHistoryEntry {
  id: string;
  value: number;
  confidence: number;
  mode: string;
  breakdown: any;
  timestamp: Date;
}

/** The DISPLAY tier shown on the Recently Analysed page, for a signal class. */
export type AnalysisTier = 'entry' | 'defensive' | 'watch';

/**
 * analysisTier() — the ONE place a signal class becomes a display tier (#1029).
 *
 * ⚠️ PURE AND EXPORTED SO THE TABLE CAN BE ASSERTED WITHOUT A DATABASE. #1029's acceptance asked for
 * exactly that: *"a test asserts the table above, so a reintroduced prefix test fails"*. The build
 * gate (`validate-signal-classification.cjs`) proves no prefix test exists ANYWHERE — but a gate that
 * forbids a shape is not the same as a test that pins the BEHAVIOUR, and both were asked for.
 *
 * ⚠️ `hold` AND `unknown` BOTH map to `watch`. That is deliberate and was the pre-existing behaviour:
 * an unrecognised class must degrade to "no view" rather than be guessed into a direction — the same
 * rule `classifySignal()` is built on.
 *
 * Measured 2026-09-30: the old prefix test sent **both** `STRONG_BUY` and `STRONG_SELL` here as
 * `watch`, because each begins with `STRONG`. The two strongest findings the system can produce read
 * as indistinguishable from `HOLD`.
 */
export function analysisTier(signal: unknown): AnalysisTier {
  const cls = classifySignal(signal);
  return cls === 'buy' ? 'entry' : cls === 'sell' ? 'defensive' : 'watch';
}

export interface RecentlyAnalysedSymbol {
  symbolId: string;
  ticker: string;
  latestScore: number;
  latestConfidence: number;
  lastAnalysedAt: string;
  totalRuns: number;
  /**
   * The DISPLAY tier, derived from the server-owned signal class — never from the raw composite.
   *
   * ⚠️ A CLOSED UNION, so a new tier cannot be added by accident at one site and missed at another.
   * The three values are a UI contract: `RecentlyAnalysedSymbolsPage` maps them to badge labels.
   */
  signal: AnalysisTier;
}

/**
 * Collapse the DOUBLE WRITE that every scored symbol receives per tick.
 *
 * WHY THIS EXISTS
 * ---------------
 * Two services persist a Score row for the same (symbol, protocol, minute):
 *
 *   1. `protocol-gating`   — the full pipeline result. breakdown carries
 *                            `rawMax`, `rawComposite`, `marketStatus`,
 *                            `denominatorMode`, `readinessGate` — 21 keys.
 *   2. `signals-workbench` — `SignalEnvelopeService.persistScores()`. Same
 *                            `value`, but a thin 8-key breakdown: no `rawMax`,
 *                            no `marketStatus`. It lands ~0.2–4.5s AFTER the
 *                            gating row (measured: 233 rich vs 208 thin rows in
 *                            30 minutes — ~47% of all Score rows).
 *
 * Both rows are `create`d (nothing overwrites), so the Score table holds a
 * duplicate pair per symbol per tick. `getRuns()` then groups by
 * (minute, protocol) — which merges the pair — and reads `entries[0]` from a
 * `timestamp desc` query, i.e. the THIN row. The thin row has no `rawMax`, so
 * the ladder cannot compute a percentage and shows a bare number; it has no
 * `marketStatus`, so a closed market reads as live.
 *
 * The symptom is exactly "some cards show 82/120 68%, others show a bare 82".
 *
 * WHAT THIS DOES
 * --------------
 * Within one run group, keep ONE row per ticker: the richest breakdown. Ties on
 * richness break toward the gating row, then toward the newer row. The score
 * `value` is identical across the pair, so this changes presentation only — it
 * never alters a score.
 *
 * If the duplicate write is ever removed from `SignalEnvelopeService`, this
 * function becomes a harmless no-op (one row per ticker in, one row out).
 */
function collapseDuplicateWrites<T extends { symbol?: { ticker?: string } | null; symbolId: string; value: number; breakdown?: any }>(
  entries: T[],
): T[] {
  // How much gating metadata a row carries — the tie-breaker for "richest".
  const richness = (e: T): number => {
    const b = e.breakdown ?? {};
    let n = 0;
    if (b.rawMax != null) n += 4;
    if (b.rawComposite != null) n += 4;
    if (b.marketStatus != null) n += 4;
    if (b.opportunityScore != null) n += 2;
    if (b.opportunityMax != null) n += 2;
    if (b.denominatorMode != null) n += 1;
    if (b.readinessGate != null) n += 1;
    return n;
  };
  // `protocolId` absent from the breakdown means this is the workbench row —
  // the only writer that omits it.
  const isWorkbench = (e: T): boolean => (e.breakdown?.protocolId ?? null) === null;
  // `value` is identical within a pair, so it is safe to prefer the rich row.

  const best = new Map<string, T>();
  const order: string[] = [];
  for (const e of entries) {
    const ticker = String(e.symbol?.ticker || e.symbolId);
    const prev = best.get(ticker);
    if (!prev) {
      best.set(ticker, e);
      order.push(ticker);
      continue;
    }
    const re = richness(e);
    const rp = richness(prev);
    if (re !== rp) {
      if (re > rp) best.set(ticker, e);
      continue;
    }
    // Same richness — prefer the non-workbench row, else the newer one.
    if (isWorkbench(prev) && !isWorkbench(e)) best.set(ticker, e);
  }
  return order.map((t) => best.get(t)!);
}

@Injectable()
export class ScoreHistoryService {
  private readonly logger = new Logger(ScoreHistoryService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Save a scoring snapshot to the Score table.
   * Caller must supply a valid strategyId (resolved from the DB).
   */
  async storeSnapshot(
    symbolId: string,
    strategyId: string,
    value: number,
    breakdown: any,
  ): Promise<ScoreSnapshot> {
    if (!this.prisma.isAvailable) {
      this.logger.warn('Database unavailable — skipping score snapshot');
      return null as unknown as ScoreSnapshot;
    }

    const record = await this.prisma.score.create({
      data: {
        symbolId,
        strategyId,
        value,
        breakdown,
      },
    });

    this.logger.debug(
      `Stored score snapshot: symbolId=${symbolId} value=${value.toFixed(1)}`,
    );

    return {
      id: record.id,
      symbolId: record.symbolId,
      strategyId: record.strategyId,
      value: record.value,
      breakdown: record.breakdown,
      timestamp: record.timestamp,
    };
  }

  /**
   * Return the most recent score snapshots for a symbol.
   */
  async getHistory(
    symbolId: string,
    limit = 20,
  ): Promise<ScoreHistoryEntry[]> {
    if (!this.prisma.isAvailable) {
      return [];
    }

    const rows = await this.prisma.score.findMany({
      where: { symbolId },
      orderBy: { timestamp: 'desc' },
      take: limit,
    });

    return rows.map((r) => ({
      id: r.id,
      value: r.value,
      confidence: 0,
      mode: 'pipeline',
      breakdown: r.breakdown,
      timestamp: r.timestamp,
    }));
  }

  /**
   * Score history for a symbol identified by its TICKER.
   *
   * ⚠️ WHY THIS EXISTS (#1014). `getHistory()` takes a `symbolId` — the UUID foreign key on
   * `score.symbolId`. `ExitSignalService.computeTrend()` passed `score.ticker` into it, so
   * `where: { symbolId: 'MSTR' }` matched **nothing**, and EVERY portfolio position reported
   * `scoreTrend: 'no_data'` with the reason "Insufficient score history for trend analysis".
   *
   * MEASURED 2026-09-28: MSTR had **103** scores and AMZN **99**. The data was there; the key
   * was not. No error was raised, because an empty result is indistinguishable from "no data"
   * unless something insists on the difference — which is exactly why this returns [] only
   * when the symbol itself is genuinely unknown.
   *
   * A ticker is NOT an id. `score.symbolId` is a UUID; `score_snapshot.symbol` is a ticker.
   * Same word in different tables, and joining the wrong one returns no rows and no error.
   */
  async getHistoryByTicker(ticker: string, limit = 20): Promise<ScoreHistoryEntry[]> {
    if (!ticker || !this.prisma.isAvailable) {
      return [];
    }
    const sym = await this.prisma.symbol.findFirst({
      where: { ticker: ticker.toUpperCase() },
      select: { id: true },
    });
    if (!sym) {
      return [];
    }
    return this.getHistory(sym.id, limit);
  }

  /**
   * Return the single most recent score snapshot for a symbol.
   * Throws NotFoundException if no scores exist.
   */
  async getLatest(symbolId: string): Promise<ScoreHistoryEntry> {
    if (!this.prisma.isAvailable) {
      throw new NotFoundException(
        `Database unavailable — cannot get latest for ${symbolId}`,
      );
    }

    const row = await this.prisma.score.findFirst({
      where: { symbolId },
      orderBy: { timestamp: 'desc' },
    });

    if (!row) {
      throw new NotFoundException(
        `No score history found for symbolId=${symbolId}`,
      );
    }

    return {
      id: row.id,
      value: row.value,
      confidence: 0,
      mode: 'pipeline',
      breakdown: row.breakdown,
      timestamp: row.timestamp,
    };
  }

  /**
   * Get scoring runs grouped by time + strategy.
   * Supports search, pagination, and per-run signal summaries.
   *
   * Query params:
   *   search    — filter by ticker or strategy name
   *   page      — page number (1-based, default 1)
   *   limit     — runs per page (default 30, max 100)
   *   strategyId — filter by specific strategy
   */
  async getRuns(opts?: {
    search?: string;
    page?: number;
    limit?: number;
    strategyId?: string;
    groupBy?: 'protocol' | 'strategy';
  }): Promise<{
    runs: Array<{
      id: string;
      timestamp: string;
      strategyId: string;
      strategyName: string;
      protocolId: string | null;
      protocolName: string | null;
      symbolsScored: number;
      avgScore: number;
      signalSummary: { buy: number; sell: number; neutral: number };
      topSymbol: { ticker: string; value: number } | null;
      scores: Array<{
        ticker: string;
        value: number;
        confidence: number;
        signal: string | null;
        rawComposite: number | null;
        rawMax: number | null;
        opportunityScore: number | null;
        opportunityMax: number | null;
        marketStatus: { open: boolean; asOf: string | null; reason?: string } | null;
      }>;
    }>;
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
    queryTimeMs: number;
  }> {
    const startTime = Date.now();
    const page = Math.max(1, opts?.page ?? 1);
    const pageSize = Math.min(500, Math.max(1, opts?.limit ?? 30));
    const search = opts?.search?.trim() || null;
    const strategyFilter = opts?.strategyId || null;

    if (!this.prisma.isAvailable) {
      return { runs: [], total: 0, page, pageSize, totalPages: 0, queryTimeMs: Date.now() - startTime };
    }

    // Build where clause for search
    const where: any = {};
    if (strategyFilter) where.strategyId = strategyFilter;

    // Which field identifies a "run" — the protocol when grouping by protocol
    // (the default: the breakdown JSON carries protocolId), else the strategy.
    const groupMode = opts?.groupBy || 'protocol';

    // Rolling 14-day window — the outer bound on how far back runs are considered.
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const baseWhere: any = { timestamp: { gte: fourteenDaysAgo } };
    if (Object.keys(where).length > 0) {
      baseWhere.AND = [where];
    }

    // Fetch raw scores — if search is active, also fetch symbol tickers to filter
    let scores;
    if (search) {
      // Find matching symbols first
      const matchingSymbols = await this.prisma.symbol.findMany({
        where: { ticker: { contains: search.toUpperCase() } },
        select: { id: true, ticker: true },
      });
      const matchingIds = matchingSymbols.map((s) => s.id);

      // Also check strategy names
      const matchingStrategies = await this.prisma.strategy.findMany({
        where: { name: { contains: search } },
        select: { id: true },
      });

      const symbolFilter = matchingIds.length > 0 ? { symbolId: { in: matchingIds } } : {};
      const strategyNameFilter = matchingStrategies.length > 0 ? { strategyId: { in: matchingStrategies.map((s) => s.id) } } : {};

      if (matchingIds.length === 0 && matchingStrategies.length === 0) {
        return { runs: [], total: 0, page, pageSize, totalPages: 0, queryTimeMs: Date.now() - startTime };
      }

      where.OR = [];
      if (matchingIds.length > 0) where.OR.push(symbolFilter);
      if (matchingStrategies.length > 0) where.OR.push(strategyNameFilter);
    }

    // ── Newest runs PER PROTOCOL, not newest rows globally (#757) ──
    //
    // WHY THIS IS NOT A SIMPLE findMany + slice. A "run" is a group of Score rows
    // bucketed to the minute, so the *number of runs* a protocol emits per tick is
    // its symbol count. A global `orderBy timestamp desc, take: 10000` therefore
    // spends its budget on the busiest protocol: forex-session-v1 writes 7 symbols
    // a tick (~420 rows), so 10k rows covered only ~24 minutes, and by the time the
    // page was sliced (limit=200) the low-volume protocols — spy-speed-v1, vix-spike-v1,
    // qqq-speed-v1 — had already fallen off the end. Their scores were in the DB and
    // simply never reached the API, which is why those Ladder cards looked broken.
    //
    // So: first find WHEN each protocol last scored (cheap — a handful of strings,
    // no Score rows), union those minutes, then fetch only the rows belonging to the
    // selected minutes. The row budget then scales with runs instead of with how many
    // symbols the noisiest protocol happens to score.
    const truncateToMinute = (d: Date | string) => {
      const t = new Date(d);
      t.setSeconds(0, 0);
      return t;
    };

    const groupField = groupMode === 'strategy' ? 'strategyId' : "COALESCE(JSON_UNQUOTE(JSON_EXTRACT(breakdown, '$.protocolId')), strategyId)";
    const since = fourteenDaysAgo;

    // Per-group newest minute. MAX(timestamp) per group is exactly "last scored at"
    // and returns one row per protocol regardless of how many symbols it scored.
    //
    // ⚠️ A group MUST receive its timestamp as a string. `$queryRawUnsafe` turns a
    // MySQL DATETIME into a JS Date, and multiplying that Date by the auto-increment
    // id (below) coerces it to epoch ms — which produces an absurd id, not a "NaN"
    // crash. DATE_FORMAT keeps it opaque text and is also what the grouping key needs.
    const latestRows: Array<{ g: string | null; newest: string }> = await (this.prisma as any).$queryRawUnsafe(
      `SELECT ${groupField} AS g,
              DATE_FORMAT(MAX(timestamp), '%Y-%m-%dT%H:%i:%s.000Z') AS newest
         FROM Score
        WHERE timestamp >= ?
        GROUP BY g`,
      since,
    );

    // Keep the newest `limit` groups (the page), then union their minutes. A group
    // can contribute more than one run when several protocols share a minute, so the
    // union is de-duplicated and the window is widened slightly to guarantee the page
    // is full rather than relying on ticks never colliding.
    const newestWindow = Math.max(page * pageSize, pageSize) + pageSize;
    const top = latestRows
      .filter((r) => r.g)
      .sort((a, b) => new Date(b.newest).getTime() - new Date(a.newest).getTime())
      .slice(0, newestWindow);

    if (top.length === 0) {
      return { runs: [], total: 0, page, pageSize, totalPages: 0, queryTimeMs: Date.now() - startTime };
    }

    const minuteIsos = [...new Set(top.map((r) => truncateToMinute(r.newest).toISOString()))];

    // MySQL DATETIME window covering exactly those minutes. Using a range (not a
    // per-minute OR list) keeps the query to a single indexed scan of the window.
    const windowStart = new Date(Math.min(...minuteIsos.map((iso) => Date.parse(iso))));
    const windowEnd = new Date(Math.max(...minuteIsos.map((iso) => Date.parse(iso))) + 60_000);

    scores = await this.prisma.score.findMany({
      where: {
        ...baseWhere,
        timestamp: { gte: windowStart, lt: windowEnd },
      },
      orderBy: { timestamp: 'desc' },
      take: 20000,
      include: { symbol: { select: { ticker: true } } },
    });

    if (scores.length === 0) {
      return { runs: [], total: 0, page, pageSize, totalPages: 0, queryTimeMs: Date.now() - startTime };
    }

    // Resolve strategy names AND protocol info
    const strategyIds = [...new Set(scores.map((s: any) => s.strategyId).filter(Boolean))] as string[];
    const strategies = strategyIds.length > 0
      ? await this.prisma.strategy.findMany({
          where: { id: { in: strategyIds } },
          select: { id: true, name: true },
        })
      : [];
    const nameMap = new Map((strategies as any[]).map((s: any) => [s.id, s.name]));

    // Extract protocolIds from breakdown JSON — resolve names
    const protoIds = [...new Set(
      scores.map((s: any) => s.breakdown?.protocolId).filter(Boolean),
    )] as string[];
    const protoMap = new Map<string, string>();
    if (protoIds.length > 0) {
      const protocols = await this.prisma.protocol.findMany({
        where: { id: { in: protoIds } },
        select: { id: true, name: true },
      }).catch(() => []);
      for (const p of protocols as any[]) protoMap.set(p.id, p.name);
    }

    // Group by minute + (strategyId or protocolId) — each unique run
    const groups = new Map<string, typeof scores>();
    for (const s of scores) {
      const ts = new Date(s.timestamp);
      ts.setSeconds(0, 0);
      const groupKey = groupMode === 'protocol'
        ? ((s as any).breakdown?.protocolId || s.strategyId)
        : s.strategyId;
      const key = `${ts.toISOString()}::${groupKey}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(s);
    }

    // Build run objects with signal summaries
    const allRuns = Array.from(groups.entries())
      .map(([key, entries]) => {
        const [timestamp, groupId] = key.split('::');
        const strategyId = entries[0]?.strategyId || 'unknown';
        const protocolId = groupMode === 'protocol'
          ? groupId
          : ((entries[0] as any)?.breakdown?.protocolId || null);
        const values = entries.map((e) => e.value);
        const avgScore = values.reduce((a, b) => a + b, 0) / values.length;

        // Signal classification
        let buy = 0, sell = 0, neutral = 0;
        for (const e of entries) {
          if (e.value >= 60) buy++;
          else if (e.value <= 40) sell++;
          else neutral++;
        }

        // Top symbol
        const best = entries.reduce((best, e) =>
          e.value > (best?.value ?? -999) ? e : best, null as any);
        const topSymbol = best ? { ticker: (best as any).symbol?.ticker || best.symbolId, value: best.value } : null;

        const runId = groupMode === 'protocol'
          ? `run-${new Date(timestamp).getTime()}-${protocolId?.slice(0, 12) || 'unknown'}`
          : `run-${new Date(timestamp).getTime()}-${strategyId.slice(0, 8)}`;

        return {
          id: runId,
          timestamp,
          strategyId,
          strategyName: nameMap.get(strategyId) || 'Unknown Strategy',
          protocolId,
          protocolName: protocolId ? (protoMap.get(protocolId) || null) : null,
          symbolsScored: entries.length,
          avgScore: Math.round(avgScore * 10) / 10,
          signalSummary: { buy, sell, neutral },
          topSymbol,
          scores: collapseDuplicateWrites(entries).map((e) => ({
            id: (e as any).id, // Score table UUID — used for deep-linking to a specific run
            ticker: (e as any).symbol?.ticker || e.symbolId,
            value: e.value,
            confidence: 0,
            signal: (e as any).breakdown?.signal ?? null,
            // Pre-gate raw composite + tradability status (#638). The stored
            // `value` is the FINAL gated composite — a closed market hard-gates
            // it to 0 even though the protocol produced a real signal. Ladders
            // surface that as a status, not as a red zero.
            rawComposite: (e as any).breakdown?.rawComposite ?? null,
            rawMax: (e as any).breakdown?.rawMax ?? null,
            opportunityScore: (e as any).breakdown?.opportunityScore ?? null,
            opportunityMax: (e as any).breakdown?.opportunityMax ?? null,
            marketStatus: (e as any).breakdown?.marketStatus ?? null,
          })),
        };
      })
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    const total = allRuns.length;
    const totalPages = Math.ceil(total / pageSize);
    const offset = (page - 1) * pageSize;
    const runs = allRuns.slice(offset, offset + pageSize);

    return { runs: runs as any, total, page, pageSize, totalPages, queryTimeMs: Date.now() - startTime };
  }

  /**
   * Get detailed scores for a specific run (by timestamp + strategyId).
   */
  async getRunScores(runId: string): Promise<{
    run: {
      id: string;
      timestamp: string;
      strategyId: string;
      strategyName: string;
      scores: Array<{
        ticker: string;
        value: number;
        breakdown: any;
      }>;
    } | null;
  }> {
    // runId format: "run-{epochMs}-{strategyPrefix}"
    const parts = runId.replace('run-', '').split('-');
    const epochMs = parseInt(parts[0], 10);
    if (isNaN(epochMs)) return { run: null };

    const runDate = new Date(epochMs);
    const windowStart = new Date(runDate);
    windowStart.setSeconds(0, 0);
    const windowEnd = new Date(windowStart.getTime() + 60000);

    const strategyPrefix = parts.slice(1).join('-');

    const scores = await this.prisma.score.findMany({
      where: {
        timestamp: { gte: windowStart, lt: windowEnd },
        ...(strategyPrefix ? { strategyId: { startsWith: strategyPrefix } } : {}),
      },
      orderBy: { value: 'desc' },
      include: { symbol: { select: { ticker: true } } },
    });

    if (scores.length === 0) return { run: null };

    const strategyId = scores[0].strategyId;
    const strategy = await this.prisma.strategy.findUnique({
      where: { id: strategyId },
      select: { name: true },
    });

    return {
      run: {
        id: runId,
        timestamp: windowStart.toISOString(),
        strategyId,
        strategyName: strategy?.name || 'Unknown',
        scores: scores.map((s) => ({
          ticker: (s as any).symbol?.ticker || s.symbolId,
          value: s.value,
          breakdown: s.breakdown,
        })),
      },
    };
  }

  /**
   * GET /api/scoring/latest-scores
   * ---------------------------------------------------------------------------
   * SEMANTICS: "latest" = the MOST RECENT score per ticker (timestamp-ordered),
   * NOT the highest. Ladders use this endpoint — they must reflect current
   * activity, never a historical peak.
   *
   * For the highest score over a window, see getLatestProtocolScore()
   * (used by Protocols Registry, labelled as historical/stale).
   *
   * Returns { [ticker]: { score, timestamp } } for all symbols in the last 30 days.
   */
  async getLatestScores(): Promise<Record<string, { score: number; timestamp: string }>> {
    if (!this.prisma.isAvailable) return {};
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const rows = await this.prisma.score.findMany({
      where: { timestamp: { gte: thirtyDaysAgo } },
      select: { symbol: { select: { ticker: true } }, value: true, timestamp: true },
      orderBy: { timestamp: 'desc' }, // latest first — NOT value desc
    });
    const map: Record<string, { score: number; timestamp: string }> = {};
    for (const row of rows as any[]) {
      const ticker = row.symbol?.ticker;
      // First row per ticker (timestamp desc) is the latest — take it, skip the rest
      if (ticker && !map[ticker]) {
        map[ticker] = { score: row.value, timestamp: row.timestamp.toISOString() };
      }
    }
    return map;
  }

  /**
   * GET /api/scoring/breakdown/:ticker
   * ---------------------------------------------------------------------------
   * SEMANTICS: "latest" = the MOST RECENT score (timestamp-ordered), matching
   * getLatestScores(). Consistent with Ladders — shows current activity, not
   * a historical peak. Optionally scoped to a protocol via ?protocol=.
   *
   * Returns the latest protocol-gated score with directive-level breakdown
   * for a symbol. Used by the Protocol Trail page to show WHY each directive
   * scored the way it did.
   */
  async getScoreBreakdown(ticker: string, protocolId?: string, runId?: string): Promise<any | null> {
    if (!this.prisma.isAvailable) return null;

    // If a specific runId (Score table UUID) is given, fetch that exact row.
    // Otherwise fall back to the latest score for this ticker+protocol.
    if (runId) {
      const row = await this.prisma.score.findUnique({
        where: { id: runId },
        select: { id: true, value: true, breakdown: true, timestamp: true, strategyId: true },
      });
      if (!row) return null;
      return {
        ticker: ticker.toUpperCase(),
        score: row.value,
        runId: row.id,
        strategyId: row.strategyId,
        timestamp: row.timestamp.toISOString(),
        breakdown: (row as any).breakdown ?? null,
      };
    }

    const sym = await this.prisma.symbol.findFirst({
      where: { ticker: ticker.toUpperCase() },
      select: { id: true },
    });
    if (!sym) return null;

    const where: any = {
      symbolId: sym.id,
      ...(protocolId ? { strategyId: protocolId } : {}),
    };
    const row = await this.prisma.score.findFirst({
      where,
      orderBy: { timestamp: 'desc' },
      select: { id: true, value: true, breakdown: true, timestamp: true, strategyId: true },
    });

    if (!row) return null;

    return {
      ticker: ticker.toUpperCase(),
      score: row.value,
      runId: row.id,
      strategyId: row.strategyId,
      timestamp: row.timestamp.toISOString(),
      breakdown: (row as any).breakdown ?? null,
    };
  }

  /**
   * GET /api/scoring/recently-analysed
   * Returns distinct symbols that have been scored, with their latest score
   * and ticker name, ordered by most recent first.
   */
  async getRecentlyAnalysed(limit = 30): Promise<RecentlyAnalysedSymbol[]> {
    if (!this.prisma.isAvailable) return [];
    const scores = await this.prisma.score.findMany({
      select: { symbolId: true, value: true, breakdown: true, timestamp: true },
      orderBy: { timestamp: 'desc' },
      take: 500,
    });

    const symbolMap = new Map<string, { symbolId: string; latestScore: number; latestConfidence: number; lastAnalysedAt: Date; totalRuns: number; latestSignal: string | null }>();
    for (const s of scores) {
      const existing = symbolMap.get(s.symbolId);
      if (!existing) {
        symbolMap.set(s.symbolId, {
          symbolId: s.symbolId, latestScore: s.value,
          latestConfidence: (s.breakdown as any)?.confidence ?? 0,
          lastAnalysedAt: s.timestamp, totalRuns: 1,
          latestSignal: (s.breakdown as any)?.signal ?? null,
        });
      } else {
        existing.totalRuns++;
      }
    }

    const symbolIds = Array.from(symbolMap.keys());
    const symbols = symbolIds.length > 0
      ? await this.prisma.symbol.findMany({ where: { id: { in: symbolIds } }, select: { id: true, ticker: true } }).catch(() => [])
      : [];
    const tickerMap = new Map((symbols as any[]).map((s: any) => [s.id, s.ticker]));

    return Array.from(symbolMap.values())
      .map((entry: any) => {
        const ticker: string = tickerMap.get(entry.symbolId) || entry.symbolId.slice(0, 8);
        // #738 — never threshold the raw composite (Score.value is unbounded,
        // often 100s-1000s) against the 60/40 tiers. Use the server-owned signal
        // (STRONG_BUY/BUY/HOLD/SELL/STRONG_SELL) persisted in the breakdown,
        // falling back to a neutral tier for legacy rows that predate it.
        // #1029 — see `analysisTier()`. Whole-token classification, never a prefix test.
        const signal: AnalysisTier = analysisTier(entry.latestSignal);
        return {
          symbolId: entry.symbolId, ticker,
          latestScore: Number(entry.latestScore.toFixed(1)),
          latestConfidence: Number(entry.latestConfidence.toFixed(2)),
          lastAnalysedAt: entry.lastAnalysedAt.toISOString(),
          totalRuns: entry.totalRuns, signal,
        };
      })
      .sort((a, b) => new Date(b.lastAnalysedAt).getTime() - new Date(a.lastAnalysedAt).getTime())
      .slice(0, limit);
  }

  /**
   * GET /api/scoring/protocols/:id/latest-score
   * ---------------------------------------------------------------------------
   * SEMANTICS: "latest" = the MOST RECENT score for this protocol (by
   * strategyId, timestamp-ordered). Used by Protocols Registry.
   *
   * NOTE: The Registry is the intended home for the HIGHEST score (labelled
   * as historical/stale, never a live signal). That is a separate concern —
   * this endpoint deliberately returns latest, matching Ladder semantics.
   * If Registry needs "peak over window", add a distinct method rather than
   * changing this one's meaning.
   */
  async getLatestProtocolScore(protocolId: string): Promise<{
    value: number;
    maxScore: number | null;
    opportunityScore: number | null;
    opportunityMax: number | null;
    symbolTicker: string;
    timestamp: string;
    breakdown: any;
  } | null> {
    if (!this.prisma.isAvailable) return null;

    const row = await this.prisma.score.findFirst({
      where: { strategyId: protocolId },
      orderBy: { timestamp: 'desc' },
      include: { symbol: { select: { ticker: true } } },
    });

    if (!row) return null;

    // Prefer the pre-gate raw composite when present. The stored `value` is the
    // FINAL gated composite — which a closed-market tradability gate zeroes out
    // even though the protocol still produced a real signal strength. The
    // Registry should show the score, not the gate result.
    const rawComposite = (row.breakdown as any)?.rawComposite;
    // Directional denominator (Phase C) — the score's own max, so `score/max`
    // stays consistent now that neutral/gate maxScores are excluded.
    const rawMax = (row.breakdown as any)?.rawMax;
    // Opportunity score (Phase C dual-score model) — additive screening total.
    const opportunityScore = (row.breakdown as any)?.opportunityScore ?? null;
    const opportunityMax = (row.breakdown as any)?.opportunityMax ?? null;

    return {
      value: typeof rawComposite === 'number' ? rawComposite : row.value,
      maxScore: typeof rawMax === 'number' ? rawMax : null,
      opportunityScore: typeof opportunityScore === 'number' ? opportunityScore : null,
      opportunityMax: typeof opportunityMax === 'number' ? opportunityMax : null,
      symbolTicker: (row as any).symbol?.ticker || row.symbolId,
      timestamp: row.timestamp.toISOString(),
      breakdown: row.breakdown,
    };
  }
}
