#!/usr/bin/env node
/**
 * licence-readiness.cjs — is this licence text fit to ship?
 *
 *   const { checkLicence } = require('./lib/licence-readiness.cjs');
 *   const r = checkLicence(text);   // { ok, isDraft, placeholders }
 *
 *   node scripts/lib/licence-readiness.cjs --self-test   # canary both directions
 *
 * WHY A SEPARATE MODULE
 * ---------------------
 * The publisher refuses to package a release while the licence is unfinished. That refusal is a
 * GUARD, and a guard that has never been observed to fail is a decoration. Keeping the decision
 * pure — text in, verdict out, no file system — is what makes it canary-able without building a
 * release, and lets the self-test prove both the pass and the fail direction.
 *
 * WHAT "UNFINISHED" MEANS, and why both signals matter
 * ----------------------------------------------------
 *  1. A bracketed placeholder, e.g. [JURISDICTION]. Matched by SHAPE, not by a list of known
 *     names: a placeholder added to the licence later must be caught without anyone remembering
 *     to add it here. A guard that only knows today's placeholders is a guard that expires.
 *  2. A DRAFT banner near the top. A licence can be free of brackets and still be a draft — and
 *     shipping a draft is the failure this exists to prevent, because it appears to grant terms
 *     nobody approved.
 *
 * ⚠️ A half-filled licence is worse than no licence: the absent one is obviously absent, the
 * half-filled one looks like a contract.
 */

/** Bracketed, human-fill-me tokens: `[DATE]`, `[LEGAL ENTITY NAME]`, `[LIABILITY CAP]`. */
const PLACEHOLDER_RE = /\[[^\]\n]{2,60}\]/g;

/** How many lines from the top to search for the draft banner — a banner further down is body text. */
const DRAFT_BANNER_LINES = 8;

/**
 * @param {string} text licence text
 * @returns {{ ok: boolean, isDraft: boolean, placeholders: string[], reason: string|null }}
 */
function checkLicence(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    // Cannot judge is NOT the same as fine. An empty read must never pass.
    return { ok: false, isDraft: false, placeholders: [], reason: 'the licence text is empty' };
  }
  const head = text.split('\n', DRAFT_BANNER_LINES).join('\n');
  const isDraft = /DRAFT/.test(head);
  const placeholders = [...new Set(text.match(PLACEHOLDER_RE) || [])];

  if (!isDraft && !placeholders.length) {
    return { ok: true, isDraft, placeholders, reason: null };
  }
  const parts = [];
  if (isDraft) parts.push('it is still marked as a DRAFT');
  if (placeholders.length) {
    parts.push(`${placeholders.length} unfilled placeholder(s): ${placeholders.join(', ')}`);
  }
  return { ok: false, isDraft, placeholders, reason: parts.join(' and ') };
}

// ── self-test / canary ──────────────────────────────────────────────────────────────────────
function selfTest() {
  let pass = 0;
  let fail = 0;
  const check = (name, actual, expected) => {
    if (actual === expected) {
      pass += 1;
      console.log(`  ok    ${name}`);
    } else {
      fail += 1;
      console.error(`  FAIL  ${name} — expected ${expected}, got ${actual}`);
    }
  };

  const filled = [
    'END USER LICENCE AGREEMENT',
    '',
    'Version 1.0 · Effective 2026-10-01',
    '',
    'This Agreement is between Example Ltd, of 1 Street, United Kingdom ("Licensor") ...',
    '1. DEFINITIONS',
    '1.1 "Software" means ...',
  ].join('\n');

  // ── PASS direction ─────────────────────────────────────────────────────────────────────
  check('filled licence passes', checkLicence(filled).ok, true);
  check('filled licence has no placeholders', checkLicence(filled).placeholders.length, 0);
  // A bracket in body prose must NOT be treated as a placeholder if it is not the fill-me shape.
  check('short bracket is not a placeholder', checkLicence(`${filled}\nSee [1] below.`).placeholders.length, 0);

  // ── FAIL direction: the real file, measured ─────────────────────────────────────────────
  const real = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', '..', 'LICENSE.txt'),
    'utf8',
  );
  const realResult = checkLicence(real);
  check('the shipped LICENSE.txt is REFUSED while unfinished', realResult.ok, false);
  check('and it names the draft banner', realResult.isDraft, true);
  console.log(`        reported: ${realResult.reason}`);

  // ── FAIL direction: each signal on its own ──────────────────────────────────────────────
  check('placeholder alone is refused', checkLicence(`Licence\n\nGoverned by [JURISDICTION].`).ok, false);
  check('draft banner alone is refused', checkLicence(`Licence\n\nDRAFT — do not ship\n\nAll done.`).ok, false);
  check('empty text is refused, not passed', checkLicence('').ok, false);
  check('whitespace text is refused, not passed', checkLicence('   \n  ').ok, false);
  check('a DRAFT word far down the body is not a banner', checkLicence(`Licence\n${'\n'.repeat(12)}This is a draft clause.`).ok, true);
  check(
    'a lower-cased bracket list is still caught by shape',
    checkLicence(`Licence\n\nBuyer: [your name here]`).placeholders.length,
    1,
  );

  console.log(`\n${fail === 0 ? 'OK' : 'FAILED'}: ${pass} passed, ${fail} failed.`);
  process.exit(fail === 0 ? 0 : 1);
}

if (require.main === module) {
  if (process.argv.includes('--self-test')) selfTest();
  else {
    console.error('usage: node scripts/lib/licence-readiness.cjs --self-test');
    process.exit(2);
  }
}

module.exports = { checkLicence, PLACEHOLDER_RE };
