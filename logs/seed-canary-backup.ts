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
   * more and the type no longer permits it: NULL in the DATABASE now means "UNFILLED — nobody chose"
   * and is surfaced as such by the audit (`sessionSlotKind()`), while the deliberate case is the
   * positive value `'all-hours'` (synonym `'bypass'`). The GATE treats both `'all-hours'` and NULL
   * as ungated — identical behaviour — so this change moved visibility, not trading boundaries.
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
  // ── Index tick-scalp bots — London/EU coverage (#730 / #747) ──
  {
    name: 'FTSE Index Tick Scalp',
    symbol: 'UK100',

    magic: 234100,
    protocolId: 'ftse-speed-v1',
    // brokerId is a broker TYPE, not an instance — routing is driven by
    // symbol_route (UK100 -> broker 3 / Pepperstone :5001). See the audit note
    // at the top of this file.
    brokerId: 'mt5',
    // AUTO (2026-09-10): was 'semi-auto', which requires a UI click and meant
    // ZERO Pepperstone trades ever occurred. This is the only auto bot routing
    // to Pepperstone, so it is the proof path for multi-broker execution.
    mode: 'auto',
    timeframe: '5m',
    // ⚠️ 0.1 IS THE BROKER FLOOR, NOT A PREFERENCE (2026-09-15). Every index symbol
    // has `volumeMin 0.1` on BOTH bridges, so the 0.01 this shipped with made the order
    // IMPOSSIBLE: `ORDER REJECTED UK100 BUY ×0.01 — Volume 0.01 below UK100 minimum (0.1)`
    // appears repeatedly in the API log. The "proof path for multi-broker execution"
    // named in the comment above had never executed a single trade because of it.
    // FX/metals are unaffected (their floor IS 0.01) — check the broker before changing.
    baseSize: 0.1,
    slPct: 0.4,
    tpPct: 0.6,
    // 65 -> 10 (2026-09-15): rescaled onto the post-ADR-011 percentage scale.
    // See the RESCALED block in common/utils/style-thresholds.ts for the derivation.
    minComposite: 10,
    sessionWindow: ['london'],
    style: 'Tick Scalp',
  },
  {
    name: 'DAX Index Tick Scalp',
    symbol: 'GER40',

    magic: 234101,
    protocolId: 'dax-speed-v1',
    brokerId: 'mt5',
    // semi-auto -> auto (2026-09-15): same reason the FTSE bot was flipped on 09-10.
    // Paper/dev runs exist to GENERATE DATA; a bot awaiting a click generates none.
    // Also baseSize 0.01 -> 0.1 (GER40's broker floor).
    mode: 'auto',
    timeframe: '5m',
    baseSize: 0.1,
    slPct: 0.4,
    tpPct: 0.6,
    minComposite: 10,
    sessionWindow: ['london'],
    style: 'Tick Scalp',
  },
  {
    name: 'CAC Index Tick Scalp',
    symbol: 'FRA40',

    magic: 234102,
    protocolId: 'cac-speed-v1',
    brokerId: 'mt5',
    // semi-auto -> auto and 0.01 -> 0.1 (FRA40's broker floor) — 2026-09-15.
    mode: 'auto',
    timeframe: '5m',
    baseSize: 0.1,
    slPct: 0.4,
    tpPct: 0.6,
    minComposite: 10,
    sessionWindow: ['london'],
    style: 'Tick Scalp',
  },
  {
    // Wired 2026-09-25. US30 was a DEAD ROUTE with three stacked faults and this bot is
    // the piece that did not exist: the symbol_route row (broker 3 / Pepperstone) and the
    // symbol_protocol_assignment had both existed since 2026-09-15, but `dow-speed-v1` was
    // inactive, NO watchlist fed it, and no bot consumed it — so US30 was never scored once.
    //
    // ⚠️ WHY THE BARS HAD STOPPED, and it is the same cause. `bar-refresh` builds its set from
    // positions / active-strategies / forex-floor / protocol-symbols, so an INACTIVE protocol
    // takes its symbols out of the refresh set. Activating `dow-speed-v1` is therefore the
    // single change that fixes BOTH the stale feed and the missing scoring. See
    // nest/resolve-us30.sql, which recorded this chain when it retired the DJI30 duplicate.
    //
    // sessionWindow is `us`, NOT `london` like the FTSE/DAX/CAC peers — the Dow is a US index.
    // baseSize 0.1 is the broker floor for index symbols on BOTH bridges (see the FTSE note).
    name: 'Dow Index Tick Scalp',
    symbol: 'US30',

    magic: 234103,
    protocolId: 'dow-speed-v1',
    brokerId: 'mt5',
    mode: 'auto',
    timeframe: '5m',
    baseSize: 0.1,
    slPct: 0.4,
    tpPct: 0.6,
    minComposite: 10,
    sessionWindow: ['us'],
    style: 'Tick Scalp',
  },

  // ── XAUUSD Variants (derived from xau-speed-v1) ──────────
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
  },
  {
    // ═══════════════════════════════════════════════════════════════════════════════════════
    // ⚠️ THE GOLD GROUP `mode` AND `maxHoldHours` WERE DB-ONLY. THIS FILE WAS BEHIND REALITY.
    //
    // All four gold bots ran as `mode: 'auto'` and held a time-stop, but this file said
    // `semi-auto` and declared no `maxHoldHours`. That is #833's drift, and it BIT on 2026-09-23:
    // the moment `seedDefaults()` learned to converge, the first live re-seed
    //   • flipped five bots to `semi-auto`, which stops them dispatching at all
    //     (`automation-loop.service.ts` Gate 2 — "auto bots only; manual/semi-auto stay for the
    //     UI buttons"), and
    //   • wrote `null` over four gold time-stops and Tokyo USDJPY's, removing the slot-releasing
    //     control #773 exists to provide.
    //
    // Both were reverted by hand and are now recorded HERE, because convergence is only safe in
    // one direction: seed → database. Enabling it while the seed lagged simply deleted the
    // deliberate changes. **Reconcile the seed to reality BEFORE trusting a convergent seeder.**
    // ═══════════════════════════════════════════════════════════════════════════════════════
    name: 'Gold Scalp M5',
    symbol: 'XAUUSD',

    magic: 234105,
    protocolId: 'xau-speed-m5',
    brokerId: 'mt5',
    mode: 'auto',
    timeframe: '5m',
    baseSize: 0.01,
    slPct: 0.3,
    tpPct: 0.5,
    minComposite: 9,
    sessionWindow: 'all-hours',
    maxHoldHours: 4,
    style: 'Scalp',
  },
  {
    name: 'Gold Day-Trade M15',
    symbol: 'XAUUSD',

    magic: 234106,
    protocolId: 'xau-speed-m15',
    brokerId: 'mt5',
    mode: 'auto',
    timeframe: '15m',
    baseSize: 0.02,
    slPct: 0.5,
    tpPct: 1.0,
    minComposite: 10,
    sessionWindow: 'all-hours',
    maxHoldHours: 24,
    style: 'Day Trade',
  },
  {
    name: 'Gold Swing 1H',
    symbol: 'XAUUSD',

    magic: 234107,
    protocolId: 'xau-speed-1h',
    brokerId: 'mt5',
    mode: 'auto', // DB-only value — see the block note above 'Gold Scalp M5'
    timeframe: '1h',
    // ⚠️ 0.05 -> 0.02 (2026-09-22), on the owner's instruction: "we moved to 0.01 because my
    // real money will not afford 0.1 sized lots". The LOT NUMBER is not the risk — this is:
    //
    //     risk = lots x contractSize x price x slPct
    //
    // Measured at 0.05 with this 1.5% stop: **£245.22 per trade**, on a £1,376 account. At
    // 0.02 it is £98.09, inside the owner's stated £100 ceiling. XAUUSD's floor is 0.01, so
    // 0.02 is comfortably reachable. Full audit over all 26 active bots: only this bot and
    // Gold Position 4H exceeded £100 — every FX, index, silver and VIX bot was already fine.
    baseSize: 0.02,
    slPct: 1.5,
    tpPct: 3.0,
    minComposite: 9,
    sessionWindow: 'all-hours',
    maxHoldHours: 72,
    style: 'Swing',
  },
  {
    name: 'Gold Position 4H',
    symbol: 'XAUUSD',

    magic: 234108,
    protocolId: 'xau-speed-4h',
    brokerId: 'mt5',
    mode: 'auto', // DB-only value — see the block note above 'Gold Scalp M5'
    timeframe: '4h',
    // ⚠️ 0.1 -> 0.01 (2026-09-22), owner instruction. At 0.1 with this 3% stop the measured
    // risk was **£980.88 per trade — 71% of a £1,376 account in a single position.** That was
    // the real exposure problem; the 0.1 lot number was only its symptom.
    //
    // At the XAUUSD floor of 0.01 it is £130.89 — still above the owner's £100 ceiling, and
    // it CANNOT go lower because 0.01 is the broker's minimum volume. The only route under
    // £100 on this bot is a tighter `slPct`, which is a STOP decision rather than a sizing
    // one, so it is left untouched here deliberately. Flagged on the handoff rather than
    // silently tightened.
    baseSize: 0.01,
    slPct: 3.0,
    tpPct: 6.0,
    minComposite: 8,
    sessionWindow: 'all-hours',
    maxHoldHours: 120,
    style: 'Position',
  },

  // ── Session Strategies ──────────────────────────────────
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
  },
  {
    name: 'London EURUSD Macro',
    symbol: 'EURUSD',

    magic: 234110,
    protocolId: 'eurusd-macro-v1',
    brokerId: 'mt5',
    // semi-auto -> auto (2026-09-15) for data generation.
    mode: 'auto',
    timeframe: '15m',
    baseSize: 0.02,
    slPct: 0.5,
    tpPct: 1.0,
    minComposite: 10,
    sessionWindow: ['london'],
    style: 'Day Trade',
  },
  {
    name: 'US SPY Speed',
    // ⚠️ SPX500 -> US500 (2026-09-15). `SPX500` is not a ticker either broker offers: it
    // had ZERO bars ever (`BROKER-HAS-NO-SYMBOL` in scripts/audit-bot-activation.cjs;
    // `got 0 candles for SPX500` on every refresh). Its own twin row `US500` exists, has
    // bars, and is now routed to Pepperstone. The fix is the ticker, not the strategy —
    // see nest/fix-symbol-tickers.sql (which could not apply the rename because a US500
    // row already exists).
    symbol: 'US500',

    magic: 234111,
    // ⚠️ spy-day-v1 -> spy-speed-v1 (2026-09-25). The bot was subscribed to `spy-day-v1`, whose
    // ONLY watchlist (spy-day-index) holds `["SPY"]` — a different instrument. So the bot sat on
    // US500 consuming signals generated for SPY, and `syncQueues()` routes on
    // `sub.protocolId !== rec.protocolId`, so every US500 record scored under `spy-speed-v1`
    // was dropped. TWO independent declarations already said this was wrong:
    //   • symbol_protocol_assignment (PRIMARY source)  US500 -> spy-speed-v1
    //   • speed-scan.service.ts fallback map           US500 -> spy-speed-v1
    // ...and the bot's own name is "US SPY Speed", which is `spy-speed-v1`'s tradingStyle.
    // The subscription was the only artefact that disagreed. Measured: US500 has NEVER traded.
    //
    // ⚠️ LEFT ALONE DELIBERATELY, and they are inconsistent with a 5s–30s tick-scalp protocol:
    // `timeframe: '1h'`, `slPct: 3.0`, `tpPct: 6.0`, `style: 'Position'` are the values of a
    // POSITION bot. The FTSE/DAX/CAC peers run 5m / 0.4 / 0.6. Realigning those is a MATHS
    // change (SL/TP and cadence decide how much a tradeable symbol trades) and is left for the
    // owner rather than edited in place — the wiring fix above is what makes the bot reachable.
    protocolId: 'spy-speed-v1',
    brokerId: 'mt5',
    mode: 'auto',
    timeframe: '1h',
    baseSize: 0.1,
    slPct: 3.0,
    tpPct: 6.0,
    minComposite: 9,
    sessionWindow: ['us'],
    style: 'Position',
  },

  // ── Short-side proof (#772) ─────────────────────────────
  //
  // ⚠️ This is the app's only SHORT bot and the proof that the short path works
  // end-to-end. Read #770 before changing it.
  //
  // `vix-short-v1` is SHORT_ONLY and is the ONLY protocol that emits SELL. It
  // produced 247 scores (65 at the 200 ceiling) while having no bot — because
  // scoring is protocol-driven (buildBestLadder) but DISPATCH needs a
  // trading_strategy row to own the queue entry (processSignalQueues joins
  // q.strategyId -> trading_strategy.id). Without this row, scores accumulate
  // forever and nothing can ever execute.
  //
  // minComposite 0 is DELIBERATE and not a typo. The gate compares
  // `compositePct` — a 0-100 PERCENTAGE (protocol-gating.service.ts:307), not
  // the raw 0-200 composite. A bar of "60" would therefore mean 60%, which is
  // strict enough to silently gate the very trade this bot exists to prove.
  // Raise it only from measured Step 4 data (#772), never by intuition.
  //
  // brokerId is a broker TYPE, not an instance. VIX is Pepperstone-only and the
  // slot comes from the symbol_route row seeded in seed-symbol-onboarding.ts.
  {
    name: 'VIX Spike Short (demo proof #772)',
    symbol: 'VIX',

    magic: 234112,
    protocolId: 'vix-short-v1',
    brokerId: 'mt5',
    mode: 'auto',
    timeframe: '5m',
    // ⚠️ 0.01 -> 0.1 (2026-09-15): VIX's broker floor is 0.1, so the short path this bot
    // exists to PROVE could never execute — `ORDER REJECTED VIX SELL ×0.01 — Volume 0.01
    // below VIX minimum (0.1)` in the API log. #772's "first demo short" was blocked by
    // size, not by the strategy.
    baseSize: 0.1,
    slPct: 2.0,
    tpPct: 4.0,
    minComposite: 0,
    sessionWindow: 'all-hours',
    // Must be SELL — vix-short-v1 is SHORT_ONLY. The API create() path also sets
    // this; the seeder previously had no such field, so a seeded short bot would
    // have been created without a declared direction.
    requireDirection: 'SELL',
    style: 'Scalp',
  },

  // ════════════════════════════════════════════════════════════════════════════
  // FX SESSION PAIRS (#526–#531) — EXPORTED FROM THE LIVE DATABASE 2026-09-15
  // ════════════════════════════════════════════════════════════════════════════
  //
  // ⚠️ WHY THIS BLOCK EXISTS. These 14 bots existed **only in the database**, so a
  // reinstall would have silently deleted every one of them — leaving `forex-session-v1`
  // with symbols, routes, bars and assignments but **no bot able to trade them**. They were
  // created by "DB activation only (no code change)" (#526–#531), which is why nothing
  // seeded them: this file held 12 of the 26 bots that were actually running.
  //
  // Two more fields are carried here because they too were set against the live database
  // only, and both are load-bearing:
  //   · `maxHoldHours: 12` — the position time-stop from **#773**. It is a SLOT-RELEASING
  //     control (the incident measured 11 auto bots sharing 5 broker-wide slots, with
  //     composites of 81–82 BLOCKED on "Max open positions reached"). A reinstall that
  //     dropped it would re-create that strand. The seeder now transports the field.
  //   · `active` — the A/B control bot is inactive **on purpose**. Without the field, a
  //     fresh install could not tell "deliberately off" from "lost".
  //
  // All 14 pairs were verified tradeable before being enabled (2026-09-15): `tradeMode 4`
  // on BOTH bridges, volume floor 0.01 — except **NZDJPY, whose MetaQuotes floor is 0.1**,
  // which is why its size is 0.1 and the others are 0.01.
  //
  // ⚠️ `USDCAD Forex Session` declares `timeframe: '5s'` because that is what the live row
  // holds. This is a faithful export, not an endorsement — `'5s–30s'` resolves to `1m` per
  // `selectBaseTimeframe()`, so '5s' is a legal declared cadence, but it was never reviewed.
  //
  // ⚠️ Session windows are written in the canonical JSON form the seeder produces
  // (`['asian']`, `['london']`). Some live rows hold a bare `asian` string instead, which
  // the session parser also accepts — converging to the canonical form is deliberate.
  {
    name: 'Sydney AUDUSD Session',
    symbol: 'AUDUSD',

    magic: 234113,
    protocolId: 'forex-session-v1',
    brokerId: 'mt5',
    mode: 'auto',
    timeframe: '5m',
    baseSize: 0.01,
    slPct: 1,
    tpPct: 1,
    minComposite: 9,
    sessionWindow: ['asian'],
    maxHoldHours: 12,
    active: true,
    style: 'Session / Mean Reversion',
  },
  {
    name: 'Sydney AUDJPY Session',
    symbol: 'AUDJPY',

    magic: 234114,
    protocolId: 'forex-session-v1',
    brokerId: 'mt5',
    mode: 'auto',
    timeframe: '5m',
    baseSize: 0.01,
    slPct: 1,
    tpPct: 1,
    minComposite: 9,
    sessionWindow: 'all-hours',
    maxHoldHours: 12,
    active: true,
    style: 'Session / Mean Reversion',
  },
  {
    name: 'GBPUSD Session',
    symbol: 'GBPUSD',

    magic: 234115,
    protocolId: 'forex-session-v1',
    brokerId: 'mt5',
    mode: 'auto',
    timeframe: '5m',
    baseSize: 0.01,
    slPct: 1,
    tpPct: 1,
    minComposite: 9,
    sessionWindow: 'all-hours',
    maxHoldHours: 12,
    active: true,
    style: 'Session / Mean Reversion',
  },
  {
    name: 'London EURGBP Session',
    symbol: 'EURGBP',

    magic: 234116,
    protocolId: 'forex-session-v1',
    brokerId: 'mt5',
    mode: 'auto',
    timeframe: '5m',
    baseSize: 0.01,
    slPct: 1,
    tpPct: 1,
    minComposite: 9,
    sessionWindow: ['london'],
    maxHoldHours: 12,
    active: true,
    style: 'Session / Mean Reversion',
  },
  {
    name: 'London GBPJPY Session',
    symbol: 'GBPJPY',

    magic: 234117,
    protocolId: 'forex-session-v1',
    brokerId: 'mt5',
    mode: 'auto',
    timeframe: '5m',
    baseSize: 0.01,
    slPct: 1,
    tpPct: 1,
    minComposite: 9,
    sessionWindow: ['london'],
    maxHoldHours: 12,
    active: true,
    style: 'Session / Mean Reversion',
  },
  {
    name: 'Zurich EURCHF Session',
    symbol: 'EURCHF',

    magic: 234118,
    protocolId: 'forex-session-v1',
    brokerId: 'mt5',
    mode: 'auto',
    timeframe: '5m',
    baseSize: 0.01,
    slPct: 1,
    tpPct: 1,
    minComposite: 9,
    sessionWindow: 'all-hours',
    maxHoldHours: 12,
    active: true,
    style: 'Session / Mean Reversion',
  },
  {
    name: 'Zurich USDCHF Session',
    symbol: 'USDCHF',

    magic: 234119,
    protocolId: 'forex-session-v1',
    brokerId: 'mt5',
    mode: 'auto',
    timeframe: '5m',
    baseSize: 0.01,
    slPct: 1,
    tpPct: 1,
    minComposite: 9,
    sessionWindow: ['london'],
    maxHoldHours: 12,
    active: true,
    style: 'Session / Mean Reversion',
  },
  {
    name: 'Tokyo EURJPY Session',
    symbol: 'EURJPY',

    magic: 234120,
    protocolId: 'forex-session-v1',
    brokerId: 'mt5',
    mode: 'auto',
    timeframe: '5m',
    baseSize: 0.01,
    slPct: 1,
    tpPct: 1,
    minComposite: 9,
    sessionWindow: 'all-hours',
    maxHoldHours: 12,
    active: true,
    style: 'Session / Mean Reversion',
  },
  {
    name: 'Wellington NZDUSD Session',
    symbol: 'NZDUSD',

    magic: 234121,
    protocolId: 'forex-session-v1',
    brokerId: 'mt5',
    mode: 'auto',
    timeframe: '5m',
    baseSize: 0.01,
    slPct: 1,
    tpPct: 1,
    minComposite: 9,
    sessionWindow: ['asian'],
    maxHoldHours: 12,
    active: true,
    style: 'Session / Mean Reversion',
  },
  {
    name: 'Wellington NZDJPY Session',
    symbol: 'NZDJPY',

    magic: 234122,
    protocolId: 'forex-session-v1',
    brokerId: 'mt5',
    mode: 'auto',
    timeframe: '5m',
    // 0.1, not 0.01: NZDJPY's MetaQuotes floor is 0.1 (measured 2026-09-15). Every
    // other FX pair's floor is 0.01.
    baseSize: 0.1,
    slPct: 1,
    tpPct: 1,
    minComposite: 9,
    sessionWindow: 'all-hours',
    maxHoldHours: 12,
    active: true,
    style: 'Session / Mean Reversion',
  },
  {
    name: 'EURCAD Macro Session',
    symbol: 'EURCAD',

    magic: 234123,
    protocolId: 'forex-session-v1',
    brokerId: 'mt5',
    mode: 'auto',
    timeframe: '5m',
    baseSize: 0.01,
    slPct: 1,
    tpPct: 1,
    minComposite: 9,
    sessionWindow: 'all-hours',
    maxHoldHours: 12,
    active: true,
    style: 'Session / Mean Reversion',
    // ── THE ONE SEEDED ALLOCATION (#894) ────────────────────────────────────────────────────────
    //
    // This bot carries an allocation so the rating's risk condition is EXERCISABLE end to end:
    // with no value set anywhere, `realisedPct`/`maxDrawdownPct` are null for every bot and the
    // mechanism cannot be demonstrated or measured against live data at all.
    //
    // Why THIS bot: it holds the largest realised sample in the table (8 priced closes when this
    // was written), so it is the first that could ever reach the policy floor.
    //
    // Why 100: the same order as this bot's own numbers — `baseSize` 0.01 with a 1% stop, and
    // realised closes of roughly ±1 — so the percentages it produces are readable rather than
    // absurd. It is NOT a recommendation for any other bot: every other entry OMITS this key
    // deliberately, which the seeder treats as "no opinion", so an operator's value is never
    // overwritten. A guessed default applied to all 27 bots would rate them against a fiction.
    allocationAmount: 100,
  },
  {
    name: 'GBPCAD Macro Session',
    symbol: 'GBPCAD',

    magic: 234124,
    protocolId: 'forex-session-v1',
    brokerId: 'mt5',
    mode: 'auto',
    timeframe: '5m',
    baseSize: 0.01,
    slPct: 1,
    tpPct: 1,
    minComposite: 9,
    sessionWindow: 'all-hours',
    maxHoldHours: 12,
    active: true,
    style: 'Session / Mean Reversion',
  },
  {
    name: 'USDCAD Forex Session',
    symbol: 'USDCAD',

    magic: 234125,
    protocolId: 'forex-session-v1',
    brokerId: 'mt5',
    mode: 'auto',
    timeframe: '5s',
    baseSize: 0.01,
    slPct: 1,
    tpPct: 1,
    minComposite: 9,
    sessionWindow: 'all-hours',
    maxHoldHours: 12,
    active: true,
    style: 'Session / Mean Reversion',
  },
  {
    // A/B CONTROL — deliberately `manual` and `active: false`. It has NO
    // `strategy_protocol` subscription (see #833), which is the documented property of a
    // bot that can never receive a queued signal; here that is intended, but it should be
    // declared rather than discovered.
    name: 'Hourly Triple-Directive Control',
    symbol: 'EURUSD',

    magic: 234126,
    protocolId: 'hourly-3dir-v1',
    brokerId: 'mt5',
    mode: 'manual',
    timeframe: '1h',
    baseSize: 0.01,
    slPct: 1.5,
    tpPct: 3,
    minComposite: 9,
    sessionWindow: 'all-hours',
    maxHoldHours: 12,
    active: false,
  },

  // ════════════════════════════════════════════════════════════════════════════
  // CRYPTO — 24/7 coverage (#891) — ADDED 2026-09-19
  // ════════════════════════════════════════════════════════════════════════════
  //
  // ⚠️ THE LIBRARY'S `crypto-majors` ENTRY IS NOT THIS. That is a Strategy-Library
  // TEMPLATE (4 symbols, provider yahoo); a `trading_strategy` row is ONE symbol +
  // ONE protocol + a subscription. "Persist crypto-majors as a real bot" (#891
  // finding 2) therefore realises as per-symbol bots — BTC first, because
  // `btc-speed-v1` is the protocol that owns the weekend instrument: its
  // sentiment group carries the `crypto-weekend-effect` directive, and its
  // LONG_ONLY "Monitor / Position" style holds hours to days.
  //
  // `manual` IS THE FLOOR, NOT A PREFERENCE (2026-09-19). There is no crypto
  // execution path: the binance adapter fetches data but implements no
  // `placeOrder` (#891 finding 4), and the `BTC` symbol_route must NOT be handed
  // to MT5 as-is — `BTC` resolved against MT5 server symbols matches
  // `Nasdaq\ETF\BTC` (~$35.86), not Bitcoin. Auto dispatch is impossible anyway
  // (automation-loop Gate 2 skips every `mode !== 'auto'`), so this bot SCORES
  // and WAITS for the execution decision. Flip to 'auto' only once a
  // `brokerSymbol` route exists on a crypto-capable broker.
  {
    name: 'BTC Investment Monitor',
    symbol: 'BTC',

    magic: 234127,
    protocolId: 'btc-speed-v1',
    brokerId: 'mt5',
    mode: 'manual',
    timeframe: '1h',
    // ⚠️ 0.01 is UNVERIFIED for crypto — check the broker's volume floor when
    // execution lands (FTSE shipped 0.01 against a 0.1 floor and could never trade).
    baseSize: 0.01,
    slPct: 3.0,
    tpPct: 6.0,
    // Seeded target for btc-speed-v1 after the 2026-09-15 rescale
    // (inspect-scoring-strategy-thresholds.cjs: SEEDED['btc-speed-v1'] = 10).
    minComposite: 10,
    // 24/7 — ungated. session-window.ts maps 'always'/'24-7' to null, and this is
    // the only instrument that trades when FX is closed.
    sessionWindow: 'all-hours',
    // btc-speed-v1 is LONG_ONLY — declared so the subscription role comes from a
    // statement rather than the protocol-name heuristic.
    requireDirection: 'BUY',
    style: 'Monitor / Position',
  },

  // ── Tech Giants — US cash session (2026-09-23) ────────────────────────────────────────────
  //
  // Owner request: "get the tech giants in a Tech Giants watchlist, registered with a suitable
  // protocol and bot … ready to trade on installation."
  //
  // The pieces, and what each one already had:
  //   watchlist  `src/data/watchlists/tech-giants.json` — NEW; picked up by seed-watchlists.ts,
  //              which reads every JSON in that directory. No seeder change was needed.
  //   protocol   `momentum-stock-v1` — ALREADY existed and already names NVDA in its `idealFor`.
  //              It was seeded INACTIVE, so nothing could use it. Now declares `active: true`.
  //   bot        these entries — one per symbol, because `trading_strategy.symbol` is what
  //              SCOPES ROUTING (`signal-queue.service.ts` only writes a queue entry whose
  //              symbol matches), so a single bot cannot cover a watchlist.
  //
  // ⚠️ ONE BOT PER SYMBOL IS NOT A PREFERENCE — it is how routing works today.
  //
  // ⚠️ `baseSize: 1` IS THE BROKER FLOOR, NOT A PREFERENCE. Measured 2026-09-23 against the live
  // bridge: MetaQuotes reports `volumeMin 1` for NVDA / AAPL / TSLA. Equities are quoted PER
  // SHARE, not per lot, so the FX-style 0.01 makes the order IMPOSSIBLE — the identical defect
  // that left the FTSE bot unable to trade (0.01 against a 0.1 floor). Check the floor before
  // changing this.
  //
  // ⚠️ `sessionWindow: ['us']` IS DECLARED, NOT NULL. A NULL window means "ungated", which is
  // indistinguishable from "nobody filled it in" (#982) — the fault that let three bots named
  // for a session trade outside it. US cash session = 13:30–20:00 UTC.
  //
  // ⚠️ `requireDirection: 'BUY'` — `momentum-stock-v1` is LONG_ONLY. Declared so the
  // subscription role comes from a statement rather than the protocol-name heuristic.
  //
  // ⚠️ `maxHoldHours: 24` — a slot-releasing control (#773). With `maxPositions` effectively one
  // per bot, an unbounded equity hold blocks the symbol for as long as it lasts.
  //
  // ⚠️ NOT VERIFIED YET: whether these symbols can actually be PRICED by the scoring path.
  // `symbol_route` has no row for any of them, so they resolve to the PRIMARY broker
  // (MetaQuotes), which is the correct one — it is the only bridge that quotes them. That is
  // deliberate, not an omission. See the note on ordering in the handoff.
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
  },
  {
    name: 'Tech Giants - MSFT',
    symbol: 'MSFT',

    magic: 234129,
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
  },
  {
    name: 'Tech Giants - AAPL',
    symbol: 'AAPL',

    magic: 234130,
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
  },
  {
    name: 'Tech Giants - AMZN',
    symbol: 'AMZN',

    magic: 234131,
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
  },
  {
    name: 'Tech Giants - GOOGL',
    symbol: 'GOOGL',

    magic: 234132,
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
  },
  {
    name: 'Tech Giants - TSLA',
    symbol: 'TSLA',

    magic: 234133,
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
  },
  {
    name: 'Tech Giants - AVGO',
    symbol: 'AVGO',

    magic: 234134,
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
  },
];
