#!/usr/bin/env node
/**
 * validate-pipeline-contracts.cjs — build-time enforcement of the META.Stack pipeline contracts.
 * =============================================================================================
 * Companion to `.github/instructions/meta-stack-contracts.instructions.md` (the signpost hub).
 * Wired into `prebuild`, so it gates every backend build and every CI run.
 *
 * WHY THIS EXISTS
 * ---------------
 * The macro architecture here is settled. The damage comes from the *substrate* being
 * re-derived locally: how bars are loaded, what order they are in, which cadence they
 * represent, what a score unit means, and when a gate may say "safe to trade". Every such
 * re-derivation produced plausible numbers with no error, so nothing caught it:
 *
 *   - #750 — the MT5 bridge stamped broker SERVER time as UTC (a *lying comment* said the
 *           epochs were already UTC). Every bar landed ~3h in the future, which made the
 *           tradability gate fail OPEN on stale data.
 *   - #751 — two hand-rolled bar queries lost the `timeframe` filter (mixing cadences) and
 *           one took the OLDEST 200 bars (`asc + take`), scoring 34 symbols on ~4-month-old data.
 *
 * This script is deliberately **zero-tolerance — there is no warning budget**. A guard that
 * emits warnings (see `directive-guard.cjs`, which reports 80–200) gets ignored, which is
 * worse than no guard because it looks like coverage. Rules are therefore few, each traceable
 * to a real incident, and every failure says what to do instead.
 *
 * THREE KINDS OF CHECK
 *   1. Canaries  — the canonical mechanism still exists (someone "simplified" it away).
 *                  Markers are checked against comment-stripped source, so commenting a
 *                  mechanism out does NOT satisfy a canary.
 *   2. Scans     — banned patterns are absent (a second way of doing a settled job).
 *   3. Wiring    — every invariant has a guard AND a QA entry, and no QA entry points at an
 *                  invariant that no longer exists. This is what turns the project's
 *                  four-page mirror from a convention into a contract.
 *
 * Usage (from nest/):  node scripts/validate-pipeline-contracts.cjs
 * Exit code: 1 on any failure, 0 otherwise.
 */

const fs = require('fs');
const path = require('path');

const NEST_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(NEST_ROOT, '..');
const CONTRACTS_DOC = path.join(REPO_ROOT, '.github', 'instructions', 'meta-stack-contracts.instructions.md');
const QA_CHECKLIST = path.join(REPO_ROOT, 'src', 'data', 'qa-checklist.js');
const PROBE_SCRIPT = path.join(NEST_ROOT, 'scripts', 'contract-probe.cjs');

/** Where a hand-rolled bar window is forbidden (scoring / decision paths). */
const BAR_WINDOW_SCOPE = [
  'src/modules/scoring',
  'src/modules/directives',
  'src/modules/automation',
  'src/modules/signals',
];
/** Where clamping a score to 100 is forbidden. */
const SCORE_CLAMP_SCOPE = ['src/modules/directives', 'src/modules/scoring'];
// #908 — `recommendedTimeframe` is FREE TEXT; anything using it as a bar cadence must go
// through selectBaseTimeframe(). Scope: every module (the bug was in automation, but the
// class is "any bar-readiness/count caller").
const RAW_CADENCE_SCOPE = ['src/modules'];

/**
 * Where a directive may not fabricate a reading (INV-NO-FABRICATED-READING).
 *
 * Directives only — the fault is a directive returning a number it did not measure.
 * `risk-gating-engine.service.ts` and `protocol-gating.service.ts` legitimately hold the
 * literals this scan looks for (they CONSUME `unmeasured`), so they are out of scope.
 */
const FABRICATION_SCOPE = ['src/modules/directives/implementations'];

/**
 * Where dividing a signal total by an OBSERVED evidence sum is forbidden (#758).
 *
 * The protocol percentage has to be `earned / capacity` where capacity is CONFIGURED. An
 * observed denominator (`signalMax` accumulated only from directives that produced evidence
 * this tick) moves with the data: RSI goes neutral, the denominator shrinks, and the *same*
 * market condition scores differently run to run. It also produces a silent phantom — a
 * group whose evidence sums to 0 yields 0/0, which reads as a legitimate 0% HOLD and was
 * counted as "scored" in the envelope (`protoScored++`), so a stall looked like a decision.
 *
 * ⚠️ Rule precision matters more than reach here — a guard that fires on correct code gets
 * switched off. Only the exact shape `(signalMax | observedMaxTotal | totalMax) ?` used as a
 * divisor is flagged, and only in the scoring path.
 */
const DENOMINATOR_SCOPE = ['src/modules/scoring'];
/**
 * The forbidden shapes. Two are anchored, because a bare identifier is not specific enough:
 * the file legitimately contains `capacityMaxTotal > 0 ? capacityMaxTotal : totalMax` (the
 * CANONICAL form, observed sum only as a last-resort fallback when capacity is 0) and
 * `hasDirectionalEvidence = capacityMaxTotal > 0 ? … : totalMax > 0` (a boolean, not a
 * divisor). Anchoring on the assignment/division target is what separates them from the
 * regression. Precision here is load-bearing: a guard that fires on the canonical code gets
 * switched off, which is worse than no guard because it looks like coverage.
 */
const OBSERVED_DENOMINATOR_PATTERNS = [
  // e.g. `const signalDenominator = totalMax > 0 ? totalMax : 1;`
  { re: /=\s*(signalMax|observedMaxTotal|totalMax)\s*>\s*0\s*\?/, what: 'assigns the observed sum as the denominator' },
  // e.g. `const pct = (signalRaw / signalMax) * 100;`
  { re: /\/\s*(signalMax|observedMaxTotal)\b/, what: 'divides directly by the observed sum' },
];

function scanObservedDenominator() {
  for (const scope of DENOMINATOR_SCOPE) {
    for (const file of walk(path.join(NEST_ROOT, scope))) {
      const src = stripComments(fs.readFileSync(file, 'utf8'));
      const fileRel = rel(file);
      for (const { re, what } of OBSERVED_DENOMINATOR_PATTERNS) {
        const global = new RegExp(re.source, 'g');
        let m;
        while ((m = global.exec(src)) !== null) {
          // The canonical line names `capacityMaxTotal` / `configuredSignalMax` — never flag it.
          const lineStart = src.lastIndexOf('\n', m.index) + 1;
          const lineEnd = src.indexOf('\n', m.index);
          const line = src.slice(lineStart, lineEnd === -1 ? src.length : lineEnd);
          if (/capacityMaxTotal|configuredSignalMax/.test(line)) continue;
          const lineNo = src.slice(0, m.index).split('\n').length;
          fail(
            'no-observed-denominator',
            `${fileRel}:${lineNo} ${what}`,
            'INV-STABLE-DENOMINATOR: divide by the protocol\'s CONFIGURED directional capacity (`capacityMaxTotal`) so the same market condition scores the same on every tick, and so a group contributing 0 does not become a 0/0 "HOLD". Keep the observed sum for the `observedSignalMax` diagnostic only (#758).',
          );
        }
      }
    }
  }
}

/**
 * scanStaleScoringGuard() — INV-NO-STALE-SCORING (#827, #841).
 *
 * THE CONTRACT. A row in `directiveoutcome` claims a PREDICTION was made. A prediction made from
 * bars that stopped days ago is not a prediction — it is a plausible number about a moment that
 * has passed, and nothing downstream can tell the difference. So the ONE writer of
 * `directiveoutcome` must be unreachable while the symbol's bars are stale.
 *
 * WHAT WAS TRUE, AND WHY A GUARD IS STILL NEEDED. `SignalEnvelopeService.buildEnvelope()` is the
 * only caller of `recordOutcomes()`, and since #827 it returns early via `everyCadenceStale()`
 * before recording. So the invariant currently HOLDS — but only because one function happens to
 * sit above another. Nothing enforced it:
 *
 *   • a SECOND caller could be added anywhere in the codebase and would write rows freely;
 *   • the check could be replaced by a base-cadence-only variant, which LOOKS equivalent and is
 *     not. That exact regression nearly shipped on 2026-09-16: gating on the base cadence alone
 *     skipped 11 symbols that were alive on 5-6 other timeframes (SPY 1m=12h stale but 5m=0.1h
 *     fresh; XAUUSD 1m=8.6h but 15m=0.0h). A per-base-cadence check silently reclassifies healthy
 *     symbols as dead.
 *
 * ⚠️ WHY THIS IS A SCAN AND NOT A CANARY. A canary asserts a marker is PRESENT; it cannot say
 * "there is exactly one caller, and the guard runs BEFORE it in the same function body". Both
 * halves of that are the contract. Position is checked because `everyCadenceStale` existing
 * somewhere in the file while `recordOutcomes` sits ABOVE it would satisfy a mere presence check.
 */
