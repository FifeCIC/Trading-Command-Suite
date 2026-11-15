#!/usr/bin/env node
/**
 * validate-css-parses.cjs — a stylesheet the minifier cannot parse is styling that never applied
 * ==============================================================================================
 * THE DEFECT THIS CLOSES, measured 2026-11-15. `vite.config.js` carried
 *
 *     cssMinify: false, // lightningcss is too strict — disable CSS minification for now
 *
 * That comment described a real symptom and drew the wrong conclusion. The minifier was not "too
 * strict" — **20 stylesheets in `src/` were genuinely invalid** and it was the only thing in the
 * build that noticed. Turning it off silenced the messenger and shipped the broken CSS.
 *
 * A browser is lenient in a way that hides this: it DROPS an invalid rule and renders the rest, with
 * no error, no console message and no failing request. So invalid CSS is indistinguishable from
 * "that styling was never wanted" — the repo's most expensive failure signature (plausible output,
 * no error). Measured consequence: `.cm-table`, `.tp-comparison-table`, `.sig-loop-table`,
 * `.uir-table`, `.rll-table`, `.pc-table` and `.tp-config-table` were all still rendered by their
 * pages while their rules had been **deleted** by a botched text replacement in commit `ac63fa7f`
 * (2026-10-15), leaving `}undefined { … }` fragments where the rules used to be. Tables silently
 * lost `min-width`, `border-collapse`, sticky headers and cell padding.
 *
 * ── TWO CHECKS, AND THE SECOND ONE IS THE SURPRISING ONE ───────────────────────────────────────
 *
 *   C1  PARSE — every `src/**\/*.css` must parse with the SAME parser the build minifies with
 *       (lightningcss, `minify: true`). Catches orphaned declarations, stray braces, a comment
 *       spliced into an `@media`, a truncated property name, and `**\/` inside a comment (which
 *       closes the comment early and turns prose into CSS).
 *
 *   C2  `undefined` TOKEN — the splice that actually happened is **syntactically VALID CSS**.
 *       `}undefined { min-width: 640px; }` parses fine: `undefined` is a legal TYPE SELECTOR, so the
 *       parser accepts a rule targeting an element that does not exist. Measured in the self-test:
 *       C1 alone PASSES that string. So C1 cannot be the whole guard, and this is the check that
 *       catches the primary corruption rather than only its side effects.
 *
 * ⚠️ C2 MUST STRIP COMMENTS FIRST. Nine stylesheets here legitimately discuss "undefined" in prose
 * about theme tokens ("an undefined custom property is dropped at runtime"). A naive `grep undefined`
 * flags all nine, gets allowlisted, and then covers nothing. C2 reads the source with comments
 * removed, so a comment SAYING "undefined" passes while a rule USING it fails.
 *
 *   node scripts/validate-css-parses.cjs              # --check (the prebuild form)
 *   node scripts/validate-css-parses.cjs --self-test  # prove BOTH checks, BOTH directions
 *
 * ⚠️ WHY `minify: true` for C1. That is exactly what `build.cssMinify: 'lightningcss'` runs, so the
 * gate cannot disagree with the build. A gate that parses more leniently than the build passes while
 * the build fails.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');

let transform;
try {
  ({ transform } = require('lightningcss'));
} catch {
  // A check that cannot read its input must ERROR, never pass. Exiting 0 here would report
  // "all stylesheets valid" having inspected nothing.
  console.error('✖ lightningcss is not installed — CANNOT JUDGE. Run `npm ci` in the repo root.');
  process.exit(2);
}

function listStylesheets(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'node_modules') listStylesheets(p, out);
    } else if (e.name.endsWith('.css')) {
      out.push(p);
    }
  }
  return out;
}

/**
 * Remove block comments while respecting strings, so a comment that merely MENTIONS a corruption
 * shape cannot trip the token check. Newlines are preserved so reported line numbers stay true.
 */
