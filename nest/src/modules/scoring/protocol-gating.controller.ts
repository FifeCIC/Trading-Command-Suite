import { BadRequestException, Controller, Get, Post, Patch, Param, Body, Logger, Query } from '@nestjs/common';
import { ProtocolGatingService, GatedScore, SIGNAL_THRESHOLDS } from './protocol-gating.service';
import {
  STYLE_THRESHOLDS,
  SIGNALS_GATE_DEFAULT,
  BOT_BAR_DEFAULT,
} from '../../common/utils/style-thresholds';
import { PrismaService } from '../../database/prisma.service';
import { MarketDataService } from '../market-data/market-data.service';
import { PortfolioService } from '../portfolio/portfolio.service';
import { ProtocolDbService } from './protocol-db.service';
import { DirectivesService } from '../directives/directives.service';
import { DirectiveConfigService } from './directive-config.service';
import { ProtocolHealthIssue, ProtocolHealthService } from './protocol-health.service';
import { isDirectiveIncluded } from '../directives/directive-inclusion';
import { resolveAdaptiveTarget, ADAPTIVE_TARGET_MIN_SAMPLES } from './adaptive-target';
import { selectBaseTimeframe } from '../../common/utils/timeframe';

/** One decimal place, or the UI reads 46.50000000000001. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Protocol Gating Controller — META.Stack Canonical Scoring
 * ==========================================================
 * CANONICAL ROLE (2026-07-29): The authoritative scoring path for
 * trading decisions. This is the META.Stack pipeline:
 *
 *   Market Data → Protocol → Directives → Group Scores → Risk Gate → Composite
 *
 * Unlike /api/scoring/ranked (which runs ALL 104 directives flat),
 * this pipeline:
 *   1. Scopes to a single protocol (~8-16 directives instead of 104)
 *   2. Applies risk-gate chains (max score multipliers)
 *   3. Computes rarity-weighted composites
 *   4. Excludes ALPHA-tier (mock) directives
 *   5. Returns full directive breakouts with gate reasoning
 *
 * Use for:
 *   - Ladder page (strategy comparison)
 *   - A/B Testing (protocol comparison)
 *   - META.Stack Explorer (pipeline visualization)
 *   - Speed Trading (protocol-scoped quick decisions)
 *   - Automation loop (tick scoring)
 *
 * ~7× cheaper than unfiltered rankAll due to protocol scoping.
 *
 * @see #497 — handoff 2026-07-29-scoring-paths-audit-497.md (central docs store)
 */

@Controller('scoring/gated')
export class ProtocolGatingController {
  private readonly logger = new Logger(ProtocolGatingController.name);

  constructor(
    private readonly protocolGating: ProtocolGatingService,
    private readonly marketData: MarketDataService,
    private readonly portfolio: PortfolioService,
    private readonly prisma: PrismaService,
    private readonly protocolDb: ProtocolDbService,
    private readonly directivesService: DirectivesService,
    private readonly configService: DirectiveConfigService,
    private readonly health: ProtocolHealthService,
  ) {}

  /**
   * GET /api/scoring/gated/protocols/health
   *
   * Static protocol-config validation (#716 follow-up, 2026-09-03): flags
   * empty groups, unknown directives, duplicates, zero-weight groups, and
   * missing risk gates BEFORE they corrupt scoring output. Also logged on boot.
   */
  @Get('protocols/health')
  async protocolsHealth() {
    // ⚠️ #905 — the measured-ceiling audit MUST be part of this response. It previously ran
    // only in `onApplicationBootstrap()`, so "can this bot ever fire?" was answered once in a
    // boot log and invisible on every subsequent call — an operator-facing health surface
    // that said clean. (`getLast()` has no callers; merging here IS the surface.)
    const configIssues = await this.health.validateAll();
    let ceilingIssues: ProtocolHealthIssue[] = [];
    try {
      ceilingIssues = await this.health.auditMeasuredCeilings();
    } catch (err) {
      this.logger.warn(`Measured-ceiling audit failed: ${(err as Error).message}`);
    }
    return { generatedAt: new Date().toISOString(), issues: [...configIssues, ...ceilingIssues] };
  }

