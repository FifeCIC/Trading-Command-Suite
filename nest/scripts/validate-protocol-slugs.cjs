#!/usr/bin/env node
/**
 * validate-protocol-slugs.cjs — a protocol SEED KEY must be a slug, never a UUID.
 *
 * #939. `PROTOCOL_SEED_DATA` contains a key whose value is a raw UUID:
 *
 *     "060ed261-4a8c-46a4-aa9c-9de0ba7ddb8d": { "name": "Conviction Dip Accumulation", ... }
 *
 * The seeder upserts by that key — `protocol.upsert({ where: { slug } })` — so the UUID becomes the
 * row's `slug`. That is the `slug-or-UUID` ambiguity (#800) sitting in the durable artefact: every
 * slug lookup against it matches nothing, or matches a value no human can read, and a UUID-vs-slug
 * join returns **no rows and no error**.
 *
 * ── WHY THIS IS A RATCHET, NOT A CLEAN SWEEP ──────────────────────────────────────────────
 *
 * The one known offender is a **SETTLED decision** (`docs/SETTLED-DECISIONS.md`): *"RESOLVED
 * 2026-09-11 — abandoned placeholder … 0 groups in BOTH the seed and the DB, and nothing references
 * it. Seed and DB agree, so there is no drift. Left in place deliberately — deleting a `protocol`
 * row is a data decision, and it is harmless (active: 0)."*
 *
 * So this guard does NOT fail on it. Rewriting a settled decision to satisfy a new guard is the
 * exact trade this repo has already paid for. Instead the entry is **baselined with a reason**, and
 * two things are enforced:
 *
 *   1. A **new** non-slug key fails the build.
 *   2. A baselined entry that no longer exists in the seed **also fails**, so the allowance cannot
 *      rot into a permission nobody remembers granting.
 *
 * That is the same shape as `validate-css-tokens.cjs` (*"0 pre-existing finding(s) baselined"*) and
 * `validate-duplication.cjs` (*"allowance: 1672 across 152, none new and none grown"*). Narrow beats
 * broad: a guard that over-fires gets allowlisted, and an allowlisted guard is worse than none.
 *
 * ── USAGE ──────────────────────────────────────────────────────────────────────────────────
 *
 *   node nest/scripts/validate-protocol-slugs.cjs              # scan, exit 1 on a finding
 *   node nest/scripts/validate-protocol-slugs.cjs --self-test  # canary BOTH directions + the read
 *
 * Wired into `prebuild`.
 */

const fs = require('fs');
const path = require('path');

const NEST_ROOT = path.resolve(__dirname, '..');
const SEED_FILE = path.join(NEST_ROOT, 'src', 'modules', 'scoring', 'protocols-seed-data.ts');

/**
 * The slug shape a seed key must have: lower-case alphanumerics in hyphen-separated words.
 * Deliberately strict — it is a SLUG, and this repo has already had a value that looked like an
 * identifier and answered a different question (#801).
 */
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * ⚠️ A UUID MUST BE TESTED FIRST — and this is not a style preference.
 *
 * The first version of this guard tested only `SLUG_RE`, and the `--self-test` caught it: a UUID is
 * lower-case hex digits and hyphens, so `11111111-2222-3333-4444-555555555555` **passes**
 * `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`. The guard therefore could not fire on the single case it exists
 * to catch — it reported "48 keys, all slugs" while a UUID sat in the file.
 *
 * A guard that has never been observed to fail is a decoration. This one was observed to fail
 * during its own self-test, which is the only reason the defect was found before it shipped.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Keyed by the EXACT seed key. One entry, with the reason and the decision it records. */
const BASELINE = {
  '060ed261-4a8c-46a4-aa9c-9de0ba7ddb8d':
    'SETTLED 2026-09-11 (docs/SETTLED-DECISIONS.md) — an abandoned placeholder protocol, ' +
    'active: 0 with 0 groups in both the seed and the DB, referenced by nothing. Left in place ' +
    'deliberately: deleting a protocol row is a data decision, not a lint fix. Adding a key like ' +
    'this is still a failure — see the guard header.',
};

/**
 * classifySeedKeys() — PURE. No filesystem, so `--self-test` can canary it in BOTH directions.
 *
 * `keys` is the list of top-level seed keys. Returns:
 *   { offenders: [{key, reason}], staleBaseline: [key], checked: number }
 *
 * `staleBaseline` is the anti-rot half: a baselined key that is no longer in the seed means the
 * allowance outlived the thing it excused.
 */
function classifySeedKeys(keys) {
  const offenders = [];
  for (const key of keys) {
    // UUID FIRST, then slug. Order matters — see UUID_RE above.
    const isUuid = UUID_RE.test(key);
    const isSlug = !isUuid && SLUG_RE.test(key);
    if (isSlug) continue;
    if (Object.prototype.hasOwnProperty.call(BASELINE, key)) continue;
    offenders.push({
      key,
      reason: isUuid
        ? 'a raw UUID used as a protocol slug — the seeder upserts by this key, so it becomes the row slug'
        : 'not a slug (expected lower-case words separated by single hyphens)',
    });
  }
  const present = new Set(keys);
  const staleBaseline = Object.keys(BASELINE).filter((k) => !present.has(k));
  return { offenders, staleBaseline, checked: keys.length };
}

/**
 * Extract the top-level keys of the seed object literal.
 *
 * ⚠️ Read as TEXT, not `require`d — it is a `.ts` module, and translating it at build time would
 * make this guard's result depend on a compilation step that can itself be stale (the fault #881
 * was about). The keys of this file are written one per line at two-space indent; the self-test
 * pins that shape so a reformat fails loudly instead of extracting nothing and reporting OK.
 */
