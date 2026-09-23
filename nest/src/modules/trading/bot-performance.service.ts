/**
 * BotPerformanceService — "which bots are actually working?" at PORTFOLIO scope.
 * ==============================================================================
 *
 * PART OF: #894 (bot rating / "gold stamp"). This file is the DATA half — it queries and
 * prepares realised per-bot performance. It deliberately does NOT render anything, and it
 * deliberately refuses to produce a rating it cannot justify.
 *
 * WHY THIS IS NOT `strategy-comparison`
 * -------------------------------------
 * `GET /api/trading/strategy-comparison` groups by `trade.strategy` — a NAME STRING — and it
 * is the only per-strategy view that exists. Two measured problems make it unusable as the
 * basis for a rating:
 *
 *   1. `trade.strategy` is null on 184 of 186 closed trades (measured 2026-09-22, #949).
 *      It is written on the manual-close path only; the other three close paths omit it.
 *      A rating grouped on that column would be a rating of two trades.
 *   2. It groups by NAME, so two bots that share a name are one bucket, and one bot that was
 *      renamed is two. A rating must key on IDENTITY, not on a label someone typed.
 *
 * WHY THIS IS NOT `protocol-profitability` EITHER
 * -----------------------------------------------
 * That endpoint (#777) resolves `scoringStrategyId` → bot → PROTOCOL. This one resolves the
 * same column to the BOT ITSELF. #894's rating is per-bot, so protocol roll-up is the wrong
 * destination — but the multi-path resolution technique below is copied from it deliberately.
 *
 * WHY THIS IS NOT `symbols.service` per-bot outcomes (#921)
 * -------------------------------------------------------
 * `symbols.service.ts` already computes per-bot realised payoff — but SCOPED TO ONE SYMBOL,
 * for the symbol detail page. A rating needs the bot's whole record across every symbol it
 * traded, because a bot restricted to one symbol would otherwise look identical to one that
 * happens to have only traded one. The SQL, the attribution convention and the payoff
 * null-semantics below are copied from that implementation on purpose — see "Reuse" below.
 *
 * ⚠️⚠️ THE PHANTOM-CLOSE PREDICATE IS LOAD-BEARING — DO NOT SIMPLIFY IT
 * -------------------------------------------------------------------
 * Every query here requires `brokerTicket IS NOT NULL AND exitPrice IS NOT NULL`.
 * This is NOT the same as `status = 'closed'`, and it is NOT the same as `pnlInvalid = 0`.
 *
 * Measured 2026-09-21 (#931): 99 of 206 trade rows are marked closed but have NO brokerTicket
 * and NO exitPrice — residue of bulk reconciliation writes, with `pnl = 0`. 82 of those are
 * correctly flagged `pnlInvalid = 1`, but **17 are marked VALID and are caught by no existing
 * flag**, so filtering on `pnlInvalid` alone is NOT sufficient.
 *
 * Consequence of getting it wrong, measured: USDCAD reads as "20 trades, 3 wins (15%)" when it
 * is really "3 trades, 3 wins". The 17 phantom rows with pnl = 0 were counted as losses.
 *
 * ⇒ A row that never had a fill and never had an exit IS NOT A TRADE, whatever its status says.
 *   This is why the predicate lives in ONE exported constant below rather than being retyped.
 *
 * ⚠️ A BREAK-EVEN IS NOT A LOSS (three-way split)
 * -----------------------------------------------
 * `symbols.service.ts` uses `AVG(CASE WHEN pnl <= 0 THEN pnl END) AS avgLoss`, and `<= 0`
 * INCLUDES a genuine scratch. So a priced break-even is averaged into `avgLoss` as a loss of
 * zero, and it counts against the win rate. #884 fixed exactly this class on
 * `strategy-comparison` (*"`t.pnl && t.pnl >= 0` treated 0 as FALSY and counted a priced
 * break-even as a LOSS of $0"*).
 *
 * This file splits three ways: `> 0` win, `< 0` loss, `= 0` break-even — counted and reported,
 * never silently filed as a loss. Realised values are passed through the canonical
 * `bucket()` from `pnl-statistics.service.ts` rather than recomputed here.
 *
 * REUSE — what this file does NOT reimplement
 * ------------------------------------------
 *   `bucket()`            `scoring/pnl-statistics.service.ts` — expectancy, standard error,
 *                         profit factor, avgWin/avgLoss. THE canonical P&L maths.
 *   `reliabilityFor()`    same file — the |expectancy|/standardError signal-to-noise test.
 *   attribution SQL       `symbols/symbols.service.ts` (#921) — grouping convention.
 *   payoff null-semantics same file — NULL when a side has no observations.
 *
 * A second implementation of any of these is the most expensive kind of technical debt here:
 * both copies drift and only one gets the next fix.
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
// ⚠️ #954 — ONE drawdown definition. This service and risk/risk.controller.ts used to carry
// separate implementations with opposite conclusions about the percentage. Both call this now.
import { computeDrawdownDetail } from '../../common/trading/drawdown';
import { bucket, PnlReliability } from '../scoring/pnl-statistics.service';
// #876/#894 — the canonical strategy identity. Reused, never reimplemented: `strategyKey()`
// hashes the WHOLE configuration and `canonicalise()` is private, so a second copy would be
// both duplication AND a drift risk. See "THE BRIDGE" in the class header.
import { StrategyDerivationService } from '../scoring/strategy-derivation.service';

/**
 * The ONLY rows that count as a realised trade.
 *
 * Exported so a caller cannot accidentally write a looser version and silently reintroduce the
 * phantom rows. See the file header — `pnlInvalid` alone misses 17 measured rows.
 */
