/**
 * validate-create-form-coverage.cjs — a behavioural field cannot reach the create form without its
 * enforcement status (#870).
 *
 * WHY THIS EXISTS
 * ---------------
 * `bot-rules.ts` declares an enforcement stage for every behavioural `trading_strategy` column, and
 * `validate-bot-rules.cjs` fails the build when a column has no declaration. That closes the
 * *backend* half. This closes the FORM half, which was open:
 *
 *   `StrategyCreatePage` submitted 24 fields, and 8 of the declared columns had no live reader —
 *   the whole `hotStock*` block among them. A user could tick "Enable hot stock picks", set an
 *   allocation, save, and **nothing whatsoever happened**, with no indication anywhere on the form.
 *
 * THE RULES — all four are needed, and each caught a real shape
 * ------------------------------------------------------------
 *   A. **Every annotation names a declared field.** `<BotRuleStatus field="htoStockAllocation" />`
 *      is a typo, and a typo renders `UNDECLARED` at runtime — this catches it at build time.
 *   B. **Every submitted field that IS declared carries an annotation.** This is the rule the issue
 *      asks for: a new behavioural column cannot be added to the form without its status.
 *   C. **Every submitted field that is NOT declared is a known non-column**, declared below with a
 *      reason (`watchlistName` is a watchlist link, not a `trading_strategy` column). Without this,
 *      rule B would be satisfiable by simply not declaring the column — which is the defect.
 *   D. **Anti-rot.** A non-column that later BECOMES a column must leave the list, or the exemption
 *      silently covers a field that now needs a status.
 *
 * ⚠️ A verifier that reads nothing must ERROR, never pass. If either the payload or the declaration
 * list comes back empty the guard exits 1 — a parse failure is not a clean bill of health.
 *
 * Usage:  node scripts/validate-create-form-coverage.cjs              # check + exit code
 *         node scripts/validate-create-form-coverage.cjs --report     # list what it read
 *         node scripts/validate-create-form-coverage.cjs --self-test  # prove all four rules can FAIL
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { runCases } = require('../../scripts/lib/self-test.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const PAGE = path.join(ROOT, 'src', 'pages', 'StrategyCreatePage.jsx');
const RULES = path.join(ROOT, 'nest', 'src', 'modules', 'trading', 'bot-rules.ts');

/**
 * Submitted fields that are deliberately NOT `trading_strategy` columns, with the reason.
 * An entry that becomes a real column FAILS the guard (rule D) so it cannot linger.
 */
const NOT_A_COLUMN = {
  watchlistName:
    'A watchlist LINK, not a column: `mode: score` resolves the symbol list from a watchlist rather ' +
    'than storing one. It has no enforcement because there is no field behind it.',
};

/** Field names declared in `bot-rules.ts` (`{ field: 'x', ... }`). */
function declaredFields(source) {
  const out = new Set();
  const re = /\bfield:\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(source)) !== null) out.add(m[1]);
  return out;
}

/** Fields annotated on the page (`<BotRuleStatus field="x"` — double quotes, as JSX requires). */
function annotatedFields(source) {
  const out = new Set();
  const re = /BotRuleStatus\s+field="([^"]+)"/g;
  let m;
  while ((m = re.exec(source)) !== null) out.add(m[1]);
  return out;
}

/**
 * The keys of the `mutate({ ... })` payload — i.e. what the form actually SENDS.
 *
 * Scans the object literal tracking depth and skipping string/template contents, because a naive
 * regex over `/(\w+):/` also matches inside `placeholder=` strings and object values.
 */
function payloadKeys(jsxSource) {
  const start = jsxSource.indexOf('mutate({');
  if (start === -1) return [];
  let i = jsxSource.indexOf('{', start);
  if (i === -1) return [];

  const keys = [];
  let depth = 0;
  let inString = null;
  /**
   * ⚠️ TWO STATES, NOT A LINE CHECK. Two earlier versions were wrong in ways the self-test caught:
   *   • line-based — read only the FIRST key of a single-line payload (`mutate({ a, b })` → `a`);
   *   • comma-separator — treated the comma that TERMINATES a shorthand property (`baseSize,`) as
   *     a separator, so every shorthand key was dropped. Measured on the real page: 14 of 23 keys.
   * A shorthand property ends at `,` or `}`; a `key: value` property ends at `:`. So the scanner
   * matches the terminator explicitly and switches between "expecting a key" and "reading a value".
   */
  let expectKey = false;
  let inValue = false;
  let buffer = '';

  for (; i < jsxSource.length; i++) {
    const c = jsxSource[i];
    if (inString) {
      if (c === '\\') { i++; continue; }
      if (c === inString) inString = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { inString = c; continue; }

    if (inValue && c === ',' && depth === 1) { inValue = false; expectKey = true; buffer = ''; continue; }

    if (expectKey && depth === 1) {
      buffer += c;
      /**
       * ⚠️ SHORTHAND MATTERS. The real payload is mostly `baseSize,` / `slPct,` — a property with
       * no colon. The terminator may be `:`, `,` or the closing `}`.
       */
      const m = buffer.match(/^\s*(?:\.\.\.)?([A-Za-z_$][\w$]*)\s*([:,}])/);
      if (m) {
        keys.push(m[1]);
        if (m[2] === ',') { expectKey = true; }      // shorthand — the next key follows immediately
        else { expectKey = false; inValue = true; }  // `:` opens a value; `}` ends the object
        buffer = '';
      }
      continue;
    }

    if (c === '{' || c === '[' || c === '(') {
      depth++;
      if (depth === 1) { expectKey = true; inValue = false; buffer = ''; }
      continue;
    }
    if (c === '}' || c === ']' || c === ')') {
      depth--;
      if (depth === 0) break; // end of the payload object
      buffer = '';
      continue;
    }
  }
  return keys;
}