function scanStaleScoringGuard() {
  const WRITER = 'recordOutcomes';
  const GUARD_FN = 'everyCadenceStale';
  /** The definition itself, which is not a call site. */
  const DEFINITION = `async ${WRITER}(`;
  /** The over-rejecting near-miss: a freshness test on ONE cadence, not all of them. */
  const BASE_ONLY_FNS = ['isStaleForCadence', 'cadenceStaleMs'];

  const callSites = [];

  for (const scope of ['src/modules']) {
    for (const file of walk(path.join(NEST_ROOT, scope))) {
      if (file.endsWith('.spec.ts') || file.endsWith('.test.ts')) continue;
      const raw = fs.readFileSync(file, 'utf8');
      const src = stripComments(raw);

      // Count genuine call sites, ignoring the method definition.
      let idx = 0;
      while ((idx = src.indexOf(`${WRITER}(`, idx)) !== -1) {
        const before = src.slice(Math.max(0, idx - 12), idx);
        const isDefinition = before.includes('async ') || before.includes('function ');
        if (!isDefinition) {
          callSites.push({ file, src, at: idx });
        }
        idx += WRITER.length;
      }
    }
  }

  if (callSites.length === 0) {
    fail(
      'no-stale-scoring',
      `no call site of \`${WRITER}()\` found under nest/src/modules`,
      'INV-NO-STALE-SCORING: the scan could not find the writer it is meant to guard. ' +
        'A verifier that cannot find its target must ERROR — a renamed method would otherwise ' +
        'turn this guard green while `directiveoutcome` was written by something unchecked. ' +
        'Update the WRITER constant in scanStaleScoringGuard() if the method was renamed (#841).',
    );
    return;
  }

  if (callSites.length > 1) {
    fail(
      'no-stale-scoring',
      `${callSites.length} call sites of \`${WRITER}()\` — expected exactly 1 (${callSites
        .map((c) => rel(c.file))
        .join(', ')})`,
      'INV-NO-STALE-SCORING: every writer of `directiveoutcome` must sit behind the staleness ' +
        'guard. A second call site inherits no such guarantee and will happily record predictions ' +
        'from dead bars. Route the new caller through buildEnvelope(), or extend this guard ' +
        'deliberately — do not add a site and leave the guard ignorant of it (#827, #841).',
    );
  }

  for (const site of callSites) {
    const fileRel = rel(site.file);
    const guardAt = site.src.indexOf(`${GUARD_FN}(`);

    if (guardAt === -1) {
      // Distinguish the two ways this goes wrong — they need different fixes.
      const baseOnly = BASE_ONLY_FNS.filter((f) => site.src.includes(`${f}(`));
      fail(
        'no-stale-scoring',
        `${fileRel} calls \`${WRITER}()\` but never calls \`${GUARD_FN}()\`` +
          (baseOnly.length
            ? `  (found ${baseOnly.join(', ')} instead — the BASE-CADENCE-ONLY variant)`
            : ''),
        baseOnly.length
          ? `INV-NO-STALE-SCORING: \`${baseOnly.join('` / `')}\` tests ONE cadence. A symbol can be ` +
              'stale on its base cadence and perfectly alive on another — measuring this on ' +
              '2026-09-16, a base-cadence-only check skipped 11 symbols that had fresh bars ' +
              '(SPY 1m=12h stale, 5m=0.1h fresh; XAUUSD 1m=8.6h, 15m=0.0h). Use ' +
              `\`${GUARD_FN}()\`, which requires EVERY cadence to be stale before declaring the ` +
              'symbol dead (#827, #841).'
          : `INV-NO-STALE-SCORING: writing a prediction from stale bars produces a plausible ` +
              'number for a moment that has passed. Guard the call with ' +
              `\`${GUARD_FN}()\` and return an empty envelope (#827, #841).`,
      );
      continue;
    }

    if (guardAt > site.at) {
      fail(
        'no-stale-scoring',
        `${fileRel}: \`${GUARD_FN}()\` is called AFTER \`${WRITER}()\` — the guard does not protect the write`,
        `INV-NO-STALE-SCORING: the staleness check must run BEFORE anything is recorded, or the ` +
          `row is already written by the time the symbol is judged dead. Move the ` +
          `\`${GUARD_FN}()\` early-return above the \`${WRITER}()\` call (#827, #841).`,
      );
    }
  }
}

function checkStaleWhitelist() {
  for (const w of WHITELIST) {
    // A rule enforced by canaries declares no scan name, so it can never appear in `held`.
    // Without this the entry would always look stale and fail the build wrongly.
    if (w.rule === 'canary-enforced') continue;
    const covered = held.some((h) => h.startsWith(`${w.rule}  ${w.file}`));
    if (!covered) {
      fail(
        'stale-whitelist',
        `whitelist entry for ${w.file} (${w.rule}) no longer matches a violation — the site was migrated or removed`,
        `Delete that entry from WHITELIST in scripts/validate-pipeline-contracts.cjs. The list is debt and must only shrink (${w.issue}).`,
      );
    }
  }
}

/**
 * Known deviations, each with a reason and a tracking issue.
 *
 * ⚠️ These are DEBT, not exemptions. When a site is migrated the entry MUST be deleted —
 * a stale entry fails the guard (see checkStaleWhitelist), so this list can only shrink.
 *
 * 2026-09-10: all four bar-window entries were removed by #754 (the sites were migrated to
 * `MarketDataService.getBars()`), leaving only the two #755 score-unit reviews. The build
 * failing on those stale entries is what proved the migration complete.
 */
const WHITELIST = [];

/**
 * Canaries — the mechanism each invariant depends on must still be present.
 *
 * ⚠️ Markers are checked against **comment-stripped** source (see `stripComments`). That is
 * deliberate and load-bearing: commenting a mechanism out must NOT satisfy a canary. This was
 * proven the hard way — an earlier version checked raw source, and commenting out
 * `return bars.reverse()` in `getBars()` still passed, because the marker lived on inside the
 * comment. A guard that a `//` defeats is worse than no guard, since it reports green.
 */
