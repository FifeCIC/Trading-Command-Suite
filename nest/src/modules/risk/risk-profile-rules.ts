/**
 * risk-profile-rules.ts — THE RISK CAPS, declared once.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS (2026-09-17)
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * `bot-rules.ts` declares every behavioural column on `trading_strategy`. It does NOT cover the
 * **six constants in the `PortfolioRisk` object literals** that a bot's behaviour also depends on —
 * and those constants are copied into FOUR files with no declaration anywhere:
 *
 *   measured 2026-09-17
 *     `maxPerSymbol: 0.25`   literal in 5 places (risk.controller ×3, trading-strategy.interface,
 *                            trading-strategy.service) plus 2 more in the service interface
 *     `maxDrawdown: 0.25`    same 5 places
 *     `maxPortfolioRisk: 0.15`, `maxPerTradeRisk: 0.02`, `trailingStopAtProfit: 0.03` — same again
 *     `trading-strategy.interface.ts` is imported by NOTHING (its only mention is a comment in
 *                            position-time-stop.service.ts), so its defaults are dead but look live
 *
 * This is the same defect class as the 8 unenforced bot columns, and it cost 78 blocked trades
 * before anyone saw it: the largest entry blocker that day was
 * `Allocation 62.7% exceeds max per symbol 25%`, and **no setting could change the 25%**.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * THE RULE THIS FILE ESTABLISHES
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * > **Every key of `PortfolioRisk` must be declared here, with its enforcement status AND the
 * > settings key that backs it. A constant that can stop a live trade must be backed by a setting,
 * > because a risk cap an operator cannot move is a cap that will be worked around instead.**
 *
 * Enforced by `nest/scripts/validate-risk-profile.cjs` (runs in `prebuild`). Adding a key to
 * `PortfolioRisk` without declaring it here is a build error that NAMES the key.
 *
 * ⚠️ **What the build check can and cannot prove.** It proves every key is declared, that each
 * `enforcedBy` file exists and references the field, and that no constant is re-spelled as a literal
 * outside this file. It does NOT prove the *value* is right, or that the number feeding it was
 * computed correctly — that is #865, and it is a maths problem a static check cannot see.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * THE AXIS THAT MATTERS: can an operator move it, and does it actually stop a trade
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * `enforcement` reuses the SAME vocabulary as `bot-rules.ts` (imported, not re-declared — two
 * spellings of one idea is how the meanings drift apart):
 *
 *   | enforcement    | means                                                          |
 *   |----------------|----------------------------------------------------------------|
 *   | `live`         | can block a trade on the live path (`assessGlobalRiskLimits`)  |
 *   | `legacy-only`  | applied only on a manual/API path, never by the automation loop|
 *   | `display-only` | returned in a response; cannot affect a trade                  |
 *   | `none`         | no reader anywhere                                             |
 *
 * `settingKey` is the second axis, and the one this file adds: **`enforcement: 'live'` with
 * `settingKey: null` FAILS THE BUILD.** That single rule would have surfaced this defect on the day
 * the cap was written.
 */

import type { PortfolioRisk } from './risk.service';
// One vocabulary. See bot-rules.ts for the full explanation of the four values.
import type { Enforcement } from '../trading/bot-rules';

export interface RiskConstantRule {
  /** The `PortfolioRisk` key this rule declares. */
  field: string;
  label: string;
  enforcement: Enforcement;
  /**
   * Where the constant is consumed. `null` when `enforcement` is `none`.
   * Checked by the validator: the file must exist AND reference `field`.
   */
  enforcedBy: string | null;
  /**
   * The `settings-registry.ts` key backing this constant, or `null` if it is hardcoded.
   * ⚠️ `null` on a `live` constant is a build failure — see the rule in the file header.
   */
  settingKey: string | null;
  /** The value in force today. For a settings-backed constant this MUST equal the setting default. */
  defaultValue: number | boolean;
  summary: string;
  /** ⚠️ What a reader must know — especially when enforcement is not `live`. */
  caveat?: string;
}

