#!/usr/bin/env node
/**
 * validate-guardian-directive-ids.cjs — INV-GUARDIAN-DIRECTIVE-RESOLVABLE (build-time)
 * ===================================================================================
 * Wired into `prebuild`, in the same zero-tolerance spirit as its sibling validators.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE DEFECT THIS PREVENTS (measured live, issue #890)
 * ─────────────────────────────────────────────────────────────────────────
 * `StopGuardianService` reads FOUR directive IDs by name:
 *
 *     const atrStop    = resultsMap.get('atr-trailing-stop');
 *     const superTrend = resultsMap.get('supertrend');
 *     const chandelier = resultsMap.get('chandelier-exit');
 *     const wickFilter = resultsMap.get('wick-filter');
 *
 * ...and combines them into the number that decides whether a LIVE STOP IS MOVED:
 *
 *     stopConfidence = alignedAvg - opposingAvg          // averaged over those four
 *     const shouldAdjust = stopConfidence >= 55 && ...   // ← a money path (L346)
 *
 * `Map.get()` returns `undefined` for a key that was never `set`. It does not throw.
 * A directive that is DECLARED but never REGISTERED therefore contributes nothing,
 * and the guardian reads that absence as "no evidence" — not as an error.
 *
 * MEASURED 2026-09-18: only `wick-filter` was registered. `SuperTrendDirective` and
 * `ATRTrailingStopDirective` were imported and listed in `providers` (constructed,
 * never referenced by anything); `ChandelierExitDirective` was not imported at all.
 * So a `>= 55` consensus threshold calibrated for FOUR signals was being applied to
 * ONE, and the guardian sat at `0 adjusted, 5 guarded` on every pass — nominally
 * guarding, practically inert.
 *
 * ⚠️ The symptom was invisible in three separate ways:
 *   1. `0 adjusted` reads as "nothing needed adjusting", not "the bar is 4x too high"
 *   2. the registry count was HEALTHY — 101 registered, 101 register() calls, matching
 *   3. the only arithmetic signature was `directivesEvaluated` = 5 per pass
 *      (1 resolvable ID x 5 positions) where 20 was expected
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY STATIC, AND WHY HERE
 * ─────────────────────────────────────────────────────────────────────────
 * The registry is assembled in CODE (`directives.module.ts`), not from the database,
 * so the whole invariant is readable from source. Checking it at build time means
 * contribution N+1 fails the build rather than quietly degrading the guardian at 03:00
 * on a live position.
 *
 * This is the CLASS fix for what was an INSTANCE: #789 was 14 placements of one idea,
 * #790 was 6 more of the same. One guard turns the next six into one.
 *
 * `StopGuardianService.tick()` additionally logs a runtime ERROR when a declared ID
 * resolves to nothing — a SYMPTOM guard, which fires without needing to know why.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT IT CHECKS
 * ─────────────────────────────────────────────────────────────────────────
 *   A. REQUIRED ⊆ REGISTERED — every ID in STOP_GUARDIAN_DIRECTIVES resolves to a
 *      class `directives.module.ts` actually calls `register()` on.   ← the #890 bug
 *   B. FETCHED ⊆ DECLARED    — every `resultsMap.get('x')` is listed in the Set.
 *      (The guardian's own comment warns about this; now it is enforced.)
 *   C. DECLARED ⊆ FETCHED    — no Set entry is dead weight.
 *   D. PARSE SANITY          — a verifier that cannot read its input must ERROR,
 *      never pass. A parser that finds nothing must not look like a success.
 *
 * ⚠️ Being listed in `providers` is NOT registration. Nest constructs a provider and
 * hands the instance to whoever injects it; `register()` is what puts it in the
 * registry `runAll(filter)` draws from. The two lists have drifted before, which is
 * exactly how #890 happened — the class was constructed on every boot and reachable
 * by nobody.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const NEST_ROOT = path.resolve(__dirname, '..');
const SRC = path.join(NEST_ROOT, 'src');
const IMPL_DIR = path.join(SRC, 'modules', 'directives', 'implementations');
const MODULE_FILE = path.join(SRC, 'modules', 'directives', 'directives.module.ts');
const GUARDIAN_FILE = path.join(SRC, 'modules', 'automation', 'stop-guardian.service.ts');

/**
 * Floor for the number of `register(this.x)` calls we expect to find.
 *
 * Measured 101 on 2026-09-18. If a refactor moves registration behind a loop or into
 * another file, this validator can no longer see the registry — and a check that
 * silently witnesses an empty list would report OK while verifying nothing. The floor
 * makes that a hard failure instead. Lower it only with a measurement, never to
 * silence a red build.
 */