const CANARIES = [
  {
    id: 'INV-BAR-ORDER',
    root: 'nest',
    file: 'src/modules/directives/directives.service.ts',
    markers: ['normalizeDirectiveBars', 'bars.sort('],
    hint: 'The directive boundary must coerce timestamps AND sort bars oldest -> newest (#751).',
  },
  {
    id: 'INV-BAR-WINDOW',
    root: 'nest',
    file: 'src/modules/market-data/market-data.service.ts',
    // `.reverse()` alone is NOT specific enough — this file contains three unrelated reverse
    // calls (a losers-list reverse, an array copy), so a bare marker could pass while getBars()
    // was broken. Anchor on the exact statement inside getBars().
    markers: ["orderBy: [{ timestamp: 'desc' }]", 'return bars.reverse();'],
    hint: 'getBars() must select the NEWEST N (desc + take) and return them oldest -> newest.',
  },
  {
    id: 'INV-CANONICAL-LOADER',
    root: 'nest',
    file: 'src/modules/market-data/market-data.service.ts',
    markers: ['async getBars('],
    hint: 'MarketDataService.getBars() is the ONE bar-window loader.',
  },
  {
    id: 'INV-SINGLE-CADENCE',
    root: 'nest',
    file: 'src/common/utils/timeframe.ts',
    markers: ['selectBaseTimeframe'],
    hint: 'Cadence resolution lives in the shared util so every caller can reach it.',
  },
  {
    id: 'INV-SINGLE-CADENCE',
    root: 'nest',
    file: 'src/modules/scoring/arena.controller.ts',
    markers: ['selectBaseTimeframe'],
    hint: 'The Arena must resolve cadence per protocol, not take whatever rows are newest.',
  },
  {
    id: 'INV-SINGLE-CADENCE',
    root: 'nest',
    file: 'src/modules/automation/automation-loop.service.ts',
    markers: ['selectBaseTimeframe'],
    hint: 'The automation loop’s bar-readiness gate must resolve free-text cadence through the shared util (#908).',
  },
  {
    id: 'INV-UTC-TIMESTAMPS',
    root: 'repo',
    file: 'scripts/mt5-bridge/mt5_bridge_v2.py',
    markers: ['detect_server_utc_offset', 'serverUtcOffsetSeconds'],
    hint: 'MT5 epochs are broker SERVER time; utc_iso() must subtract the measured offset (#750).',
  },
  {
    id: 'INV-UTC-TIMESTAMPS',
    root: 'nest',
    file: 'src/modules/alerts/alert-trigger.service.ts',
    markers: ['bridge-clock-skew'],
    hint: 'A bridge that loses the offset telemetry must raise an alert, not silently shift time.',
  },
  {
    id: 'INV-GATE-FAILS-CLOSED',
    root: 'nest',
    file: 'src/modules/directives/market-status.ts',
    markers: ['FUTURE_BAR_TOLERANCE_MS', 'indeterminate bar cadence'],
    hint: 'computeMarketStatus must fail CLOSED on future-dated bars and unmeasurable cadence.',
  },
  {
    id: 'INV-STABLE-DENOMINATOR',
    root: 'nest',
    file: 'src/modules/scoring/protocol-gating.service.ts',
    // The denominator must be the CONFIGURED capacity, and the persisted percentage must
    // divide by it rather than by whatever happened to fire this tick (#758).
    markers: ['configured-capacity', 'configuredSignalMax'],
    hint: 'signalPct must divide by the protocol\'s configured directional capacity (capacityMaxTotal), not by the observed evidence sum — an observed denominator moves every time a directive goes quiet, so the same reading scores differently between ticks and a group that contributes 0 makes 0/0 read as a HOLD (#758).',
  },
  {
    id: 'INV-ONE-ROW-PER-RUN',
    root: 'nest',
    file: 'src/modules/scoring/score-history.service.ts',
    // The reader-side tolerance for the duplicate write. If this helper is removed the
    // Ladder silently reverts to reading whichever of the two rows is newer.
    markers: ['collapseDuplicateWrites'],
    hint: 'getRuns() must collapse the per-tick duplicate (symbol, protocol, minute) rows and keep the one carrying the gating breakdown. Two services both create a Score row per tick; the signals-workbench row is newer but thin (8 keys, no rawMax/marketStatus), so reading rows[0] loses the denominator and the market status.',
  },
  {
    id: 'INV-ADAPTIVE-TARGET-MONOTONIC',
    root: 'nest',
    file: 'src/modules/scoring/adaptive-target.ts',
    // The peak must be a high-water mark. If this marker disappears, someone has replaced
    // it with a rolling window or a decay, which is the exact change that lets a quiet
    // period silently lower the bar. `observeAdaptiveTarget` returning null when the new
    // reading does not raise the peak IS the monotonicity guarantee.
    markers: ['raw <= current && state.samples > 0', 'ADAPTIVE_TARGET_FLOOR_RATIO'],
    hint: 'The Adaptive Target peak may only ever increase — never a rolling window, never decayed, never lowered by a quiet period. It is also floored at 25% of configured capacity so a near-dead protocol cannot be normalised into looking healthy. A falling target would mask a directive that has stopped working: the bar lowers to match and the card still reads healthy (#685). Guarded by the explicit monotonicity assertions in adaptive-target.spec.ts.',
  },
  {
    id: 'INV-QUEUE-TERMINAL-STATE',
    root: 'nest',
    file: 'src/modules/automation/automation-loop.service.ts',
    // A real execution is the ONLY thing that may consume an entry, and the
    // stranded-row recovery must stay present. Both markers are load-bearing:
    // dropping the first re-introduces the permanent strand; dropping the second
    // leaves rows already stuck in the field with no way back.
    markers: ["status = 'executed'", "WHERE status = 'executing'"],
    hint: 'A queue entry is consumed only by a real EXECUTED (status -> `executed`), and the recovery pass must return rows stranded in `executing` to `pending`. Writing `executing` for QUEUED as well made a signal awaiting confirmation strand permanently and silently removed the bot from trading that symbol — GBPUSD sat in `executing` from 13:07 with no ticket (#759).',
  },
  {
    id: 'INV-GATE-RECONCILED',
    root: 'nest',
    file: 'src/modules/signals/signal-envelope.service.ts',
    // The reconciliation must stay wired to the gate AND must never fire for an
    // explicit override — those two properties ARE the contract.
    markers: ['reconcileGateWithBots', "resolution.source === 'override'"],
    hint: 'The pre-trade gate must be reconciled DOWN to the lowest participating bot bar, and an explicit `signals.gate.<protocol>` override must be left verbatim. Both halves are required: without the reconciliation the gate demands a bar no bot asked for; without the override guard a convenience rule silently overrules a human instruction (#759).',
  },
  {
    id: 'INV-SESSION-VISIBLE',
    root: 'nest',
    file: 'src/modules/trading/session-window.ts',
    // The audit is the only thing that reports a city NAME being read as a clock.
    markers: ['auditNameVsWindow', 'CITY_WORDS'],
    hint: 'auditNameVsWindow() must classify whether a bot NAME and its sessionWindow agree. A city name over a session-tag window is ambiguous — report both readings rather than assuming a clock (#759).',
  },
  {
    id: 'INV-SESSION-VISIBLE',
    root: 'nest',
    file: 'src/modules/automation/automation-loop.service.ts',
    markers: ['sessionGated', 'getSessionGated'],
    hint: 'The session gate must PUBLISH which bots it is holding shut. A deduped log line alone made three gated forex bots indistinguishable from idle ones, so AUDUSD scored 100% STRONG_BUY while shut (#759).',
  },
  {
    id: 'INV-TRADEABLE-ROUTE',
    root: 'nest',
    file: 'src/modules/trading/execution-feasibility.service.ts',
    // BOTH markers are the contract, and they guard different halves:
    //   - `symbol-not-tradeable` is the blocker that stops an untradeable symbol being
    //     offered at all. Without it the card reads actionable and the broker refuses
    //     the click — the measured US500 failure.
    //   - `getSymbolTradability` is the accessor that supplies the per-BROKER constraint
    //     the blocker needs. Without it `getSymbols()` only proves the symbol is LISTED,
    //     which is the fact that made this bug look like a working setup.
    markers: ['symbol-not-tradeable', 'getSymbolTradability'],
    hint: 'A symbol may be offered for trade only when the broker that will receive the order reports it tradeable (tradeMode 4) and the size clears that broker\'s volume floor. US500 is LISTED on both bridges and tradeable on only one (tradeMode 0 on MetaQuotes :5000, 4 on Pepperstone :5001), and its floor is 0.1 lots against a 0.01 manual default — so the card read as fully actionable while the bridge would have refused the click twice over (#US500).',
  },
  // ⚠️ Added 2026-10-01 (#1050). These two were MINTED INSIDE `validate-architecture-docs.cjs`
  // (L151–171) and never registered, so a QA entry that cited them failed `prebuild` with
  // `[stale-qa-mirror] … which is not in the contracts doc` — a build red for every agent, whose
  // message read as "the invariant no longer exists" when in fact the invariant existed and the
  // REGISTER was incomplete. The canary is the registration: it asserts the two pure check
  // functions still exist in the owning script, so deleting the check cannot leave the row
  // claiming an enforcement that is gone. The check itself is run on demand
  // (`node scripts/validate-architecture-docs.cjs`, `--self-test` drives both directions).
  {
    id: 'INV-ARCH-DOCS-1',
    root: 'repo',
    file: 'scripts/validate-architecture-docs.cjs',
    // ⚠️ Anchored on the DEFINITION, not the bare name. A bare `checkSectionParity` marker
    // PASSED with the function renamed, because the name survives in the self-test call sites —
    // measured 2026-10-01, first canary attempt reported green with the mechanism removed.
    markers: ['function checkSectionParity('],
    hint: 'The two architecture surfaces must list the SAME section index. A section added to one and not the other drifted silently and was caught by a human one batch late (batch #16).',
  },
  {
    id: 'INV-ARCH-DOCS-2',
    root: 'repo',
    file: 'scripts/validate-architecture-docs.cjs',
    markers: ['function checkReferenceIsDerived('],
    hint: 'Every `export const` in architecture-reference.js must exist on the page — an orphan lets an agent read a capability the owner cannot see. The direction is one-way on purpose: page-only framing is permitted.',
  },
];

