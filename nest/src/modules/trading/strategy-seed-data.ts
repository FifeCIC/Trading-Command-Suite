/**
 * Trading Strategy Seed Data
 * ===========================
 * Canonical trading strategies for session-based coverage.
 * Used by TradingStrategyService.seedDefaults() to populate
 * initial strategies on fresh installs or resets.
 *
 * Each entry pairs a protocol with a symbol and broker.
 * Scoring strategies are auto-created if they don't exist.
 *
 * Protocol → ScoringStrategy → TradingStrategy chain.
 *
 * @created 2026-07-31 — 24/7 session coverage
 */

import { SessionTag, ALL_HOURS_VALUE } from './session-window';

export interface SeedTradingStrategy {
  name: string;
  symbol: string;
  /**
   * #1018 — the bot's MT5 MAGIC, from the reserved range (>= 234100). SEEDED, not allocated, so
   * a reinstall restores the SAME number and a position opened long ago still attributes to the
   * bot that opened it. ⚠️ Must never be 234000 — that is the bridge DEFAULT_MAGIC, i.e. "no bot
   * attributed", and a bot using it would be indistinguishable from one that sent none.
   */
  magic: number;
  protocolId: string;
  brokerId: string;
  // ⚠️ 'manual' is a REAL stored value (it is the schema default) and was missing from this
  // union until 2026-09-15 — so the one bot that is deliberately manual could not be described
  // here at all, which is part of why it stayed DB-only.
  mode: 'semi-auto' | 'auto' | 'score' | 'manual';
  timeframe: string;
  baseSize: number;
  slPct: number;
  tpPct: number;
  minComposite: number;
  /**
   * SESSION GATE (2026-09-10) — canonical session tags this bot may act in.
   * Persisted to trading_strategy.sessionWindow and enforced by Gate 4.5 in
   * automation-loop.service.ts.
   *
   * ⚠️ EVERY entry must DECLARE this slot (#982, 2026-10-08). `null` is not a valid value here any
   * more — the union below excludes it as the declared contract, and because this project compiles
   * with `strictNullChecks` OFF the ENFORCEMENT is the build-gate spec
   * (`strategy-seed-session-declared.spec.ts`), not the type. NULL in the DATABASE now means
   * "UNFILLED — nobody chose" and is surfaced as such by the audit (`sessionSlotKind()`), while the
   * deliberate case is the positive value `'all-hours'` (synonym `'bypass'`). The GATE treats both
   * `'all-hours'` and NULL as ungated — identical behaviour — so this change moved visibility, not
   * trading boundaries.
   * The build gate for this rule: `strategy-seed-session-declared.spec.ts` (in the prebuild list).
   *
   * Replaces the old `session: 'tokyo' | 'london' | 'us' | 'always'` field,
   * which was declared here but consumed by no runtime code — a label with no
   * rule behind it. 'tokyo' → 'asian', 'always' → null.
   */
  sessionWindow: SessionTag[] | typeof ALL_HOURS_VALUE;
  /**
   * Direction constraint ('BUY' | 'SELL'). null/absent = unconstrained.
   *
   * Required for SHORT_ONLY protocols. Without it a seeded short bot has no
   * declared side, so the direction is implied by the protocol alone — and the
   * subscription role (`strategy_protocol.role`) is what actually routes signals.
   * See database-seed-discipline.instructions.md.
   */
  requireDirection?: 'BUY' | 'SELL' | null;
  /**
   * ── ADDITIONAL DIRECTION LEGS (#1185, shape B, 2026-11-02) ────────────────────────────────────
   *
   * A bot may hold TWO subscriptions — a long protocol and a short protocol — and be summarised as
   * ONE strategy. `protocolId` above is the bot's primary (long) leg; anything here is created in
   * addition, with its own direction role.
   *
   * ⚠️ WHY THIS IS DECLARED IN THE SEED AND NOT WRITTEN BY HAND. `strategy_protocol` is a
   * subscription table with no seeder for extra rows, so a second leg created directly in the
   * database is lost on reinstall — and the paired bot would silently become a single-leg bot that
   * only ever goes long. That is the failure `database-seed-discipline` exists to prevent, and it
   * applies exactly here because the short leg is the whole point of the pair.
   *
   * ⚠️ THE LEG MUST BE A DIFFERENT PROTOCOL. The queue's unique key is
   * `(strategyId, protocolId, symbol)` with no role in it, so two subscriptions of the SAME protocol
   * collapse to one row (asserted in `signal-queue-paired-legs.spec.ts`).
   */
  legs?: Array<{ protocolId: string; role: 'long' | 'short' | 'both' }>;
  /**
   * Position time-stop in HOURS (#773). null/absent = NO LIMIT.
   *
   * Carried by this seeder because it is a SLOT-RELEASING control: #773 measured 11 auto
   * bots sharing 5 broker-wide slots with nothing freeing them, while composites of 81–82
   * sat BLOCKED on "Max open positions (5) reached". It was applied to the live database by
   * `set-max-hold-hours-773.sql` only, so a reinstall silently dropped it. The seeder now
   * transports the field (`seedDefaults` writes it) — a control that only exists in SQL is
   * a control that only exists on one machine.
   */
  maxHoldHours?: number | null;
  /**
   * Capital the bot may use, in account currency (#894) — the base for the rating's risk
   * condition (drawdown <= 25% OF THIS), and the denominator for its realised return.
   *
   * ⚠️ Optional, and ABSENT MEANS "NOT SET", which is a real state: a bot with no allocation
   * cannot be rated, and that is reported as `allocation_not_set` rather than papered over with
   * a default. Only ONE entry below declares a value — see its comment for why.
   */
  allocationAmount?: number | null;
  /**
   * #995 — UP-MOVE EXHAUSTION OBSERVER (display-only). `true` enables recording of
   * deceleration-at-new-highs for this bot's open positions; nothing is acted on.
   * The threshold is PROVISIONAL while `upside-exhaustion-predicts-giveback` accrues;
   * rows store raw progress halves so any threshold can be re-applied to them later.
   */
  exhaustionObserveEnabled?: boolean;
  /** #995 — the observer's decelPct threshold (percent). Absent = the bot keeps its value. */
  exhaustionDecelPct?: number | null;
  /**
   * Whether the bot starts ENABLED. Absent = true (the historical behaviour).
   *
   * Exists so a deliberately-inactive bot (the `hourly-3dir-v1` A/B control) can be
   * described here. Without it, a fresh install re-activated it and "off on purpose" was
   * indistinguishable from "lost in the reinstall".
   */
  active?: boolean;
  /** Trading style from the protocol */
  style?: string;
}