export const RISK_CONSTANT_RULES: RiskConstantRule[] = [
  // ── live — these can refuse a real order ───────────────────────────────────────────────────
  {
    field: 'maxPerSymbol',
    label: 'Max per symbol',
    enforcement: 'live',
    enforcedBy: 'nest/src/modules/risk/risk.service.ts',
    settingKey: 'risk.maxPerSymbol',
    defaultValue: 0.25,
    summary:
      'Ceiling on the TOTAL exposure to one symbol — positions already open PLUS this order — as ' +
      'a fraction of portfolio value. Blocks the order in canOpenPosition().',
    caveat:
      '⚠️ TWO READERS: checkMaxAllocation() only LOGS A WARNING, canOpenPosition() BLOCKS. Both ' +
      'now measure the same quantity (existing symbol exposure + new order, #899) so they can no ' +
      'longer disagree in ARITHMETIC — but the warning is still not the rule. In September 2026 ' +
      'this was the largest single entry blocker (78 trades/day) and no setting could move it ' +
      '(#865). ⚠️ Until #899 (2026-09-19) the cap measured ONE ORDER, not the symbol: three bots ' +
      'at 20% each put 60% on one instrument while every check passed.',
  },
  {
    field: 'maxDrawdown',
    label: 'Max drawdown',
    enforcement: 'live',
    enforcedBy: 'nest/src/modules/risk/risk.service.ts',
    settingKey: 'risk.maxDrawdown',
    defaultValue: 0.25,
    summary: 'Peak-to-current fall in equity that stops further order placement. Blocks via checkDrawdown().',
    caveat:
      '⚠️ The peak is IN-MEMORY and only ever increases, so a bad reading becomes a permanent ' +
      'high-water mark until the process restarts. That is exactly how a fabricated $10,000 seed ' +
      'blocked every trade for hours on 2026-09-16 (#848) — the guard for that is the `null` check ' +
      'in assessGlobalRiskLimits(), which must not be removed.',
  },
  {
    field: 'maxPositions',
    label: 'Max positions',
    enforcement: 'live',
    enforcedBy: 'nest/src/modules/risk/risk.service.ts',
    settingKey: 'risk.maxOpenPositions',
    defaultValue: 5,
    summary: 'Concurrent position ceiling, read from settings and passed into the profile.',
    caveat:
      '✅ The one constant that was ALREADY settings-backed, and the proof the pattern works: a live ' +
      'PUT on risk.maxOpenPositions changes the next decision with no restart. Broker-wide, not ' +
      'per-bot — see the per-bot `maxPositions` column, which is legacy-only.',
  },

  // ── enforced, but only off the live path ───────────────────────────────────────────────────
  {
    field: 'maxPerTradeRisk',
    label: 'Max per-trade risk',
    enforcement: 'legacy-only',
    enforcedBy: 'nest/src/modules/risk/risk.service.ts',
    settingKey: null,
    defaultValue: 0.02,
    summary: 'Capital-at-risk fraction used by calculatePositionSize() (risk-based and Kelly sizing).',
    caveat:
      '⚠️ calculatePositionSize() is reachable ONLY from risk.controller.ts, so this constant shapes ' +
      'a sizing request made by hand and never the automation loop. Note it also FLOORS to a whole ' +
      'share (`Math.floor`), which is meaningless for FX volume.',
  },

  // ── declared, no reader ────────────────────────────────────────────────────────────────────
  {
    field: 'maxPortfolioRisk',
    label: 'Max portfolio risk',
    enforcement: 'live',
    enforcedBy: 'nest/src/modules/trading/trading-strategy.service.ts',
    settingKey: 'risk.maxPortfolioRisk',
    // ⚠️ 0.15 → 0.20 on 2026-10-13 (owner decision, R47/R57). Measured: the cap refused **601**
    // entry attempts in one day, 97% of all blocks, because ONE minimum-lot XAUUSD position risks
    // 12.2% of a £718 account — the MT5 floor (0.01 lot) cannot be sized smaller, so a 15% cap can
    // only ever hold that one trade. Effect of the raise, measured: portfolio-cap refusals **601 → 0**
    // and a trade executed 45s after the change. Kept in step with
    // `settings-registry.ts`'s declared default, because a database-only change is lost on reinstall.
    // ⚠️ Written as `0.2`, NOT `0.20` — see the note in `settings-registry.ts`.
    defaultValue: 0.2,
    summary:
      'Total portfolio fraction at risk if every open position’s stop filled — Σ |entry − SL| × ' +
      'volume × contractSize across the book. Blocks a new order while the book exceeds it.',
    caveat:
      '⚠️ WIRED 2026-09-19 (#900) — before that it was declared with NO READER ANYWHERE. The ' +
      'loss figure depends on definitions: this uses “risk if every stop fills” (the conventional ' +
      'reading), NOT peak-to-current equity (that is maxDrawdown) and NOT margin committed. ' +
      'Naked positions (no broker SL) are priced at FULL NOTIONAL — materially larger, so the ' +
      'requireBrokerStopLoss rule below should normally refuse them first.',
  },
  {
    field: 'requireBrokerStopLoss',
    label: 'Require broker stop loss',
    enforcement: 'live',
    enforcedBy: 'nest/src/modules/trading/trading-strategy.service.ts',
    settingKey: 'risk.requireBrokerStopLoss',
    defaultValue: true,
    summary:
      'Refuse a new order while any open position carries no broker-side stop loss (SL 0). ' +
      'docs/trading-bot-model.md §6b: every position must ALWAYS carry a broker protective stop.',
    caveat:
      '⚠️ Not a PortfolioRisk key — a portfolio POLICY flag, declared here so the build gate sees ' +
      'that it is real and operator-movable (validator: POLICY_FIELDS). The invariant it checks ' +
      'was asserted at order-building and never verified afterwards; the gate now verifies it on ' +
      'every entry against every open position (#900).',
  },
  {
    field: 'trailingStopAtProfit',
    label: 'Trailing stop activation',
    enforcement: 'none',
    enforcedBy: null,
    settingKey: null,
    defaultValue: 0.03,
    summary:
      'NOT IMPLEMENTED — the profit at which the stop WOULD begin to trail if it were wired through ' +
      'the Stop Guardian. The setting is documentation, not a control.',
    caveat:
      '⚠️ RETIRED AS A DUPLICATE MECHANISM (2026-09-21, #913). Its only consumer, ' +
      '`updateTrailingStop()`, was DELETED with this change — it had zero callers (not even its own ' +
      'spec) while this register described a trailing stop that nothing armed. Post-entry stop ' +
      'management has ONE implementation: `StopGuardianService` (#721), which trails open positions ' +
      'on directive consensus every pass and records every move in `stop_adjustment` (129 rows ' +
      'when this was written). The field stays declared so the profile shape is complete; if it is ' +
      'ever to become real it must be wired THROUGH the guardian as its activation threshold — ' +
      'never as a second trailing implementation.',
  },
];