/** Invariants enforced by a scan rather than a canary. */
const SCAN_ENFORCED = {
  'INV-CANONICAL-LOADER': 'no-direct-bar-window',
  'INV-BAR-WINDOW': 'no-oldest-n-window',
  'INV-SCORE-MAGNITUDE': 'no-score-clamp',
  'INV-STABLE-DENOMINATOR': 'no-observed-denominator',
  'INV-MTF-BUNDLE': 'no-bundle-less-scoring',
  'INV-CADENCE-COVERAGE': 'timeframe-refresh-coverage',
  'INV-NO-FABRICATED-READING': 'no-fabricated-baseline',
  // Enforced by a scan that checks POSITION and CARDINALITY, not merely presence: the one
  // writer of `directiveoutcome` must call `everyCadenceStale()` BEFORE it records (#841).
  'INV-NO-STALE-SCORING': 'no-stale-scoring',
  // Enforced by its own dedicated script (`validate-directive-group-kind.cjs`),
  // which runs earlier in `prebuild`. It is listed here because the wiring check
  // requires every invariant to name a guard, and a companion script is a guard.
  'INV-GATE-MEMBERSHIP': 'validate-directive-group-kind.cjs',
};

/** Invariants enforced by the live probe (a runtime check cannot be static). */
const PROBE_ENFORCED = {
  'INV-NO-FUTURE-ROWS': 'scripts/contract-probe.cjs',
  'INV-CADENCE-COVERAGE': 'scripts/contract-probe.cjs',
  'INV-PROVIDER-REACHABLE': 'scripts/contract-probe.cjs',
  // Needs the live registry: a hint's target must be an ACTIVE symbol with delivered
  // bars. The unit spec (symbol-hint-validity.spec.ts) guards the table's contents
  // against a known-good list; this probe guards it against reality.
  'INV-NO-SYMBOL-GUESSING': 'scripts/contract-probe.cjs',
  // Needs the live table: "is any watchlist name ambiguous" is a property of the data,
  // not of the code. The spec (watchlist-identity.spec.ts) guards that resolution
  // PREFERS an FK and PINS its ordering; this probe guards that duplicates are gone.
  'INV-WATCHLIST-IDENTITY': 'scripts/contract-probe.cjs',
  // Needs the live table, and this is the point: EVERY other bar invariant is a
  // marker-presence canary that verifies a helper EXISTS, never that the rows are
  // correct. That blind spot is why ~27,376 phantom bars sat undetected (#783). The
  // unit spec (timeframe.spec.ts) pins the alignment arithmetic; this probe asserts
  // the stored timestamps actually sit on valid boundaries.
  'INV-BAR-ALIGNED': 'scripts/contract-probe.cjs',
  // Gate 3 (STATE). Needs the live database: the seeder is UPSERT-ONLY, so a removal
  // or move in the seed is a silent no-op in the DB, and re-seeding cannot converge
  // them. Build gates cannot see this — they pass while the live system is unchanged,
  // which is exactly how 30 orphan rows sat there with every build green (#789/#792).
  'INV-SEED-DB-CONSISTENT': 'scripts/contract-probe.cjs',
  // Needs the LIVE bridges: "will the broker that receives this order accept it" is a
  // property of BROKER × SYMBOL, so no static check can answer it. Measured case (#US500):
  // tradeMode 0 on :5000 vs 4 on :5001 for the same ticker.
  'INV-TRADEABLE-ROUTE': 'scripts/contract-probe.cjs',
  // Needed because NO build-time check could catch it: the API is STOPPED during a build
  // (prisma generate holds the query-engine DLL), so prebuild is the one place this cannot
  // run. A retention config change left `directiveoutcome` on an unindexed column and
  // /api/system/health-dashboard 504'd at 32s against a 30s gateway timeout — the Health page
  // rendered a permanent loading skeleton and NOTHING objected for a whole session (#841).
  'INV-ENDPOINT-BUDGET': 'scripts/contract-probe.cjs',
};

/**
 * Files that call `scoreWithGating()` and MUST supply the higher-timeframe bundle (#735).
 *
 * ⚠️ WHY A SCAN AND NOT A CANARY. Omitting the 4th argument is legal TypeScript — the
 * parameter is optional — so the compiler cannot catch it, and the failure is invisible:
 * every multi-timeframe directive silently falls back to the base bars and returns a
 * plausible number. Twelve call sites were in exactly that state (MST-004). The guard
 * therefore has to be structural: if you call the canonical evaluator from a
 * decision/analysis path, you name a bundle.
 *
 * A site that legitimately has no bundle to supply declares it with the marker
 * `// no-higher-tf: <reason>` on or above the call line, which is deliberate — it keeps
 * the exemption greppable and forces the reason to be written down.
 */
const MTF_BUNDLE_EXEMPTION_MARKER = 'no-higher-tf:';
const MTF_SCORING_SCOPE = [
  'src/modules/scoring',
  'src/modules/automation',
  'src/modules/signals',
  'src/modules/backtest',
  'src/modules/replay',
  'src/modules/snapshots',
  'src/modules/trading',
];

/**
 * INV-NO-FABRICATED-READING — absence of evidence must not become a number.
 *
 * A directive that cannot take a reading must say so (`unmeasured: true`) rather than
 * return a number it did not measure. Three separate live incidents, one cause:
 *
 *   (a) `analyst-adjustments` returned `Math.round(30 + accelerating * 5)` with the
 *       direction taken from the SIGN of `accelerating`. Measured: 1,125 `bullish`
 *       readings averaged 30.9 with a MINIMUM of exactly 30; 630 `bearish` averaged
 *       29.7 with a MAXIMUM of exactly 30 — 94% of 1,755 readings sat inside a
 *       fabricated 27–50 band. On `forex-session-v1`, 97% of readings came from that
 *       branch and 275 cleared the 65 gate: the app was trading on invented conviction.
 *   (b) `liquidity-check` returned `score: 0` when its stale-data guard tripped, which
 *       `RiskGatingEngine` turned into `severity = 1.0` and a HARD GATE — zeroing the
 *       composite and blaming "Symbol liquidity too low". Three protocols were gated
 *       shut on every tick for 45 minutes.
 *   (c) `stubResult()` presented "not implemented" as a real zero reading.
 *
 * ⚠️ PRECISION OVER REACH — a guard that fires on correct code gets switched off. This
 * flags the two shapes that are unambiguous, and nothing else:
 *
 *   1. A `signalClass` derived from a SIGN TEST on a near-zero quantity:
 *      `signalClass: x > 0 ? 'bullish' : 'bearish'`. Direction must come from a
 *      THRESHOLD that expresses a real move — `x > 1 ? 'bullish' : ...`.
 *   2. A no-signal early return carrying a non-zero literal `score`, where the reason
 *      states the directive could not measure (insufficient bars / no data / stale).
 *
 * A legitimate constant is not flagged, because every hit is matched against the reason
 * text the directive itself supplies. If it says it could not measure, it must not
 * return a measurement.
 */
