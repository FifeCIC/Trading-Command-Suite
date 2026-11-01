#!/usr/bin/env node
/**
 * validate-directive-registration.cjs — every directive class in the library must be REGISTERED (#1169)
 * ======================================================================================================
 * THE DEFECT THIS CLOSES, measured 2026-11-01: **50 of 161** declared directive classes were reachable
 * by nothing. They compiled, passed conformance, and could never score, because `directives.module.ts`
 * never called `register()` for them. `why-unregistered.cjs` could REPORT that, but nothing FAILED.
 *
 * The cost was not dead code — it was a whole day of work on the wrong files:
 *   • `scripts/audit-directive-depth.cjs` ranked `price-time-gap` and `candle-pressure` as the TOP TWO
 *     by tunable headroom, and neither could run;
 *   • `williams-r` was parameterised, given a BASELINE, and referenced by `directive-groups.ts`, while
 *     being unreachable — so the parameters tuned nothing and a protocol silently scored one directive
 *     fewer than it declared.
 *
 * ⚠️ WHY THE PREBUILD AND NOT A REPORT. A report is a thing a hurried agent does not read. The two
 * failures above both happened WITH the audit available and recently run. The build is the only check
 * that cannot be skipped, and the registration count is exactly the kind of fact that drifts silently.
 *
 * ⚠️ THE COMPLEMENT, NOT A DUPLICATE. `scripts/validate-directive-id-references.cjs` checks the OTHER
 * direction — an id named by a seed that no class provides. Together they cover both halves:
 *
 *        seed / group / preset ──names──▶ id ──resolves──▶ registered class
 *                    ▲                        ▲
 *        validate-directive-id-references    validate-directive-registration (this file)
 *
 * ⚠️ REGISTRATION IS NOT "the class name appears in the module". An import is a declaration; only
 * `register(this.x)` makes a directive resolvable by `runAll(filter)`. The one definition of that rule
 * lives in `scripts/lib/directive-registry.cjs` — it resolves ALIASED imports too, which a name search
 * cannot (`MondayEffectDirective as MondayEffectRealDirective`).
 *
 * Usage:
 *   node nest/scripts/validate-directive-registration.cjs            # exit 1 on any unregistered class
 *   node nest/scripts/validate-directive-registration.cjs --json
 *   node nest/scripts/validate-directive-registration.cjs --self-test
 */

'use strict';

const path = require('path');
const {
  registeredClassNames,
  libraryClasses,
  DEFAULT_MODULE,
  DEFAULT_DIR,
} = require(path.join(__dirname, '..', '..', 'scripts', 'lib', 'directive-registry.cjs'));
const { runCases, collector } = require(path.join(__dirname, '..', '..', 'scripts', 'lib', 'self-test.cjs'));

const TAG = 'directive-registration';

/**
 * Compare a library against the classes a module source registers.
 *
 * Pure: takes text, returns findings. That is what makes the self-test possible without touching the
 * live tree — a canary that edits real files to prove a guard works is a canary that can leave the
 * tree modified.
 */
function findUnregistered(library, moduleSrc) {
  const registered = registeredClassNames(moduleSrc);
  return library.filter((row) => !registered.has(row.className));
}