export const REALISED_TRADE_PREDICATE =
  `status = 'closed' AND brokerTicket IS NOT NULL AND exitPrice IS NOT NULL`;

/**
 * How a `scoringStrategyId` value was interpreted. Measured, not assumed — see the resolver below.
 *
 * ⚠️ `none` and `unresolved` are DELIBERATELY SEPARATE, because they have different causes and
 * therefore different fixes:
 *   `none`       — `scoringStrategyId IS NULL`. A writer omitted the field entirely.
 *   `unresolved` — the field HAS a value that matches no known bot or protocol. A writer used
 *                  a convention nobody recognises.
 * Collapsing them into one 'unknown' bucket would hide which of the two writers is misbehaving —
 * and they are different writers. A null also has no value to list, so the two cannot share a
 * representation without losing the only diagnostic that matters.
 */
export type AttributionKind = 'bot' | 'protocol_slug' | 'unresolved' | 'none';

/** A bot's declared configuration — what it INTENDS. Source: `trading_strategy`. */
export interface BotDeclared {
  slPct: number | null;
  tpPct: number | null;
  /** tpPct / slPct. The reward:risk the bot was configured for. NULL if either is unset. */
  payoff: number | null;
  timeframe: string | null;
  protocolId: string | null;
  symbol: string | null;
  mode: string | null;
  active: boolean | null;
  /** Position size cap. Used ONLY to describe the bot — it is not a capital allocation. */
  maxPositions: number | null;
}

/** A bot's realised record — what it DID. Every figure is over `samples` real trades. */
export interface BotRealised {
  samples: number;
  wins: number;
  losses: number;
  /** Priced closes netting exactly zero. A RESULT — counted here, never filed as a loss. */
  breakEven: number;
  /** wins / samples, 0-1. NULL when samples = 0 — there is no rate without a denominator. */
  winRate: number | null;
  avgWin: number | null;
  /** NEGATIVE (the true mean of losing trades). Negating at the call site is how sign bugs happen. */
  avgLoss: number | null;
  /** mean P&L per trade. THE headline. */
  expectancy: number;
  /** Uncertainty on `expectancy`. Compare them before believing the sign. */
  standardError: number;
  reliability: PnlReliability;
  /** avgWin / |avgLoss| — realised reward:risk. NULL when either side has no observations. */
  payoff: number | null;
  totalPnl: number;
  bestTrade: number | null;
  worstTrade: number | null;
  profitFactor: number;
}

/** The span the samples came from. #894 requires this next to any rating. */
export interface BotWindow {
  firstClose: string | null;
  lastClose: string | null;
  /** Calendar days spanned by the samples. The honest gate for a low-frequency bot. */
  days: number;
  /** samples / days. Surfaces the frequency difference #894 warns about. */
  samplesPerDay: number;
}

/**
 * Why a bot has NO rating.
 *
 * ⚠️ `rating: null` WITH a populated `blockers` is a RESULT, not a failure. It says "we looked
 * and the data cannot support a rating yet, here is exactly what is missing" — which is
 * actionable. `rating: null` with an EMPTY `blockers` would be a bug: it would read as "fine".
 * (development-philosophy §7 — distinguish "fine" from "cannot judge".)
 */
export type RatingBlocker =
  | 'no_realised_trades'
  | 'attribution_unresolved'
  | 'strategy_identity_unresolved'
  | 'strategy_identity_ambiguous'
  | 'insufficient_samples'
  | 'window_too_short'
  | 'expectancy_indistinguishable_from_zero'
  | 'expectancy_negative'
  | 'drawdown_unverifiable'
  | 'drawdown_exceeds_limit'
  | 'no_allocation_basis';

/**
 * How many derived strategies this bot's record belongs to.
 *
 * ⚠️ `deriveAll()` keys on (protocol + role + market + broker + treatment) and loops over a bot's
 * protocol SUBSCRIPTIONS. A bot with two subscriptions therefore resolves to **two** strategyKeys,
 * and its blended realised record belongs to neither of them individually.
 *
 *  - `one`     — attributable. The normal case (measured 26 bots = 26 strategies).
 *  - `none`    — the bot has no protocol link, so it IS NOT A STRATEGY (an orphan).
 *  - `many`    — the bot spans several strategies; its record cannot be split between them.
 *  - `unknown` — the derivation could not be read. NOT the same as `none`, and deliberately
 *                distinct: "this bot is in no strategy" and "we could not find out" are opposite
 *                conclusions that would otherwise render identically.
 */
export type StrategyIdentity = 'one' | 'none' | 'many' | 'unknown';

