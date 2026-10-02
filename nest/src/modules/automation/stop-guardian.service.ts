/**
 * StopGuardianService — directive-based trailing stop management.
 *
 * Monitors open MT5 positions and adjusts stop-loss levels using
 * directive consensus rather than simple price-distance rules.
 *
 * Talks directly to the MT5 bridge for raw position data (ticket, sl, tp).
 */

import { Injectable, Logger } from '@nestjs/common';
import { TradingStrategyService } from '../trading/trading-strategy.service';
import { DirectivesService } from '../directives/directives.service';
import { Mt5ConnectionManager } from '../providers/mt5/mt5-connection-manager.service';
import { NotificationService } from '../notifications/notifications.service';
// ⚠️ #review-2026-09-30 — this read `StopGuardianService AS StopAdjustmentRecorder` because TWO
// classes shared the name `StopGuardianService` (this one guards; that one records). The alias WAS
// the correct name, written down as a workaround for the collision. `trading/stop-guardian.service.ts`
// has now been renamed to `StopAdjustmentRecorder`, so the alias is deleted and each name means one
// thing. If you are looking for the service that TRAILS stops, it is this file.
import { StopAdjustmentRecorder } from '../trading/stop-guardian.service';
import { SystemLogService } from '../system/log.service';

interface Mt5RawPosition {
  ticket: number;
  symbol: string;
  type: string;
  volume: number;
  priceOpen: number;
  priceCurrent: number;
  sl: number | null;
  tp: number | null;
  profit: number;
  comment: string;
  /**
   * #1018 — the magic MT5 stamped on the order, carried by the position for life.
   *
   * Declared here rather than reached for with `as any`: it IS a field of the bridge's
   * `/positions` payload (see the adapter's "raw bridge positions (with comment/magic/profit)"),
   * and leaving it undeclared is how the whole attribution path came to be written without the
   * type system seeing it.
   *
   * `null`/absent = the bridge reported none. `234000` = its `DEFAULT_MAGIC`, i.e. "no bot
   * attributed" — NOT a bot.
   */
  magic?: number | null;
  /**
   * #1030 — WHICH bridge reported this position.
   *
   * Stamped by `Mt5ConnectionManager.getAllPositions()`; the bridge itself never sends it. It is
   * the authority for ADDRESSING a position: the position lives on the account that reported it,
   * so every write for it must go back to THAT bridge.
   *
   * ⚠️ `symbol_route` is NOT a substitute, and this is the whole reason the field exists. A route
   * says where a symbol WOULD be traded NOW; a position was opened under whatever the route was
   * THEN. Change a route and the position does not move with it — reading the route would aim the
   * stop edit at a bridge that has never heard of the ticket, and the failure is a plausible
   * "no such position" rather than anything that looks like a routing bug.
   */
  // ── DECISION (2026-09-30, primary) ──
  // WHAT:      A position is addressed by the bridge that HOLDS it (`brokerId`), never by a URL
  //            captured at start-up, and never by `symbol_route`.
  // WHY:       `getUrl()` with no argument returns the PRIMARY broker, so one captured URL
  //            silently scoped everything to one of two accounts: measured live 2026-09-30,
  //            `:5000` held 7 positions and `:5001` held 2 (US500, GER40), and the guardian
  //            reported `7 guarded` every tick. Those two had never been trailed or time-stopped.
  //            A route is NOT a substitute: it says where a symbol WOULD trade now, while the
  //            position was opened under whatever the route was THEN — change the route and the
  //            position does not move, so the edit would name an account that has never heard of
  //            the ticket.
  // INSTEAD OF: reading `symbol_route` per position — the obvious-looking fix, wrong for exactly
  //            the reason above — and instead of adding a SECOND bridge URL, when
  //            `Mt5ConnectionManager` already had `getAllPositions()` / `getCandles` /
  //            `modifyOrder` and was simply not being used.
  // REVERSE BY: delete this field and pass no broker to the manager calls. That is what #1030 was.
  //            `stop-guardian.service.spec.ts` asserts a broker-3 position is guarded AND that its
  //            modify is addressed to broker 3, so a reversal fails the suite rather than shipping.
  // REGISTER:  docs/SETTLED-DECISIONS.md row 47
  // GUARD:     nest/scripts/validate-single-bridge-position-io.cjs (prebuild; self-test 14/14)
  brokerId?: number;
}

export interface GuardianState {
  enabled: boolean;
  tickIntervalMs: number;
  tickCount: number;
  lastTickAt: string | null;
  nextTickAt: string | null;
  lastTickMs: number;
  guardedPositions: GuardedPosition[];
  recentAdjustments: StopAdjustment[];
  /**
   * ⚠️ #892 — why the last stop edit was REFUSED by the broker, if it was.
   *
   * `0 adjusted` is ambiguous: it reads as "nothing needed adjusting", and before
   * this field the alternative — "positions needed adjusting and the broker rejected
   * every one" — produced exactly the same output. Measured 2026-09-18: three
   * positions cleared the confidence gate, every edit was refused with
   * `HTTP 400 {"error": "Market closed"}`, and nothing anywhere said so.
   */
  lastBridgeRefusal: { at: string; path: string; detail: string } | null;
  /**
   * ⚠️ #893 — symbols the BROKER reported as closed, and when the guardian will
   * probe again. A computed view (see `getState()`), not persisted state.
   *
   * The guardian used to attempt a stop edit per eligible position per tick at any
   * hour. With the market closed the broker refused every one (`HTTP 400
   * {"error": "Market closed"}`) — measured 2026-09-18: 3 refused calls per tick,
   * one tick every 30s, for as long as the market stayed shut. Nothing was
   * mis-applied (the refusal is honest); the cost was pointless broker traffic and
   * a pause in stop maintenance that was invisible.
   *
   * The backoff is REFUSAL-DRIVEN on purpose: the closure is never PREDICTED from
   * bar staleness or session tables, because a wrong "closed" answer would silently
   * stop ALL stop maintenance. Only the broker's own refusal arms it.
   */
  marketClosedBackoff?: Array<{ symbol: string; retryAt: string }>;
  /**
   * ⚠️ #936 — the DECLARATION half of the exit behaviour, served with the live half.
   *
   * `guardedPositions` and `recentAdjustments` show what the guardian IS DOING. Without this
   * field a consumer can render that as a list of edits with no statement of the rule that
   * produced them — a value shown without its enforcement, which is the defect the bot truth
   * view (#864) refuses to render at all. Served from the same response so the two cannot drift.
   *
   * Optional in the type so a test double or an older consumer that builds a `GuardianState`
   * literal by hand still compiles; `getState()` always populates it.
   */
  rules?: GuardianRule[];
  /** `{ global: n, 'per-bot': n }` — see `guardianRuleCounts()`. */
  ruleCounts?: Record<string, number>;
  /**
   * ⚠️ #1018 — HOW the last tick established each position's owner, and WHO it could not.
   *
   * `guardedPositions` shows the SURVIVORS of attribution; this shows the attribution itself.
   * The distinction is not cosmetic: `viaMagic` proves the durable path is LIVE rather than merely
   * present, and `unresolved` names positions that were NOT MANAGED. That second one existed only
   * as a log line, so an API consumer could not tell "everything is guarded" from "three positions
   * were skipped" — the two render identically as a shorter list.
   *
   * Optional in the type for the same reason as `rules` (a hand-built test double still compiles);
   * `getState()` always populates it.
   */
  ownerAttribution?: {
    viaMagic: number;
    viaComment: number;
    unresolved: string[];
  };
  /**
   * #1030 — the per-bridge read, so "the guardian sees both accounts" is a NUMBER rather than an
   * inference. `positionsByBroker` is derived from the `brokerId` stamped on each row by
   * `getAllPositions()`; `brokersQueried` is the configured set.
   *
   * ⚠️ DECLARED LIMITATION: a broker that contributed `0` is reported as `0`, and that number
   * cannot distinguish "this account holds no positions" from "this bridge did not answer". Both
   * are silence, and telling them apart needs a health probe this tick does not make. The field's
   * job is to make the SILENCE VISIBLE — `0` next to a configured broker is the thing to go and
   * check. Use `GET /api/mt5/health` to resolve which of the two it is.
   */
  brokerCoverage?: {
    brokersQueried: number[];
    positionsByBroker: Record<number, number>;
  };
}

export interface GuardedPosition {
  ticket: number;
  symbol: string;
  strategyId: string;
  strategyName: string;
  side: 'BUY' | 'SELL';
  currentSl: number | null;
  recommendedSl: number | null;
  stopConfidence: number;
  wickFilterPassed: boolean;
  lastEvaluatedAt: string | null;
  /**
   * ⚠️ #1018 — HOW the owner was established, so the resolution is CHECKABLE rather than assumed.
   *
   * `'magic'` is the durable key. The two `comment:*` forms are the fallback, and the distinction
   * matters: a position resolved by `comment:unique-prefix` was matched on a TRUNCATED name, so it
   * is the variant most likely to be wrong. Previously every path produced the same
   * `strategyName` and NOTHING said which one had been used, so a check could only assert "the
   * owner is right" — which the comment path also satisfies — and could not show the magic path
   * had run at all.
   */
  ownerVia: 'magic' | 'comment:exact' | 'comment:unique-prefix' | 'comment:normalised' | 'comment:contested';
  /**
   * #1030 — the MT5 account whose stop would be edited, i.e. the bridge this position came from.
   *
   * Served so "is the second broker actually being managed?" is answerable from `GET /status`
   * instead of by reading a log. Before this, `guardedPositions` was populated from ONE bridge and
   * nothing in the payload named which — so a broker-3 position being absent was indistinguishable
   * from it not existing, which is exactly how this defect stayed invisible.
   */
  brokerId?: number;
  /**
   * ⚠️ #1056 — WHY this position was, or was NOT, adjusted on this tick.
   *
   * `guardedPositions` listed every position the guardian CONSIDERED and `recentAdjustments` listed
   * what it DID. Nothing carried the DECLINE. So `stop_adjustment` answered "what did it do?" for
   * every position it touched, and **"why did it leave this one alone?" was recorded nowhere** — not
   * a table, not the structured log. "Nothing happened" and "it declined for a reason" rendered
   * identically, which is the same hole #1030 closed one level up for unattributable owners.
   *
   * Found while closing #1056: FRA40 had ZERO `stop_adjustment` rows ever while its peers were
   * trailed, and the live payload could not say whether the guardian had evaluated it at all.
   *
   * ⚠️ Set only from a branch that was ACTUALLY TAKEN, never inferred from the other fields —
   * `stopConfidence === 0 && recommendedSl === null` is ALSO true of a genuine evaluation that found
   * nothing, so inference cannot replace the statement.
   */
  outcome: GuardedPositionOutcome;
  /**
   * ⚠️ #1041 — the OTHER bots whose orders built this position, when more than one did.
   *
   * Present ⇒ the position was CONTESTED and is being managed by its STRICTEST claimant (the
   * tightest declared stop), so it is protected soonest rather than by whichever bot happened to be
   * looked at first (owner ruling R31, 2026-09-30). Absent ⇒ an ordinary single-owner position, or
   * one nobody claims (those are reported in `ownerAttribution.unresolved` instead).
   *
   * Served so the choice is VISIBLE: the guardian now acts on a position whose ownership it cannot
   * pin to one bot, so which rule it acted by must be readable rather than inferred.
   */
  claimants?: string[];
}

/**
 * #1056 — the guardian's decision for ONE position on ONE tick. Every value is a branch that ran.
 *
 * | outcome | means |
 * |---|---|
 * | `adjusted` | a stop was modified this tick (trail tighten, or the protective floor) |
 * | `protected` | the position was UNLOCKED (sl 0) and the disaster floor was set |
 * | `no-protective-level` | unlocked, and no protective level could be computed |
 * | `no-bars` | fewer than 14 bars from the position's own bridge — everything downstream skips |
 * | `wick-fakeout` | the wick filter judged the move a fakeout, so the stop was deliberately left |
 * | `distance-refused` | #927 — the trail was closer than the declared distance and was refused |
 * | `below-threshold` | consensus below 55; no directional case to tighten on |
 * | `no-recommendation` | no usable ATR/trail, so there was no level to compare against |
 * | `at-target` | evaluated, and the recommended stop EQUALS the one already set |
 */
export type GuardedPositionOutcome =
  | 'adjusted'
  | 'protected'
  | 'no-protective-level'
  | 'no-bars'
  | 'wick-fakeout'
  | 'distance-refused'
  | 'below-threshold'
  | 'no-recommendation'
  | 'at-target';

