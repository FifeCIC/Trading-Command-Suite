import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

/**
 * SymbolProtocolAuthorityService — THE answer to "which protocols apply to this symbol".
 *
 * WHY THIS EXISTS (#926, 2026-09-27)
 * ----------------------------------
 * Six mechanisms each held a partial answer to that one question, and no two agreed. Measured
 * 2026-09-27 for XAUUSD: `symbol_protocol_assignment` said 2 protocols, the bots said 8, the
 * linked watchlists said 3, `GET /:ticker/protocols` said **0** (it read a legacy `strategy`
 * table that has nothing to do with any of the others), and `decision_log` showed a protocol
 * (`gold-macro-v1`) that appears in none of them. A symbol could therefore be *assigned but not
 * traded*, *traded but not assigned*, or *scored by neither* — and every consumer picked a
 * different mechanism, so two screens disagreed about the same symbol and neither looked wrong.
 *
 * This service is the ONE authority. It is a **ranked UNION**, not a first-hit chain:
 *
 * | rank | source       | what it means                                          |
 * |------|--------------|--------------------------------------------------------|
 * | 1    | `assignment` | an explicit `symbol_protocol_assignment` row           |
 * | 2    | `bot`        | an ACTIVE `trading_strategy` trades this symbol        |
 * | 3    | `watchlist`  | the protocol's FK-linked watchlist contains the symbol |
 * | 4    | `observed`   | a `score_snapshot` row proves it actually scored it    |
 *
 * ⚠️ **RANK, not a filter.** The point of #926 is that no single mechanism is complete, so the
 * weaker sources ADD protocols rather than being discarded. `rank` records which source is the
 * strongest evidence for each entry, so a consumer can render "assigned" differently from
 * "merely observed". Precedence is therefore visible data, not hidden behaviour.
 *
 * ⚠️ **Provenance is mandatory.** Every entry names the mechanisms that produced it. An entry
 * with no source is impossible by construction — it is pushed by a source or not at all.
 *
 * ⚠️ **The ID space is the trap.** Measured: `symbol_protocol_assignment.protocolId` holds
 * **UUIDs** while `trading_strategy.protocolId` holds **slugs**. Both are resolved through the
 * `protocol` table to a canonical **slug** before comparison, because two entries for one
 * protocol is the same defect as none.
 *
 * ⚠️ **An unresolvable id is REPORTED, never dropped.** `unresolved` exists so a row pointing at
 * a protocol that does not exist is visible. Silently skipping it is how "this symbol has three
 * protocols" becomes "this symbol has two" with no error — the failure shape this whole area
 * keeps producing.
 *
 * ⚠️ **An empty result is distinguishable from a failed query.** `sourcesQueried` records, per
 * mechanism, how many ids it produced and whether the query succeeded. A consumer must be able
 * to tell "nothing is associated with this symbol" from "the database did not answer".
 */
export type ProtocolSource = 'assignment' | 'bot' | 'watchlist' | 'observed';

/** Lower is stronger. Named, exported, and asserted by the guard — never inlined as a literal. */
export const SOURCE_RANK: Record<ProtocolSource, number> = {
  assignment: 1,
  bot: 2,
  watchlist: 3,
  observed: 4,
};

/** Best-first, so the reported `sources` list reads in precedence order. */
const SOURCE_ORDER: ProtocolSource[] = ['assignment', 'bot', 'watchlist', 'observed'];

/** One `protocol` row, keyed under BOTH its id and its slug so either form resolves to it. */
interface ProtocolIndexEntry {
  slug: string;
  name: string | null;
  active: boolean;
  recommendedTimeframe: string | null;
  tradingStyle: string | null;
  directionMode: string | null;
}

export interface ResolvedSymbolProtocol {
  /** Canonical SLUG — never a UUID, whatever the source row held. */
  protocolId: string;
  /** Human label from the `protocol` table; falls back to the slug when the row has no name. */
  name: string | null;
  active: boolean;
  /** Real protocol metadata, so a consumer never has to invent a default (the old `/protocols`
   *  hardcoded `intendedTimeframe: '1H'` for every protocol, which was simply untrue). */
  recommendedTimeframe: string | null;
  tradingStyle: string | null;
  directionMode: string | null;
  /** Every mechanism that produced this entry, best-first. Never empty. */
  sources: ProtocolSource[];
  /** The strongest source's rank (min across `sources`). 1 is strongest. */
  rank: number;
}