  /**
   * GET /api/scoring/gated/thresholds
   *
   * EVERY trade threshold in one place, with the measured ceiling it is compared against.
   *
   * ⚠️ WHY THIS EXISTS
   * -----------------
   * On 2026-09-10 the app stopped trading completely and nobody could see why. ADR-011
   * changed the percentage DENOMINATOR from the observed directional sum (~130) to the
   * configured capacity (~725-815) — ~6.3x larger — which divided every percentage by that
   * factor. Every threshold stayed on the old scale, so `ENTRY_THRESHOLD = 40` classified
   * every tick as HOLD and nothing was ever queued. Trading resumed 2026-09-15 once the
   * thresholds were rescaled.
   *
   * Three people had written the diagnosis in code comments. **Nobody could SEE the
   * numbers**, so it was never fixed. This endpoint exists so that class of failure is
   * visible: a bar above its achieved ceiling is a bot that cannot fire, and it should be
   * obvious rather than inferable.
   *
   * `achievedPct` is the best compositePct the bot's protocol has actually produced in the
   * window. `clears` is the verdict — the single most useful cell in the response.
   */
  @Get('thresholds')
  async thresholds() {
    const WINDOW_DAYS = 7;

    // Per-bot bar vs its protocol's measured ceiling. Note the COLLATE: `score.strategyId`
    // is defined with a different collation from `trading_strategy.protocolId`, and MySQL
    // refuses the comparison without it.
    const bots = await this.prisma.$queryRawUnsafe<Array<{
      name: string; symbol: string; protocolId: string; mode: string; active: number;
      minComposite: number; achievedPct: number | null; samples: bigint;
    }>>(`
      SELECT ts.name, ts.symbol, ts.protocolId, ts.mode, ts.active, ts.minComposite,
             MAX(s.breakdown->>'$.rawComposite' / NULLIF(s.breakdown->>'$.configuredSignalMax', 0) * 100) AS achievedPct,
             COUNT(s.id) AS samples
      FROM trading_strategy ts
      LEFT JOIN score s
        ON s.strategyId COLLATE utf8mb4_unicode_ci = ts.protocolId COLLATE utf8mb4_unicode_ci
       AND s.timestamp >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${WINDOW_DAYS} DAY)
      GROUP BY ts.id, ts.name, ts.symbol, ts.protocolId, ts.mode, ts.active, ts.minComposite
      ORDER BY ts.active DESC, ts.minComposite ASC, ts.name ASC
    `);

    const rows = bots.map((b) => {
      const achieved = b.achievedPct == null ? null : Number(b.achievedPct);
      const samples = Number(b.samples);
      return {
        name: b.name,
        symbol: b.symbol,
        protocolId: b.protocolId,
        mode: b.mode,
        active: b.active === 1,
        barPct: Number(b.minComposite),
        achievedPct: achieved == null ? null : Math.round(achieved * 10) / 10,
        samples,
        // Three outcomes, kept distinct on purpose. "no data" is NOT "cannot fire" —
        // conflating them is how a protocol looks broken when it is merely unmeasured.
        clears: achieved == null ? 'no-data' : achieved >= Number(b.minComposite) ? 'yes' : 'no',
      };
    });

    // ── Per-PROTOCOL measured ceiling (#840) ────────────────────────────────────────────────────
    //
    // ⚠️ WHY THIS IS SEPARATE FROM `bots` ABOVE. The per-bot rows answer "did THIS bot clear its
    // bar" — which needs the bot to exist. The create form has no bot yet, so it needs the ceiling
    // for ANY protocol, whether or not one has ever been configured. Same measurement, different
    // question, so it is a second query rather than a wider join.
    //
    // ⚠️ ALL-TIME, NOT WINDOWED. `ProtocolHealthService` compares a bot's bar against the protocol's
    // "highest composite EVER recorded", and that is the right basis here too: a bar above the
    // all-time maximum is one the protocol has NEVER cleared, so restricting to 7 days would both
    // understate the ceiling and make the warning flicker as history rolls off. This is the reuse
    // the issue asked for — same definition, computed once for the create path.
    //
    // ⚠️ SAME SCALE AS `minComposite`. The percentage is `rawComposite / configuredSignalMax * 100`,
    // identical to `achievedPct` above, so the form compares like with like. A raw composite here
    // would be a units mismatch — the exact class of defect #839 was.
    let protocolCeilings: Record<string, { ceilingPct: number; samples: number }> = {};
    try {
      const ceilings = await this.prisma.$queryRawUnsafe<Array<{
        protocolId: string; ceilingPct: number | null; samples: bigint;
      }>>(`
        SELECT s.strategyId AS protocolId,
               MAX(s.breakdown->>'$.rawComposite' / NULLIF(s.breakdown->>'$.configuredSignalMax', 0) * 100) AS ceilingPct,
               COUNT(s.id) AS samples
        FROM score s
        WHERE s.strategyId IS NOT NULL
        GROUP BY s.strategyId
      `);
      for (const c of ceilings) {
        if (c.ceilingPct == null) continue;
        protocolCeilings[String(c.protocolId)] = {
          ceilingPct: Math.round(Number(c.ceilingPct) * 10) / 10,
          samples: Number(c.samples),
        };
      }
    } catch (err) {
      // Non-fatal: the form simply cannot warn. Do NOT return an empty map silently as if every
      // protocol were unmeasured — that would present "no warning" as "nothing to warn about".
      this.logger.warn(`Per-protocol ceiling lookup failed: ${(err as Error).message}`);
      protocolCeilings = {};
    }

    return {
      generatedAt: new Date().toISOString(),
      windowDays: WINDOW_DAYS,
      classification: SIGNAL_THRESHOLDS,
      preTradeGate: {
        default: SIGNALS_GATE_DEFAULT,
        botBarFallback: BOT_BAR_DEFAULT,
        byStyle: STYLE_THRESHOLDS,
        note: 'Per-protocol override > trading style > default. The gate blocks a signal when signalPct is below the resolved bar.',
      },
      /**
       * Highest percentage each protocol has EVER achieved. Used by the create form to warn when a
       * typed bar is above everything that protocol has reached (#840). `samples` lets the caller
       * distinguish "measured and low" from "barely measured" — a ceiling from 3 readings is not
       * evidence, which is the same 10-sample floor `ProtocolHealthService` uses.
       */
      protocolCeilings,
      bots: rows,
      summary: {
        total: rows.length,
        active: rows.filter((r) => r.active).length,
        activeClearing: rows.filter((r) => r.active && r.clears === 'yes').length,
        // The number that would have flagged the 2026-09-10 outage immediately.
        activeCannotFire: rows.filter((r) => r.active && r.clears === 'no').length,
        activeNoData: rows.filter((r) => r.active && r.clears === 'no-data').length,
      },
    };
  }

