/**
 * bot-config.ts — the PURE half of a bot-driven backtest (#965 item 3), extracted from
 * `backtest.service.ts` on 2026-11-19.
 *
 * ── WHY THIS IS ITS OWN MODULE ───────────────────────────────────────────────────────────────────
 * `backtest.service.ts` is **5,466 lines** with a **1,588-line** function, and it is the last of the
 * three critical files the code-health report names. It cannot be read in one sitting, so the parts a
 * reader most needs to trust have to be separable. This is the first slice, and it is the one whose
 * output the owner actually reads: every sentence in `caveats` is a statement about what the run could
 * not measure.
 *
 * It was ALREADY pure and already tested (`backtest.service.spec.ts`, `settings-inventory.spec.ts`),
 * which is exactly what makes it safe to move: the move is behaviour-preserving by construction, and the
 * existing assertions are the proof rather than a new set of claims.
 *
 * ⚠️ WHAT IS STILL IN THE SERVICE, said plainly: `BacktestRunRequest`, `BotDriven` and `BotForBacktest`
 * are declared in `backtest.service.ts` and imported here as TYPES ONLY, so no runtime cycle exists —
 * but this module cannot be read standalone. Moving those three interfaces is the next slice, and it is
 * a bigger one because 11 other functions reference them.
 *
 * ⚠️ Precedence and the caveat semantics below are UNCHANGED. Nothing in this file was rewritten in the
 * move except the removal of the enclosing-file context from the docblock.
 *
 * ── DECISION (2026-11-19, primary) ──
 * WHAT:      `mergeBotConfig()` moves to `nest/src/modules/backtest/bot-config.ts`, imported by the
 *            service and by the two specs. It is NOT re-exported from `backtest.service.ts`.
 * WHY:       `backtest.service.ts` is 5,282 lines with a 1,588-line function and is one of three
 *            critical files nobody can read in one sitting. This function was already pure and already
 *            tested, so moving it is behaviour-preserving by construction and the existing 618 nest
 *            tests are the proof. Its `caveats` are the sentences the owner reads, so it is the first
 *            thing that should be readable on its own.
 * INSTEAD OF: A re-export from the old path, which would have kept every import working and let the
 *            next reader import a 190-line function from a 5,000-line file without discovering this one.
 * REVERSE BY: Move the function back, restore the `simTslPlan` import in the service, and point the two
 *            spec imports at `./backtest.service`.
 * REGISTER:  docs/SETTLED-DECISIONS.md row 308
 * GUARD:     npx jest src/modules/backtest (618 tests) + `npm --prefix nest run validate:parity`, which
 *            FAILED on the move until the `sim-tsl` row named this file — a gate, observed failing.
 */
import { simTslPlan } from './sim-tsl';
import type { BacktestRunRequest, BotDriven, BotForBacktest } from './backtest.service';
/**
 * mergeBotConfig() — the pure half of a bot-driven backtest (#965 item 3).
 *
 * SEPARATE FROM THE LOADING so precedence and the caveats can be tested without a database or the
 * scoring stack. It is the part that decides what the run MEASURES; the caller supplies the bot.
 *
 * ⚠️ PRECEDENCE: an explicit request field ALWAYS wins over the bot's, and every field it replaced
 * is recorded in `overridden` — because a run must be able to say what it actually measured rather
 * than what the caller asked for.
 *
 * ⚠️ THE SIZING CAVEAT IS NOT DECORATION (#843). The live path sizes every trade in lots from
 * `trading_strategy.baseSize` (`automation-loop.service.ts`: `strategy.baseSize ?? 0.01` passed
 * straight into `placeOrder({ quantity })`), while this backtester sizes in per-unit shares from an
 * equity model. They cannot agree today, so a bot-driven run says so, with the bot's own lot size in
 * the sentence. Without it, the numbers read as a forecast of the bot's P&L and they are not.
 */
