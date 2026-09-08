# META.Stack Correctness Review

> Review date: 2026-09-08
>
> Scope: live META.Stack scoring, directives, signal envelopes, queue routing,
> automated trade handoff, and directive outcome tracking
>
> Initial review policy: documentation only
>
> Remediation started: 2026-09-08 (implementation and regression tests)

## Executive conclusion

META.Stack has a promising separation of protocols, directives, signals, bots,
and broker adapters, but the current pipeline does not preserve several facts
that an automated trading decision requires: score units, evidence direction,
timeframe provenance, input completeness, risk authority, and decision lineage.

The most serious defects are at service boundaries. Individually plausible
calculations are transformed into unsafe decisions when a filtered result is
reused for another protocol, bearish evidence is added to a positive magnitude,
a raw score is labelled as a percentage, or execution blockers are left behind
in the display model. Automated trading should remain disabled until findings
MST-001 through MST-007 have regression tests and fixes.

## Remediation ledger — 2026-09-08

This ledger is deliberately date-stamped. Future developers and agents must not
restore a removed fallback merely because an older UI or endpoint expects it.

| Finding | Status on 2026-09-08 | Change |
|---|---|---|
| MST-001 | Implemented; integration test pending | Cache fingerprint covers complete inputs, directive filters, and directive configuration; cached maps are copied. |
| MST-002 | Implemented and unit tested | Bullish and bearish runtime evidence are separate. LONG/SHORT selects eligible evidence; BOTH selects the stronger normalized side and abstains on ties. |
| MST-003 | Implemented and unit tested | `signalRaw`, `signalMax`, and unrounded `signalPct` are explicit. Queue, consensus, snapshot, confidence, arena, speed-scan, sector, and DB consumers use percentages where required. |
| MST-004 | Partially implemented | Signal envelopes use protocol cadence, load 1d/1h/15m bundles, and fail readiness for incomplete known MTF requirements. Remaining scoring controllers must adopt the loader. |
| MST-005 | Implemented | Only feasible persisted decisions with `scoreId` enter queues; dispatch and confirmation perform a fresh feasibility/market check. |
| MST-006 | Partially implemented | Risk aggregation and hard-gate zero multiplier are fixed and tested. The misleading candle budget gate is `alpha`/excluded until account-risk data exists. |
| MST-007 | Partially implemented | Canonical live scoring records directive outcomes; ticker-to-UUID lookup and bounded horizon prices are fixed. Per-horizon schema state remains future work. |
| MST-008 | Implemented and unit tested | RSI flat handling, ROC zero guard, DeMarker formula, Force Index EMA output, and non-finite directive boundary handling are fixed. |
| MST-009 | Partially implemented | `DirectiveInput.asOf` drives active windows, modifiers, rollover, and calendar directives. Provider-backed directives still need historical snapshot contracts. |
| MST-010 | Partially implemented | Backtest, replay, and protocol-runner call canonical protocol gating. `rankAll()` remains explicitly analytics-only while dashboards are migrated. |
| MST-011 | In progress | Dedicated score-unit, risk-gate, and indicator fixtures were added (12 assertions); broader pipeline contract/property tests remain required. |
| MST-012 | Implemented and unit tested | Stop Guardian no longer averages long-biased raw scores into one confidence for BUY and SELL. It aggregates side-aligned directional evidence, and the stop directives (`chandelier-exit`, `atr-trailing-stop`, `supertrend`) emit symmetric bullish/bearish branches. Mirror tests added. |

Additional critical repair: the backtester no longer passes a ticker as
`strategyId` or reads current DB scores for historical dates. A `protocolId` is
mandatory, custom weight overrides fail explicitly, and every window is scored
through `ProtocolGatingService`.

Severity in this document means:

- **Critical:** can change trade direction, bypass a trade gate, or attach the
  wrong evidence to a decision.
- **High:** can materially corrupt scores, risk reporting, or learning data.
- **Medium:** makes behavior non-deterministic or weakens diagnosis and change safety.

## Findings

### MST-001 — Critical — Directive cache crosses protocol and data boundaries

`DirectivesService.runAll()` keys its cache only by symbol, final base-bar
timestamp, and base-bar count. It does not include the directive filter,
protocol, the OHLCV content, higher-timeframe bars, macro inputs, or a scoring
configuration version (`nest/src/modules/directives/directives.service.ts:201-220`).
The first caller therefore decides the result set returned to every later caller
with the same shallow key. A protocol-scoped call can receive another protocol's
directives; a filtered call can also poison a later full call. The mutable cached
`Map` is returned directly.

