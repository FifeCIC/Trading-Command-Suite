/**
 * bot-rules.ts — WHAT A BOT IS, declared once.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS (2026-09-17)
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * A bot is a row in `trading_strategy`: 29 behavioural columns interpreted by straight-line `if`
 * chains in `automation-loop.service.ts`, plus a SECOND set of the same rules in the retired
 * `TradingStrategyService.execute()` legacy path. Measured that day:
 *
 *   - **7 rules are implemented 2–4 times** in different files and disagree (max positions ×3,
 *     entry threshold ×3, cooldown ×4, duplicate guard ×2, daily loss ×2, session window ×2,
 *     trailing stop ×2).
 *   - **8 of the columns are enforced NOWHERE** on the live path, yet the create form still offers
 *     them (`hotStock*` ×4 on two tables, `minRarityBand`, `maxSize`, `useRaritySizing`,
 *     `maxDailyLoss`, per-bot `maxPositions`).
 *   - `strategy_protocol.role` was not even SELECTed by the routing query, so a `role: 'short'`
 *     bot received long signals. `requireDirection` was likewise unread.
 *
 * The create form therefore made promises the engine did not keep, and **nothing failed** when
 * they diverged. That is the same defect class as the time-stop parsing a comment format nothing
 * emits, and `trade.scoringStrategyId` holding a bot id: **plausible configuration, no error, wrong
 * behaviour underneath.**
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * THE RULE THIS FILE ESTABLISHES
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * > **Every behavioural column on `trading_strategy` must be declared here, with its enforcement
 * > status.** A column with no declaration fails the build.
 *
 * Enforced by `nest/scripts/validate-bot-rules.cjs` (runs in `prebuild`). Adding a column to
 * `schema.prisma` without declaring it here is now a build error that NAMES the column — so
 * "declared but not enforced" becomes a visible, reviewable decision instead of an accident.
 *
 * ⚠️ **What the build check can and cannot prove.** It proves every column has a declaration and
 * that each `enforcedBy` file exists and references the field. It does NOT prove the field is
 * *reachable at runtime* — read `enforcement` and the `caveat` before trusting a rule. A static
 * check is a floor, not a guarantee.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * THE AXIS THAT MATTERS: ENFORCEMENT, NOT EXISTENCE
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * The question is never "does this field exist". It is "can this field change a trade?":
 *
 *   | enforcement     | meaning                                                          |
 *   |-----------------|------------------------------------------------------------------|
 *   | `live`          | can block or shape a trade on the live queue path                 |
 *   | `legacy-only`   | enforced, but ONLY on `POST /strategies/:id/execute` — the two    |
 *   |                 | paths DISAGREE, so a UI action can behave differently to the loop |
 *   | `display-only`  | read and returned/serialised, but cannot affect a trade           |
 *   | `none`          | no reader anywhere                                                |
 *
 * `display-only` is the subtle one and the reason this file exists: `timeframe` and
 * `shortProtocolId` ARE read — for readiness display and protocol-page filtering — but neither can
 * stop a trade. Treating "it is read" as "it is applied" is how a config surface starts lying.
 */

/** Where in a trade's life a rule acts. A rule that cannot name its stage cannot be reasoned about. */
export type RuleStage =
  | 'identity'
  | 'scope'
  | 'routing'
  | 'entry'
  | 'sizing'
  | 'exit'
  | 'risk';

/** See the table in the file header. This is the field that decides whether a rule is real. */
export type Enforcement = 'live' | 'legacy-only' | 'display-only' | 'none';

export interface BotRule {
  /** The `trading_strategy` column this rule is driven by. */
  field: string;
  label: string;
  stage: RuleStage;
  enforcement: Enforcement;
  /**
   * Where the rule is applied. `null` when `enforcement` is `none`.
   * Checked by the validator: the file must exist AND reference `field`.
   */
  enforcedBy: string | null;
  /** One line: what the field does, when it works. */
  summary: string;
  /** ⚠️ What a reader must know — especially when enforcement is not `live`. */
  caveat?: string;
}

/**
 * Columns that are NOT behavioural — structure and bookkeeping only.
 * Anything not in this list AND not in `BOT_RULES` fails the build.
 */