/** Constants that can refuse a live order. */
export const LIVE_RISK_CONSTANTS = RISK_CONSTANT_RULES.filter((r) => r.enforcement === 'live');

/** Constants a reader might reasonably assume are protecting them, but are not. */
export const NOT_LIVE_RISK_CONSTANTS = RISK_CONSTANT_RULES.filter((r) => r.enforcement !== 'live');

/** Counts for a UI badge or a log line. */
export function riskEnforcementCounts() {
  return RISK_CONSTANT_RULES.reduce<Record<string, number>>((acc, r) => {
    acc[r.enforcement] = (acc[r.enforcement] ?? 0) + 1;
    return acc;
  }, {});
}

/**
 * buildRiskProfile() — THE ONLY PLACE a `PortfolioRisk` literal may be constructed.
 *
 * Before this existed the same six-key object was hand-written in four files, so a change to one
 * cap could — and did — leave the others behind. The validator forbids `maxPerSymbol: <number>`
 * outside this file, which makes "there is one copy" a build-enforced fact rather than a habit.
 *
 * ⚠️ Callers must pass EVERY live value from `SettingsResolverService`. Do not default a parameter
 * here: a `?? 0.25` in this function would silently restore the hardcoded cap the whole change
 * removes, and it would do so invisibly. Missing values must be a compile error (they are — all
 * four are required).
 */
export function buildRiskProfile(values: {
  /** From `risk.maxOpenPositions`. */
  maxOpenPositions: number;
  /** From `risk.maxPerSymbol`. */
  maxPerSymbol: number;
  /** From `risk.maxDrawdown`. */
  maxDrawdown: number;
  /** From `risk.maxPortfolioRisk` — live since #900 (2026-09-19). */
  maxPortfolioRisk: number;
}): PortfolioRisk {
  // ⚠️ FAIL LOUDLY ON AN UNREADABLE CAP — this is not a defensive nicety, it is the difference
  // between a gate that is ON and a gate that is SILENTLY OFF.
  //
  // `allocation > undefined` evaluates to `false`, and `drawdown >= undefined` is also `false`. So a
  // cap that arrives as `undefined` does not trip the check — it DISABLES it, with no error, no log
  // line, and output that looks like a normal permit. Measured 2026-09-17: a test fixture missing
  // two keys made the drawdown gate stop blocking entirely, and the only reason it was noticed is
  // that a test asserted the gate still fires.
  //
  // Callers that must not throw (the automation loop) should catch this and refuse the trade with a
  // named reason rather than trade without a cap. See assessGlobalRiskLimits().
  for (const [key, value] of Object.entries(values)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(
        `buildRiskProfile: '${key}' is ${String(value)} — refusing to build a risk profile from an ` +
          'unreadable cap. A missing cap does not block the check, it disables it.',
      );
    }
  }

  const byField = new Map(RISK_CONSTANT_RULES.map((r) => [r.field, r]));
  return {
    // Live since #900 — real setting value, not a carried default.
    maxPortfolioRisk: values.maxPortfolioRisk,
    // Declared but unread — carried at their declared default so the shape stays complete and the
    // count of live constants does not silently change.
    maxPerTradeRisk: byField.get('maxPerTradeRisk')!.defaultValue as number,
    maxPerSymbol: values.maxPerSymbol,
    maxPositions: values.maxOpenPositions,
    maxDrawdown: values.maxDrawdown,
    trailingStopAtProfit: byField.get('trailingStopAtProfit')!.defaultValue as number,
  };
}
