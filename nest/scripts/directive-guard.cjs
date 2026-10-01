#!/usr/bin/env node
/**
 * directive-guard.cjs — mechanical audit of scoring directives.
 *
 * Implements the recurring-failure-mode checks from the 2026-08-14 directive
 * audit so we stop finding "completeness theater" by hand:
 *
 *   MODE 1  Completeness theater  — a `ready` directive whose code confesses to
 *           being a mock/fallback (static) OR whose `calculate()` returns the
 *           identical score+reason for two very different inputs (runtime).
 *   MODE 4  Direction-blind        — reads of `input.<field>` where the field is
 *           not in the KNOWN_INPUT_FIELDS allowlist (i.e. nothing writes it).
 *   MODE 5  signalClass semantics  — `directionBias: 'neutral'` emitting
 *           'bullish'/'bearish', or a one-way bias emitting the opposite class.
 *   MODE 3  Constant floor         — a "no signal"/guard branch returning a
 *           literal non-zero score.
 *   MODE 6  Duplicate id           — the same directive `id` defined by two
 *           different classes (different files). One copy is dead code that
 *           still confuses audits and the registry.
 *   MODE 7  Readiness evidence (--db) — a `ready` directive must have recorded
 *           scores in the DB that vary (Score.breakdown.breakouts). Directives
 *           that NO active protocol can reach are counted separately: they have
 *           no evidence because they never run, which is a coverage fact rather
 *           than a readiness defect (115/129 warnings in the 2026-09-09 run).
 *   MODE 8  Bar starvation (--db)  — a directive that declares a bar requirement
 *           and is handed a smaller window returns 0 and says so: "Insufficient
 *           data: need 72 bars, have 20". Nothing throws; the 0 folds silently
 *           into an additive composite. Cause-agnostic — it reads the reason the
 *           DIRECTIVE recorded, so it fires for any cause of a too-small window
 *           (wrong cadence, mis-declared minBars, truncated fetch).
 *
 * ⚠️ The RUNTIME half reads `dist/`, and it REFUSES TO RUN when `dist/` is stale (#881).
 *    It used to treat an absent `dist/` and an out-of-date `dist/` differently: absent printed a
 *    message, stale produced a full report drawn from code you had already changed. That meant the
 *    guard could report CLEAN on a directive that was broken in source, because `dist/` still held
 *    a good build - a check reporting on an artifact it is not testing. It now compares the newest
 *    mtime under `src/.../implementations` against the newest under `dist/.../implementations` and
 *    exits 1 with a `STALE BUILD` message rather than reporting results from older code.
 *    A check that cannot read its input must ERROR, never pass.
 *
 * Usage:
 *   node nest/scripts/directive-guard.cjs              # static + runtime
 *   node nest/scripts/directive-guard.cjs --static-only # skip runtime (no build)
 *   node nest/scripts/directive-guard.cjs --db          # + readiness evidence (local MySQL)
 *   node nest/scripts/directive-guard.cjs --self-test    # canary the pure classifiers (no DB, no build)
 *
 * Exit code: 1 if any ERROR-level finding (mode 1 static on a `ready` directive), or if the
 * runtime half refused because `dist/` is stale. 0 otherwise. WARN findings are advisory and do
 * not fail the run.
 *
 * Run from the `nest/` directory: `node scripts/directive-guard.cjs`.
 */

const fs = require('fs');
const path = require('path');

const NEST_ROOT = path.resolve(__dirname, '..');
const IMPL_DIR = path.join(NEST_ROOT, 'src', 'modules', 'directives', 'implementations');
const DIST_DIR = path.join(NEST_ROOT, 'dist', 'src', 'modules', 'directives', 'implementations');

// ── Config ────────────────────────────────────────────────────────────────

/** Input fields the engine is KNOWN to write. Anything else read off `input` is suspicious. */
const KNOWN_INPUT_FIELDS = new Set([
  'bars', 'symbol', 'ticker', 'dayBars', 'hourBars', 'min15Bars',
  'price', 'eurusdValue', 'dxyValue', 'accountId', 'account', 'quote', 'timestamp', 'asOf',
]);

/** Confession patterns — a `ready` directive containing any of these is a red flag. */
const CONFESSION_PATTERNS = [
  /\bmock\b/i,
  /not connected/i,
  /connect\s+(?:a\s+)?(?:the\s+)?(?:[a-z]+\s+)*(?:feed|api)/i,
  /\bplaceholder\b/i,
  /\bstub\b/i,
];