The cache is cleared by the automation tick, but `runAll()` also has callers in
backtest, replay, stop-guardian, protocol-runner, and HTTP-triggered scoring paths.
Those callers do not establish a universal cache lifetime.

Required direction:

- Make one immutable `ScoringInputFingerprint` cover protocol/filter identity,
  all timeframe series, external inputs, directive/config versions, and as-of time.
- Prefer request/tick-scoped memoization owned by an explicit evaluation context.
- Add an order-independence test: evaluating A then B must equal B then A.

### MST-002 — Critical — Bearish evidence can increase a BUY score

Protocol scoring adds every directional result into one positive `signalRaw`
total (`nest/src/modules/scoring/protocol-gating.service.ts:480-487`) and then
selects BUY versus SELL from the protocol's declared mode, not from the evidence
(`nest/src/modules/scoring/protocol-gating.service.ts:537-575`). There are no
separate bullish and bearish accumulators and no cancellation/netting rule.

This is unsafe for `BOTH` protocols and for dynamically directional directives.
`classifyDirectiveInclusion()` filters on the class-level `directionBias`, but a
large number of directives declare `neutral` and emit both bullish and bearish
runtime results. For example, `market-structure-bos` gives a bearish break the
same positive score as a bullish break. In a `LONG_ONLY` protocol that bearish
score can still raise the percentage which is ultimately labelled BUY. In a
`BOTH` protocol, `directionMode !== SHORT_ONLY` always selects the long label.

Required direction:

- Represent evidence as `{ bullishRaw, bearishRaw, neutralRaw }`, never one
  unsigned directional total.
- Define and test netting, conflict, abstention, and minimum-margin rules.
- Treat `directionBias` as eligibility and `signalClass` as runtime evidence;
  neither may substitute for the other.
- Add mirror tests proving that mirrored price series produce mirrored actions.

### MST-003 — Critical — Raw scores and percentages are interchanged

`GatedScore.composite` is a risk-adjusted raw sum, while
`meta.compositePct`/`signalPct` is the normalized classification percentage.
The signal layer nevertheless:

- calculates confidence from `gated.composite - 65`;
- checks the percentage-configured pre-trade threshold against
  `gated.composite`; and
- writes `env.composite` into a queue column and property named
  `compositePct`.

Evidence: `nest/src/modules/signals/signal-envelope.service.ts:383-425`,
`:491-509`, `:626-630`, and `:884-894`. The queue bot later trusts that field as
a percentage (`nest/src/modules/automation/automation-loop.service.ts:1313-1336`).
Protocols with larger max scores can therefore pass a percentage gate more
easily even when their normalized signal is weak.

Required direction:

- Replace ambiguous `number` fields with named value objects or branded types:
  `RawScore`, `ScoreMaximum`, `ScorePercent`, and `RiskMultiplier`.
- Reject values outside each unit's domain at persistence boundaries.
- Add contract tests that use protocols with different maxima but identical
  percentages and assert identical classifications and gates.

### MST-004 — Critical — Live scoring does not supply the declared timeframe data

The live best-ladder path always loads 200 `1d` bars and calls protocol gating
without higher-timeframe inputs (`nest/src/modules/signals/signal-envelope.service.ts:327-353`).
It does not use the protocol's `recommendedTimeframe` or the requirements already
computed by `ProtocolDbService.getRequiredBars()`.

This makes multi-timeframe directives incomplete in the production path.
`multi-timeframe-trend` requires `dayBars`, `hourBars`, and `min15Bars` and returns
no evidence when they are absent. The MTF confluence directives silently use the
daily base series as their micro series while macro and meso remain missing.
Intraday/scalping protocols are consequently evaluated from daily data, and
market freshness is inferred at daily cadence.

Required direction:

- Build a typed `MarketDataBundle` from the union of every included directive's
  `minBars` contract before evaluating any directive.
- Record timeframe, source/provider, first/last timestamp, expected cadence,
  completeness, and whether the last candle is closed for every series.
- Refuse to classify or queue a signal when required series are unavailable.
- Test missing, stale, duplicated, out-of-order, and partially formed candles.

### MST-005 — Critical — Automated execution drops feasibility and lineage

