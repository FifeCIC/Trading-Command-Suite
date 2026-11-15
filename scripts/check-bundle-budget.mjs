#!/usr/bin/env node
/**
 * check-bundle-budget.mjs — bundle size is a property, so it needs a guard that can PASS
 * =======================================================================================
 * THE DEFECT THIS CLOSES (#987, measured 2026-09-23 and re-measured 2026-11-15). This script used to
 * compare the entry chunk against **hardcoded** budgets:
 *
 *     MAX_JS_BYTES = 280000      MAX_CSS_BYTES = 12000
 *
 * Measured reality at the time: JS 3,697,654 B and CSS 1,255,365 B — **13x and 105x** over, and today
 * the entry chunk alone is **4,879,567 B** (17x). No single change could account for that, so the
 * guard failed on **every** run, including a clean checkout. A light that is always red is
 * indistinguishable from no light: the next real regression hides inside the noise.
 *
 * ── THE FIX: ONE ABSOLUTE CHECK AND ONE RATCHET ────────────────────────────────────────────────
 *
 * WHY NOT just raise 280000 to the current size? Because then the number means nothing and the guard
 * is a decoration with extra steps. The budgets were not miscalibrated — they were answering the
 * wrong question. So:
 *
 *   C1  PWA CLIFF — ABSOLUTE, and the only number here that is a FACT rather than a preference.
 *       `vite.config.js` sets `workbox.maximumFileSizeToCacheInBytes`. Workbox **SKIPS** any asset
 *       larger than it, and `vite-plugin-pwa` then FAILS the build. That limit is read from
 *       `vite.config.js` at run time and never duplicated here — two copies of one number is the
 *       drift this repo pays for repeatedly.
 *
 *       ⚠️ IT IS CLOSE. Measured 2026-11-15: entry chunk 4,879,567 B against a 5,242,880 B cap —
 *       **354.8 KB (7.4%) of headroom**. The config already carries a comment saying the cap was
 *       raised from 4 MB because *that* line "was repeatedly exceeded". This check exists so the
 *       next ascent is announced while it is still a warning.
 *
 *   C2  RATCHET — entry JS, entry CSS, total `dist/` and the PWA precache total against
 *       `scripts/bundle-baseline.json`. Size may go DOWN freely; it may not go UP without someone
 *       deliberately re-freezing the baseline, which shows up as a reviewable diff.
 *
 * ⚠️ WHY A RATCHET AND NOT A TARGET. There is no honest absolute target for this app today: it is a
 * single-page shell whose `src/core/view-routes.jsx` statically imports **153** page components with
 * zero `React.lazy` (#1280), so the entry chunk is 4.65 MB by construction. A number invented now
 * would be fiction. The ratchet still does the job a budget does — it makes growth a decision rather
 * than an accident — and #1280 is the change that will let a real target be set.
 *
 *   node scripts/check-bundle-budget.mjs                   # the check
 *   node scripts/check-bundle-budget.mjs --update-baseline # re-freeze after a deliberate change
 *   node scripts/check-bundle-budget.mjs --self-test       # prove every rule, both directions
 *
 * ⚠️ EXIT CODES, DELIBERATELY THREE. 0 = pass, 1 = a real budget violation, **2 = CANNOT JUDGE**
 * (no `dist/`, or the PWA cap unreadable). The old script exited 1 for a missing `dist/`, which is
 * the worst of both worlds: it reads as a budget failure when nothing was measured at all.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const ASSETS = path.join(DIST, 'assets');
const CONFIG = path.join(ROOT, 'vite.config.js');
const BASELINE = path.join(ROOT, 'scripts', 'bundle-baseline.json');

/** Warn once an asset is within this fraction of the PWA cap. */
const CLIFF_WARN_AT = 0.9;

/** Files `vite-plugin-pwa` precaches — mirrors `workbox.globPatterns` in vite.config.js. */
const PRECACHE_RE = /\.(js|css|html|svg|png|ico|json|webmanifest)$/;

