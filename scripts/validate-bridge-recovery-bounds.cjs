/**
 * validate-bridge-recovery-bounds.cjs — #1000's two invariants, as a build-time guard.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────
 *
 * `docs/SETTLED-DECISIONS.md` row 37 records the decision and names its own unguarded half, in its
 * own words: *"The recovery half has **NO GUARD**: nothing fails if a future agent adds a
 * thread-based watchdog believing it covers the hard case."*
 *
 * This is that guard. It checks two things that were each paid for by a measurement:
 *
 *   INV-BRIDGE-CONNECT-IS-BOUNDED   every `mt5.initialize(...)` call passes `timeout=`
 *   INV-BRIDGE-RECONNECT-IS-OPT-IN  the unattended reconnect defaults OFF
 *
 * ── WHY THESE TWO, AND NOT "no new threads" ─────────────────────────────────────────────────
 *
 * A rule against threads would be a rule against a MECHANISM, and it would fire on the two threads
 * that are correct (the HTTP server and the classifier watchdog). The failure this repo actually
 * suffered was narrower and is expressible:
 *
 *   · An `mt5.initialize()` WITHOUT a timeout BLOCKS THE INTERPRETER. Against an unreachable server
 *     it never returns, so the daemon threads never run — which is precisely why an in-process
 *     watchdog cannot cover the startup hang. Passing the timeout is what makes the call return,
 *     and it is an argument that was always available: none of the six call sites passed one.
 *   · The unattended reconnect was turned OFF on 2026-09-30 after one `/reconnect` on a canary was
 *     followed by BOTH live bridges reporting `terminal-down`. An automatic action whose blast
 *     radius is unknown must default to OFF, and a future agent "restoring" the default to `true`
 *     would silently re-arm an outage on a money path.
 *
 * Both are checkable from the source, both have an observed failure, and neither fires on the
 * threads that are correct.
 *
 * ── WHAT IT CANNOT SEE, STATED RATHER THAN IMPLIED ──────────────────────────────────────────
 *
 * · It reads SOURCE, so a timeout supplied through a variable it cannot resolve is a false
 *   negative. It reports what it could not parse instead of assuming it is fine.
 * · It says nothing about whether a NEW thread is safe. That is a judgement, not a pattern.
 * · ⚠️ `MetaTrader5` is NOT thread-safe and the bridge holds NO LOCK. This guard does not detect
 *   the addition of a second concurrent MT5 caller — see #1000's own note in the register.
 *
 * Usage:
 *   node scripts/validate-bridge-recovery-bounds.cjs              # check
 *   node scripts/validate-bridge-recovery-bounds.cjs --self-test  # prove it can fail
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { runCases, stripComments } = require('./lib/validator-helpers.cjs');

const ROOT = path.resolve(__dirname, '..');
const BRIDGE = path.join(ROOT, 'scripts', 'mt5-bridge', 'mt5_bridge_v2.py');
const RECOVERY = path.join(ROOT, 'nest', 'src', 'modules', 'providers', 'mt5', 'mt5-session-recovery.service.ts');

/**
 * stripPythonComments() — `stripComments` is written for JS/TS and does NOT know `#`, so on the
 * Python bridge it strips nothing and every `mt5.initialize()` MENTIONED IN PROSE becomes a finding.
 *
 * ⚠️ MEASURED on the first real run: it reported `mt5_bridge_v2.py:2192 — mt5.initialize() with no
 * timeout=`, and line 2192 is a `#` comment explaining why the port is bound before the connect. A
 * guard that fires on a comment describing the fix is a guard that gets allowlisted, and an
 * allowlisted guard is worse than none.
 *
 * Handles `#`, and both quote styles including triple-quoted docstrings — the file's own header
 * docstring mentions these call names, and a docstring is prose, not code.
 */