export interface StopAdjustment {
  timestamp: string;
  ticket: number;
  symbol: string;
  oldSl: number | null;
  newSl: number;
  reason: string;
  stopConfidence: number;
}

/**
 * The directives this guardian READS (#888).
 *
 * ⚠️ Every ID here must ALSO be REGISTERED in `directives.module.ts`, or it resolves
 * to nothing. `Map.get()` returns `undefined` for a key that was never `set` — it
 * does not throw — so an unregistered ID reads as "no evidence" and silently lowers
 * the consensus instead of raising an error.
 *
 * MEASURED 2026-09-18 (#890): 3 of these 4 were unregistered — two sat in
 * `providers` (constructed, never referenced) and one was not imported at all. A
 * `>= 55` threshold calibrated for FOUR signals was therefore applied to ONE, and
 * the guardian never adjusted a stop while every registry count looked healthy.
 * Enforced at build time by `validate-guardian-directive-ids.cjs`
 * (INV-GUARDIAN-DIRECTIVE-RESOLVABLE) and at runtime by the shortfall error in `tick()`.
 *
 * ⚠️ MUST list EXACTLY the IDs fetched with `resultsMap.get(...)` below.
 *
 * `DirectivesService.runAll(input, filter)` runs ALL registered directives when the
 * filter is omitted, and this file used to omit it. Measured 2026-09-18: **505
 * directives evaluated per pass** (101 registered x 5 positions) costing **780ms**, to
 * read these four. The waste was invisible because the result map is only ever indexed
 * by the keys below - the other ~97 results were computed and discarded.
 *
 * ⚠️ Adding a `.get('new-id')` below WITHOUT adding it here does not throw. It silently
 * returns `undefined`, so the guard reads "no evidence" instead of that directive's real
 * answer - a behaviour change disguised as a missing value. Pinned by
 * `stop-guardian.service.spec.ts`.
 *
 * ⚠️ This declaration must sit ABOVE `@Injectable()`, not between it and the class: a
 * decorator applies to the next declaration, so inserting a const there decorates the
 * const (TS1206 "Decorators are not valid here"). The Jest suite did NOT catch that -
 * ts-jest transpiles more permissively; `nest run build` did.
 */

// ── DECISION (2026-09-25, primary) ──
// WHAT:      The set above stays FOUR trail-followers. A support/resistance level directive is NOT
//            added to the guardian's consensus, and it is not used to drive sim-TSL gap closure.
// WHY:       Measured, not assumed. A causal replay over 25,131 observations (1h), 53,906 (15m)
//            and 7,577 (1d) found a confirmed swing-pivot high reverses price NO MORE than an
//            ordinary non-pivot high at the same distance - giveback 0.6% vs 0.5%, 0.5% vs 0.5%,
//            and on 1d the control reverses MORE (2.8% vs 2.5%). The level is a waypoint, not a
//            limit: overshoot past it is a median 0.3% with a p90 of 3.0%.
// INSTEAD OF: Adding a level directive to this set, which #989 anticipated.          <- required when overriding
// REVERSE BY: Run `node scripts/measure-sr-levels.cjs` and show pivot giveback exceeding the
//            CONTROL arm on any timeframe. The control runs on every invocation, so one command
//            re-opens or re-confirms this. Then add the directive as a COPIED configuration -
//            it is maths (maths-change-requires-ab) and A/B cannot report yet (#929).
// REGISTER:  docs/SETTLED-DECISIONS.md row 35
// GUARD:     src/data/theories.js `pivot-resistance-predicts-the-turn` (refuted) +
//            scripts/measure-sr-levels.cjs, whose control arm fails the claim if it ever regresses.
// ⚠️ The 3-bar detection lag is also a hard constraint on ANY level method: a pivot is only
//    knowable PIVOT_WINDOW bars AFTER it forms, so the extreme is always in the past when usable.
const STOP_GUARDIAN_DIRECTIVES = new Set([
  'atr-trailing-stop',
  'supertrend',
  'chandelier-exit',
  'wick-filter',
]);

/**
 * #927 — THE TRAIL DISTANCE FLOOR.
 * ==================================
 *
 * MEASURED DEFECT (2026-09-21): the trail target was `currentPrice − 3 × ATR(5m)` with "never
 * loosen" as its only guard. On FX, `3 × ATR(5m)` is ~0.03–0.11% of price, while the strategy's
 * declared stop distance (`slPct`) is ~1%. So as soon as the price was roughly flat, the trail
 * moved the stop from 1% away to ~0.05% away — a ~20x reduction in one edit, with no minimum
 * distance to stop it. Seven positions closed between 12:40 and 13:08 UTC, **every close price
 * exactly a guardian-set stop** (`stop_adjustment`, oldSl → newSl): EURGBP −1.012% → −0.031%,
 * NZDJPY −1.028% → **+0.058%**. A market pullback smaller than the position's own declared risk
 * hit every one of them simultaneously because they were all trailed to the same tiny distance.
 *
 * THE RULE NOW: a trailing tighten may never leave the stop closer to price than the position's
 * declared stop distance. `3 × ATR` can still WIDEN the trail (a genuinely volatile market
 * deserves more room) but can never tighten it inside the declared risk. The declared distance is
 * the strategy's own `slPct` from entry — the same number the protective floor uses, so the trail
 * and the floor finally agree about what this position tolerates.
 *
 * Keeping these as exported pure functions is deliberate: the tick calls them, and the spec
 * canaries them in both directions without a bridge, a position or a clock.
 */
export function declaredStopDistance(entryPrice: number, slPct: number): number {
  const pct = Number(slPct);
  const safePct = Number.isFinite(pct) && pct > 0 ? pct : 1;
  const entry = Number(entryPrice);
  if (!Number.isFinite(entry) || entry <= 0) return 0;
  return Math.abs(entry * (safePct / 100));
}

/** The distance a trailing tighten must leave between price and the stop (price units). */
export function trailDistanceFor(atrValue: number, declaredDistance: number): number {
  const atr = Number(atrValue);
  const atrTrail = Number.isFinite(atr) && atr > 0 ? 3 * atr : 0;
  return Math.max(atrTrail, declaredDistance);
}

  /**
   * stopAdjustmentReason() — the audit string written to `stop_adjustment.reason`.
   *
   * ⚠️ EXPORTED AND PURE SO THE SPEC CAN CANARY IT (#1034). The defect this replaces was an invisible
   * ARITHMETIC one: `dist` was recorded against `currentPrice` while `slPct` is declared against
   * ENTRY, so for any position in profit `dist < slPct` followed by construction and the audit panel
   * reported **413 breaches of an invariant that had not been breached**. A denominator is exactly
   * the kind of thing that is right in one place and wrong in another, so it is asserted here rather
   * than left to the call site.
   *
   * ⚠️ `dist` is a percentage of ENTRY — the same base `declaredStopDistance()` and `protectiveSl()`
   * use. Do not "simplify" it back to the current price: a percentage is only comparable to the
   * number it is declared against, and the reader of this row is comparing it to `slPct`.
   *
   * ⚠️ `slPct=` is the DECLARED VALUE OF THE TIME, carried IN the row. The panel used to join to
   * today's `trading_strategy.slPct` and judge a days-old row against it, so retuning a bot
   * retro-labelled its whole history as breaches. A row must be self-describing to be judgeable.
   */
  export function stopAdjustmentReason(params: {
    stopConfidence: number;
    atrValue: number;
    trailDistance: number;
    entryPrice: number;
    slPct: number;
    wickScore?: number | null;
  }): string {
    const { stopConfidence, atrValue, trailDistance, entryPrice, slPct, wickScore } = params;
    const entry = Number(entryPrice);
    // `entry > 0` is the guard, not a formatting choice: an unreadable entry cannot produce a
    // percentage, and `n/a` is honest where `0.000%` would read as a real measurement of zero.
    const dist = entry > 0 ? ((trailDistance / entry) * 100).toFixed(3) : 'n/a';
    return (
      `Consensus ${stopConfidence} | ATR=${atrValue.toFixed(5)} | ` +
      `dist=${dist}% | ` +
      `slPct=${slPct} | ` +
      `Wick=${wickScore ?? 'n/a'}`
    );
  }
  /**
   * #927 — validation, not decoration. Returns a problem string when a proposed trail would leave
   * the stop closer to price than the declared distance; the tick REFUSES the modify in that case.
   * With `trailDistanceFor` max()ing, this should never fire — which is exactly why it exists: it
   * makes the invariant checkable (and canaried) rather than implied by one `Math.max` nobody
   * re-reads.
   */
  export function trailDistanceProblem(trailDistance: number, declaredDistance: number): string | null {
  if (!(declaredDistance > 0)) return null; // no declared distance → nothing to enforce
  if (trailDistance + 1e-9 >= declaredDistance) return null;
  return (
    `trail distance ${trailDistance.toFixed(5)} is inside the declared stop distance ` +
    `${declaredDistance.toFixed(5)} — refusing to place a stop tighter than the position's own risk (#927)`
  );
}

/**
 * The BRIDGE's default magic — `DEFAULT_MAGIC` in `scripts/mt5-bridge/mt5_bridge_v2.py`.
 *
 * ⚠️ A LITERAL HERE, DELIBERATELY, and the duplication is the lesser evil. The bridge is Python and
 * this is TypeScript; there is no shared constant to import, and the bridge cannot be assumed
 * running to be asked. The value is fixed forever by MT5's own data — every position opened before
 * 2026-09-28 carries it — so it cannot drift without invalidating the positions that exist.
 *
 * A position carrying it means "NO BOT ATTRIBUTED": not a bot whose magic happens to be 234000, but
 * an order placed before per-bot magics existed. Per-bot values are seeded from 234100 upward for
 * exactly that reason.
 */
const BRIDGE_DEFAULT_MAGIC = 234000;

/**
 * resolvePositionOwner() — WHICH BOT OPENED THIS POSITION (#1018).
 * ==============================================================================
 *
 * THE DEFECT IT REPLACES. `tick()` matched a strategy to a position with
 * `p.symbol === strat.symbol && comment.includes('TCS')`. That is a SYMBOL match standing in for an
 * OWNER match, and **XAUUSD has EIGHT active bots** whose `slPct` runs 0.3 / 0.5 / 1.5 / 3.0 — a
 * 10x spread. The loop finds the SAME position for every one of them, `makeGuarded()` stamps
 * `strategyId: strat.id`, and `strat.slPct` sets the #927 declared-distance floor. So the floor
 * that exists to stop the stop being trailed too tight could be computed from a bot that does not
 * own the position.
 *
 * ⚠️ The page already asserted the correct principle — "Matched on `strategyId`, NEVER on symbol"
 * — but wrote it at the CONSUMER. The filter was right; the value it filtered on was assigned by a
 * symbol match. A rule stated only where it is read does not constrain where it is written.
 *
 * ── WHY THE COMMENT, AND WHY IT IS NOT SIMPLE ──────────────────────────────────────────
 * The open path stamps `TCS <bot name>` on the order comment. **MT5 TRUNCATES COMMENTS**, measured
 * live 2026-09-28: `"TCS Wellington NZDJPY Sessi"` (27 chars) against the strategy's real name
 * `"Wellington NZDJPY Session"` — 11 of 12 positions matched exactly and that one did not, so an
 * exact-equality match alone would silently leave it UNGUARDED.
 *
 * A bare prefix match is worse than it looks: `Gold Scalp M5` and `Gold Scalp M5 (copy)` both
 * exist, so a truncated `TCS Gold Scalp M5` is a prefix of TWO names.
 *
 * So this resolves in THREE tiers and then REFUSES:
 *   1. exact name ✓
 *   2. prefix of EXACTLY ONE name ✓
 *   3. punctuation-normalised match of EXACTLY ONE name ✓ — added 2026-09-29, see below
 *   4. anything else → `null`. Zero candidates (unknown) and 2+ (ambiguous) are the SAME answer:
 *      we cannot tell, and a guess here writes the wrong risk distance onto a live position.
 *
 * ⚠️ `null` is NOT "no owner is plausible" — it is "ownership could not be ESTABLISHED", and the
 * caller must make that visible rather than fall back. A refusal is safe: the position keeps the
 * broker-side stop the order path placed. Falling back to the symbol match is not safe — that is
 * the defect being removed.
 *
 * ⚠️ THE DURABLE KEY IS `magic`, NOT A STRING MATCH — and as of 2026-09-29 it finally works.
 * `magic` travels with a position and is never truncated or punctuation-mangled, but every position
 * commissioned before that date carries the same value (234000 = "no bot attributed"), because
 * `findAll()` dropped the column before it could ever reach an order. Those positions stay
 * unattributable by magic FOR LIFE (magic is immutable in MT5), so for them this comment path is
 * the ONLY key — which is exactly why the third tier below exists. See #1018.
 *
 * Pure and exported so the spec can drive every tier without a bridge, a position or a clock.
 */
