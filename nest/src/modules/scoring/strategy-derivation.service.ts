import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { createHash } from 'crypto';
// ⚠️ The CANONICAL session parser — do NOT hand-roll one here. `sessionWindow` is stored in TWO
// forms (measured 2026-09-18: 9 bots bare `london`, 3 bots `["london"]`), and this function
// normalises both AND resolves aliases (`sydney` -> `asian`, `zurich` -> `london`). Without it,
// two bots that behave identically would hash differently and be counted as two strategies.
import { parseSessionWindow, parseExitBoundary } from '../trading/session-window';

/**
 * StrategyDerivationService — renders STRATEGIES from the unique META.Stack combinations.
 * ==============================================================================
 * PART OF: META.Stack identity layer (#876). Design: docs/trading-bot-model.md §1c/§1d.
 *
 * BEFORE: StackPerformanceService.computeAllRatings() iterates `scoring_strategy` ROWS, so one row
 *         = one "MetaStack". 13 bots sharing `auto-forex-session-v1` produced ONE blended rating
 *         covering six genuinely different configurations. You could not tell which one worked.
 * AFTER:  a strategy is the bot's WHOLE configuration — protocol + role + market + broker +
 *         execution policy. 26 bots resolve to 26 strategies, and the `forex-session-v1` family to
 *         14, one per market.
 * NEXT:   #875 pins a name onto a key and stores the part IDs, so a named strategy survives an
 *         edit to one of its parts and the UI can show WHAT changed.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * ⚠️ THE OWNER'S RULE — corrected 2026-09-18, and this is the load-bearing comment in the file
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 *     "Two different bots results in two strategies."
 *     "Different markets. Is different configuration therefore the end result is a unique strategy."
 *     "The smallest change results in a different strategy because we cannot dismiss the power any
 *      single setting/behaviour could have on the stock market."
 *     "we should never have bots that do the exact same thing, even if it has different naming,
 *      it would mean its a duplicate and should be avoided"
 *
 * **A strategy is the bot's whole configuration. Any difference at all makes a different strategy.**
 *
 * ⚠️⚠️ THIS FILE PREVIOUSLY GOT THIS WRONG, and the mistake is worth keeping on the record.
 *   An earlier version EXCLUDED `symbol` from the identity on the reasoning that "symbols are scope,
 *   not identity", and therefore counted 6 FX bots sharing one config as ONE strategy. That is
 *   backwards, and the owner corrected it: **a different market IS a different configuration**, so
 *   those six are six strategies. The same error also collapsed the count to a reported "15" by
 *   dropping `sessionWindow` from a counting query.
 *
 *   Both errors shared one shape: **treating a field that happened to be UNCHANGED as though it
 *   were not part of the identity.** The rule now is the opposite, and it is simpler:
 *
 *       **Every field contributes. If two bots differ in ANY field, they are different strategies.**
 *
 * ⚠️ AND THE COROLLARY — a duplicate is a DEFECT, not a merge. If two bots are byte-identical they
 *   are NOT "one strategy"; they are a duplication fault ("should be avoided"). This service still
 *   groups them by key — a stable key is what makes the duplication DETECTABLE — but it reports them
 *   as duplicates and never folds them into one plausible-looking row. That is the difference
 *   between hiding a defect and surfacing one.
 */

/**
 * The execution policy of a bot — the part of the configuration that is not the protocol, the
 * market, or the broker.
 *
 * ⚠️ Every field here is part of the IDENTITY. Do not remove one because it "looks unchanged"
 * across the bots you happen to be looking at — that is precisely the reasoning that produced the
 * wrong count twice (see the header).
 */
export interface StrategyTreatment {
  minComposite: number;
  baseSize: number | null;
  slPct: number | null;
  tpPct: number | null;
  maxHoldHours: number | null;
  cooldownMinutes: number;
  maxPyramidTiers: number;
  timeframe: string;
  sessionWindow: string | null;
  /**
   * #928 — the EXIT-side session boundary (`'HH:MM'` UTC), null = none.
   *
   * ⚠️ PART OF THE IDENTITY, on purpose. Two bots identical in every other respect but with
   * different exit boundaries are NOT the same strategy — one is flat by 13:30 UTC and one is not.
   * Omitting it would let exactly the error this service's header describes happen again: a field
   * that is UNCHANGED across the bots you happen to be looking at gets treated as "not identity",
   * and two genuinely different strategies are blended into one rating.
   */
  exitBeforeUtc: string | null;
  mode: string;
  maxPositions: number;
  maxDailyLoss: number | null;
  useRaritySizing: boolean;
  maxSize: number | null;
}

