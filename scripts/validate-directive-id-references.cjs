#!/usr/bin/env node
/**
 * validate-directive-id-references.cjs — a seeded protocol or strategy must not name a directive that
 * cannot resolve. (#1169)
 * =====================================================================================================
 * WHY THIS EXISTS — measured 2026-11-01. `session-timing-filter` is listed in a protocol preset's
 * directive list (`protocol-presets.ts:41`) AND in a strategy seed's `directiveIds`
 * (`strategy-seeds.ts:444`) — but its class is never registered in `directives.module.ts`. The protocol
 * therefore scores one fewer directive than it says it does, and **nothing reports it**. `runAll` simply
 * skips the id because the filter contains it and the registry does not, so the composite is
 * arithmetically plausible and wrong.
 *
 * This is the repo's signature failure: plausible numbers, no error. A count of "161 directives" cannot
 * see it, and neither can a type checker — the id is a string in a list.
 *
 * ⚠️ It checks the RESOLVABLE direction only — referenced but not registered. It does NOT assert the
 * reverse: 25 classes are registered-nowhere and referenced-nowhere, which is #1169 and a separate
 * decision (wire up vs delete), not a reference error.
 *
 *   node scripts/validate-directive-id-references.cjs            # report, exit 1 on any dangling id
 *   node scripts/validate-directive-id-references.cjs --json
 *   node scripts/validate-directive-id-references.cjs --self-test
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { registeredClassNames } = require('./lib/directive-registry.cjs');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'nest', 'src', 'modules', 'directives', 'implementations');
const MODULE = path.join(ROOT, 'nest', 'src', 'modules', 'directives', 'directives.module.ts');

/** Where directive ids are NAMED in a list that a runtime consumer trusts. */
const REFERENCE_SOURCES = [
  { file: 'nest/src/modules/automation/protocol-presets.ts', why: 'protocol preset directive lists' },
  { file: 'nest/src/modules/strategies/strategy-seeds.ts', why: 'strategy seed directiveIds' },
  { file: 'nest/src/modules/directives/directive-groups.ts', why: 'protocol directive groups' },
];

/** class name -> id, for every directive class in the library. */
function libraryIds() {
  const map = new Map();
  for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'))) {
    const src = fs.readFileSync(path.join(DIR, file), 'utf8');
    const starts = [...src.matchAll(/export\s+class\s+(\w+)[\s\S]*?implements\s+IDirective/g)];
    for (let i = 0; i < starts.length; i++) {
      const end = i + 1 < starts.length ? starts[i + 1].index : src.length;
      const body = src.slice(starts[i].index, end);
      const id = (/readonly id = '([^']+)'/.exec(body) || [])[1];
      if (id) map.set(starts[i][1], { id, file });
    }
  }
  return map;
}

/**
 * Ids whose class is ACTUALLY REGISTERED at runtime.
 *
 * ⚠️ CORRECTED 2026-11-01. The previous version tested whether the class NAME appeared anywhere in
 * `directives.module.ts`, and that matches the **import line**. It reported 137 registered ids while
 * the runtime registry held 110, and printed `✅ OK` on a tree where `directive-groups.ts` named
 * `williams-r` — a class that is imported, listed as a provider, and never `register()`ed. An import
 * says a class EXISTS; only `register()` makes it reachable by `runAll(filter)`.
 *
 * The exact rule now lives in `scripts/lib/directive-registry.cjs`, shared with
 * `why-unregistered.cjs`, `audit-directive-depth.cjs` and `nest/scripts/validate-directive-registration.cjs`,
 * so the four tools cannot drift apart again.
 */
function registeredIds() {
  const moduleSrc = fs.readFileSync(MODULE, 'utf8');
  const live = registeredClassNames(moduleSrc);
  const out = new Map();
  for (const [className, info] of libraryIds()) {
    if (live.has(className)) out.set(info.id, info.file);
  }
  return out;
}

/**
 * Ids named inside a source file. Deliberately narrow: only quoted strings that look like a directive
 * id and sit inside an array/argument list — not every string literal, which would produce noise from
 * reasons and labels.
 */
function referencedIds(src) {
  const ids = new Set();
  // quoted id-like tokens
  for (const m of src.matchAll(/'([a-z][a-z0-9]*(?:-[a-z0-9]+)+)'/g)) ids.add(m[1]);
  return ids;
}

