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
   * SIM-TSL OBSERVER (#936 / armed 2026-11-03, record-only, armed 2026-11-03).
   *
   * ⚠️ This ARMS AN OBSERVER, NOT A TRAILING STOP. `observeSimulatedTsl()` records the moment a
   * position has run into profit and then given it back — it writes a `sim_tsl_event` row with
   * `action: 'recorded'` and places nothing. Verified by reading the recorder: a single
   * `prisma.simTslEvent.create` and no order path. Acting on the moment is a MATHS change needing a
   * copied configuration and an A/B, which is deliberately not done here.
   *
   * WHY IT IS ARMED WITH THE BOTS INACTIVE: the measurement is the thing that is missing, and it has
   * to exist BEFORE the exit rule can be changed. Arming changes no behaviour while `active = 0`, so
   * the owner's activation decision stays theirs, and the day they switch a bot on the data starts.
   *
   * MEASURED 2026-11-03 — why this matters: 30-day system/broker exits show avg win **+4.50** against
   * avg loss **−15.27**, i.e. a break-even win rate of **77.2%** against a realised **29.5%**. Stops
   * were hit 21 times against 1 take-profit. Until the decision moment is recorded, no exit change
   * can be judged.
   *
   * VALUES ARE DERIVED, NOT GUESSED: `activation` ≈ ⅓ of the bot's own `tpPct` (the point at which
   * the trade has made a third of its target), `distance` ≈ ⅓ of its `slPct` (give back a third of
   * the stop before the moment is recorded). Stated so the choice is auditable and re-derivable.
   */
  simTsl?: { enabled: boolean; activationPct: number; distancePct: number };
  /**
   * THEORY — what this COMPLETE strategy intends, in prose a human reads (#689 mirror, 2026-11-03).
   *
   * ⚠️ It lives on the BOT, not on the protocols, because a LONG+SHORT pair is ONE strategy with ONE
   * rationale. Splitting it across two protocol rows is how a pair starts reading as two unrelated
   * things that happen to share a symbol.
   */
  theory?: string | null;
  /**
   * `asymmetry` | `participation` | `regime` | `control`.
   *
   * ⚠️ `control` means **deliberately no directional thesis**, and it is a valid, VISIBLE answer —
   * not a blank field. Manufacturing a plausible theory for a strategy that has none is the prose
   * form of this repo's worst bug: a confident claim with nothing behind it, which stops anyone
   * looking and makes every later measurement look like progress.
   */
  theoryKind?: 'asymmetry' | 'participation' | 'regime' | 'control' | null;
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
    name: 'Silver Speed Scalp Bot',
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
    // Observer only — records the give-back moment, places nothing. activation ≈ ⅓ of tpPct,
    // distance ≈ ⅓ of slPct. See the `simTsl` docblock on SeedTradingStrategy.
    simTsl: { enabled: true, activationPct: 0.5, distancePct: 0.25 },
    // ── THEORY (2026-11-03) ──
    // Written from what was MEASURED, not from what would sound good. The trailing-stop sentence is
    // in here because it is the single most useful thing anyone picking this bot up could know, and
    // it came from a contrast run rather than an opinion.
    theoryKind: 'asymmetry',
    theory:
      'Silver falls faster than it rises: liquidation is a stampede, accumulation is a grind. The long ' +
      'leg harvests the grind — trend structure on short bars, holding until structure breaks — and the ' +
      'short leg harvests the stampede. The two legs are not a hedge; they are two different behaviours ' +
      'of one instrument, which is why they are different protocols rather than one with a direction ' +
      'flag. ⚠️ MEASURED 2026-11-03: a trailing stop 0.5% behind the best price cut the win rate from ' +
      '84% to 29% and turned +2,438 into −335 on the same entries — the edge is in letting the target ' +
      'be reached, so every exit rule must be tested as a contrast before it is trusted. Known ' +
      'weakness: gated to London, so it sees roughly a third of the day.',
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
    name: 'Tokyo USDJPY Session Bot',
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
    // Observer only — see the `simTsl` docblock. activation ≈ ⅓ of tpPct, distance ≈ ⅓ of slPct.
    simTsl: { enabled: true, activationPct: 1.0, distancePct: 0.5 },
    // ── THEORY (2026-11-03) ──
    // ⚠️ `regime` is stated as UNMEASURED on purpose. No contrast has yet compared session-gated
    // against all-hours on this pair, so the gating is a declared choice, not a demonstrated
    // advantage — and saying so is what stops the next agent treating it as settled.
    theoryKind: 'regime',
    theory:
      'USDJPY behaves differently by clock: Asia tends to trend on carry and flow, London tends to ' +
      'revert it. The bot is gated to the Asian session for exactly that reason — the gate is the ' +
      'strategy, not a filter bolted on. The long leg takes the Asian trend; the short leg takes the ' +
      'reversal when the protocol reads bearish. ⚠️ UNMEASURED: the regime claim is plausible and ' +
      'untested here — no contrast has compared session-gated against all-hours, so the gate is a ' +
      'declared choice rather than a demonstrated edge. Known weakness: only the Asian window is open ' +
      'to it, so a whole day can pass with no signal; that is the theory working, not a fault, and it ' +
      'means a quiet week is not evidence against the strategy.',
    sessionWindow: ['asian'],
    maxHoldHours: 12,
    style: 'Swing',
    // #1185 — the pair, as above.
    legs: [{ protocolId: 'forex-session-v1-short', role: 'short' }],
  },
  {
    name: 'Tech Giants NVDA Bot',
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
    // Observer only — see the `simTsl` docblock. activation ≈ ⅓ of tpPct, distance ≈ ⅓ of slPct.
    simTsl: { enabled: true, activationPct: 2.0, distancePct: 1.0 },
    // ── THEORY (2026-11-03) ──
    // ⚠️ `control` — and this is the honest answer, not a placeholder. The owner's own words: *"I
    // suspect maybe some don't really have a deep context."* Writing a plausible thesis for this one
    // would be the prose form of the repo's worst bug.
    theoryKind: 'control',
    theory:
      'No directional thesis. This exists so the suite contains one STOCK strategy while the equity ' +
      'side is being built, and so the machinery is exercised on an instrument with an equity session ' +
      'rather than a 24-hour one. ⚠️ The canonical backtest is −2,878 on NVDA, and that is the honest ' +
      'starting position rather than a fault to tune around: a strategy without a thesis cannot be ' +
      'improved, only re-rolled, because every parameter change is noise measured against noise. ' +
      'Before more tuning, this needs a theory — what NVDA does that a generic momentum protocol ' +
      'would miss. Until then, treat its numbers as instrumentation, not performance.',
    sessionWindow: ['us'],
    requireDirection: 'BUY',
    maxHoldHours: 24,
    style: 'Swing / Momentum',
    // #1185 — the pair. `requireDirection: 'BUY'` above stays: it resolves this bot's PRIMARY leg to
    // role 'long', and a subscription's own role outranks it, so the short leg below is unaffected.
    legs: [{ protocolId: 'momentum-stock-v1-short', role: 'short' }],
  },
];
