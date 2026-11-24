/**
 * parity-register.ts — EVERY MECHANISM THAT CHANGES A TRADE'S OUTCOME, AND WHETHER THE BACKTEST RUNS IT.
 *
 * ── WHY THIS FILE EXISTS (owner requirement, 2026-11-24) ─────────────────────────────────────────
 * *"A backtest for 5 days scored 4,000.94 profit. Now we need to be sure that the backtesting is
 * genuinely the same as the live trading system: all conditions that affect the outcome have to match."*
 *
 * The defect this closes is not any single row — it is that the row LIST did not exist as data. It lived
 * in a prose table in an issue, which cannot fail a build and cannot be rendered. So: the parity question
 * is now a REGISTER, and `nest/scripts/validate-parity-register.cjs` checks it against the source in both
 * directions on every build.
 *
 * ── ⚠️ HOW A ROW IS VERIFIED, AND WHY THE EVIDENCE IS A FILE PLUS A STRING ──────────────────────
 * Each side declares `files` and a `probe` string that only appears when that side really uses the
 * mechanism — an IMPORT path, a called symbol, or a member access. The validator asserts:
 *
 *   · `shared`      → `probe` present on BOTH sides          (one implementation, not two)
 *   · `gap`         → `probe` present LIVE, ABSENT in the engine
 *   · `population`  → present in the engine, gated by a flag the row names
 *   · `model`       → present on both sides, but not the same NUMBER (a configured approximation)
 *
 * ⚠️ **THE ABSENCE HALF IS THE ONE THAT MATTERS.** A `gap` row fails if the engine starts referencing the
 * live mechanism, because then the register is stale and would keep telling a reader a run cannot
 * reproduce something it now can. That is the defect this repo keeps paying for — a document that reads
 * as a measurement and is really a memory.
 *
 * ⚠️ **A COMMENT IS NOT A CALL.** `pyramid-policy.service.ts` is named in a *note string* inside
 * `trade-config.ts`, so a naive grep for "pyramid" in the engine finds a hit and would report parity that
 * does not exist. Every `probe` below is therefore an import path or a called symbol, never a bare word,
 * and the engine's `pyramid` row carries a probe that only a real import could satisfy.
 *
 * REGISTER: docs/SETTLED-DECISIONS.md row 268
 * GUARD:    nest/scripts/validate-parity-register.cjs (+ --self-test)
 */

export type ParityVerdict =
  /** Both paths call ONE implementation. The only form that survives a later edit. */
  | 'shared'
  /** The engine does not do this at all, so a run overstates what the account would have done. */
  | 'gap'
  /**
   * BOTH sides do it, by DIFFERENT rules — so a run reproduces the mechanism and not its behaviour.
   * ⚠️ Kept separate from `gap`: a gap means the run cannot show this at all, a divergence means it
   * shows something plausible and wrong. The second is harder to notice, so the distinction matters.
   */
  | 'divergent'
  /** The engine has it behind a flag or a narrower population, so the default run differs. */
  | 'population'
  /** Both have it, but one side measures and the other models. Not the same NUMBER. */
  | 'model';

export interface ParitySide {
  /** What to look at, in words a reader can act on. */
  label: string;
  /** Files the probe is looked for in. Relative to the repo root, forward slashes. */
  files: string[];
  /**
   * The string that proves this side uses the mechanism — an IMPORT path, a called symbol, a setting
   * key or a member access. Never a bare word that a comment could satisfy.
   *
   * ⚠️ FOR A SIDE THAT DOES NOT HAVE IT, this is the string whose ABSENCE is asserted: the thing that
   * WOULD appear if the mechanism were wired. A can-never-appear token would pass trivially and guard
   * nothing.
   */
  probe: string;
}

export interface ParityRow {
  id: string;
  mechanism: string;
  /** TRUE when getting this wrong moves money. FALSE for reporting-only mechanisms. */
  affectsOutcome: boolean;
  verdict: ParityVerdict;
  backtest: ParitySide;
  live: ParitySide;
  /** One sentence a reader needs. Never a paragraph — this is a table. */
  note: string;
  /** The issue that owns the work, when the row is not `shared`. */
  issue?: number;
}

/**
 * The register. Order is the trade's own order — what decides ENTRY, then SIZE, then EXIT — so a reader
 * walking it walks one position's life.
 */
