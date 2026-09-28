/**
 * ProtocolDbService — DB-backed protocol lookup replacing hardcoded PROTOCOL_REGISTRY.
 *
 * Caches protocol configs for the duration of a tick (cleared per tick).
 * Returns the same DirectiveGroup[] shape as PROTOCOL_REGISTRY so consumers
 * don't need to change their interfaces.
 *
 * Phase D.1 of META.Stack DB-driven refactor.
 */

import { Injectable, Logger, OnModuleInit, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { DirectiveGroup } from '../directives/directive-groups';
import { DirectivesService } from '../directives/directives.service';
import { PROTOCOL_SEED_DATA } from './protocols-seed-data';
import { selectBaseTimeframe } from '../../common/utils/timeframe';

/**
 * Protocol symbol-derivation rules (#665, retired #764).
 *
 * ⚠️ RETIRED — THESE TABLES ARE INTENTIONALLY EMPTY.
 *
 * They map a protocol-name FRAGMENT to a symbol or watchlist name, and were the last
 * resort in `resolveSymbols()` when a protocol had neither an assignment nor a linked
 * watchlist. The audit (`scripts/audit-hint-dependency.cjs`) found **20 protocols relying
 * on them** — including 10 ACTIVE ones — which meant a protocol's symbols were being
 * GUESSED from its slug text rather than declared.
 *
 * That is not a relationship. It cannot survive a rename, it cannot report that it broke,
 * and it produced four stale targets after the #760 ticker consolidation (#761: `BTCUSD`,
 * `USOIL`, `DOGEUSD`, `CHN50`). Every protocol is now wired by foreign key — see
 * `docs/guides/symbol-onboarding-procedure.md` — so the audit reports:
 *
 *     ACTIVE: HINT_ONLY=0   ALL: HINT_ONLY=0
 *
 * The tables are kept as EMPTY typed arrays rather than deleted, for one reason: the code
 * path that reads them also carries the warning that tells an operator a protocol is
 * unwired. Deleting the arrays would delete the diagnostic with them. Kept empty, the
 * behaviour is:
 *
 *   - a correctly wired protocol never reaches this path;
 *   - an UNWIRED protocol resolves to NOTHING and logs exactly how to fix it — a loud,
 *     actionable failure instead of a silent, plausible guess.
 *
 * Do not repopulate these. Wire the protocol instead. If you think you need a hint, the
 * thing you actually need is a watchlist row linked via `watchlist.protocolId`.
 */
export const SINGLE_SYMBOL_HINTS: Array<{ match: string; symbol: string }> = [];

export const WATCHLIST_HINTS: Array<{ match: string; watchlist: string }> = [];

/** Pure: single symbol derived from a protocol slug, or null. */
export function deriveSingleSymbolFromSlug(slug: string): string | null {
  const id = slug.toLowerCase();
  for (const hint of SINGLE_SYMBOL_HINTS) {
    if (id.includes(hint.match)) return hint.symbol;
  }
  return null;
}

/**
 * Every ticker SINGLE_SYMBOL_HINTS can produce (#761).
 *
 * This table is a hardcoded map from a protocol *name* to a symbol *ticker*, and
 * nothing at runtime validates that the ticker still exists. When a symbol is
 * renamed or retired the hint keeps resolving happily to a ticker with no rows,
 * the protocol stalls, and the only symptom is a score that never appears —
 * which looks exactly like a quiet market. Exported so the contract gate can
 * assert every target resolves to a live, active symbol.
 */
export function allDerivedSymbolTargets(): string[] {
  return [...new Set(SINGLE_SYMBOL_HINTS.map((h) => h.symbol))];
}

export interface ProtocolConfig {
  groups: DirectiveGroup[];
  name: string;
  description: string;
  active?: boolean;
  directionMode?: 'LONG_ONLY' | 'SHORT_ONLY';
  tradingStyle?: string;
  recommendedTimeframe?: string;
  derivedFrom?: string | null;
  avgHoldTime?: string;
  winRateTarget?: string;
  idealFor?: string;
  note?: string | null;
  /** #689 — written intent: target behaviour, why these groups, what a good day looks like. */
  theory?: string | null;
  seasonalAffinity?: any;
  /** How to resolve symbols for this protocol. If absent, derived from protocol ID. */
  symbolResolution?: { type: 'single'; symbol: string } | { type: 'watchlist'; name: string };
}

@Injectable()
export class ProtocolDbService implements OnModuleInit {
  private readonly logger = new Logger(ProtocolDbService.name);
  private cache = new Map<string, ProtocolConfig | null>();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => DirectivesService))
    private readonly directivesService: DirectivesService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Preload in background — don't block startup
    this.preloadAll().catch((err) => {
      this.logger.warn(`Background protocol preload failed: ${(err as Error).message}`);
    });
  }

  /**
   * Compute the maximum bar requirement across all directives in this protocol.
   * Returns a map of timeframe → minimum bar count needed.
   *
   * For example, if a protocol has directives needing { '1d': 25 }, { '1d': 72 },
   * and { '1d': 16, '4h': 50 }, the result is { '1d': 72, '4h': 50 }.
   *
   * Used by the automation loop and manual scoring to dynamically size bar fetches.
   */
  getRequiredBars(protocolSlug: string): Record<string, number> {
    const cache = this.getAllCached();
    const protocol = cache[protocolSlug];
    if (!protocol) return { '1d': 100 }; // default fallback

    const required: Record<string, number> = {};

    // Collect all directive IDs across all groups in this protocol
    const allDirectiveIds = new Set<string>();
    for (const group of protocol.groups) {
      for (const did of group.directiveIds) {
        allDirectiveIds.add(did);
      }
    }

    // For each directive, look up its minBars and compute the max per timeframe
    for (const did of allDirectiveIds) {
      const directive = this.directivesService.get(did);
      if (!directive?.minBars) continue;

      for (const [tf, count] of Object.entries(directive.minBars)) {
        required[tf] = Math.max(required[tf] || 0, count);
      }
    }

    // Return defaults if nothing collected
    if (Object.keys(required).length === 0) {
      return { '1d': 100 };
    }

    return required;
  }

  /**
   * The bar count the BASE (live) cadence must be fetched at for a protocol.
   *
   * ⚠️ WHY THIS EXISTS — #1013, measured 2026-09-27.
   *
   * A directive cannot know the protocol's runtime cadence, so the convention is to declare
   * its real requirement under the GENERIC key `'1d'`. **74 of 108** directives do exactly
   * that; only 3 declare a base-cadence key. Consumers therefore sized the base fetch with
   * `required[tf] ?? required['1d'] ?? N` — a FALL-THROUGH, where the intent is a MAXIMUM. So
   * ONE directive declaring `'15m'` suppressed the fall-through and every larger generic
   * requirement was silently ignored.
   *
   * Measured: `btc-speed-v1` (`recommendedTimeframe '15m–1d'` → `selectBaseTimeframe` → `'15m'`
   * → `required['15m'] = 20`) starved 4 of its 13 directives on **246 of 247 ticks (99.6%)**
   * for 24h+ — each returning `0` with the reason `Insufficient data: need N bars, have 20`,
   * while 3,504 fresh 5m bars sat unused in `marketbar`. `bollinger-band-squeeze` needed 72.
   * Nothing threw: the `0` folded silently into an additive composite.
   *
   * ⚠️ Blast radius was MEASURED BEFORE changing it (`logs/probe-bar-window.cjs`): this rule
   * changes 2 of 48 protocols and provably cannot change the other 46 — when `base >= 1d` the
   * max equals today's value, and when `base` is absent the max equals `1d`.
   *
   * Four call sites previously open-coded the fall-through (the runner, the portfolio handler,
   * the automation loop's readiness gate, and the A/B path). They now call this, so the rule
   * has ONE home — the same reason `selectBaseTimeframe()` is a contract file.
   *
   * ⚠️ NOT used to size `loadHigherTfBundle()`'s 1d/1h/15m arrays: those are genuinely
   * per-cadence, and folding the generic key into them would be the overloading bug, not the fix.
   */
  getBaseBarCount(protocolSlug: string, timeframe?: string): number {
    const required = this.getRequiredBars(protocolSlug);
    const baseTf =
      timeframe || selectBaseTimeframe(this.getCached(protocolSlug)?.recommendedTimeframe) || '1d';
    const own = required[baseTf] ?? 0;
    const generic = required['1d'] ?? 0;
    // `|| 100` is effectively unreachable (getRequiredBars never returns an empty map) — it is
    // kept so this returns a usable number rather than 0 if that guarantee ever changes.
    return Math.max(own, generic) || 100;
  }

  /** Clear the cache at start of each tick. */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Resolve which symbols a protocol scores. Three paths, in priority order:
   * 1. Database: SymbolProtocolAssignment records (single-symbol assignments)
   * 2. Database: Watchlist linked via watchlist_id on protocol
   * 3. Auto-derived from protocol ID (fallback)
   */
  async resolveSymbols(protocolId: string): Promise<string[]> {
    // The id passed in may be a protocol SLUG (automation loop / control config) or
    // a UUID. Resolve to the canonical Protocol row so the DB lookups below match
    // either way — otherwise every symbol silently falls back to the hard-coded
    // hints in Path 3 (#747).
    let protoUuid: string | null = null;
    let protoSlug: string | null = null;
    try {
      const proto = await (this.prisma as any).protocol.findFirst({
        where: { OR: [{ slug: protocolId }, { id: protocolId }] },
        select: { id: true, slug: true },
      });
      if (proto) { protoUuid = proto.id; protoSlug = proto.slug; }
    } catch { /* protocol table best-effort */ }
    const idCandidates: string[] = [];
    for (const v of [protocolId, protoUuid, protoSlug]) {
      if (typeof v === 'string' && v.length > 0 && !idCandidates.includes(v)) idCandidates.push(v);
    }

    // Path 1: DB — SymbolProtocolAssignment records
    try {
      const assignments = await (this.prisma as any).symbolProtocolAssignment.findMany({
        where: { protocolId: { in: idCandidates } },
        select: { symbol: true },
      });
      if (assignments?.length > 0) {
        const syms: string[] = [];
        for (const a of assignments) {
          const s = String(a.symbol).toUpperCase();
          if (!syms.includes(s)) syms.push(s);
        }
        return syms;
      }
    } catch { /* table may not exist yet */ }

    // Path 2: DB — Watchlist linked to this protocol BY FOREIGN KEY.
    //
    // ⚠️ This is FK-only on purpose, and `protocolId` alone is the match (#763).
    // The previous version asked the database for a watchlist whose *name* equalled
    // the candidate id, normalised by hand. That is a name-matching heuristic, not a
    // relationship, and it was actively harmful: five watchlists exist TWICE with the
    // same name — once with a slug-shaped id (`leverage-long`) and once with a UUID —
    // and the old query used `LIMIT 1` with no `ORDER BY`, so which of the two a
    // protocol read depended on storage order. Editing the symbols on one row could
    // therefore change what a protocol scored, with no error. It also meant renaming
    // a watchlist broke resolution silently.
    //
    // A watchlist that names a protocol by FK cannot drift, cannot be ambiguous, and
    // survives renames. If a protocol has no linked watchlist, that is a real state
    // and it falls through to the (loud) derivation fallback below.
    try {
      const wls: any[] = await (this.prisma as any).$queryRawUnsafe(
        `SELECT symbols FROM watchlist
          WHERE protocolId IN (${idCandidates.map(() => '?').join(',')})
          ORDER BY (id REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-') DESC, id ASC`,
        ...idCandidates,
      );
      const syms: string[] = [];
      for (const wl of wls) {
        const parsed = typeof wl.symbols === 'string' ? JSON.parse(wl.symbols) : wl.symbols;
        if (!Array.isArray(parsed)) continue;
        for (const s of parsed) {
          const t = (typeof s === 'string' ? s : (s?.ticker || s?.symbol || '')).toUpperCase();
          if (t && !syms.includes(t)) syms.push(t);
        }
      }
      if (syms.length > 0) return syms;
    } catch { /* table may not exist yet */ }

    // Path 3: Auto-derived from protocol ID — a NAME-GUESSING FALLBACK, not a link.
    // The protocol has no assignment and no linked watchlist, so there is no
    // relationship to follow and we are inferring a symbol from the protocol's slug
    // text. That is exactly how four hints went stale after a ticker rename and left
    // protocols aimed at dead symbols with no error (#761). It is kept for
    // convenience but it MUST announce itself, because a guessed symbol is
    // indistinguishable from a wired one once the bars arrive (#763).
    const derived = await this.deriveSymbolsFromId(protocolId);
    if (derived.length > 0) {
      this.logger.warn(
        `Protocol "${protocolId}" has NO assignment and NO linked watchlist — symbols were GUESSED from its name: ` +
        `[${derived.join(', ')}]. This is not a pipeline relationship and will break silently if the symbol is renamed. ` +
        `Wire it properly: link a watchlist via watchlist.protocolId, or add a symbol_protocol_assignment row.`,
      );
    }
    return derived;
  }

  /** Auto-derive symbols from a protocol ID when no explicit config exists. */
  private async deriveSymbolsFromId(protocolId: string): Promise<string[]> {
    const id = protocolId.toLowerCase();

    // Single-symbol protocols — obvious from their name
    const single = deriveSingleSymbolFromSlug(protocolId);
    if (single) return [single];

    // Multi-symbol protocols — linked to named watchlists
    for (const hint of WATCHLIST_HINTS) {
      if (id.includes(hint.match)) {
        return this.getWatchlistSymbols(hint.watchlist);
      }
    }

    // Fallback: try a watchlist with matching name
    const wlSymbols = await this.getWatchlistSymbols(protocolId);
    if (wlSymbols.length > 0) return wlSymbols;

    return [];
  }

  /**
   * Get symbols from a watchlist by name (legacy fuzzy match, #763).
   *
   * ⚠️ Only reachable from the derivation fallback. Prefer a `watchlist.protocolId`
   * FK. The match normalises `-`/`_` to spaces and nothing else, so a real rename
   * (`momentum-stocks` → `Momentum Stocks (US)`) does NOT match and resolution drops
   * through to guessing. Ordering is pinned to the UUID row so a duplicate slug/UUID
   * pair can never resolve by storage order.
   */
  private async getWatchlistSymbols(name: string): Promise<string[]> {
    try {
      const wl: any[] = await (this.prisma as any).$queryRawUnsafe(
        `SELECT symbols FROM watchlist
          WHERE LOWER(REPLACE(REPLACE(name, '-', ' '), '_', ' ')) = LOWER(REPLACE(REPLACE(?, '-', ' '), '_', ' '))
          ORDER BY (id REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-') DESC, id ASC
          LIMIT 1`,
        name,
      );
      if (wl.length > 0 && wl[0].symbols) {
        const parsed = typeof wl[0].symbols === 'string' ? JSON.parse(wl[0].symbols) : wl[0].symbols;
        if (Array.isArray(parsed)) {
          return parsed.map((s: any) => typeof s === 'string' ? s.toUpperCase() : (s.ticker || s.symbol || '').toUpperCase()).filter(Boolean);
        }
      }
    } catch { /* best effort */ }
    return [];
  }

  /**
   * Find a protocol by slug. Returns the same shape as PROTOCOL_REGISTRY[slug].
   * Falls back to hardcoded registry if DB is unavailable.
   */
  async findBySlug(slug: string): Promise<ProtocolConfig | undefined> {
    // Check cache first
    const cached = this.cache.get(slug);
    if (cached !== undefined) return cached ?? undefined;

    try {
      if (!this.prisma.isAvailable) {
        this.cache.set(slug, null);
        return undefined;
      }

      const protocol = await (this.prisma as any).protocol.findUnique({
        where: { slug },
        include: {
          directiveGroups: {
            orderBy: { sortOrder: 'asc' },
            include: {
              directives: true,
            },
          },
        },
      });

      if (!protocol) {
        this.cache.set(slug, null);
        this.logger.warn(`Protocol "${slug}" not found in DB`);
        return undefined;
      }

      // Map DB shape → DirectiveGroup[] shape
      const groups: DirectiveGroup[] = protocol.directiveGroups.map((dg: any) => {
        const directiveMaxScores: Record<string, number> = {};
        const directiveIds: string[] = [];

        for (const entry of dg.directives) {
          directiveIds.push(entry.directiveId);
          if (entry.maxScore !== 100) {
            directiveMaxScores[entry.directiveId] = entry.maxScore;
          }
        }

        return {
          id: dg.groupId,
          name: dg.name,
          description: dg.description ?? '',
          weight: dg.weight,
          isRiskGate: dg.isRiskGate,
          minMultiplier: dg.minMultiplier,
          maxMultiplier: dg.maxMultiplier,
          directiveIds,
          ...(Object.keys(directiveMaxScores).length > 0 ? { directiveMaxScores } : {}),
        };
      });

      const config: ProtocolConfig = {
        groups,
        name: protocol.name,
        description: protocol.description ?? '',
        directionMode: (protocol.directionMode as 'LONG_ONLY' | 'SHORT_ONLY') || 'LONG_ONLY',
        tradingStyle: protocol.tradingStyle ?? undefined,
        recommendedTimeframe: protocol.recommendedTimeframe ?? undefined,
        derivedFrom: protocol.derivedFrom ?? null,
        avgHoldTime: protocol.avgHoldTime ?? undefined,
        winRateTarget: protocol.winRateTarget ?? undefined,
        idealFor: protocol.idealFor ?? undefined,
        seasonalAffinity: protocol.seasonalAffinity ?? undefined,
      };

      // #689 — `theory` is not in the Prisma client model yet; read via raw SQL.
      try {
        const row: any[] = await (this.prisma as any).$queryRawUnsafe(
          `SELECT theory FROM protocol WHERE slug = ?`, slug,
        );
        if (row.length > 0) (config as any).theory = row[0].theory ?? null;
      } catch { /* column may not exist yet */ }

      this.cache.set(slug, config);
      return config;
    } catch (err) {
      this.logger.warn(`Protocol DB lookup failed for "${slug}": ${(err as Error).message}`);
      this.cache.set(slug, null);
      return undefined;
    }
  }

  /**
   * Get all protocol slugs. Falls back to hardcoded registry keys.
   */
  async getAllSlugs(): Promise<string[]> {
    try {
      if (!this.prisma.isAvailable) return [];
      const protocols = await (this.prisma as any).protocol.findMany({ select: { slug: true } });
      return protocols.map((p: any) => p.slug);
    } catch {
      return [];
    }
  }

  /**
   * uniqueCopySlug() — an unused `…-copy` / `…-copy-N` slug for a cloned protocol.
   *
   * The suffix IS the recogniser: `deleteCopyProtocol()` refuses anything that does not match
   * the same pattern, so a copy can always be told apart from an original. Keep the two
   * patterns in step — they are a pair, and `validate-pipeline-contracts` does not cover this.
   */
  async uniqueCopySlug(sourceSlug: string): Promise<string> {
    const base = `${sourceSlug}-copy`;
    for (let n = 1; n < 100; n++) {
      const candidate = n === 1 ? base : `${base}-${n}`;
      const hit = await (this.prisma as any).protocol.findUnique({ where: { slug: candidate }, select: { id: true } });
      if (!hit) return candidate;
    }
    throw new Error(`Could not find a free copy slug for "${sourceSlug}" after 99 attempts`);
  }

  /**
   * copyProtocol() — the ONE write in this otherwise read-only service (2026-09-22).
   *
   * WHY IT LIVES HERE: copying a protocol is not a bot concern — it is a deep copy of the
   * protocol's own structure (groups, entries, symbol wiring, watchlists) that has to stay
   * exactly faithful, and this service is the single place that already knows that structure.
   * A second implementation in the trading module would be the copy that drifts.
   *
   * WHAT IS COPIED VERBATIM: every directive group (weight, riskGate, multipliers, sortOrder)
   * and every entry (directiveId, maxScore, active). maxScore is the per-directive WEIGHT — a
   * copy that re-defaulted it to 100 would silently rescore the variant.
   *
   * WHAT IS DELIBERATELY NOT COPIED:
   *   - `highestScore` / `adaptiveTarget*` — a fresh protocol has no history. Inheriting the
   *     source's peak would make the copy claim a ceiling it never measured (and adaptiveTarget
   *     is MONOTONIC by design — it must only ever grow from its own readings).
   *   - `isDefault` — only one protocol may be the default.
   *   - `derivedFrom` — is SET to the source slug: this is the A/B link the pair is read from.
   *
   * SYMBOL WIRING IS COPIED TOO, and that is not incidental: a copy with no symbols scores
   * nothing, so activating its bot would produce zero signals with no error — the decorative-bot
   * defect (#905) in a new coat. Both wiring paths are cloned:
   *   - `symbol_protocol_assignment` rows → new rows pointing at the copy's UUID;
   *   - `watchlist` rows linked by `protocolId` (Path 2 of resolveSymbols) → a new watchlist
   *     named "<name> (B)" pointing at the copy's slug.
   *
   * Caller is responsible for the slug (`uniqueCopySlug`) and for cleaning up on failure
   * (MyISAM — no transactions).
   */
  async copyProtocol(
    sourceSlug: string,
    opts: { slug: string; name?: string },
  ): Promise<{
    protocol: { id: string; slug: string };
    name: string;
    groups: number;
    entries: number;
    assignments: number;
    watchlists: Array<{ id: string; name: string }>;
  }> {
    const source: any = await (this.prisma as any).protocol.findUnique({
      where: { slug: sourceSlug },
      include: {
        directiveGroups: { orderBy: { sortOrder: 'asc' }, include: { directives: true } },
      },
    });
    if (!source) throw new Error(`Cannot copy protocol "${sourceSlug}" — no such protocol row`);

    const name = opts.name ?? `${source.name} (copy)`;
    const created: any = await (this.prisma as any).protocol.create({
      data: {
        slug: opts.slug,
        name,
        description: source.description ?? null,
        // ⚠️ `active` IS inherited. A copy of an active protocol must be able to score, or the
        // variant bot wired to it can never produce a signal. The copy still cannot TRADE until
        // its own bot is activated (copies start inactive).
        active: source.active,
        version: source.version ?? '1.0.0',
        directionMode: source.directionMode ?? 'LONG_ONLY',
        tradingStyle: source.tradingStyle ?? null,
        recommendedTimeframe: source.recommendedTimeframe ?? null,
        avgHoldTime: source.avgHoldTime ?? null,
        winRateTarget: source.winRateTarget ?? null,
        idealFor: source.idealFor ?? null,
        note: source.note ?? null,
        theory: source.theory ?? null,
        // The A/B link. `derivedFrom` is the field the pair is read from — never omit it.
        derivedFrom: source.slug,
        isDefault: false,
        seasonalAffinity: source.seasonalAffinity ?? undefined,
        highestScore: null,
        adaptiveTargetEnabled: source.adaptiveTargetEnabled ?? false,
        adaptiveTargetMax: null,
        adaptiveTargetSamples: 0,
        adaptiveTargetSince: null,
        directiveGroups: {
          create: (source.directiveGroups ?? []).map((dg: any) => ({
            groupId: dg.groupId,
            name: dg.name,
            description: dg.description ?? null,
            weight: dg.weight,
            isRiskGate: dg.isRiskGate,
            minMultiplier: dg.minMultiplier,
            maxMultiplier: dg.maxMultiplier,
            sortOrder: dg.sortOrder,
            directives: {
              create: (dg.directives ?? []).map((e: any) => ({
                directiveId: e.directiveId,
                maxScore: e.maxScore,
                active: e.active,
              })),
            },
          })),
        },
      },
      include: { directiveGroups: { include: { directives: true } } },
    });

    // Path 1 — explicit per-symbol assignments (protocolId is the protocol UUID here).
    let assignments = 0;
    try {
      const rows: any[] = await (this.prisma as any).symbolProtocolAssignment.findMany({
        where: { protocolId: source.id },
        select: { symbol: true, priority: true },
      });
      for (const r of rows) {
        await (this.prisma as any).symbolProtocolAssignment.create({
          data: { symbol: r.symbol, protocolId: created.id, priority: r.priority },
        });
        assignments += 1;
      }
    } catch (err) {
      this.logger.warn(`Copy ${opts.slug}: symbol assignments not copied — ${(err as Error).message}`);
    }

    // Path 2 — watchlists linked by `protocolId` (slug OR uuid; #763). Clone rather than share:
    // the watchlist row carries `protocolId`, so sharing it would leave the ORIGINAL protocol's
    // watchlist pointing at itself and the copy with nothing.
    const watchlists: Array<{ id: string; name: string }> = [];
    try {
      const rows: any[] = await (this.prisma as any).watchlist.findMany({
        where: { protocolId: { in: [source.slug, source.id] } },
        select: { name: true, symbols: true, source: true, userId: true, kind: true },
      });
      for (const wl of rows) {
        const wlName = `${wl.name} (B)`;
        const createdWl: any = await (this.prisma as any).watchlist.create({
          data: {
            name: wlName,
            symbols: wl.symbols,
            source: wl.source ?? null,
            protocolId: created.slug,
            userId: wl.userId ?? null,
            kind: wl.kind ?? 'user',
            isDefault: false,
          },
          select: { id: true, name: true },
        });
        watchlists.push({ id: createdWl.id, name: createdWl.name });
      }
    } catch (err) {
      this.logger.warn(`Copy ${opts.slug}: watchlists not copied — ${(err as Error).message}`);
    }

    // The copy must be visible to BOTH caches immediately: the tick cache is cleared, and the
    // sync preload is refreshed in the background so a protocol written now is not invisible
    // until the next restart.
    this.clearCache();
    void this.preloadAll().catch(() => { /* background refresh only */ });

    const groups = created.directiveGroups?.length ?? 0;
    const entries = (created.directiveGroups ?? []).reduce(
      (n: number, dg: any) => n + (dg.directives?.length ?? 0), 0,
    );

    this.logger.log(
      `Copied protocol "${source.slug}" → "${created.slug}" (${groups} group(s), ${entries} entry(ies), ` +
      `${assignments} assignment(s), ${watchlists.length} watchlist(s)); derivedFrom=${source.slug}`,
    );

    return { protocol: { id: created.id, slug: created.slug }, name, groups, entries, assignments, watchlists };
  }

  /**
   * deleteCopyProtocol() — remove a protocol COPY and every row the copy created.
   *
   * ⚠️ REFUSES a slug that is not a copy (`…-copy` / `…-copy-N`), whatever the caller believes.
   * The recogniser lives here, next to `uniqueCopySlug` that mints it — a caller must not be
   * the only thing standing between a shared original and a deleteMany.
   *
   * MyISAM has no FK enforcement, so children go first and explicitly: entries → groups → the
   * protocol row. Symbol wiring (assignments + watchlists) is removed with it, because it was
   * created for this copy alone.
   *
   * Caller is responsible for confirming nothing else references the copy. This method does not
   * check that — it is the mechanical half; the guard is in TradingStrategyService.remove().
   */
  async deleteCopyProtocol(ref: string): Promise<{
    slug: string;
    entries: number;
    groups: number;
    assignments: number;
    watchlists: number;
    /**
     * #1012 — `score_snapshot` rows this deletion ORPHANS.
     *
     * ⚠️ THEY ARE NOT DELETED, AND THAT IS THE DECISION. They are the only record of what this
     * protocol scored, and `score_snapshot` is what `/api/symbols/:ticker/protocols` enriches
     * from. A retention decision was made deliberately (register row 42): history is KEPT and the
     * orphan state is made VISIBLE rather than swept.
     *
     * ⚠️ Measured 2026-09-27: `hourly-3dir-v1-copy` was deleted by THIS method and left 1 row
     * orphaned. It is reported so the act is recorded, not silent.
     *
     * ⚠️ Returned rather than merely logged, because a caller that cannot see the number cannot
     * weigh it.
     */
    scoreSnapshots: number;
  } | null> {
    const row: any = await (this.prisma as any).protocol.findFirst({
      where: { OR: [{ slug: ref }, { id: ref }] },
      select: { id: true, slug: true },
    });
    if (!row) return null;
    if (!/-copy(-\d+)?$/.test(row.slug)) {
      throw new Error(`Refused: "${row.slug}" is not a copy (no -copy suffix) — refusing to delete it`);
    }

    // #1012 — count the history this leaves behind, BEFORE deleting anything.
    // ⚠️ Matched on BOTH the slug and the id: `score_snapshot.protocolId` normally holds a SLUG,
    // but a raw UUID was measured in it for XAUUSD (507 rows). Counting only the slug would
    // under-report exactly the rows that are hardest to find again.
    const scoreSnapshots = await (this.prisma as any).scoreSnapshot
      .count({ where: { protocolId: { in: [row.slug, row.id] } } })
      .catch(() => 0);

    const groups: any[] = await (this.prisma as any).protocolDirectiveGroup.findMany({
      where: { protocolId: row.id },
      select: { id: true },
    });
    const groupIds = groups.map((g) => g.id);
    const entries = groupIds.length
      ? await (this.prisma as any).protocolDirectiveEntry.deleteMany({ where: { groupId: { in: groupIds } } })
      : { count: 0 };
    const groupDel = await (this.prisma as any).protocolDirectiveGroup.deleteMany({ where: { protocolId: row.id } });
    const assignments = await (this.prisma as any).symbolProtocolAssignment.deleteMany({ where: { protocolId: row.id } });
    // Only the copy's own watchlists reference the copy slug, so this cannot remove a shared list.
    const watchlists = await (this.prisma as any).watchlist.deleteMany({
      where: { protocolId: { in: [row.slug, row.id] } },
    });
    await (this.prisma as any).protocol.delete({ where: { id: row.id } });

    this.clearCache();
    void this.preloadAll().catch(() => { /* background refresh only */ });
    this.logger.log(
      `Deleted protocol copy "${row.slug}" (${entries.count} entry(ies), ${groupDel.count} group(s), ` +
        `${assignments.count} assignment(s), ${watchlists.count} watchlist(s))` +
        (scoreSnapshots > 0
          ? ` — ⚠️ ORPHANED ${scoreSnapshots} score_snapshot row(s). They are KEPT as history (#1012); ` +
            'nothing will resolve them to a protocol name again.'
          : ''),
    );
    return {
      slug: row.slug,
      entries: entries.count,
      groups: groupDel.count,
      assignments: assignments.count,
      watchlists: watchlists.count,
      // #1012 — reported, not silent. These rows remain in `score_snapshot` as history.
      scoreSnapshots,
    };
  }

  /**
   * Get all protocol configs. DB-first, falls back to hardcoded registry.
   * Used by controllers that need to iterate all protocols.
   */
  async getAllProtocols(): Promise<Record<string, ProtocolConfig>> {
    try {
      if (!this.prisma.isAvailable) return {};
      const dbProtocols = await (this.prisma as any).protocol.findMany({
        include: {
          directiveGroups: {
            orderBy: { sortOrder: 'asc' },
            include: { directives: true },
          },
        },
      });
      if (!dbProtocols?.length) return {};

      // Read active status + note + theory via raw SQL — Prisma client may not have the columns yet
      let activeMap: Record<string, boolean> = {};
      let noteMap: Record<string, string | null> = {};
      let theoryMap: Record<string, string | null> = {};
      try {
        const rows: any[] = await (this.prisma as any).$queryRawUnsafe(
          `SELECT slug, active, note, theory FROM protocol`
        );
        for (const r of rows) {
          activeMap[r.slug] = !!r.active;
          noteMap[r.slug] = r.note ?? null;
          theoryMap[r.slug] = r.theory ?? null;
        }
      } catch { /* columns may not exist yet */ }

      const result: Record<string, ProtocolConfig> = {};
      for (const p of dbProtocols) {
        result[p.slug] = {
          groups: p.directiveGroups.map((dg: any) => ({
            id: dg.groupId,
            name: dg.name,
            description: dg.description ?? '',
            weight: dg.weight,
            isRiskGate: dg.isRiskGate,
            minMultiplier: dg.minMultiplier,
            maxMultiplier: dg.maxMultiplier,
            directiveIds: dg.directives.map((e: any) => e.directiveId),
            directiveMaxScores: Object.fromEntries(
              dg.directives.filter((e: any) => e.maxScore !== 100).map((e: any) => [e.directiveId, e.maxScore])
            ),
          })),
          name: p.name,
          description: p.description ?? '',
          active: activeMap[p.slug] ?? true, // Raw SQL read — Prisma client may not have column
          directionMode: (p.directionMode as any) || 'LONG_ONLY',
          tradingStyle: p.tradingStyle ?? undefined,
          recommendedTimeframe: p.recommendedTimeframe ?? undefined,
          derivedFrom: p.derivedFrom ?? null,
          avgHoldTime: p.avgHoldTime ?? undefined,
          winRateTarget: p.winRateTarget ?? undefined,
          idealFor: p.idealFor ?? undefined,
          note: noteMap[p.slug] ?? null,
          theory: theoryMap[p.slug] ?? null, // #689 — written intent, shown as the Theory section
          seasonalAffinity: p.seasonalAffinity ?? undefined,
        };
      }
      return result;
    } catch (err) {
      this.logger.warn(`getAllProtocols failed: ${(err as Error).message}`);
      return {};
    }
  }

  /**
   * Sync access to all protocols via preloaded cache.
   * Call preloadAll() at startup before using this.
   */
  private preloadedCache: Record<string, ProtocolConfig> | null = null;

  /** Preload all protocols into a sync-accessible cache. Call once at startup. */
  async preloadAll(): Promise<void> {
    this.preloadedCache = await this.getAllProtocols();
    this.logger.log(`Preloaded ${Object.keys(this.preloadedCache).length} protocols into sync cache`);
  }

  /** Sync lookup — returns from preloaded cache. */
  getCached(slug: string): ProtocolConfig | undefined {
    if (this.preloadedCache) return this.preloadedCache[slug];
    return undefined;
  }

  /** Sync access to all cached protocols. */
  getAllCached(): Record<string, ProtocolConfig> {
    if (this.preloadedCache) return this.preloadedCache;
    return {};
  }

  /**
   * Get all ACTIVE protocols as a flat list of slugs.
   * Used by the automation loop to iterate protocols for direct scoring
   * (NOT via scoring strategies — see DEVELOPMENT PHASE note in automation-loop.service.ts).
   *
   * Returns active slugs. Falls back to all cached slugs if DB is unavailable.
   */
  async findAllActive(): Promise<string[]> {
    try {
      if (!this.prisma.isAvailable) {
        // Fallback: all cached protocols
        return Object.keys(this.getAllCached());
      }
      const rows: any[] = await (this.prisma as any).$queryRawUnsafe(
        `SELECT slug FROM protocol WHERE active = 1`
      );
      return rows.map((r: any) => r.slug);
    } catch {
      // Column may not exist yet — return all cached
      return Object.keys(this.getAllCached());
    }
  }

  /**
   * Seed all protocols from the standalone seed data file into the DB.
   * Idempotent — uses upsert on all 3 tables. Safe to call multiple times.
   *
   * The seed data lives in protocols-seed-data.ts (generated from live DB via
   * scripts/dump-protocol-seed.cjs). It is NOT imported by any runtime consumer
   * — only by this seed method. This keeps it as an "installation file."
   *
   * Epic #510 Phase 4 — DB-Driven Architecture.
   */
  async seedProtocolsToDatabase(): Promise<{ seeded: number; groups: number; entries: number }> {
    let protocols = 0, groups = 0, entries = 0;
    for (const [slug, config] of Object.entries(PROTOCOL_SEED_DATA)) {
      try {
        const proto = await (this.prisma as any).protocol.upsert({
          where: { slug },
          create: {
            slug,
            name: config.name,
            description: config.description,
            directionMode: config.directionMode || 'LONG_ONLY',
            tradingStyle: config.tradingStyle,
            recommendedTimeframe: config.recommendedTimeframe,
            avgHoldTime: config.avgHoldTime,
            winRateTarget: config.winRateTarget,
            idealFor: config.idealFor,
            derivedFrom: (config as any).derivedFrom ?? null,
            isDefault: true,
          },
          update: {
            name: config.name,
            description: config.description,
            directionMode: config.directionMode || 'LONG_ONLY',
            tradingStyle: config.tradingStyle,
            recommendedTimeframe: config.recommendedTimeframe,
            avgHoldTime: config.avgHoldTime,
            winRateTarget: config.winRateTarget,
            idealFor: config.idealFor,
            derivedFrom: (config as any).derivedFrom ?? null,
          },
        });
        protocols++;

        for (const [idx, group] of config.groups.entries()) {
          const dg = await (this.prisma as any).protocolDirectiveGroup.upsert({
            where: { protocolId_groupId: { protocolId: proto.id, groupId: group.id } },
            create: {
              protocolId: proto.id,
              groupId: group.id,
              name: group.name,
              description: group.description,
              weight: group.weight,
              isRiskGate: group.isRiskGate,
              minMultiplier: group.minMultiplier,
              maxMultiplier: group.maxMultiplier,
              sortOrder: idx,
            },
            update: {
              name: group.name,
              weight: group.weight,
              isRiskGate: group.isRiskGate,
              minMultiplier: group.minMultiplier,
              maxMultiplier: group.maxMultiplier,
              sortOrder: idx,
            },
          });
          groups++;

          for (const did of group.directiveIds) {
            // maxScore is single-sourced from the directive class (2026-08-13 refactor).
            // The seed file no longer carries per-protocol directiveMaxScores overrides.
            const maxScore = this.directivesService.get(did)?.maxScore ?? 100;
            await (this.prisma as any).protocolDirectiveEntry.upsert({
              where: { groupId_directiveId: { groupId: dg.id, directiveId: did } },
              create: {
                groupId: dg.id,
                directiveId: did,
                maxScore,
                active: true,
              },
              update: { maxScore },
            });
            entries++;
          }
        }
      } catch (err) {
        this.logger.warn(`Failed to seed protocol ${slug}: ${(err as Error).message}`);
      }
    }
    this.logger.log(`Seeded ${protocols} protocols, ${groups} groups, ${entries} entries to DB`);
    return { seeded: protocols, groups, entries };
  }

  /** Check if any protocol needs EURUSD data for its directives. */
  protocolNeedsEurUsd(slug: string): boolean {
    const config = this.getCached(slug);
    if (!config) return false;
    for (const group of config.groups) {
      for (const did of group.directiveIds) {
        if (['dxy-regime', 'gold-macro-correlation', 'cad-usd-oil-correlation'].includes(did)) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Convenience: get protocol name for display.
   */
  async getName(slug: string): Promise<string> {
    const config = await this.findBySlug(slug);
    return config?.name ?? slug;
  }
}
