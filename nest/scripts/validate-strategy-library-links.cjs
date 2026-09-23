#!/usr/bin/env node
/**
 * validate-strategy-library-links.cjs — INV-STRATEGY-LIBRARY-LINK-RESOLVES (build-time)
 * ====================================================================================
 * Wired into `prebuild`, in the same zero-tolerance spirit as its sibling validators.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE DEFECT THIS PREVENTS (measured live, 2026-09-23)
 * ─────────────────────────────────────────────────────────────────────────
 * `src/data/strategy-library.js` links a strategy theory to the protocol that is supposed to
 * run it, through one field:
 *
 *     { id: 'gold-macro-regime', status: 'supported', tcsProtocol: 'xau-macro-v1' }
 *
 * **`xau-macro-v1` does not exist.** Not in the `protocol` table (47 rows), and not in
 * `protocols-seed-data.ts` (47 slugs) either. So the link pointed at nothing, on an entry whose
 * `status` said "Fully Supported".
 *
 * Nothing caught it, and the reason is worth stating plainly: `tcsProtocol` was read in exactly
 * ONE place (`MetaStackStatusPage.jsx`) and only as a **display fallback string** —
 * `s.tcsProtocol || s.directiveMappings?.[0]?.directiveId || '—'`. It was never used as a join,
 * so nothing ever asked whether it resolved. A field that is only ever PRINTED cannot be wrong.
 *
 * ⚠️ It was found by building the strategy decision path — the first consumer to treat the field
 * as a reference. That is the general shape of this class: the defect appears the moment a field
 * acquires its first real reader. A guard here means the next stale link fails the build instead
 * of surfacing months later as a diagram that quietly shows nothing.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY STATIC, AND WHY AGAINST THE SEED
 * ─────────────────────────────────────────────────────────────────────────
 * The strategy library is source (`src/data/strategy-library.js`) and the protocol slugs are
 * source (`protocols-seed-data.ts`), so the whole invariant is readable at build time with no
 * database. Checking against the SEED rather than the live table is deliberate: the seed is the
 * durable artefact, so a link that only works because of a DB row cannot pass this check and then
 * vanish on a reinstall.
 *
 * ⚠️ `protocols-seed-data.ts` is NOT regenerable — `dump-protocol-seed.cjs` was deleted
 * (see #791), despite the header comment in that file still advertising it. So this validator
 * compares against a hand-maintained list, which is exactly why it is worth having: nobody is
 * going to notice a missing slug by reading it.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT IT CHECKS
 * ─────────────────────────────────────────────────────────────────────────
 *   A. DECLARED ⊆ SEEDED — every `tcsProtocol` resolves to a slug in the seed.  ← the finding
 *   B. SUPPORTED ⇒ LINKED — an entry claiming `supported` or `live` declares a `tcsProtocol`.
 *      "Supported" is a claim that something runs it; a claim with no protocol behind it is the
 *      honesty-scale failure the strategy sprint exists to remove.
 *   C. PARSE SANITY — a verifier that cannot read its input must ERROR, never pass. Floors on the
 *      number of entries and slugs parsed, so a reshaped file fails loudly rather than reporting
 *      OK over an empty list.
 *
 * ⚠️ This check is DELIBERATELY one-directional. It does not require every seeded protocol to be
 * referenced by a strategy — most are not, and demanding it would invent work. The link is only
 * wrong when it points at nothing.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const NEST_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(NEST_ROOT, '..');
const LIBRARY_FILE = path.join(REPO_ROOT, 'src', 'data', 'strategy-library.js');
const SEED_FILE = path.join(NEST_ROOT, 'src', 'modules', 'scoring', 'protocols-seed-data.ts');

/**
 * Floors for the parse. Measured 2026-09-23: 10 entries, 47 seed slugs, 5 `tcsProtocol` values.
 * If a file is reshaped so the regexes stop matching, the counts collapse — and a check that
 * silently witnesses an empty list would report OK while verifying nothing. Lower a floor only
 * with a fresh measurement, never to silence a red build.
 */
const MIN_ENTRIES = 8;
const MIN_SEED_SLUGS = 40;
const MIN_LINKS = 3;

const failures = [];
function fail(message, hint) {
  failures.push({ message, hint });
}

function die(message, hint) {
  console.error(`[strategy-library-links] \u2716 ${message}`);
  if (hint) console.error(`    \u2192 ${hint}`);
  process.exit(1);
}

/** Repo-relative path with forward slashes, for stable messages on any platform. */
function rel(p) {
  return path.relative(REPO_ROOT, p).split(path.sep).join('/');
}

// ── Inputs (a verifier that cannot read its input must ERROR, never pass) ──────
for (const f of [LIBRARY_FILE, SEED_FILE]) {
  if (!fs.existsSync(f)) {
    die(
      `${rel(f)} not found`,
      'the file was moved or renamed; repoint this validator rather than deleting the check',
    );
  }
}