// A/B pair lineage (2026-09-22): `duplicatedFromId` names the bot this one was copied from,
// written by POST /api/trading/strategies/:id/duplicate. Identity metadata — no trade path
// reads it, so it cannot shape a trade.
// ⚠️ Keep this array on ONE line, quoted, with no comments inside: validate-bot-rules.cjs reads
// it with a regex and splits on commas — prose in here parses as a column name and the gate
// then fails claiming the real column is undeclared.
/**
 * `magic` is NON-BEHAVIOURAL (#1018), and the distinction is the point: it ATTRIBUTES a position to
 * the bot that opened it, it does not SHAPE one. Nothing reads it to size, gate, time or stop
 * anything, and the broker never interprets it. So it belongs here rather than as a rule.
 *
 * ⚠️ THIS ARRAY MUST STAY A SIMPLE COMMA-SEPARATED LIST OF QUOTED STRINGS. `validate-bot-rules.cjs`
 * parses it with `.split(',').replace(/['"]/g, '')`, so a comma or an apostrophe anywhere inside —
 * including in a comment — silently produces garbage entries instead of the names. Measured
 * 2026-09-28: an explanatory comment placed INSIDE the brackets made `magic` parse as part of a
 * comment fragment, and the build failed with `columns=40 declared=35` even though the name was
 * visibly present. The reasoning lives out here for that reason, not for style.
 *
 * ⚠️ And `magic` was added because the guard FAILED the build the moment the column existed — which
 * is the guard working correctly: a new column cannot arrive undeclared, and the choice between "a
 * real rule someone must own" and "not behavioural" has to be made deliberately, not by omission.
 */
export const NON_BEHAVIOURAL_COLUMNS = ['id', 'createdAt', 'updatedAt', 'duplicatedFromId', 'magic'] as const;