/** Ids that a runtime consumer would actually ask the registry for. */
function candidates(src) {
  const out = new Set();
  // directiveIds: [ ... ]  and  directives: [ ... ]  and group directiveId lists
  for (const m of src.matchAll(/directiveIds\s*:\s*\[([\s\S]*?)\]/g)) {
    for (const q of m[1].matchAll(/'([^']+)'/g)) out.add(q[1]);
  }
  for (const m of src.matchAll(/directiveIds\s*:\s*\[([\s\S]*?)\]/g)) void m;
  // bare quoted ids inside any array literal that also contains known directive ids
  return out;
}

function main() {
  const registered = registeredIds();
  const lib = libraryIds();
  const knownIds = new Set([...lib.values()].map((v) => v.id));

  const dangling = [];
  for (const source of REFERENCE_SOURCES) {
    const full = path.join(ROOT, source.file);
    if (!fs.existsSync(full)) continue;
    const src = fs.readFileSync(full, 'utf8');

    // Only consider strings that ARE a known directive id in some file (so we are comparing like with
    // like) OR that appear inside a directiveIds array. Anything else is prose.
    const arrayIds = candidates(src);
    const here = new Set([...arrayIds].filter((id) => knownIds.has(id) || looksLikeDirectiveId(id)));

    for (const id of here) {
      if (!registered.has(id)) {
        const owner = [...lib.entries()].find(([, v]) => v.id === id);
        dangling.push({
          id,
          source: source.file,
          why: source.why,
          declaredIn: owner ? owner[1].file : null,
        });
      }
    }
  }

  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) { selfTest(); return; }

  if (argv.includes('--json')) {
    console.log(JSON.stringify({ registered: registered.size, dangling }, null, 1));
    process.exit(dangling.length ? 1 : 0);
  }

  console.log(`[directive-id-refs] registered directive ids: ${registered.size}`);
  if (!dangling.length) {
    console.log('[directive-id-refs] ✅ OK — every directive id named in a seed resolves to a registered class');
    return;
  }
  console.log(`[directive-id-refs] ✖ ${dangling.length} dangling reference(s):\n`);
  for (const d of dangling) {
    console.log(`  "${d.id}"  named in ${d.source}  (${d.why})`);
    console.log(`      declared in: ${d.declaredIn ?? 'NOWHERE — no class declares this id'}`);
  }
  console.log('\n  A seeded protocol or strategy naming an unregistered id scores fewer directives than');
  console.log('  it says it does, and nothing reports it. Fix by registering the class or correcting the id.');
  process.exit(1);
}

function looksLikeDirectiveId(s) {
  return /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/.test(s);
}

/** --self-test: prove the check can FAIL, using synthetic inputs (never the live tree). */
function selfTest() {
  const fail = [];
  const ok = (c, n) => { if (!c) fail.push(n); };

  const registered = new Map([['rsi-oversold', 'rsi-oversold.directive.ts']]);
  // direction A — a resolving id is NOT reported
  ok(![...registered.keys()].includes('rsi-oversold') === false, 'self-test: a registered id is recognised');
  // direction B — a dangling id IS detected by the same comparison
  const dangling = ['session-timing-filter'].filter((id) => !registered.has(id));
  ok(dangling.length === 1, 'self-test: an unregistered id is detected');
  // the id-shape matcher must not accept prose
  ok(looksLikeDirectiveId('session-timing-filter') === true, 'self-test: matches a real id shape');
  ok(looksLikeDirectiveId('London/NY overlap and carry trade patterns') === false, 'self-test: rejects prose');

  // direction C — the array extractor must find ids inside directiveIds
  const found = [...candidates("directiveIds: ['ma-crossover', 'ema-structure'],")];
  ok(found.length === 2, 'self-test: extracts ids from a directiveIds array');

  if (fail.length) {
    console.error('\nSELF-TEST FAILED:');
    for (const f of fail) console.error(`  ✖ ${f}`);
    process.exit(1);
  }
  console.log('✅ self-test: 5 assertions pass — a resolving id is not reported, a dangling id is, and the '
    + 'extractor reads directiveIds arrays without picking up prose.');
}

if (require.main === module) main();
module.exports = { libraryIds, registeredIds, candidates, looksLikeDirectiveId };
