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
 *
 * Usage:
 *   node nest/scripts/directive-guard.cjs              # static + runtime
 *   node nest/scripts/directive-guard.cjs --static-only # skip runtime (no build)
 *
 * Exit code: 1 if any ERROR-level finding (mode 1 static on a `ready` directive),
 * 0 otherwise. WARN findings are advisory and do not fail the run.
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
  'price', 'eurusdValue', 'dxyValue', 'accountId', 'account', 'quote', 'timestamp',
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

function runtimeCheck() {
  if (!fs.existsSync(DIST_DIR)) {
    console.log(`\n[guard] dist not found at ${DIST_DIR} - run "npm run build" first (or use --static-only).`);
    return;
  }
  const inputA = makeInput(0, 0.1);
  const inputB = makeInput(3, -0.6);
  const files = fs.readdirSync(DIST_DIR).filter((f) => /\.(?:directive|stub|directives)\.js$/.test(f));
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

// ── Main ──────────────────────────────────────────────────────────────────

function main() {
  const staticOnly = process.argv.includes('--static-only');
  console.log('[guard] scanning directive implementations...\n');

  const files = fs.readdirSync(IMPL_DIR).filter((f) => /\.(?:directive|stub|directives)\.ts$/.test(f));
  for (const f of files) {
    staticCheckFile(path.join(IMPL_DIR, f));
  }
  console.log(`[guard] static scan complete: ${files.length} files.\n`);

  if (!staticOnly) runtimeCheck();

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

main();