/**
 * Read `workbox.maximumFileSizeToCacheInBytes` from `vite.config.js`.
 * Handles `5 * 1024 * 1024`, a plain literal and underscores. Returns null when it cannot be found,
 * and the caller MUST treat that as "cannot judge" rather than defaulting — a default here would
 * silently guard a different number from the one the build enforces.
 */
function parsePwaCap(source) {
  const m = source.match(/maximumFileSizeToCacheInBytes\s*:\s*([0-9*\s_xX]+)/);
  if (!m) return null;
  const raw = m[1].trim().replace(/[_\s]/g, '');
  if (!/^[0-9*xX]+$/.test(raw)) return null;
  const parts = raw.split('*').map((p) => Number(p));
  if (parts.some((n) => !Number.isFinite(n))) return null;
  const value = parts.reduce((a, b) => a * b, 1);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * `bytes <= cap` passes. The boundary is INCLUSIVE because workbox skips only files LARGER than the
 * cap, so a file at exactly the cap is still precached. The self-test asserts both sides of it.
 * @returns {'ok'|'warn'|'fail'}
 */
function cliffVerdict(bytes, cap) {
  if (bytes > cap) return 'fail';
  if (bytes >= cap * CLIFF_WARN_AT) return 'warn';
  return 'ok';
}

/**
 * Ratchet: growth fails, shrink passes and is reported so the baseline can be tightened.
 * @returns {'grew'|'same'|'shrank'}
 */
function ratchetVerdict(current, baseline) {
  if (current > baseline) return 'grew';
  if (current < baseline) return 'shrank';
  return 'same';
}

function listFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listFiles(p, out);
    else out.push(p);
  }
  return out;
}

function measure() {
  const all = listFiles(DIST);
  const rel = (p) => path.relative(ROOT, p);
  const pickLargest = (re) =>
    all.filter((p) => re.test(path.basename(p))).sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0];

  const entryJs = pickLargest(/^index-.*\.js$/);
  if (!entryJs) return null;
  const entryCss = pickLargest(/^index-.*\.css$/);

  const biggest = all.reduce(
    (acc, p) => {
      const size = fs.statSync(p).size;
      return size > acc.size ? { file: rel(p), size } : acc;
    },
    { file: null, size: -1 }
  );

  const precache = all.filter((p) => PRECACHE_RE.test(p));
  return {
    entryJs: { file: rel(entryJs), size: fs.statSync(entryJs).size },
    entryCss: entryCss ? { file: rel(entryCss), size: fs.statSync(entryCss).size } : null,
    biggest,
    totalDist: all.reduce((s, p) => s + fs.statSync(p).size, 0),
    precache: { count: precache.length, size: precache.reduce((s, p) => s + fs.statSync(p).size, 0) },
    fileCount: all.length,
  };
}

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;