const MIN_REGISTERED_PROPS = 90;

const failures = [];
function fail(message, hint) {
  failures.push({ message, hint });
}

function die(message, hint) {
  console.error(`[guardian-directive-ids] \u2716 ${message}`);
  if (hint) console.error(`    \u2192 ${hint}`);
  process.exit(1);
}

// ── Inputs (a verifier that cannot read its input must ERROR, never pass) ──────
for (const f of [GUARDIAN_FILE, MODULE_FILE]) {
  if (!fs.existsSync(f)) {
    die(
      `${path.relative(NEST_ROOT, f).split(path.sep).join('/')} not found`,
      'the file was moved or renamed; repoint this validator rather than deleting the check',
    );
  }
}
const guardianSrc = fs.readFileSync(GUARDIAN_FILE, 'utf8');
const moduleSrc = fs.readFileSync(MODULE_FILE, 'utf8');

// ── Parse: the IDs the guardian DECLARES ──────────────────────────────────────
const setMatch = /STOP_GUARDIAN_DIRECTIVES\s*=\s*new Set\(\s*\[([\s\S]*?)\]\s*\)/.exec(guardianSrc);
if (!setMatch) {
  die(
    'could not parse STOP_GUARDIAN_DIRECTIVES from stop-guardian.service.ts',
    'the declaration was renamed or reshaped; update this validator so the invariant stays checked',
  );
}
const required = [...setMatch[1].matchAll(/'([^']+)'|"([^"]+)"/g)].map((m) => m[1] ?? m[2]);
if (required.length === 0) {
  die(
    'STOP_GUARDIAN_DIRECTIVES parsed to an empty set',
    'the guardian reads four directives; an empty set means the parse is wrong, not that the guardian needs nothing',
  );
}

// ── Parse: the IDs the guardian FETCHES ───────────────────────────────────────
const fetched = [...guardianSrc.matchAll(/resultsMap\.get\(\s*'([^']+)'\s*\)/g)].map((m) => m[1]);
if (fetched.length === 0) {
  die(
    'found no `resultsMap.get(\'...\')` calls in stop-guardian.service.ts',
    'the read pattern changed; update this validator so declared-vs-fetched stays checked',
  );
}

// ── Parse: the registry, as assembled in directives.module.ts ─────────────────
const propToClass = new Map(
  [...moduleSrc.matchAll(/private\s+readonly\s+(\w+)\s*:\s*(\w+),/g)].map((m) => [m[1], m[2]]),
);
const registeredProps = [
  ...moduleSrc.matchAll(/this\.directivesService\.register\(this\.(\w+)\)/g),
].map((m) => m[1]);

if (registeredProps.length < MIN_REGISTERED_PROPS) {
  die(
    `only ${registeredProps.length} register() call(s) found in directives.module.ts (expected >= ${MIN_REGISTERED_PROPS})`,
    'registration likely moved behind a loop or into another file — this validator can no longer see the registry, and an unverifiable check must not pass',
  );
}

const classToProp = new Map();
for (const [prop, cls] of propToClass) {
  if (!classToProp.has(cls)) classToProp.set(cls, prop);
}

/** class name -> { id, file }, for every directive implementation on disk. */
function scanImplementationClasses() {
  const out = new Map();
  if (!fs.existsSync(IMPL_DIR)) return out;

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith('.ts') || entry.name.endsWith('.spec.ts')) continue;

      const src = fs.readFileSync(full, 'utf8');
      // Split on the class keyword so one class's fields are never attributed to
      // another — the same slicing discipline `validate-directive-group-kind.cjs` uses.
      const parts = src.split(/export\s+class\s+/);
      for (let i = 1; i < parts.length; i++) {
        const name = /^(\w+)/.exec(parts[i]);
        const id = /readonly\s+id\s*=\s*['"]([^'"]+)['"]/.exec(parts[i]);
        if (!name || !id) continue;
        const rel = path.relative(NEST_ROOT, full).split(path.sep).join('/');
        out.set(name[1], { id: id[1], file: rel });
      }
    }
  };

  walk(IMPL_DIR);
  return out;
}