export interface BotPerformance {
  /** `trading_strategy.id` when resolved, else null. */
  botId: string | null;
  botName: string | null;
  /** False when the attribution did NOT resolve to a bot. Never silently merged with a bot. */
  matched: boolean;
  /** The raw `trade.scoringStrategyId` value this bucket came from. */
  attribution: string;
  attributionKind: AttributionKind;
  declared: BotDeclared | null;
  realised: BotRealised;
  window: BotWindow;
  /**
   * ⚠️ THE BRIDGE (#876/#894) — the `strategyKey` identities this bot's record belongs to.
   *
   * This is what makes performance ATTACHABLE to a derived strategy. Without it, the 26 derived
   * strategies render identity (protocol, market, treatment) and no outcome, while this report
   * renders outcome and no strategy — two halves of one answer that never meet.
   *
   * Usually exactly one. Empty when the bot is not a strategy; more than one when the bot spans
   * several — see `strategyIdentity`.
   */
  strategyKeys: string[];
  /** How many strategies this record belongs to, and whether that could be determined at all. */
  strategyIdentity: StrategyIdentity;
  /**
   * Peak-to-trough decline in the bot's CUMULATIVE REALISED P&L, in ACCOUNT CURRENCY.
   *
   * ⚠️⚠️ THIS IS ABSOLUTE, NOT A PERCENTAGE, AND THAT IS A CORRECTION — NOT A PREFERENCE.
   *
   * The first implementation of this field returned a percentage of the PEAK CUMULATIVE P&L.
   * Measured against the live table on 2026-09-22, it produced **1780%**, 681%, 225% and 63.93%
   * for real bots. A drawdown percentage cannot exceed 100%, so the number was self-evidently
   * wrong the moment it was printed — but it is exactly the defect class this repo keeps
   * re-finding: a plausible-looking figure, produced without error, that nothing flags.
   *
   * The cause: a bot that peaks at +0.10 and falls to -1.68 has a drawdown of 1780% *of its own
   * tiny peak*. The peak of a P&L series is not a capital base, and dividing by it is inventing
   * a denominator — the same mistake as `realisedPct` below, made one field earlier.
   *
   * Realised P&L in currency IS meaningful without a base. A percentage is not. So the absolute
   * figure is served, and `maxDrawdownPct` is null with the reason stated.
   */
  maxDrawdown: number;
  /**
   * ⚠️ ALWAYS NULL TODAY — same cause as `realisedPct`: no capital base exists.
   *
   * A drawdown PERCENTAGE needs an allocation to divide by, and `trading_strategy` has no such
   * column. Expressed as an explicit null WITH the `drawdown_unverifiable` blocker so a
   * consumer renders "cannot be measured" rather than `0%` — which would read as a clean record
   * and is the most dangerous possible misreading of this particular field.
   */
  maxDrawdownPct: null;
  /**
   * ⚠️ ALWAYS NULL TODAY, and the reason is a schema gap, not a bug — see `blockers`.
   *
   * #894's proposed shape includes `realisedPct` ("vs the bot's own starting allocation").
   * `trading_strategy` has NO capital-allocation column — the only field with "allocation" in
   * the name is `hotStockAllocation`, which is a separate % for hot-stock trades. There is
   * therefore no denominator, and inventing one (account equity? notional? baseSize x price?)
   * would put a confident-looking percentage on the page with nothing behind it.
   *
   * Served as an explicit null WITH the `no_allocation_basis` blocker so the UI can say
   * "no allocation configured" rather than render 0.0%.
   */
  realisedPct: null;
  /** 'gold' only when every gate passes AND every blocker is cleared. */
  rating: 'gold' | null;
  /** Why the rating is absent. Empty ONLY when `rating` is set. */
  blockers: RatingBlocker[];
  /** Human-readable form of `blockers`, safe to render directly. */
  blockersDetail: string[];
}

export interface BotPerformanceReport {
  generatedAt: string;
  /** Where the numbers came from — so no result is read without its provenance. */
  populationNote: string;
  /** Per-bot rows, largest sample first. */
  bots: BotPerformance[];
  /** Realised trades that could not be attributed to any bot, counted not hidden. */
  unattributed: {
    /** Rows whose `scoringStrategyId` is null — a writer omitted the field. */
    noAttribution: number;
    /** Rows whose `scoringStrategyId` has a value that resolves to nothing known. */
    unresolved: number;
    /** Distinct unresolved values, so a repeated unknown is visible rather than a count. */
    unresolvedValues: string[];
  };
  /** What this report CANNOT judge, counted so sparse output cannot read as "the bots made nothing". */
  excluded: {
    totalClosed: number;
    /** Closed rows with no brokerTicket or no exitPrice — the phantom population (#931). */
    phantom: number;
    /** Of the phantoms, how many are NOT flagged `pnlInvalid` — the ones a flag-only filter misses. */
    phantomNotFlagged: number;
  };
  caveats: string[];
}

/**
 * Rating thresholds.
 *
 * ⚠️ STATED ONCE, HERE, SO THE UI CAN RENDER THEM RATHER THAN DESCRIBE THEM.
 * #894: *"The rating must be recomputable and its inputs visible. If an operator cannot see
 * why a bot is gold, they will assume the number is arbitrary — and then work around it."*
 */
