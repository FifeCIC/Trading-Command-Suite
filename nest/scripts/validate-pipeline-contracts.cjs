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
];

/** Invariants enforced by a scan rather than a canary. */
const SCAN_ENFORCED = {
  'INV-CANONICAL-LOADER': 'no-direct-bar-window',
  'INV-BAR-WINDOW': 'no-oldest-n-window',
  'INV-SCORE-MAGNITUDE': 'no-score-clamp',
  'INV-STABLE-DENOMINATOR': 'no-observed-denominator',
  'INV-MTF-BUNDLE': 'no-bundle-less-scoring',
};

/** Invariants enforced by the live probe (a runtime check cannot be static). */
const PROBE_ENFORCED = { 'INV-NO-FUTURE-ROWS': 'scripts/contract-probe.cjs' };

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
scanScoreClamp();
scanObservedDenominator();
scanBundleLessScoring();
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
