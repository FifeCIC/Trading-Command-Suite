import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class PlannerService {
  private readonly logger = new Logger(PlannerService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Fund Allocations ────────────────────────────────────

  async getFundAllocations() {
    return this.prisma.fundAllocation.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async createFundAllocation(data: {
    name: string;
    amount: number;
    currency?: string;
    source?: string;
    notes?: string;
    allocations?: any[];
  }) {
    return this.prisma.fundAllocation.create({
      data: {
        name: data.name,
        amount: data.amount,
        currency: data.currency ?? 'GBP',
        source: data.source ?? 'earnings',
        notes: data.notes ?? null,
        allocations: data.allocations ?? [],
      },
    });
  }

  async updateFundAllocation(id: string, data: any) {
    return this.prisma.fundAllocation.update({ where: { id }, data });
  }

  async deleteFundAllocation(id: string) {
    return this.prisma.fundAllocation.delete({ where: { id } });
  }

  // ── Trading Style Preferences ───────────────────────────

  async getTradingStyles() {
    return this.prisma.tradingStylePreference.findMany({
      orderBy: { sortOrder: 'asc' },
    });
  }

  async toggleTradingStyle(styleKey: string, enabled: boolean) {
    return this.prisma.tradingStylePreference.update({
      where: { styleKey },
      data: { enabled },
    });
  }

  async updateStylePreferences(styleKey: string, preferences: any) {
    return this.prisma.tradingStylePreference.update({
      where: { styleKey },
      data: { preferences },
    });
  }

  async seedDefaultStyles() {
    const defaults = [
      { styleKey: 'speed-trading', label: 'Xtrend Speed Trading', description: 'Fast-paced short-term trading on MT5 using the Speed protocol', category: 'active', sortOrder: 1 },
      { styleKey: 'stocks-portfolio', label: 'Stocks Portfolio', description: 'Long-term equity portfolio management via Trading212', category: 'portfolio', sortOrder: 2 },
      { styleKey: 'cfd-trading', label: 'CFD Trading', description: 'Contract-for-difference trading with leverage via MT5', category: 'active', sortOrder: 3 },
      { styleKey: 'swing-trading', label: 'Swing Trading', description: 'Multi-day position holds capturing trend swings', category: 'active', sortOrder: 4 },
      { styleKey: 'day-trading', label: 'Day Trading', description: 'Intraday positions closed before market close', category: 'active', sortOrder: 5 },
      { styleKey: 'scalping', label: 'Scalping', description: 'Ultra-short-term trades targeting small price movements', category: 'active', sortOrder: 6 },
      { styleKey: 'position-trading', label: 'Position Trading', description: 'Long-term macro-driven positions held weeks to months', category: 'portfolio', sortOrder: 7 },
      { styleKey: 'crypto-trading', label: 'Crypto Trading', description: 'Digital asset trading on supported exchanges', category: 'specialty', sortOrder: 8 },
      { styleKey: 'options-trading', label: 'Options Trading', description: 'Options strategies including covered calls and spreads', category: 'specialty', sortOrder: 9 },
      { styleKey: 'automated-trading', label: 'Automated Trading', description: 'Algorithm-driven execution via the automation loop', category: 'automation', sortOrder: 10 },
    ];

    let seeded = 0;
    for (const style of defaults) {
      const existing = await this.prisma.tradingStylePreference.findUnique({ where: { styleKey: style.styleKey } });
      if (!existing) {
        await this.prisma.tradingStylePreference.create({ data: style });
        seeded++;
      }
    }
    return { seeded, total: defaults.length };
  }

  // ── Trading Objectives ──────────────────────────────────

  async getObjectives(status?: string) {
    // Use raw SQL to ensure priority + phase are returned (Prisma client may be stale)
    try {
      let query = 'SELECT * FROM trading_objective';
      const params: any[] = [];
      if (status) { query += ' WHERE status = ?'; params.push(status); }
      query += ' ORDER BY COALESCE(priority, 99) ASC, createdAt DESC';
      const rows: any[] = await this.prisma.$queryRawUnsafe(query, ...params);
      return rows.map((r: any) => ({
        ...r,
        priority: r.priority ?? 50,
        phase: r.phase ?? 'planning',
        isBuiltIn: Boolean(r.isBuiltIn),
        progressPct: Number(r.progressPct ?? 0),
        currentAmount: Number(r.currentAmount ?? 0),
        targetAmount: r.targetAmount ? Number(r.targetAmount) : null,
      }));
    } catch {
      // Fallback to Prisma client
      const where: any = {};
      if (status) where.status = status;
      return this.prisma.tradingObjective.findMany({
        where,
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      });
    }
  }

  async createObjective(data: {
    title: string;
    description?: string;
    category: string;
    targetAmount?: number;
    currentAmount?: number;
    currency?: string;
    targetDate?: string;
    priority?: number;
    phase?: string;
    linkedStrategy?: string;
    linkedAccount?: string;
    notes?: string;
  }) {
    return this.prisma.tradingObjective.create({
      data: {
        title: data.title,
        description: data.description ?? null,
        category: data.category,
        targetAmount: data.targetAmount ?? null,
        currentAmount: data.currentAmount ?? 0,
        currency: data.currency ?? 'GBP',
        targetDate: data.targetDate ? new Date(data.targetDate) : null,
        priority: data.priority ?? 50,
        phase: data.phase ?? 'planning',
        linkedStrategy: data.linkedStrategy ?? null,
        linkedAccount: data.linkedAccount ?? null,
        notes: data.notes ?? null,
        progressPct: data.targetAmount && data.currentAmount
          ? Math.round((data.currentAmount / data.targetAmount) * 100)
          : 0,
      },
    });
  }

  async updateObjective(id: string, data: any) {
    if (data.currentAmount != null && data.targetAmount != null && data.targetAmount > 0) {
      data.progressPct = Math.round((data.currentAmount / data.targetAmount) * 100);
    }
    return this.prisma.tradingObjective.update({ where: { id }, data });
  }

  async deleteObjective(id: string) {
    return this.prisma.tradingObjective.delete({ where: { id } });
  }

  async seedBuiltInObjectives() {
    const defaults = [
      {
        title: 'Active MT5 Trading',
        description: 'Get TCS actively trading via MT5 on the MetaQuotes-Demo account — fast-paced testing with the automation loop running live strategies, SL/TP enforcement, multi-strategy concurrent execution, and full pipeline observability.',
        category: 'active-trading',
        priority: 1,
        phase: 'live',
        targetAmount: null,
        currentAmount: 0,
        currency: 'GBP',
        linkedStrategy: 'MT5 Automation Loop',
        linkedAccount: 'MT5',
        notes: `## Objective
Have the automation loop executing real trades on MT5 (MetaQuotes-Demo) with risk management active. This objective is pending a sprint review before full-scale execution.

## Success Criteria (post-sprint review)

1. **Accelerated Testing Velocity** — Positions opened and closed at a faster rate. This may involve simplifying a protocol or relaxing risk constraints on the MetaQuotes-Demo account to generate more activity quickly, then fine-tuning once the pipeline is proven.

2. **MT5 ↔ TCS Position Sync** — Confirm that every position is perfectly synchronised between MT5 and TCS in both directions. No orphaned positions, no stale state.

3. **Full Pipeline Verification** — Validate the complete pipeline end-to-end: directive scoring → protocol aggregation → strategy signal → automation execution → MT5 trade → position tracking → P&L recording. This requires high-frequency automation activity to properly examine.

4. **Manual + Automated Trade Coexistence** — Conduct manual MT5 trades alongside automated ones. This requires a Scoring Strategy that runs independently without a Trading Strategy consuming it, otherwise duplicate trades could fire from the same signal.

5. **Multi-Strategy Concurrent Execution** — Trades firing from multiple strategies configured for different time horizons (e.g. scalp, day-trade, swing). This maximises productive use of capital and tests the automation loop's ability to manage parallel strategies without interference.

6. **Stop-Loss & Take-Profit Enforcement** — Every automated position must be opened with SL and TP levels attached, set according to the strategy's risk parameters.

7. **Style-Appropriate Exits** — Positions closed according to their trading style:
   - Scalps: closed quickly (seconds to minutes)
   - Day trades: closed near end of session/day
   - Intraday/swing: trailing SL managed throughout
   This requires at least 3 distinct Trading Strategies to witness all three behaviours.

8. **UI Observability** — The UI must make it easy to identify:
   - Daily P&L results at a glance
   - P&L broken down by Trading Strategy
   - Which Scoring Strategies supported each trade
   - Directive-specific history stats changing in real time as trades execute`,
      },
      {
        title: 'Grow Xtrend Account: £59 → £500',
        description: 'Turn the £59 starting balance in the Xtrend account into £500 using speed trading strategies',
        category: 'account-growth',
        targetAmount: 500,
        currentAmount: 59,
        currency: 'GBP',
        linkedStrategy: 'Speed Trading',
        linkedAccount: 'Xtrend',
        notes: 'Use the Speed protocol with tight risk management. Target: 8.5x growth.',
      },
      {
        title: 'Fix T212 Portfolio Slow Growth',
        description: 'Get the Trading212 portfolio out of slow-growth mode by identifying underperformers and reallocating',
        category: 'portfolio-recovery',
        targetAmount: null,
        currentAmount: 0,
        currency: 'GBP',
        linkedStrategy: 'Portfolio Optimization',
        linkedAccount: 'Trading212',
        notes: 'Cross-reference SEES scores with current holdings. Identify positions to trim and sectors to increase.',
      },
      {
        title: 'Build to £10,000 Trading Capital',
        description: 'Long-term goal: accumulate £10,000 in total trading capital across all accounts',
        category: 'long-term',
        targetAmount: 10000,
        currentAmount: 0,
        currency: 'GBP',
        linkedStrategy: null,
        linkedAccount: null,
        notes: 'Compound growth across MT5, T212, and Xtrend. Track total equity monthly.',
      },

      /**
       * ── THE TWO "BIG MOVER" RESEARCH OBJECTIVES (added 2026-09-23) ──────────────
       *
       * A pair, not two entries: "Top Winners" measures what an UPSIDE ignition does next,
       * "Top Losers" is the same measurement inverted. The user's goal is explicitly NOT
       * just a strategy — it is to download the data around large moves, average what
       * happens, and let those averages SET the thresholds. Each is the other's counter-trade,
       * which is where the leveling/exhaustion research earns its keep.
       *
       * ⚠️ FORMAT CONTRACT — READ BEFORE EDITING `notes` ON ANY OBJECTIVE:
       * `parseCriteria()` in src/pages/ObjectivesPage.jsx is LINE-BASED and renders ONLY
       * lines beginning with `- `, `* ` or `N. `. Headings (`## X`) and prose paragraphs are
       * silently DROPPED — they appear in this file and nowhere in the UI.
       * Consequence: every line below is one complete criterion on ONE line, self-labelled in
       * bold rather than grouped under a heading, because a heading would vanish and leave
       * the reader with unlabelled bullets. `**…**` is stripped before render.
       * (Pre-existing casualty: the headline objective's `## Objective` intro paragraph has
       * never been visible on the page — only its 8 numbered criteria render.)
       */
      {
        title: 'Top Winners — Trade the Ignition (Long)',
        description:
          'Research the days an instrument gains a large percentage in a short window, download the bars before and after each move, and let the measured averages — not a guess — set the trigger, the entry, the stop and the profit target. The counter-trade output feeds the mirrored short objective.',
        category: 'instrument-trading',
        priority: 20,
        phase: 'planning',
        targetAmount: null,
        currentAmount: 0,
        currency: 'GBP',
        linkedStrategy: 'Ignition Momentum (Long)',
        linkedAccount: 'MT5',
        notes: `- [ ] DECLARE THE TRIGGER AS A SETTING, NOT A LITERAL — two values in the settings registry (nest/src/common/settings/settings-registry.ts): the PERCENTAGE that counts as a move, and the WINDOW it must be gained in. Read via GET /api/system/settings/registry, set via PUT .../registry/:key, seeded by POST .../registry/ensure.
- [ ] DECLARE IT AS A KEY FAMILY SO INSTRUMENTS CAN DIFFER — 2% inside a short window is enormous in EURUSD and unremarkable in a crypto pair. One global threshold silently fits whichever instrument the research happened to favour.
- [ ] THE TWO VALUES ARE AN OUTPUT OF THIS RESEARCH, NOT AN INPUT — ship the setting with a placeholder and let the measured averages below replace it. Choosing the threshold first and then testing it is how a strategy becomes a curve-fit of its own example.
- [ ] FIX THE WINDOW TO SOMETHING MEASURABLE — "how short a period" is bounded by the bar granularity that actually exists for that instrument. Sub-minute windows are only possible where a TickRecordingSession was running (MarketBar rows carry recordingSessionId); imports give coarser bars. State the finite window per instrument or the trigger is unfalsifiable for some of them.
- [ ] BUILD THE EVENT SET — scan marketbar history for every (instrument, day) where the move happened inside the window, and persist it as a queryable set rather than a one-off script: both objectives and every later recalibration read it.
- [ ] DO NOT EXPECT GET /api/market-data/top-movers TO DO THIS — it does rank movers, but as a LIVE SNAPSHOT (latest bar versus one bar lookback ago) it cannot answer "which days did this happen". The historical scan is genuinely new work.
- [ ] DOWNLOAD BARS BEFORE AND AFTER EACH EVENT — N bars of baseline and M bars of aftermath at the finest available granularity. Check what exists FIRST with GET /api/backtest/data-inventory rather than assuming history is there; a missing baseline silently becomes a zero.
- [ ] APPLY A TRADABILITY VETO TO THE EVENT SET — an instrument needs a live broker symbol_route row to be priced or traded. An event set full of untradable instruments is a research artefact that looks like a strategy. (Broker reach differs: VIX and GER40 are Pepperstone-only, absent from MetaQuotes.)
- [ ] MEASURE THE BASELINE, because ignition and continuance look identical after the fact — for each event record the pre-move range, volume, position relative to the prior swing high, bars since the last comparable move, and session of day. Without this the "average" is an average over two different phenomena.
- [ ] REPORT DISTRIBUTIONS, NOT JUST AVERAGES — a mean with no spread cannot set a threshold, because the tail is what stops you out. Medians and quartiles for every figure below.
- [ ] MEASURE TIME TO FIRST PULLBACK — bars from the ignition peak to the first counter-swing, via detectZigZagSwings (nest/src/modules/directives/utils/zigzag.ts, wrapped as the zigzag-swing-detector directive). This average is the answer to "how long do we wait".
- [ ] SWEEP minMovePct, DO NOT FIX IT — the zigzag noise filter decides what counts as a pullback, so it decides the answer. Report the pullback statistics across a range of minMovePct (the default is 0.5); one value is a coincidence wearing a measurement's clothes.
- [ ] MEASURE THE DEPTH OF THE FIRST PULLBACK — how much of the move is given back before it resumes. This is the number that says whether the pullback is buyable, and where the stop can live without being noise.
- [ ] CLASSIFY EVERY EVENT AS CONTINUATION OR EXHAUSTION — did price resume the ignition direction after the first pullback, or was that pullback the reversal? Record the BASE RATE. That percentage is the entire premise of the strategy; if it is near a coin toss the edge is in the exits, not the entries.
- [ ] DEFINE "CALMING DOWN" FROM THE DATA — find the signature that a move is finished for the day or for the week, and measure its LEAD TIME: how many bars early it fires.
- [ ] THE VOCABULARY TO TEST ALREADY EXISTS — range-contraction, volume-rhythm, wick-filter, momentum-exhaustion, panic-exhaustion and the bulls-power/bears-power pair. Measure which of them actually preceded the levels, not which of them sound right.
- [ ] DERIVE THE TRADING TARGETS FROM THOSE AVERAGES — the trigger (percentage and window), where in the pullback to enter, the stop (below the pullback low or an ATR multiple), the profit target (the average continuation distance, or the calming signature, whichever fires first) and a TIME STOP (if the average continuation lasts N bars, holding past it is unmeasured risk).
- [ ] KEEP THE SCORING THRESHOLD AND THE EXECUTION THRESHOLD APART — "a signal scores" and "a bot trades it" are different decisions on different layers (protocol-gating entry threshold versus the bot minimum composite). One derived number cannot serve both; state each and where it lives.
- [ ] INTRODUCE EVERY DERIVED NUMBER AS AN A/B VARIANT, NEVER AN IN-PLACE EDIT — owner policy. The reason is recorded: a value edited in one place is evaluated by consumers nobody was thinking about.
- [ ] STATE THE FALSIFICATION TEST IN #944's FORMAT — what you expect to change, and the observation that would prove it wrong. Do not retire the incumbent before the comparison reports.
- [ ] ⚠️ THE COUNTER-TRADE IS BLOCKED BY A MEASURED GUARD TODAY — DuplicateGuardService.checkDuplicate() filters open positions on symbol+provider and recent trades on symbol+cooldown; NEITHER is direction-aware, so a live LONG on an instrument blocks a SHORT on the same instrument.
- [ ] SO THE DUAL STRATEGY NEEDS AN EXPLICIT DECISION — allow a same-symbol opposite leg (the guard gains a direction parameter) or implement it as close-then-reverse. Do not assume the opposite leg can be opened.
- [ ] VALIDATE OUT OF SAMPLE, NOT ON THE EVENTS THAT DEFINED THE RULE — POST /api/backtest/walk-forward. Averages that only hold on their own event set are overfit, and this strategy is unusually easy to overfit because the threshold was chosen by looking at the winners.
- [ ] RESPECT THE SAMPLE BAR AND RECORD COSTS — no verdict below the A/B bar (30 trades per side, #929) and state the number of INDEPENDENT events; two events is an anecdote. Fill in slippage, spread and commission on BacktestRun/BacktestTrade — a gross-only result cannot show whether the edge survives contact with the broker.`,
      },
      {
        title: 'Top Losers — Trade the Breakdown (Short)',
        description:
          'The mirror of the Top Winners research: measure the days an instrument falls a large percentage in a short window, average what follows, and turn it into a short strategy with its own settings. Includes the wiring this capability has never had — the short engine works and has never been attached to a bot.',
        category: 'instrument-trading',
        priority: 21,
        phase: 'planning',
        targetAmount: null,
        currentAmount: 0,
        currency: 'GBP',
        linkedStrategy: 'Ignition Breakdown (Short)',
        linkedAccount: 'MT5',
        notes: `- [ ] RUN THE SAME METHOD INVERTED — every measurement in the Top Winners objective applies here with the sign flipped: the declared trigger, the before-and-after bar download, the distributions, the pullback timing and depth, and the continuation-or-exhaustion base rate.
- [ ] BUILD ONE EVENT-SET PIPELINE THAT TAKES A DIRECTION, NOT TWO — the two objectives differ by a sign and a set of thresholds, and a second copy will drift from the first.
- [ ] ⚠️ EXPECT THE TRIGGER VALUES TO DIFFER, AND MEASURE RATHER THAN COPY THEM — downside moves are typically faster and steeper than upside moves, so the short side's percentage and window are probably NOT the long side's. This is a testable hypothesis and one of the reasons the setting is a family: prove the difference or prove it is absent.
- [ ] ⚠️ THE SHORT ENGINE IS CORRECT AND COMPLETELY UNWIRED — protocol-gating.service.ts already handles BOTH and SHORT_ONLY and needs NO code change, but all seven short-capable protocols have ZERO bots, and vix-short-v1 is the sole source of every SELL signal the app has ever produced.
- [ ] SO THE WIRING IS PART OF THIS OBJECTIVE, NOT A FOLLOW-UP — the seven are eurusd-macro-v1, usdjpy-risk-v1, gbpusd-news-v1, usdcad-oil-v1, commodity-pairs-v1, mt5-technical-short and vix-short-v1. A strategy that lands here must have a bot to trade it.
- [ ] ⚠️ BEARISH EVIDENCE IS STRUCTURALLY THIN — only three directives declare a bearish bias (rsi-overbought 140, mean-reversion 105, cci 100 — 345 of roughly 1010 maxScore in the vix stack), against a long side with far more to draw on.
- [ ] DECIDE WHETHER THIS ADDS BEARISH-CAPABLE EVIDENCE OR ACCEPTS A LOWER COMPOSITE FOR SHORTS — and measure the effect on the hit rate either way, rather than assuming a lower score means a weaker short.
- [ ] ⚠️ A LOW SCORE IS NOT A SHORT — this is deliberate design, not an oversight: below the entry threshold the signal is HOLD, meaning "no directional edge", and treating quiet as bearish would fabricate direction. A short must be a directive POSITIVELY emitting bearish, so a breakdown strategy needs an event detector that fires, not a low composite that is reinterpreted.
- [ ] ⚠️ 16 OF 17 ACTIVE PROTOCOLS ARE LONG_ONLY, SO BEARISH READING IS DISCARDED — directionAllowed drops a bearish signal even when the evidence is real. Measured on ftse-speed-v1: 6 bullish and 5 bearish ticks, and the bearish half counted for nothing.
- [ ] CHOOSING WHICH PROTOCOLS BECOME BOTH IS PART OF THIS OBJECTIVE — it changes live composites, so measure before flipping and use the A/B path rather than editing directionMode directly.
- [ ] CONFIRM THE INSTRUMENT CAN ACTUALLY BE SOLD — shortability is broker-route dependent, not universal. Verify the route exists AND that the broker offers the short, before an instrument enters the event set; VIX and GER40 are Pepperstone-only examples of instruments that are quotable on one broker and absent on another.
- [ ] ⚠️ VERIFY THE SELL EXECUTION PATH BEFORE THIS TRADES — unresolved from the 2026-09-10 short audit: does a SELL on a CFD or index place cleanly? Check the volume sign, the stop-loss and take-profit direction, and that the short lands correctly in the position table.
- [ ] THIS IS MONEY-PATH CODE — observe it working. Do not infer that selling is fine because buying is fine; the two directions take different branches through the broker adapter.
- [ ] MEASURE THE DOWNSIDE CALMING SIGNATURE — the mirror of the leveling research: volume dry-up, range contraction, wick rejection and the existing panic-exhaustion and bears-power vocabulary, with lead times. This is what says the breakdown is finished.
- [ ] THE COUNTER-TRADE HERE IS THE LONG — a breakdown that exhausts is a long entry, so this objective's calming signature is the input to the Top Winners side. That symmetry is the point of doing both, and it makes the two objectives one system with two directions rather than two strategies.
- [ ] ⚠️ THE SAME DIRECTION-AWARENESS BLOCKER APPLIES, FROM THE SHORT SIDE — DuplicateGuardService filters on symbol and provider with no direction, so a live SHORT blocks a LONG on the same instrument (and the recent-trade check adds a 5-minute cooldown on the symbol regardless of direction). The pair cannot both be live on one symbol until this is decided.
- [ ] TRACK THE DRAWDOWN SHAPE, WHICH DIFFERS FROM THE LONG SIDE — a short's loss is theoretically unbounded while its gain is capped, so the exit rules derived from the averages must be asymmetrical and a hard stop is not optional here.
- [ ] REPORT MAX DRAWDOWN ALONGSIDE WIN RATE ON EVERY RUN — and check it against the existing risk limits rather than beside them, because a short strategy that wins most of the time can still breach a limit on the rest.
- [ ] VALIDATE OUT OF SAMPLE AND RESPECT THE SAMPLE BAR — POST /api/backtest/walk-forward, no verdict below 30 trades per side (#929), and the number of independent events stated. Fill in slippage, spread and commission: shorting an instrument you cannot borrow or that widens spread during a sell-off is a cost the long side does not pay in the same way.`,
      },
    ];

    let seeded = 0;
    for (const obj of defaults) {
      const existing = await this.prisma.tradingObjective.findFirst({
        where: { title: obj.title, isBuiltIn: true },
      });
      if (!existing) {
        await this.prisma.tradingObjective.create({
          data: {
            ...obj,
            isBuiltIn: true,
            status: 'active',
            targetDate: obj.category === 'long-term' ? new Date('2028-01-01') : null,
          },
        });
        seeded++;
      }
    }
    return { seeded, total: defaults.length };
  }
}