export interface RatingPolicy {
  minSamples: number;
  minWindowDays: number;
  maxDrawdownPct: number;
}

/**
 * DEFAULT POLICY — deliberately conservative, and deliberately NOT satisfied by anything
 * currently in the database.
 *
 * ⚠️ `minSamples: 30` is a FLOOR, not a target. `reliabilityFor()` independently demands n >= 20
 * before it will say anything other than 'noise', and 'moderate' needs n >= 50. A bot can clear
 * this floor and still be described as noise — that is intentional, because the floor exists to
 * stop the rating existing at all, while `reliability` describes how much to trust it.
 *
 * ⚠️ #894's frequency caution is why `minWindowDays` and `window.days` both exist: a 1h-hold bot
 * produces roughly 20x the samples of a 4h-hold bot over the same period. Gating on `minSamples`
 * ALONE silently rewards high-frequency bots and can never be met by slow ones. The window is
 * the fair gate; samples-per-day is served beside it so the difference is visible rather than
 * hidden in a threshold choice.
 */
export const DEFAULT_RATING_POLICY: RatingPolicy = {
  minSamples: 30,
  minWindowDays: 14,
  maxDrawdownPct: 25,
};

@Injectable()
export class BotPerformanceService {
  private readonly logger = new Logger(BotPerformanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly derivation: StrategyDerivationService,
  ) {}