/**
 * ── DECISION (2026-11-24, primary) ─────────────────────────────────────────────────────────────
 * WHAT:      the parity question is a REGISTER checked against the source on every build, and a
 *            mechanism is one of FIVE verdicts — not "shared or not".
 * WHY:       collapsing `divergent` into `gap` misreports the risk: a gap means a run cannot show the
 *            mechanism, a divergence means it shows something plausible and WRONG, which is harder to
 *            notice. Collapsing `population` into `shared` would claim parity the default run does not
 *            have. Measured: 8 of 14 outcome-changing mechanisms are not shared verbatim.
 * INSTEAD OF: a prose table in an issue, which cannot fail a build and cannot be rendered by a run.
 * REVERSE BY: reduce the verdict set and the gate names every row that no longer fits; nothing is
 *            stored, so the reversal is the type change alone.
 * REGISTER:  docs/SETTLED-DECISIONS.md row 268
 * GUARD:     nest/scripts/validate-parity-register.cjs --self-test (9 cases) + the register canaried
 *            in both directions on 2026-11-24
 */
export const PARITY_REGISTER: readonly ParityRow[] = [
  {
    id: 'scoring',
    mechanism: 'Scoring and gating',
    affectsOutcome: true,
    verdict: 'shared',
    backtest: {
      label: 'ProtocolGatingService.scoreWithGating',
      files: ['nest/src/modules/backtest/backtest.service.ts'],
      probe: 'scoring/protocol-gating',
    },
    live: {
      label: 'the same service, from the live runner',
      files: ['nest/src/modules/automation/protocol-runner.service.ts'],
      probe: 'scoreWithGating',
    },
    note: 'One scoring path. `validate-single-scoring-path.cjs` already fails the build on a second one.',
  },
  {
    id: 'entry-side',
    mechanism: 'Which side a signal opens',
    affectsOutcome: true,
    verdict: 'shared',
    backtest: {
      label: 'decideEntry()',
      files: ['nest/src/modules/backtest/backtest.service.ts'],
      probe: 'decideEntry',
    },
    live: {
      label: 'the signal→signalClass mapping in the live runner',
      files: ['nest/src/modules/automation/protocol-runner.service.ts'],
      probe: "gated.signal === 'STRONG_BUY'",
    },
    note:
      'Both enumerate the four classes. ⚠️ The engine enumerates; live maps to a class. A substring test '
      + "would route 'STRONG_SELL' LONG — the trap `entry-side.spec.ts` pins.",
  },
  {
    id: 'sizing',
    mechanism: 'Position size',
    affectsOutcome: true,
    verdict: 'shared',
    backtest: {
      label: 'computeSizing()',
      files: ['nest/src/modules/backtest/backtest.service.ts'],
      probe: 'computeSizing',
    },
    live: {
      label: 'the same function, from the automation loop',
      files: ['nest/src/modules/automation/automation-loop.service.ts'],
      probe: 'computeSizing',
    },
    note: "Also `affordable-size.ts` for the broker's minimum — the same floors on both sides.",
  },
  {
    id: 'stop-level',
    mechanism: 'Stop LEVEL',
    affectsOutcome: true,
    verdict: 'shared',
    backtest: {
      label: 'protectiveStopPrice()',
      files: ['nest/src/modules/backtest/backtest.service.ts'],
      probe: 'exit-guardian/protective-stop',
    },
    live: {
      label: 'the same function, from the stop guardian',
      files: ['nest/src/modules/automation/stop-guardian.service.ts'],
      probe: 'exit-guardian/protective-stop',
    },
    note: '5 decimal places on both sides, so a level cannot differ by rounding.',
  },
  {
    id: 'stop-fill',
    mechanism: 'Stop FILL price',
    affectsOutcome: true,
    verdict: 'divergent',
    backtest: {
      label: 'books the exit at the stop level itself',
      files: ['nest/src/common/trading/exit-guardian/position-bar.ts'],
      probe: 'price: state.stop',
    },
    live: {
      label: 'the broker fills at the market',
      files: ['nest/src/modules/automation/stop-guardian.service.ts'],
      probe: 'modifyStop',
    },
    note:
      'The engine assumes a fill exactly at the level. `fillGap` measures how often the bar had already '
      + 'passed it — median 0.34%, p90 4.48%. Opt-in `stopFill` is a maths change (#1335).',
    issue: 1335,
  },
  {
    id: 'tp-fill',
    mechanism: 'Take-profit FILL price',
    affectsOutcome: true,
    /**
     * ⚠️ `model`, NOT `divergent`, AND THE ASYMMETRY IS THE POINT: a stop is a MARKET order and can fill
     * worse than its level, while a take-profit is a LIMIT order and cannot — it fills at the level or
     * better. The engine books TP at `state.target` exactly, which is therefore the faithful case. This
     * row exists because an exit reason with no row would be attributed to nothing by `parity-exposure.ts`.
     */
    verdict: 'model',
    backtest: {
      label: 'closes at the target level exactly',
      files: ['nest/src/common/trading/exit-guardian/position-bar.ts'],
      probe: "kind: 'TP'",
    },
    live: {
      label: 'a resting limit order at the broker fills at the level or better',
      files: ['nest/src/common/trading/close-reason.ts'],
      probe: 'BROKER_TP',
    },
    note:
      'A limit cannot fill worse than its price, so the engine exact-fill assumption is the faithful '
      + 'case — unlike a stop, which is a market order and fills at whatever is offered.',
  },
  {
    id: 'trail',
    mechanism: 'Trailing stop',
    affectsOutcome: true,
    verdict: 'divergent',
    backtest: {
      label: 'the engine tightens the stop on its own bars',
      files: ['nest/src/common/trading/exit-guardian/position-bar.ts'],
      probe: 'state.stop',
    },
    live: {
      label: 'the Stop Guardian, which only RECORDS the decision',
      files: ['nest/src/modules/automation/stop-guardian.service.ts'],
      probe: 'exit-guardian/guardian-stop',
    },
    note:
      'The rule is shared (`guardian-stop.ts`), but the engine cannot compute the directive consensus the '
      + 'guardian needs — the protocol supplies 1 of its 4 inputs. #1339.',
    issue: 1339,
  },
  {
    id: 'time-stop',
    mechanism: 'Time stop / be-flat-by',
    affectsOutcome: true,
    verdict: 'shared',
    backtest: {
      label: 'decideExitTrigger()',
      files: ['nest/src/modules/backtest/backtest.service.ts'],
      probe: 'decideExitTrigger',
    },
    live: {
      label: 'the same function, from the time-stop service',
      files: ['nest/src/modules/automation/position-time-stop.service.ts'],
      probe: 'decideExitTrigger',
    },
    note: 'Extracted in #1242 so one function blames the right mechanism when both are due.',
  },
  {
    id: 'money-target',
    mechanism: 'Absolute money target',
    affectsOutcome: true,
    verdict: 'shared',
    backtest: {
      label: 'via managePositionBar() → position-bar.ts',
      files: ['nest/src/modules/backtest/backtest.service.ts'],
      probe: 'exit-guardian/position-bar',
    },
    live: {
      label: 'moneyTargetVerdict(), from the stop guardian',
      files: ['nest/src/modules/automation/stop-guardian.service.ts'],
      probe: 'moneyTargetVerdict',
    },
    note: 'One rule (`money-target.ts`), reached by the engine through the shared bar walk.',
  },
  {
    id: 'sim-tsl',
    mechanism: 'Simulated trailing stop (per bot)',
    affectsOutcome: true,
    verdict: 'gap',
    backtest: {
      label: 'not modelled',
      files: ['nest/src/modules/backtest/backtest.service.ts'],
      probe: 'simulatedTslState',
    },
    live: {
      label: 'simulatedTslState(), observed by the guardian',
      files: ['nest/src/modules/automation/stop-guardian.service.ts'],
      probe: 'simulatedTslState',
    },
    note:
      '⚠️ The live side only OBSERVES (#936): it records that the moment occurred and moves no stop. '
      + '`sim_tsl_event` held 0 rows at last measurement, so it has never fired.',
    issue: 936,
  },
  {
    id: 'cooldown',
    mechanism: 'Cooldown between entries',
    affectsOutcome: true,
    verdict: 'population',
    backtest: {
      label: "applied only with admission: 'portfolio'",
      files: ['nest/src/modules/backtest/selection-run.service.ts'],
      probe: 'cooldown',
    },
    live: {
      label: 'applied to every dispatch',
      files: ['nest/src/modules/automation/automation-loop.service.ts'],
      probe: 'cooldown',
    },
    note:
      'The DEFAULT run measures the independent population — every signal walked alone — so it can show '
      + 'more trades than the bot could have taken. Ask for `admission: "portfolio"`. #1325.',
    issue: 1325,
  },
  {
    id: 'concurrency',
    mechanism: 'Max concurrent positions',
    affectsOutcome: true,
    /**
     * ⚠️ MEASURED AS `population`, NOT `gap` — and getting this wrong the first time is the lesson.
     * The first draft called it a gap on the strength of the bot COLUMN being unread live. But the engine
     * does model a cap under `admission: 'portfolio'` (`portfolio-admission.ts`), so the mechanism
     * EXISTS; what differs is that the default run does not apply it. That is a population difference.
     */
    verdict: 'population',
    backtest: {
      label: "applied only with admission: 'portfolio'",
      files: ['nest/src/modules/backtest/portfolio-admission.ts'],
      probe: 'maxConcurrent',
    },
    live: {
      label: 'the GLOBAL risk.maxOpenPositions cap, enforced on every dispatch',
      files: ['nest/src/modules/trading/trading-strategy.service.ts'],
      probe: 'risk.maxOpenPositions',
    },
    note:
      'The bot column is NOT read live — the live cap is broker-wide. The rule exists in three places and '
      + 'only one is live, so a default run measures the independent population.',
    issue: 1325,
  },
  {
    id: 'pyramid',
    mechanism: 'Pyramiding (size into a winner)',
    affectsOutcome: true,
    verdict: 'gap',
    backtest: {
      label: 'not modelled — one trade per signal, no blended entry',
      files: ['nest/src/modules/backtest/backtest.service.ts'],
      probe: "from '../../modules/trading/pyramid-policy.service'",
    },
    live: {
      label: 'pyramid-policy.service.ts, called by the automation loop',
      files: ['nest/src/modules/automation/automation-loop.service.ts'],
      probe: 'pyramid',
    },
    note:
      '⚠️ `trade-config.ts` NAMES the live service in a note string and imports nothing, which is why a '
      + 'bare-word search reports parity that does not exist. #1242 extracted the decision.',
    issue: 1242,
  },
  {
    id: 'costs',
    mechanism: 'Spread, slippage, commission',
    affectsOutcome: true,
    verdict: 'model',
    backtest: {
      label: 'the run’s configured spread + slippage',
      files: ['nest/src/modules/backtest/execution-costs.ts'],
      probe: 'slippage',
    },
    live: {
      label: 'whatever the broker actually charged, recorded at close',
      files: ['nest/src/modules/providers/position-sync.service.ts'],
      probe: 'commission',
    },
    note:
      'Both apply a cost; only the live figure is a measurement. A run’s P/L is therefore an estimate at '
      + 'the configured cost, not at the broker’s.',
  },
  {
    id: 'bars',
    mechanism: 'The bars themselves',
    affectsOutcome: true,
    verdict: 'model',
    backtest: {
      label: 'one publisher per symbol per run (row 250)',
      files: ['nest/src/modules/backtest/backtest.service.ts'],
      probe: 'barProvider',
    },
    live: {
      label: 'the live bridge feed',
      files: ['nest/src/modules/market-data/bar-refresh.service.ts'],
      probe: 'refresh',
    },
    note:
      'Different by construction. A stale or misaligned series changes every number, which is why #783 '
      + 'and #1337 exist.',
  },
];

/** Counts for a header or a status line — never a substitute for the rows. */
export function paritySummary(rows: readonly ParityRow[] = PARITY_REGISTER) {
  const byVerdict: Record<ParityVerdict, number> = { shared: 0, divergent: 0, gap: 0, population: 0, model: 0 };
  for (const r of rows) byVerdict[r.verdict] += 1;
  return {
    total: rows.length,
    ...byVerdict,
    /** Mechanisms that move money and are NOT shared with live — the number that matters. */
    outcomeGaps: rows.filter((r) => r.affectsOutcome && r.verdict !== 'shared').length,
  };
}
