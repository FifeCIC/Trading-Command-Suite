/**
 * validator-ratchet.cjs — the four things every ratcheted validator does, in one place.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────────────────────────────
 * `validate-formatters.cjs`, `validate-colour-literals.cjs` and `validate-page-data-access.cjs` were
 * written hours apart and each carried its own `walk()`, its own baseline reader, its own
 * grown/new/shrunk comparison and its own baseline writer. `validate-duplication.cjs` (INV-NO-NEW-
 * DUPLICATION) caught it as a NEW pair sharing 3 blocks and **failed the build** — which is the
 * intended outcome, and the repair is to extract, not to bank an allowance.
 *
 * ⚠️ The three copies were not merely untidy: they disagreed at the edges. One walked `.js`/`.jsx`
 * and skipped `node_modules`; another also skipped `__tests__`; the third skipped test files by a
 * different pattern. A scan whose population is defined three times has three populations, and the
 * "counts" they produce are not comparable — which matters, because a ratchet compares counts.
 *
 * ── WHAT A RATCHET IS, STATEMENT 152 ────────────────────────────────────────────────────────────
 * A per-file frozen count. A file may not GROW. A file that SHRINKS makes the baseline STALE and
 * must be regenerated in the same change, because a ratchet whose slack is never reclaimed is a
 * ratchet with a hole in it: the next increase would be absorbed silently.
 *
 * Files: `scripts/validate-formatters.cjs`, `scripts/validate-colour-literals.cjs`,
 * `scripts/validate-page-data-access.cjs`.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Every source file under `rootDir`, repo-relative, sorted.
 *
 * ⚠️ The defaults are the POPULATION DEFINITION, so they are stated once and used by all three
 * scans. A caller that needs a different population passes an explicit option and says why.
 */
function sourceFiles(rootDir, opts = {}) {
  const {
    extensions = ['.js', '.jsx'],
    skipDirs = ['node_modules', '__tests__'],
    includeTests = false,
  } = opts;
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (skipDirs.includes(entry.name)) continue;
        walk(full);
        continue;
      }
      if (!extensions.some((e) => entry.name.endsWith(e))) continue;
      if (!includeTests && /\.test\.js$/.test(entry.name)) continue;
      out.push(full);
    }
  };
  walk(rootDir);
  return out.sort();
}

/** `C:\repo\src\a.js` → `src/a.js` — the form a baseline keys on, on every platform. */
function repoRelative(repoRoot, absolute) {
  return path.relative(repoRoot, absolute).split(path.sep).join('/');
}

function readBaseline(baselinePath) {
  if (!fs.existsSync(baselinePath)) return { total: 0, files: {} };
  return JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
}

/**
 * compareToBaseline(counts, baseline) — pure.
 *
 * ⚠️ `shrunk` INCLUDES a file that is in the baseline and no longer appears in `counts` at all. That
 * is the common shape of a real fix (the last occurrence removed), and the first version of one of
 * these scans silently ignored it — the baseline stayed at the old number and the next regression
 * was absorbed without a word.
 */
function compareToBaseline(counts, baseline) {
  const known = baseline && baseline.files ? baseline.files : {};
  const grown = [];
  const newFiles = [];
  const shrunk = [];
  for (const [file, n] of counts) {
    const was = known[file];
    if (was === undefined) newFiles.push({ file, count: n });
    else if (n > was) grown.push({ file, was, count: n });
    else if (n < was) shrunk.push({ file, was, count: n });
  }
  for (const [file, was] of Object.entries(known)) {
    if (!counts.has(file)) shrunk.push({ file, was, count: 0 });
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  return { total, grown, newFiles, shrunk, claimedTotal: typeof baseline?.total === 'number' ? baseline.total : null };
}

function writeBaseline(baselinePath, note, counts, repoRoot) {
  const files = {};
  for (const [file, n] of [...counts.entries()].sort()) files[file] = n;
  const total = Object.values(files).reduce((a, b) => a + b, 0);
  fs.writeFileSync(baselinePath, `${JSON.stringify({ note, total, files }, null, 2)}\n`);
  console.log(
    `[ratchet] wrote ${path.relative(repoRoot, baselinePath).split(path.sep).join('/')} — ${total} site(s) in ${Object.keys(files).length} file(s)`,
  );
  return total;
}

module.exports = { sourceFiles, repoRelative, readBaseline, compareToBaseline, writeBaseline };