  /**
   * GET /api/scoring/gated/reachable-capacity
   *
   * How much of each protocol's configured denominator has NEVER been earned directionally —
   * and therefore what its ceiling becomes on a scale that excludes that capacity.
   *
   * ⚠️ WHY THIS EXISTS (#761 point 3)
   * --------------------------------
   * `thresholds` reports `protocolCeilings`: the best percentage a protocol has EVER achieved,
   * `rawComposite / configuredSignalMax`. #761 established those percentages are honest but that
   * the BANDS were calibrated on the old inflated scale — and its point 3 asks the follow-up
   * question directly: *"configured capacity includes directives that are structurally unlikely to
   * fire together, so the practical ceiling is well below the configured max. Worth measuring the
   * realistic maximum."* This endpoint is that measurement. `peakReachPct` is the ceiling on a
   * scale containing only capacity that has actually been earned at least once.
   *
   * ⚠️ OUTCOME-ONLY. IT READS NO DECLARED BIAS. Read this before "simplifying" it.
   * ---------------------------------------------------------------------------------
   * Capacity MUST NOT be derived from `directionBias` — tried 2026-09-10, reverted, settled in
   * ADR-011 / SETTLED-DECISIONS row 9, and guarded by `directional-capacity-contract.spec.ts`.
   * Declared bias massively understates what directives emit (`macd-crossover` declares `neutral`
   * and fires directionally 5,252×), so gating capacity on it excludes the directives doing the
   * real work. `ProtocolHealthService`'s `low-declared-directional-capacity` warning was RETIRED
   * for exactly this reason (#906) after firing for 14 of 17 protocols.
   *
   * So the denominator here is not re-derived at all. It is READ from the recorded breakdown as
   * `$.configuredSignalMax` — the scorer's own value for that tick.
   *
   * ⚠️ AND IT IS VERIFIED, NOT ASSUMED. Measured 2026-09-26 over 3,000 live rows, 0 mismatches:
   *     configuredSignalMax == Σ maxScore over NON-GATE directives
   * Gate groups resolve by (protocolId, groupId-KIND). This is load-bearing: `breakout.groupId` is
   * a KIND ('risk' | 'technical' | 'sentiment'), NOT the group UUID — keying on the UUID matches
   * nothing, silently excludes no gate, and inflates every denominator by exactly the gate capacity
   * (100 here, 200 for `vix-spike-v1`). That was the first version's bug.
   *
   * ⚠️ `unobserved` IS NOT `neverDirectional`. A directive never exercised in the window looks
   * identical to one that is structurally incapable. Collapsing them turns "not measured" into
   * "cannot fire", which is how a protocol gets called broken when it is merely quiet.
   *
   * ⚠️ NOT A WARNING. This returns raw numbers with their explanation and asserts no verdict.
   * A high `neverPct` is largely a STRUCTURAL property of the stable-denominator design (row 2/3:
   * direction eligibility comes from config, not the tick), not a per-protocol fault. That is why
   * the retired warning's framing is not reproduced here.
   *
   * ⚠️ COST: ~500 ms (JSON_TABLE over `score.breakdown`), flat across 1/7/30-day windows. That is
   * why this is its OWN endpoint rather than a field on `thresholds` — bolting it on would make the
   * Settings page 500 ms slower for every reader.
   */
  @Get('reachable-capacity')
  async reachableCapacity(@Query('days') daysRaw?: string) {
    const DAYS = Math.min(Math.max(Number(daysRaw) || 7, 1), 90);
    const since = new Date(Date.now() - DAYS * 24 * 3600 * 1000);

    // ── Gate groups: (protocolId, groupId-KIND) → isRiskGate ────────────────────────────────────
    const gateRows = await this.prisma.protocolDirectiveGroup.findMany({
      select: { protocolId: true, groupId: true, isRiskGate: true },
    });
    const isGate = new Map(gateRows.map((g) => [`${g.protocolId}::${g.groupId}`, g.isRiskGate === true]));
    // Fallback for a row whose protocol is absent: any kind that is a gate anywhere.
    const gateKinds = new Set(gateRows.filter((g) => g.isRiskGate === true).map((g) => g.groupId));

    const rows = await this.prisma.$queryRawUnsafe<Array<{ strategyId: string; breakdown: unknown }>>(
      `SELECT strategyId, breakdown FROM score WHERE strategyId IS NOT NULL AND timestamp > ?`,
      since,
    );

    const per = new Map<
      string,
      { cap: Map<string, number>; dir: Set<string>; peak: number; ticks: number }
    >();

    for (const r of rows) {
      const b = (typeof r.breakdown === 'string' ? JSON.parse(r.breakdown) : r.breakdown) as {
        breakouts?: Record<string, Array<{ directiveId?: string; maxScore?: number; signalClass?: string; groupId?: string }>>;
        rawComposite?: number;
      } | null;
      if (!b?.breakouts) continue;

      const slug = r.strategyId;
      if (!per.has(slug)) per.set(slug, { cap: new Map(), dir: new Set(), peak: 0, ticks: 0 });
      const p = per.get(slug)!;
      p.ticks++;
      const raw = Number(b.rawComposite ?? 0);
      if (raw > p.peak) p.peak = raw;

      for (const [gid, arr] of Object.entries(b.breakouts)) {
        for (const e of arr) {
          if (!e?.directiveId) continue;
          const kind = e.groupId || gid;
          if (isGate.get(`${slug}::${kind}`) ?? gateKinds.has(kind)) continue; // gate capacity is not in the denominator
          if (!p.cap.has(e.directiveId)) p.cap.set(e.directiveId, Number(e.maxScore || 0));
          if (e.signalClass === 'bullish' || e.signalClass === 'bearish') p.dir.add(e.directiveId);
        }
      }
    }

    const protocols = [...per.entries()]
      .map(([slug, p]) => {
        let configuredCapacity = 0;
        let reachableCapacity = 0;
        for (const [id, max] of p.cap) {
          configuredCapacity += max;
          if (p.dir.has(id)) reachableCapacity += max;
        }
        const neverCapacity = configuredCapacity - reachableCapacity;
        return {
          slug,
          ticks: p.ticks,
          directivesObserved: p.cap.size,
          configuredCapacity,
          reachableCapacity,
          neverCapacity,
          neverPct: configuredCapacity > 0 ? round1((100 * neverCapacity) / configuredCapacity) : 0,
          peakComposite: p.peak,
          /** Best % against the FULL denominator — reconciles with `thresholds.protocolCeilings`. */
          peakPctOfConfigured: configuredCapacity > 0 ? round1((100 * p.peak) / configuredCapacity) : 0,
          /**
           * Best % against capacity that has been earned at least once — #761 point 3's "realistic
           * maximum". `null` (not 0) when nothing was ever directional: nothing was reachable, so
           * there is no ratio rather than a ratio of zero.
           */
          peakPctOfReachable: reachableCapacity > 0 ? round1((100 * p.peak) / reachableCapacity) : null,
          /** Directives never once directional in the window, with the capacity each carries. */
          neverDirectionalDirectives: [...p.cap.keys()].filter((id) => !p.dir.has(id)).sort(),
        };
      })
      .sort((a, b) => b.neverPct - a.neverPct);

    const medians = protocols.map((p) => p.neverPct).sort((a, b) => a - b);
    const median = medians.length ? medians[Math.floor(medians.length / 2)] : 0;

    return {
      generatedAt: new Date().toISOString(),
      windowDays: DAYS,
      baseline: {
        rowsScanned: rows.length,
        protocols: protocols.length,
      },
      /**
       * Raw numbers, not a verdict. High is largely structural — see the method docblock.
       * The canonical measurement is `nest/scripts/analyse-unreachable-capacity.cjs`; this endpoint
       * reports the same figure, cross-validated against it (both 46.5% median, 2026-09-26).
       */
      method: {
        denominator: 'read from $.configuredSignalMax in the recorded breakdown — NOT re-derived from config',
        direction: 'outcome — did this directive in this protocol EVER record bullish/bearish?',
        gateHandling: 'gate groups excluded by (protocolId, groupId-kind); verified Σ non-gate maxScore == configuredSignalMax on 3,000 rows',
        caution: 'A directive never exercised looks identical to one that is incapable. Treat a high neverPct as "investigate", not as proof.',
      },
      summary: {
        medianNeverPct: round1(median),
        worst: protocols[0] ? { slug: protocols[0].slug, neverPct: protocols[0].neverPct } : null,
        best: protocols.length ? { slug: protocols[protocols.length - 1].slug, neverPct: protocols[protocols.length - 1].neverPct } : null,
      },
      protocols,
    };
  }