/**
 * The whole check over supplied SOURCES (pure — the self-test drives this same code).
 * @returns {{ failures: string[], infos: string[], stats: object }}
 */
function check(jsxSource, rulesSource, notAColumn = NOT_A_COLUMN) {
  const failures = [];
  const infos = [];
  const declared = declaredFields(rulesSource);
  const annotated = annotatedFields(jsxSource);
  const payload = payloadKeys(jsxSource);

  if (declared.size === 0) failures.push('bot-rules.ts yielded ZERO declarations — the parser matched nothing and must not report OK.');
  if (payload.length === 0) failures.push('StrategyCreatePage.jsx yielded ZERO payload keys — the parser matched nothing and must not report OK.');

  // ── Rule A ────────────────────────────────────────────────────────────────
  for (const f of annotated) {
    if (!declared.has(f)) {
      failures.push(
        `annotation names an undeclared field: <BotRuleStatus field="${f}" /> — bot-rules.ts has no ` +
        `such declaration, so this renders UNDECLARED to the user. Fix the name or declare the field.`,
      );
    }
  }

  // ── Rules B and C ─────────────────────────────────────────────────────────
  for (const f of payload) {
    if (declared.has(f)) {
      if (!annotated.has(f)) {
        failures.push(
          `submitted field "${f}" is a declared behavioural column but carries NO enforcement ` +
          `annotation on the form. Add <BotRuleStatus field="${f}" byField={botRuleFields} /> beside ` +
          `it — a field can be configured and applied nowhere, and the user must be able to see which.`,
        );
      }
    } else if (!(f in notAColumn)) {
      failures.push(
        `submitted field "${f}" is not declared in bot-rules.ts and is not a known non-column. ` +
        `Either it is a new behavioural column (declare it in bot-rules.ts and annotate it), or add ` +
        `it to NOT_A_COLUMN in this script with a reason.`,
      );
    }
  }

  // ── Rule D (anti-rot) ─────────────────────────────────────────────────────
  for (const key of Object.keys(notAColumn)) {
    if (declared.has(key)) {
      failures.push(
        `stale exemption: "${key}" is declared in bot-rules.ts but is still listed in ` +
        `NOT_A_COLUMN. Remove the entry — it now suppresses the annotation check for a real column.`,
      );
    }
  }

  if (failures.length === 0) {
    infos.push(`${payload.length} submitted field(s), ${annotated.size} annotated, ${declared.size} declared.`);
  }

  return { failures, infos, stats: { payload: payload.length, annotated: annotated.size, declared: declared.size } };
}

// ─────────────────────────────────────────────────────────────────────────────

function run() {
  const report = process.argv.includes('--report');
  const jsxSource = fs.readFileSync(PAGE, 'utf8');
  const rulesSource = fs.readFileSync(RULES, 'utf8');
  const { failures, infos, stats } = check(jsxSource, rulesSource);

  console.log(
    `[create-form-coverage] ${stats.payload} submitted · ${stats.annotated} annotated · ${stats.declared} declared`,
  );
  if (report) {
    console.log(`   submitted: ${payloadKeys(jsxSource).join(', ')}`);
    console.log(`   annotated: ${[...annotatedFields(jsxSource)].join(', ')}`);
  }
  for (const i of infos) console.log(`   ℹ ${i}`);
  for (const f of failures) console.error(`   ✗ ${f}`);
  if (failures.length) {
    console.error(`[create-form-coverage] ✗ ${failures.length} problem(s) — a field can be configured and applied nowhere without saying so (#870).`);
    return 1;
  }
  console.log('[create-form-coverage] ✅ OK — every field the form submits carries its enforcement status.');
  return 0;
}