/**
 * pickStrictestClaimant() — WHICH bot's rules govern a CONTESTED position (#1041).
 *
 * Owner ruling, 2026-09-30 (R31): a position built from several bots' orders is **managed, by its
 * strictest claimant** — *"so it is protected soonest rather than by whichever bot happens to be
 * looked at first."*
 *
 * ⚠️ STRICTEST = THE TIGHTEST DECLARED STOP = the SMALLEST `slPct`. `slPct` is the distance from
 * entry, so the smaller it is the closer the stop sits and the sooner the position is protected.
 * The xau bots alone span 0.3 / 0.5 / 1.5 / 3.0 — a 10x spread — so the choice is not academic.
 *
 * ⚠️ A claimant with NO usable `slPct` sorts LAST (`Infinity`), never first: an unknown distance
 * must not outrank a known-tight one. Ties break on NAME so the answer is deterministic — a
 * contested position must not be managed by a different bot on each tick.
 *
 * Pure and exported so the rule can be tested without a bridge, a position or a clock.
 */
// ── DECISION (2026-10-02, primary) ──
// WHAT:      A CONTESTED position (>=2 claimants) is GUARDED, governed by its STRICTEST claimant
//            (smallest slPct; unknown slPct sorts last; ties break on name).
// WHY:       resolvePositionOwner() returned null for BOTH "nobody claims it" and "several do", so
//            tick() reported both as "owner could not be established" and a contested position was
//            managed by NOTHING. Measured cost: a three-bot position sat unmanaged 2h20m and ticket
//            152703882760 lost -322.67 (docs/change-guide-position-lifecycle.md row 8).
// INSTEAD OF: Returning null for the ambiguous case too (the pre-#1041 behaviour), which left the
//            position unmanaged; and instead of "first claimant wins", which would protect it in
//            whatever order the comment happened to parse.
// REVERSE BY: Deleting the `contested` out-param and the `contested.length > 1` branch in tick(),
//            so an ambiguous owner falls through to `unresolved` again. Guarded both directions —
//            set that condition back to `> 99` and the canary test fails.
// REGISTER:  docs/SETTLED-DECISIONS.md row 59
// GUARD:     nest/src/modules/automation/stop-guardian.service.spec.ts (contested positions, #1041)
export function pickStrictestClaimant(
  claimants: readonly string[],
  strategies: ReadonlyArray<{ name?: string; slPct?: number }>,
): string {
  const slPct = new Map<string, number>();
  for (const s of strategies) {
    const n = String(s?.name ?? '');
    if (!n) continue;
    const v = Number(s?.slPct);
    slPct.set(n, Number.isFinite(v) ? v : Number.POSITIVE_INFINITY);
  }
  return [...claimants]
    .map((name) => ({ name, sl: slPct.get(name) ?? Number.POSITIVE_INFINITY }))
    .sort((a, b) => (a.sl - b.sl) || a.name.localeCompare(b.name))[0].name;
}

export function resolvePositionOwner(
  comment: string | null | undefined,
  names: readonly string[],
  /**
   * ⚠️ #1041 — OPTIONAL out-parameter. When the comment is AMBIGUOUS (2+ names match) they are
   * pushed here, so a caller can tell CONTESTED (several claim it) from UNKNOWN (nobody does).
   *
   * Omitted ⇒ every existing caller behaves exactly as before, and the return is still `null` for
   * both cases — separating them is the caller's job, and refusing to GUESS an owner stays the
   * default. It exists because the two states were collapsed into one answer and `tick()` then
   * reported both as "owner could not be established": a position built from three bots' orders was
   * managed by nothing for 2 h 20 m, and a ticket in that state lost −322.67 (#1041).
   */
  contestedOut?: string[],
): { name: string; via: 'exact' | 'unique-prefix' | 'normalised' } | null {
  const m = /^TCS\s+(.+)$/.exec(String(comment ?? '').trim());
  if (!m) return null;
  const stamped = m[1].trim();
  if (!stamped) return null;

  // ⚠️ CASE-INSENSITIVE, AND THAT IS NOT LAXNESS. An MT5 comment is an editable field on the
  // position itself — a person can retype it in the terminal — so `TCS s1` against a bot named
  // `S1` is a real state, not a typo to be rejected. Under a case-SENSITIVE rule that position
  // would be left UNGUARDED by a mismatch nobody could see: the wrong answer and the silent answer
  // are the two this whole change exists to remove. Found by the spec, which stamps `TCS s1` for a
  // bot named `S1` — the OLD code never noticed, because a symbol match does not read the comment
  // at all. Comparison is lowercased; the CANONICAL name from the list is returned, so a caller
  // never receives a spelling the registry does not contain.
  const lower = stamped.toLowerCase();
  const exact = names.find((n) => n.toLowerCase() === lower);
  if (exact) return { name: exact, via: 'exact' };
  const prefixed = names.filter((n) => n.toLowerCase().startsWith(lower));
  if (prefixed.length === 1) return { name: prefixed[0], via: 'unique-prefix' };

  // ── TIER 3 — PUNCTUATION-NORMALISED (2026-09-29) ────────────────────────────────────────────
  //
  // ⚠️ MT5 DOES NOT ONLY TRUNCATE A COMMENT — IT STRIPS PUNCTUATION. Measured live 2026-09-29: the
  // bot `Gold Swing 1H (copy)` stamped **`TCS Gold Swing 1H copy`** on its XAUUSD position. The
  // parentheses were gone, so tier 1 missed (not equal) and tier 2 missed (not a prefix of
  // `Gold Swing 1H (copy)`), and that position sat UNMANAGED for **341 consecutive ticks** — warned
  // every 30s, but only into a console log. Compare the NZDJPY case above: truncation was already
  // known; punctuation loss is the same mutation and was not.
  //
  // Removing non-alphanumerics on BOTH sides recovers it. ⚠️ THE UNIQUENESS RULE IS KEPT: a
  // normalised collision is refused exactly like a prefix collision. The pair that can collide is
  // `X` and `X (copy)`, and writing the wrong one's risk distance onto a live position is the
  // failure this function exists to prevent.
  const flat = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const target = flat(stamped);
  const normalised = target ? names.filter((n) => flat(n) === target) : [];
  if (normalised.length === 1) return { name: normalised[0], via: 'normalised' };

  // ⚠️ #1041 — REACHED ONLY WHEN NO SINGLE OWNER COULD BE ESTABLISHED. Record the ambiguous set so
  // the caller can tell "several claim it" from "nobody does". `prefixed` wins the tie because it
  // is the stronger evidence (the comment is a literal prefix); the two are never both populated
  // with 2+, because a tier returning exactly 1 returns above.
  if (contestedOut) {
    if (prefixed.length > 1) contestedOut.push(...prefixed);
    else if (normalised.length > 1) contestedOut.push(...normalised);
  }
  return null;
}

/**
 * GUARDIAN_RULES — the POST-ENTRY EXIT behaviour, declared once (#936).
 * =====================================================================
 *
 * WHY THIS EXISTS. `bot-rules.ts` declares the 30 `trading_strategy` columns and their
 * enforcement status, and the bot page renders them. Measured 2026-09-24: that page's EXIT
 * stage shows **3 live / 4 declared** — `slPct`, `tpPct`, `maxHoldHours` — i.e. the STATIC stop,
 * target and time limit. **The thing that actually manages a stop after entry, and therefore the
 * thing that locks in profit, is not a bot column at all and appeared NOWHERE.**
 *
 * A reader could study the Exit stage of a bot and still not know that a trailing tighten will
 * move the stop, on what evidence, how far, or how often. That is the same defect class bot-rules
 * exists to close — a config surface that omits the mechanism that acts — one layer further down.
 *
 * ⚠️ THE `scope` FIELD IS THE POINT, NOT DECORATION.
 * Eleven entries are `global`: ONE `StopGuardianService` serves every position on every bot, and the
 * trailing logic itself remains shared. `per-bot` is reserved for genuinely per-bot controls.
 *
 * CHANGED 2026-09-24 (#936, R20=A). The owner ruled that post-entry exit management becomes PER-BOT
 * DATA, so `simulated-tsl` is now a real per-bot entry with columns on `trading_strategy` rather
 * than a declared absence. It is the FIRST per-bot exit control, not the whole of R20 — the shared
 * trailing rules above stay global until each is moved deliberately and separately. The paragraph
 * that used to sit here said every entry was global and that the single per-bot entry was "the gap,
 * not a feature"; that text was replaced rather than left to mislead.
 *
 * ⚠️ `enforcement` reuses `bot-rules.ts`'s vocabulary deliberately (live | display-only | none) so
 * the two registries cannot drift into meaning different things by the same word.
 */
// -- DECISION (2026-09-28, primary) --
// WHAT:      The MECHANISM is the unit of exit configuration. A mechanism is a named thing that
//            ACTS; the `trading_strategy` columns it reads (`fields`) are its SETTINGS, not
//            peers of it. `scope` decides whether it is configurable per bot.
// WHY:       `bot-rules.ts` and `GUARDIAN_RULES` were two declarations of ONE subject, rendered
//            as two lists on different axes (stage vs owner), so neither was complete. Measured:
//            5 columns claimed this service while it declared 1 mechanism naming 2. Both
//            symptoms -- sim-TSL twice, exhaustion declared nowhere -- followed from that.
// INSTEAD OF: Making ALL exit behaviour per-bot data. Rejected on cost, not on principle: ~11 new
//            columns, and one global change becoming 40 divergent ones.
// REVERSE BY: Give the 11 `global` mechanisms `fields` and move each to `per-bot` -- at which
//            point the global-fields rule in validate-rule-enforcement.cjs must be NARROWED, not deleted.
// REGISTER:  docs/SETTLED-DECISIONS.md row 44
// GUARD:     nest/scripts/validate-rule-enforcement.cjs (prebuild)
export interface GuardianRule {
  id: string;
  label: string;
  kind: 'input' | 'threshold' | 'rule' | 'limit';
  /** `global` = one implementation for all bots. `per-bot` = configurable on the bot row. */
  scope: 'global' | 'per-bot';
  enforcement: 'live' | 'display-only' | 'none';
  /** The effective value or formula, as a reader of the UI should see it. */
  value: string;
  detail: string;
  /** ⚠️ Required when enforcement is not `live` — states what is missing. */
  caveat?: string;
  /**
   * ⚠️ The `trading_strategy` COLUMN(S) this mechanism reads. ABSENT for a mechanism that reads no
   * bot column (every `global` one).
   *
   * WHY THIS EXISTS (2026-09-28). `bot-rules.ts` attributes a column to an enforcing FILE via
   * `enforcedBy` — a CLAIM — and until now nothing checked it against a mechanism that actually
   * declares the column. Measured: FIVE columns claimed `stop-guardian.service.ts`, while
   * `GUARDIAN_RULES` declared ONE mechanism touching bot columns and named only TWO of the five in
   * prose. So `exhaustionObserveEnabled` / `exhaustionDecelPct` were attributed to the guardian and
   * declared by it NOWHERE — a reader saw them under "Exit", the guardian's own list did not
   * mention them, and nothing failed the build.
   *
   * It also lets a surface render a mechanism ONCE with its columns nested — instead of the same
   * subject appearing as three loose rows in the exit list AND again as the mechanism that owns
   * them (which is exactly what the owner saw on the bot page).
   *
   * Enforced by `nest/scripts/validate-rule-enforcement.cjs`.
   */
  fields?: string[];
}