const classMeta = scanImplementationClasses();
if (classMeta.size === 0) {
  die(
    'could not read any directive class from the implementations directory',
    'nothing was verified — a check that inspects nothing must not report OK',
  );
}

/** class name -> directive id, for fast reverse lookup. */
const idToClass = new Map();
for (const [cls, meta] of classMeta) {
  if (!idToClass.has(meta.id)) idToClass.set(meta.id, { cls, ...meta });
}

// ── Key A (#890): every declared ID must resolve to a REGISTERED directive ────
for (const id of required) {
  const decl = idToClass.get(id);

  if (!decl) {
    fail(
      `'${id}' is read by StopGuardianService but no class declares \`readonly id = '${id}'\``,
      'check the spelling, or the directive the guardian expects was deleted or renamed',
    );
    continue;
  }

  const prop = classToProp.get(decl.cls);
  if (!prop) {
    fail(
      `'${id}' (${decl.cls}) is not injected in directives.module.ts`,
      `add \`private readonly <prop>: ${decl.cls},\` to the module constructor — a class in \`providers\` is constructed but unreachable`,
    );
    continue;
  }

  if (!registeredProps.includes(prop)) {
    fail(
      `'${id}' (${decl.cls}) is never passed to register() — the guardian cannot resolve it`,
      `add \`this.directivesService.register(this.${prop});\` in onModuleInit. Being in \`providers\` is NOT registration: Map.get() returns undefined for an unregistered id, and the guardian reads that as "no evidence" rather than as an error. This is #890.`,
    );
  }
}

// ── Key B: nothing may be fetched without being declared ─────────────────────
for (const id of fetched) {
  if (!required.includes(id)) {
    fail(
      `resultsMap.get('${id}') is read but '${id}' is not in STOP_GUARDIAN_DIRECTIVES`,
      'Map.get() returns undefined for an unlisted key, so the guardian silently reads "no evidence" — add it to the Set, or remove the read',
    );
  }
}

// ── Key C: nothing may be declared without being fetched ────────────────────
for (const id of required) {
  if (!fetched.includes(id)) {
    fail(
      `STOP_GUARDIAN_DIRECTIVES lists '${id}' but nothing reads it`,
      'dead entry — either read it below, or drop it so future readers are not misled about what the guardian consults',
    );
  }
}

// ── Report ───────────────────────────────────────────────────────────────────
if (failures.length > 0) {
  console.error(
    `\n[guardian-directive-ids] \u2716 ${failures.length} violation(s) of INV-GUARDIAN-DIRECTIVE-RESOLVABLE:\n`,
  );
  for (const f of failures) {
    console.error(`  \u2716 ${f.message}`);
    if (f.hint) console.error(`      \u2192 ${f.hint}`);
  }
  console.error('\nThe Stop Guardian decides whether to move a live stop from these IDs.');
  console.error('An unresolvable ID does not error — it reads as "no evidence".\n');
  process.exit(1);
}

console.log(
  `[guardian-directive-ids] \u2705 OK — all ${required.length} guardian directive(s) registered ` +
    `(${required.join(', ')}) \u00b7 registry ${registeredProps.length} directive(s)\n`,
);
