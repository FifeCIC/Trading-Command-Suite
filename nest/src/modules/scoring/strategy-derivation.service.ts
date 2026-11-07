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
 *         execution policy. 26 bots resolve to 26 strategies, and the `forex-session-v1-long` family to
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
  minRarityBand: string | null;
  requireDirection: string | null;
  baseSize: number | null;
  slPct: number | null;
  tpPct: number | null;
  /** Fixed-money take-profit. Part of the identity: it is the exit (#1224). */
  takeProfitAmount: number | null;
  /** How the size is computed, and the risk it commits. Part of the identity (#1224). */
  sizingModel: string | null;
  sizingRiskPct: number | null;
  allocationAmount: number | null;
  /** The OTHER protocol a reversal bot trades through. Part of the identity (#1224). */
  shortProtocolId: string | null;
  /** The classification rules that produced the score this bot acts on. Part of the identity. */
  scoringStrategyId: string | null;
  /** The simulated trailing stop — it decides when a position closes (#1224). */
  simTslEnabled: boolean;
  simTslActivationPct: number | null;
  simTslDistancePct: number | null;
  /** Exhaustion observation — it closes positions (#1224). */
  exhaustionObserveEnabled: boolean;
  exhaustionDecelPct: number | null;
  /** Hot-stock top-up allocation — it commits money (#1224). */
  hotStockEnabled: boolean;
  hotStockAllocation: number | null;
  hotStockMaxHoldHours: number | null;
  hotStockDetectionMode: string | null;
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
  /**
   * True when this group shares a key because the extra bot(s) were DECLARED copies of the root —
   * an experiment pair — rather than an accidental duplicate (#1212).
   */
  pairDeclared?: boolean;
  /** The fields the pair actually differs in, e.g. `['takeProfitAmount']`. Named, never inferred. */
  pairDifferingFields?: string[];
}

export interface DerivedStrategiesResponse {
  strategies: DerivedStrategy[];
  totalStrategies: number;
  totalBots: number;
  /** Strategies whose key is shared by more than one bot — a duplication fault. 0 is healthy. */
  duplicateGroups: number;
  /**
   * Groups that share a key because one bot was DECLARED as a copy of another (an experiment pair),
   * not because a duplicate was created by accident (#1212). Counted separately so a healthy
   * experiment does not look like a fault, and so `duplicateGroups === 0` keeps its meaning.
   */
  declaredPairs: number;
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
  /**
   * ⚠️ These are NOT part of the hashed treatment, and two bots may differ in them while sharing a
   * `strategyKey` — which is why the duplicate message must name them (#1212). Declared here so a
   * typo reads `undefined` at compile time rather than silently comparing nothing.
   */
  takeProfitAmount?: number | null;
  sizingModel?: string | null;
  sizingRiskPct?: number | null;
  allocationAmount?: number | null;
  simTslEnabled?: number | boolean | null;
  simTslActivationPct?: number | null;
  simTslDistancePct?: number | null;
  exhaustionObserveEnabled?: number | boolean | null;
  exhaustionDecelPct?: number | null;
  hotStockEnabled?: number | boolean | null;
  hotStockAllocation?: number | null;
  hotStockMaxHoldHours?: number | null;
  hotStockDetectionMode?: string | null;
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

    // Full rows by id — the pair check needs `duplicatedFromId` and the fields the strategy KEY does
    // not hash, which `botIds` (id → name) cannot answer (#1212).
    const botById = new Map<string, BotRow>(bots.map((b) => [b.id, b]));

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
    let declaredPairs = 0;