export const GUARDIAN_RULES: GuardianRule[] = [
  // ── the four inputs the consensus is computed from ───────────────────────────────────────
  { id: 'atr-trailing-stop', label: 'ATR trailing stop', kind: 'input', scope: 'global',
    enforcement: 'live', value: '3 × ATR(5m)',
    detail: 'Sets the trail distance. May WIDEN the trail in a volatile market.' },
  { id: 'supertrend', label: 'SuperTrend', kind: 'input', scope: 'global', enforcement: 'live',
    value: 'directional vote', detail: 'Bullish helps a BUY, bearish helps a SELL. Opposing evidence reduces confidence.' },
  { id: 'chandelier-exit', label: 'Chandelier exit', kind: 'input', scope: 'global', enforcement: 'live',
    value: 'directional vote', detail: 'Stop-quality evidence.' },
  { id: 'wick-filter', label: 'Wick filter', kind: 'input', scope: 'global', enforcement: 'live',
    value: 'veto', detail: 'A detected fakeout SKIPS the position entirely for that tick.' },

  // ── thresholds and rules ─────────────────────────────────────────────────────────────────
  { id: 'consensus-threshold', label: 'Consensus threshold', kind: 'threshold', scope: 'global',
    enforcement: 'live', value: '≥ 55',
    detail: 'Side-aware: aligned average minus opposing average. Below this, no stop edit is sent.',
    caveat:
      '⚠️ Calibrated for FOUR signals. All four must stay registered in directives.module.ts or the ' +
      'threshold is silently applied to fewer — enforced by validate-guardian-directive-ids.cjs.' },
  { id: 'trail-distance', label: 'Trail distance', kind: 'rule', scope: 'global', enforcement: 'live',
    value: 'max(3 × ATR(5m), declared slPct distance)',
    detail: 'How far from current price the stop is trailed to. Never loosens: a tighten only ever moves the stop toward profit.' },
  { id: 'declared-distance-floor', label: 'Declared-distance floor (#927)', kind: 'rule', scope: 'global',
    enforcement: 'live', value: 'never inside the position\u2019s own slPct',
    detail: 'A tighten may not leave the stop closer to price than the declared stop distance.',
    caveat:
      '⚠️ Added after SEVEN positions closed inside 28 minutes on stops trailed to ~0.03% against a ' +
      'declared ~1%. This floor is the only thing preventing a repeat.' },
  { id: 'protective-floor', label: 'Protective floor', kind: 'rule', scope: 'global', enforcement: 'live',
    value: 'slPct from entry', detail: 'An UNLOCKED position (SL = 0) gets a disaster stop immediately, exempt from the cadence throttle.' },

  // ── limits ───────────────────────────────────────────────────────────────────────────────
  { id: 'cadence-per-position', label: 'Per-position cadence', kind: 'limit', scope: 'global',
    enforcement: 'live', value: '1 edit / position / 60s', detail: 'Stops the bridge being hammered on one ticket.' },
  { id: 'cadence-global-cap', label: 'Global edit cap', kind: 'limit', scope: 'global',
    enforcement: 'live', value: '10 edits / minute', detail: 'Applies to every position including protective floors.' },
  { id: 'market-closed-backoff', label: 'Market-closed backoff', kind: 'limit', scope: 'global',
    enforcement: 'live', value: '15 min after a broker refusal',
    detail: 'Armed ONLY by the broker\u2019s own refusal \u2014 a closed market is never predicted.' },

  // ── the FIRST per-bot exit control (was: the gap) ────────────────────────────────────────
  { id: 'simulated-tsl', label: 'Simulated TSL (decision point)', kind: 'rule', scope: 'per-bot',
    fields: ['simTslEnabled', 'simTslActivationPct', 'simTslDistancePct'],
    enforcement: 'display-only', value: 'per-bot: simTslActivationPct / simTslDistancePct — default OFF',
    detail:
      'A second, tighter threshold NOT sent to the broker. Touching it is a DECISION MOMENT \u2014 ' +
      'may close, may hold, may tighten further \u2014 rather than an automatic exit. This is what lets ' +
      'the gap be closed faster to lock in small profits, with the broker stop left further away.',
    caveat:
      '⚠️ IMPLEMENTED 2026-09-24 (#936, R20=A) \u2014 AS AN OBSERVER ONLY. The columns exist, the ' +
      'guardian computes the threshold every tick and records each firing in `sim_tsl_event`, so a ' +
      'decision-moment close is now distinguishable from the broker stop being hit. But NOTHING is ' +
      'sent to the broker and no stop is moved, so it CANNOT lock in profit yet \u2014 `display-only` ' +
      'is the honest status, not a placeholder. Default OFF. Acting on a decision point is a MATHS ' +
      'change and needs a copied configuration plus a monitored comparison (#929 blocks that today).' },

  // ⚠️ THE MECHANISM THAT WAS MISSING (#995). Its two columns were attributed to this service by
  // `bot-rules.ts` from 2026-09-28 but declared here NOWHERE — so the guardian's own list, the one
  // the bot page renders as "Exit management", was SILENT about a mechanism it runs every tick.
  // Found by reading both registries side by side, not by trusting either one.
  { id: 'exhaustion-observer', label: 'Exhaustion observer (up-move)', kind: 'rule', scope: 'per-bot',
    fields: ['exhaustionObserveEnabled', 'exhaustionDecelPct'],
    enforcement: 'display-only', value: 'per-bot: exhaustionDecelPct',
    detail:
      'Watches an OPEN position for a move DECELERATING into a new extreme — price still at the ' +
      'window high, but advancing less over the last bars than over the bars before them. Each ' +
      'firing is recorded in `exhaustion_event`.',
    caveat:
      '⚠️ OBSERVER ONLY, default OFF — no order is placed and no stop is moved from this path. ' +
      '⚠️ It is the mirror of the direction the app lacked: both existing exhaustion directives ' +
      'are `bullish` ENTRY signals. ⚠️ It needs BARS, so unlike sim-TSL it cannot run before the ' +
      'bar load and is SILENT while the feed is short — which is a fact about the mechanism, not a ' +
      'fault in it.' },
];

/** Counts by scope — for a UI badge, mirroring `ruleEnforcementCounts()`. */
export function guardianRuleCounts() {
  return GUARDIAN_RULES.reduce<Record<string, number>>((acc, r) => {
    acc[r.scope] = (acc[r.scope] ?? 0) + 1;
    return acc;
  }, {});
}

@Injectable()
export class StopGuardianService {
  private readonly logger = new Logger(StopGuardianService.name);
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  // ── #1030 — THERE IS NO `bridgeUrl` FIELD HERE ANY MORE, AND THAT IS THE FIX ──────────────
  //
  // It used to be `this.bridgeUrl = this.mt5Connection.getUrl()` — one URL, resolved once in the
  // constructor, used for `/positions`, `/candles` and `/order/modify`. `getUrl()` with no
  // argument returns the PRIMARY broker, so with `MT5_ACTIVE_BROKERS=2,3` (MetaQuotes :5000 and
  // Pepperstone :5001) every position on broker 3 was invisible to the guardian AND would have
  // been edited on the wrong account if it had been visible.
  //
  // ⚠️ The fix is NOT a second URL. `Mt5ConnectionManager` ALREADY had the broker-aware API —
  // `getAllPositions()` (every bridge, each row stamped with `brokerId`), `getCandles(…, brokerId)`
  // and `modifyOrder(…, brokerId)`. This service hand-rolled a single-URL `fetch` INSTEAD of using
  // the shared core, so it inherited none of its routing. One URL field cannot be "made correct"
  // here; addressing must follow the POSITION, and only the position knows which account holds it.
  //
  // ⚠️ MEASURED 2026-09-30 BEFORE the fix, live: `:5000` held 7 positions, `:5001` held 2
  // (US500, GER40), and the guardian reported `7 guarded` on every tick. GER40 also returned
  // **0 candles from `:5000`** and 2 from `:5001`, so it was invisible twice over — no position
  // AND no bars — and would have been skipped even had it been seen.
  //
  // ⚠️ REVERSE BY: re-add the field and pass no broker to the manager calls. Do NOT do that —
  // `stop-guardian.spec.ts` asserts a broker-3 position is guarded and that the modify is
  // addressed to broker 3, and `validate-single-bridge-position-io.cjs` fails the build on the
  // reintroduced shape.

  state: GuardianState = {
    enabled: false,
    tickIntervalMs: 30_000,
    tickCount: 0,
    lastTickAt: null,
    nextTickAt: null,
    lastTickMs: 0,
    guardedPositions: [],
    recentAdjustments: [],
    lastBridgeRefusal: null,
  };

  // ── Broker-modification throttle (#721 decision 6) ──
  // Brokers throttle SL/TP modifications — hammering `/order/modify` every
  // tick can trip rate limits or get positions re-quoted. Two knobs:
  //   per-position cadence (min gap between edits on ONE position)
  //   global cadence (max edits per minute across ALL positions)
  private readonly MIN_MODIFY_INTERVAL_MS = 60_000; // 1 edit per position per minute
  private readonly MAX_MODIFY_PER_MINUTE = 10;      // global cap per minute
  private lastModifyAt = new Map<number, number>(); // ticket → last modify timestamp
  private modifyTimes: number[] = [];               // timestamps of edits in the last 60s

  /**
   * ⚠️ #890 — throttles the "declared directive did not resolve" error.
   *
   * The shortfall is a property of the REGISTRY, not of any one position, so
   * unthrottled it would repeat for every position on every tick (5x30s) and
   * bury the log it lives in. Throttled to once per 30 minutes so it stays
   * visible without becoming noise.
   */
  private lastDirectiveShortfallAt = 0;
  private readonly DIRECTIVE_SHORTFALL_LOG_MS = 30 * 60_000;

  /**
   * ⚠️ #892 — throttles the "a modify was blocked" warning.
   *
   * The per-position cadence (60s between edits on ONE position, against a 30s
   * tick) blocks legitimately and repeatedly, so an unthrottled warning would be
   * mostly noise. The failure this exists to expose is the opposite one: a modify
   * that can NEVER go out. One line per 5 minutes keeps that visible without
   * training the reader to ignore the line.
   */
  private lastThrottleLogAt = 0;
  private readonly THROTTLE_LOG_MS = 5 * 60_000;

  /**
   * #927 — throttles the trail-refusal warning. It is a property of the COMPUTATION (global
   * throttle), not of a position: with `trailDistanceFor` max()ing it should never fire, and if
   * it does, that is "a guard caught something that should be impossible".
   */
  private lastTrailRefusalAt = 0;

  /**
   * ⚠️ #892 — deduplicates identical bridge refusals.
   *
   * The guardian retries every 30s. A closed market refuses every edit with an
   * identical body, so an unthrottled ERROR is 3 lines per tick (~8,600/day) and it
   * buries the one refusal that would matter. Keyed on CONTENT rather than time, so a
   * DIFFERENT refusal still prints immediately.
   */
  private lastRefusalKey = '';
  private lastRefusalLogAt = 0;
  private readonly REFUSAL_LOG_MS = 5 * 60_000;

  /**
   * ⚠️ #893 — per-SYMBOL retry-not-before after the broker answers "Market closed".
   *
   * Between probes the guardian does not call the bridge at all (see
   * `modifyBlockedReason`), so a shut market costs one probe round per symbol per
   * window instead of one round per tick. The value is the ONLY lever: a short
   * window reacts faster to a re-open (the FX weekend is ~47h, and the first
   * successful tighten can only happen after it), a long one wastes less traffic.
   * 15 minutes bounds the post-reopen delay while cutting weekend calls by ~97%
   * (3 symbols x 4 probes/h vs 3 per 30s tick).
   */
  private marketClosedUntil = new Map<string, number>();
  private readonly MARKET_CLOSED_BACKOFF_MS = 15 * 60_000;

  /**
   * #893 — the refusal body from the LAST `modifyStop` call, cleared before every
   * post so `applyModify` can attribute a failure to THIS call. Distinct from
   * `state.lastBridgeRefusal`, which is a historical record for `/status` and is
   * overwritten by any refusal from any path.
   */
  private lastRefusalDetail: string | null = null;