  /**
   * Portfolio-scope realised performance for every bot that has real closed trades.
   *
   * `policy` is injectable so a caller can ask "what WOULD qualify under different thresholds?"
   * without the engine being restarted — the rating is recomputable, as #894 requires.
   */
  async getBotPerformance(
    params: { policy?: Partial<RatingPolicy>; includeInactive?: boolean } = {},
  ): Promise<BotPerformanceReport> {
    const policy: RatingPolicy = { ...DEFAULT_RATING_POLICY, ...(params.policy ?? {}) };

    const empty = (reason: string): BotPerformanceReport => ({
      generatedAt: new Date().toISOString(),
      populationNote: 'No trades evaluated.',
      bots: [],
      unattributed: { noAttribution: 0, unresolved: 0, unresolvedValues: [] },
      excluded: { totalClosed: 0, phantom: 0, phantomNotFlagged: 0 },
      caveats: [reason],
    });

    if (!this.prisma.isAvailable) return empty('Database unavailable');

    // ─────────────────────────────────────────────────────────────────────────────────
    // 1. The realised population — grouped by attribution, phantom rows already excluded.
    //
    // ⚠️ `pnl > 0` wins / `pnl < 0` losses / `pnl = 0` break-even is a THREE-WAY split.
    // Writing `pnl <= 0` as losses (as an earlier implementation does) folds a genuine
    // scratch into the losing side and understates the win rate.
    //
    // ORDERING: MySQL returns these rows in unspecified order, so the caller MUST sort by
    // `closedAt` ASC before computing drawdown. The per-bot drawdown below re-queries the
    // ordered series for exactly this reason rather than trusting this aggregate's order.
    // ─────────────────────────────────────────────────────────────────────────────────
    let rows: Array<{
      attribution: string | null;
      trades: number;
      wins: number;
      losses: number;
      breakEven: number;
      avgWin: number | null;
      avgLoss: number | null;
      totalPnl: number | null;
      bestTrade: number | null;
      worstTrade: number | null;
      firstClose: Date | null;
      lastClose: Date | null;
    }>;

    try {
      rows = (await this.prisma.$queryRawUnsafe(
        `SELECT
           scoringStrategyId                                       AS attribution,
           COUNT(*)                                                AS trades,
           SUM(CASE WHEN pnl > 0  THEN 1 ELSE 0 END)               AS wins,
           SUM(CASE WHEN pnl < 0  THEN 1 ELSE 0 END)               AS losses,
           SUM(CASE WHEN pnl = 0  THEN 1 ELSE 0 END)               AS breakEven,
           AVG(CASE WHEN pnl > 0  THEN pnl END)                    AS avgWin,
           AVG(CASE WHEN pnl < 0  THEN pnl END)                    AS avgLoss,
           SUM(pnl)                                                AS totalPnl,
           MAX(pnl)                                                AS bestTrade,
           MIN(pnl)                                                AS worstTrade,
           MIN(closedAt)                                           AS firstClose,
           MAX(closedAt)                                           AS lastClose
         FROM trade
         WHERE ${REALISED_TRADE_PREDICATE}
         GROUP BY scoringStrategyId`,
      )) as any[];
    } catch (err) {
      // An empty table and a failed query must NEVER look the same (development-philosophy §7).
      return empty(`Bot performance query failed: ${(err as Error).message}`);
    }

    // ─────────────────────────────────────────────────────────────────────────────────
    // 2. Bot identity — the resolver.
    //
    // ⚠️ `trade.scoringStrategyId` IS DUAL-MEANING. Measured 2026-09-17 (#777), over the 31
    // distinct values on `trade`: 0 of 31 are `scoring_strategy.id`, 16 of 31 are
    // `trading_strategy.id`, and the rest are protocol slugs. Two writers disagree:
    //   automation-loop.service.ts:1758   `scoringStrategyId: action.strategyId`  → bot id
    //   signal-actions.service.ts:235     `scoringStrategyId: protocol ?? null`   → protocol slug
    //
    // ⇒ A value is matched as a bot id FIRST, then as a protocol slug. Matching a slug as a bot
    //   would attribute a protocol's trades to whichever bot happened to be named after it; the
    //   reverse would be silent too. `matched` and `attributionKind` are therefore reported per
    //   row so a consumer can never mistake the two, and an unresolved value is listed by name
    //   rather than only counted.
    // ─────────────────────────────────────────────────────────────────────────────────
    const readAll = async (label: string, fn: () => Promise<any[]>, failures: string[]): Promise<any[]> => {
      try {
        return await fn();
      } catch (err) {
        failures.push(`${label}: ${(err as Error).message}`);
        return [];
      }
    };
    const lookupFailures: string[] = [];

    const bots = await readAll('trading_strategy', () =>
      (this.prisma as any).tradingStrategy.findMany({
        select: {
          id: true, name: true, protocolId: true, shortProtocolId: true, symbol: true,
          brokerId: true, timeframe: true, slPct: true, tpPct: true, mode: true,
          active: true, maxPositions: true,
        },
      }), lookupFailures);
    const botById = new Map<string, any>(bots.map((b: any) => [b.id, b]));

    // ─────────────────────────────────────────────────────────────────────────────────
    // 2b. THE BRIDGE — bot id → strategyKey, from the CANONICAL derivation (#876).
    //
    // ⚠️ `strategyKey` cannot be recomputed here. `StrategyDerivationService.strategyKey()` is a
    // public method but `canonicalise()` is private, and the canonicalisation rules (toFixed(6),
    // sorted keys, parseSessionWindow, null preserved) are exactly what stop two representations
    // of one configuration hashing apart. A hand-rolled second hash would silently invent
    // differences that do not exist. So this calls `deriveAll()` — one query with an include.
    //
    // ⚠️ A derivation failure must NOT read as "this bot is in no strategy". Those are opposite
    // conclusions. `deriveFailed` keeps them distinct all the way to the response.
    // ─────────────────────────────────────────────────────────────────────────────────
    let deriveFailed = false;
    const strategyKeysByBotId = new Map<string, string[]>();
    try {
      const derived = await this.derivation.deriveAll();
      for (const s of derived.strategies) {
        for (const botId of s.botIds) {
          const arr = strategyKeysByBotId.get(botId) ?? [];
          arr.push(s.strategyKey);
          strategyKeysByBotId.set(botId, arr);
        }
      }
    } catch (err) {
      deriveFailed = true;
      lookupFailures.push(`strategy derivation: ${(err as Error).message}`);
    }

    const protocols = await readAll('protocol', () =>
      (this.prisma as any).protocol.findMany({ select: { slug: true } }), lookupFailures);
    const knownSlugs = new Set<string>(protocols.map((p: any) => p.slug));

    // ─────────────────────────────────────────────────────────────────────────────────
    // 3. Drawdown needs the ORDERED series, so it is fetched once for every attribution
    //    rather than per bot (one query, not N).
    //
    // ⚠️ Ordered ASC by close time. A drawdown computed over unordered rows measures nothing:
    //    peak-to-trough is a property of the SEQUENCE, and the aggregate query above has no
    //    meaningful order. This is the single easiest way to get a plausible wrong number here.
    // ─────────────────────────────────────────────────────────────────────────────────
    let series: Array<{ attribution: string | null; pnl: number | null; closedAt: Date | null }> = [];
    try {
      series = (await this.prisma.$queryRawUnsafe(
        `SELECT scoringStrategyId AS attribution, pnl, closedAt
           FROM trade
          WHERE ${REALISED_TRADE_PREDICATE}
          ORDER BY closedAt ASC`,
      )) as any[];
    } catch (err) {
      lookupFailures.push(`ordered series: ${(err as Error).message}`);
    }

    const drawdownByAttribution = new Map<string, number>();
    {
      // ⚠️ #954 — borrowed, not re-implemented. Group the ORDERED series per attribution and run
      // the shared function (it expects NEWEST-FIRST, so each group is reversed here; the grouping
      // loop preserves the query's per-bot ordering guarantee). The 0-baseline rule and the
      // bounded-ratio rule live in that one file, with the canary — if they change, both this bot
      // metric and the risk surface change together rather than drifting apart.
      const seriesByAttribution = new Map<string, Array<{ pnl: number | null; closedAt: Date | null }>>();
      for (const r of series) {
        const key = r.attribution ?? '(none)';
        // ⚠️ `$queryRawUnsafe` rows are untyped — NUMBER, never trust the cast (a string "5" would
        // make the shared cumulative sum concatenate).
        const row = { pnl: Number(r.pnl ?? 0), closedAt: r.closedAt };
        const group = seriesByAttribution.get(key);
        if (group) group.push(row);
        else seriesByAttribution.set(key, [row]);
      }
      for (const [key, group] of seriesByAttribution) {
        // ABSOLUTE decline, in account currency — a figure that needs no denominator and
        // therefore cannot be wrong the way the percentage version was. See `maxDrawdown`.
        drawdownByAttribution.set(key, computeDrawdownDetail(group.slice().reverse()).currency);
      }
    }

    // ─────────────────────────────────────────────────────────────────────────────────
    // 4. Excluded populations — counted, because 0 usable rows must not read as "no results".
    // ─────────────────────────────────────────────────────────────────────────────────
    const [totalClosed, phantom, phantomNotFlagged] = await Promise.all([
      this.prisma.trade.count({ where: { status: 'closed' } }).catch(() => 0),
      this.prisma.trade.count({
        where: { status: 'closed', OR: [{ brokerTicket: null }, { exitPrice: null }] },
      }).catch(() => 0),
      this.prisma.trade.count({
        where: {
          status: 'closed',
          OR: [{ brokerTicket: null }, { exitPrice: null }],
          NOT: { pnlInvalid: 1 },
        },
      }).catch(() => 0),
    ]);

    // ─────────────────────────────────────────────────────────────────────────────────
    // 5. Build one BotPerformance per attribution.
    // ─────────────────────────────────────────────────────────────────────────────────
    const unattributedValues: string[] = [];
    let noAttribution = 0;

    const result: BotPerformance[] = rows.map((r) => {
      const raw = r.attribution;
      const hasAttribution = raw !== null && raw !== '';
      if (!hasAttribution) noAttribution++;

      const key = raw ?? '(none)';
      const bot = hasAttribution ? botById.get(raw as string) : undefined;
      const isSlug = !bot && hasAttribution && knownSlugs.has(raw as string);

      let attributionKind: AttributionKind;
      if (bot) attributionKind = 'bot';
      else if (isSlug) attributionKind = 'protocol_slug';
      else if (!hasAttribution) attributionKind = 'none';
      else {
        attributionKind = 'unresolved';
        unattributedValues.push(raw as string);
      }

      const samples = Number(r.trades ?? 0);
      const wins = Number(r.wins ?? 0);
      const losses = Number(r.losses ?? 0);
      const breakEven = Number(r.breakEven ?? 0);

      const avgWin = r.avgWin === null ? null : Number(r.avgWin);
      const avgLoss = r.avgLoss === null ? null : Number(r.avgLoss);

      // ⚠️ Payoff is NULL, not 0, when either side has no observations. "No losses yet" is
      // INFORMATION — a bot with 5 wins and no losses has an unbounded payoff, and reporting
      // that as 0.0 would describe the best possible record as the worst. (#921 convention.)
      const payoff =
        avgWin !== null && avgLoss !== null && avgLoss !== 0
          ? Number((avgWin / Math.abs(avgLoss)).toFixed(3))
          : null;

      // ⚠️ Use the canonical `bucket()` for expectancy / standard error / profit factor rather
      // than recomputing. Only the derived averages above (which the aggregate SQL already
      // returned) come from here. `bucket` needs raw values, so it is fed the three components
      // it can reconstruct exactly: wins x avgWin, losses x avgLoss, and break-evens as zeros.
      // This reproduces the same mean and the same population without a second SQL round trip.
      const synth: number[] = [
        ...Array.from({ length: wins }, () => avgWin ?? 0),
        ...Array.from({ length: losses }, () => avgLoss ?? 0),
        ...Array.from({ length: breakEven }, () => 0),
      ];
      const b = bucket(key, synth);
      // The aggregate SQL is the authority on the mean; synth is only weights. Prefer the SQL
      // figure where they could differ by rounding.
      const totalPnl = Number(r.totalPnl ?? 0);
      const expectancy = samples > 0 ? Number((totalPnl / samples).toFixed(4)) : 0;

      const firstClose = r.firstClose ? new Date(r.firstClose) : null;
      const lastClose = r.lastClose ? new Date(r.lastClose) : null;
      const days =
        firstClose && lastClose
          ? Math.max(1, Math.round((lastClose.getTime() - firstClose.getTime()) / 86_400_000))
          : 0;

      const declared: BotDeclared | null = bot
        ? {
            slPct: bot.slPct ?? null,
            tpPct: bot.tpPct ?? null,
            payoff:
              bot.slPct && bot.tpPct
                ? Number((bot.tpPct / bot.slPct).toFixed(2))
                : null,
            timeframe: bot.timeframe ?? null,
            protocolId: bot.protocolId ?? null,
            symbol: bot.symbol ?? null,
            mode: bot.mode ?? null,
            active: bot.active ?? null,
            maxPositions: bot.maxPositions ?? null,
          }
        : null;

      const maxDrawdown = Number((drawdownByAttribution.get(key) ?? 0).toFixed(2));

      // ── The strategy identity this record belongs to ──
      // Sorted so the array is stable across calls; `deriveAll()` sorts its own strategies but a
      // bot appearing in several would otherwise inherit that order rather than a defined one.
      const strategyKeys = bot
        ? (strategyKeysByBotId.get(bot.id) ?? []).slice().sort()
        : [];
      const strategyIdentity: StrategyIdentity = !bot || deriveFailed
        ? 'unknown'
        : strategyKeys.length === 0
          ? 'none'
          : strategyKeys.length === 1
            ? 'one'
            : 'many';

      // ─────────────────────────────────────────────────────────────────────────────
      // THE GATE. Every blocker is a REASON, and a non-empty blocker list is a result.
      // Order matters: the most fundamental reason reads first.
      // ─────────────────────────────────────────────────────────────────────────────
      const blockers: RatingBlocker[] = [];
      const blockersDetail: string[] = [];

      if (samples === 0) {
        blockers.push('no_realised_trades');
        blockersDetail.push('No closed trades with both a broker ticket and an exit price.');
      }
      if (!bot) {
        blockers.push('attribution_unresolved');
        blockersDetail.push(
          attributionKind === 'protocol_slug'
            ? `Attribution "${key}" is a PROTOCOL SLUG, not a bot — these trades are not this bot's record.`
            : attributionKind === 'none'
              ? 'No attribution recorded on these trades (`scoringStrategyId` is null), so they cannot be assigned to a bot.'
              : `Attribution "${key}" matches no known bot or protocol.`,
        );
      }
      if (samples > 0 && samples < policy.minSamples) {
        blockers.push('insufficient_samples');
        blockersDetail.push(
          `${samples} realised trade(s); the policy floor is ${policy.minSamples}. ` +
          `At ${days} day(s) this is roughly ${(samples / Math.max(1, days)).toFixed(2)} trade(s)/day.`,
        );
      }
      if (days < policy.minWindowDays) {
        blockers.push('window_too_short');
        blockersDetail.push(
          `Samples span ${days} day(s); the policy floor is ${policy.minWindowDays}. ` +
          'Trades over a short window describe one market regime, not an edge.',
        );
      }
      if (b.reliability === 'noise') {
        blockers.push('expectancy_indistinguishable_from_zero');
        blockersDetail.push(
          `Expectancy ${expectancy}/trade against a standard error of ${b.standardError} — ` +
          'the estimate is inside its own error bars.',
        );
      }
      if (expectancy <= 0) {
        blockers.push('expectancy_negative');
        blockersDetail.push(
          `Expectancy is ${expectancy}/trade. A bot that does not make money per trade cannot be rated.`,
        );
      }

      // ⚠️ A record that belongs to NO strategy, or to SEVERAL, cannot be rated as one.
      // Only asserted when a bot was actually resolved: otherwise `attribution_unresolved` is the
      // real blocker and a second, vaguer one would bury it.
      if (bot && strategyIdentity === 'none') {
        blockers.push('strategy_identity_unresolved');
        blockersDetail.push(
          'This bot belongs to NO derived strategy (it has no protocol link), so there is no ' +
          'strategy for a rating to describe.',
        );
      }
      if (bot && strategyIdentity === 'many') {
        blockers.push('strategy_identity_ambiguous');
        blockersDetail.push(
          `This bot resolves to ${strategyKeys.length} strategies (${strategyKeys.join(', ')}) ` +
          'because it holds several protocol subscriptions. Its blended record belongs to none of ' +
          'them individually, so rating it would rate the wrong thing.',
        );
      }
      if (bot && strategyIdentity === 'unknown') {
        blockers.push('strategy_identity_unresolved');
        blockersDetail.push(
          'The strategy derivation could not be read, so this bot cannot be tied to a strategy. ' +
          'This is NOT "belongs to no strategy" — the answer is unknown.',
        );
      }

      // ⚠️ THE DRAWDOWN CONDITION CANNOT BE EVALUATED, AND SAYING SO IS THE CORRECT BEHAVIOUR.
      //
      // #894: *"A drawdown condition is not optional. A rating that only counts wins and profit
      // awards the gold stamp to exactly the bots that took the most risk to get there."*
      //
      // The policy wants a PERCENTAGE limit. A percentage needs a capital base, and
      // `trading_strategy` has none — so the check is impossible, not passed. Reporting the
      // absence as 'drawdown_unverifiable' is the only honest option: silently omitting it
      // would let a bot be rated with no risk condition applied at all, which is precisely the
      // outcome that sentence warns against.
      blockers.push('drawdown_unverifiable');
      blockersDetail.push(
        `Realised drawdown is ${maxDrawdown} in account currency. A drawdown PERCENTAGE needs a ` +
        'capital base and no per-bot allocation exists, so the required risk condition cannot be ' +
        'applied. The absolute figure is served; `drawdown_exceeds_limit` becomes checkable the ' +
        'day an allocation column exists.',
      );
      // ⚠️ NO BOT CAN CLEAR THIS TODAY. There is no per-bot allocation column, so `realisedPct`
      // cannot be expressed, so the "X% of allocation" leg of #894's shape is unsatisfiable.
      // Stated as a blocker rather than quietly dropped: the day an allocation field exists,
      // this line is what tells the implementer the gate has a missing input.
      blockers.push('no_allocation_basis');
      blockersDetail.push(
        '`trading_strategy` has no capital-allocation column, so a realised return ' +
        'PERCENTAGE has no denominator. Absolute P&L is served instead; a percentage would be invented.',
      );

      return {
        botId: bot?.id ?? null,
        botName: bot?.name ?? null,
        matched: Boolean(bot),
        attribution: key,
        attributionKind,
        declared,
        realised: {
          samples,
          wins,
          losses,
          breakEven,
          winRate: samples > 0 ? Number((wins / samples).toFixed(4)) : null,
          avgWin: avgWin === null ? null : Number(avgWin.toFixed(4)),
          avgLoss: avgLoss === null ? null : Number(avgLoss.toFixed(4)),
          expectancy,
          standardError: b.standardError,
          reliability: b.reliability,
          payoff,
          totalPnl: Number(totalPnl.toFixed(2)),
          bestTrade: r.bestTrade === null ? null : Number(Number(r.bestTrade).toFixed(2)),
          worstTrade: r.worstTrade === null ? null : Number(Number(r.worstTrade).toFixed(2)),
          profitFactor: b.profitFactor,
        },
        window: {
          firstClose: firstClose?.toISOString() ?? null,
          lastClose: lastClose?.toISOString() ?? null,
          days,
          samplesPerDay: days > 0 ? Number((samples / days).toFixed(2)) : 0,
        },
        strategyKeys,
        strategyIdentity,
        maxDrawdown,
        maxDrawdownPct: null,
        realisedPct: null,
        rating: blockers.length === 0 ? 'gold' : null,
        blockers,
        blockersDetail,
      };
    });

    // Largest sample first — the most trustworthy rows lead. Ties broken by P&L so the order
    // is stable rather than dependent on MySQL's GROUP BY output order.
    result.sort(
      (a, b) =>
        b.realised.samples - a.realised.samples ||
        b.realised.totalPnl - a.realised.totalPnl ||
        a.attribution.localeCompare(b.attribution),
    );

    return {
      generatedAt: new Date().toISOString(),
      populationNote:
        `${result.reduce((s, r) => s + r.realised.samples, 0)} realised trade(s) across ` +
        `${result.length} attribution(s). ${phantom} closed row(s) EXCLUDED as phantom ` +
        `(no broker ticket or no exit price) — of those, ${phantomNotFlagged} carry no pnlInvalid ` +
        'flag and would be counted as real trades by a flag-only filter.',
      bots: result,
      unattributed: {
        noAttribution,
        unresolved: result.filter((r) => r.attributionKind === 'unresolved').length,
        unresolvedValues: [...new Set(unattributedValues)].sort(),
      },
      excluded: { totalClosed, phantom, phantomNotFlagged },
      caveats: this.caveatsFor(result, policy, lookupFailures),
    };
  }