export interface DerivedStrategy {
  /** Stable identity over protocol + role + market + broker + treatment. The "ID" of #876/#875. */
  strategyKey: string;
  /** Owner-given name. Always null until #875 pins one. */
  name: string | null;
  /** False for every derived strategy today; #875 makes this true. */
  pinned: boolean;
  /** The SIGNAL thesis. Distinct protocol = distinct strategy. */
  protocolIds: string[];
  protocolRoles: string[];
  /** The execution policy part. One bot per strategy unless a duplicate is flagged. */
  botIds: string[];
  botNames: string[];
  /** The MARKET. Part of the configuration — a different market is a different strategy. */
  symbols: string[];
  scoringStrategyIds: string[];
  brokers: string[];
  treatment: StrategyTreatment;
  /** >1 only when a DUPLICATE exists — see `duplicateBotNames`. */
  botCount: number;
  symbolCount: number;
  /** True when the bot is `active`. */
  active: boolean;
  /**
   * ⚠️ DEFECT SURFACE — bot names byte-identical to this one (same protocol, role, market, broker
   * AND treatment). The owner's rule: *"we should never have bots that do the exact same thing...
   * it would mean its a duplicate and should be avoided."*
   *
   * This is the ONLY case in which two bots share a `strategyKey`. It is reported rather than
   * merged: a duplicate is a fault to remove, so folding it into one tidy row would hide it.
   */
  duplicateBotNames: string[];
  /**
   * ⚠️ DEFECT SURFACE — the bot is reached via the LEGACY `protocolId` link because it has no
   * `strategy_protocol` subscription. `SignalQueueService.syncQueues()` joins the subscription
   * table, so such a bot can never trade (see #874). Surfaced so it is visible, not silent.
   */
  unreachableBotNames: string[];
  /**
   * A/B LINEAGE (2026-09-22) — bot ids this strategy's bot(s) were copied FROM, via
   * `POST /api/trading/strategies/:id/duplicate`.
   *
   * ⚠️ METADATA, NOT IDENTITY. It is deliberately NOT part of `strategyKey`: a copy is a
   * different strategy because its PROTOCOL differs, never because of who its ancestor was.
   * Adding this to the key would split or merge strategies on a fact that cannot change a trade.
   * Consumers resolve the id to a name by finding the row whose `botIds` contains it.
   */
  copiedFromBotIds: string[];
}

export interface DerivedStrategiesResponse {
  strategies: DerivedStrategy[];
  totalStrategies: number;
  totalBots: number;
  /** Strategies whose key is shared by more than one bot — a duplication fault. 0 is healthy. */
  duplicateGroups: number;
  /** Bots with no protocol link at all, so they belong to no strategy. */
  orphans: string[];
  derivedAt: string;
  definition: string;
}

/** Minimal shape of the prisma rows this service reads. */
interface BotRow {
  id: string;
  name: string;
  symbol: string;
  brokerId: string;
  active: boolean;
  protocolId: string | null;
  shortProtocolId: string | null;
  scoringStrategyId: string | null;
  minComposite: number;
  baseSize: number | null;
  slPct: number | null;
  tpPct: number | null;
  maxHoldHours: number | null;
  cooldownMinutes: number;
  maxPyramidTiers: number;
  timeframe: string;
  sessionWindow: string | null;
  /** #928 — the exit-side boundary. Part of the identity; see `StrategyTreatment`. */
  exitBeforeUtc: string | null;
  mode: string;
  maxPositions: number;
  maxDailyLoss: number | null;
  useRaritySizing: boolean;
  maxSize: number | null;
  /** A/B lineage (2026-09-22) — the bot this one was copied from, or null. Not part of identity. */
  duplicatedFromId: string | null;
  protocols?: Array<{ protocolId: string; role: string }>;
}