  // ── Simulated TSL (#936, R20=A 2026-09-24) — see `observeSimulatedTsl()` ──────────────────
  //
  // ── DECISION (2026-09-24, primary — owner chose A) ──
  // WHAT:      Post-entry exit management is PER-BOT DATA, not one global mechanism.
  // WHY:       ELEVEN of this file's twelve rules were `global` — ONE guardian served every bot,
  //            which is why the mechanism that actually locks in profit appeared NOWHERE on the
  //            bot page. `trading_strategy.slPct` already spans **0.3%-3%** across live bots (a
  //            10x range), so one shared trail distance cannot be right at both ends of it. The
  //            guardian also ALREADY read a per-bot value (`strat?.slPct ?? 1`), so this finishes
  //            a partial thing rather than starting a new direction.
  // INSTEAD OF: keeping one hardcoded global mechanism (R20 option B), which the owner rejected.
  //            Its cost is real and is NOT hidden: ~50 bots x knobs can drift, and
  //            `seedDefaults()` convergence already flipped 5 bots auto->semi-auto once (#833).
  //            Per-bot data is therefore bounded by declared defaults, never by hand-tuning.
  // REVERSE BY: set the `simTsl*` columns back to their defaults (enabled=false, NULL) and
  //            reintroduce a global rule in GUARDIAN_RULES. Nothing else depends on the split.
  // REGISTER:  docs/SETTLED-DECISIONS.md — "Post-entry exit management is PER-BOT DATA (R20 = A)"
  // GUARD:     nest/scripts/validate-trailing-claims.cjs + validate-bot-rules.cjs
  // ⚠️ R20 IS ONLY PARTLY DELIVERED. This is the FIRST per-bot exit control, not the whole
  // ruling: the eleven shared trailing rules above stay global until each is moved deliberately.
  //
  // ⚠️ IN-MEMORY ON PURPOSE, AND THAT IS A DECLARED LIMITATION. `Mt5RawPosition` carries no
  // high/low watermark, so "the best price reached" is tracked from the first tick after the
  // threshold armed. A process restart resets it and the next tick may compute a slightly worse
  // `triggerPrice` than reality. A durable watermark needs a column — a later increment.
  private readonly simTslWatermark = new Map<number, number>();
  /**
   * ⚠️ REQUIRED, NOT AN OPTIMISATION. `tick()` runs every few seconds; without this cooldown a
   * position sitting on its threshold would write an event EVERY TICK and the table would be
   * unreadable — the same "plausible rows, no signal" defect this repo keeps re-finding.
   */
  private readonly simTslLastMomentAt = new Map<number, number>();
  private readonly SIM_TSL_MOMENT_COOLDOWN_MS = 60_000;

  // ── UP-move exhaustion observer (#995) — see `observeExhaustion()` ─────────────────────
  //
  // ⚠️ WHY THE COOLDOWN IS REQUIRED, NOT AN OPTIMISATION (same reason as sim-TSL's): `tick()`
  // runs every few seconds while the underlying bars change every 5 MINUTES. Without it, one
  // decelerating bar would write an event on every tick for five minutes and the table would be
  // unreadable — the "plausible rows, no signal" defect this repo keeps re-finding.
  private readonly exhaustionLastAt = new Map<number, number>();
  private readonly EXHAUSTION_COOLDOWN_MS = 300_000;
  /**
   * Bars per comparison half. The signal compares the last `k` bars' progress with the `k` before
   * them, so it needs `2k+1` bars and consumes them from the 30 the guardian already loads.
   * ⚠️ SMALL ON PURPOSE: the guardian evaluates 5m bars, so k=3 is 15 minutes either side — a
   * horizon that fits inside the position lifetimes this guardian manages.
   */
  private readonly EXHAUSTION_WINDOW_BARS = 3;

  constructor(
    private readonly strategyService: TradingStrategyService,
    private readonly directivesService: DirectivesService,
    private readonly mt5Connection: Mt5ConnectionManager,
    private readonly adjustmentRecorder: StopAdjustmentRecorder,
    private readonly notifications?: NotificationService,
    /**
     * Optional so the spec can construct the service without a log file, and so a missing logger
     * can never stop the guardian from ticking. Used ONLY to make an unestablished owner visible in
     * the CANONICAL log — see the warning in `tick()`.
     */
    private readonly syslog?: SystemLogService,
  ) {
    // #1030 — nothing is resolved here any more. Addressing is per-POSITION (see the field
    // comment above): a URL captured in the constructor cannot know which account holds a
    // position that has not been read yet.
  }

  // ── Loop Control ──────────────────────────────────────

  start() {
    if (this.state.enabled) {
      return { started: false, message: 'Stop Guardian is already running' };
    }
    this.state.enabled = true;
    this.scheduleNext();
    this.logger.log('Stop Guardian started');
    return { started: true, message: 'Stop Guardian started' };
  }

  stop() {
    this.state.enabled = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.logger.log('Stop Guardian stopped');
    return { stopped: true, message: 'Stop Guardian stopped' };
  }

  private scheduleNext() {
    if (!this.state.enabled) return;
    this.timer = setTimeout(() => {
      this.tick().catch((err) =>
        this.logger.error(`Guardian tick failed: ${(err as Error).message}`),
      );
    }, this.state.tickIntervalMs);
  }

  // ── Bridge Helpers ────────────────────────────────────
  //
  // #1030 — the two raw-`fetch` helpers that used to live here (`bridgeGet` / `bridgePost`) are
  // GONE, not reparameterised. Both addressed ONE URL captured in the constructor; every read and
  // write the guardian makes is now addressed by the manager that owns the broker registry. The
  // only thing those helpers did that the manager did not was the refusal bookkeeping below
  // (#892/#893), which is preserved verbatim in `modifyStop()`.

  /**
   * modifyStop() — edit ONE position's stop on the bridge that HOLDS it (#1030).
   *
   * BEFORE: `bridgePost('/order/modify', {ticket, sl})` against `this.bridgeUrl`. With
   * `MT5_ACTIVE_BROKERS=2,3` that URL was always the primary broker (`:5000`), so a position on
   * broker 3 was not merely unmanaged — an edit for it would have been aimed at the wrong ACCOUNT.
   *
   * ⚠️ THE #892/#893 BOOKKEEPING IS THE POINT OF THIS METHOD, not the call itself. A refused stop
   * edit and a successful one were once indistinguishable: the caller saw a bare boolean, and
   * `0 adjusted` read as "nothing needed adjusting" rather than "the broker said no" — measured
   * 2026-09-18, three positions cleared the confidence gate and every edit came back
   * `HTTP 400 {"error": "Market closed"}` with nothing anywhere saying so. So the refusal is
   * recorded on the state (`GET /status` says WHY), remembered for ONE decision
   * (`lastRefusalDetail` — does this refusal mean "market closed"?), and logged throttled by
   * content.
   *
   * ⚠️ A TRANSPORT FAILURE IS STILL SEPARATE FROM A BROKER REFUSAL (#892), and `status === 0` is
   * what distinguishes them — "nothing was consulted". They need OPPOSITE handling: a closed market
   * is backed off (#893), a dead bridge must NOT be, or the stop stays unmoved for 15 minutes after
   * the bridge comes back. Collapsing the two would silently reintroduce #893 backwards.
   */
  private async modifyStop(pos: Mt5RawPosition, newSl: number): Promise<boolean> {
    const path = '/order/modify';
    let result: any;
    try {
      result = await this.mt5Connection.modifyOrder(
        pos.ticket,
        newSl,
        undefined,
        pos.brokerId,
      );
    } catch (err) {
      this.lastRefusalDetail = null;
      this.logger.error(
        `Stop modify THREW for ${pos.symbol} #${pos.ticket} (broker ${pos.brokerId ?? '?'}): ` +
          `${(err as Error).message}`,
      );
      return false;
    }

    if (result?.ok) return true;

    // `status === 0` ⟺ the bridge was never reached (down, timed out, or an unregistered broker
    // id). There is no broker error to quote, so this is a transport failure rather than a refusal.
    const status = Number(result?.status ?? 0);
    if (!status) {
      this.lastRefusalDetail = null;
      this.logger.error(
        `Stop modify NOT SENT for ${pos.symbol} #${pos.ticket} (broker ${pos.brokerId ?? '?'}): ` +
          `${result?.error ?? 'bridge unreachable'} — no broker response, so this is a transport ` +
          'failure, NOT a market-closed signal (no backoff armed).',
      );
      return false;
    }

    const detail =
      String(result?.error ?? result?.message ?? '').slice(0, 300) || `HTTP ${status}`;
    // Recorded on the state so `GET /status` says WHY, not just that nothing moved.
    this.state.lastBridgeRefusal = {
      at: new Date().toISOString(),
      path,
      detail,
    };
    // #893 — remembered for ONE decision (see `lastRefusalDetail`): does this mean "market closed"?
    this.lastRefusalDetail = detail;
    // Throttled by content — see REFUSAL_LOG_MS. A repeated identical refusal is still recorded
    // above; only its log line is suppressed.
    const key = `${path} ${status} ${detail}`;
    const now = Date.now();
    const isRepeat =
      this.lastRefusalKey === key && now - this.lastRefusalLogAt < this.REFUSAL_LOG_MS;
    if (!isRepeat) {
      this.lastRefusalKey = key;
      this.lastRefusalLogAt = now;
      this.logger.error(
        `Stop modify refused by broker ${pos.brokerId ?? '?'}: ${pos.symbol} #${pos.ticket} — ` +
          `HTTP ${status} ${detail}`,
      );
    }
    return false;
  }

  // ── Main Tick ──────────────────────────────────────────