export interface SourceReport {
  source: ProtocolSource;
  /** Raw ids this source produced (before canonicalisation). */
  ids: number;
  /** False when the query threw — distinguishes "none" from "could not ask". */
  ok: boolean;
  error?: string;
}

export interface SymbolProtocolResolution {
  symbol: string;
  protocols: ResolvedSymbolProtocol[];
  count: number;
  /** Ids that matched no `protocol` row. Surfaced so drift is visible, never silently dropped. */
  unresolved: { id: string; from: ProtocolSource }[];
  /** Per-mechanism outcome, so "empty" and "failed" cannot look the same. */
  sourcesQueried: SourceReport[];
}

@Injectable()
export class SymbolProtocolAuthorityService {
  private readonly logger = new Logger(SymbolProtocolAuthorityService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Build the id → canonical-slug index from the `protocol` table.
   *
   * Both `id` and `slug` map to the same entry, which is what makes a UUID-bearing source and a
   * slug-bearing source comparable at all. `active` rides along so consumers can distinguish an
   * `active=0` protocol (which #803 records is NOT a kill switch) from a live one.
   */
  private async buildProtocolIndex(): Promise<Map<string, ProtocolIndexEntry>> {
    const index = new Map<string, ProtocolIndexEntry>();
    const rows: any[] = await (this.prisma as any).protocol.findMany({
      select: {
        id: true,
        slug: true,
        name: true,
        active: true,
        recommendedTimeframe: true,
        tradingStyle: true,
        directionMode: true,
      },
    });
    for (const r of rows) {
      const entry: ProtocolIndexEntry = {
        slug: String(r.slug),
        name: r.name ?? null,
        active: r.active === 1 || r.active === true,
        // ⚠️ `?? null`, NOT `|| '1H'`. A missing timeframe is a fact; a substituted one is a lie
        // the UI then renders as if it were configured.
        recommendedTimeframe: r.recommendedTimeframe ?? null,
        tradingStyle: r.tradingStyle ?? null,
        directionMode: r.directionMode ?? null,
      };
      // Key BOTH forms. A source may legitimately hold either; both must land on one entry.
      if (r.id) index.set(String(r.id), entry);
      if (r.slug) index.set(String(r.slug), entry);
    }
    return index;
  }

  /**
   * Which protocols apply to `ticker`, as a ranked union with provenance.
   *
   * Does NOT throw on an unknown ticker — that is a legitimate answer for a symbol with no
   * associations, and the caller already 404s on a symbol that does not exist.
   */
  async resolve(ticker: string): Promise<SymbolProtocolResolution> {
    const symbol = String(ticker ?? '').toUpperCase();
    const index = await this.buildProtocolIndex();

    /** canonical slug → the sources that produced it. */
    const found = new Map<string, Set<ProtocolSource>>();
    const unresolved: { id: string; from: ProtocolSource }[] = [];
    const reported: SourceReport[] = [];

    const note = (raw: unknown, from: ProtocolSource) => {
      if (raw === null || raw === undefined || String(raw).trim() === '') return;
      const key = String(raw).trim();
      const hit = index.get(key);
      if (!hit) {
        if (!unresolved.some((u) => u.id === key && u.from === from)) unresolved.push({ id: key, from });
        return;
      }
      if (!found.has(hit.slug)) found.set(hit.slug, new Set());
      found.get(hit.slug)!.add(from);
    };

    /** Run one source, recording whether it answered. Never lets one failure hide the others. */
    const runSource = async (source: ProtocolSource, fn: () => Promise<unknown[]>) => {
      try {
        const rows = await fn();
        let n = 0;
        for (const raw of rows) {
          if (raw === null || raw === undefined || String(raw).trim() === '') continue;
          n++;
          note(raw, source);
        }
        reported.push({ source, ids: n, ok: true });
      } catch (err) {
        // A failed query must be distinguishable from an empty one — this is the whole reason
        // `sourcesQueried` exists. It is reported, not swallowed into an empty list.
        reported.push({ source, ids: 0, ok: false, error: (err as Error).message });
        this.logger.warn(`symbol-protocol authority: source '${source}' failed for ${symbol}: ${(err as Error).message}`);
      }
    };

    // ── rank 1 — explicit assignment (rows hold UUIDs or slugs; both resolve above) ──
    await runSource('assignment', async () => {
      const rows: any[] = await (this.prisma as any).symbolProtocolAssignment.findMany({
        where: { symbol },
        select: { protocolId: true },
      });
      return rows.map((r) => r.protocolId);
    });

    // ── rank 2 — an ACTIVE bot trades this symbol under this protocol (`active: true` only:
    //    an inactive bot is not evidence that a protocol applies) ──
    await runSource('bot', async () => {
      const rows: any[] = await (this.prisma as any).tradingStrategy.findMany({
        where: { symbol, active: true },
        select: { protocolId: true },
      });
      return rows.map((r) => r.protocolId);
    });

    // ── rank 3 — the protocol's FK-linked watchlist contains this symbol.
    //    ⚠️ Read from the DATABASE. `getFocus()` reads the same membership from JSON files on
    //    disk (`src/data/watchlists/`), which is a second source of truth for one question and
    //    fails to an empty list in any install where that path is absent. The DB row is the
    //    durable one; #926 tracks moving `/focus` onto this authority.
    await runSource('watchlist', async () => {
      const rows: any[] = await (this.prisma as any).watchlist.findMany({
        where: { protocolId: { not: null } },
        select: { protocolId: true, symbols: true },
      });
      const out: string[] = [];
      for (const wl of rows) {
        let parsed: any = wl.symbols;
        if (typeof parsed === 'string') {
          try { parsed = JSON.parse(parsed); } catch { continue; }
        }
        if (!Array.isArray(parsed)) continue;
        const holds = parsed.some((s: any) => {
          const t = typeof s === 'string' ? s : (s?.ticker || s?.symbol || '');
          return String(t).toUpperCase() === symbol;
        });
        if (holds) out.push(wl.protocolId);
      }
      return out;
    });

    // ── rank 4 — EVIDENCE: a score snapshot proves this protocol actually scored this symbol.
    //    This is the only source that records what HAPPENED rather than what was configured,
    //    which is why it can catch `gold-macro-v1` — a protocol in no table for XAUUSD that was
    //    nonetheless scoring and trading it. ⚠️ `score_snapshot.protocolId` holds a SLUG. ──
    await runSource('observed', async () => {
      const rows: any[] = await (this.prisma as any).scoreSnapshot.findMany({
        where: { symbol },
        select: { protocolId: true },
        distinct: ['protocolId'],
      });
      return rows.map((r) => r.protocolId);
    });

    const protocols: ResolvedSymbolProtocol[] = [...found.entries()]
      .map(([slug, sources]) => {
        const meta = index.get(slug)!;
        const ordered = SOURCE_ORDER.filter((s) => sources.has(s));
        return {
          protocolId: slug,
          name: meta.name ?? slug,
          active: meta.active,
          recommendedTimeframe: meta.recommendedTimeframe,
          tradingStyle: meta.tradingStyle,
          directionMode: meta.directionMode,
          sources: ordered,
          rank: Math.min(...ordered.map((s) => SOURCE_RANK[s])),
        };
      })
      // Best evidence first, then alphabetical so the order is stable between calls.
      .sort((a, b) => a.rank - b.rank || a.protocolId.localeCompare(b.protocolId));

    return { symbol, protocols, count: protocols.length, unresolved, sourcesQueried: reported };
  }

  /**
   * Protocols whose ONLY evidence is observation — configured nowhere, yet scoring.
   *
   * Kept separate because it is the actionable subset: an `assignment`-backed protocol is
   * intended, while an `observed`-only one is a protocol scoring a symbol that no configuration
   * links to it. That is `gold-macro-v1`'s exact shape, and it deserves to be nameable.
   */
  async observedOnly(ticker: string): Promise<string[]> {
    const { protocols } = await this.resolve(ticker);
    return protocols.filter((p) => p.sources.length === 1 && p.sources[0] === 'observed').map((p) => p.protocolId);
  }
}