  /**
   * GET /api/scoring/gated/protocols
   *
   * Lists all available protocols from code registry + DB strategies.
   */
  @Get('protocols')
  async listProtocols() {
    const protocols: Array<{
      id: string;
      name: string;
      description: string;
      source: 'code' | 'database';
      directiveCount: number;
      maxScore: number;
      active: boolean;
      groups?: Array<{
        id: string;
        name: string;
        isRiskGate: boolean;
        weight: number;
        directives: Array<{ id: string; maxScore: number }>;
      }>;
      tradingStyle?: string;
      recommendedTimeframe?: string;
      derivedFrom?: string | null;
      directionMode?: string;
      avgHoldTime?: string;
      winRateTarget?: string;
      idealFor?: string;
      note?: string | null;
      theory?: string | null; // #689 — written intent (target behaviour, why these groups, what a good day looks like)
      readiness?: { ready: boolean; blockers: Array<{ directiveId: string; name: string; readiness: string }> };
      // Adaptive Target (2026-09-10) — surfaced here so the Ladder can badge a card
      // without a second request per protocol. `adaptiveTargetActive` is the question the
      // UI actually asks: 'is this protocol's score measured on a different scale?'
      adaptiveTargetEnabled?: boolean;
      adaptiveTargetActive?: boolean;
      adaptiveTargetMax?: number | null;
      adaptiveTargetSamples?: number;
      // Set after construction by async resolveSymbols() below
      resolvedSymbols?: string[];
    }> = [];

    // Code-registered protocols (from DB-backed ProtocolDbService)
    const allProtocols = this.protocolDb.getAllCached();

    // Load directive config (global + per-protocol overrides) once so the
    // registry maxScore stays in lockstep with the scoring engine (#609/#637).
    const globalConfigs = await this.configService.getAllConfigs();
    const allOverrides = await this.configService.getAllProtocolOverrides();

    // Adaptive Target state for every protocol in ONE query — the Ladder badges cards from
    // this, so it must not be a per-protocol round trip.
    const adaptiveBySlug = new Map<string, { enabled: boolean; max: number | null; samples: number }>();
    try {
      const rows: any[] = await (this.prisma as any).$queryRawUnsafe(
        `SELECT slug, adaptiveTargetEnabled AS e, adaptiveTargetMax AS m, adaptiveTargetSamples AS s FROM protocol`,
      );
      for (const r of rows ?? []) {
        adaptiveBySlug.set(String(r.slug), {
          enabled: !!r.e,
          max: r.m == null ? null : Number(r.m),
          samples: Number(r.s ?? 0),
        });
      }
    } catch {
      // Column may not exist on an older DB — Adaptive Target simply reads as off.
    }

    for (const [id, proto] of Object.entries(allProtocols)) {
      // Skip protocols with no directive groups — these are ghost entries
      // from legacy seed data (e.g. "Signals Workbench", "Conviction Dip Accumulation")
      if (!proto.groups?.length) continue;

      const directionMode = (proto as any).directionMode || 'LONG_ONLY';

      // Shared inclusion rule — same one the scoring engine uses
      // (directive-inclusion.ts). Keeps the registry's maxScore /
      // directiveCount identical to what actually gets scored.
      const isIncluded = (did: string): boolean =>
        isDirectiveIncluded(this.directivesService.get(did), directionMode);

      // Effective maxScore = protocol override → global config → class.
      const overrides = allOverrides.get(id);
      const effectiveMax = (did: string): number => {
        const reg = this.directivesService.get(did);
        return overrides?.get(did)?.maxScore ?? globalConfigs.get(did)?.maxScore ?? reg?.maxScore ?? 100;
      };

      const groups = proto.groups.map((g) => ({
        id: g.id,
        name: g.name,
        isRiskGate: g.isRiskGate,
        weight: g.weight,
        minMultiplier: g.isRiskGate ? g.minMultiplier : undefined,
        maxMultiplier: g.isRiskGate ? g.maxMultiplier : undefined,
        directives: g.directiveIds.filter(isIncluded).map((did) => {
          const reg = this.directivesService.get(did);
          return {
            id: did,
            name: reg?.name ?? did,
            description: reg?.description ?? '',
            maxScore: effectiveMax(did),
          };
        }),
      }));

      const maxScore = proto.groups.reduce(
        (sum, g) => sum + g.directiveIds.filter(isIncluded).reduce(
          (s, did) => s + effectiveMax(did), 0,
        ), 0,
      );

      // Readiness gate (#627) — surface WHY a protocol is gated.
      const readinessBlockers: { directiveId: string; name: string; readiness: string }[] = [];
      for (const g of proto.groups) {
        for (const did of g.directiveIds) {
          if (!isIncluded(did)) continue;
          const reg = this.directivesService.get(did);
          if (reg && ((reg as any)?.readiness ?? 'alpha') !== 'ready') {
            readinessBlockers.push({ directiveId: did, name: reg.name ?? did, readiness: (reg as any)?.readiness ?? 'alpha' });
          }
        }
      }

      protocols.push({
        id,
        name: proto.name,
        description: proto.description,
        source: 'database',
        directiveCount: proto.groups.reduce((s, g) => s + g.directiveIds.filter(isIncluded).length, 0),
        maxScore,
        active: proto.active !== false,
        readiness: { ready: readinessBlockers.length === 0, blockers: readinessBlockers },
        groups,
        tradingStyle: (proto as any).tradingStyle,
        recommendedTimeframe: (proto as any).recommendedTimeframe,
        derivedFrom: (proto as any).derivedFrom ?? null,
        directionMode: (proto as any).directionMode || 'LONG_ONLY',
        avgHoldTime: (proto as any).avgHoldTime,
        winRateTarget: (proto as any).winRateTarget,
        idealFor: (proto as any).idealFor,
        note: (proto as any).note ?? null,
        theory: (proto as any).theory ?? null,
        // Adaptive Target — `active` means the target is genuinely in force, i.e. enabled AND
        // resting on enough observations to change the denominator. A protocol with the flag
        // on but too few readings is NOT badged, because its scores are still on the
        // configured scale and a badge would be a lie.
        adaptiveTargetEnabled: adaptiveBySlug.get(id)?.enabled ?? false,
        adaptiveTargetActive: (() => {
          const a = adaptiveBySlug.get(id);
          if (!a?.enabled || a.max == null) return false;
          if (a.samples < ADAPTIVE_TARGET_MIN_SAMPLES) return false;
          return resolveAdaptiveTarget(
            { enabled: a.enabled, peak: a.max, samples: a.samples, since: null },
            maxScore,
          ).applied;
        })(),
        adaptiveTargetMax: adaptiveBySlug.get(id)?.max ?? null,
        adaptiveTargetSamples: adaptiveBySlug.get(id)?.samples ?? 0,
        // Placeholder — populated below by resolveSymbols()
        resolvedSymbols: [] as string[],
      });
    }

    // DB strategies (from Strategy table)
    try {
      const dbStrategies = await this.prisma.strategy.findMany({
        where: { active: true },
        include: { directives: { where: { active: true }, select: { id: true, weight: true } } },
      });
      for (const s of dbStrategies) {
        /**
         * IMPORTANT: Merge, don't push. The same protocol appears in both the
         * code registry (via ProtocolDbService.getAllCached()) and the DB
         * (strategy table). Before this fix, DB entries were pushed as
         * duplicates, causing duplicate React keys and double-counted
         * protocols in the frontend (ProtocolsPage, StrategyCreatePage).
         *
         * Merge strategy: if the DB row has the same id as a code-registry
         * entry, overlay `active` and mark `source: 'database'`. Otherwise,
         * it's a truly new DB-only strategy — push normally.
         *
         * See 2026-07-25-console-warnings-fixed.md handoff for full context.
         */
        const existing = protocols.find(p => p.id === s.id);
        if (existing) {
          // Overlay: mark code-registry protocol as having a DB presence.
          // Do NOT create new protocol entries from strategy records —
          // strategies are not protocols and the code registry is the
          // single source of truth for protocol definitions.
          existing.source = 'database';
        }
        // else: this DB strategy has no matching code-registry protocol.
        // Skip it — strategies ≠ protocols. These are legacy entries from
        // the WordPress plugin era (names like "Signals Workbench → xau-speed-v1").
      }
    } catch {
      // DB might not be available — skip
    }

    // ── Enrich with linkage data ──
    try {
      const scoringStrategies = await this.prisma.scoringStrategy.findMany({
        where: { enabled: true },
        select: { id: true, name: true, protocolId: true, shortProtocolId: true, watchlistName: true, tradingEnabled: true },
      });

      // Build lookup maps
      const protocolsById = new Map(protocols.map(p => [p.id, p]));
      const strategiesByProtocol: Record<string, Array<{ id: string; name: string; watchlist: string; trading: boolean; shortProtocolId?: string; shortProtocolName?: string }>> = {};
      const watchlistsByProtocol: Record<string, Set<string>> = {};

      for (const ss of scoringStrategies) {
        const pid = ss.protocolId;
        if (!strategiesByProtocol[pid]) strategiesByProtocol[pid] = [];
        strategiesByProtocol[pid].push({
          id: ss.id,
          name: ss.name,
          watchlist: ss.watchlistName,
          trading: ss.tradingEnabled,
          shortProtocolId: ss.shortProtocolId || undefined,
          shortProtocolName: ss.shortProtocolId ? protocolsById.get(ss.shortProtocolId)?.name || ss.shortProtocolId : undefined,
        });

        if (!watchlistsByProtocol[pid]) watchlistsByProtocol[pid] = new Set();
        if (ss.watchlistName) watchlistsByProtocol[pid].add(ss.watchlistName);
      }

      // Attach to each protocol
      for (const proto of protocols) {
        const linkedStrategies = strategiesByProtocol[proto.id] || [];
        const linkedWatchlists = watchlistsByProtocol[proto.id]
          ? [...watchlistsByProtocol[proto.id]]
          : [];

        (proto as any).linkedWatchlists = linkedWatchlists;
        (proto as any).linkedStrategies = linkedStrategies;
        (proto as any).connectionCount = linkedStrategies.length;
        (proto as any).isFullyConnected = linkedStrategies.length > 0 && linkedStrategies.some(s => s.trading);
      }
    } catch {
      // Enrichment is best-effort
    }

    // ── Resolve symbols for each protocol ──
    // Runs OUTSIDE the enrichment try/catch so a single DB failure doesn't
    // block all protocols. Uses ProtocolDbService.resolveSymbols() — the same
    // resolution logic the automation loop uses (single-symbol → auto-derived,
    // multi-symbol → watchlist lookup).
    for (const proto of protocols) {
      try {
        (proto as any).resolvedSymbols = await this.protocolDb.resolveSymbols(proto.id);
      } catch {
        (proto as any).resolvedSymbols = [];
      }
    }

    return { protocols, count: protocols.length };
  }