  async tick() {
    if (!this.state.enabled || this.ticking) return [];
    this.ticking = true;
    const tickStart = Date.now();
    this.state.tickCount++;
    this.state.lastTickAt = new Date().toISOString();

    const adjustments: StopAdjustment[] = [];

    // #888 — instrumentation, and the reason it is kept: these counters are how the change
    // is VERIFIED rather than asserted. `resultsMap.size` is the number of directives
    // actually evaluated for this position and is exactly what the
    // STOP_GUARDIAN_DIRECTIVES filter below controls.
    //   BEFORE the filter: 505 evaluated per pass (101 registered x 5 positions), 780ms,
    //                      to read four results.
    //   AFTER:             20 (4 x 5).
    // The gap was invisible because the result map is only ever indexed by the four keys
    // the guardian reads - the other ~97 results were computed and thrown away.
    let directivesEvaluated = 0;
    let directiveMs = 0;

    try {
      // 1. Fetch active auto-mode strategies
      const strategies = await this.strategyService.findAll();
      const autoStrats = strategies.filter(
        (s: any) => s.active && s.mode === 'auto',
      );

      if (autoStrats.length === 0) {
        this.finishTick(tickStart);
        return [];
      }

      // 2. Fetch raw MT5 positions from EVERY active bridge (#1030)
      //
      // ⚠️ WAS `this.bridgeGet('/positions')` — one hardcoded bridge (the primary, `:5000`). With
      // `MT5_ACTIVE_BROKERS=2,3` that made every broker-3 position invisible here. The manager
      // stamps each returned row with the `brokerId` it came from, and THAT stamp — not
      // `symbol_route` — is what every later write is addressed by.
      const positions = (await this.mt5Connection.getAllPositions()) as Mt5RawPosition[];

      // #1030 — the per-bridge read, so "does the guardian see both accounts?" is a NUMBER from
      // `GET /status` rather than an inference from a log. Derived from the stamps above, so it
      // costs no extra round trip. See `brokerCoverage` for the declared limitation: `0` cannot
      // distinguish "this account is empty" from "this bridge did not answer".
      const positionsByBroker: Record<number, number> = {};
      for (const p of positions) {
        const b = Number(p.brokerId ?? 0);
        positionsByBroker[b] = (positionsByBroker[b] ?? 0) + 1;
      }
      this.state.brokerCoverage = {
        brokersQueried: this.mt5Connection.getBrokerIds(),
        positionsByBroker,
      };

      if (positions.length === 0) {
        this.state.guardedPositions = [];
        this.finishTick(tickStart);
        return [];
      }

      // 3. Evaluate each auto-strategy position
      const guarded: GuardedPosition[] = [];

      // ── #1018 — resolve OWNERSHIP ONCE per position, then match on it ──────────────────────
      //
      // ⚠️ This replaces `p.symbol === strat.symbol`. A symbol is not an owner: XAUUSD has EIGHT
      // active bots, so that predicate returned the SAME position for every one of them and the
      // #927 floor was computed from whichever bot's `slPct` happened to be iterated.
      //
      // ⚠️ `ALL` strategy names, not just the auto ones. A truncated comment must be allowed to be
      // AMBIGUOUS — resolving it against a filtered list would make a name look unique when it is
      // not, which is the silent-wrong-answer failure this whole change exists to remove.
      const strategyNames = strategies.map((s: any) => String(s?.name ?? '')).filter(Boolean);
      // ── #1018 — MAGIC FIRST, COMMENT AS FALLBACK ──────────────────────────────────────────
      // The magic is the key that cannot lie: MT5 stamps it on the order, it travels with the
      // POSITION for life, it is never truncated (the comment is), and it cannot be retyped in the
      // terminal. So it is tried first and needs no ambiguity handling — a match is exact by
      // construction, because `trading_strategy.magic` is UNIQUE.
      //
      // ⚠️ THE COMMENT RESOLVER IS NOT DEAD CODE. Every position opened BEFORE this change carries
      // `DEFAULT_MAGIC` (234000 = "no bot attributed"), and magic is immutable, so those positions
      // can never be attributed by magic and MUST keep resolving from the comment. Both paths are
      // live, for as long as any pre-change position exists.
      const nameByMagic = new Map<number, string>();
      for (const s of strategies as any[]) {
        if (s?.magic != null) nameByMagic.set(Number(s.magic), String(s.name ?? ''));
      }
      const ownerByTicket = new Map<number, { name: string; via: GuardedPosition['ownerVia'] }>();
      // #1041 — ticket → the OTHER claimants, when more than one bot built the position.
      const contestedByTicket = new Map<number, string[]>();
      const unresolved: string[] = [];
      let viaMagic = 0;
      let viaComment = 0;
      for (const p of positions) {
        if (!(p.comment || '').includes('TCS')) continue; // not ours
        const m = p.magic;
        if (m != null && Number(m) !== BRIDGE_DEFAULT_MAGIC) {
          const byMagic = nameByMagic.get(Number(m));
          if (byMagic) {
            ownerByTicket.set(p.ticket, { name: byMagic, via: 'magic' });
            viaMagic++;
            continue;
          }
          // A magic that matches no bot is a CONTRADICTION, not a fallback: it says this position
          // belongs to a bot the registry does not have. Falling through to the comment would
          // silently paper over a missing or reassigned bot, so it is reported instead.
          unresolved.push(`${p.symbol} #${p.ticket} on broker ${p.brokerId ?? '?'} magic=${m} matches NO bot (comment "${String(p.comment).slice(0, 30)}")`);
          continue;
        }
        const contested: string[] = [];
        const owner = resolvePositionOwner(p.comment, strategyNames, contested);
        if (owner) {
          // The comment path's OWN sub-method is preserved: `unique-prefix` means a truncated name
          // was matched, which is the variant most likely to be wrong.
          ownerByTicket.set(p.ticket, {
            name: owner.name,
            via: `comment:${owner.via}` as GuardedPosition['ownerVia'],
          });
          viaComment++;
        } else if (contested.length > 1) {
          // ── ⚠️ #1041 — CONTESTED: MANAGED, by the STRICTEST CLAIMANT ───────────────────────
          //
          // This branch used to fall into `unresolved` with the same message as "nobody claims it",
          // and the position was then managed by NOTHING. Measured cost of that collapse: a
          // position built from three bots' orders sat unmanaged for **2 h 20 m**, and ticket
          // `152703882760` lost **−322.67**.
          //
          // `docs/change-guide-position-lifecycle.md` row 8: *"Several owners is a STATE, not an
          // error. Name the claimants and act; do not resolve it by refusing."*
          //
          // ⚠️ The chosen bot's OWN rules then apply through the ordinary path below — including
          // its `slPct` as the #927 declared-distance floor — because `ownerByTicket` is the only
          // thing the strategy loop reads. This branch therefore changes WHO governs, and nothing
          // else; it does not invent a stop of its own.
          const strictest = pickStrictestClaimant(contested, strategies as any[]);
          ownerByTicket.set(p.ticket, { name: strictest, via: 'comment:contested' });
          contestedByTicket.set(p.ticket, contested);
          viaComment++;
        } else {
          unresolved.push(`${p.symbol} #${p.ticket} on broker ${p.brokerId ?? '?'} "${String(p.comment).slice(0, 40)}"`);
        }
      }
      // ⚠️ MADE VISIBLE, not silent. An unestablished owner means the position is NOT being
      // managed — which is safe (it keeps the broker-side stop the order path placed) but must be
      // knowable, or "the guardian is quietly skipping this position" is invisible.
      if (unresolved.length) {
        const message =
          `Owner could not be established for ${unresolved.length} TCS position(s) — not managed ` +
          `this tick (the broker-side stop stands): ${unresolved.join('; ')}`;
        this.logger.warn(message);
        // ⚠️ ALSO THE CANONICAL LOG, and that is not duplication (#1018 follow-up, 2026-09-29).
        //
        // `logger.warn` writes to STDOUT, which the launcher captures in `nest/logs/console-*.log`
        // — NOT the structured file the app serves at `/api/system/logs/file`. MEASURED: this exact
        // warning appeared **341 times** in `console-build-api.log` and **ZERO times** in
        // `tcs-2026-09-29.log`. So the guardian was reporting correctly and the report was
        // invisible to anyone reading the log the way the app tells you to.
        //
        // The structured log also COLLAPSES repeats (`logging.collapseRepeats`, 5-min window),
        // which is exactly what a 30s-per-tick storm needs.
        this.syslog?.warn('StopGuardianService', message, 'trading');
      }

      for (const strat of autoStrats) {
        const pos = positions.find(
          (p: Mt5RawPosition) => ownerByTicket.get(p.ticket)?.name === strat.name,
        );
        if (!pos) continue;

        // #1018 — carried through to `GuardedPosition.ownerVia` rather than discarded, so the
        // resolution path is observable. `!` is safe: `pos` was found BY this map.
        const ownerVia = ownerByTicket.get(pos.ticket)!.via;

        const side: 'BUY' | 'SELL' = pos.type === 'buy' ? 'BUY' : 'SELL';

        // #936 — observe the per-bot simulated TSL BEFORE the bar/directive work, so it runs even
        // when bars are short and the rest of the tick skips this position. It records only.
        this.observeSimulatedTsl(pos, strat);

        // 4. Load bars — from the bridge that holds the POSITION (#1030)
        const bars = await this.loadBars(strat.symbol, pos.brokerId);
        // #995 — the UP-move exhaustion observer. ⚠️ PLACED AFTER THE BAR LOAD, AND THAT IS A
        // DECLARED LIMITATION, not an oversight. `observeSimulatedTsl()` is called BEFORE the load
        // precisely so it still runs when the feed is degraded; this one CANNOT, because
        // deceleration is a property of bars, not of a tick. So while the bar feed is short this
        // observer is SILENT — the one condition under which it would be most useful to know it
        // had stopped seeing anything. It records nothing rather than guessing from ticks.
        this.observeExhaustion(pos, strat, bars);
        if (bars.length < 14) {
          guarded.push(
            this.makeGuarded(pos, strat, side, null, 0, true, ownerVia, 'no-bars'),
          );
          continue;
        }

        // 5. Run stop-focused directives - scoped to exactly the four IDs below (#888).
        const dStart = Date.now();
        const resultsMap = await this.directivesService.runAll(
          {
            symbol: strat.symbol,
            bars,
          },
          STOP_GUARDIAN_DIRECTIVES,
        );
        directiveMs += Date.now() - dStart;
        directivesEvaluated += resultsMap.size;

        // ⚠️ #890 — SYMPTOM guard for a declared-but-unresolvable directive.
        //
        // `Map.get()` returns `undefined` for a key that was never `set`; it does not
        // throw. So a directive this guardian reads but the registry never REGISTERED
        // contributes nothing to `stopConfidence` below, and the guard reads that
        // absence as "no evidence" rather than as an error — the "plausible numbers,
        // no error" class this repo keeps re-finding.
        //
        // Measured 2026-09-18: 3 of these 4 IDs were unregistered, so a `>= 55`
        // threshold calibrated for FOUR signals was applied to ONE, and the guardian
        // sat at `0 adjusted, 5 guarded` on every pass while every registry count
        // looked healthy (101 registered = 101 register() calls).
        //
        // ⚠️ Being listed in `providers` is NOT registration — the class is
        // constructed but unreachable by `runAll(filter)`. That is how this happened.
        //
        // This names the shortfall without needing to know its cause. Its build-time
        // sibling — validate-guardian-directive-ids.cjs
        // (INV-GUARDIAN-DIRECTIVE-RESOLVABLE) — stops the next occurrence from ever
        // reaching a running process.
        const unresolved = [...STOP_GUARDIAN_DIRECTIVES].filter((id) => !resultsMap.has(id));
        if (unresolved.length > 0) {
          const now = Date.now();
          if (now - this.lastDirectiveShortfallAt >= this.DIRECTIVE_SHORTFALL_LOG_MS) {
            this.lastDirectiveShortfallAt = now;
            this.logger.error(
              `GUARDIAN DIRECTIVES UNRESOLVED — ${unresolved.join(', ')} not in the registry. ` +
                `stopConfidence is derived from ${resultsMap.size} of ` +
                `${STOP_GUARDIAN_DIRECTIVES.size} declared inputs, so the >= 55 consensus ` +
                `threshold is being applied to fewer signals than it was calibrated for. ` +
                `See INV-GUARDIAN-DIRECTIVE-RESOLVABLE.`,
            );
          }
        }

        const atrStop = resultsMap.get('atr-trailing-stop');
        const superTrend = resultsMap.get('supertrend');
        const chandelier = resultsMap.get('chandelier-exit');
        const wickFilter = resultsMap.get('wick-filter');

        // 6. Wick filter check
        const wickPassed = !(wickFilter as any)?.metadata?.isFakeout;
        const wickScore = wickFilter?.score ?? null;

        if (!wickPassed) {
          guarded.push(
            this.makeGuarded(pos, strat, side, pos.sl, 15, false, ownerVia, 'wick-fakeout'),
          );
          continue;
        }

        // 7. Side-aware confidence — only DIRECTIONAL evidence counts, and it
        //    must be aligned with the position's side (bullish helps a BUY,
        //    bearish helps a SELL). Opposing evidence reduces confidence.
        //    Missing/neutral directives are "no evidence", never a neutral 50.
        const directives = [atrStop, superTrend, chandelier, wickFilter];
        let alignedSum = 0;
        let alignedCount = 0;
        let opposingSum = 0;
        let opposingCount = 0;
        for (const d of directives) {
          if (!d || d.signalClass === 'neutral') continue;
          const isBullish = d.signalClass === 'bullish';
          const aligned = side === 'BUY' ? isBullish : !isBullish;
          if (aligned) {
            alignedSum += d.score;
            alignedCount += 1;
          } else {
            opposingSum += d.score;
            opposingCount += 1;
          }
        }
        const alignedAvg = alignedCount > 0 ? alignedSum / alignedCount : 0;
        const opposingAvg = opposingCount > 0 ? opposingSum / opposingCount : 0;
        const stopConfidence = Math.max(0, Math.round(alignedAvg - opposingAvg));

        // 8. ATR-based recommended SL — with the #927 DISTANCE FLOOR
        //
        // ⚠️ The trail distance is `max(3 × ATR(5m), the declared stop distance)` — see the
        // #927 docblock on `declaredStopDistance` for the seven closes that made this necessary.
        // 3 × ATR may WIDEN the trail; it may never tighten it inside the declared risk.
        const atrValue = this.computeAtr(bars);
        const currentPrice = pos.priceCurrent;
        const entryPrice = Number(pos.priceOpen) || 0;
        const slPct = Number(strat?.slPct ?? 1) || 1;
        const declaredDistance = declaredStopDistance(entryPrice, slPct);
        const trailDistance = trailDistanceFor(atrValue, declaredDistance);
        // Validation before use: refuse to place a stop closer than the declared distance.
        const distanceProblem = trailDistanceProblem(trailDistance, declaredDistance);
        if (distanceProblem) {
          this.logTrailRefusal(pos, distanceProblem);
        }
        let recommendedSl: number | null = null;

        if (atrValue > 0 && !distanceProblem) {
          if (side === 'BUY') {
            recommendedSl = currentPrice - trailDistance;
            if (pos.sl != null && pos.sl > 0 && recommendedSl < pos.sl)
              recommendedSl = pos.sl;
          } else {
            recommendedSl = currentPrice + trailDistance;
            if (pos.sl != null && pos.sl > 0 && recommendedSl > pos.sl)
              recommendedSl = pos.sl;
          }
        }

        // 9. Execute modification — two-layer stops (#721 decision 6), with the #927 distance floor:
        //    (a) protective floor: an UNLOCKED position (SL=0) is an emergency
        //        — set a relaxed broker-side disaster stop immediately, exempt
        //        from the cadence throttle. Distance = the strategy's own slPct from entry.
        //    (b) normal trailing: tighten toward the ATR stop — but NEVER closer to price than the
        //        declared distance, so a tighten can only ever improve WHERE the stop sits, never
        //        reduce the risk distance the strategy declared.
        // ── #1056 — WHICH BRANCH RAN, recorded rather than inferred ────────────────────────────
        //
        // Every path below assigns `outcome` on the branch it ACTUALLY took, so a reader can tell
        // "the guardian declined for this reason" from "nothing happened". Inferring it from
        // `stopConfidence`/`recommendedSl` cannot work: a genuine evaluation that found nothing
        // produces the same pair as one that skipped early.
        let outcome: GuardedPositionOutcome;
        if (pos.sl == null || pos.sl <= 0) {
          const protective = this.protectiveSl(pos, side, strat);
          if (protective != null) {
            await this.applyModify(
              pos,
              protective,
              `Protective floor (was unlocked) | ${strat.slPct ?? 1}% from entry`,
              stopConfidence,
              side,
              adjustments,
              true,
            );
            outcome = 'protected';
          } else {
            // Unlocked AND no computable protective level — the one case where the position is
            // genuinely exposed and the guardian could not act. Never silent again.
            outcome = 'no-protective-level';
          }
        } else {
          const shouldAdjust =
            stopConfidence >= 55 &&
            recommendedSl !== null &&
            Math.abs(recommendedSl - (pos.sl || 0)) > 0.00001;

          if (shouldAdjust) {
            await this.applyModify(
              pos,
              recommendedSl!,
              // #927 — the distance is recorded as a PERCENTAGE so `stop_adjustment` can be read (and
              // audited) without recomputing ATR from the price columns.
              //
              // ⚠️ #1034: built by a PURE exported function, because the defect was arithmetic that a
              // call site could not be tested on. See `stopAdjustmentReason()` above for the two
              // things it fixes — the ENTRY denominator, and carrying `slPct=` so the row is
              // self-describing and a later config change cannot retro-label it a breach.
              stopAdjustmentReason({
                stopConfidence,
                atrValue,
                trailDistance,
                entryPrice,
                slPct,
                wickScore,
              }),
              stopConfidence,
              side,
              adjustments,
              false,
              {
                atrTrailingStop: atrStop?.score ?? null,
                superTrend: superTrend?.score ?? null,
                chandelierExit: chandelier?.score ?? null,
                wickFilter: wickScore,
              },
            );
            outcome = 'adjusted';
          } else if (distanceProblem) {
            // #927 — refused rather than tightening inside the declared risk.
            outcome = 'distance-refused';
          } else if (stopConfidence < 55) {
            outcome = 'below-threshold';
          } else if (recommendedSl === null) {
            outcome = 'no-recommendation';
          } else {
            outcome = 'at-target';
          }
        }

        guarded.push(
          this.makeGuarded(
            pos,
            strat,
            side,
            recommendedSl,
            stopConfidence,
            true,
            ownerVia,
            outcome,
          ),
        );
      }

      // #1041 — attach the OTHER claimants to any position governed by a contested owner, so the
      // payload says WHICH RULE ACTED and who else had a stake. Done here rather than in
      // `makeGuarded()` because that is called from three branches and only one carries a ticket.
      for (const g of guarded) {
        const c = contestedByTicket.get(g.ticket);
        if (c) g.claimants = c;
      }

      this.state.guardedPositions = guarded;
      // #1018 — the attribution OUTCOME, served beside the positions it produced.
      this.state.ownerAttribution = { viaMagic, viaComment, unresolved };
    } catch (err) {
      this.logger.error(`Guardian tick error: ${(err as Error).message}`);
    }

    this.finishTick(tickStart);
    this.logger.log(
      `Guardian #${this.state.tickCount}: ${adjustments.length} adjusted, ${this.state.guardedPositions.length} guarded ` +
        `(${directivesEvaluated} directives evaluated in ${directiveMs}ms, pass ${Date.now() - tickStart}ms)`,
    );
    return adjustments;
  }