function stripPythonComments(src) {
  let out = '';
  let i = 0;
  let quote = null;
  let docstring = false;
  while (i < src.length) {
    const ch = src[i];
    if (quote) {
      if (ch === '\\') { out += src.slice(i, i + 2); i += 2; continue; }
      if (src.startsWith(quote, i)) {
        out += docstring ? ' '.repeat(quote.length) : quote;
        i += quote.length;
        quote = null;
        docstring = false;
        continue;
      }
      if (ch === '\n') { out += '\n'; i++; continue; }
      // ⚠️ A NORMAL STRING KEEPS ITS CONTENTS, AND THAT IS THE WHOLE POINT. The first version
      // blanked every string, which turned `setdefault('timeout', ...)` into `setdefault('      ',
      // ...)` — so the rule that resolves an injected timeout could not match the very line it
      // depends on. A DOCSTRING is blanked instead, because it is prose and the module header
      // discusses these call names in sentences.
      out += docstring ? ' ' : ch;
      i++;
      continue;
    }
    if (ch === '#') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (ch === '"' || ch === "'") {
      const triple = src.slice(i, i + 3) === ch.repeat(3);
      quote = triple ? ch.repeat(3) : ch;
      docstring = triple;
      // ⚠️ THE OPENING QUOTE IS KEPT FOR A NORMAL STRING. Emitting a space here turned
      // `kwargs['path']` into `kwargs[ path']` and `setdefault('timeout'` into
      // `setdefault( timeout'` — which is why the injected-timeout rule could not match the line it
      // depends on. Found by printing the window the scanner actually reads rather than reasoning
      // about it; the raw source looked correct.
      out += docstring ? ' '.repeat(quote.length) : quote;
      i += quote.length;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/**
 * Pure: every `mt5.initialize(` call in a source string, with whether it passes `timeout=`.
 *
 * Scans to the matching close paren by counting depth, because the six shipped call sites span
 * multiple lines and a line-based check would read a truncated call and pass it.
 */
function initializeCalls(src, opts = {}) {
  const clean = opts.python ? stripPythonComments(src) : stripComments(src);
  const out = [];
  const needle = 'mt5.initialize(';
  let i = clean.indexOf(needle);
  while (i !== -1) {
    let depth = 0;
    let j = i + needle.length - 1; // points at the '('
    for (; j < clean.length; j++) {
      if (clean[j] === '(') depth++;
      else if (clean[j] === ')') { depth--; if (depth === 0) break; }
    }
    const call = clean.slice(i, j + 1);
    // ⚠️ THE ARGUMENT CAN BE INJECTED, AND THE FIRST REAL RUN PROVED IT. Line 2120 ships
    // `mt5.initialize(**kwargs)`, which shows no `timeout=` at the call site — the timeout is set
    // on the line ABOVE by `kwargs.setdefault('timeout', MT5_INIT_TIMEOUT_MS)`. A guard that reads
    // only the call reports a WORKING, bounded call as a violation, and a guard with a false
    // positive is a guard that gets allowlisted.
    //
    // So a `**`-style call is resolved by looking BACKWARDS for the timeout being injected into the
    // mapping it unpacks. If it is not found there, the answer is UNKNOWN — reported as unresolved,
    // never as a violation, because "I could not read it" and "it is wrong" are different facts.
    const indirect = /\*\*/.test(call);
    const before = clean.slice(Math.max(0, i - 600), i);
    const injectedTimeout = /setdefault\(\s*['"]timeout['"]/.test(before) || /\[\s*['"]timeout['"]\s*\]\s*=/.test(before);
    out.push({
      line: clean.slice(0, i).split('\n').length,
      // ⚠️ Matched on the ARGUMENT, not on the word "timeout" — a comment or a variable named
      // `timeout_seconds` used for something else would otherwise satisfy the check.
      bounded: /[,(\s]timeout\s*=/.test(call) || (indirect && injectedTimeout),
      unresolved: indirect && !injectedTimeout,
      call: call.replace(/\s+/g, ' ').slice(0, 120),
      beforeWindow: before.slice(-160).replace(/\s+/g, ' '),
    });
    i = clean.indexOf(needle, j);
  }
  return out;
}

/** Pure: does the unattended reconnect default to OFF? Returns the parsed default or null. */
function unattendedReconnectDefault(src) {
  const clean = stripComments(src);
  // Shape 1 — a named field.
  const named = clean.match(/unattendedReconnectEnabled[^=]*=\s*(true|false)/);
  if (named) return named[1] === 'true';
  // Shape 2 — the SHIPPED shape: an initial-state object with `enabled: false`. ⚠️ The interface
  // above it declares `enabled: boolean`, with no literal, so matching on the literal is what
  // separates the TYPE from the DEFAULT. Matched on the first literal occurrence, which is the
  // state initialiser.
  const literal = clean.match(/\benabled\s*:\s*(true|false)/);
  if (literal) return literal[1] === 'true';
  return null;
}

// ─────────────────────────────────────────────────────────────────── self-test ──
if (process.argv.includes('--self-test')) {
  const cases = [];
  const t = (name, fn) => cases.push([name, fn]);

  t('an initialize() with NO timeout is a violation', () => {
    const calls = initializeCalls(`ok = mt5.initialize(path=mpath)`);
    return calls.length === 1 && calls[0].bounded === false;
  });
  t('an initialize() with a timeout passes', () => {
    const calls = initializeCalls(`ok = mt5.initialize(path=mpath, timeout=MT5_INIT_TIMEOUT_MS)`);
    return calls.length === 1 && calls[0].bounded === true;
  });
  t('a MULTI-LINE call is read whole, not truncated at the newline', () => {
    const src = 'init = mt5.initialize(\n  login=int(a),\n  server=s,\n  timeout=8000,\n)';
    const calls = initializeCalls(src);
    return calls.length === 1 && calls[0].bounded === true;
  });
  t('a MULTI-LINE call with no timeout is still caught (the truncation trap)', () => {
    const src = 'init = mt5.initialize(\n  login=int(a),\n  server=s,\n)';
    return initializeCalls(src)[0].bounded === false;
  });
  t('the word "timeout" NOT as an argument does not satisfy it', () => {
    // A call that merely mentions timeout in a nested expression is not a bounded call.
    return initializeCalls(`mt5.initialize(no_timeout_here(x))`)[0].bounded === false;
  });
  t('the count is the number of CALLS, so six shipped sites are all checked', () => {
    const src = 'a = mt5.initialize(path=p)\nb = mt5.initialize(path=p, timeout=1)\nc = mt5.initialize(path=p)';
    const calls = initializeCalls(src);
    return calls.length === 3 && calls.filter((c) => !c.bounded).length === 2;
  });
  t('a timeout in a COMMENT does not count (comments are stripped)', () => {
    return initializeCalls(`mt5.initialize(path=p)  # pass timeout= later`)[0].bounded === false;
  });

  // ── the Python stripper, which the first REAL run proved was needed ───────────────────────
  t('PYTHON: a `#` comment mentioning mt5.initialize() is NOT a call', () =>
    initializeCalls(`# the fix is to call mt5.initialize() with a timeout\nx = 1`, { python: true }).length === 0);
  t('PYTHON: a real call next to a comment IS found, and read correctly', () => {
    const calls = initializeCalls(
      `# mt5.initialize() is discussed here\nok = mt5.initialize(path=p, timeout=1)  # bounded`,
      { python: true },
    );
    return calls.length === 1 && calls[0].bounded === true;
  });
  t('PYTHON: a TRIPLE-QUOTED docstring mentioning it is prose, not a call', () =>
    initializeCalls(`"""Says mt5.initialize() here."""\nx = 1`, { python: true }).length === 0);
  t('PYTHON: a `#` inside a STRING does not start a comment', () => {
    // If `#` were treated as a comment inside a string, the rest of the line would vanish and the
    // next real statement would be misread — the failure mode that makes a stripper dangerous.
    const calls = initializeCalls(`s = "a # b"\nok = mt5.initialize(path=p, timeout=1)`, { python: true });
    return calls.length === 1 && calls[0].bounded === true;
  });
  t('PYTHON: line numbers survive stripping — a finding must point at the REAL line', () => {
    const calls = initializeCalls(`# one\n# two\nok = mt5.initialize(path=p)`, { python: true });
    return calls.length === 1 && calls[0].line === 3;
  });
  t('PYTHON: an UNBOUNDED real call is still a violation (the stripper is not too eager)', () =>
    initializeCalls(`ok = mt5.initialize(path=p)`, { python: true })[0].bounded === false);

  // ── the injected-argument shape, which the first real run ALSO proved was needed ──────────
  t('an INJECTED timeout via setdefault() resolves as BOUNDED, not as a violation', () => {
    const src = `kwargs = dict(login=1)\nkwargs.setdefault('timeout', MT5_INIT_TIMEOUT_MS)\nok = mt5.initialize(**kwargs)`;
    const c = initializeCalls(src, { python: true })[0];
    return c.bounded === true && c.unresolved === false;
  });
  t('an injected-timeout call with NO setdefault is UNRESOLVED — not a pass, not a violation', () => {
    const c = initializeCalls(`ok = mt5.initialize(**kwargs)`, { python: true })[0];
    return c.bounded === false && c.unresolved === true;
  });
  t('the injected form is not mistaken for a bounded one by a timeout in a NEIGHBOURING call', () => {
    const src = `a = mt5.initialize(path=p, timeout=1)\nok = mt5.initialize(**kwargs)`;
    const c = initializeCalls(src, { python: true })[1];
    return c.unresolved === true;
  });
  t('reconnect defaulting to false is OPT-IN (the shipped state)', () =>
    unattendedReconnectDefault(`private unattendedReconnectEnabled = false;`) === false);
  t('the SHIPPED shape — interface then state literal — reads the LITERAL, not the type', () =>
    unattendedReconnectDefault('interface S { enabled: boolean; }\nconst state: S = { enabled: false, };') === false);
  t('the shipped shape flipped to true is caught', () =>
    unattendedReconnectDefault('interface S { enabled: boolean; }\nconst state: S = { enabled: true, };') === true);
  t('reconnect defaulting to TRUE is caught — this is the one that re-arms an outage', () =>
    unattendedReconnectDefault(`private readonly unattendedReconnectEnabled: boolean = true;`) === true);
  t('an undetectable default returns null, NOT false — unknown is not "safe"', () =>
    unattendedReconnectDefault(`const x = computeIt();`) === null);

  const failed = runCases(cases);
  console.log(failed === 0
    ? '\nSELFTEST PASSED — both invariants fire in both directions on fixtures'
    : `\nSELFTEST FAILED (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

// ─────────────────────────────────────────────────────────────────── real run ──
const violations = [];

if (!fs.existsSync(BRIDGE)) {
  console.error(`INV-BRIDGE-CONNECT-IS-BOUNDED: cannot read ${BRIDGE} — ERRORING rather than passing.`);
  process.exit(2);
}

const bridgeSrc = fs.readFileSync(BRIDGE, 'utf8');
const calls = initializeCalls(bridgeSrc, { python: true });
if (calls.length === 0) {
  // ⚠️ A check that inspects NOTHING and reports OK is worse than no check.
  console.error('INV-BRIDGE-CONNECT-IS-BOUNDED: found ZERO mt5.initialize() call sites — the scan is broken, not the bridge.');
  process.exit(2);
}
for (const c of calls) {
  if (!c.bounded && !c.unresolved) {
    violations.push(`mt5_bridge_v2.py:${c.line} — mt5.initialize() with no timeout= (blocks the interpreter)\n      ${c.call}`);
  }
}

// ⚠️ A THIRD OUTCOME, AND IT IS NOT A PASS. A call whose arguments are injected through a mapping
// this scan cannot resolve is neither proved bounded nor proved unbounded. Reporting it as OK would
// be a false pass; reporting it as a violation would be a false positive. It exits 2 — "could not
// judge" — which is the honest answer and is visibly different from both.
const unresolved = calls.filter((c) => c.unresolved);
if (unresolved.length) {
  console.log(`[bridge-recovery-bounds] ⚠️ ${unresolved.length} call(s) could not be RESOLVED:\n`);
  for (const c of unresolved) {
    console.log(`  mt5_bridge_v2.py:${c.line} — ${c.call}\n`);
    if (process.argv.includes('--why')) {
      console.log(`    DEBUG before-window: ${JSON.stringify(c.beforeWindow)}\n`);
    }
  }
  console.log('  Not a pass and not a violation: the timeout may be injected into the mapping this');
  console.log('  call unpacks, and this scan cannot see it. Read the call site and, if it is bounded,');
  console.log('  teach this guard the shape rather than leaving it unresolved.');
  process.exit(2);
}

if (!fs.existsSync(RECOVERY)) {
  console.error(`INV-BRIDGE-RECONNECT-IS-OPT-IN: cannot read ${RECOVERY} — ERRORING rather than passing.`);
  process.exit(2);
}
const recoverySrc = fs.readFileSync(RECOVERY, 'utf8');
const def = unattendedReconnectDefault(recoverySrc);
if (def === null) {
  console.error('INV-BRIDGE-RECONNECT-IS-OPT-IN: could not determine the default — ERRORING rather than passing.');
  process.exit(2);
}
if (def === true) {
  violations.push(
    'mt5-session-recovery.service.ts — the unattended reconnect defaults ON. It was turned OFF on ' +
    '2026-09-30 after one POST /reconnect on a canary was followed by BOTH live bridges reporting ' +
    'terminal-down. Re-arming it needs the blast radius ISOLATED first, not a default flipped.',
  );
}

if (violations.length) {
  console.log(`[bridge-recovery-bounds] ✖ ${violations.length} violation(s):\n`);
  for (const v of violations) console.log(`  ${v}\n`);
  console.log('  Row 37 of docs/SETTLED-DECISIONS.md is the reasoning. A blocking MT5 call stops the');
  console.log('  interpreter, so daemon threads never run — bounding the call is what makes recovery');
  console.log('  possible at all, and the unattended action stays OFF until its blast radius is measured.');
  process.exit(1);
}

console.log(
  `[bridge-recovery-bounds] ✅ ${calls.length} mt5.initialize() call(s) all bounded; ` +
    'unattended reconnect defaults OFF',
);