  /**
   * GET /api/scoring/gated/protocols/status
   *
   * Live scoring state for every protocol — the app-wide single source of
   * truth for WHY a protocol is or isn't scoring. The automation loop owns
   * the protocol_score_status rows; this endpoint merges them with registry
   * config (active, note) and derives pending/disabled.
   */
  @Get('protocols/status')
  async protocolStatuses() {
    const all = this.protocolDb.getAllCached();

    let activeMap: Record<string, boolean> = {};
    let noteMap: Record<string, string | null> = {};
    try {
      const rows: any[] = await (this.prisma as any).$queryRawUnsafe(
        `SELECT slug, active, note FROM protocol`,
      );
      for (const r of rows) {
        activeMap[r.slug] = !!r.active;
        noteMap[r.slug] = r.note ?? null;
      }
    } catch { /* columns may not exist yet */ }

    const statusMap: Record<string, any> = {};
    try {
      const rows: any[] = await (this.prisma as any).$queryRawUnsafe(
        `SELECT protocolId, state, reason, symbolsResolved, symbolsScored, lastTickAt, updatedAt FROM protocol_score_status`,
      );
      for (const r of rows) statusMap[r.protocolId] = r;
    } catch { /* table not yet created */ }

    // ── STALLED detection (#758) ────────────────────────────────────────────
    //
    // WHY: a protocol can honestly report `state: 'scoring'` while writing nothing usable.
    // `symbolsScored` counts envelopes that were *built*, and a tick where every direction-
    // eligible directive read neutral produced `0/0 -> 0` with `signal: 'HOLD'` — a phantom
    // zero that counted as a score. Live evidence: `spy-day-v1` wrote rows at 11:48 with
    // `rawMax: 0` and then nothing directional for hours, while this table still said
    // 'scoring'. The outage was invisible because nothing compared "claims to be scoring"
    // against "last produced a real reading".
    //
    // HOW: from the last persisted reading per protocol. Derived at read time rather than
    // stored, so there is no new column, no migration, and no cron — and it cannot drift out
    // of sync with the data it describes. A protocol declared `scoring` with no reading older
    // than the threshold is reported `stalled` instead.
    const STALL_AFTER_MS = 15 * 60_000; // 15 min: several 5m-scoring ticks, still actionable
    const lastReadingMap: Record<string, { at: Date; rawMax: number | null }> = {};
    try {
      const reads: any[] = await (this.prisma as any).$queryRawUnsafe(
        `SELECT strategyId AS protocolId, MAX(timestamp) AS at
           FROM score
          WHERE strategyId <> ''
          GROUP BY strategyId`,
      );
      for (const r of reads) lastReadingMap[r.protocolId] = { at: new Date(r.at), rawMax: null };
    } catch { /* score table shape varies; stall detection simply stays off */ }

    const now = Date.now();

    const statuses: Array<{
      protocolId: string;
      name: string;
      active: boolean;
      note: string | null;
      status: {
        state: string;
        reason: string | null;
        symbolsResolved: number;
        symbolsScored: number;
        lastTickAt: string | null;
        lastReadingAt?: string | null;
        stalledForMinutes?: number | null;
      } | null;
    }> = [];

    for (const [id, proto] of Object.entries(all)) {
      // Same ghost-entry rule as listProtocols — protocols without directive
      // groups are legacy seed artifacts, not real protocols.
      if (!proto.groups?.length) continue;
      const row = statusMap[id];

      let state = row?.state as string | undefined;
      let reason = (row?.reason ?? null) as string | null;
      const lastReading = lastReadingMap[id]?.at ?? null;
      const stalledForMs = lastReading ? now - lastReading.getTime() : null;

      // Only 'scoring' can be silently lying. 'paused'/'no-symbols'/'no-data' already explain
      // themselves and must NOT be overwritten — a stalled badge on an intentionally paused
      // protocol would be noise, and noise is how guards get ignored.
      if (state === 'scoring' && stalledForMs !== null && stalledForMs > STALL_AFTER_MS) {
        const mins = Math.round(stalledForMs / 60_000);
        state = 'stalled';
        reason = `Reports 'scoring' but has written no reading for ${mins} min. Either every direction-eligible directive is reading neutral (a 0/0 phantom score — see #758) or scoring is failing silently. Check the directive breakdown for this protocol.`;
      }

      statuses.push({
        protocolId: id,
        name: proto.name || id,
        active: activeMap[id] ?? proto.active !== false,
        note: noteMap[id] ?? null,
        status: row
          ? {
              state: state ?? 'pending',
              reason,
              symbolsResolved: Number(row.symbolsResolved ?? 0),
              symbolsScored: Number(row.symbolsScored ?? 0),
              lastTickAt: row.lastTickAt ? new Date(row.lastTickAt).toISOString() : null,
              lastReadingAt: lastReading ? lastReading.toISOString() : null,
              stalledForMinutes: stalledForMs === null ? null : Math.round(stalledForMs / 60_000),
            }
          : null,
      });
    }

    return { statuses, count: statuses.length };
  }