  /**
   * What this report cannot judge, stated so a sparse table is never read as a verdict.
   *
   * A caveat list is not decoration here: the whole reason #894 lists its measurement problems
   * up front is that *"a confident number that means nothing"* is worse than no number, because
   * an operator acts on it.
   */
  private caveatsFor(
    bots: BotPerformance[],
    policy: RatingPolicy,
    lookupFailures: string[],
  ): string[] {
    const out: string[] = [];

    // ⚠️ A lookup that failed must be visible. Silent failure here would present "no bots found"
    // when the truth is "the bot table could not be read" — opposite conclusions, same output.
    if (lookupFailures.length > 0) {
      out.push(
        `⚠️ ${lookupFailures.length} lookup(s) FAILED and their data is missing from this report: ` +
        `${lookupFailures.join('; ')}. ` +
        'Treat any attribution reading "unresolved" as unknown rather than absent.',
      );
    }

    const rated = bots.filter((b) => b.rating === 'gold').length;
    if (rated === 0) {
      const blocking = bots.filter((b) => b.attributionKind === 'bot').length;
      out.push(
        `No bot currently qualifies for a rating (${blocking} bot(s) evaluated). ` +
        'This is the expected state, not a failure — see each row\'s blockers for what is missing.',
      );
    }

    if (bots.some((b) => b.blockers.includes('no_allocation_basis'))) {
      out.push(
        '⚠️ No bot can be fully rated while `trading_strategy` has no capital-allocation column: ' +
        'a return PERCENTAGE has no denominator. Absolute P&L and sample counts are the honest ' +
        'figures available today.',
      );
    }

    if (bots.some((b) => b.attributionKind === 'protocol_slug')) {
      out.push(
        'Some trades are attributed to a PROTOCOL SLUG rather than a bot (the dual-meaning ' +
        '`scoringStrategyId` column). Those rows are reported separately and are never counted ' +
        'as any bot\'s record.',
      );
    }

    out.push(
      `Policy in force: >= ${policy.minSamples} realised trades over >= ${policy.minWindowDays} ` +
      `days, expectancy distinguishable from zero, realised drawdown <= ${policy.maxDrawdownPct}%. ` +
      '⚠️ The drawdown limit is DECLARED BUT NOT APPLICABLE — see `drawdown_unverifiable`.',
    );
    out.push(
      'Drawdown is served as an ABSOLUTE decline in account currency. A percentage needs a ' +
      'capital base and no per-bot allocation exists — so the required risk condition cannot be ' +
      'applied, and that is reported as a blocker rather than skipped.',
    );
    out.push(
      'Drawdown covers REALISED P&L only. A bot holding an open loser right now will show a ' +
      'flattering figure.',
    );
    out.push(
      'Expectancy is the headline, not win rate. A 70% win rate with negative expectancy loses money.',
    );

    return out;
  }
}