The ladder computes `preTradeReady`, conflicts, market status, and execution
blockers, but queue routing contains none of those fields. Routing records are
created before execution feasibility is assessed, and every non-HOLD result is
routable (`nest/src/modules/signals/signal-envelope.service.ts:867-899` and
`:938-970`). Manual signal trades re-run `ExecutionFeasibilityService`; the
automated queue dispatch path does not.

The routing record also sets `scoreId: null` with a comment that it will be
assigned after persistence, but only the envelope is updated later. The routing
record remains null (`nest/src/modules/signals/signal-envelope.service.ts:893`,
`:973-984`). The queue can therefore lose the exact score snapshot that caused
the action.

Required direction:

- Persist an immutable `DecisionSnapshot` first, then queue its ID.
- Re-run the same authoritative feasibility policy immediately before every
  manual and automated broker call.
- Make missing lineage, stale market data, or an unresolved blocker fail closed.
- Test generation-to-execution state changes, including market closure,
  position creation, symbol removal, and risk-limit changes.

### MST-006 — Critical — Risk gates report authority they do not have

`budget-gate` is described as tracking a daily loss/signal budget, but it reads
only OHLCV bars. Its blocking condition requires at least 18 of 20 observations
to exceed 1.2 times the same 20-observation mean for both range and volume
(`nest/src/modules/directives/implementations/budget-gate.directive.ts:53-77`).
Even for one positive measure, 18 observations each above 1.2 times the overall
mean is mathematically impossible: those observations alone would exceed the
total sum. The gate therefore cannot reach its advertised blocking state, and it
does not inspect daily P&L, allocation, orders, or positions.

Separately, `RiskGatingEngine` increments aggregate risk counters after branches
which all `continue` or `break`; `riskScore` consequently remains at its default
50 (`nest/src/modules/scoring/risk-gating-engine.service.ts:47-126`, `:134-137`).
The engine also returns a 0.05 multiplier after a hard gate because its global
floor is applied after setting the multiplier to zero.

Required direction:

- Risk directives must consume an explicit account/risk snapshot, not infer
  portfolio limits from candles.
- A gate labelled “daily loss limit” must be tested against persisted realized
  and unrealized P&L, timezone-defined trading day, pending orders, and failures.
- Add truth-table tests for every risk rule and multiplier chain, including
  exact boundary values and hard-gate dominance.

### MST-007 — Critical — The directive learning loop is disconnected and matures incorrectly

`OutcomeTrackerService.recordOutcomes()` is called only from the retired/flat
`ScoringService.rankAll()` path, not the canonical protocol-gated best-ladder
path. The live automation pipeline therefore does not feed directive outcomes.

When records do exist, `getPriceAt()` compares the ticker stored in
`DirectiveOutcome.symbol` with `MarketBar.symbolId`, which is a UUID foreign key
(`nest/src/modules/scoring/outcome-tracker.service.ts:176-187`). It also marks the
entire record computed after only 15 minutes while querying T+1h immediately and
leaving later horizons null forever (`:119-160`). The lookup has no lower
freshness bound, so an old bar can be accepted as a future-horizon price.

Required direction:

- Capture outcomes from the exact persisted decision snapshot used by the live
  protocol path.
- Resolve ticker to symbol ID explicitly and store both identities.
- Mature each horizon independently only after its due time; require a bar in a
  bounded interval around the target and record missing-data status.
- Never use current accuracy/calibration output for automated weighting until a
  reconciliation audit proves the horizon data is complete and correctly joined.

### MST-008 — High — Shared indicator primitives contain formula defects

At least three shared primitives need independent reference verification:

- Flat prices produce RSI 100 because zero loss is handled without the
  zero-gain/zero-loss case (`nest/src/modules/directives/utils/indicators.ts:25-52`).
  A flat series should be neutral, not overbought.
- DeMarker uses current high minus previous low and previous high minus current
  low (`:446-469`), rather than high-to-high DeMax and low-to-low DeMin changes.
- Force Index calculates an EMA and then discards it, returning aligned raw
  values (`:500-515`).

`roc()` also divides by the prior close without guarding zero (`:147-154`).
There is no dedicated test suite for the shared indicator module even though at
least 46 directive files import it.

Required direction:

- Validate primitives against published formula fixtures and a second,
  independent implementation.
- Cover flat, monotonic, gapped, zero-volume, zero-price, NaN, and minimum-length
  cases.
- Prevent non-finite values from crossing the directive boundary.