  /**
   * ⚠️ DECLARED ABOVE `@Get(':symbol')`.
   *
   * Both are single-segment paths, so the parameterised route captured `portfolio` and this
   * endpoint was unreachable. Instead of the portfolio's gated scores it returned a SINGLE score
   * for a symbol named "PORTFOLIO":
   *     {"symbol":"PORTFOLIO","composite":50,"signal":"HOLD","directionMode":"LONG_ONLY",...}
   * A plausible, well-formed result for a path that matched no route — no error, which is why it
   * survived. See #856. Guarded by `nest/src/common/route-order.spec.ts`.
   */
  @Get('portfolio')
  async getPortfolioGated(): Promise<GatedScore[]> {
    const portfolioData = await this.portfolio.getPortfolio();
    const positions = portfolioData?.positions ?? [];
    if (positions.length === 0) {
      return [];
    }

    // Each position is scored with ITS OWN assigned protocol. Positions without
    // a protocol assignment are skipped — unscoped default scoring was removed (2026-08-22).
    const results: GatedScore[] = [];
    for (const p of positions) {
      const sym = await this.prisma.symbol.findFirst({
        where: { ticker: p.symbol },
      });
      if (!sym) {
        this.logger.warn(`Portfolio position ${p.symbol} has no symbol record — skipped`);
        continue;
      }

      let slug: string | null = null;
      try {
        const assignment = await (this.prisma as any).symbolProtocolAssignment.findFirst({
          where: { symbol: p.symbol },
          orderBy: { priority: 'asc' },
          include: { protocol: { select: { slug: true } } },
        });
        slug = assignment?.protocol?.slug ?? null;
      } catch { /* assignment table may not exist */ }

      if (!slug) {
        this.logger.warn(`Portfolio position ${p.symbol} has no protocol assignment — skipped (unscoped scoring removed)`);
        continue;
      }

      const requiredBars = this.protocolDb.getRequiredBars(slug);
      // ⚠️ Cadence from the PROTOCOL, not a hardcoded '1d' — see the `batch` handler below
      // for the full explanation (#783 follow-up). This site additionally omitted the
      // `timeframe` argument on `scoreWithGating`, so the freshness check had to infer the
      // cadence from the array's median even when the bars were loaded correctly.
      const cadence = selectBaseTimeframe(
        this.protocolDb.getCached(slug)?.recommendedTimeframe,
      );
      const bars = await this.marketData.getBars(sym.id, cadence, requiredBars[cadence] ?? requiredBars['1d'] ?? 200);
      if (!bars || bars.length === 0) continue;

      const { dayBars, hourBars, min15Bars } = await this.protocolGating.loadHigherTfBundle(sym.id, slug);
      results.push(await this.protocolGating.scoreWithGating(
        p.symbol, bars as any, slug, { dayBars, hourBars, min15Bars }, 'group-weighted', cadence,
      ));
    }

    return results.sort((a, b) => b.composite - a.composite);
  }