function selfTest() {
  const RULES_OK = `
    export const BOT_RULES = [
      { field: 'name', label: 'Name', enforcement: 'display-only' },
      { field: 'baseSize', label: 'Base Size', enforcement: 'live' },
      { field: 'hotStockEnabled', label: 'Hot Stock', enforcement: 'none' },
    ];
  `;
  const PAGE_OK = `
    const handleSubmit = (e) => {
      createMutation.mutate({
        name: name.trim(),
        baseSize,
        hotStockEnabled,
        watchlistName: watchlistName || undefined,
      });
    };
    <span>Name <BotRuleStatus field="name" byField={botRuleFields} /></span>
    <span>Base Size <BotRuleStatus field="baseSize" byField={botRuleFields} /></span>
    <span>Hot <BotRuleStatus field="hotStockEnabled" byField={botRuleFields} /></span>
  `;

  const cases = [];
  const t = (n, fn) => cases.push({ name: n, fn });

  t('baseline: every submitted field carries its status → PASS', () => {
    return check(PAGE_OK, RULES_OK).failures.length === 0;
  });

  t('CANARY a submitted declared field with no annotation → FAIL (rule B)', () => {
    // Explicit variant rather than a regex edit — a canary that silently fails to make its own
    // edit reports a working guard as broken, which is worse than no canary.
    const p = `
      createMutation.mutate({
        name: name.trim(),
        baseSize,
        hotStockEnabled,
        watchlistName: watchlistName || undefined,
      });
      <BotRuleStatus field="name" byField={x} />
      <BotRuleStatus field="hotStockEnabled" byField={x} />
    `;
    const r = check(p, RULES_OK);
    return r.failures.some((f) => /"baseSize".*NO enforcement/.test(f));
  });

  t('CANARY an annotation naming an undeclared field → FAIL (rule A)', () => {
    const p = PAGE_OK + '\n<span>Typo <BotRuleStatus field="baseSizes" byField={botRuleFields} /></span>';
    const r = check(p, RULES_OK);
    return r.failures.some((f) => /undeclared field: <BotRuleStatus field="baseSizes"/.test(f));
  });

  t('CANARY a submitted field that is neither declared nor exempt → FAIL (rule C)', () => {
    const p = PAGE_OK.replace('watchlistName: watchlistName || undefined,', 'mysteryField: 1,');
    const r = check(p, RULES_OK);
    return r.failures.some((f) => /"mysteryField" is not declared/.test(f));
  });

  t('a known non-column is exempt from the annotation rule', () => {
    const r = check(PAGE_OK, RULES_OK);
    return r.failures.length === 0; // watchlistName is in NOT_A_COLUMN and has no annotation
  });

  t('CANARY a stale exemption (now a real column) → FAIL (rule D)', () => {
    const rules2 = RULES_OK.replace("{ field: 'hotStockEnabled'", "{ field: 'watchlistName'");
    const r = check(PAGE_OK, rules2);
    return r.failures.some((f) => /stale exemption: "watchlistName"/.test(f));
  });

  t('CANARY no payload parsed → ERROR, never PASS', () => {
    const r = check('<div>no form here</div>', RULES_OK);
    return r.failures.some((f) => /ZERO payload keys/.test(f));
  });

  t('CANARY no declarations parsed → ERROR, never PASS', () => {
    const r = check(PAGE_OK, 'export const X = 1;');
    return r.failures.some((f) => /ZERO declarations/.test(f));
  });

  t('the payload scanner ignores string contents and nested objects', () => {
    const p = `
      createMutation.mutate({
        name: name.trim(),
        nested: { shouldNotCount: 1 },
        label: 'a: b',
        baseSize,
        hotStockEnabled,
        watchlistName: watchlistName || undefined,
      });
      <BotRuleStatus field="name" byField={x} />
      <BotRuleStatus field="baseSize" byField={x} />
      <BotRuleStatus field="hotStockEnabled" byField={x} />
    `;
    const keys = payloadKeys(p);
    return keys.includes('name') && keys.includes('baseSize') && keys.includes('nested')
      && !keys.includes('shouldNotCount') && !keys.includes('b');
  });

  t('a single-line payload still yields every key', () => {
    const p = `createMutation.mutate({ baseSize, hotStockEnabled });`;
    const keys = payloadKeys(p);
    return keys.includes('baseSize') && keys.includes('hotStockEnabled');
  });

  return runCases(cases, 'create-form-coverage');
}

if (require.main === module) {
  if (process.argv.includes('--self-test')) process.exit(selfTest());
  else process.exit(run());
}

module.exports = { declaredFields, annotatedFields, payloadKeys, check, NOT_A_COLUMN };
