#!/usr/bin/env node
/**
 * validate-css-tokens.cjs — the "CSS variable actually exists" gate
 * ==================================================================
 * Created 2026-09-15 after a user report:
 *
 *   "It's dark. It also looks like the notice style with left coloured bar which I don't like."
 *
 * The notice looked dark because its background was `var(--color-input-bg)` — a token that exists.
 * The *deeper* defect was next door: `screen-cockpit.css` styled its notices with
 * `var(--text, #e2e8f0)` and `var(--surface-2, #1e293b)`. **Neither `--text` nor `--surface-2` is
 * defined anywhere in this repo.** An undefined custom property is NOT a build error — the
 * declaration is simply "invalid at computed-value time" and the FALLBACK silently wins. So the
 * page was pinned to hardcoded hex and ignored the active theme pack entirely, with no warning
 * from the compiler, the bundler, or any of the 8 existing validators.
 *
 * That is the same failure shape as `INV-*` in meta-stack-contracts: **plausible output, no error.**
 * This gate makes the mistake loud instead.
 *
 * WHY BOTH SEVERITIES EXIST
 * -------------------------
 *   ❌ FAIL   token undefined AND no fallback → the declaration is dropped; the element inherits or
 *             renders unstyled. Strictly broken.
 *   ❌ FAIL   token undefined WITH a fallback → it renders, but the fallback is a hardcoded hex, so
 *             the element is frozen out of every theme pack. This is the exact bug reported above,
 *             and it is why "has a fallback" is NOT treated as safe here.
 *
 * A fallback on a token that IS defined is fine and never flagged (`var(--color-muted, #64748b)`
 * is a defensive default, not a theme blind spot).
 *
 * WHERE TOKENS ARE DISCOVERED (a token is only "defined" if it comes from one of these)
 * ------------------------------------------------------------------------------------
 *   1. Any `--name: value` declaration in any CSS file under `src/` (index.css, theme packs, pages).
 *   2. Any `'--name': …` object key in the theme JS under `src/theme` — the vanilla adapter emits
 *      CSS vars this way (`--bg-elev`, `--border`, `--text-dim`, `--text-faint`, `--risk-*`).
 *   3. Any `setProperty('--name', …)` call anywhere under `src/`.
 *
 * ⚠️ If you add a NEW way to publish a CSS variable, add it here — otherwise this gate starts
 * reporting false positives and someone will disable it.
 *
 * THE BASELINE RATCHET
 * --------------------
 * On 2026-09-15 this gate found **407** undefined references across **39** files. That pre-existing
 * debt cannot be fixed in one commit, and a gate that fails on day one gets deleted — so the known
 * set is frozen in `scripts/css-token-baseline.json` and the gate fails only on **NEW** findings.
 *
 *   NEW finding        → ❌ exit 1. The whole point: instance N+1 cannot be added.
 *   BASELINED finding  → recorded, not fatal. Paying it down means removing baseline entries.
 *   FIXED finding      → reported as stale so the baseline shrinks instead of rotting.
 *
 * Usage:
 *   node scripts/validate-css-tokens.cjs                  # gate (exit 1 on any NEW finding)
 *   node scripts/validate-css-tokens.cjs --list           # every undefined reference
 *   node scripts/validate-css-tokens.cjs --list-new       # only findings not in the baseline
 *   node scripts/validate-css-tokens.cjs --tokens         # tokens the scanner considers defined
 *   node scripts/validate-css-tokens.cjs --update-baseline  # shrink/grow the frozen set
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const SRC = path.join(REPO_ROOT, 'src');
const BASELINE_PATH = path.join(__dirname, 'css-token-baseline.json');

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', 'coverage']);

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name), out);
    } else {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

const allFiles = walk(SRC);
const cssFiles = allFiles.filter((f) => f.endsWith('.css'));
const jsFiles = allFiles.filter((f) => /\.(js|jsx|ts|tsx)$/.test(f));

/** Collect every custom property this repo publishes, with the file that publishes it. */
function collectDefinedTokens() {
  const defined = new Map(); // name -> first file that defines it

  // 1. `--name: value` in any CSS file.
  for (const file of cssFiles) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/(^|[\s;{])(--[a-zA-Z0-9-]+)\s*:/g)) {
      if (!defined.has(m[2])) defined.set(m[2], path.relative(REPO_ROOT, file));
    }
  }

  // 2. `'--name':` object keys + 3. `setProperty('--name'` — both live in JS.
  for (const file of jsFiles) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/['"`](--[a-zA-Z0-9-]+)['"`]\s*:/g)) {
      if (!defined.has(m[1])) defined.set(m[1], path.relative(REPO_ROOT, file));
    }
    for (const m of text.matchAll(/setProperty\(\s*['"`](--[a-zA-Z0-9-]+)['"`]/g)) {
      if (!defined.has(m[1])) defined.set(m[1], path.relative(REPO_ROOT, file));
    }
  }

  return defined;
}

/**
 * Find every `var(--name…)` reference in the CSS.
 * `var(--a, var(--b, #hex))` gives two references; each is judged independently.
 */
function collectReferences() {
  const refs = [];
  for (const file of cssFiles) {
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split(/\r?\n/);
    lines.forEach((line, i) => {
      for (const m of line.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)\s*(,)?/g)) {
        refs.push({
          token: m[1],
          hasFallback: m[2] === ',',
          file: path.relative(REPO_ROOT, file),
          line: i + 1,
          source: line.trim(),
        });
      }
    });
  }
  return refs;
}