export const DEFAULT_TRADING_STRATEGIES: SeedTradingStrategy[] = [
  {
    name: 'Silver Speed Scalp',
    symbol: 'XAGUSD',

    magic: 234104,
    protocolId: 'xau-speed-v1',
    brokerId: 'mt5',
    // semi-auto -> auto (2026-09-15) for data generation. baseSize stays 0.01: silver's
    // broker floor IS 0.01, unlike the index symbols.
    mode: 'auto',
    timeframe: '5m',
    baseSize: 0.01,
    slPct: 0.6,
    tpPct: 1.0,
    minComposite: 10,
    sessionWindow: ['london'],
    style: 'Tick Scalp',
    // #1185 — THE PAIR. This bot holds a LONG protocol and its SHORT counterpart as ONE strategy.
    // The short leg is a different protocol on purpose: the queue's unique key is
    // `(strategyId, protocolId, symbol)` with no role in it, so one protocol used two ways could
    // never hold two queue rows (`signal-queue-paired-legs.spec.ts`).
    legs: [{ protocolId: 'xau-speed-v1-short', role: 'short' }],
    // #995 exhaustion OBSERVER (display-only, acts on nothing): threshold 20 is PROVISIONAL —
    // rows store raw progress halves so any threshold can be re-applied to them later.
    exhaustionObserveEnabled: true,
    exhaustionDecelPct: 20,
  },
  {
    name: 'Tokyo USDJPY Session',
    symbol: 'USDJPY',

    magic: 234109,
    protocolId: 'forex-session-v1',
    brokerId: 'mt5',
    // `mode: auto` and `maxHoldHours` were DB-only — see the block note above 'Gold Scalp M5'.
    mode: 'auto',
    timeframe: '1h',
    baseSize: 0.05,
    slPct: 1.5,
    tpPct: 3.0,
    minComposite: 10,
    sessionWindow: ['asian'],
    maxHoldHours: 12,
    style: 'Swing',
    // #1185 — the pair, as above.
    legs: [{ protocolId: 'forex-session-v1-short', role: 'short' }],
  },
  {
    name: 'Tech Giants - NVDA',
    symbol: 'NVDA',

    magic: 234128,
    protocolId: 'momentum-stock-v1',
    brokerId: 'mt5',
    mode: 'auto',
    timeframe: '15m',
    baseSize: 1,
    slPct: 3.0,
    tpPct: 6.0,
    minComposite: 10,
    sessionWindow: ['us'],
    requireDirection: 'BUY',
    maxHoldHours: 24,
    style: 'Swing / Momentum',
    // #1185 — the pair. `requireDirection: 'BUY'` above stays: it resolves this bot's PRIMARY leg to
    // role 'long', and a subscription's own role outranks it, so the short leg below is unaffected.
    legs: [{ protocolId: 'momentum-stock-v1-short', role: 'short' }],
  },
];
