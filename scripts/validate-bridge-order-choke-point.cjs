#!/usr/bin/env node
/**
 * validate-bridge-order-choke-point.cjs — EVERY order the MT5 bridge sends passes ONE gate (#1035).
 * ==================================================================================================
 *
 * ## The invariant
 *
 * `mt5.order_send()` appears **exactly once** in `scripts/mt5-bridge/mt5_bridge_v2.py` — inside
 * `order_send_checked()`. Every mutating route (`/order`, `/close/<ticket>`,
 * `/close/partial/<ticket>`, `/order/modify`, and all three actions in `/orders/bulk`) sends
 * through that wrapper, which refuses when the bridge is attached to an account it was not
 * configured for.
 *
 * ⚠️ WHY THE GATE IS AT THE ACTION AND NOT AT A LIST OF ROUTES. A hand-maintained route allowlist
 * drifts: a new endpoint is added, nobody adds it to the list, and the gap is silent. Keying on the
 * thing every order route must do — send an order — makes the check impossible to forget. **This
 * file is what keeps that true.** Without it, the next endpoint to call `mt5.order_send` directly
 * places real orders on the wrong account and nothing says so.
 *
 * ## Why that matters more than it sounds
 *
 * Measured 2026-09-30 (#1035): a canary bridge started with `MT5_ACCOUNT_9=99999999` /
 * `MT5_SERVER_9=NoSuchServer-Demo` attached to `62135531 @ PepperstoneUK-Demo` — a LIVE account —
 * and reported `success: true`. `mt5.initialize()` with credentials it cannot honour falls back to
 * an already-running terminal, and nothing compared the request with the result.
 *
 * **A bridge on the wrong account is worse than a bridge that is down: the down one REFUSES, the
 * wrong one ACCEPTS.** Per-broker routing, risk caps, the stop guardian and `brokerTicket`
 * reconciliation all assume the slot→account binding holds.
 *
 * ## Rules
 *
 * | # | Rule | Fails when |
 * |---|---|---|
 * | R1 | Exactly one real `mt5.order_send(` | a new call site bypassed the gate |
 * | R2 | It is inside `order_send_checked()` | the one call was moved out of the wrapper |
 * | R3 | `BridgeRefusal` is raised AND caught twice | the gate cannot fire, or a refusal becomes a 500 |
 * | R4 | `ensure_mt5()` does NOT carry the gate | reads got gated too — the app could no longer SEE the position |
 *
 * ⚠️ R4 IS A REAL DESIGN DECISION, NOT PADDING. Gating `ensure_mt5()` would look tidier and would
 * break `/health`, `/positions`, `/account` and the quote routes — hiding the very position someone
 * needs to look at. The gate is on the ACTION; reads stay open. Moving it is a regression even
 * though it would make this file simpler.
 *
 * ## Usage
 *
 * ```powershell
 * node scripts/validate-bridge-order-choke-point.cjs            # exit 1 on a violation
 * node scripts/validate-bridge-order-choke-point.cjs --self-test
 * ```
 *
 * Wired into `nest` `prebuild` alongside `validate-single-bridge-position-io.cjs`.
 */
const fs = require('fs');
const path = require('path');
const { runSelfTest } = require('./lib/validator-helpers.cjs');

const BRIDGE = path.join(__dirname, 'mt5-bridge', 'mt5_bridge_v2.py');
const BARE_CALL = /mt5\.order_send\s*\(/;
const WRAPPER_DEF = 'def order_send_checked(';

/**
 * isProse() — a line that MENTIONS `mt5.order_send(` but cannot CALL it.
 *
 * ⚠️ Backticks are not valid Python syntax outside a string or a comment, so any line carrying one
 * is prose by construction. This bridge documents its own defect and quotes the call it forbids —
 * as does every instruction file in this repo — and a guard that cannot tell prose from code fails
 * on its own documentation. That is the failure mode this predicate exists to prevent.
 */
function isProse(line) {
  return line.trim().startsWith('#') || line.includes('`');
}

/** Every REAL (non-prose) `mt5.order_send(` in `src`, 1-based line numbers. */
function bareOrderSends(src) {
  const out = [];
  src.split(/\r?\n/).forEach((line, i) => {
    if (BARE_CALL.test(line) && !isProse(line)) out.push({ line: i + 1, text: line.trim() });
  });
  return out;
}

/**
 * bodyOf() — the text of the top-level `def <name>(` block, up to the next top-level statement.
 * Returns '' when the definition is absent, so callers can tell "no such function" from "empty".
 */
function bodyOf(src, defPrefix) {
  const lines = src.split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith(defPrefix));
  if (start === -1) return '';
  const rest = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^(def |class )/.test(lines[i])) break;
    rest.push(lines[i]);
  }
  return rest.join('\n');
}

/**
 * checkSource() — the rules, as a PURE function of the source text, so `--self-test` can drive every
 * branch without touching the real bridge. Returns an array of human-readable violations (empty = OK).
 */