/** Baseline entries are `file::token` (NOT line numbers — those shift with every unrelated edit). */
function loadBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) return { entries: [], note: null };
  const raw = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
  return { entries: raw.entries || [], note: raw.note || null };
}

function writeBaseline(entries) {
  const payload = {
    note:
      'Frozen undefined-CSS-token debt for scripts/validate-css-tokens.cjs. ' +
      'Entries are `file::token` keys of PRE-EXISTING findings — they are reported but do not fail ' +
      'the gate, so instance N+1 of this bug cannot be added. Remove an entry when you fix it; ' +
      'regenerate with `node scripts/validate-css-tokens.cjs --update-baseline`.',
    generatedAt: new Date().toISOString().slice(0, 10),
    count: entries.length,
    entries,
  };
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function main() {
  const argv = process.argv.slice(2);
  const defined = collectDefinedTokens();
  const refs = collectReferences();

  if (argv.includes('--tokens')) {
    console.log(`Defined CSS custom properties: ${defined.size}\n`);
    for (const [name, file] of [...defined].sort((a, b) => a[0].localeCompare(b[0]))) {
      console.log(`  ${name.padEnd(26)} ${file}`);
    }
    return 0;
  }

  const findings = refs.filter((r) => !defined.has(r.token));
  const key = (f) => `${f.file}::${f.token}`;

  if (argv.includes('--update-baseline')) {
    const unique = [...new Set(findings.map(key))].sort();
    writeBaseline(unique);
    console.log(`📌 Baseline written — ${unique.length} distinct file::token entries → ${path.relative(REPO_ROOT, BASELINE_PATH)}`);
    return 0;
  }

  if (argv.includes('--list') || argv.includes('--list-new')) {
    const { entries } = loadBaseline();
    const known = new Set(entries);
    const rows = argv.includes('--list-new') ? findings.filter((f) => !known.has(key(f))) : findings;
    for (const f of rows) {
      const tag = known.has(key(f)) ? '' : '  ← NEW';
      console.log(`${f.file}:${f.line}  ${f.token}${f.hasFallback ? ' (fallback)' : ' (NO fallback)'}${tag}`);
    }
    console.log(`\n${rows.length} undefined reference(s) in ${new Set(rows.map((f) => f.file)).size} file(s).`);
    return 0;
  }

  const { entries } = loadBaseline();
  const known = new Set(entries);
  const fresh = findings.filter((f) => !known.has(key(f)));
  const present = new Set(findings.map(key));
  const stale = entries.filter((e) => !present.has(e));

  if (fresh.length === 0) {
    const tail = stale.length
      ? ` — ⚠️ ${stale.length} baseline entry/entries now FIXED; run --update-baseline to shrink it.`
      : '';
    console.log(
      `✅ OK — no NEW undefined CSS tokens. ${refs.length} var() references checked, ` +
      `${defined.size} tokens defined, ${known.size} pre-existing finding(s) baselined.${tail}`
    );
    return 0;
  }

  const byToken = new Map();
  for (const f of fresh) {
    if (!byToken.has(f.token)) byToken.set(f.token, []);
    byToken.get(f.token).push(f);
  }

  console.error('\n❌ NEW CSS variable(s) referenced but NEVER DEFINED:\n');
  for (const [token, list] of [...byToken].sort((a, b) => b[1].length - a[1].length)) {
    const noFallback = list.filter((f) => !f.hasFallback).length;
    console.error(`  ${token}  —  ${list.length} reference(s) in ${new Set(list.map((f) => f.file)).size} file(s)` +
      (noFallback ? `, ${noFallback} with NO fallback` : ''));
    for (const f of list.slice(0, 6)) {
      console.error(`      ${f.file}:${f.line}`);
    }
    if (list.length > 6) console.error(`      … +${list.length - 6} more`);
  }

  console.error(
    '\nAn undefined custom property is not a build error — the declaration is dropped, or the\n' +
    'fallback (a hardcoded hex) silently wins and the element ignores every theme pack.\n' +
    '\nFix: use a token that exists. Canonical text/surface tokens are:\n' +
    '  --ink (primary text) · --ink-soft (secondary) · --panel · --bg · --line · --bg-elev\n' +
    'Run `node scripts/validate-css-tokens.cjs --tokens` for the full list.\n' +
    `\n${fresh.length} NEW reference(s) in ${new Set(fresh.map((f) => f.file)).size} file(s).` +
    `\n(${known.size} pre-existing finding(s) remain baselined and are not fatal.)\n`
  );
  return 1;
}

process.exit(main());