function stripComments(code) {
  let out = '';
  let i = 0;
  let quote = null;
  while (i < code.length) {
    const ch = code[i];
    const next = code[i + 1];
    if (quote) {
      out += ch;
      if (ch === '\\') {
        out += next || '';
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      out += ch;
      i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      let j = i + 2;
      while (j < code.length && !(code[j] === '*' && code[j + 1] === '/')) j++;
      const closed = j < code.length;
      const body = code.slice(i, closed ? j + 2 : code.length);
      out += body.replace(/[^\n]/g, ' ');
      i = closed ? j + 2 : code.length;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** C2 — `undefined` used as a selector or a property, outside comments. */
function findUndefinedTokens(code) {
  const stripped = stripComments(code);
  const hits = [];
  const lines = stripped.split('\n');
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    if (/(^|[};,]|\s)undefined\s*(\{|\}|:)/.test(line)) {
      hits.push({
        line: n + 1,
        message: `\`undefined\` used as a selector or property — ${line.trim().slice(0, 80)}`,
      });
    }
  }
  return hits;
}

/**
 * Run both checks against one stylesheet.
 * @returns {Array<{line: number|string, message: string, check: 'C1'|'C2'}>}
 */
function problems(code, filename = 'inline.css') {
  const text = Buffer.isBuffer(code) ? code.toString('utf8') : String(code);
  const found = [];
  try {
    transform({ filename, code: Buffer.from(text), minify: true });
  } catch (e) {
    found.push({
      check: 'C1',
      line: (e.loc && e.loc.line) || '?',
      message: String(e.message || e).split('\n')[0],
    });
  }
  for (const h of findUndefinedTokens(text)) found.push({ check: 'C2', ...h });
  return found;
}

function check() {
  const files = listStylesheets(SRC);
  if (files.length === 0) {
    console.error('✖ No stylesheets found under src/ — CANNOT JUDGE.');
    process.exit(2);
  }
  let bad = 0;
  for (const f of files) {
    const found = problems(fs.readFileSync(f), f);
    if (found.length === 0) continue;
    bad++;
    console.error(`\n✖ ${path.relative(ROOT, f)}`);
    for (const p of found) console.error(`    [${p.check}] L${p.line}: ${p.message}`);
  }
  if (bad === 0) {
    console.log(`✅ ${files.length} stylesheets parse cleanly and contain no \`undefined\` rule.`);
    return 0;
  }
  console.error(
    `\n✖ ${bad} of ${files.length} stylesheets FAILED.` +
      '\n\nA browser silently DROPS an invalid rule — so this styling is not applied and nothing reports it.' +
      '\nFix the CSS. Do NOT set `build.cssMinify: false` to silence this: that is what shipped 20' +
      '\nbroken stylesheets between 2026-10-15 and 2026-11-15.'
  );
  return 1;
}

function selfTest() {
  const cases = [
    // ── must PASS ────────────────────────────────────────────────────────────────────────────
    { name: 'valid CSS', code: '.a { color: red; }\n@media (max-width: 600px) { .a { color: blue; } }\n', expect: true },
    {
      name: 'COMMENT mentioning "undefined" (must NOT false-positive — 9 real files do this)',
      code: '/* An undefined custom property is dropped at runtime. */\n.a { color: var(--x); }\n',
      expect: true,
    },
    {
      name: 'COMMENT documenting the corruption itself (our own repair notes do this)',
      code: '/* This read: }undefined { min-width: 920px; } — repaired. */\n.a { color: red; }\n',
      expect: true,
    },
    {
      name: 'prose in a comment mentioning a src/ path',
      code: '/* measured by grepping every .jsx file under src/ */\n.a { color: red; }\n',
      expect: true,
    },

    // ── must FAIL ────────────────────────────────────────────────────────────────────────────
    {
      name: 'C2: `}undefined { … }` splice — VALID CSS, so only the token check can see it',
      code: '.wrap { overflow-x: auto; }undefined { min-width: 640px; }\n',
      expect: false,
      mustBeCaughtBy: 'C2',
    },
    {
      name: 'C2: `undefined` as an entire selector',
      code: 'undefined { display: grid; }\n.a { color: red; }\n',
      expect: false,
      mustBeCaughtBy: 'C2',
    },
    {
      name: 'C1: orphaned declarations with no selector',
      code: '.a { color: red; }\n  color: blue;\n  margin-top: 2px;\n}\n',
      expect: false,
      mustBeCaughtBy: 'C1',
    },
    {
      name: 'C1: `**/` inside a comment closes it early, so prose becomes CSS',
      code: '/* grepping every `src/**/*.jsx` for each selector */\n.a { color: red; }\n',
      expect: false,
      mustBeCaughtBy: 'C1',
    },
    {
      name: 'C1: a comment spliced into an @media opening',
      code: '@media (max-width: 600px) {─────────── */\n.a { color: red; }\n',
      expect: false,
      mustBeCaughtBy: 'C1',
    },
    {
      name: 'C1: stray `}` producing an empty selector',
      code: '.a { color: red; }\n}\n\n/* next */\n.b { color: blue; }\n',
      expect: false,
      mustBeCaughtBy: 'C1',
    },
    {
      name: 'C1: truncated property name (`}ex: 1;`)',
      code: '.a { color: red; }ex: 1;\n  background: blue;\n}\n',
      expect: false,
      mustBeCaughtBy: 'C1',
    },
  ];

  let failed = 0;
  for (const c of cases) {
    const found = problems(c.code, 'selftest.css');
    const pass = found.length === 0;
    let good = pass === c.expect;
    let detail = '';
    if (good && c.mustBeCaughtBy) {
      // the named check must be the one that fires, or the case passes for the wrong reason
      const checks = new Set(found.map((f) => f.check));
      if (!checks.has(c.mustBeCaughtBy)) {
        good = false;
        detail = `caught by [${[...checks].join(',') || 'none'}], expected ${c.mustBeCaughtBy}`;
      }
    }
    if (good) {
      console.log(`  ✅ ${c.name} → ${pass ? 'PASS' : 'FAIL'}${c.mustBeCaughtBy ? ` (${c.mustBeCaughtBy})` : ''}`);
    } else {
      failed++;
      const got = pass ? 'PASS' : `FAIL via [${[...new Set(found.map((f) => f.check))].join(',')}]`;
      console.log(`  ✖ ${c.name}`);
      console.log(`      expected ${c.expect ? 'PASS' : `FAIL via ${c.mustBeCaughtBy || 'any check'}`}, got ${got}`);
      if (detail) console.log(`      ${detail}`);
    }
  }
  const mustPass = cases.filter((c) => c.expect).length;
  console.log(
    `\n${cases.length - failed}/${cases.length} self-test cases behaved correctly (${mustPass} must-pass, ${cases.length - mustPass} must-fail)`
  );
  return failed === 0 ? 0 : 1;
}

const arg = process.argv[2];
if (arg === '--self-test') {
  console.log('validate-css-parses — self-test\n');
  process.exit(selfTest());
} else if (arg === '--help' || arg === '-h') {
  console.log('usage: node scripts/validate-css-parses.cjs [--self-test] [--help]');
  process.exit(0);
} else if (arg && arg !== '--check') {
  // ⚠️ An unrecognised flag must never fall through to a check that reports OK — that is how
  // `tools-index.cjs --help` silently rewrote two tracked files. Unknown flag => refuse.
  console.error(`✖ Unknown argument: ${arg}`);
  console.error('usage: node scripts/validate-css-parses.cjs [--self-test] [--help]');
  process.exit(2);
} else {
  process.exit(check());
}
