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
    // ⚠️ CORRECTED 2026-10-02 (#917). This caveat said data readiness "compares the PROTOCOL
    // declared timeframe", which is WRONG and understates the gap: it derives the cadence from
    // `selectBaseTimeframe(protocol.recommendedTimeframe)` (#908), and `recommendedTimeframe` is
    // FREE TEXT that is usually a RANGE. So the cadence actually used can be a THIRD value matching
    // neither the bot nor the protocol string — `5s–30s` resolves to `1m`.
    caveat:
      '⚠️ NOT used for gating, and this VALUE is never read as a cadence. Data readiness derives ' +
      'the cadence from the protocol via `selectBaseTimeframe(protocol.recommendedTimeframe)` ' +
      '(#908) — measured: `5s–30s` resolves to `1m`, so a bot declaring `5m` on that protocol runs ' +
      'on neither 5m nor 5s–30s. MEASURED 2026-10-02: of 39 active bots 21 matched their protocol ' +
      'string, 18 did not, 1 protocol declares none; the bulk of the 18 is the RANGE-vs-single-value ' +
      'artefact rather than 18 defects, which is why the fix is to MAKE THE CADENCE VISIBLE and not ' +
      'to gate on it — gating would halt 18 of 39 live bots on a rule nobody has validated (#917).' },

  // ── routing ─────────────────────────────────────────────────────────────────────────────────
  { field: 'protocolId', label: 'Protocol', stage: 'routing', enforcement: 'display-only',
    enforcedBy: 'nest/src/modules/trading/trading-strategy.service.ts',
    summary: 'Legacy single protocol link; seeds one subscription and is used for the bot label.',
    caveat:
      '⚠️ Until 2026-10-06 this column was also READ by the pre-trade gate reconciliation ' +
      '(`signal-envelope.service.ts`), making it a second source for "participating bots" while ' +
      'routing joins `strategy_protocol` — the disagreement could starve a subscribed bot or let ' +
      'a subscription-less bot lower the gate. All 40 active bots were measured to agree, and the ' +
      'reconciliation now resolves subscriptions; display-only is now true in fact. Canary: ' +
      '`signal-envelope-gate-reconciliation.spec.ts`.' },
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
    summary: 'Gate 5 — minimum minutes between this bot taking signals.',
    caveat: '⚠️ One of FOUR cooldowns (bot, global pacing, dispatch 3s, dispatch 60s/symbol).' },
  { field: 'sessionWindow', label: 'Session window', stage: 'entry', enforcement: 'live',
    enforcedBy: 'nest/src/modules/trading/session-window.ts',
    summary: 'Gate 4.5 — tags (asian/london/us) the bot may act in. `\'all-hours\'` = declared bypass; NULL = UNFILLED (#982).',
    caveat:
      '⚠️ NULL used to be ambiguous by design — measured live 2026-10-06: of the four city-news pairs ' +
      'in forex-session-v1, ONE twin was gated and the other was not (Tokyo USDJPY=asian vs EURJPY=NULL; ' +
      'Sydney AUDUSD=asian vs AUDJPY=NULL; Wellington NZDUSD=asian vs NZDJPY=NULL; Zurich USDCHF=london ' +
      'vs EURCHF=NULL). RESOLVED AS A CLASS (#982, 2026-10-08): NULL now reads as UNFILLED ' +
      '(`sessionSlotKind()`, surfaced on GET /api/automation/status) while the deliberate case is the ' +
      'positive literal `\'all-hours\'`; the seed no longer permits null and the build gate ' +
      '`strategy-seed-session-declared.spec.ts` fails on an unfilled slot. GATE BEHAVIOUR IS ' +
      'UNCHANGED — every no-tag form still passes. ⚠️ The TWIN DISAGREEMENT ITSELF IS STILL OPEN: the ' +
      'NULL twins kept all-hours (behaviour-preserving); which of a twin pair is right is the OWNER\'s ' +
      'call on the name-vs-news reading — do NOT re-gate on a name alone.' },
  { field: 'maxPyramidTiers', label: 'Max pyramid tiers', stage: 'entry', enforcement: 'live',
    enforcedBy: 'nest/src/modules/trading/pyramid-policy.service.ts',
    summary: 'Scale-in cap: extra entries allowed when price is favourable. 1 = never add.' },

  // ── sizing ─────────────────────────────────────────────────────────────────────────────────
  { field: 'baseSize', label: 'Base size', stage: 'sizing', enforcement: 'live',
    enforcedBy: 'nest/src/modules/automation/automation-loop.service.ts',
    summary: 'Order volume before any risk cap is applied. Also the volume sent unchanged when no sizing model is selected.' },
  { field: 'sizingModel', label: 'Sizing model', stage: 'sizing', enforcement: 'live',
    enforcedBy: 'nest/src/modules/automation/automation-loop.service.ts',
    summary: 'Which model computes the order volume: fixedLot (NULL, the pre-#843 behaviour) | fixedPercent | atrEqualRisk | kellyFull | kellyHalf. Sized models run through the shared maths in trading/position-sizing.ts.',
    caveat:
      '⚠️ A sized model REQUIRES bridge-reported constraints (volumeStep + tickValue/tickSize) and '
      + 'the account equity. Anything missing refuses the dispatch visibly (TCS-TRADE-023) rather '
      + 'than sending a size it cannot validate. NULL is the default for every existing bot.' },
  { field: 'sizingRiskPct', label: 'Risk per trade (%)', stage: 'sizing', enforcement: 'live',
    enforcedBy: 'nest/src/modules/automation/automation-loop.service.ts',
    summary: 'Risk per trade as % of EQUITY for the fixedPercent / atrEqualRisk models.',
    caveat:
      '⚠️ NULL = not configured, and a sized model with no riskPct refuses visibly. There is no '
      + 'default on purpose: a guessed risk fraction would be a number nobody chose.' },
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
    summary: 'Initial stop, computed and sent to the broker with the order.',
    caveat:
      '⚠️ Measured 2026-10-06: the % is applied to the REFERENCE 5m close at dispatch ' +
      '(automation-loop `getClose()`), not to the fill — the broker stop can sit a close-to-fill ' +
      'gap away from the executed price (observed ≤0.13% of price on one live bot). The guardian ' +
      'later re-anchors: trail distance = max(3×ATR(5m), slPct × ENTRY), tighten-only (#927).' },
  { field: 'tpPct', label: 'Take profit %', stage: 'exit', enforcement: 'live',
    enforcedBy: 'nest/src/modules/automation/automation-loop.service.ts',
    summary: 'Initial target, sent to the broker with the order.',
    caveat:
      '⚠️ EXPLAINED 2026-10-06 — the earlier "winners exit at +0.02–0.15% against a tpPct of 1.0, ' +
      'unexplained" note named the wrong suspect: nothing closes a winner EARLY. Measured on ' +
      'forex-session-v1 (bot "Tokyo EURJPY Session", 18 closed trades): 0 exits at TP, 9 on ' +
      '`system:time-stop` (maxHoldHours 12) and 6 at the broker (stop/trail) — peak profit before a ' +
      'time-stop close was +0.44%. A 1% target needs a 1%+ run inside 12h; the 12h stop and the ' +
      'guardian trail (≥ slPct from ENTRY) simply own the exit. TP is reachable but rarely reached.' },
  { field: 'maxHoldHours', label: 'Max hold (time stop)', stage: 'exit', enforcement: 'live',
    enforcedBy: 'nest/src/modules/automation/position-time-stop.service.ts',
    summary: 'Closes a position held longer than this. NULL = no limit (opt-in).',
    caveat:
      '⚠️ Was inert until 2026-09-17: it parsed an order-comment format nothing emits (0 of 76) and ' +
      'defaulted to dry-run. ARMED AND FIRING, measured 2026-10-06: 9 closes on forex-session-v1\'s ' +
      'EURJPY bot with `closeReason = system:time-stop` recorded (#949). ⚠️ Hold AT CLOSE was ' +
      '12.1–52h against the 12h limit because the 5-minute sweep runs only while the API is up and ' +
      'the dev machine is off overnight — closes land on the first sweeps after boot (2026-10-06: ' +
      'no log activity 00:00–13:00 UTC, position closed 13:20). 12h is a floor enforced-or-pending, ' +
      'not a promise of the close time.' },

  // ── #928 — the EXIT-SIDE SESSION GATE ───────────────────────────────────────────────────────
  // `sessionWindow` above is `stage: 'entry'` and was the ONLY session gate, so a bot could be told
  // when it may OPEN but not when it must HOLD. Measured 2026-09-21: bots gated to `asian` still
  // held positions at 12:40 UTC, and "be flat over the boundary" was not expressible at all.
  //
  // ⚠️ `enforcement: 'live'` IS EARNED, NOT ASSERTED. `position-time-stop.service.ts` calls
  // `checkExitBoundary(attribution.exitBeforeUtc)` on every position tick and closes on `due` with
  // `closeReason = system:session-exit`. The declaration was added only AFTER that path existed —
  // declaring a behavioural column before its reader does is the defect class #870/#966 exist to
  // prevent.
  { field: 'exitBeforeUtc', label: 'Exit before (UTC)', stage: 'exit', enforcement: 'live',
    enforcedBy: 'nest/src/modules/automation/position-time-stop.service.ts',
    summary:
      'Gate 7 (exit side, #928) — `HH:MM` in UTC: past this time the bot must not HOLD, so it ' +
      'closes flat. NULL / empty = no boundary, so every existing bot is unchanged.',
    caveat:
      '⚠️ OPT-IN, AND THE MEASUREMENT DID NOT SUPPORT A BLANKET RULE. Counterfactual replay over ' +
      '228 real trades measured 13:30 as ordinary: +0.045pp mean while CUTTING 23 winners and ' +
      'turning 11 green trades red; 13:00 measured better and 20:00 was negative. So this is a ' +
      'per-bot POLICY an operator may choose, NOT a fix for a measured effect. ⚠️ An unreadable ' +
      'value triggers NO close (a typo must never flatten a position) and is reported in ' +
      '`lastSummary.boundaryInvalid` instead of being silently ignored.' },

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

/**
 * Counts for a UI badge or a log line, served by `GET /api/trading/strategies/bot-rules`.
 *
 * ⚠️ CORRECTED 2026-10-01. This comment used to name `GET /api/trading/bots/rules`, which **404s**
 * — measured, not assumed. The frontend (`useBotRules()`) already called the right one, so nothing
 * was broken at runtime and nothing ever failed; the only cost was to whoever trusted the comment.
 * A documented endpoint that does not exist is the same defect as a documented field with no
 * reader: it reads as a capability and is not one.
 */
export function ruleEnforcementCounts() {
  return BOT_RULES.reduce<Record<string, number>>((acc, r) => {
    acc[r.enforcement] = (acc[r.enforcement] ?? 0) + 1;
    return acc;
  }, {});
}