function main() {
  if (process.argv.includes('--self-test')) return selfTest();

  let library;
  let moduleSrc;
  try {
    const fs = require('fs');
    library = libraryClasses(DEFAULT_DIR);
    moduleSrc = fs.readFileSync(DEFAULT_MODULE, 'utf8');
  } catch (err) {
    // ⚠️ A check that cannot read its input must ERROR, never pass. "Could not load the library"
    // rendering as "everything is registered" is the failure this whole file exists to prevent.
    console.error(`[${TAG}] ✖ could not read the directive library: ${err.message}`);
    process.exit(2);
  }

  if (library.length === 0) {
    console.error(`[${TAG}] ✖ found 0 directive classes in ${DEFAULT_DIR}`);
    console.error('    → the scan is broken, not the library. Refusing to report OK.');
    process.exit(2);
  }

  const unregistered = findUnregistered(library, moduleSrc);

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({
      classes: library.length,
      registered: library.length - unregistered.length,
      unregistered: unregistered.map((r) => ({ id: r.id, className: r.className, file: r.file, readiness: r.readiness })),
    }, null, 1));
    process.exit(unregistered.length ? 1 : 0);
  }

  console.log(`[${TAG}] directive classes: ${library.length}  registered: ${library.length - unregistered.length}  unregistered: ${unregistered.length}`);

  if (unregistered.length === 0) {
    console.log(`[${TAG}] ✅ OK — every directive class in the library is registered`);
    return;
  }

  console.error(`\n[${TAG}] ✖ ${unregistered.length} class(es) declared but never instantiated:\n`);
  for (const r of unregistered) {
    console.error(`  ${r.id.padEnd(30)} ${r.className.padEnd(38)} ${r.file}`);
  }
  console.error('\n  A class that nothing registers cannot score, gate, or be selected by a protocol.');
  console.error('  Two correct fixes, decided per directive — do NOT guess:');
  console.error('    1. WIRE IT   — import + provider + constructor parameter + this.directivesService.register(this.x)');
  console.error('                   in directives.module.ts. Check first that no registered class owns the same id:');
  console.error('                   two instances of one signal inflate a composite denominator (#1169).');
  console.error('    2. DELETE IT — if it is superseded by a live class or retired, remove the file so the');
  console.error('                   library count equals what the app can actually run.');
  process.exit(1);
}

function selfTest() {
  const cases = [];
  const t = collector(cases);

  // Synthetic module: one plain registration, one ALIASED registration, one import that is never
  // registered, and one class that never appears at all.
  const moduleSrc = `
    import { AlphaDirective } from './implementations/alpha.directive';
    import { MondayEffectDirective as MondayEffectRealDirective } from './implementations/monday.directive';
    import { NeverRegisteredDirective } from './implementations/never.directive';

    @Module({ providers: [AlphaDirective, MondayEffectRealDirective, NeverRegisteredDirective] })
    export class DirectivesModule implements OnModuleInit {
      constructor(
        private readonly directivesService: DirectivesService,
        private readonly alpha: AlphaDirective,
        private readonly monday: MondayEffectRealDirective,
      ) {}

      async onModuleInit() {
        this.directivesService.register(this.alpha);
        this.directivesService.register(this.monday);
      }
    }
  `;
  const lib = [
    { className: 'AlphaDirective', id: 'alpha', file: 'alpha.directive.ts', readiness: 'ready' },
    { className: 'MondayEffectDirective', id: 'monday', file: 'monday.directive.ts', readiness: 'alpha' },
    { className: 'NeverRegisteredDirective', id: 'never', file: 'never.directive.ts', readiness: 'ready' },
    { className: 'AbsentDirective', id: 'absent', file: 'absent.directive.ts', readiness: 'ready' },
  ];

  const found = findUnregistered(lib, moduleSrc).map((r) => r.className);

  // Direction 1 — a registered class is NOT reported. Without this the guard could flag everything.
  t('a plainly registered class is not reported', () => !found.includes('AlphaDirective'));
  // Direction 2 — an imported-but-never-registered class IS reported (the WILLIAMS-R shape).
  t('a class imported and provided but never registered is reported', () => found.includes('NeverRegisteredDirective'));
  // Direction 3 — a class absent from the module entirely IS reported.
  t('a class absent from the module is reported', () => found.includes('AbsentDirective'));
  // Direction 4 — an ALIASED import resolves to the declared name (the MONDAY-EFFECT false negative).
  t('an aliased import resolves to the declared class name', () => !found.includes('MondayEffectDirective'));
  // Direction 5 — the pure function is not accidentally returning everything.
  t('exactly the unregistered classes are returned', () => found.length === 2);

  // Direction 6 — the scan must FIND the library. A scan that reads nothing must never pass.
  t('the live scan finds more than 100 directive classes', () => libraryClasses(DEFAULT_DIR).length > 100);

  // Direction 7 — the live tree registers something, so a broken parser cannot pass by finding none.
  t('the live module registers more than 100 classes', () => {
    const fs = require('fs');
    return registeredClassNames(fs.readFileSync(DEFAULT_MODULE, 'utf8')).size > 100;
  });

  process.exit(runCases(cases, TAG));
}

if (require.main === module) main();
module.exports = { findUnregistered };