    const strategies: DerivedStrategy[] = [...groups.entries()].map(([strategyKey, g]) => {
      const names = [...g.botIds.values()].sort();
      // A group holding more than one bot is EITHER a declared experiment pair OR a duplication
      // fault, and those two used to be reported identically (#1212).
      //
      // ⚠️ MEASURED 2026-11-06. `DAX Five Pound Target Bot` and `DAX Index Tick Scalp Bot` were
      // warned about as "identical … should not both exist". They are not identical: the first was
      // created by DUPLICATING the second (`duplicatedFromId` points at it) and its own description
      // says *"IDENTICAL … except ONE field: takeProfitAmount = 5"* — it is a money-take-profit
      // experiment whose control is the other bot. Deleting either would have destroyed the
      // experiment, and the warning would have been the reason.
      //
      // ⚠️ AND the word "identical" was itself false: `takeProfitAmount` is NOT part of the hashed
      // treatment, so two bots can share a key while differing in a money-moving exit parameter.
      // `differingFields` below names every field that actually differs, so the message can stop
      // claiming an equality it has not checked.
      const pair = this.describePair(g.botIds, botById);
      const isDuplicate = names.length > 1 && !pair.declared;
      if (names.length > 1 && pair.declared) {
        declaredPairs += 1;
        this.logger.log(
          `Declared experiment pair (${strategyKey}): ${names.join(' vs ')} — ${pair.copiedNames.join(', ')} was created by copying the control, and the pair differs only in [${pair.differingFields.join(', ') || 'nothing'}] (${pair.note}). Not a duplication fault.`,
        );
      }
      if (isDuplicate) {
        duplicateGroups += 1;
        this.logger.warn(
          `Duplicate bots detected (${strategyKey}): ${names.join(' == ')} — same protocol, role, market, broker and execution policy, and NOT a declared copy${pair.differingFields.length ? `; they differ in [${pair.differingFields.join(', ')}]` : ''}. Per the owner's rule these should not both exist.`,
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
        // #1212 — a declared experiment pair is reported, not warned about.
        pairDeclared: pair.declared,
        pairDifferingFields: pair.differingFields,
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
      declaredPairs,
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
    // Delegates to the module-level pure function so a migration script hashes EXACTLY the same
    // payload. Two implementations of this hash would drift, and a drifted key is indistinguishable
    // from a changed configuration (#1224).
    return computeStrategyKey(protocolId, role, symbol, brokerId, treatment);
  }

  /**
   * describePair() — is this group a DECLARED experiment pair, and what actually differs? (#1212)
   *
   * ── DECISION (2026-11-06, primary) ──
   * WHAT:      A group of >1 bot sharing a strategy key is an EXPERIMENT PAIR when there is exactly
   *            one root and every other member's `duplicatedFromId` points inside the group. It is
   *            reported at LOG and counted in `declaredPairs`. Anything else stays a fault.
   * WHY:       The measured group was `DAX Five Pound Target Bot` vs `DAX Index Tick Scalp Bot` —
   *            the first created BY COPYING the second, differing only in `takeProfitAmount` (5 vs
   *            null). The old verdict ("identical … should not both exist") would have had someone
   *            delete one arm of a money-take-profit experiment.
   * INSTEAD OF: Deleting, merging or deactivating one bot — which is what the issue proposed as the
   *            first option, and what the boot warning invited.
   * REVERSE BY: Treat `duplicatedFromId` as non-significant (always return `declared: false`). The
   *            pair then reads as a fault again, which is the old behaviour.
   * REGISTER:  docs/SETTLED-DECISIONS.md row 153
   * GUARD:     strategy-derivation.pair.spec.ts (6 tests, canaried both ways) — forcing the pair
   *            check to fail turns 3 of them red.
   *
   * ⚠️ THE MEASURED CASE. `DAX Five Pound Target Bot` groups with `DAX Index Tick Scalp Bot`: same
   * protocol, role, market, broker and hashed treatment. The detector called them "identical … should
   * not both exist". Both statements were wrong:
   *
   *   - `duplicatedFromId` on the second points at the first — it was created BY COPYING it, which is
   *     how an experiment is authored, not how a duplicate is accidentally made;
   *   - they differ in `takeProfitAmount` (5 vs null). That field is **not** in the hashed treatment,
   *     so the group could not see the difference it was claiming did not exist.
   *
   * ⚠️ It is deliberately NOT a licence for two free-running bots. Anything that does not match this
   * shape is still a duplication fault, and the message now names the fields that differ rather than
   * asserting equality it has not checked.
   */
  private describePair(
    botIds: Map<string, string>,
    botById: Map<string, BotRow>,
  ): { declared: boolean; copiedNames: string[]; differingFields: string[]; note: string } {
    const members = [...botIds.keys()].map((id) => botById.get(id)).filter((b): b is BotRow => !!b);
    const none = { declared: false, copiedNames: [] as string[], differingFields: [] as string[], note: '' };
    if (members.length < 2) return none;

    const inGroup = new Set(members.map((b) => b.id));
    const roots = members.filter((b) => !b.duplicatedFromId || !inGroup.has(b.duplicatedFromId));
    const copied = members.filter((b) => b.duplicatedFromId && inGroup.has(b.duplicatedFromId));

    const differingFields = this.differingFields(members);

    if (roots.length !== 1 || copied.length !== members.length - 1) {
      return {
        declared: false,
        copiedNames: copied.map((b) => b.name),
        differingFields,
        note: `not a declared copy (${roots.length} root(s), ${copied.length} copied)`,
      };
    }

    return {
      declared: true,
      copiedNames: copied.map((b) => b.name),
      differingFields,
      note: `control: ${roots[0].name}`,
    };
  }

  /**
   * Fields two bots in the SAME group can differ in.
   *
   * ⚠️ Since v2 (#1224) these are the fields the KEY still excludes — everything else that changes
   * behaviour is hashed, so two bots cannot share a key while differing in an exit or a size. The
   * list therefore shrank to the deliberately-unkeyed columns, and it is the SAME declaration the
   * coverage spec checks (`DECLARED_UNKEYED_FIELDS`), so it cannot go stale in either direction.
   *
   * ⚠️ The previous version of this list also named `mode`, `maxHoldHours` and `maxSize` — three
   * fields the key ALREADY hashed. It was reported as "they differ in [mode]" while mode was part
   * of the hash, i.e. a message that lied about the thing it was describing. Removed by deriving
   * the list rather than maintaining it.
   */
  private differingFields(members: BotRow[]): string[] {
    const fields = [...Object.keys(DECLARED_UNKEYED_FIELDS), ...TREATMENT_FIELD_NAMES];
    const out: string[] = [];
    for (const field of fields) {
      // Always differ, or already reported by `pairDeclared` itself.
      if (field === 'id' || field === 'name' || field === 'duplicatedFromId') continue;
      const values = new Set(
        members.map((m) => {
          const v = (m as unknown as Record<string, unknown>)[field];
          return v === null || v === undefined ? 'null' : String(v);
        }),
      );
      if (values.size > 1) out.push(field);
    }
    return out;
  }

  /** Extract the treatment (execution policy) from a bot row. */
  private treatmentOf(bot: BotRow): StrategyTreatment {
    return buildTreatment(bot);
  }

  private canonicalise(t: StrategyTreatment): Record<string, string> {
    return canonicaliseTreatment(t);
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// IDENTITY — extracted as PURE functions so a migration script can compute a key without booting
// Nest. A second implementation of the hash would drift from this one, and a drifted key looks
// exactly like a changed configuration (#1224).
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * ⚠️ KEY VERSION — bumped when the hashed payload changes shape.
 *
 * v1 (implicit, until 2026-11-07): protocol + role + symbol + broker + a treatment that OMITTED
 * every money field — no takeProfitAmount, no sizingModel/sizingRiskPct, no simulated trailing
 * stop, no exhaustion observation, no hot-stock allocation, no shortProtocolId, no
 * scoringStrategyId, no requireDirection/minRarityBand.
 *
 * v2 (2026-11-07, #1224): every field that changes an EXIT, a SIZE, or the MONEY COMMITTED is part
 * of the identity. Measured cost of v1: `DAX Five Pound Target Bot` and `DAX Index Tick Scalp Bot`
 * hashed IDENTICALLY while differing in takeProfitAmount (5 vs null) — two different exit policies
 * wearing one identity.
 *
 * The prefix is not decoration: it lets the migration script (and a future reader) tell which
 * scheme a stored key came from instead of guessing from a 16-character hex string.
 */
export const KEY_VERSION = 2;

/**
 * The identity RULE, in one sentence, because #1224's first acceptance item is that it be written
 * down rather than inferred from a field list:
 *
 *   A strategy is protocol + role + market + broker + EVERY field that changes what the bot does
 *   with money — when it enters, how much it commits, and when or how it exits.
 *
 * A field that only names, describes or schedules the bot (name, description, active, version,
 * magic, theory) is not identity. Everything else must be classified — by `KEYED_FIELDS`,
 * `DECLARED_UNKEYED_FIELDS` or the bot columns read by `buildTreatment` — or the coverage spec
 * fails the build.
 */
export const IDENTITY_RULE =
  'protocol + role + market + broker + every field that changes an exit, a size, or the money committed';

/**
 * The columns hashed at the TOP LEVEL of the payload rather than inside `treatment` — `role` is the
 * fourth, and it is not a column (it comes from the protocol link). Declared so the coverage guard
 * knows they are identity rather than unclassified.
 */
export const IDENTITY_TOP_LEVEL_COLUMNS = ['protocolId', 'symbol', 'brokerId'] as const;

/**
 * Bot columns that are deliberately NOT identity, with the reason attached.
 *
 * ⚠️ This replaced `UNKEYED_FIELDS`, which had the opposite job and the opposite defect: it was a
 * hand-maintained list of what the key IGNORED, so it went stale silently and it also listed
 * `mode`, `maxHoldHours` and `maxSize` — three fields the key already hashed. A list that lies
 * about what is unkeyed is worse than no list. This one is checked against the key by the coverage
 * spec, so it cannot claim a field the key uses.
 */
export const DECLARED_UNKEYED_FIELDS: Record<string, string> = {
  id: 'the row key, not the configuration',
  name: 'a label the owner can change without changing behaviour',
  slug: 'a URL-safe label',
  description: 'prose',
  active: 'whether it is running, not what it does — one configuration can be on or off',
  createdAt: 'bookkeeping',
  updatedAt: 'bookkeeping',
  version: 'a schema/seed version stamp',
  duplicatedFromId: 'provenance: says who copied whom, not what either does',
  magic: 'per-ORDER attribution (#1018); two bots differ in magic by construction',
  theory: 'prose',
  theoryKind: 'prose category',
};

/** Extract the treatment from a bot row. Pure, so a script can use the SAME extraction. */
export function buildTreatment(bot: any): StrategyTreatment {
  return {
    minComposite: bot.minComposite,
    minRarityBand: bot.minRarityBand ?? null,
    requireDirection: bot.requireDirection ?? null,
    baseSize: bot.baseSize,
    slPct: bot.slPct,
    tpPct: bot.tpPct,
    takeProfitAmount: bot.takeProfitAmount ?? null,
    sizingModel: bot.sizingModel ?? null,
    sizingRiskPct: bot.sizingRiskPct ?? null,
    allocationAmount: bot.allocationAmount ?? null,
    shortProtocolId: bot.shortProtocolId ?? null,
    scoringStrategyId: bot.scoringStrategyId ?? null,
    simTslEnabled: Boolean(bot.simTslEnabled),
    simTslActivationPct: bot.simTslActivationPct ?? null,
    simTslDistancePct: bot.simTslDistancePct ?? null,
    exhaustionObserveEnabled: Boolean(bot.exhaustionObserveEnabled),
    exhaustionDecelPct: bot.exhaustionDecelPct ?? null,
    hotStockEnabled: Boolean(bot.hotStockEnabled),
    hotStockAllocation: bot.hotStockAllocation ?? null,
    hotStockMaxHoldHours: bot.hotStockMaxHoldHours ?? null,
    hotStockDetectionMode: bot.hotStockDetectionMode ?? null,
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
 * The treatment field NAMES, derived from `buildTreatment` itself.
 *
 * ⚠️ Derived, never hand-written: a field added to `buildTreatment` joins the identity AND this
 * list in one edit, so the duplicate message cannot report a field the key hashes (which is what
 * the old hand-written `UNKEYED_FIELDS` did with `mode`, `maxHoldHours` and `maxSize`).
 */
export const TREATMENT_FIELD_NAMES: string[] = Object.keys(buildTreatment({}));

/**
 * canonicaliseTreatment() — normalise the treatment so the hash is STABLE.
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
export function canonicaliseTreatment(t: StrategyTreatment): Record<string, string> {
  const num = (v: number | null | undefined): string => (v === null || v === undefined ? 'null' : Number(v).toFixed(6));
  const text = (v: string | null | undefined): string => (v === null || v === undefined ? 'null' : String(v));
  const flag = (v: boolean | null | undefined): string => String(Boolean(v));
  // ⚠️ Hazard 3 — `sessionWindow` has TWO storage forms. Measured 2026-09-18: 9 bots store a bare
  // `london`, 3 store `["london"]`. The schema declares both valid and the engine parses them
  // identically, so they MUST hash identically — otherwise two bots that behave the same are
  // reported as two different strategies. `parseSessionWindow` is the CANONICAL parser: it folds
  // both forms AND resolves aliases (`sydney` -> `asian`, `zurich` -> `london`). Do not hand-roll
  // this — a second implementation would drift from the one the engine actually uses.
  const tags = parseSessionWindow(t.sessionWindow).slice().sort();
  const out: Record<string, string> = {
    allocationAmount: num(t.allocationAmount),
    baseSize: num(t.baseSize),
    cooldownMinutes: num(t.cooldownMinutes),
    exhaustionDecelPct: num(t.exhaustionDecelPct),
    exhaustionObserveEnabled: flag(t.exhaustionObserveEnabled),
    hotStockAllocation: num(t.hotStockAllocation),
    hotStockDetectionMode: text(t.hotStockDetectionMode),
    hotStockEnabled: flag(t.hotStockEnabled),
    hotStockMaxHoldHours: num(t.hotStockMaxHoldHours),
    maxDailyLoss: num(t.maxDailyLoss),
    maxHoldHours: num(t.maxHoldHours),
    maxPositions: num(t.maxPositions),
    maxPyramidTiers: num(t.maxPyramidTiers),
    maxSize: num(t.maxSize),
    minComposite: num(t.minComposite),
    minRarityBand: text(t.minRarityBand),
    mode: String(t.mode),
    requireDirection: text(t.requireDirection),
    scoringStrategyId: text(t.scoringStrategyId),
    // `ungated` is a real declared state (NULL = may act any time), distinct from any tag list.
    sessionWindow: tags.length ? tags.join(',') : 'ungated',
    // #928 — CANONICALISED through the parser, never the raw string.
    exitBeforeUtc: (() => {
      const p = parseExitBoundary(t.exitBeforeUtc);
      if (p.kind === 'none') return 'none';
      return p.kind === 'at'
        ? `${String(Math.floor(p.minutes / 60)).padStart(2, '0')}:${String(p.minutes % 60).padStart(2, '0')}`
        : `invalid:${String(p.raw)}`;
    })(),
    shortProtocolId: text(t.shortProtocolId),
    simTslActivationPct: num(t.simTslActivationPct),
    simTslDistancePct: num(t.simTslDistancePct),
    simTslEnabled: flag(t.simTslEnabled),
    sizingModel: text(t.sizingModel),
    sizingRiskPct: num(t.sizingRiskPct),
    slPct: num(t.slPct),
    takeProfitAmount: num(t.takeProfitAmount),
    timeframe: String(t.timeframe),
    tpPct: num(t.tpPct),
    useRaritySizing: String(Boolean(t.useRaritySizing)),
  };
  // Fixed key order — see hazard 2 above.
  return Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k]]));
}

/**
 * computeStrategyKey() — the identity hash, pure so it can be migrated and tested without Nest.
 *
 * ⚠️ `symbol` and `brokerId` are INCLUDED, deliberately. A previous version excluded them on the
 * reasoning that "symbols are scope, not identity", which collapsed six FX markets into one
 * strategy. The owner's rule: *"Different markets. Is different configuration therefore the end
 * result is a unique strategy."*
 *
 * Returns `v2:<16 hex>`. Version-1 keys carry no prefix, so a stored key self-identifies.
 */
export function computeStrategyKey(
  protocolId: string,
  role: string,
  symbol: string,
  brokerId: string,
  treatment: StrategyTreatment,
  version: number = KEY_VERSION,
): string {
  const payload = JSON.stringify({
    v: version,
    protocolId,
    role,
    symbol,
    brokerId,
    treatment: canonicaliseTreatment(treatment),
  });
  return `v${version}:${createHash('sha256').update(payload).digest('hex').slice(0, 16)}`;
}