  async runNow() {
    const adjustments = await this.tick();
    return { run: true, adjustments };
  }

  getState(): GuardianState {
    return {
      ...this.state,
      // #893 — the live backoff view: which symbols are paused and until when.
      // Computed rather than stored so a stale entry can never read as an active
      // pause (an expired one is dropped here), and so the field needs no init.
      marketClosedBackoff: [...this.marketClosedUntil.entries()]
        .filter(([, until]) => until > Date.now())
        .map(([symbol, until]) => ({ symbol, retryAt: new Date(until).toISOString() })),
      // #936 — the DECLARATION half of this behaviour, served alongside the live half.
      // A consumer must not render `recentAdjustments` / `guardedPositions` without it: a list of
      // stop edits with no statement of the rule that produced them is exactly the "value shown
      // without its enforcement" defect the bot truth view (#864) refuses to render for.
      rules: GUARDIAN_RULES,
      ruleCounts: guardianRuleCounts(),
    };
  }

  // ── Private Helpers ────────────────────────────────────

  /**
   * observeSimulatedTsl() — the per-bot DECISION MOMENT (#936, R20=A 2026-09-24).
   * ==============================================================================
   * WHAT IT DOES. For a bot with `simTslEnabled`, once the position is in profit by at least
   * `simTslActivationPct`, it tracks a threshold `simTslDistancePct` BELOW the best price reached
   * (above it for a SELL). When price touches that threshold it records a `decision-point` event.
   *
   * ⚠️ IT PLACES NOTHING AND MOVES NOTHING. The broker stop is untouched and no order is sent —
   * `sim_tsl_event.action` is hardcoded `recorded`. That is the deliberate boundary: acting on a
   * decision point (closing, or tightening the real stop) is a MATHS change and needs a copied
   * configuration and a monitored comparison, which #929 currently blocks. This method exists so
   * the moment becomes MEASURABLE first — which is exactly what #936's caveat asks for: "its
   * firings must be recorded so a decision-moment close is distinguishable from the broker stop
   * being hit."
   *
   * ⚠️ WHY IT IS CALLED BEFORE THE BAR LOAD. The rest of the loop `continue`s when fewer than 14
   * bars are available. An observation that only ran on a healthy bar feed would be silent exactly
   * when the guardian is degraded — the failure mode this repo treats as the dangerous one.
   *
   * See the field declarations for the in-memory watermark limitation and the dedupe cooldown.
   */
  private observeSimulatedTsl(pos: Mt5RawPosition, strat: any): void {
    try {
      if (!strat?.simTslEnabled) return;
      const activationPct = Number(strat.simTslActivationPct);
      const distancePct = Number(strat.simTslDistancePct);
      // NULL / 0 means NOT CONFIGURED, never "trail at zero distance". Bailing correctly leaves
      // the position unobserved rather than inventing a threshold.
      if (!Number.isFinite(activationPct) || activationPct <= 0) return;
      if (!Number.isFinite(distancePct) || distancePct <= 0) return;
      if (!Number.isFinite(pos.priceOpen) || pos.priceOpen <= 0) return;
      if (!Number.isFinite(pos.priceCurrent)) return;

      const isBuy = pos.type === 'buy';
      // Favourable-direction profit, independent of the broker's own `profit` (which is currency and
      // already net of swap/commission, so it cannot be compared with a percentage threshold).
      const profitPct =
        ((isBuy ? pos.priceCurrent - pos.priceOpen : pos.priceOpen - pos.priceCurrent) /
          pos.priceOpen) * 100;

      const prevBest = this.simTslWatermark.get(pos.ticket);
      const best = prevBest === undefined
        ? pos.priceCurrent
        : isBuy ? Math.max(prevBest, pos.priceCurrent) : Math.min(prevBest, pos.priceCurrent);
      this.simTslWatermark.set(pos.ticket, best);

      // Not yet in enough profit — nothing to observe.
      if (profitPct < activationPct) return;

      const triggerPrice = isBuy ? best * (1 - distancePct / 100) : best * (1 + distancePct / 100);
      const touched = isBuy ? pos.priceCurrent <= triggerPrice : pos.priceCurrent >= triggerPrice;
      if (!touched) return;

      const last = this.simTslLastMomentAt.get(pos.ticket) ?? 0;
      if (Date.now() - last < this.SIM_TSL_MOMENT_COOLDOWN_MS) return;
      this.simTslLastMomentAt.set(pos.ticket, Date.now());

      this.adjustmentRecorder.recordSimTslEvent({
        tradeTicket: pos.ticket,
        symbol: pos.symbol,
        strategyId: strat.id ?? null,
        strategyName: strat.name ?? null,
        event: 'decision-point',
        entryPrice: pos.priceOpen,
        triggerPrice,
        price: pos.priceCurrent,
        profitPct,
        distancePct,
        activationPct,
        detail: { best, side: pos.type, watermarkInMemory: true },
      });
    } catch (err: any) {
      // ⚠️ An observer must never break the guardian. This is instrumentation, not control flow,
      // and a throw here would abort the tick that does the real stop management.
      this.logger.warn(`sim-TSL observation failed for #${pos?.ticket}: ${err?.message}`);
    }
  }

  /**
   * observeExhaustion() — the UP-move exhaustion OBSERVER (#995).
   * =============================================================
   * WHAT IT WATCHES. A position whose move is DECELERATING into a new extreme: price still at the
   * window high, but less progress over the last k bars than over the k bars before them. That is
   * the mirror of what the app already has — `momentum-exhaustion` and
   * `panic-exhaustion-absorption` are both `directionBias: 'bullish'`, i.e. "the DOWN-move is
   * exhausting, buy the dip". Nothing watches "the UP-move is tiring" on a position already open.
   *
   * ⚠️ IT ACTS ON NOTHING. No order, no stop move — `exhaustion_event.action` is hardcoded
   * `recorded`. Escalating it means adding an id to `STOP_GUARDIAN_DIRECTIVES`, which changes how
   * much a tradeable position moves its stop: that is MATHS (`maths-change-requires-ab`) and needs
   * a COPIED configuration, which #929’s precondition still blocks from reporting. The observer
   * exists so the moment becomes MEASURABLE first.
   *
   * ⚠️ WHY IT COMPUTES THE METRIC INSTEAD OF CALLING A DIRECTIVE. Neither existing exhaustion
   * directive fits this window, and that is measured, not assumed: the guardian evaluates 5m bars
   * with limit=30, while `momentum-exhaustion` declares `minBars {1d: 19}` and suitability
   * `minTimeframe M15`. `observeSimulatedTsl()` does not add a directive either, for the same
   * reason — an observer is not a member of the consensus set.
   *
   * ⚠️ THREE DELIBERATE DIFFERENCES FROM `observeSimulatedTsl()`, each with a cost:
   *   1. It needs BARS, so it runs after the bar load and is SILENT while the feed is short.
   *   2. The threshold is NOT guessed. `exhaustionDecelPct` NULL means "not configured" and the
   *      observer bails — a default would record firings against a number nobody chose, which is
   *      evidence for a fiction.
   *   3. It requires the move to be ADVANCING first. Deceleration after a DECLINE is just a
   *      decline, and flagging that would mark every losing position as exhausted.
   */
  private observeExhaustion(pos: Mt5RawPosition, strat: any, bars: any[]): void {
    try {
      if (!strat?.exhaustionObserveEnabled) return;
      const thresholdPct = Number(strat.exhaustionDecelPct);
      // NULL / 0 means NOT CONFIGURED, never "arm at zero". Bailing leaves the position
      // unobserved rather than inventing a threshold.
      if (!Number.isFinite(thresholdPct) || thresholdPct <= 0) return;
      if (!Number.isFinite(pos.priceOpen) || pos.priceOpen <= 0) return;
      if (!Number.isFinite(pos.priceCurrent)) return;

      const k = this.EXHAUSTION_WINDOW_BARS;
      const need = k * 2 + 1;
      if (!Array.isArray(bars) || bars.length < need) return;

      const closes = bars
        .map((b) => Number(b?.close))
        .filter((n) => Number.isFinite(n));
      if (closes.length < need) return;
      const n = closes.length;

      const isBuy = pos.type === 'buy';
      // Progress in the FAVOURABLE direction for THIS position, so a sell mirrors a buy exactly.
      const progress = (from: number, to: number) => (isBuy ? to - from : from - to);
      const last = closes[n - 1];
      const recentStart = closes[n - 1 - k];
      const priorStart = closes[n - 1 - 2 * k];
      const recent = progress(recentStart, last);
      const prior = progress(priorStart, recentStart);

      // ⚠️ Difference 3. A move must have been ADVANCING for the comparison to mean anything.
      if (!(prior > 0)) return;

      // The latest close must BE the window extreme (within 0.1%), or near it. Exhaustion is a
      // claim about a move INTO a high; a mid-range deceleration is not the same statement.
      const peak = isBuy ? Math.max(...closes) : Math.min(...closes);
      const atExtreme = isBuy ? last >= peak * 0.999 : last <= peak * 1.001;
      if (!atExtreme) return;

      const decelPct = ((prior - recent) / prior) * 100;
      if (decelPct < thresholdPct) return;

      // ⚠️ REQUIRED, not an optimisation — see the field declaration.
      const lastAt = this.exhaustionLastAt.get(pos.ticket) ?? 0;
      if (Date.now() - lastAt < this.EXHAUSTION_COOLDOWN_MS) return;
      this.exhaustionLastAt.set(pos.ticket, Date.now());

      const entry = pos.priceOpen;
      const profitPct =
        ((isBuy ? pos.priceCurrent - entry : entry - pos.priceCurrent) / entry) * 100;

      this.adjustmentRecorder.recordExhaustionEvent({
        tradeTicket: pos.ticket,
        symbol: pos.symbol,
        strategyId: strat.id ?? null,
        strategyName: strat.name ?? null,
        side: isBuy ? 'buy' : 'sell',
        entryPrice: entry,
        price: pos.priceCurrent,
        peakPrice: peak,
        profitPct,
        // Stored relative to ENTRY so rows are comparable across symbols and across time.
        recentProgressPct: (recent / entry) * 100,
        priorProgressPct: (prior / entry) * 100,
        decelPct,
        thresholdPct,
        barsUsed: n,
        detail: { k, windowBars: n, timeframe: '5m', observedOnly: true },
      });
    } catch (err: any) {
      // An observer must never break the guardian.
      this.logger.warn(`exhaustion observation failed for #${pos?.ticket}: ${err?.message}`);
    }
  }