### MST-009 — High — Time is implicit, so replay and live scoring are not equivalent

Directive active windows and modifiers use the process clock, not the evaluated
bar's as-of time (`nest/src/modules/directives/directives.service.ts:432-516`).
`rollover-risk` also reads `new Date()` directly. A replay of the same candles can
therefore produce a different score depending on when the replay is run.

`computeMarketStatus()` similarly uses `Date.now()` and three times the inferred
bar cadence. Because the live ladder supplies daily bars, intraday feed outages
can still appear open for days.

Required direction:

- Put an injected `asOf`/clock on the evaluation context and prohibit direct
  wall-clock access in directive calculations.
- Use an explicit market calendar plus feed freshness and broker tradability;
  do not infer execution readiness from a daily candle alone.
- Add deterministic replay tests with a frozen clock and timezone/DST cases.

### MST-010 — High — The secondary scoring path has incompatible semantics

`ScoringService.rankAll()` filters the metadata list when a protocol is supplied
but calls `runAll(input)` without the protocol's directive filter
(`nest/src/modules/scoring/scoring.service.ts:185-214`, `:292-300`). Its result
can therefore contain all directives while the displayed protocol maximum and
count are scoped. It also builds each symbol's denominator only from directives
with a nonzero score or confidence (`:392-435`), making missing data shrink the
denominator and potentially increase the normalized result.

This path is described as retired from automation, yet it remains reachable by
the scoring scheduler and API. Two executable definitions of scoring invite
semantic drift.

Required direction:

- Select one canonical evaluator for live, HTTP, replay, backtest, and scheduler
  entry points.
- Treat missing data as explicit availability, not as a smaller maximum.
- Add parity tests asserting every entry point produces the same decision from
  the same evaluation context.

### MST-011 — Medium — The current test shape cannot protect the pipeline

The backend contains roughly 521 TypeScript source files and 30 spec/e2e spec
files. The directive implementation directory contains about 106 directive
files but only 19 specs. Among scoring, signals, and automation, the only current
service spec is for Stop Guardian. Counts are snapshots, not coverage metrics,
but they show that the service boundaries above have almost no executable
contracts.

The directive guard is valuable and found 81 warnings in this review, including
unproduced input fields and direction-bias contradictions. It currently reports
zero errors, so known-dangerous contradictions do not fail CI.

### MST-012 — Critical — Stop Guardian averages long-biased evidence for both sides

`StopGuardianService` (`nest/src/modules/automation/stop-guardian.service.ts`)
fetched `atr-trailing-stop`, `supertrend`, `chandelier-exit`, and `wick-filter`
and averaged their raw scores into one `avgConfidence`, compared against a 55%
threshold, and applied it to BUY and SELL positions alike. The underlying
directives were long-only: `chandelier-exit` computed only `highestHigh − 3×ATR`
and `atr-trailing-stop` only the long stop. A short position therefore received
bearish, low-magnitude evidence when it was healthy and bullish, high-magnitude
evidence when it was losing — inverting the stop-adjustment decision.

Required direction:

- Emit symmetric evidence in each stop directive (mirror of the long branch).
- Aggregate only side-aligned directional evidence (bullish for BUY, bearish for
  SELL); opposing evidence reduces confidence; missing/neutral is no evidence.
- Add mirror tests proving a mirrored price series produces the mirrored
  `signalClass` with equal magnitude.

Fixed 2026-09-08: directives made symmetric (`chandelier-exit` v1.2.0,
`atr-trailing-stop`/`supertrend` v1.1.0) and the guardian rewritten to
side-aligned aggregation. Mirror + side-aware unit tests added.

## Required testing system

The goal is not a high repository-wide percentage. The goal is exhaustive
behavioral protection around the small set of code that can cause a trade.

### Tier 1 — Numerical primitives

- Table-driven fixtures for every shared indicator using independently verified
  expected vectors.
- Property tests: finite output, bounded output where applicable, translation or
  scale invariance where mathematically valid, and no input mutation.
- Metamorphic/mirror tests for bullish versus bearish symmetry.

### Tier 2 — Directive contracts

Run every registered directive through one common conformance suite:

- deterministic for an explicit `asOf` and immutable input;
- returns finite score/confidence values within declared bounds;
- insufficient required data cannot emit an actionable direction;
- declared feeds and timeframes are present or the result says unavailable;
- runtime direction is compatible with protocol eligibility;
- no network, database, or process-clock dependency in pure unit tests.