function check() {
  if (!fs.existsSync(ASSETS)) {
    console.error(`✖ ${path.relative(ROOT, ASSETS)} does not exist — CANNOT JUDGE. Run \`npm run build\` first.`);
    return 2;
  }

  const cap = parsePwaCap(fs.readFileSync(CONFIG, 'utf8'));
  if (cap === null) {
    console.error('✖ Could not read `workbox.maximumFileSizeToCacheInBytes` from vite.config.js — CANNOT JUDGE.');
    console.error('  Guessing a cap here would guard a different number from the one the build enforces.');
    return 2;
  }

  const m = measure();
  if (!m) {
    console.error('✖ No entry chunk matching `assets/index-*.js` — CANNOT JUDGE.');
    return 2;
  }

  if (!fs.existsSync(BASELINE)) {
    console.error(`✖ No baseline at ${path.relative(ROOT, BASELINE)} — CANNOT JUDGE.`);
    console.error('  Create it: node scripts/check-bundle-budget.mjs --update-baseline');
    return 2;
  }
  const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));

  const problems = [];
  const notes = [];

  // ── C1: the PWA cliff, absolute ───────────────────────────────────────────────────────────
  const cliff = cliffVerdict(m.biggest.size, cap);
  const headroom = cap - m.biggest.size;
  if (cliff === 'fail') {
    problems.push(
      `C1 the largest asset is OVER the PWA precache cap — \`npm run build\` will FAIL.\n` +
        `     ${m.biggest.file} is ${m.biggest.size.toLocaleString()} B; cap is ${cap.toLocaleString()} B ` +
        `(over by ${Math.abs(headroom).toLocaleString()} B).\n` +
        `     Fix: split it, or raise \`workbox.maximumFileSizeToCacheInBytes\` in vite.config.js DELIBERATELY.`
    );
  } else if (cliff === 'warn') {
    notes.push(
      `C1 ⚠️  ${m.biggest.file} is at ${((m.biggest.size / cap) * 100).toFixed(1)}% of the PWA cap ` +
        `— only ${kb(headroom)} of headroom before the build fails.`
    );
  }

  // ── C2: the ratchet ──────────────────────────────────────────────────────────────────────
  const rows = [
    ['entry JS', m.entryJs.size, baseline.entryJsBytes],
    ['entry CSS', m.entryCss ? m.entryCss.size : 0, baseline.entryCssBytes],
    ['total dist', m.totalDist, baseline.totalDistBytes],
    ['precache', m.precache.size, baseline.precacheBytes],
  ];
  for (const [label, current, base] of rows) {
    if (typeof base !== 'number') {
      problems.push(`C2 the baseline has no \`${label}\` figure — re-freeze it with --update-baseline`);
      continue;
    }
    const v = ratchetVerdict(current, base);
    if (v === 'grew') {
      problems.push(
        `C2 ${label} GREW: ${kb(base)} → ${kb(current)} (+${kb(current - base)}, +${(((current - base) / base) * 100).toFixed(1)}%)\n` +
          `     If that is intended, re-freeze: node scripts/check-bundle-budget.mjs --update-baseline`
      );
    } else if (v === 'shrank') {
      notes.push(`C2 ${label} shrank ${kb(base)} → ${kb(current)} — tighten the baseline with --update-baseline`);
    }
  }

  console.log(
    `Bundle: entry JS ${mb(m.entryJs.size)} · entry CSS ${m.entryCss ? mb(m.entryCss.size) : 'n/a'} · ` +
      `dist ${mb(m.totalDist)} (${m.fileCount} files) · precache ${mb(m.precache.size)} (${m.precache.count} entries)`
  );
  console.log(
    `PWA cliff: largest asset ${kb(m.biggest.size)} of ${mb(cap)} cap ` +
      `(${((m.biggest.size / cap) * 100).toFixed(1)}%, headroom ${kb(headroom)})`
  );

  for (const n of notes) console.log(`  ${n}`);

  if (problems.length) {
    console.error(`\n✖ Bundle check FAILED (${problems.length}):`);
    for (const p of problems) console.error(`  ${p}`);
    return 1;
  }
  console.log('✅ Bundle check passed.');
  return 0;
}

function updateBaseline() {
  if (!fs.existsSync(ASSETS)) {
    console.error('✖ No dist/ — run `npm run build` first.');
    return 2;
  }
  const m = measure();
  if (!m) {
    console.error('✖ No entry chunk matching `assets/index-*.js` — CANNOT JUDGE.');
    return 2;
  }
  const previous = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : null;
  const next = {
    note:
      'Bundle ratchet for scripts/check-bundle-budget.mjs (#987). These are MEASURED values, not targets. ' +
      'Size may go DOWN freely; going UP requires a deliberate re-freeze, so the diff is reviewable. ' +
      'An honest absolute target needs #1280 (153 statically imported pages) to land first.',
    generatedAt: new Date().toISOString().slice(0, 10),
    entryJsBytes: m.entryJs.size,
    entryCssBytes: m.entryCss ? m.entryCss.size : 0,
    totalDistBytes: m.totalDist,
    precacheBytes: m.precache.size,
  };
  fs.writeFileSync(BASELINE, `${JSON.stringify(next, null, 2)}\n`);

  // A raise is the interesting direction and must be visible, because re-freezing is the only way
  // the ratchet can be walked upwards.
  console.log(`📌 Baseline written — ${path.relative(ROOT, BASELINE)}`);
  for (const [label, key] of [
    ['entry JS', 'entryJsBytes'],
    ['entry CSS', 'entryCssBytes'],
    ['total dist', 'totalDistBytes'],
    ['precache', 'precacheBytes'],
  ]) {
    console.log(`  ${label.padEnd(11)} ${previous ? previous[key] : '—'} → ${next[key]}`);
  }
  return 0;
}