export function mergeBotConfig(
  request: BacktestRunRequest,
  bot: BotForBacktest,
): { request: BacktestRunRequest; drivenBy: BotDriven; caveats: string[] } {
  const overridden: string[] = [];
  const pick = <T>(
    given: T | undefined,
    fromBot: T | null | undefined,
    label: string,
  ): T | undefined => {
    if (given !== undefined) {
      if (given !== fromBot) overridden.push(label);
      return given;
    }
    return fromBot ?? undefined;
  };

  // ⚠️ `symbol` KEEPS ITS `||` FALLBACK (an empty-string request must still fall back to the bot's),
  // so it does not go through `pick()`. It still has to be RECORDED, though: `drivenBy.overridden` is
  // documented as "what this run ACTUALLY measured", and a run that was pointed at a different market
  // while reporting no overrides is exactly the silently-different-measurement this block exists to
  // prevent. Found by `settings-inventory.spec.ts` (#1136), which asserted every honoured bot field
  // lands in `overridden`.
  const symbol = request.symbol || bot.symbol;
  if (request.symbol && request.symbol !== bot.symbol) overridden.push('symbol');

  const merged: BacktestRunRequest = {
    ...request,
    symbol,
    timeframe: pick(request.timeframe, bot.timeframe, 'timeframe'),
    protocolId: pick(request.protocolId, bot.protocolId, 'protocolId'),
    slPct: pick(request.slPct, bot.slPct, 'slPct'),
    tpPct: pick(request.tpPct, bot.tpPct, 'tpPct'),
    // ⚠️ CARRIED NOW, AND IT CHANGES RESULTS (#1136). The bot's own entry bar previously never
    // reached a run, so a bot set to skip anything under 10% was backtested as though it took every
    // 6%+ signal. Measured on the live path: `automation-loop.service.ts` skips when
    // `gatePct < minComposite`, and `fullScore()` returns `composite: gated.signalPct` — the same
    // percentage, so the comparison is the same comparison, not an approximation of it.
    //
    // ⚠️ CONSEQUENCE, stated because it is not reversible by re-running: bot-driven runs stored
    // before this change measured a LOWER bar than the bot uses. They are not comparable with new
    // runs, and `caveats` says so on every bot-driven result.
    minComposite: pick(request.minComposite, bot.minComposite, 'minComposite'),
    // ⚠️ CARRIED NOW, AND IT CHANGES RESULTS (#1136, 2026-11-16). `maxHoldHours` was set on 42 of 64
    // active bots and read by NOTHING in the engine, so a run held every trade until its stop, its
    // target or the end of the data — days past the point the live bot would have closed it
    // (`position-time-stop.service.ts`, `SYSTEM_TIME_STOP`). Hold time was therefore inflated and the
    // exit reason belonged to a period the bot would no longer have been in the market.
    //
    // ⚠️ CONSEQUENCE, stated because it is not reversible by re-running: bot-driven runs stored before
    // this change measured a trade population with no time stop. They are not comparable with new
    // runs, and `caveats` says so on every bot-driven result.
    maxHoldHours: pick(request.maxHoldHours, bot.maxHoldHours, 'maxHoldHours'),
    // ⚠️ CARRIED NOW, AND IT CHANGES RESULTS (#1294, 2026-11-17). `simTslEnabled` was set on **3 of
    // 64** active bots, displayed in the UI, and read by NOTHING in the engine — `settings-inventory`
    // recorded it as `applied: 'ignored'`. A bot the operator had turned trail-protection ON for was
    // backtested with no trail at all, and the run's own result read as "trailing was tested".
    //
    // ⚠️ PRECEDENCE IS THE USUAL ONE: an explicit `stopPlan` on the request ALWAYS wins, so
    // "this bot, but with a different trail" stays one call. `simTslPlan()` returns null rather than a
    // half-built plan when the bot's numbers are unusable, so an enabled switch with no distance
    // cannot silently tighten stops.
    //
    // ⚠️ CONSEQUENCE, stated because it is not reversible by re-running: bot-driven runs stored
    // before this change measured a trade population with no trailing stop. They are not comparable
    // with new runs of the same bot.
    stopPlan: pick(request.stopPlan, simTslPlan(
      bot.simTslEnabled,
      bot.simTslActivationPct,
      bot.simTslDistancePct,
    ) ?? undefined, 'stopPlan'),
    // ⚠️ CARRIED NOW, AND IT CHANGES RESULTS (#1242, 2026-11-20). `takeProfitAmount` is live on the
    // bot (`stop-guardian.service.ts` closes at market with `system:take-profit`) and was read by
    // NOTHING in the engine, so a bot with a money target was measured without one of its exits. The
    // blocking reason was ORDER, not the decision: the engine walked the bracket and only then sized
    // the position, so a per-bar money test had no unit count. The sizing now resolves before the walk,
    // and the target is judged at each bar's close on the same net-of-commission basis the trade books.
    //
    // ⚠️ CONSEQUENCE, stated because it is not reversible by re-running: bot-driven runs stored before
    // this change measured a population with no money target. They are not comparable with new runs of
    // the same bot.
    takeProfitAmount: pick(request.takeProfitAmount, bot.takeProfitAmount, 'takeProfitAmount'),
    // ⚠️ CARRIED NOW, AND IT CHANGES RESULTS (#1242, 2026-11-20). `sessionWindow` was set on every
    // movers bot (`["us"]` on both) and read by NOTHING in the engine, so a run traded the pre-market
    // hour before the US open and reported it as the bot's own result. The predicate is the LIVE one
    // (`checkSessionWindow`), so the ET conversion, DST and the city-alias ambiguity (#759) keep one
    // owner.
    //
    // ⚠️ CONSEQUENCE, stated because it is not reversible by re-running: bot-driven runs stored before
    // this change measured a population that included bars the bot was shut for. `EXECUTION_SEMANTICS`
    // is bumped to 2, so a comparison against them is REFUSED rather than showing a delta.
    sessionWindow: pick(request.sessionWindow, bot.sessionWindow, 'sessionWindow'),
    // ⚠️ CARRIED NOW, AND IT CHANGES RESULTS (#1242, 2026-11-20). `exitBeforeUtc` is the EXIT half of the
    // session policy: `sessionWindow` says when a bot may open, this says when it must be FLAT (#928).
    // It was expressed nowhere in the engine, so a run held positions through a boundary the operator
    // had declared — the position that "would have been closed at 13:30" stayed open for the rest of the
    // data and its P&L belonged to a period the bot would not have been in the market.
    //
    // ⚠️ COMBINED WITH `maxHoldHours` BY THE LIVE FUNCTION (`decideExitTrigger`), because a bot may
    // declare either, both or neither, and the two must not mask each other. `EXECUTION_SEMANTICS` is 3
    // from this change, so a comparison against an older run is refused rather than showing a delta.
    exitBeforeUtc: pick(request.exitBeforeUtc, bot.exitBeforeUtc, 'exitBeforeUtc'),
  };

  const baseSize = bot.baseSize ?? null;
  const sizing = merged.positionModel ?? 'fixedPercent';
  const caveats: string[] = [
    // ⚠️ REWRITTEN 2026-11-27 (#843 CLOSED 2026-10-10). This sentence used to tell the reader the sizing
    // maths was NOT shared and to read the run as "a study of the signal until #843 lands". #843 landed
    // seven weeks earlier: the engine calls the same `computeSizing()` the live loop calls, so the claim
    // was FALSE on every bot-driven run — and a false warning beside a true one (scale-in not modelled)
    // is how a reader learns to skip both. The residual is narrower, and is now named.
    `⚠️ SIZING MATHS ARE SHARED; THE BROKER'S VOLUME LIMITS ARE NOT. This bot trades ` +
      `${
        baseSize === null
          ? 'an UNSET baseSize (the live loop would use its 0.01 default)'
          : `${baseSize} lot(s)`
      } per trade, and this run sizes through the SAME function the live loop uses (trading/position-sizing.ts, ` +
      '#843). What a run does NOT model is applyVolumeConstraints(): the venue volumeStep rounding and its ' +
      'volumeMin/volumeMax clamp. A computed size that is below the broker minimum or off its step is TAKEN ' +
      'here and would be REFUSED live (TCS-TRADE-023), so a run can contain trades the bridge would have ' +
      'rejected. Trade-for-trade P&L is comparable; the POPULATION is slightly optimistic.',


    // ⚠️ #1136 — the entry bar IS applied now, and that makes old runs non-comparable. Saying so on
    // the result is the only way a reader comparing a new run with a stored one can know.
    (merged.minComposite ?? 0) > 0
      ? `ℹ️ The bot's entry bar (minComposite ${merged.minComposite}%) IS applied (#1136). Runs of this `
        + 'bot stored before 2026-10-22 did NOT apply it, so their trade counts are higher and the two '
        + 'are not comparable.'
      : 'ℹ️ The bot has no entry bar (minComposite 0), so this run applies none — matching the live path.',
    // ⚠️ #1136 (2026-11-16) — the time stop IS applied now, and that makes old runs non-comparable.
    (merged.maxHoldHours ?? 0) > 0
      ? `ℹ️ The bot's time stop (${merged.maxHoldHours}h max hold) IS applied (#1136). Runs of this bot `
        + 'stored before 2026-11-16 had NO time stop, so their trades could be held far past this limit: '
        + 'their hold times are inflated and their exit reasons are not comparable with this run.'
      : 'ℹ️ The bot has no max hold, so this run applies no time stop — matching the live path.',
    ...(merged.protocolId
      ? []
      : [
          '⚠️ This bot has NO protocolId, so canonical META.Stack scoring cannot be used and the run ' +
            'will be rejected rather than measured against a default.',
        ]),
  ];

  // ── THE MECHANISM THIS RUN CANNOT MODEL ──────────────────────────────────────────────────
  // `pyramid` is the parity register's only `gap`. Pushed AFTER the array literal rather than spread
  // inside it, only when the bot would have used it — so a bot at 1 tier (the default, and every
  // incumbent configuration) gains no noise. Register row 300.
  const pyramidTiers = Number(bot.maxPyramidTiers ?? 1);
  if (pyramidTiers > 1) {
    caveats.push(
      `⚠️ SCALE-IN IS NOT MODELLED. This bot allows ${pyramidTiers} pyramid tiers, and the engine holds `
      + 'ONE position per symbol: where the live path would have added a second position to a profitable, '
      + 'stop-locked one, this run recorded no such trade. Its trade count and exposure are UNDERSTATED, and '
      + 'the gap widens the more often the first position went green before the signal faded. '
      + 'Parity register row: pyramid.',
    );
  }

  return {
    request: merged,
    drivenBy: {
      botId: bot.id,
      botName: bot.name,
      symbol: bot.symbol,
      protocolId: bot.protocolId ?? null,
      baseSize,
      mode: bot.mode,
      active: bot.active,
      overridden,
    },
    caveats,
  };
}