/**
 * Scan a library + seed pair and return what was found. Throws `ParseError` when the inputs do
 * not look like the files this validator was written for.
 *
 * ⚠️ Split out from `main()` so `--self-test` can drive it with the REAL file contents, mutated in
 * memory. Testing against synthetic fixtures would prove the logic works but not that the regexes
 * match the file as it is actually written — and "the check silently matches nothing" is the
 * failure this whole validator is supposed to prevent.
 */
class ParseError extends Error {}

function scan(librarySrc, seedSrc) {
  // Entries are brace objects at one indent level; splitting on the opener keeps each entry's
  // fields together, so a `status` can never be attributed to the neighbouring strategy.
  const blocks = librarySrc.split(/^ {2}\{/m).slice(1);
  const entries = blocks
    .map((block) => {
      // Only the header region matters — the first ~40 lines carry id/status/tcsProtocol, and
      // `theory` is a template literal that can contain anything, so the scan is bounded.
      const head = block.split('\n').slice(0, 40).join('\n');
      const id = /\bid:\s*'([^']+)'/.exec(head)?.[1] ?? null;
      const status = /\bstatus:\s*'([^']+)'/.exec(head)?.[1] ?? null;
      const tcsProtocol = /\btcsProtocol:\s*'([^']+)'/.exec(head)?.[1] ?? null;
      return id ? { id, status, tcsProtocol } : null;
    })
    .filter(Boolean);

  if (entries.length < MIN_ENTRIES) {
    throw new ParseError(
      `parsed only ${entries.length} library entr(ies) (expected >= ${MIN_ENTRIES})`,
      'the array was reshaped; update this validator so the invariant stays checked',
    );
  }

  const links = entries.filter((e) => e.tcsProtocol);
  if (links.length < MIN_LINKS) {
    throw new ParseError(
      `parsed only ${links.length} tcsProtocol value(s) (expected >= ${MIN_LINKS})`,
      'either the field was renamed or every link was dropped — both need a human',
    );
  }

  // The seed is an object keyed by slug:  "xau-speed-v1": { ... }
  const seedSlugs = new Set(
    [...seedSrc.matchAll(/^\s*"([a-z0-9][a-z0-9-]*)":\s*\{/gm)].map((m) => m[1]),
  );
  if (seedSlugs.size < MIN_SEED_SLUGS) {
    throw new ParseError(
      `parsed only ${seedSlugs.size} protocol slug(s) (expected >= ${MIN_SEED_SLUGS})`,
      'the seed was reshaped; a list this short means the parse is wrong, not that the app has fewer protocols',
    );
  }

  const findings = [];

  // ── A. DECLARED ⊆ SEEDED ────────────────────────────────────────────────────
  for (const entry of links) {
    if (!seedSlugs.has(entry.tcsProtocol)) {
      findings.push({
        message: `${entry.id}: tcsProtocol '${entry.tcsProtocol}' is not a seeded protocol`,
        hint:
          'the link points at nothing — the protocol was renamed, never created, or removed. Point it ' +
          'at a real slug, or drop the field so the entry honestly reads as unwired.',
      });
    }
  }

  // ── B. SUPPORTED ⇒ LINKED ───────────────────────────────────────────────────
  for (const entry of entries) {
    const claimsToRun = entry.status === 'supported' || entry.status === 'live';
    if (claimsToRun && !entry.tcsProtocol) {
      findings.push({
        message: `${entry.id}: status '${entry.status}' but no tcsProtocol`,
        hint:
          `"${entry.status}" is a claim that something runs this strategy. Add the protocol that runs ` +
          'it, or demote the status to partial.',
      });
    }
  }

  return { entries, links, seedSlugs, findings };
}

// ── Self-test — canary the guard in BOTH directions ───────────────────────────
/**
 * Drives `scan()` with the real files, mutated in memory. Nothing is written to disk.
 *
 * Two directions, because a one-directional test cannot tell "the guard works" from "the guard
 * never runs":
 *   1. BREAK a link  → must report it
 *   2. FIX   the link → must stay quiet
 *
 * Plus a third: prove the mutation actually landed. A canary that pattern-matches and hits nothing
 * reports a working guard as broken, and the obvious "repair" is then to fix a guard that was
 * correct — so a mutation that did not apply is reported as CANARY INVALID, never as a result.
 */