function scanFabricatedReadings() {
  for (const scope of FABRICATION_SCOPE) {
    for (const file of walk(path.join(NEST_ROOT, scope))) {
      if (/\.spec\.ts$/.test(file)) continue;
      const raw = fs.readFileSync(file, 'utf8');
      const fileRel = rel(file);

      // ⚠️ Iterate the RAW lines and strip comments PER LINE, so the loop index and the
      // lookback window share ONE coordinate system.
      //
      // The first version split the comment-stripped source instead. `stripComments()`
      // deletes `/* ... */` blocks *including their newlines*, so every line after a block
      // comment shifts upward and the indices no longer point at the same code. That made
      // the scan report FALSE POSITIVES on correct code (twice — once on a doc comment
      // above the detector itself). A guard that fires on correct code gets switched off.
      const rawLines = raw.split(/\r?\n/);
      const lines = rawLines.map((l) => (isCommentLine(l) ? '' : l.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')));

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) continue;

        // ── Shape 1: direction from the SIGN of a near-zero quantity ──
        // `x > 0 ? 'bullish' : 'bearish'` — a coin-flip wearing a direction.
        //
        // ⚠️ CONTEXT MATTERS — a sign test is CORRECT once the magnitude has already
        // been thresholded above it. Both forms are legitimate:
        //
        //     if (Math.abs(move) < 0.5) return { unmeasured: true, ... };  // guarded above
        //     signalClass: move > 0 ? 'bullish' : 'bearish'               // now safe
        //
        // and
        //
        //     signalClass: move > 1 ? 'bullish' : 'bearish'               // self-thresholded
        //
        // So before flagging, look BACKWARD for a guard on `Math.abs(<same expr>)`
        // against a threshold, and FORWARD for the ternary's own threshold. Firing on
        // correct code gets a guard switched off — the comment above says so, and this
        // scan hit exactly that trap on its first run.
        if (/signalClass\s*:.*>\s*0\s*\?.*['"](bullish|bearish)['"].*:.*['"](bullish|bearish)['"]/.test(line)) {
          const subject = (line.match(/([A-Za-z_$][\w$]*)\s*>\s*0\s*\?/) || [])[1] || '';

          // A prior magnitude guard on the same identifier within the preceding
          // 40 lines (inside the same function body) makes the sign test safe.
          const lookback = rawLines.slice(Math.max(0, i - 40), i).join('\n');
          const isGuarded =
            subject !== '' &&
            new RegExp(
              `Math\\.abs\\(\\s*${subject}\\s*\\)\\s*<\\s*[A-Za-z0-9_.]+|` +
              `${subject}\\s*>=\\s*-?[0-9.]+\\s*&&\\s*${subject}\\s*<=\\s*[0-9.]+`,
            ).test(lookback);

          if (isGuarded) continue;

          const w = whitelistEntryFor('no-fabricated-baseline', fileRel);
          if (w) held.push(`no-fabricated-baseline  ${fileRel}:${i + 1}  (held by ${w.issue})`);
          else {
            fail(
              'INV-NO-FABRICATED-READING',
              `${fileRel}:${i + 1} derives a direction from the SIGN of a quantity rather than a threshold`,
              'A sign test on a near-zero value (momentum +0.02%) classifies as fully bullish/bearish, so the direction is a coin-flip. Use a THRESHOLD that expresses a real move (e.g. `accel > 1`), or guard the magnitude above and return `unmeasured: true` below it. See INV-NO-FABRICATED-READING.',
            );
          }
        }

        // ── Shape 2: a non-zero literal score on a could-not-measure path ──
        // Look at each `return { ... }` whose reason admits no measurement.
        if (!/\breturn\s*\{/.test(line)) continue;
        const block = lines.slice(i, i + 12).join('\n');
        const reasonMatch = block.match(/reason\s*:\s*(`[^`]*`|'[^']*'|"[^"]*")/);
        if (!reasonMatch) continue;
        // ⚠️ 2026-10-09 (#766): TWO evasions closed, both found by canarying then measuring live.
        //   (1) The reason test ran on the raw template, so `Need ${MIN} bars` never matched
        //       `need \d+ bars`. Placeholders are normalised to a number.
        //   (2) The score match was LITERAL-ONLY, so a COMPUTED score escaped — sp500-regime
        //       returned `Math.round(15 * closes.length / 200)` (a pro-rated floor, 5 at 72
        //       bars) with "could not measure" in its own reason, recorded 241x/day in
        //       production. Any expression other than exactly `0` on this path is now flagged.
        //   The `failed` term was also narrowed to FAILURES OF THE MEASURING ACT — a market
        //   outcome phrased as "Spike FAILED" is a real measurement and must not fire
        //   (surge.directive.ts holds that shape; observed NOT to fire after this change).
        const reason = reasonMatch[1].toLowerCase().replace(/\$\{[^}]*\}/g, '25');
        const admitsNoData =
          /insufficient|no data|not enough|need \d+\+? bars|could not|failed to (?:read|fetch|load|measure|import|compute)|(?:calculation|fetch|query|read|import|measurement) failed|unavailable|not scored/.test(reason);
        if (!admitsNoData) continue;

        const scoreMatch = block.match(/\bscore\s*:\s*([^\n,}]+)/);
        if (!scoreMatch) continue;
        const expr = scoreMatch[1].trim();
        if (expr === '0') continue; // a zero is an honest "no reading"

        if (!/^-?\d+(?:\.\d+)?$/.test(expr)) {
          const w2 = whitelistEntryFor('no-fabricated-baseline', fileRel);
          if (w2) held.push(`no-fabricated-baseline  ${fileRel}:${i + 1}  (held by ${w2.issue})`);
          else {
            fail(
              'INV-NO-FABRICATED-READING',
              `${fileRel}:${i + 1} computes a score (\`${expr}\`) on a path whose own reason says it could not measure`,
              'Return `score: 0` with `unmeasured: true` (that is the convention documented on `DirectiveResult.unmeasured`), or if the expression IS a real measurement, say so in the reason and this scan will stop flagging it. See INV-NO-FABRICATED-READING.',
            );
          }
          continue;
        }

        const literal = Number(expr);
        if (literal === 0) continue; // unreachable (expr === '0' handled above) — kept for clarity

        const w = whitelistEntryFor('no-fabricated-baseline', fileRel);
        if (w) held.push(`no-fabricated-baseline  ${fileRel}:${i + 1}  (held by ${w.issue})`);
        else {
          fail(
            'INV-NO-FABRICATED-READING',
            `${fileRel}:${i + 1} returns a non-zero literal score (${literal}) on a path whose own reason says it could not measure`,
            'Either return `score: 0` with `unmeasured: true`, or if the constant IS a real measurement, say so in the reason and this scan will stop flagging it. A number that the directive itself says it did not derive must not enter the composite. See INV-NO-FABRICATED-READING.',
          );
        }
      }
    }
  }
}

function scanBundleLessScoring() {
  for (const scope of MTF_SCORING_SCOPE) {
    for (const file of walk(path.join(NEST_ROOT, scope))) {
      const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
      const fileRel = rel(file);
      for (let i = 0; i < lines.length; i++) {
        if (isCommentLine(lines[i])) continue;
        if (!/\.scoreWithGating\s*\(/.test(lines[i])) continue;
        // Declarations/comments that merely NAME the method are not call sites.
        if (/^\s*(\*|\/\/)/.test(lines[i])) continue;

        // Collect the argument block by scanning forward until the CALL's opening paren
        // is balanced. Two details matter and both were learned by getting them wrong:
        //   - Anchor on the paren that belongs to `scoreWithGating(`, not the first `(`
        //     on the line. `results.push(await ...scoreWithGating(a, b, c, d))` put the
        //     first `(` on `push(`, so the parser measured `push`'s single argument and
        //     reported a 4-argument call as having 1.
        //   - A fixed line window is not enough — an argument list can wrap across lines.
        // A guard that fires on correct code gets switched off, so the parser has to be
        // right rather than approximately right.
        const raw = lines.slice(i, Math.min(lines.length, i + 12)).join('\n');
        const callMarker = raw.indexOf('.scoreWithGating');
        if (callMarker < 0) continue;
        const openIdx = raw.indexOf('(', callMarker);
        if (openIdx < 0) continue;
        let depth = 0;
        let closeIdx = -1;
        for (let k = openIdx; k < raw.length; k++) {
          if (raw[k] === '(') depth++;
          else if (raw[k] === ')') {
            depth--;
            if (depth === 0) { closeIdx = k; break; }
          }
        }
        if (closeIdx < 0) continue;
        const args = stripComments(raw.slice(openIdx + 1, closeIdx));

        // Count top-level commas in the argument list.
        let d = 0;
        let commas = 0;
        for (const ch of args) {
          if (ch === '(' || ch === '[' || ch === '{') d++;
          else if (ch === ')' || ch === ']' || ch === '}') d--;
          else if (ch === ',' && d === 0) commas++;
        }
        const argCount = args.trim() === '' ? 0 : commas + 1;
        // 4th positional arg is `higherTfBars`; the 5th is weightStrategy. Some sites
        // pass 3 (no protocol) — those are excluded because a bundle is meaningless
        // without a protocol to size it.
        if (argCount < 4) {
          // Exemption marker on the call line or the two lines above it.
          const context = lines.slice(Math.max(0, i - 2), i + 1).join('\n');
          if (context.includes(MTF_BUNDLE_EXEMPTION_MARKER)) continue;
          fail(
            'no-bundle-less-scoring',
            `${fileRel}:${i + 1} calls scoreWithGating() with ${argCount} argument(s) — no higher-timeframe bundle`,
            'INV-MTF-BUNDLE: pass the 4th argument (`{ dayBars, hourBars, min15Bars }` from `loadHigherTfBundle(symbolId, protocolId)`). Without it every MTF directive silently scores from the base bars only and returns a plausible number the live loop would never produce (#735, MST-004). If the site genuinely has no bundle, write `// no-higher-tf: <reason>` above the call.',
          );
        }
      }
    }
  }
}

/** Pages that are reported on (not gated) — the four-page mirror, minus QA which IS gated. */
const REPORT_PAGES = [
  { label: 'Architecture', file: 'src/pages/architecture-framework.data.js' },
  { label: 'Diagrams', file: 'src/pages/DiagramsPage.jsx' },
  { label: 'CapabilityMap', file: 'src/pages/CapabilityMapPage.jsx' },
];

// ── Capability registry integrity ─────────────────────────────────────────
//
// The Capability Map's "Backend Tech" list is a hand-maintained array of capability NAMES in
// `src/pages/CapabilityMapPage.jsx`. Nothing checked that the code behind a name still exists,
// so two deleted services ("Predictive Scoring (ML Horizon)", "Multi-Timeframe Scorer") sat in
// the registry being presented as live capabilities (#755), while the page's `status` column was
// a hardcoded literal that could not express "this is gone" either.
//
// ⚠️ WHAT THIS CHECK CAN AND CANNOT DO
// ------------------------------------
// Most registry entries are **concept labels**, not service names ("Process Manager", "System
// Health Diagnostics", "Directive Registry (99 directives)"). There is no reliable mapping from
// such a phrase to a source file, so a "does this name resolve to code?" check produces false
// failures on correct entries — which is how guards get switched off.
//
// So it asserts only the part that CAN be checked mechanically and cannot false-positive:
// **an entry explicitly marked as implemented must not be marked stale/deprecated at the same
// time.** Concretely, a name carrying a status token of `STUB`/`DEPRECATED`/`REMOVED` is not
// allowed to also appear in the live capability list. That is the invariant the #755 entries
// would have violated had the marker existed when they died.
//
// The complementary half — "this file still has code behind it" — is covered where it CAN be
// checked reliably: `checkStaleWhitelist` fails when a white-listed file is fixed or removed,
// and the file-existence canaries fail when a contract-owning file disappears. Registering a
// deleted service therefore gets caught by the `stale-whitelist` / canary paths, not by parsing
// English prose here.
const CAPABILITY_REGISTRY_FILE = path.join(REPO_ROOT, 'src', 'pages', 'CapabilityMapPage.jsx');
const BACKEND_TECH_MARKER = '// ── Backend Tech ──';

/** Status tokens that mean "this capability is not live" and must not sit in the registry. */
const DEAD_CAPABILITY_TOKENS = ['STUB', 'DEPRECATED', 'REMOVED', 'DELETED'];

function checkCapabilityRegistry() {
  if (!fs.existsSync(CAPABILITY_REGISTRY_FILE)) {
    fail('capability-registry', 'src/pages/CapabilityMapPage.jsx not found', 'The Capability Map registry is missing.');
    return;
  }
  const src = fs.readFileSync(CAPABILITY_REGISTRY_FILE, 'utf8');
  const start = src.indexOf(BACKEND_TECH_MARKER);
  if (start < 0) {
    fail('capability-registry', `could not find the "${BACKEND_TECH_MARKER}" block`, 'The registry format changed — update checkCapabilityRegistry() to match.');
    return;
  }
  // Strip comments from the block before parsing. Without this, an explanatory comment that
  // QUOTES a removed capability name is parsed as a live registry entry (observed: the #755
  // "Removed ... because they no longer exist" note made the parser treat the deleted services
  // as registered, and made an injected ghost entry undetectable).
  const block = stripComments(src.slice(start));
  const names = [...block.matchAll(/^\s*'([^']+)',\s*$/gm)].map((m) => m[1]);

  for (const name of names) {
    const dead = DEAD_CAPABILITY_TOKENS.find((t) => new RegExp(`\\b${t}\\b`, 'i').test(name));
    if (dead) {
      fail(
        'capability-registry',
        `Capability Map registers "${name}" but marks it ${dead}`,
        'A capability that is stubbed/deprecated/removed must not be listed as live. Delete the entry, or remove the status token if the capability is in fact live again.',
      );
    }
  }
  if (names.length === 0) {
    fail('capability-registry', 'parsed zero capability names from the Backend Tech block', 'The parser is out of sync with the registry format.');
  }
}


// ── helpers ───────────────────────────────────────────────────────────────

const failures = [];
const held = [];

function fail(rule, message, hint) {
  failures.push({ rule, message, hint });
}

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

function isCommentLine(line) {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      walk(p, out);
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
      out.push(p);
    }
  }
  return out;
}