  private finishTick(tickStart: number) {
    this.state.lastTickMs = Date.now() - tickStart;
    this.state.nextTickAt = new Date(
      Date.now() + this.state.tickIntervalMs,
    ).toISOString();
    this.ticking = false;
    this.scheduleNext();
  }

  private makeGuarded(
    pos: Mt5RawPosition,
    strat: any,
    side: 'BUY' | 'SELL',
    recommendedSl: number | null,
    stopConfidence: number,
    wickFilterPassed: boolean,
    ownerVia: GuardedPosition['ownerVia'],
    // #1056 — REQUIRED, deliberately: a new push site must state its own outcome rather than
    // inherit a default that would read as a decision nobody made.
    outcome: GuardedPositionOutcome,
  ): GuardedPosition {
    return {
      ticket: pos.ticket,
      symbol: strat.symbol,
      strategyId: strat.id,
      strategyName: strat.name,
      side,
      currentSl: pos.sl,
      recommendedSl,
      stopConfidence,
      wickFilterPassed,
      lastEvaluatedAt: new Date().toISOString(),
      ownerVia,
      // #1030 — which account this managed position sits on, so the guard's coverage is
      // checkable from the payload instead of inferred from a log.
      brokerId: pos.brokerId,
      // #1056 — see `GuardedPositionOutcome`. Always a branch that RAN.
      outcome,
    };
  }

  /**
   * loadBars() — the 5m bars for a symbol, fetched from the bridge that holds the POSITION (#1030).
   *
   * ⚠️ WHY THE POSITION'S BRIDGE AND NOT THE PRIMARY. Measured live 2026-09-30:
   * `GET :5000/candles?symbol=GER40` answers `200` with **0 bars**, while `:5001` answers with
   * bars — GER40 is routed to broker 3 and the primary simply does not carry it. That is a SECOND,
   * independent reason GER40 was never trailed: even had the position been visible, the bar load
   * returned nothing, and the tick skips any position with fewer than 14 bars. One bridge was
   * wrong twice over.
   *
   * ⚠️ THE PRIMARY IS KEPT AS A FALLBACK, AND THAT IS THE OLD BEHAVIOUR RATHER THAN A NEW RISK.
   * Before this change the primary was the ONLY bridge ever asked, so falling back to it can only
   * preserve a read that used to succeed. It is not reached when the position's own bridge answers.
   */
  private async loadBars(symbol: string, brokerId?: number): Promise<any[]> {
    if (brokerId != null) {
      const own = await this.mt5Connection.getCandles(symbol, '5m', 30, brokerId);
      if (own.length) return own;
    }
    return this.mt5Connection.getCandles(symbol, '5m', 30);
  }

  /**
   * Relaxed broker-side protective stop (#721 decision 6) — the stop set when a position is
   * found UNLOCKED (SL=0). Distance = the strategy's own slPct from entry.
   *
   * ⚠️ #927 (2026-09-21) — WHAT SURVIVES THE TRAIL, STATED EXACTLY.
   *
   * MT5 has ONE stop-loss field per position, so a trailing tighten REPLACES this value: the
   * floor's NUMBER cannot persist, and the comment here used to claim it was "independent of the
   * tighter app-managed trailing stop" — unimplementable as written. The gap that left was
   * measured: stops trailed to 0.03–0.11% from entry against a declared ~1%, and 7 positions
   * closed on those stops inside 28 minutes, every close at a guardian-set price.
   *
   * What the design guarantees instead is the DISTANCE: `trailDistanceFor()` never lets a tighten
   * leave the stop closer to price than this declared distance, and `trailDistanceProblem()` makes
   * that check explicit (the tick refuses the modify if it fails). The floor's number can be
   * replaced by a trail; the floor's risk distance cannot be shrunk by one.
   */
  private protectiveSl(
    pos: Mt5RawPosition,
    side: 'BUY' | 'SELL',
    strat: any,
  ): number | null {
    const entry = Number(pos.priceOpen);
    if (!entry || entry <= 0) return null;
    const slPct = Number(strat?.slPct ?? 1) || 1;
    const protective =
      side === 'BUY' ? entry * (1 - slPct / 100) : entry * (1 + slPct / 100);
    return Number(protective.toFixed(5));
  }

  /**
   * Broker-throttle gate — returns `null` if a modify may be sent now, or the
   * reason it may not.
   *
   * ⚠️ #892 — this used to return a bare boolean and the caller logged the block
   * at `debug`, which Nest never prints at the default level. A stop edit that
   * could never go out was therefore completely invisible. Naming the reason is
   * what makes the two cases distinguishable: the per-position cadence is normal
   * and self-clearing, whereas the global cap means edits are being dropped.
   */
  private modifyBlockedReason(symbol: string, ticket: number, priority: boolean): string | null {
    const now = Date.now();
    // #893 — strongest reason first: the broker ALREADY said this market is closed.
    // Checked before `priority` is consulted because a shut market refuses a
    // protective floor exactly as it refuses a trailing tighten — attempting the
    // emergency write during the backoff window cannot succeed, and the backoff
    // always expires (15m) so the floor is still set promptly after a re-open.
    const closedUntil = this.marketClosedUntil.get(symbol) || 0;
    if (now < closedUntil) {
      return `market closed (broker refusal) — next probe in ${Math.ceil((closedUntil - now) / 60_000)}m (#893)`;
    }
    this.modifyTimes = this.modifyTimes.filter((t) => now - t < 60_000);
    // Global hard cap applies to everyone (incl. protective floors) to avoid
    // tripping broker throttling during a mass-unlock event.
    if (this.modifyTimes.length >= this.MAX_MODIFY_PER_MINUTE) {
      return `global cap — ${this.modifyTimes.length} modify(s) already sent in the last 60s (max ${this.MAX_MODIFY_PER_MINUTE})`;
    }
    if (!priority) {
      const last = this.lastModifyAt.get(ticket) || 0;
      if (now - last < this.MIN_MODIFY_INTERVAL_MS) {
        return `per-position cadence — ${Math.round((now - last) / 1000)}s since the last edit on #${ticket} (min ${this.MIN_MODIFY_INTERVAL_MS / 1000}s)`;
      }
    }
    return null;
  }

  /** Throttled so the legitimate cadence blocks cannot flood the log they live in. */
  private logThrottle(symbol: string, ticket: number, reason: string): void {
    const now = Date.now();
    if (now - this.lastThrottleLogAt < this.THROTTLE_LOG_MS) return;
    this.lastThrottleLogAt = now;
    this.logger.warn(`Stop modify blocked: ${symbol} #${ticket} — ${reason}`);
  }

  /**
   * #927 — throttles the "trail would violate the declared distance" warning.
   * As a property of the computation (not of a position), it is throttled globally; with
   * `trailDistanceFor` max()ing it should never fire, and if it ever does, once per 5 minutes is
   * the right loudness for "a guard just caught something that should be impossible".
   */
  private logTrailRefusal(pos: Mt5RawPosition, problem: string): void {
    const now = Date.now();
    if (now - this.lastTrailRefusalAt < this.THROTTLE_LOG_MS) return;
    this.lastTrailRefusalAt = now;
    this.logger.warn(`Trail tighten REFUSED for ${pos.symbol} #${pos.ticket} — ${problem}`);
  }

  /**
   * Post an SL modification, throttle-aware, and record + notify on success.
   * `priority` bypasses the per-position cadence (used for the protective
   * floor when a position is unlocked), but never the global cap.
   */
  private async applyModify(
    pos: Mt5RawPosition,
    newSl: number,
    reason: string,
    confidence: number,
    side: 'BUY' | 'SELL',
    adjustments: StopAdjustment[],
    priority: boolean,
    directiveScores?: Record<string, number | null>,
  ): Promise<boolean> {
    const blocked = this.modifyBlockedReason(pos.symbol, pos.ticket, priority);
    if (blocked) {
      this.logThrottle(pos.symbol, pos.ticket, blocked);
      return false;
    }

    // #893 — cleared so a refusal recorded during THIS call is unambiguous.
    this.lastRefusalDetail = null;
    // #1030 — addressed to the bridge that HOLDS the position, not to a URL captured at start-up.
    const ok = await this.modifyStop(pos, newSl);

    if (ok) {
      // #893 — a successful edit proves the market is open: drop any backoff.
      this.marketClosedUntil.delete(pos.symbol);
      const now = Date.now();
      this.lastModifyAt.set(pos.ticket, now);
      this.modifyTimes.push(now);

      const entry: StopAdjustment = {
        timestamp: new Date().toISOString(),
        ticket: pos.ticket,
        symbol: pos.symbol,
        oldSl: pos.sl,
        newSl,
        reason,
        stopConfidence: confidence,
      };
      adjustments.push(entry);
      this.state.recentAdjustments = [
        entry,
        ...this.state.recentAdjustments,
      ].slice(0, 50);
      this.logger.log(
        `Stop: ${pos.symbol} #${pos.ticket} SL ${pos.sl} → ${newSl} (${confidence}%)`,
      );
      // Persist the adjustment to the stop_adjustment audit trail (#476).
      this.adjustmentRecorder.recordAdjustment({
        tradeTicket: String(pos.ticket),
        symbol: pos.symbol,
        oldSl: pos.sl,
        newSl,
        oldTp: pos.tp,
        newTp: pos.tp,
        reason,
        directiveScores: directiveScores ?? undefined,
      });
      this.notifications
        ?.send({
          title: `🛡️ Stop adjusted — ${pos.symbol}`,
          body: `${side} #${pos.ticket} SL ${pos.sl} → ${newSl.toFixed(5)} — ${reason}`,
          symbol: pos.symbol,
          event: 'stop-adjusted',
          metadata: { ticket: pos.ticket, oldSl: pos.sl, newSl, side, reason },
        })
        .catch(() => {});
    } else if (/market\s+(is\s+)?closed/i.test(this.lastRefusalDetail ?? '')) {
      // #893 — the bridge answered `{"success": false, "error": "Market closed"}`.
      // That is the broker stating the market is shut, so re-asking every cadence
      // window cannot succeed. Arm the per-symbol backoff; `modifyBlockedReason`
      // then skips this symbol until it expires, and a later SUCCESS clears it.
      // Any OTHER refusal (invalid stops, no such position) deliberately does NOT
      // back off — those need attention, not silence.
      this.marketClosedUntil.set(pos.symbol, Date.now() + this.MARKET_CLOSED_BACKOFF_MS);
      this.logger.warn(
        `Stop edits for ${pos.symbol} paused ${Math.round(this.MARKET_CLOSED_BACKOFF_MS / 60_000)}m — broker refused with "Market closed" (#893)`,
      );
    }
    return ok;
  }

  private computeAtr(bars: any[]): number {
    const highs = bars.map((b: any) => b.high);
    const lows = bars.map((b: any) => b.low);
    const closes = bars.map((b: any) => b.close);
    const trueRanges: number[] = [];
    for (let i = 1; i < Math.min(15, bars.length); i++) {
      trueRanges.push(
        Math.max(
          highs[i] - lows[i],
          Math.abs(highs[i] - closes[i - 1]),
          Math.abs(lows[i] - closes[i - 1]),
        ),
      );
    }
    return trueRanges.length > 0
      ? trueRanges.reduce((a, b) => a + b, 0) / trueRanges.length
      : 0;
  }
}