Each directive still needs small, formula-specific fixtures for threshold edges.
Promoting a directive to `ready` should require this suite plus a reviewed live
data fixture.

> Implemented 2026-09-08: `nest/scripts/directive-conformance.cjs`
> (`npm --prefix nest run conformance`) runs every compiled directive through
> determinism / finiteness / bounded / direction / insufficient-data / immutability
> checks and prints a pass/fail table. Current result: 153 pass, 2 skip
> (injected deps: `session-open-effect`, `session-timing-filter`), 4 warn
> (date-driven calendar directives score on empty bars by design).

### Tier 3 — Aggregation and risk contracts

Use table-driven protocol examples to prove:

- bullish, bearish, neutral, conflict, and abstain outcomes;
- identical percentages behave identically across different raw maxima;
- protocol overrides change numerator and denominator consistently;
- hard gates always veto and soft multipliers compose exactly;
- cache order and concurrency cannot change results;
- no unavailable directive silently disappears from a denominator.

Require 100% branch coverage for the canonical aggregator and risk engine. These
modules are small enough that uncovered decision branches are unacceptable.

### Tier 4 — Pipeline contract tests

With a disposable database and fake broker, execute:

`MarketDataBundle → directives → protocol aggregation → persisted decision → queue → feasibility → broker request`

Assert units, IDs, timestamps, direction, source bars, config versions, blockers,
and idempotency at every boundary. Include tests where state changes after signal
generation but before execution.

### Tier 5 — Deterministic replay and golden decisions

Maintain compact, versioned market fixtures for representative forex, CFD,
equity, and crypto sessions. A golden decision includes input hashes, directive
versions, config versions, raw directional evidence, normalized percentages,
risk results, and final action. Replaying it must be bit-for-bit stable unless a
reviewed version change updates the golden file.

Do not use golden files to bless unknown behavior: every changed field must be
explained in the review.

### Tier 6 — Broker seam and failure tests

The fake broker should model success, rejection, timeout/unknown outcome,
duplicate idempotency key, partial fill, stale quote, unsupported symbol, and a
position appearing between feasibility and placement. No CI test should call a
real broker.

## CI and review policy

1. Every correctness bug receives a failing regression test before its fix.
2. Changes to score units, direction, risk, timeframe selection, or order payloads
   require pipeline contract tests, not only directive unit tests.
3. Run the directive guard in CI and progressively promote proven contradictions
   from warning to error.
4. Use targeted mutation testing on indicator primitives, aggregation thresholds,
   risk rules, and queue gates. A test suite which cannot kill an inverted
   comparison is not protecting trading behavior.
5. Persist the test fixture and random seed for every property-test failure.
6. A directive cannot be `ready` when required inputs have no live producer.
7. Automated trading cannot be enabled when the decision snapshot lacks source
   data identity, config version, score units, or a passing feasibility result.

## Architecture invariants for future changes

These are review blockers, not style preferences:

1. **One evaluation context:** symbol, as-of time, protocol/config versions,
   complete timeframe bundle, external data, and source provenance travel together.
2. **Units are explicit:** raw score, maximum, percentage, confidence, multiplier,
   price, quantity, and P&L are distinct types/fields.
3. **Direction is conserved:** bullish and bearish evidence remain separate until
   an explicit, tested resolution step.
4. **Missing is not neutral:** unavailable, stale, neutral, and zero are different states.
5. **Risk is authoritative:** a failed or unknown mandatory gate fails closed at
   the final broker boundary.
6. **One scoring implementation:** live, API, replay, backtest, scheduler, and UI
   consume the same canonical evaluator.
7. **Immutable lineage:** every queue entry and trade references the exact decision,
   inputs, directive/config versions, and feasibility check that caused it.
8. **Learning is point-in-time correct:** outcomes use independently matured
   horizons without future leakage or stale-price substitution.

## Suggested remediation order

1. Freeze automated trading; add contract tests for MST-002, MST-003, and MST-005.
2. Replace the cache lifecycle/key and add cross-protocol concurrency tests.
3. Introduce `MarketDataBundle` and explicit score-unit/direction types.
4. Replace placeholder portfolio risk gates with account-backed risk snapshots.
5. Repair and reconcile outcome tracking before using historical accuracy.
6. Verify shared indicator primitives and then audit directive-specific formulas.
7. Retire or delegate every secondary scoring implementation to the canonical path.