function rel(p) {
  return path.relative(NEST_ROOT, p).split(path.sep).join('/');
}

function whitelistEntry(rule, file) {
  return WHITELIST.find((w) => w.rule === rule && w.file === file);
}

/**
 * Honoured whitelist keys.
 *
 * ⚠️ `rule` in an entry must EXACTLY match the rule name the scan reports, or the entry is
 * dead: the scan will still fail the build and the entry will also be flagged as stale. That
 * combination is deliberate (it makes a typo loud rather than silently permissive), but it
 * means the names below are part of the contract — check them when adding an entry.
 *
 *   no-oldest-n-window      — `orderBy: 'asc'` + `take:` over marketBar (returns the OLDEST N)
 *   no-direct-bar-window    — a hand-rolled prisma.marketBar.findMany window in a scoring path
 *   no-score-clamp          — clamping a score magnitude to 100
 *   no-score-clamp-review   — same, but the operand's units need a human read to classify
 *   no-fabricated-baseline  — a directive fabricating a reading it did not measure
 *
 * Entry FIELDS are `{ file, rule, issue, reason }`. `issue` is not part of the key.
 */
function whitelistEntryFor(rule, file, all = false) {
  const hits = WHITELIST.filter((w) => w.rule === rule && w.file === file);
  return all ? hits : hits[0];
}

function isWhitelisted(rule, file) {
  return WHITELIST.some((w) => w.rule === rule && w.file === file);
}

// ── 1. canaries ───────────────────────────────────────────────────────────

function checkCanaries() {
  for (const c of CANARIES) {
    const abs = c.root === 'repo' ? path.join(REPO_ROOT, c.file) : path.join(NEST_ROOT, c.file);
    if (!fs.existsSync(abs)) {
      fail(c.id, `${c.file} is missing — it owns a pipeline contract`, c.hint);
      continue;
    }
    const src = stripComments(fs.readFileSync(abs, 'utf8'));
    for (const marker of c.markers) {
      if (!src.includes(marker)) {
        fail(
          c.id,
          `${c.file} no longer contains \`${marker}\``,
          `${c.hint} If this was deliberate, it is a CONTRACT CHANGE — see the "Changing a contract" section (plan, invariant row, guard, QA entry, handoff).`,
        );
      }
    }
  }
}

// ── 2. scans ──────────────────────────────────────────────────────────────