function readSeedKeys(file = SEED_FILE) {
  const text = fs.readFileSync(file, 'utf8');
  const keys = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^ {2}"([^"]+)":\s*\{/);
    if (m) keys.push(m[1]);
  }
  return keys;
}

// ── Self-test ───────────────────────────────────────────────────────────────────────────────

function selfTest() {
  let failed = 0;
  const check = (name, got, expect) => {
    const ok = JSON.stringify(got) === JSON.stringify(expect);
    if (!ok) failed++;
    console.log(
      `[self-test] ${ok ? 'PASS' : 'FAIL'}  ${name}` +
        (ok ? '' : ` (expected ${JSON.stringify(expect)}; got ${JSON.stringify(got)})`),
    );
  };

  // ── Direction 1: it must FIRE on a new non-slug key ──
  check(
    'a NEW UUID key is an offender',
    classifySeedKeys(['good-slug', '11111111-2222-3333-4444-555555555555']).offenders.map((o) => o.key),
    ['11111111-2222-3333-4444-555555555555'],
  );
  check(
    'a UUID key says WHAT is wrong',
    classifySeedKeys(['11111111-2222-3333-4444-555555555555']).offenders[0]?.reason?.includes('UUID used as a protocol slug') ?? false,
    true,
  );
  check('an UNDERSCORE key is an offender', classifySeedKeys(['adx_scalp_v1']).offenders.length, 1);
  check('an UPPERCASE key is an offender', classifySeedKeys(['GoldScalp']).offenders.length, 1);
  check('a key with a SPACE is an offender', classifySeedKeys(['gold scalp']).offenders.length, 1);

  // ── Direction 2: it must NOT fire on the correct forms, or on the settled one ──
  check('a plain slug passes', classifySeedKeys(['gold-scalp-v1']).offenders.length, 0);
  check('a slug with digits passes', classifySeedKeys(['hourly-3dir-v1']).offenders.length, 0);
  check('an EMPTY key list is not an error', classifySeedKeys([]).offenders.length, 0);
  check(
    'the BASELINED UUID passes (it is a settled decision, not a lint fix)',
    classifySeedKeys(['060ed261-4a8c-46a4-aa9c-9de0ba7ddb8d']).offenders.length,
    0,
  );

  // ── Direction 3: the anti-rot half ──
  check(
    'a baselined key that is GONE is reported (the allowance cannot rot)',
    classifySeedKeys(['gold-scalp-v1']).staleBaseline,
    ['060ed261-4a8c-46a4-aa9c-9de0ba7ddb8d'],
  );
  check(
    'a baselined key that is PRESENT is not stale',
    classifySeedKeys(['060ed261-4a8c-46a4-aa9c-9de0ba7ddb8d', 'gold-scalp-v1']).staleBaseline,
    [],
  );

  // ── Direction 4: the READER — proves the shape assumption against the real seed ──
  // Without this, a reformat could make `readSeedKeys` return [] and the guard would report OK on
  // a file it never parsed. That is the failure mode this repo keeps re-finding.
  const keys = readSeedKeys();
  const readOk = keys.length > 10 && keys.includes('signals-workbench');
  if (!readOk) failed++;
  console.log(
    `[self-test] ${readOk ? 'PASS' : 'FAIL'}  readSeedKeys parses the real seed` +
      (readOk ? ` (${keys.length} keys)` : ` (got ${keys.length} keys; the two-space-indent shape may have changed)`),
  );

  console.log(`[self-test] protocol-slug guard: ${failed === 0 ? 'all canaries passed' : `${failed} FAILED`}.`);
  process.exit(failed === 0 ? 0 : 1);
}

// ── Main ────────────────────────────────────────────────────────────────────────────────────

if (process.argv.includes('--self-test')) selfTest();

let keys;
try {
  keys = readSeedKeys();
} catch (err) {
  // ⚠️ A guard that cannot read its input must ERROR, never pass.
  console.error(`[protocol-slugs] FATAL — cannot read ${SEED_FILE}: ${err.message}`);
  process.exit(2);
}

const { offenders, staleBaseline, checked } = classifySeedKeys(keys);

if (offenders.length === 0 && staleBaseline.length === 0) {
  console.log(
    `[protocol-slugs] ✅ OK — ${checked} seed key(s), all slugs (${Object.keys(BASELINE).length} documented baseline).`,
  );
  process.exit(0);
}

if (staleBaseline.length) {
  console.error(`\n[protocol-slugs] ❌ ${staleBaseline.length} BASELINE ENTRY NO LONGER IN THE SEED:\n`);
  for (const k of staleBaseline) console.error(`  ${k}`);
  console.error(
    '\n  The allowance outlived what it excused, so it is now a permission nobody remembers\n' +
      '  granting. Remove the BASELINE entry in this script — do not leave it.',
  );
}

if (offenders.length) {
  console.error(`\n[protocol-slugs] ❌ ${offenders.length} non-slug seed key(s) in ${checked}:\n`);
  for (const o of offenders) console.error(`  "${o.key}"  —  ${o.reason}`);
  console.error(
    '\n  The seeder upserts by this key (`protocol.upsert({ where: { slug } })`), so the key IS the\n' +
      "  row's slug. A UUID there is the slug-or-UUID ambiguity (#800/#801): a slug lookup matches\n" +
      '  nothing, a join returns no rows AND no error.\n\n' +
      '  FIX: rename the key to a slug. If the row already exists in a database, say so on the\n' +
      '  issue — changing the key makes the seeder create a SECOND row rather than rename the first,\n' +
      '  which is a data decision, not a lint fix.',
  );
}

process.exit(1);
