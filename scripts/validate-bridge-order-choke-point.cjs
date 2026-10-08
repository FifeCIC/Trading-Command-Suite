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
 * | R5 | Every CLOSE request stamps `TCS:<origin>` | an unattributed close would read as "the owner did it" |
 *
 * ⚠️ R5's CONTEXT (owner direction, 2026-10-07, R46): *"The app should assume that it was me if
 * there is no record of the bot closing a position."* That assumption is only SAFE while every close
 * path of ours leaves a record — a close through our own bridge with no `TCS:` stamp would be
 * silently attributed to the owner. Measured before this rule: `/close/partial` stamped
 * `'Partial close'` and `/orders/bulk` stamped `'TCS Bulk Close'` — neither matches the parser's
 * `TCS:<origin>` shape, so both parsed as foreign and fell through to the deal-reason enum.
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
const NEST_ROOT = path.join(__dirname, '..', 'nest', 'src');
const BARE_CALL = /mt5\.order_send\s*\(/;
const WRAPPER_DEF = 'def order_send_checked(';

/** Every non-spec `.ts` under nest/src, recursively. */
function walkTs(dir) {
  const out = [];
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkTs(p));
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

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
 * requestDicts() — every `req = { … }` dict literal in the source, joined with its start line.
 *
 * Deliberately shallow: the bridge builds its requests as plain multi-line dict literals that end
 * with `}` at column zero-ish, and a rule that asks "does THIS request carry a stamp?" does not
 * need a Python parser. A dict that never closes on `}` simply swallows the rest of the file — the
 * rule below then sees whatever stamps those lines contain, which is conservative for a REQUIRED
 * stamp (it can only miss, never invent, a violation) — and the self-test proves the rule fires.
 */
function requestDicts(src) {
  const lines = src.split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/\breq\w*\s*=\s*\{/.test(lines[i]) || /^\s*#/.test(lines[i])) continue;
    let text = lines[i];
    let j = i;
    while (!/}\s*$/.test(lines[j]) && j + 1 < lines.length) { j++; text += '\n' + lines[j]; }
    out.push({ line: i + 1, text });
    i = j;
  }
  return out;
}

/**
 * nestCloseViolations() — a NestJS source file whose `/close/…` call site does not mention `origin`.
 *
 * PURE, so `--self-test` can drive it. The manager's form (`?origin=${...}` on the line, or a
 * `query` variable built from `origin` 2 lines above) passes via a small window; anything else is
 * a close that would be recorded as "the owner" by default (R46 direction) when it is really ours.
 */
function nestCloseViolations(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  lines.forEach((line, i) => {
    // ONLY real calls: a backticked ROUTE MENTION (e.g. a `_migrateTo` doc string) is not a call
    // site — narrowing here is the difference between a guard and a false-positive generator.
    if (!/(fetch|positionAction)\s*\(/.test(line)) return;
    if (!/\/close\/(partial\/)?\$\{/.test(line)) return;
    const window = lines.slice(Math.max(0, i - 8), i + 1).join('\n');
    if (!/origin/.test(window)) out.push({ line: i + 1, text: line.trim() });
  });
  return out;
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

  // ── R5 — every CLOSE stamps its closer (#916; owner direction 2026-10-07, R46). ──
  // A position-targeting MARKET request (DEAL + 'position') is a close. Each one must carry a
  // `TCS:` comment — otherwise `closeReasonFromComment()` parses it as foreign and the close is
  // attributed to the OWNER by the new default. Opens carry no 'position' key and are skipped.
  for (const d of requestDicts(src)) {
    if (!d.text.includes('TRADE_ACTION_DEAL') || !/'position':/.test(d.text)) continue;
    const m = /'comment':\s*([^\n]+)/.exec(d.text);
    if (!m || !m[1].includes('TCS:')) {
      errors.push(
        `R5 the position-targeting market request at L${d.line} carries NO \`TCS:\` comment — an ` +
          'unattributed close reads as "the owner did it" (owner direction 2026-10-07). Every ' +
          'bridge close must stamp `TCS:<origin>`.',
      );
    }
  }
  const legacyStamp = /'comment':\s*'(?:Partial close|TCS Bulk Close)'/.exec(src);
  if (legacyStamp) {
    errors.push(
      `R5 the old UNSTAMPED comment form ${legacyStamp[0]} is back — it parses as a foreign comment ` +
        '(the shape must be `TCS:<origin>`, #916).',
    );
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

  ['R5 catches a position close whose comment is not a TCS stamp',
    () => checkSource(REAL_SRC.replace("'comment': f'TCS:{close_origin}',", "'comment': 'Close by TCS',"))
      .some((e) => e.startsWith('R5'))],

  ['R5 catches the legacy unstamped comment form reappearing',
    () => checkSource(
      REAL_SRC + "\n                req = {'action': mt5.TRADE_ACTION_DEAL, 'position': 1, 'comment': 'Partial close'}\n",
    ).some((e) => e.startsWith('R5'))],

  // ── R5 (nest side) — close call sites must carry origin. ──
  ['nest: a /close/ call site without origin is flagged',
    () => nestCloseViolations('await fetch(`${url}/close/${t}`, { method: "POST" });').length === 1],

  ['nest: the manager form (origin inside a query built above) passes',
    () => nestCloseViolations(
      'const query = origin ? `?origin=${encodeURIComponent(origin)}` : "";\n' +
      'const { ok } = await this.fetch(`/close/${ticket}${query}`, {}, brokerId);',
    ).length === 0],

  ['nest: an inline ?origin= passes',
    () => nestCloseViolations('fetch(`${bridge.url}/close/${ticket}?origin=manual`, { method: "POST" });').length === 0],

  ['nest: a backticked route mention (not a call) is NOT flagged',
    () => nestCloseViolations('return { ...data, _migrateTo: `DELETE /api/trading/mt5/close/${ticket}` };').length === 0],

  [
    'the self-test can reach the real file',
    () => fs.existsSync(BRIDGE) && REAL_SRC.length > 1000,
  ],
];

if (process.argv.includes('--self-test')) {
  runSelfTest(cases);
} else {
  const errors = checkSource(REAL_SRC);
  const nestErrors = [];
  for (const file of walkTs(NEST_ROOT)) {
    for (const v of nestCloseViolations(fs.readFileSync(file, 'utf8'))) {
      nestErrors.push(
        `R5 ${path.relative(process.cwd(), file)}:${v.line} — /close call site without \`origin=\` ` +
          '(an unattributed close would read as "the owner", R46 direction): ' + v.text,
      );
    }
  }
  const all = [...errors, ...nestErrors];
  if (all.length) {
    console.error('\n🛑 bridge order choke point (#1035) — FAILED\n');
    for (const e of all) console.error(`  ✗ ${e}\n`);
    console.error(`  Checked: ${BRIDGE} + nest/src/**/*.ts\n`);
    process.exit(1);
  }
  console.log('✅ bridge order choke point (#1035) — every order passes one gate');
  console.log(`   ${BRIDGE.replace(process.cwd() + path.sep, '')}: 1 real mt5.order_send(), inside order_send_checked()`);
  console.log('   close stamping (#916 / R46): every close request carries `TCS:<origin>`; every nest /close call site names one');
}