@Injectable()
export class StrategyDerivationService {
  private readonly logger = new Logger(StrategyDerivationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async deriveAll(): Promise<DerivedStrategiesResponse> {
    const bots = (await this.prisma.tradingStrategy.findMany({
      include: { protocols: { select: { protocolId: true, role: true } } },
    })) as unknown as BotRow[];

    // key -> accumulating group
    const groups = new Map<string, {
      protocolIds: Set<string>;
      protocolRoles: Set<string>;
      botIds: Map<string, string>; // id -> name (a Map so a duplicate cannot silently overwrite)
      symbols: Set<string>;
      scoringStrategyIds: Set<string>;
      brokers: Set<string>;
      treatment: StrategyTreatment;
      active: boolean;
      unreachableBotNames: Set<string>;
      /** A/B lineage (2026-09-22) — bot ids the group's bot(s) were copied from. Not identity. */
      copiedFromBotIds: Set<string>;
    }>();

    const orphans: string[] = [];

    for (const bot of bots) {
      const treatment = this.treatmentOf(bot);

      // Protocols this bot consumes. Subscriptions are the canonical path; a bot with none may
      // still carry the legacy single protocolId/shortProtocolId (#801 — value is slug OR uuid).
      const links: Array<{ protocolId: string; role: string; legacy: boolean }> = [];
      for (const sub of bot.protocols ?? []) {
        links.push({ protocolId: sub.protocolId, role: sub.role || 'long', legacy: false });
      }
      if (links.length === 0) {
        if (bot.protocolId) links.push({ protocolId: bot.protocolId, role: 'long', legacy: true });
        if (bot.shortProtocolId) {
          links.push({ protocolId: bot.shortProtocolId, role: 'short', legacy: true });
        }
      }

      if (links.length === 0) {
        orphans.push(bot.name);
        continue;
      }

      for (const link of links) {
        // ⚠️ The MARKET and the BROKER are in the key. A previous version excluded them as
        // "scope", which collapsed six FX markets into one strategy. The owner's rule: a different
        // market IS a different configuration. The only way two bots now share a key is by being
        // byte-identical — reported as a duplicate below.
        const key = this.strategyKey(link.protocolId, link.role, bot.symbol, bot.brokerId, treatment);

        let g = groups.get(key);
        if (!g) {
          g = {
            protocolIds: new Set(),
            protocolRoles: new Set(),
            botIds: new Map(),
            symbols: new Set(),
            scoringStrategyIds: new Set(),
            brokers: new Set(),
            treatment,
            active: false,
            unreachableBotNames: new Set(),            copiedFromBotIds: new Set(),          };
          groups.set(key, g);
        }

        g.protocolIds.add(link.protocolId);
        g.protocolRoles.add(link.role);
        g.botIds.set(bot.id, bot.name);
        g.symbols.add(bot.symbol);
        g.brokers.add(bot.brokerId);
        if (bot.scoringStrategyId) g.scoringStrategyIds.add(bot.scoringStrategyId);
        if (bot.active) g.active = true;
        if (link.legacy) g.unreachableBotNames.add(bot.name);
        if (bot.duplicatedFromId) g.copiedFromBotIds.add(bot.duplicatedFromId);
      }
    }

    let duplicateGroups = 0;

    const strategies: DerivedStrategy[] = [...groups.entries()].map(([strategyKey, g]) => {
      const names = [...g.botIds.values()].sort();
      // A group holding more than one bot is a DUPLICATION FAULT, not a merged strategy. Grouping
      // is what makes it detectable; reporting it is what makes it fixable.
      const isDuplicate = names.length > 1;
      if (isDuplicate) {
        duplicateGroups += 1;
        this.logger.warn(
          `Duplicate bots detected (${strategyKey}): ${names.join(' == ')} — identical protocol, role, market, broker and treatment. Per the owner's rule these should not both exist.`,
        );
      }

      return {
        strategyKey,
        name: null, // #875 pins names; every strategy is derived today
        pinned: false,
        protocolIds: [...g.protocolIds].sort(),
        protocolRoles: [...g.protocolRoles].sort(),
        botIds: [...g.botIds.keys()].sort(),
        botNames: names,
        symbols: [...g.symbols].sort(),
        scoringStrategyIds: [...g.scoringStrategyIds].sort(),
        brokers: [...g.brokers].sort(),
        treatment: g.treatment,
        botCount: names.length,
        symbolCount: g.symbols.size,
        active: g.active,
        duplicateBotNames: names,
        unreachableBotNames: [...g.unreachableBotNames].sort(),
        copiedFromBotIds: [...g.copiedFromBotIds].sort(),
      };
    });

    // Group by market so the families a reader reasons about sit together, then by protocol.
    strategies.sort(
      (a, b) =>
        a.protocolIds.join(',').localeCompare(b.protocolIds.join(',')) ||
        a.symbols.join(',').localeCompare(b.symbols.join(',')) ||
        a.strategyKey.localeCompare(b.strategyKey),
    );

    if (orphans.length) {
      this.logger.warn(
        `StrategyDerivation: ${orphans.length} bot(s) belong to no strategy (no protocol link): ${orphans.join(', ')}`,
      );
    }
    if (duplicateGroups > 0) {
      this.logger.warn(
        `StrategyDerivation: ${duplicateGroups} duplicate group(s) found. Duplicate bots "should be avoided" (owner's rule) — surfaced rather than merged.`,
      );
    }

    return {
      strategies,
      totalStrategies: strategies.length,
      totalBots: bots.length,
      duplicateGroups,
      orphans: orphans.sort(),
      derivedAt: new Date().toISOString(),
      definition:
        'A strategy is a bot configuration: protocol + role + market + broker + execution policy. Any difference is a different strategy; identical bots are duplicates.',
    };
  }

  /**
   * strategyKey() — the identity. Stable SHA-256 over the WHOLE configuration.
   *
   * ⚠️ `symbol` and `brokerId` are INCLUDED, deliberately. A previous version excluded them on the
   * reasoning that "symbols are scope, not identity", which collapsed six FX markets into one
   * strategy. The owner's rule: *"Different markets. Is different configuration therefore the end
   * result is a unique strategy."* Two bots trading different markets are different strategies.
   *
   * The only way two bots share this key is by being byte-identical — which this service reports as
   * a duplicate.
   */
  strategyKey(
    protocolId: string,
    role: string,
    symbol: string,
    brokerId: string,
    treatment: StrategyTreatment,
  ): string {
    const payload = JSON.stringify({
      protocolId,
      role,
      symbol,
      brokerId,
      treatment: this.canonicalise(treatment),
    });
    return createHash('sha256').update(payload).digest('hex').slice(0, 16);
  }

  /** Extract the treatment (execution policy) from a bot row. */
  private treatmentOf(bot: BotRow): StrategyTreatment {
    return {
      minComposite: bot.minComposite,
      baseSize: bot.baseSize,
      slPct: bot.slPct,
      tpPct: bot.tpPct,
      maxHoldHours: bot.maxHoldHours,
      cooldownMinutes: bot.cooldownMinutes,
      maxPyramidTiers: bot.maxPyramidTiers,
      timeframe: bot.timeframe,
      sessionWindow: bot.sessionWindow,
      exitBeforeUtc: bot.exitBeforeUtc ?? null,
      mode: bot.mode,
      maxPositions: bot.maxPositions,
      maxDailyLoss: bot.maxDailyLoss,
      useRaritySizing: bot.useRaritySizing,
      maxSize: bot.maxSize,
    };
  }

  /**
   * canonicalise() — normalise the treatment so the hash is STABLE.
   *
   * Two hazards this closes:
   *  1. Integer/float drift — MySQL may hand back `1` where another row holds `1.0`. Both must
   *     hash identically or the SAME configuration splits into two strategies, inventing a
   *     difference that does not exist.
   *  2. Key ordering — `JSON.stringify` follows insertion order, so an object built by a different
   *     code path would hash differently.
   * `null` is preserved as an explicit marker: NULL means "no limit" (#773), which is a DIFFERENT
   * configuration from any numeric value, and must not be coerced to 0.
   */
  private canonicalise(t: StrategyTreatment): Record<string, string> {
    const num = (v: number | null | undefined): string => (v === null || v === undefined ? 'null' : Number(v).toFixed(6));
    // ⚠️ Hazard 3 — `sessionWindow` has TWO storage forms. Measured 2026-09-18: 9 bots store a bare
    // `london`, 3 store `["london"]`. The schema declares both valid and the engine parses them
    // identically, so they MUST hash identically — otherwise two bots that behave the same are
    // reported as two different strategies. `parseSessionWindow` is the CANONICAL parser: it folds
    // both forms AND resolves aliases (`sydney` -> `asian`, `zurich` -> `london`). Do not hand-roll
    // this — a second implementation would drift from the one the engine actually uses.
    const tags = parseSessionWindow(t.sessionWindow).slice().sort();
    const out: Record<string, string> = {
      baseSize: num(t.baseSize),
      cooldownMinutes: num(t.cooldownMinutes),
      maxDailyLoss: num(t.maxDailyLoss),
      maxHoldHours: num(t.maxHoldHours),
      maxPositions: num(t.maxPositions),
      maxPyramidTiers: num(t.maxPyramidTiers),
      maxSize: num(t.maxSize),
      minComposite: num(t.minComposite),
      mode: String(t.mode),
      // `ungated` is a real declared state (NULL = may act any time), distinct from any tag list.
      sessionWindow: tags.length ? tags.join(',') : 'ungated',
      // #928 — CANONICALISED through the parser, never the raw string. `'13:30'` and `' 13:30 '`
      // must key identically or the whitespace invents a strategy that does not exist — the same
      // reason `sessionWindow` is normalised one line above. An unreadable value keys as
      // `invalid:<raw>` rather than collapsing into `none`, so a typo is a DIFFERENT strategy
      // rather than silently the same as having no rule at all.
      exitBeforeUtc: (() => {
        const p = parseExitBoundary(t.exitBeforeUtc);
        if (p.kind === 'none') return 'none';
        return p.kind === 'at'
          ? `${String(Math.floor(p.minutes / 60)).padStart(2, '0')}:${String(p.minutes % 60).padStart(2, '0')}`
          : `invalid:${String(p.raw)}`;
      })(),
      slPct: num(t.slPct),
      timeframe: String(t.timeframe),
      tpPct: num(t.tpPct),
      useRaritySizing: String(Boolean(t.useRaritySizing)),
    };
    // Fixed key order — see hazard 2 above.
    return Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k]]));
  }
}