export const BOT_RULES: BotRule[] = [
  // ── identity ───────────────────────────────────────────────────────────────────────────────
  { field: 'name', label: 'Name', stage: 'identity', enforcement: 'display-only', enforcedBy: null,
    summary: 'Display label, and the MT5 order comment body (`TCS <name>`).' },
  { field: 'description', label: 'Description', stage: 'identity', enforcement: 'display-only', enforcedBy: null,
    summary: 'Free text for humans.' },
  { field: 'version', label: 'Version', stage: 'identity', enforcement: 'display-only', enforcedBy: null,
    summary: 'Semver tag used by the A/B snapshot machinery (#295).' },

  // ── scope ──────────────────────────────────────────────────────────────────────────────────
  { field: 'symbol', label: 'Symbol', stage: 'scope', enforcement: 'live',
    enforcedBy: 'nest/src/modules/signals/signal-queue.service.ts',
    summary: 'Scopes the bot: routing only writes a queue entry whose symbol matches.' },
  { field: 'brokerId', label: 'Broker', stage: 'scope', enforcement: 'live',
    enforcedBy: 'nest/src/modules/automation/automation-loop.service.ts',
    summary: 'Chooses the adapter the order is dispatched to.' },
  { field: 'timeframe', label: 'Timeframe', stage: 'scope', enforcement: 'display-only',
    enforcedBy: 'nest/src/modules/trading/trading-strategy.service.ts',
    summary: 'Surfaced on the bot list.',
    caveat:
      '⚠️ NOT used for gating. Data readiness compares the PROTOCOL declared timeframe ' +
      '(automation-loop readiness annotation), so a bot whose timeframe disagrees with its protocol ' +
      'is read as ready on the protocol cadence. Label-only until wired.' },

  // ── routing ─────────────────────────────────────────────────────────────────────────────────
  { field: 'protocolId', label: 'Protocol', stage: 'routing', enforcement: 'display-only',
    enforcedBy: 'nest/src/modules/trading/trading-strategy.service.ts',
    summary: 'Legacy single protocol link; seeds one subscription and is used for the bot label.' },
  { field: 'shortProtocolId', label: 'Short protocol', stage: 'routing', enforcement: 'display-only',
    enforcedBy: 'nest/src/modules/scoring/protocols.controller.ts',
    summary: 'Legacy second link; the protocol list and symbol pages filter on it.',
    caveat:
      '⚠️ Read for DISPLAY and filtering, never for routing. Signal routing uses `strategy_protocol` ' +
      'subscriptions. A bot with shortProtocolId set but no matching subscription trades nothing — ' +
      'silently.' },
  { field: 'scoringStrategyId', label: 'Scoring strategy link', stage: 'routing', enforcement: 'display-only',
    enforcedBy: 'nest/src/modules/scoring/metastack-versioning.service.ts',
    summary: 'Soft link to `scoring_strategy` for snapshots and performance attribution.',
    caveat:
      "⚠️ Not the same thing as `trade.scoringStrategyId`, which is a BOT id (measured 0/31 matches " +
      'against `scoring_strategy.id`). See the handoff for #777.' },
  { field: 'active', label: 'Active', stage: 'routing', enforcement: 'live',
    enforcedBy: 'nest/src/modules/signals/signal-queue.service.ts',
    summary: 'Kill switch: routing joins `WHERE ts.active = 1`, so an inactive bot gets no queue entries.' },
  { field: 'mode', label: 'Mode', stage: 'routing', enforcement: 'live',
    enforcedBy: 'nest/src/modules/automation/automation-loop.service.ts',
    summary: "Gate 2 — only `auto` bots dispatch automatically; manual/semi-auto wait for the UI." },
  { field: 'requireDirection', label: 'Direction', stage: 'routing', enforcement: 'live',
    enforcedBy: 'nest/src/common/utils/signal-direction.ts',
    summary: "Bot-level direction permission, used when the subscription's `role` is silent.",
    caveat:
      '⚠️ `role` on `strategy_protocol` takes precedence. It was unread until 2026-09-17, when a ' +
      'SHORT_ONLY VIX bot had no direction constraint on the live path at all.' },

  // ── entry ──────────────────────────────────────────────────────────────────────────────────
  { field: 'minComposite', label: 'Entry bar', stage: 'entry', enforcement: 'live',
    enforcedBy: 'nest/src/modules/automation/automation-loop.service.ts',
    summary: 'Gate 4 — a queued signal below this composite is skipped.',
    caveat:
      '⚠️ Must equal `BOT_BAR_DEFAULT`. A default of 65 survived the ADR-011 rescale and produced ' +
      'bots that could never fire (#839).' },
  { field: 'minRarityBand', label: 'Minimum rarity band', stage: 'entry', enforcement: 'legacy-only',
    enforcedBy: 'nest/src/modules/trading/trading-strategy.service.ts',
    summary: 'Rejects signals below a rarity band.',
    caveat:
      '⚠️ Enforced only on the legacy `execute()` path. The live queue path does NOT apply it, so ' +
      'this field cannot stop a live trade despite being offered in the create form.' },
  { field: 'cooldownMinutes', label: 'Cooldown', stage: 'entry', enforcement: 'live',
    enforcedBy: 'nest/src/modules/automation/automation-loop.service.ts',
    summary: 'Gate 6 — minimum minutes between this bot taking signals.',
    caveat: '⚠️ One of FOUR cooldowns (bot, global pacing, dispatch 3s, dispatch 60s/symbol).' },
  { field: 'sessionWindow', label: 'Session window', stage: 'entry', enforcement: 'live',
    enforcedBy: 'nest/src/modules/trading/session-window.ts',
    summary: 'Gate 5 — tags (asian/london/us) the bot may act in. NULL = ungated (opt-in).' },
  { field: 'maxPyramidTiers', label: 'Max pyramid tiers', stage: 'entry', enforcement: 'live',
    enforcedBy: 'nest/src/modules/trading/pyramid-policy.service.ts',
    summary: 'Scale-in cap: extra entries allowed when price is favourable. 1 = never add.' },

  // ── sizing ─────────────────────────────────────────────────────────────────────────────────
  { field: 'baseSize', label: 'Base size', stage: 'sizing', enforcement: 'live',
    enforcedBy: 'nest/src/modules/automation/automation-loop.service.ts',
    summary: 'Order volume before any risk cap is applied.' },
  { field: 'useRaritySizing', label: 'Rarity sizing', stage: 'sizing', enforcement: 'legacy-only',
    enforcedBy: 'nest/src/modules/trading/trading-strategy.service.ts',
    summary: 'Scales size by signal rarity.',
    caveat: '⚠️ Legacy path only — the live queue path sizes from `baseSize` without a rarity scalar.' },
  { field: 'maxSize', label: 'Max size', stage: 'sizing', enforcement: 'legacy-only',
    enforcedBy: 'nest/src/modules/trading/trading-strategy.service.ts',
    summary: 'Caps the sized volume.',
    caveat:
      '⚠️ Legacy path only. The live cap is the GLOBAL `risk.maxPositionSize` setting, so a per-bot ' +
      'maxSize is not applied to live trades.' },

  // ── risk ───────────────────────────────────────────────────────────────────────────────────
  { field: 'maxPositions', label: 'Max positions', stage: 'risk', enforcement: 'legacy-only',
    enforcedBy: 'nest/src/modules/trading/trading-strategy.service.ts',
    summary: 'Per-bot concurrent position cap.',
    caveat:
      '⚠️ Legacy path only. The live cap is the GLOBAL `risk.maxOpenPositions` (default 5, ' +
      'broker-wide). This rule therefore exists in THREE places and only one is live.' },
  { field: 'maxDailyLoss', label: 'Max daily loss', stage: 'risk', enforcement: 'legacy-only',
    enforcedBy: 'nest/src/modules/trading/trading-strategy.service.ts',
    summary: 'Per-bot realised-loss stop for the trading day.',
    caveat: '⚠️ Legacy path only. The live stop is the GLOBAL `risk.maxDailyLoss` setting.' },

  { field: 'allocationAmount', label: 'Capital allocation', stage: 'risk', enforcement: 'display-only',
    enforcedBy: 'nest/src/modules/trading/bot-performance.service.ts',
    summary:
      'Capital this bot may use, in account currency — the denominator for its realised return ' +
      'and drawdown percentages.',
    caveat:
      '⚠️ It cannot shape a trade today. It is read by the RATING gate (#894), which is what makes ' +
      'a drawdown PERCENTAGE computable at all: with no allocation the risk condition has no base ' +
      'and the rating is withheld as `allocation_not_set`. There is deliberately NO default — a ' +
      'guessed amount would rate every bot against a fiction. The rating is meant to UNLOCK risk ' +
      '(#773); when it does, this becomes trade-shaping and that change needs an A/B copy, not an ' +
      'edit (maths-change-requires-ab).' },

  // ── exit ───────────────────────────────────────────────────────────────────────────────────
  { field: 'slPct', label: 'Stop loss %', stage: 'exit', enforcement: 'live',
    enforcedBy: 'nest/src/modules/automation/automation-loop.service.ts',
    summary: 'Initial stop, computed and sent to the broker with the order.' },
  { field: 'tpPct', label: 'Take profit %', stage: 'exit', enforcement: 'live',
    enforcedBy: 'nest/src/modules/automation/automation-loop.service.ts',
    summary: 'Initial target, sent to the broker with the order.',
    caveat:
      '⚠️ Measured: winners on forex-session-v1 exited at +0.02–0.15% against a tpPct of 1.0, while ' +
      'losers reached the full stop. Something closes winners long before target — unexplained.' },
  { field: 'maxHoldHours', label: 'Max hold (time stop)', stage: 'exit', enforcement: 'live',
    enforcedBy: 'nest/src/modules/automation/position-time-stop.service.ts',
    summary: 'Closes a position held longer than this. NULL = no limit (opt-in).',
    caveat:
      '⚠️ Was inert until 2026-09-17: it parsed an order-comment format nothing emits (0 of 76) and ' +
      'defaulted to dry-run. Now armed; no live close observed yet.' },

  // ── the DECISION MOMENT (#936, R20=A 2026-09-24) ────────────────────────────────────────────
  // ⚠️ `display-only` IS THE HONEST STATUS, not a placeholder. A reader exists and runs each
  // tick, so this is NOT `none` — but it places no order and moves no stop, so it is NOT `live`
  // either. It explains a trade; it does not shape one. Promotion to trade-shaping is a maths
  // change and needs an A/B copy, which #929 currently blocks.
  { field: 'simTslEnabled', label: 'Simulated TSL', stage: 'exit', enforcement: 'display-only',
    enforcedBy: 'nest/src/modules/automation/stop-guardian.service.ts',
    summary:
      'Arms a second, TIGHTER threshold that is NEVER sent to the broker. Touching it is a ' +
      'DECISION MOMENT — may close, may hold, may tighten further — recorded in `sim_tsl_event`.',
    caveat:
      '⚠️ Default OFF, and it only OBSERVES. No order is placed and no stop is moved from this ' +
      'path, so it cannot lock in profit yet; it records that the moment occurred so it becomes ' +
      'measurable.' },
  { field: 'simTslActivationPct', label: 'Sim-TSL activation %', stage: 'exit', enforcement: 'display-only',
    enforcedBy: 'nest/src/modules/automation/stop-guardian.service.ts',
    summary: 'Profit % at which the simulated threshold arms. NULL = not configured.',
    caveat: '⚠️ Arms nothing unless `simTslEnabled` is on AND this is set.' },
  { field: 'simTslDistancePct', label: 'Sim-TSL trail distance %', stage: 'exit', enforcement: 'display-only',
    enforcedBy: 'nest/src/modules/automation/stop-guardian.service.ts',
    summary: 'The tighter trail distance, measured back from the best price reached. NULL = not configured.',
    caveat: '⚠️ Never sent to the broker — the declared stop remains the real risk.' },

  // #995 — the UP-move exhaustion OBSERVER. `display-only` for the same reason as `simTslEnabled`
  // above: the guardian READS it every tick, so it is not `none` — but it places no order and moves
  // no stop, so it is not `live` either. It records that a move was decelerating, which is what
  // makes the theory (`upside-exhaustion-predicts-giveback`, status `testing`) falsifiable.
  { field: 'exhaustionObserveEnabled', label: 'Exhaustion observer', stage: 'exit', enforcement: 'display-only',
    enforcedBy: 'nest/src/modules/automation/stop-guardian.service.ts',
    summary:
      'Watches an OPEN position for a move DECELERATING into a new extreme — price still at the ' +
      'window high, but advancing less over the last bars than over the bars before them. Firings ' +
      'are recorded in `exhaustion_event`.',
    caveat:
      '⚠️ Default OFF, and it only OBSERVES — no order and no stop move from this path. ⚠️ It is the ' +
      'mirror of the direction the app lacked: both existing exhaustion directives are `bullish` ' +
      'ENTRY signals ("the down-move is exhausting"). ⚠️ It needs BARS, so unlike sim-TSL it cannot ' +
      'run before the bar load and is SILENT while the feed is short.' },
  { field: 'exhaustionDecelPct', label: 'Exhaustion deceleration %', stage: 'exit', enforcement: 'display-only',
    enforcedBy: 'nest/src/modules/automation/stop-guardian.service.ts',
    summary:
      'How far recent progress must fall below prior progress before the move counts as ' +
      'decelerating. NULL = not configured.',
    caveat:
      '⚠️ Deliberately NO default: a guessed threshold would record firings against a number nobody ' +
      'chose, which is evidence for a fiction. Arms nothing unless `exhaustionObserveEnabled` is on ' +
      'AND this is set.' },

  // ── declared but enforced nowhere ──────────────────────────────────────────────────────────
  { field: 'hotStockEnabled', label: 'Hot stock enabled', stage: 'sizing', enforcement: 'none', enforcedBy: null,
    summary: 'Declared for the #339 Hot Stock Picks integration.',
    caveat: '⚠️ NO READER ANYWHERE. Persisted, offered in the create form, and enforced nowhere.' },
  { field: 'hotStockAllocation', label: 'Hot stock allocation', stage: 'sizing', enforcement: 'none', enforcedBy: null,
    summary: 'Declared: a separate allocation % for hot-stock trades.',
    caveat: '⚠️ NO READER ANYWHERE.' },
  { field: 'hotStockDetectionMode', label: 'Hot stock detection mode', stage: 'sizing', enforcement: 'none', enforcedBy: null,
    summary: 'Declared: top-scoring | volume-spike | all.',
    caveat: '⚠️ NO READER ANYWHERE.' },
  { field: 'hotStockMaxHoldHours', label: 'Hot stock max hold', stage: 'exit', enforcement: 'none', enforcedBy: null,
    summary: 'Declared: a shorter hold limit for hot-stock positions.',
    caveat:
      '⚠️ NO READER ANYWHERE — and notably the time-stop reads `maxHoldHours` only, so this does NOT ' +
      'shorten anything.' },
];

/** Rules that can actually stop or shape a live trade. */
export const LIVE_RULES = BOT_RULES.filter((r) => r.enforcement === 'live');

/** Rules a reader might reasonably assume are applied, but are not. */
export const NOT_LIVE_RULES = BOT_RULES.filter((r) => r.enforcement !== 'live');

/** Counts for a UI badge or a log line — see `GET /api/trading/bots/rules`. */
export function ruleEnforcementCounts() {
  return BOT_RULES.reduce<Record<string, number>>((acc, r) => {
    acc[r.enforcement] = (acc[r.enforcement] ?? 0) + 1;
    return acc;
  }, {});
}