function selfTest() {
  const cases = [];
  const t = (name, actual, expected) => cases.push({ name, actual, expected });

  // parsePwaCap — the sourced number, and the ways it can be unreadable
  t('cap: `5 * 1024 * 1024`', parsePwaCap('maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,'), 5242880);
  t('cap: plain literal', parsePwaCap('maximumFileSizeToCacheInBytes: 3145728,'), 3145728);
  t('cap: underscores', parsePwaCap('maximumFileSizeToCacheInBytes: 5_242_880,'), 5242880);
  t('cap: ABSENT → null (caller must exit 2)', parsePwaCap('workbox: { globPatterns: [] }'), null);
  t('cap: non-numeric → null', parsePwaCap('maximumFileSizeToCacheInBytes: undefined,'), null);

  // cliffVerdict — the boundary is the whole point, so both sides are asserted
  t('cliff: well under cap', cliffVerdict(1000, 5000), 'ok');
  t('cliff: exactly at cap PASSES but warns (workbox skips only LARGER)', cliffVerdict(5000, 5000), 'warn');
  t('cliff: one byte over FAILS', cliffVerdict(5001, 5000), 'fail');
  t('cliff: exactly 90% warns', cliffVerdict(900, 1000), 'warn');
  t('cliff: just under 90% is ok', cliffVerdict(899, 1000), 'ok');

  // ratchetVerdict — all three directions
  t('ratchet: grew', ratchetVerdict(101, 100), 'grew');
  t('ratchet: same', ratchetVerdict(100, 100), 'same');
  t('ratchet: shrank', ratchetVerdict(99, 100), 'shrank');

  let failed = 0;
  for (const c of cases) {
    if (Object.is(c.actual, c.expected)) {
      console.log(`  ✅ ${c.name}`);
    } else {
      failed++;
      console.log(`  ✖ ${c.name}`);
      console.log(`      expected ${JSON.stringify(c.expected)}, got ${JSON.stringify(c.actual)}`);
    }
  }

  // The cap the REAL config declares must parse — otherwise the live check exits 2 and guards nothing.
  const liveCap = parsePwaCap(fs.readFileSync(CONFIG, 'utf8'));
  if (liveCap === null) {
    failed++;
    console.log('  ✖ the real vite.config.js cap is unreadable — the live check would exit 2');
  } else {
    console.log(`  ✅ real vite.config.js cap parses: ${liveCap.toLocaleString()} B`);
  }

  console.log(`\n${cases.length + 1 - failed}/${cases.length + 1} self-test cases behaved correctly`);
  return failed === 0 ? 0 : 1;
}

const arg = process.argv[2];
if (arg === '--self-test') {
  console.log('check-bundle-budget — self-test\n');
  process.exit(selfTest());
} else if (arg === '--update-baseline') {
  process.exit(updateBaseline());
} else if (arg === '--help' || arg === '-h') {
  console.log('usage: node scripts/check-bundle-budget.mjs [--update-baseline] [--self-test] [--help]');
  process.exit(0);
} else if (arg) {
  // An unrecognised flag must never fall through to the check — that is how `tools-index.cjs --help`
  // silently rewrote two tracked files.
  console.error(`✖ Unknown argument: ${arg}`);
  console.error('usage: node scripts/check-bundle-budget.mjs [--update-baseline] [--self-test] [--help]');
  process.exit(2);
} else {
  process.exit(check());
}