function scanBarWindows() {
  for (const scope of BAR_WINDOW_SCOPE) {
    for (const file of walk(path.join(NEST_ROOT, scope))) {
      const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
      const fileRel = rel(file);

      for (let i = 0; i < lines.length; i++) {
        if (isCommentLine(lines[i])) continue;
        if (!/marketBar\s*\.\s*findMany\s*\(/.test(lines[i])) continue;

        // Comment-stripped block, so a commented-out query cannot be scanned while the raw
        // lines are still used for the comment check above.
        const rawBlock = lines.slice(i, i + 12).join('\n');
        const block = stripComments(rawBlock);
        const isAsc = /'asc'/.test(block);
        const hasTake = /\btake\s*:/.test(block);

        if (isAsc && hasTake) {
          const w = whitelistEntryFor('no-oldest-n-window', fileRel);
          if (w) {
            held.push(`no-oldest-n-window  ${fileRel}:${i + 1}  (held by ${w.issue})`);
          } else {
            fail(
              'no-oldest-n-window',
              `${fileRel}:${i + 1} uses \`orderBy: 'asc'\` with \`take:\` — that returns the OLDEST N bars, not the newest`,
              'INV-BAR-WINDOW: use `orderBy: { timestamp: \'desc\' }, take: N` then `.reverse()`, or better `marketData.getBars(symbolId, cadence, N)` which already does exactly this (#751).',
            );
          }
          continue;
        }

        const w = whitelistEntryFor('no-direct-bar-window', fileRel);
        if (w) {
          held.push(`no-direct-bar-window  ${fileRel}:${i + 1}  (held by ${w.issue})`);
        } else if (/\.reverse\s*\(\s*\)/.test(block)) {
          // WRONG LAYER, right result. This site correctly returns oldest → newest, so the
          // mechanical outcome matches the contract — but it is still a copy: the `timeframe`
          // filter and the ordering must be re-supplied by every author, and a copy that gets
          // the order right can still get the FILTER wrong (four sites did exactly that in
          // #751). Reported rather than failed while #754 migrates the remaining copies.
          held.push(`no-direct-bar-window (ordering correct, still a copy)  ${fileRel}:${i + 1}`);
        } else {
          fail(
            'no-direct-bar-window',
            `${fileRel}:${i + 1} hand-rolls a bar window with prisma.marketBar.findMany(...)`,
            'INV-CANONICAL-LOADER: use `marketData.getBars(symbolId, cadence, count)` — it applies the `timeframe` filter and returns oldest -> newest. The two hand-rolled queries that existed lost the timeframe filter and one returned the oldest 200 bars (#751).',
          );
        }
      }
    }
  }
}

/**
 * scanRawCadenceFallback() — INV-SINGLE-CADENCE (#908, 2026-09-19).
 *
 * ⚠️ THE REGRESSION THIS EXISTS TO CATCH. `recommendedTimeframe` is FREE TEXT in the protocol
 * seed (`'5s–30s'`, `'5m–1h'`, `'1d (signal), 1h/15m'` are real values). The automation loop's
 * data-readiness gate used it RAW with a fallback:
 *
 *     const timeframe = …?.recommendedTimeframe || '1d';
 *     await this.marketData.getBarCount(dbSym.id, timeframe);
 *
 * `getBarCount(id, '5s–30s')` returns 0 forever — no marketbar row will ever carry that
 * timeframe — so GER40/UK100/DAX bots sat in "pending_bars — Waiting for first bars (5s–30s)"
 * for 44h+ with thousands of real 1m/5m bars beneath them, and the message read as a
 * 30-second wait. Measured: 55 identical decision_log reasons in 24h.
 *
 * The shape scanned for is EXACTLY the bug: a `||`/`??` STRING-LITERAL fallback applied to
 * `recommendedTimeframe` where the resolution does not go through `selectBaseTimeframe()`.
 * Correct code does not match: `selectBaseTimeframe(x?.recommendedTimeframe)` (resolved),
 * `x?.recommendedTimeframe ?? undefined` (no cadence literal), or plain display/echo sites.
 * The three-line block window covers a fallback on the following line — a per-line test
 * would miss `const tf =\n  x?.recommendedTimeframe || '1d';`.
 */
function scanRawCadenceFallback() {
  for (const scope of RAW_CADENCE_SCOPE) {
    for (const file of walk(path.join(NEST_ROOT, scope))) {
      if (file.endsWith('.spec.ts')) continue;
      const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
      const fileRel = rel(file);
      for (let i = 0; i < lines.length; i++) {
        if (isCommentLine(lines[i])) continue;
        if (!/recommendedTimeframe/.test(stripComments(lines[i]))) continue;
        const block = stripComments(lines.slice(i, i + 3).join('\n'));
        if (!/recommendedTimeframe\s*(\|\||\?\?)\s*['"]/.test(block.replace(/\s*\r?\n\s*/g, ' '))) continue;
        if (/selectBaseTimeframe/.test(block)) continue;
        fail(
          'raw-cadence-fallback',
          `${fileRel}:${i + 1} applies a string fallback to the free-text recommendedTimeframe — it is being used as a bar cadence`,
          'INV-SINGLE-CADENCE: resolve through `selectBaseTimeframe()` (common/utils/timeframe.ts). ' +
            'Used raw as a bar key, `getBarCount()` returns 0 forever — GER40/UK100 sat in ' +
            '"pending_bars — Waiting for first bars (5s–30s)" for 44h+ with thousands of real ' +
            '1m/5m bars beneath them (#908).',
        );
      }
    }
  }
}

/**
 * Find every `<callee>(...)` call and return its raw argument source.
 *
 * We need real argument parsing rather than a regex, because the naive pattern
 * /Math\.min\([^)]*\b100\b[^)]*\)/ also matches `Math.min(1, x * 100)` and
 * `Math.min(0.7, n / 100)` — i.e. ordinary percentage maths. Rule precision is not
 * optional here: a guard that fires on correct code gets switched off, which is how
 * a "guard" ends up providing worse coverage than none at all.
 */
function findCalls(src, callee) {
  const out = [];
  const re = new RegExp(callee.replace(/\./g, '\\.') + '\\(', 'g');
  let m;
  while ((m = re.exec(src)) !== null) {
    const start = m.index + m[0].length;
    let depth = 1;
    let i = start;
    while (i < src.length && depth > 0) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')') depth--;
      i++;
    }
    out.push({ argsSource: src.slice(start, i - 1), index: m.index });
  }
  return out;
}

/** Split an argument source string on TOP-LEVEL commas only. */
function splitTopLevel(argsSource) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of argsSource) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  parts.push(cur);
  return parts.map((p) => p.trim());
}

function scanScoreClamp() {
  const CLAMP = 'Math.min';
  for (const scope of SCORE_CLAMP_SCOPE) {
    for (const file of walk(path.join(NEST_ROOT, scope))) {
      const src = stripComments(fs.readFileSync(file, 'utf8'));
      const fileRel = rel(file);
      // Identifier that signals a clamped SCORE rather than something else that happens
      // to be bounded by 100 (a page limit, a percentage already, a confidence weight).
      const SCORE_LIKE = /(^|[^a-zA-Z])(rawScore|composite|scoreNow|scoreDelta|finalScore|symbolScore|clampedScore|originalScore|nudgedScore)([^a-zA-Z]|$)/;
      // Explicit percentage contexts — clamping a percentage is correct by definition.
      const PERCENT_CONTEXT = /normalizedScore|Percent|_pct\b|pct[A-Z]|maxPossible|normalizeScorePercent|DEFAULT_SCORE_MAX/;

      for (const call of findCalls(src, CLAMP)) {
        const args = splitTopLevel(call.argsSource);
        if (!args.some((a) => a === '100')) continue;
        const others = args.filter((a) => a !== '100');
        const joined = others.join(', ');
        if (!SCORE_LIKE.test(joined)) continue;        // not a score — a limit or similar
        if (PERCENT_CONTEXT.test(joined)) continue;    // already a 0–100 percentage

        const line = src.slice(0, call.index).split('\n').length;
        const shown = args.map((a) => (a.length > 34 ? a.slice(0, 34) + '…' : a)).join(', ');

        // Static analysis cannot always tell a raw composite from a normalised percentage —
        // both are plain numbers on the same variable. Where the answer needs a human read,
        // record it as REVIEW debt instead of asserting a violation we cannot prove.
        if (isWhitelisted('no-score-clamp-review', fileRel)) {
          held.push(`no-score-clamp-review  ${fileRel}:${line}  (held by #755)`);
          continue;
        }

        // A deliberate, documented deviation of the asserted rule itself.
        if (isWhitelisted('no-score-clamp', fileRel)) {
          held.push(`no-score-clamp  ${fileRel}:${line}  (held by ${whitelistEntryFor('no-score-clamp', fileRel).issue})`);
          continue;
        }

        fail(
          'no-score-clamp',
          `${fileRel}:${line} clamps a SCORE to 100: Math.min(${shown})`,
          'INV-SCORE-MAGNITUDE: a directive `score` is a magnitude in [0, maxScore] and the protocol total is the sum of maxScores, so clamping destroys the weighting system — direction belongs in `signalClass`. If the operand is already a 0–100 PERCENTAGE, say so in the code (e.g. `normalizeScorePercent()` or a `…Pct` name) and this check will pass.',
        );
      }
    }
  }
}

function checkStaleWhitelist() {
  for (const w of WHITELIST) {
    // A rule enforced by canaries declares no scan name, so it can never appear in `held`.
    // Without this the entry would always look stale and fail the build wrongly.
    if (w.rule === 'canary-enforced') continue;
    const covered = held.some((h) => h.startsWith(`${w.rule}  ${w.file}`));
    if (!covered) {
      fail(
        'stale-whitelist',
        `whitelist entry for ${w.file} (${w.rule}) no longer matches a violation — the site was migrated or removed`,
        `Delete that entry from WHITELIST in scripts/validate-pipeline-contracts.cjs. The list is debt and must only shrink (${w.issue}).`,
      );
    }
  }
}