  /**
   * GET /api/scoring/gated/:symbol
   *
   * Returns a multiplicatively-gated score for a single symbol.
   * Risk directives multiplicatively gate Technical + Sentiment scores.
   *
   * Query params:
   *   ?timeframe=1d   (default: 1d)
   *   ?bars=100        (default: 100)
   *   ?protocol=btc-speed-v1  (optional — selects protocol groups)
   */
  @Get(':symbol')
  async getGatedScore(
    @Param('symbol') symbol: string,
    @Query('timeframe') timeframe = '1d',
    @Query('bars') bars = '100',
    @Query('protocol') protocol?: string,
  ): Promise<GatedScore> {
    const ticker = symbol.toUpperCase();

    // Look up symbol in DB to get the internal ID
    const sym = await this.prisma.symbol.findFirst({
      where: { ticker },
    });

    const marketBars = sym
      ? await this.marketData.getBars(sym.id, timeframe, parseInt(bars, 10))
      : [];

    if (!marketBars || marketBars.length === 0) {
      this.logger.warn(`No market data for ${ticker}`);
      return {
        symbol: ticker,
        composite: 50,
        signalRaw: 0,
        signalMax: 0,
        signalPct: 0,
        signal: 'HOLD',
        directionMode: 'LONG_ONLY' as const,
        subScores: { technical: 50, sentiment: 50, risk: 50 },
        subRawTotals: {},
        subMaxTotals: {},
        riskMultiplier: 0.5,
        breakouts: {},
        gatingActive: false,
        opportunityScore: 0,
        opportunityMax: 0,
        opportunityPct: 0,
        inactiveGroupIds: [],
        meta: {
          compositePct: 0,
          maxScore: 0,
          directiveCount: 0,
          gatedCount: 0,
          riskDirectiveCount: 0,
          weightStrategy: 'group-weighted' as const,
          readinessBreakdown: { ready: 0, beta: 0, alpha: 0, alphaExcluded: 0 },
          directionalEvidence: {
            bullishRaw: 0, bullishMax: 0, bullishPct: 0,
            bearishRaw: 0, bearishMax: 0, bearishPct: 0,
            selected: 'none' as const,
          },
          // #758 stable denominator — zero-bar fallback has no capacity to divide by,
          // so the diagnostic set is all zero and `denominatorMode` still names the rule.
          denominatorMode: 'configured-capacity' as const,
          configuredSignalMax: 0,
          observedSignalMax: 0,
          directionEligibleDirectives: 0,
        },
        excludedBreakdown: [],
      };
    }

    const { dayBars, hourBars, min15Bars } = await this.protocolGating.loadHigherTfBundle(sym.id, protocol);
    return this.protocolGating.scoreWithGating(ticker, marketBars, protocol, { dayBars, hourBars, min15Bars });
  }