function checkSource(src) {
  const errors = [];
  const lines = src.split(/\r?\n/);

  // ── R3a — the gate must be able to FIRE at all. ──
  if (!/raise BridgeRefusal\(/.test(src)) {
    errors.push('R3 order_send_checked never RAISES BridgeRefusal — the credential gate cannot fire.');
  }

  // ── R3b — and the refusal must keep its structured body. ──
  // Two catch sites: do_POST (for the single-order routes) and the /orders/bulk loop, whose own
  // `except Exception` would otherwise flatten the notice code into a bare string.
  const catches = lines.filter((l) => /except BridgeRefusal/.test(l)).length;
  if (catches < 2) {
    errors.push(
      `R3 BridgeRefusal is caught ${catches} time(s); expected >= 2 (do_POST + the /orders/bulk loop). ` +
        'An uncaught refusal reaches the generic handler, which returns a 500 and loses the notice code.',
    );
  }

  // ── R4 — the gate is on the ACTION; ensure_mt5() must stay ungated. ──
  // The negative lookahead on '#' keeps a comment MENTIONING it from failing the guard.
  const ensure = bodyOf(src, 'def ensure_mt5(');
  if (/credential_mismatch/.test(ensure)) {
    errors.push(
      'R4 the credential gate has been moved INTO ensure_mt5(). That is a regression, not a ' +
        'simplification: ensure_mt5() is used by /health, /positions, /account and the quote routes, ' +
        'so gating it BLINDS the app to the position it most needs to see. Keep the gate in ' +
        'order_send_checked() (#1035).',
    );
  }

  // ── R1 / R2 — one call, inside the wrapper. ──
  const defLine = lines.findIndex((l) => l.startsWith(WRAPPER_DEF)) + 1;
  const calls = bareOrderSends(src);

  if (!defLine) {
    errors.push(`R2 \`${WRAPPER_DEF}\` is GONE — there is no choke point to hold the gate.`);
  }
  if (calls.length !== 1) {
    errors.push(
      `R1 expected exactly ONE real \`mt5.order_send(\` (the one inside the choke point), found ` +
        `${calls.length}${calls.length ? ': ' + calls.map((c) => `L${c.line} ${c.text}`).join(' | ') : ''}` +
        ' — a call site has BYPASSED the credential-binding gate (#1035).',
    );
  } else if (defLine) {
    const body = bodyOf(src, WRAPPER_DEF);
    const bodyStart = defLine + 1;
    const bodyEnd = bodyStart + body.split('\n').length - 1;
    if (calls[0].line <= defLine || calls[0].line > bodyEnd) {
      errors.push(
        `R2 the one real \`mt5.order_send(\` is at L${calls[0].line}, OUTSIDE ` +
          `order_send_checked() (L${defLine}-${bodyEnd}).`,
      );
    }
  }

  return errors;
}

// ── Self-test — every rule, in BOTH directions. ───────────────────────────────────────────────
// A rule that has never been observed to fail is a decoration. Each case below breaks exactly one
// thing and asserts the SPECIFIC rule that should notice.
const REAL_SRC = fs.readFileSync(BRIDGE, 'utf8');

/** The real source with every `except BridgeRefusal` line removed — R3b must notice. */
const withoutCatches = REAL_SRC.split(/\r?\n/)
  .filter((l) => !/except BridgeRefusal/.test(l))
  .join('\n');

const cases = [
  ['the REAL bridge satisfies every rule', () => checkSource(REAL_SRC).length === 0],

  [
    'R1 catches a second bare call outside the wrapper',
    () =>
      checkSource(REAL_SRC + '\n\ndef bypass(req):\n    return mt5.order_send(req)\n')
        .some((e) => e.startsWith('R1')),
  ],

  [
    'R2 catches the one call moved out of the wrapper',
    () =>
      checkSource(
        REAL_SRC.replace('    return mt5.order_send(req)', '    return None') +
          '\n\ndef elsewhere(req):\n    return mt5.order_send(req)\n',
      ).length > 0,
  ],

  [
    'R3 catches the bulk-loop catch being removed',
    () => checkSource(withoutCatches).some((e) => e.startsWith('R3')),
  ],

  [
    'R3 catches the raise being removed',
    () =>
      checkSource(REAL_SRC.replace(/raise BridgeRefusal\(/, 'return None  # '))
        .some((e) => e.startsWith('R3')),
  ],

  ['R4 catches the gate being moved into ensure_mt5()', () => {
    // ⚠️ Anchored on the def LINE, not on the following docstring text — the bridge file is CRLF,
    // and a multi-line '\\n' literal silently fails to match, which made this case pass for the
    // wrong reason (the replace was a no-op, so nothing was broken and nothing was noticed).
    const gated = REAL_SRC.replace(
      /(def ensure_mt5\([^\n]*\r?\n)/,
      '$1    if credential_mismatch is not None:\r\n        return False, "wrong account"\r\n',
    );
    return gated !== REAL_SRC && checkSource(gated).some((e) => e.startsWith('R4'));
  }],

  ['R2 catches the wrapper definition being deleted', () =>
    checkSource(REAL_SRC.replace(WRAPPER_DEF, 'def order_send_ungated(')).some((e) => e.startsWith('R2'))],

  // ── The prose/comment exemption, which is what stops this guard failing on its own docs. ──
  [
    'a backticked mention in a docstring is NOT a call',
    () => bareOrderSends('    """`mt5.order_send()` with the refusal in front of it."""').length === 0,
  ],

  [
    'a # comment mention is NOT a call',
    () => bareOrderSends('    # if a bare `mt5.order_send(` reappears, fail').length === 0,
  ],

  ['a REAL call IS found', () => bareOrderSends('    return mt5.order_send(req)').length === 1],

  [
    'the self-test can reach the real file',
    () => fs.existsSync(BRIDGE) && REAL_SRC.length > 1000,
  ],
];

if (process.argv.includes('--self-test')) {
  runSelfTest(cases);
} else {
  const errors = checkSource(REAL_SRC);
  if (errors.length) {
    console.error('\n🛑 bridge order choke point (#1035) — FAILED\n');
    for (const e of errors) console.error(`  ✗ ${e}\n`);
    console.error(`  Checked: ${BRIDGE}\n`);
    process.exit(1);
  }
  console.log('✅ bridge order choke point (#1035) — every order passes one gate');
  console.log(`   ${BRIDGE.replace(process.cwd() + path.sep, '')}: 1 real mt5.order_send(), inside order_send_checked()`);
}