// ── 2b. cadence coverage ──────────────────────────────────────────────────
//
// Every cadence `selectBaseTimeframe()` can RETURN must be one BarRefreshService
// actually FETCHES. These two lists live in different files and nothing tied them
// together, so they drifted:
//
//   selectBaseTimeframe('5s–30s') -> '1m'
//   TIMEFRAMES                     -> ['5m','15m','1h','4h','1d']   (no '1m')
//
// Seven active protocols declared a sub-minute horizon, asked the canonical loader
// for `1m`, received an empty array, and produced NO SCORES AT ALL — while
// `protocol_score_status` reported them as `scoring` with `symbolsScored > 0`. They
// sat in that state for ~6 hours. An empty bar array is a legitimate state (a new
// symbol has no history), which is exactly why nothing failed loudly.
//
// This check is the missing link: it reads the two sources and asserts the fetched
// set is a SUPERSET of the resolvable set. Either list changing alone now fails the
// build, which is the point — the drift, not either list, was the defect.

const TIMEFRAME_UTIL = 'src/common/utils/timeframe.ts';
const BAR_REFRESH = 'src/modules/market-data/bar-refresh.service.ts';

/** The cadence literals `selectBaseTimeframe` can return. */
const RESOLVABLE_TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'];

function checkTimeframeCoverage() {
  const refreshFile = path.join(NEST_ROOT, BAR_REFRESH);
  if (!fs.existsSync(refreshFile)) {
    fail('timeframe-refresh-coverage', `${BAR_REFRESH} is missing`, 'It owns the fetch list.');
    return;
  }
  const src = stripComments(fs.readFileSync(refreshFile, 'utf8'));
  const m = src.match(/const\s+TIMEFRAMES\s*=\s*\[([^\]]*)\]/);
  if (!m) {
    fail(
      'timeframe-refresh-coverage',
      `could not find the TIMEFRAMES array in ${BAR_REFRESH}`,
      'Update checkTimeframeCoverage() to match the new declaration.',
    );
    return;
  }
  const fetched = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  if (fetched.length === 0) {
    fail('timeframe-refresh-coverage', `TIMEFRAMES is empty in ${BAR_REFRESH}`, 'No bars would be fetched at all.');
    return;
  }

  // Assert the utility still declares those literals — if selectBaseTimeframe starts
  // returning a NEW cadence, the literal below will not be found and the build fails
  // rather than silently serving nothing for it. That is the intended tripwire.
  if (!fs.existsSync(path.join(NEST_ROOT, TIMEFRAME_UTIL))) {
    fail('timeframe-refresh-coverage', `${TIMEFRAME_UTIL} is missing`, 'It owns cadence resolution.');
    return;
  }
  const utilSrc = stripComments(fs.readFileSync(path.join(NEST_ROOT, TIMEFRAME_UTIL), 'utf8'));

  const missing = RESOLVABLE_TIMEFRAMES.filter((tf) => !fetched.includes(tf));
  const undeclared = RESOLVABLE_TIMEFRAMES.filter(
    (tf) => !new RegExp(`['"]${tf.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`).test(utilSrc),
  );

  if (undeclared.length > 0) {
    fail(
      'timeframe-refresh-coverage',
      `RESOLVABLE_TIMEFRAMES lists ${undeclared.join(', ')} but ${TIMEFRAME_UTIL} no longer returns them`,
      'selectBaseTimeframe() changed. Update RESOLVABLE_TIMEFRAMES in checkTimeframeCoverage() to match the new mapping, and make sure TIMEFRAMES in bar-refresh.service.ts covers it.',
    );
  }
  if (missing.length > 0) {
    fail(
      'timeframe-refresh-coverage',
      `selectBaseTimeframe() can return ${missing.join(', ')} but TIMEFRAMES in ${BAR_REFRESH} never fetches it`,
      `Add ${missing.join(', ')} to TIMEFRAMES in nest/src/modules/market-data/bar-refresh.service.ts. A protocol whose recommendedTimeframe resolves to an unfetched cadence receives an empty bar array, produces no score, and does so silently — seven protocols sat stalled ~6h reporting "scoring" this way (#758).`,
    );
  }
}

// ── 3. wiring: invariants <-> guards <-> QA mirror ────────────────────────

function readInvariants() {
  if (!fs.existsSync(CONTRACTS_DOC)) return [];
  const doc = fs.readFileSync(CONTRACTS_DOC, 'utf8');
  return [...new Set(doc.match(/INV-[A-Z0-9-]+/g) || [])].sort();
}

function checkWiring() {
  const ids = readInvariants();
  if (ids.length === 0) {
    fail('wiring', 'no invariants found in meta-stack-contracts.instructions.md', 'The canonical contracts doc is missing or empty.');
    return ids;
  }

  const qaRaw = fs.existsSync(QA_CHECKLIST) ? fs.readFileSync(QA_CHECKLIST, 'utf8') : '';
  if (!qaRaw) {
    fail('wiring', 'src/data/qa-checklist.js not found', 'The QA page is the gated part of the four-page mirror.');
    return ids;
  }

  for (const id of ids) {
    const guardedByCanary = CANARIES.some((c) => c.id === id);
    const guardedByScan = !!SCAN_ENFORCED[id];
    const guardedByProbe = !!PROBE_ENFORCED[id];
    if (!guardedByCanary && !guardedByScan && !guardedByProbe) {
      fail(id, `invariant ${id} has no guard`, 'Add a canary, a scan rule, or a probe check — an invariant nothing checks is a comment.');
    }
    if (guardedByProbe && !fs.existsSync(PROBE_SCRIPT)) {
      fail(id, `invariant ${id} is probe-enforced but ${rel(PROBE_SCRIPT)} does not exist`, 'Create the probe script.');
    }
    if (!qaRaw.includes(id)) {
      fail(
        id,
        `invariant ${id} has no QA checklist entry`,
        `Add an entry to src/data/qa-checklist.js with \`invariant: '${id}'\` — the four-page mirror is gated on the QA page because it is the only one that can express a procedure.`,
      );
    }
  }

  // Orphan QA references — a QA entry pointing at an invariant that no longer exists.
  const qaIds = [...new Set(qaRaw.match(/INV-[A-Z0-9-]+/g) || [])];
  for (const qaId of qaIds) {
    if (!ids.includes(qaId)) {
      fail('stale-qa-mirror', `src/data/qa-checklist.js references ${qaId}, which is not in the contracts doc`, 'Remove or re-point that QA entry — the invariant no longer exists.');
    }
  }

  return ids;
}

function reportPageCoverage(ids) {
  const rows = [];
  for (const page of REPORT_PAGES) {
    const abs = path.join(REPO_ROOT, page.file);
    if (!fs.existsSync(abs)) {
      rows.push(`${page.label.padEnd(14)} (file not found)`);
      continue;
    }
    const src = fs.readFileSync(abs, 'utf8');
    const mentioned = ids.filter((id) => src.includes(id));
    rows.push(
      `${page.label.padEnd(14)} ${mentioned.length}/${ids.length} invariants named${mentioned.length ? `: ${mentioned.join(', ')}` : ''}`,
    );
  }
  return rows;
}

// ── run ───────────────────────────────────────────────────────────────────

checkCanaries();
scanBarWindows();
scanRawCadenceFallback();
scanScoreClamp();
scanObservedDenominator();
scanStaleScoringGuard();
scanBundleLessScoring();
scanFabricatedReadings();
checkTimeframeCoverage();
checkCapabilityRegistry();
checkStaleWhitelist();
const ids = checkWiring();

console.log(`[pipeline-contracts] ${ids.length} invariants in the contracts doc; ${WHITELIST.length} whitelisted deviations`);
if (held.length) {
  console.log('[pipeline-contracts] held (tracked debt, does not fail the build):');
  for (const h of held) console.log(`    - ${h}`);
}
console.log('[pipeline-contracts] four-page mirror coverage (QA is gated, these are reported):');
for (const row of reportPageCoverage(ids)) console.log(`    ${row}`);

if (failures.length) {
  console.error(`\n[pipeline-contracts] ✖ ${failures.length} contract violation(s):\n`);
  for (const f of failures) {
    console.error(`  ✖ [${f.rule}] ${f.message}`);
    if (f.hint) console.error(`      → ${f.hint}`);
  }
  console.error('\nSee .github/instructions/meta-stack-contracts.instructions.md\n');
  process.exit(1);
}

console.log('[pipeline-contracts] ✅ OK — canonical mechanisms present, no banned patterns, invariants mirrored in QA\n');