/** Reason phrases that mark a "no signal" branch (used for the constant-floor check). */
const NO_SIGNAL_PHRASES = /\b(no\s+\w+\s+(?:data|feed|signal|levels|support|resistance)|outside|insufficient|not available|unavailable)\b/i;

// ── Findings ──────────────────────────────────────────────────────────────

/** @type {{file:string, directive:string, mode:number, severity:'ERROR'|'WARN', message:string}[]} */
const findings = [];

/**
 * Set when the runtime half REFUSED to run because `dist/` is older than `src/` (#881).
 * It forces exit 1 in `main()` even with zero findings, because "I could not test" must never be
 * reported as "no problems found" - silence and success are different results.
 */
let runtimeRefused = false;

function report(file, directive, mode, severity, message) {
  findings.push({ file: path.basename(file), directive, mode, severity, message });
}

// ── Helpers ───────────────────────────────────────────────────────────────

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}

/** Extract class bodies: name -> body source (from the opening brace to the next `export`). */
function extractClasses(src) {
  const re = /(?:@Injectable\(\)\s*\r?\n\s*)?export\s+class\s+(\w+)(?:\s+implements\s+[\w,\s]+)?\s*\{/g;
  const starts = [];
  let m;
  while ((m = re.exec(src)) !== null) {
    starts.push({ name: m[1], bodyStart: m.index + m[0].length });
  }
  const out = [];
  for (let i = 0; i < starts.length; i++) {
    const nextStart = i + 1 < starts.length
      ? src.slice(starts[i].bodyStart).indexOf('export') + starts[i].bodyStart
      : src.length;
    out.push({ name: starts[i].name, body: src.slice(starts[i].bodyStart, nextStart) });
  }
  return out;
}

function fieldOf(body, name) {
  const m = body.match(new RegExp(`readonly\\s+${name}\\s*=\\s*'([^']+)'`));
  return m ? m[1] : null;
}

/** id -> file that first defined it (for MODE 6 duplicate detection). */
const idOwners = new Map();

// ── Static checks ─────────────────────────────────────────────────────────

function staticCheckFile(file) {
  const src = fs.readFileSync(file, 'utf8');
  const clean = stripComments(src);
  const classes = extractClasses(clean);
  for (const cls of classes) {
    const id = fieldOf(cls.body, 'id');
    const readiness = fieldOf(cls.body, 'readiness');
    const bias = fieldOf(cls.body, 'directionBias');
    if (!id) continue; // not a directive class

    // Collect `ready` directives for the MODE 7 readiness-evidence check.
    if (readiness === 'ready' && !readyDirectives.has(id)) {
      readyDirectives.set(id, file);
      readyBias.set(id, bias ?? 'neutral');
    }

    // MODE 6 — duplicate id: same id defined by a class in a different file
    if (idOwners.has(id)) {
      report(file, id, 6, 'ERROR', `duplicate directive id "${id}" — also defined in ${path.basename(idOwners.get(id))}`);
    } else {
      idOwners.set(id, file);
    }

    // MODE 1 — confession lint
    if (readiness === 'ready') {
      for (const pat of CONFESSION_PATTERNS) {
        const mm = cls.body.match(pat);
        if (mm) {
          report(file, id, 1, 'ERROR', `readiness='ready' but code confesses: /${pat.source}/`);
          break;
        }
      }
    }

    // MODE 4 — producer trace: input.<field> reads outside the allowlist
    const fieldReads = new Set();
    const readRe = /input(?:\s+as\s+[\w\s]+)?\)?\.(\w+)/g;
    let rm;
    while ((rm = readRe.exec(cls.body)) !== null) {
      fieldReads.add(rm[1]);
    }
    for (const f of fieldReads) {
      if (!KNOWN_INPUT_FIELDS.has(f)) {
        report(file, id, 4, 'WARN', `reads input.${f} - no known producer writes this field (verify it is injected)`);
      }
    }

    // MODE 5 — signalClass vs directionBias
    const emitsBullish = /signalClass\s*:\s*['"]bullish['"]/.test(cls.body);
    const emitsBearish = /signalClass\s*:\s*['"]bearish['"]/.test(cls.body);
    if (bias === 'neutral' && (emitsBullish || emitsBearish)) {
        report(file, id, 5, 'WARN', `directionBias='neutral' but emits ${emitsBullish && emitsBearish ? 'both bullish & bearish' : emitsBullish ? 'bullish' : 'bearish'} - verify direction logic`);
    }
    if (bias === 'bullish' && emitsBearish) {
      report(file, id, 5, 'WARN', `directionBias='bullish' but emits 'bearish'`);
    }
    if (bias === 'bearish' && emitsBullish) {
      report(file, id, 5, 'WARN', `directionBias='bearish' but emits 'bullish'`);
    }

    // MODE 3 — constant floor: a no-signal guard branch returning a literal non-zero score
    const returns = cls.body.match(/return\s*\{[^}]*\}/g) || [];
    for (const ret of returns) {
      const scoreLit = ret.match(/score\s*:\s*(\d+)/);
      if (scoreLit && Number(scoreLit[1]) > 0 && NO_SIGNAL_PHRASES.test(ret)) {
        report(file, id, 3, 'WARN', `"no signal" branch returns non-zero score ${scoreLit[1]}`);
        break;
      }
    }
  }
}

// ── Runtime constant-output check ─────────────────────────────────────────

function makeInput(daysAgo, trend) {
  const bars = [];
  for (let i = 0; i < 120; i++) {
    const t = new Date(Date.now() - daysAgo * 86400000 - (45 - i) * 3600000);
    const open = 100 + i * trend + (daysAgo === 0 ? 0 : 15);
    const close = open + trend + Math.sin(i + daysAgo);
    bars.push({
      timestamp: t,
      open,
      high: close + 1 + (daysAgo ? 3 : 0.2),
      low: open - 1 - (daysAgo ? 3 : 0.2),
      close,
      volume: 1000 + (daysAgo ? i * 500 : i * 5),
    });
  }
  return { symbol: 'GUARD', bars, dayBars: bars, hourBars: bars, min15Bars: bars };
}

// ── Build staleness gate (mode 1 runtime, #881) ────────────────────────────
//
// The runtime half exercises COMPILED classes, so its result is only meaningful if `dist/` was
// built from the `src/` currently on disk. Before #881 the script distinguished "no dist" from
// "dist", but not "dist built from older source" - so it could report CLEAN on a directive that
// was broken in source, and it reported a rewritten `friday-drift` as still emitting score=8
// because that was the value in the stale `.js`.
//
// The file sets deliberately MIRROR the two scans: `.ts` excluding `.spec.ts` on the source side,
// `.js` excluding `.spec.js` on the compiled side. Broadening to every `.ts` would make a
// test-only edit look like a stale build, and a guard that fires for unrelated reasons gets
// allowlisted - which is worse than no guard.

/** Newest mtime (ms) under `dir` for files matching `include`, ignoring `exclude`. 0 if none. */
function newestMtimeMs(dir, include, exclude) {
  if (!fs.existsSync(dir)) return 0;
  let newest = 0;
  for (const f of fs.readdirSync(dir)) {
    if (!include.test(f)) continue;
    if (exclude && exclude.test(f)) continue;
    try {
      const m = fs.statSync(path.join(dir, f)).mtimeMs;
      if (m > newest) newest = m;
    } catch {
      /* unreadable entry cannot make source look newer */
    }
  }
  return newest;
}

/**
 * classifyStaleness() — PURE. No filesystem, so `--self-test` can canary it in BOTH directions.
 *
 *   sourceNewest — newest mtime (ms) under src/.../implementations (.ts, not .spec.ts)
 *   distNewest   — newest mtime (ms) under dist/.../implementations (.js, not .spec.js)
 *   distCount    — how many compiled directive files the runtime half would actually require()
 *
 * Three outcomes, and they must NOT collapse into each other - "absent" and "stale" are different
 * facts, and `distCount === 0` means there is nothing to exercise whatever the mtimes say (an
 * empty `dist/` directory would otherwise compare as "fresh", since 0 > 0 is false).
 *
 *   'no-dist' — nothing compiled; the caller prints how to build
 *   'stale'   — source is NEWER than the build; refuse, do not probe
 *   'fresh'   — safe to exercise the compiled classes
 */
function classifyStaleness(sourceNewest, distNewest, distCount) {
  if (!distCount) return 'no-dist';
  if (!sourceNewest) return 'fresh'; // no source mtimes readable -> nothing to disprove freshness
  if (sourceNewest > distNewest) return 'stale';
  return 'fresh';
}

function runtimeCheck() {
  const inputA = makeInput(0, 0.1);
  const inputB = makeInput(3, -0.6);

  if (!fs.existsSync(DIST_DIR)) {
    console.log(`\n[guard] dist not found at ${DIST_DIR} - run "npm run build" first (or use --static-only).`);
    return;
  }
  const files = fs.readdirSync(DIST_DIR).filter((f) => /\.(?:directive|stub|directives)\.js$/.test(f) && !/\.spec\.js$/.test(f));

  const sourceNewest = newestMtimeMs(IMPL_DIR, /\.ts$/, /\.spec\.ts$/);
  const distNewest = newestMtimeMs(DIST_DIR, /\.js$/, /\.spec\.js$/);
  const state = classifyStaleness(sourceNewest, distNewest, files.length);

  if (state === 'no-dist') {
    console.log(`\n[guard] dist holds no compiled directive files at ${DIST_DIR} - run "npm run build" first (or use --static-only).`);
    return;
  }
  if (state === 'stale') {
    const age = (ms) => (ms ? new Date(ms).toISOString() : 'n/a');
    console.log(`\n[guard] STALE BUILD - the runtime half REFUSED to run (#881).`);
    console.log(`[guard]   source newest: ${age(sourceNewest)}  (${IMPL_DIR})`);
    console.log(`[guard]   dist   newest: ${age(distNewest)}  (${DIST_DIR})`);
    console.log('[guard]   The compiled classes are older than the source they came from, so any');
    console.log('[guard]   result here would describe code you have already changed. Rebuild and re-run:');
    console.log('[guard]     npm --prefix nest run build:api        # or: cd nest && npm run build');
    console.log('[guard]   Static findings above ARE current; only the runtime constant-output test was skipped.');
    runtimeRefused = true;
    return;
  }

  let tested = 0;
  for (const f of files) {
    let mod;
    try {
      mod = require(path.join(DIST_DIR, f));
    } catch {
      continue;
    }
    for (const val of Object.values(mod)) {
      if (typeof val !== 'function') continue;
      let inst;
      try {
        inst = new val();
      } catch {
        continue;
      }
      if (!inst || typeof inst.calculate !== 'function' || typeof inst.id !== 'string') continue;
      let rA, rB;
      try {
        rA = inst.calculate(inputA);
        rB = inst.calculate(inputB);
      } catch {
        continue; // constructor-injected dependency not available standalone
      }
      if (!rA || !rB) continue;
      tested++;
      // Only flag a NON-ZERO identical result: a directive returning 0 for both
      // inputs is just "insufficient data", not constant-output theater.
      if (
        rA.score !== undefined && rA.score !== 0 &&
        rA.score === rB.score && rA.reason === rB.reason
      ) {
        report(f, inst.id, 1, 'WARN', `identical output for two different inputs (score=${rA.score}) - constant-output suspicion`);
      }
    }
  }
  console.log(`[guard] runtime constant-output test: ${tested} directive classes exercised.`);
}

// ── Readiness evidence (MODE 7, --db) ──────────────────────────────────────
//
// `ready` requires recorded scores in the DB that vary — the 2026-08-14 audit
// found directives that were `ready` on paper but had never produced a real,
// varying score. Recorded scores live in Score.breakdown.breakouts entries
// ({directiveId, score}). DB is optional/local: CI has no MySQL, so this
// check runs only with --db.

/** id -> file of every directive marked `ready` (populated by the static pass). */
const readyDirectives = new Map();
/** id -> directionBias of every `ready` directive (populated by the static pass). */
const readyBias = new Map();
const MIN_EVIDENCE_RECORDS = 10;
const MIN_EVIDENCE_DISTINCT = 2;

function loadEnvFile(file) {
  try {
    if (!fs.existsSync(file)) return;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const kv = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (kv && !process.env[kv[1]]) process.env[kv[1]] = kv[2].replace(/^['"]|['"]$/g, '');
    }
  } catch { /* unreadable .env */ }
}

async function readinessEvidenceCheck() {
  loadEnvFile(path.join(NEST_ROOT, '.env'));
  if (!process.env.DATABASE_URL) {
    console.log('[guard] readiness evidence skipped — DATABASE_URL not set (see nest/.env).');
    return;
  }
  let prisma;
  try {
    prisma = require(path.join(NEST_ROOT, 'node_modules', '@prisma', 'client'));
  } catch {
    console.log('[guard] readiness evidence skipped — @prisma/client not built (run prisma generate).');
    return;
  }
  const client = new prisma.PrismaClient();
  let rows = [];
  let exposed = null; // null = unknown (query failed) → fall back to the noisy behaviour
  let notPersisted = new Set(); // exposed by an active protocol that never persists breakdowns
  try {
    await client.$connect();
    rows = await client.$queryRawUnsafe(
      'SELECT breakdown FROM score ORDER BY timestamp DESC LIMIT 5000',
    );
    // Exposure set — directives an ACTIVE protocol can actually run AND report on.
    // Two filters beyond mere membership:
    //   1. inclusion — `directive-inclusion.ts` drops a directive whose direction
    //      bias cannot match the protocol's mode (bearish in LONG_ONLY can never
    //      produce evidence: rsi-overbought, 2026-09-10).
    //   2. persistence — evidence only exists for protocols that actually write
    //      breakdown rows, so a directive whose admissible protocols never persist
    //      cannot be judged from this table at all.
    try {
      const reachable = await client.$queryRawUnsafe(
        `SELECT DISTINCT e.directiveId AS id, p.slug AS protocol, p.directionMode AS directionMode
           FROM protocol_directive_entry e
           JOIN protocol_directive_group g ON g.id = e.groupId
           JOIN protocol p ON p.id = g.protocolId
          WHERE p.active = 1`,
      );
      // Protocols that actually appear as breakdown rows in the window.
      const persistingProtocols = new Set();
      for (const row of rows) {
        const pid = (row.breakdown || {}).protocolId;
        if (pid) persistingProtocols.add(String(pid));
      }
      exposed = new Set();
      notPersisted = new Set();
      for (const row of reachable) {
        const id = String(row.id);
        const mode = String(row.directionMode || 'LONG_ONLY');
        const bias = readyBias.get(id) ?? 'neutral';
        const blockedByBias =
          (mode === 'LONG_ONLY' && bias === 'bearish') ||
          (mode === 'SHORT_ONLY' && bias === 'bullish');
        if (blockedByBias) continue;
        if (persistingProtocols.has(String(row.protocol))) exposed.add(id);
        else notPersisted.add(id);
      }
    } catch (err) {
      console.log(`[guard] exposure query failed (${err.message}) — reporting every ready directive.`);
    }
  } catch (err) {
    console.log(`[guard] readiness evidence skipped — DB unavailable: ${err.message}`);
    return;
  } finally {
    try { await client.$disconnect(); } catch { /* ignore */ }
  }

  // directiveId -> { values: Set<number>, records: number }
  const evidence = new Map();
  for (const row of rows) {
    const b = row.breakdown || {};
    const breakouts = b.breakouts || {};
    for (const group of Object.values(breakouts)) {
      if (!Array.isArray(group)) continue;
      for (const entry of group) {
        if (!entry || !entry.directiveId || entry.score == null) continue;
        let e = evidence.get(entry.directiveId);
        if (!e) { e = { values: new Set(), records: 0 }; evidence.set(entry.directiveId, e); }
        e.records++;
        e.values.add(entry.score);
      }
    }
  }

  let insufficient = 0;
  let notExposed = 0;
  let lowSample = 0;
  for (const [id, file] of readyDirectives) {
    const e = evidence.get(id);
    // No active protocol admits this directive, or none of the protocols that
    // admit it persist breakdown rows → it cannot have evidence by definition.
    const reachable = exposed ? exposed.has(id) : true;
    if (!reachable) { notExposed++; continue; }
    if (!e || e.records === 0) {
      report(file, id, 7, 'WARN', `readiness='ready' but zero recorded scores in DB — no runtime evidence`);
      insufficient++;
    } else if (e.records < MIN_EVIDENCE_RECORDS) {
      // A handful of samples is not evidence of a constant — the protocol may
      // simply barely run. Counted separately so it cannot masquerade as a defect.
      lowSample++;
    } else if (e.values.size < MIN_EVIDENCE_DISTINCT) {
      report(file, id, 7, 'WARN', `readiness='ready' but CONSTANT in production: ${e.records} recorded scores, ${e.values.size} distinct value`);
      insufficient++;
    }
  }
  console.log(
    `[guard] readiness evidence: ${evidence.size} directives scored in DB, ${insufficient}/${readyDirectives.size} ready directives lack evidence` +
    (exposed
      ? `, ${notExposed} outside the evidence base (no admitting protocol persists breakdowns)`
      : '') +
    (lowSample ? `, ${lowSample} with too few samples to judge.` : '.'),
  );
}

// ── Bar starvation (MODE 8, --db) ─────────────────────────────────────────
//
// A directive that DECLARES a bar requirement and is handed a smaller window
// returns 0 with an explanation — "Insufficient data: need 72 bars, have 20".
// Nothing throws: the 0 folds silently into an additive composite, which is the
// repo's signature defect (plausible number, no error).
//
// MEASURED 2026-09-27, `btc-speed-v1` — the worked case this mode exists for:
//   • 4 of its 13 directives starved on 246 of 247 ticks (99.6%) for 24h+
//   • 3,504 fresh 5m bars sat in `marketbar` — the DATA was never the problem
//   • the window is `resolveCadence()`'s `required[tf] ?? required['1d'] ?? 100`
//   • `??` is a FALL-THROUGH where that function's own docstring means a MAXIMUM
//   • 74 of 108 directives declare their real requirement under the GENERIC key
//     `'1d'`; ONE directive declaring `'15m'` suppressed the fall-through and
//     starved every larger one. `btc-speed-v1.recommendedTimeframe = '15m–1d'`
//     → `selectBaseTimeframe` → `'15m'` → `required['15m'] = 20` → window 20.
//
// ⚠️ DELIBERATELY CAUSE-AGNOSTIC, for the reason that makes a symptom guard
// worth more than a cause guard: it would still fire if the cause were different.
// It reimplements neither `getRequiredBars()` nor `selectBaseTimeframe()` — those
// live in TS and remain the single source. It reads only what was persisted.
//
// Why a RATIO and not "any occurrence": crypto and equities have legitimate gaps,
// and a symbol mid-import reports this once. A directive starved on MOST ticks is
// chronic, and chronic is the only thing this mode fails on.

const STARVATION_RE = /need (\d+) bars?,\s*have (\d+)/i;
/** Below this many observations a gap is indistinguishable from a cold start. */
const STARVATION_MIN_TICKS = 20;
/** Share of ticks that must starve before it is chronic rather than a gap. */
const STARVATION_RATIO = 0.5;

/**
 * Pure classifier — no DB, no filesystem, so `--self-test` can canary it.
 * @param {Map<string,{protocolId:string,directiveId:string,ticks:number,starved:number,need:number,have:number}>} stats
 */
function classifyStarvation(stats, opts = {}) {
  const minTicks = opts.minTicks ?? STARVATION_MIN_TICKS;
  const ratio = opts.ratio ?? STARVATION_RATIO;
  const chronic = [];
  for (const s of stats.values()) {
    if (s.ticks < minTicks) continue;   // too few observations to judge
    const fraction = s.starved / s.ticks;
    if (fraction < ratio) continue;     // a gap, not the defect
    chronic.push({ ...s, fraction });
  }
  return chronic.sort((a, b) => b.fraction - a.fraction || b.need - a.need);
}

/** Count, per protocol+directive, how often the directive starved. */
function tallyStarvation(breakdowns) {
  const stats = new Map();
  for (const bd of breakdowns) {
    const protocolId = bd?.protocolId;
    if (!protocolId || !bd?.breakouts) continue;
    for (const list of Object.values(bd.breakouts)) {
      if (!Array.isArray(list)) continue;
      for (const d of list) {
        const directiveId = d?.directiveId;
        if (!directiveId) continue;
        const key = `${protocolId}|${directiveId}`;
        let s = stats.get(key);
        if (!s) {
          s = { protocolId, directiveId, ticks: 0, starved: 0, need: 0, have: 0 };
          stats.set(key, s);
        }
        s.ticks++;
        const m = STARVATION_RE.exec(String(d.reason ?? ''));
        if (!m) continue;
        s.starved++;
        s.need = Math.max(s.need, Number(m[1]));
        const have = Number(m[2]);
        s.have = s.have === 0 ? have : Math.min(s.have, have);
      }
    }
  }
  return stats;
}

async function barStarvationCheck(hours = 24) {
  loadEnvFile(path.join(NEST_ROOT, '.env'));
  if (!process.env.DATABASE_URL) {
    console.log('[guard] bar starvation: skipped — DATABASE_URL not set (see nest/.env).');
    return;
  }
  let prisma;
  try {
    prisma = require(path.join(NEST_ROOT, 'node_modules', '@prisma', 'client'));
  } catch {
    console.log('[guard] bar starvation: skipped — @prisma/client not built (run prisma generate).');
    return;
  }
  const client = new prisma.PrismaClient();
  try {
    await client.$connect();
    const rows = await client.$queryRawUnsafe(
      `SELECT breakdown FROM score WHERE timestamp >= (UTC_TIMESTAMP() - INTERVAL ${Number(hours)} HOUR)`,
    );
    const parsed = [];
    for (const r of rows) {
      try {
        parsed.push(typeof r.breakdown === 'string' ? JSON.parse(r.breakdown) : r.breakdown);
      } catch { /* not JSON — not this mode's business */ }
    }
    const stats = tallyStarvation(parsed);
    const chronic = classifyStarvation(stats);
    for (const c of chronic) {
      report('score.breakdown', `${c.protocolId} / ${c.directiveId}`, 8, 'WARN',
        `STARVED ${(c.fraction * 100).toFixed(0)}% of ${c.ticks} ticks — declares ${c.need} bars, window ${c.have}`);
    }
    // ⚠️ THE RATIO ABOVE CANNOT REPORT RECOVERY until the window rolls past the fix. Measured
    // 2026-09-28: 30 minutes after the repair landed, this mode still read "95% of 250 ticks"
    // — a state a reader would misread as "the fix failed", which is how a guard gets ignored
    // and then allowlisted. The newest tick is therefore reported separately, and it is the
    // reading to trust when asking "is it fixed NOW?".
    let newest = null;
    for (const bd of parsed) {
      const ts = Date.parse(bd?.timestamp ?? '');
      if (!Number.isFinite(ts)) continue;
      if (!newest || ts > newest.ts) newest = { ts, bd };
    }
    if (newest) {
      let total = 0;
      let starved = 0;
      for (const list of Object.values(newest.bd.breakouts ?? {})) {
        if (!Array.isArray(list)) continue;
        for (const d of list) {
          total++;
          if (STARVATION_RE.test(String(d?.reason ?? ''))) starved++;
        }
      }
      console.log(
        `[guard] bar starvation: NEWEST tick ${newest.bd.timestamp} — ` +
        `${starved}/${total} directive(s) starved. (Trust this for "is it fixed now?"; ` +
        `the ratio below is the 24h backlog.)`,
      );
    }
    console.log(
      `[guard] bar starvation: ${parsed.length} breakdown(s) in ${hours}h, ` +
      `${stats.size} protocol/directive pair(s) observed, ${chronic.length} chronic.`,
    );
  } catch (err) {
    console.log(`[guard] bar starvation: skipped — ${err.message}`);
  } finally {
    await client.$disconnect().catch(() => {});
  }
}

/**
 * `--self-test` — prove the classifier can FAIL, in both directions, with no
 * database and no build. A guard that has never been observed to fail is a
 * decoration, and this one's whole value is that it separates chronic starvation
 * from a transient gap.
 */
function runBarStarvationSelfTest() {
  const mk = (directiveId, ticks, starved, need, have) =>
    ['p|' + directiveId, { protocolId: 'p', directiveId, ticks, starved, need, have }];
  const cases = [
    { name: 'chronic starvation IS reported', stats: new Map([mk('chronic', 100, 99, 72, 20)]), expect: 1 },
    { name: 'transient gap is NOT reported', stats: new Map([mk('gap', 100, 5, 72, 20)]), expect: 0 },
    { name: 'below sample floor is NOT reported', stats: new Map([mk('cold', 3, 3, 72, 2)]), expect: 0 },
    { name: 'exactly at the ratio floor IS reported', stats: new Map([mk('edge', 20, 10, 72, 20)]), expect: 1 },
    { name: 'healthy directive is NOT reported', stats: new Map([mk('ok', 100, 0, 20, 200)]), expect: 0 },
    { name: 'ordering is worst-first', stats: new Map([mk('a', 100, 60, 30, 20), mk('b', 100, 100, 72, 20)]), expect: 2, first: 'b' },
  ];
  let failed = 0;
  for (const c of cases) {
    const got = classifyStarvation(c.stats);
    const ok = got.length === c.expect && (!c.first || got[0]?.directiveId === c.first);
    if (!ok) failed++;
    console.log(`[self-test] ${ok ? 'PASS' : 'FAIL'}  ${c.name}` +
      (ok ? '' : ` (expected ${c.expect}${c.first ? `, first=${c.first}` : ''}; got ${got.length}${got[0] ? `, first=${got[0].directiveId}` : ''})`));
  }
  // The tally must count the REASON, not merely the directive's presence.
  const tally = tallyStarvation([
    { protocolId: 'p', breakouts: { technical: [
      { directiveId: 'starved', reason: 'Insufficient data: need 72 bars, have 20.' },
      { directiveId: 'fine', reason: 'RSI(14)=56.3 -> 17/140' },
    ] } },
    { protocolId: 'p', breakouts: { technical: [
      { directiveId: 'starved', reason: 'Insufficient data: need 72 bars, have 20.' },
    ] } },
  ]);
  const t = tally.get('p|starved');
  const tallyOk = !!t && t.ticks === 2 && t.starved === 2 && t.need === 72 && tally.get('p|fine')?.starved === 0;
  if (!tallyOk) failed++;
  console.log(`[self-test] ${tallyOk ? 'PASS' : 'FAIL'}  tally counts ticks AND starvation separately`);

  // ── mode 1 runtime staleness gate (#881) ────────────────────────────────
  // Both directions, because a one-directional canary cannot tell "the gate works" from "the gate
  // never runs": 'fresh' must stay fresh, and a newer source must be refused.
  const T0 = 1_700_000_000_000;
  const staleCases = [
    { name: 'source newer than dist -> STALE (the #881 case)', args: [T0 + 1000, T0, 112], expect: 'stale' },
    { name: 'dist newer than source -> fresh', args: [T0, T0 + 1000, 112], expect: 'fresh' },
    { name: 'identical mtimes -> fresh (a checkout stamps both)', args: [T0, T0, 112], expect: 'fresh' },
    { name: 'empty dist is not "fresh" -> no-dist', args: [T0, T0, 0], expect: 'no-dist' },
    { name: 'unreadable source mtimes cannot fabricate staleness', args: [0, T0, 112], expect: 'fresh' },
  ];
  for (const c of staleCases) {
    const got = classifyStaleness(...c.args);
    const ok = got === c.expect;
    if (!ok) failed++;
    console.log(`[self-test] ${ok ? 'PASS' : 'FAIL'}  ${c.name}` +
      (ok ? '' : ` (expected ${c.expect}; got ${got})`));
  }

  const total = cases.length + 1 + staleCases.length;
  console.log(`[self-test] mode 8 + mode 1 staleness gate: ${total - failed}/${total} passed.`);
  process.exit(failed === 0 ? 0 : 1);
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const staticOnly = process.argv.includes('--static-only');

  // MODE 8 self-test — standalone: no DB, no build, no static scan.
  if (process.argv.includes('--self-test')) return runBarStarvationSelfTest();

  console.log('[guard] scanning directive implementations...\n');

  const files = fs.readdirSync(IMPL_DIR).filter((f) => /\.(?:directive|stub|directives)\.ts$/.test(f));
  for (const f of files) {
    staticCheckFile(path.join(IMPL_DIR, f));
  }
  console.log(`[guard] static scan complete: ${files.length} files.\n`);

  if (!staticOnly) runtimeCheck();
  if (process.argv.includes('--db')) await readinessEvidenceCheck();
  if (process.argv.includes('--db')) await barStarvationCheck();

  // ⚠️ Checked BEFORE the findings tally. A refusal is not "no findings" - reporting 0 errors after
  // refusing to test would be a false clean, which is the defect #881 is about.
  if (runtimeRefused) {
    console.log('\n[guard] REFUSED: runtime constant-output test did not run (stale build). Others above are current.');
    process.exit(1);
  }

  if (findings.length === 0) {
    console.log('[guard] no findings.');
    process.exit(0);
  }

  const errors = findings.filter((x) => x.severity === 'ERROR');
  const warns = findings.filter((x) => x.severity === 'WARN');
  for (const x of findings) {
    const tag = x.severity === 'ERROR' ? '[ERROR]' : '[WARN ]';
    console.log(`${tag} [mode ${x.mode}] ${x.directive.padEnd(28)} ${x.message}  (${x.file})`);
  }
  console.log(`\n[guard] ${errors.length} error(s), ${warns.length} warning(s).`);
  process.exit(errors.length > 0 ? 1 : 0);
}

main().then(() => { /* readiness-evidence check awaits DB inside */ }).catch((err) => {
  console.error(`[guard] failed: ${err.message}`);
  process.exit(1);
});