function selfTest() {
  const librarySrc = fs.readFileSync(LIBRARY_FILE, 'utf8');
  const seedSrc = fs.readFileSync(SEED_FILE, 'utf8');

  const steps = [];
  let ok = true;

  /** Run `scan` on a variant and assert how many findings it produced. */
  const run = (label, lSrc, sSrc, expectCount) => {
    let result;
    try {
      result = scan(lSrc, sSrc);
    } catch (err) {
      ok = false;
      steps.push(`  \u2716 ${label}: parse error — ${err.message}`);
      return;
    }
    const pass = result.findings.length === expectCount;
    if (!pass) ok = false;
    steps.push(
      `  ${pass ? '\u2713' : '\u2716'} ${label}: ${result.findings.length} finding(s), expected ${expectCount}` +
        (pass ? '' : ` — ${result.findings.map((f) => f.message).join('; ') || '(none)'}`),
    );
  };

  /** Assert a variant REFUSES to scan (the unreadable-input rule). */
  const runMustThrow = (label, lSrc, sSrc) => {
    try {
      scan(lSrc, sSrc);
      ok = false;
      steps.push(`  \u2716 ${label}: did NOT error — a check that inspects nothing reported OK`);
    } catch {
      steps.push(`  \u2713 ${label}: errors instead of passing`);
    }
  };

  // (0) The file as it stands — the reference point every expectation below is derived from.
  let baseline;
  try {
    baseline = scan(librarySrc, seedSrc);
  } catch (err) {
    console.error(`  \u2716 baseline parse error — ${err.message}`);
    process.exitCode = 1;
    console.log(`[strategy-library-links] SELF-TEST FAILED\n${steps.join('\n')}`);
    return;
  }
  steps.push(
    `  \u2713 baseline: parsed ${baseline.entries.length} entries, ${baseline.seedSlugs.size} slugs, ` +
      `${baseline.findings.length} finding(s)`,
  );

  // (1) BREAK — point a resolvable link at a slug that does not exist.
  const goodLink = baseline.links.find((e) => baseline.seedSlugs.has(e.tcsProtocol));
  if (!goodLink) {
    // CANARY INVALID — refuse to report, rather than reporting a pass it did not earn.
    ok = false;
    steps.push('  \u2716 CANARY INVALID: no resolvable link in the file to break, so direction 1 was never exercised');
  } else {
    const broken = librarySrc.replace(
      `tcsProtocol: '${goodLink.tcsProtocol}'`,
      `tcsProtocol: 'definitely-not-a-protocol'`,
    );
    if (broken === librarySrc) {
      ok = false;
      steps.push(`  \u2716 CANARY INVALID: 'tcsProtocol: '${goodLink.tcsProtocol}'' edit did not land`);
    } else if (!broken.includes('definitely-not-a-protocol')) {
      ok = false;
      steps.push('  \u2716 CANARY INVALID: replacement text absent after edit');
    } else {
      run(
        `BREAK ${goodLink.id} -> 'definitely-not-a-protocol' (expect +1)`,
        broken,
        seedSrc,
        baseline.findings.length + 1,
      );
    }
  }

  // (2) BREAK the other check — strip the link from a claimed-supported entry.
  const supportedLink = baseline.links.find(
    (e) => (e.status === 'supported' || e.status === 'live') && baseline.seedSlugs.has(e.tcsProtocol),
  );
  if (!supportedLink) {
    ok = false;
    steps.push('  \u2716 CANARY INVALID: no supported entry with a resolvable link, so direction 2 was never exercised');
  } else {
    const stripped = librarySrc.replace(
      `tcsProtocol: '${supportedLink.tcsProtocol}',`,
      '',
    );
    if (stripped === librarySrc) {
      ok = false;
      steps.push(`  \u2716 CANARY INVALID: stripping '${supportedLink.id}''s tcsProtocol did not land`);
    } else {
      run(
        `STRIP tcsProtocol from ${supportedLink.id} while '${supportedLink.status}' (expect +1)`,
        stripped,
        seedSrc,
        baseline.findings.length + 1,
      );
    }
  }

  // (3) UNREADABLE INPUT — an empty seed must ERROR, never pass over an empty list.
  runMustThrow('EMPTY seed (expect an error, not a pass)', librarySrc, 'export const x = {};');
  runMustThrow('EMPTY library (expect an error, not a pass)', 'export const strategies = [];', seedSrc);

  console.log(
    `[strategy-library-links] SELF-TEST ${ok ? '\u2713 PASS' : '\u2716 FAIL'}\n${steps.join('\n')}`,
  );
  process.exitCode = ok ? 0 : 1;
}

// ── Main ──────────────────────────────────────────────────────────────────────
function main() {
  const librarySrc = fs.readFileSync(LIBRARY_FILE, 'utf8');
  const seedSrc = fs.readFileSync(SEED_FILE, 'utf8');

  let result;
  try {
    result = scan(librarySrc, seedSrc);
  } catch (err) {
    die(
      err.message,
      err.hint ?? 'the file was reshaped; repoint this validator rather than deleting the check',
    );
  }

  for (const f of result.findings) fail(f.message, f.hint);

  if (failures.length > 0) {
    console.error(
      `[strategy-library-links] \u2716 ${failures.length} broken strategy-library link(s):\n`,
    );
    for (const f of failures) {
      console.error(`  \u2716 ${f.message}`);
      if (f.hint) console.error(`      \u2192 ${f.hint}`);
    }
    console.error(
      '\nFix the link. Do NOT delete this check — it exists because a field with no reader\n' +
        'cannot be wrong, and `tcsProtocol` now has one.\n',
    );
    process.exit(1);
  }

  const supported = result.entries.filter(
    (e) => e.status === 'supported' || e.status === 'live',
  ).length;
  console.log(
    `[strategy-library-links] \u2713 ${result.links.length} tcsProtocol link(s) resolve against ` +
      `${result.seedSlugs.size} seeded protocol(s); ${supported} claimed-supported entr(ies) are linked ` +
      `(${result.entries.length} entr(ies) scanned)`,
  );
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  main();
}