  /**
   * POST /api/scoring/gated/protocols/seed
   * Seed all hardcoded protocols into the DB. Idempotent.
   * Epic #510 Phase 3 — DB-Driven Architecture.
   */
  @Post('protocols/seed')
  async seedProtocols() {
    return this.protocolDb.seedProtocolsToDatabase();
  }

  /**
   * POST /api/scoring/gated/batch
   *
   * Score a list of tickers through the gated scoring pipeline (with rarity).
   * Body: { tickers: string[], protocolId?: string }
   */
  @Post('batch')
  async getBatchGated(@Body() body: { tickers: string[]; protocolId?: string }): Promise<GatedScore[]> {
    if (!body.tickers?.length) return [];

    // A protocol is required — unscoped default scoring was removed (2026-08-22)
    if (!body.protocolId) {
      throw new BadRequestException(
        'protocolId is required for gated batch scoring — unscoped default scoring was removed.',
      );
    }

    const protocolBars = this.protocolDb.getRequiredBars(body.protocolId);

    // ⚠️ Cadence comes from the PROTOCOL, not a hardcoded '1d' (#783 follow-up, 2026-09-11).
    // This endpoint previously loaded `getBars(sym.id, '1d', protocolBars['1d'])` — it fetched
    // the protocol's per-timeframe bar REQUIREMENTS and then ignored its cadence entirely, so
    // a 1h protocol was scored on daily bars. `computeMarketStatus()` then measured staleness
    // against the daily series and reported ~1100m for every intraday protocol, making the
    // whole Ladder read STALE/PAUSED during an active session. `scorePortfolio()` below is
    // told the same cadence, so the bars and the freshness hint cannot disagree.
    const cadence = selectBaseTimeframe(
      this.protocolDb.getCached(body.protocolId)?.recommendedTimeframe,
    );
    const barCount = protocolBars[cadence] ?? protocolBars['1d'] ?? 200;

    const holdings = await Promise.all(
      body.tickers.map(async (ticker) => {
        const sym = await this.prisma.symbol.findFirst({
          where: { ticker: ticker.toUpperCase() },
        });
        const bars = sym
          ? await this.marketData.getBars(sym.id, cadence, barCount)
          : [];
        return { symbol: ticker.toUpperCase(), bars: bars || [] };
      }),
    );

    return this.protocolGating.scorePortfolio(holdings, body.protocolId, cadence);
  }

  /**
   * PATCH /api/scoring/gated/protocols/:id/toggle
   * Toggle a protocol's active status. Updates DB if protocol exists there,
   * otherwise stores an in-memory override. Returns the new active state.
   */
  @Patch('protocols/:id/toggle')
  async toggleProtocol(@Param('id') id: string): Promise<{ id: string; active: boolean }> {
    let newActive = false;
    try {
      // Use raw SQL — Prisma client may not have 'active' field yet (added via SQL migration)
      const existing: any[] = await (this.prisma as any).$queryRawUnsafe(
        `SELECT active FROM protocol WHERE slug = ? LIMIT 1`, id,
      );
      if (existing?.length > 0) {
        newActive = !existing[0].active;
        await (this.prisma as any).$executeRawUnsafe(
          `UPDATE protocol SET active = ? WHERE slug = ?`, newActive ? 1 : 0, id,
        );
      } else {
        // Try strategy table
        const strat = await this.prisma.strategy.findUnique({ where: { id } });
        if (strat) {
          newActive = !strat.active;
          await this.prisma.strategy.update({ where: { id }, data: { active: newActive } });
        }
      }
      // Reload protocol cache
      await this.protocolDb.preloadAll();
      this.logger.log(`Protocol ${id} toggled to ${newActive ? 'active' : 'inactive'}`);
    } catch (err) {
      this.logger.error(`Failed to toggle protocol ${id}: ${(err as Error).message}`);
      throw err;
    }
    return { id, active: newActive };
  }

  /**
   * GET /api/scoring/gated/protocols/:id/symbols
   * Returns the symbols a protocol scores (single-symbol or watchlist-derived).
   */
  @Get('protocols/:id/symbols')
  async getProtocolSymbols(@Param('id') id: string): Promise<{ protocolId: string; symbols: string[]; resolution: string }> {
    const symbols = await this.protocolDb.resolveSymbols(id);
    // Determine which path resolved
    let resolution = 'derived';
    try {
      const assignments = await (this.prisma as any).symbolProtocolAssignment.findMany({ where: { protocolId: id } });
      if (assignments?.length > 0) resolution = 'db:assignment';
      else {
        const wl = await (this.prisma as any).watchlist.findFirst({ where: { protocolId: id } });
        if (wl) resolution = 'db:watchlist';
      }
    } catch { /* table may not exist */ }
    return { protocolId: id, symbols, resolution };
  }
}
