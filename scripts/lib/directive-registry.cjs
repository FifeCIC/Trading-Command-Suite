/**
 * directive-registry.cjs — the ONE definition of "is this directive class registered?"
 * ====================================================================================
 * Four tools need the answer, and until now each carried its own copy of the rule. Three copies
 * drifted, and one of them was WRONG in a way that made a build gate report OK on a broken tree:
 *
 *   • `scripts/why-unregistered.cjs`  — exact rule (register(this.x) back-matched through the
 *                                       constructor parameter list). Correct.
 *   • `scripts/audit-directive-depth.cjs` — exact rule. Correct.
 *   • `scripts/validate-directive-id-references.cjs` — tested whether the CLASS NAME appeared
 *                                       anywhere in `directives.module.ts`, which matches the
 *                                       **import line**. It therefore reported 137 "registered"
 *                                       ids while the runtime registry held 110, and printed
 *                                       `✅ OK` while `directives-groups.ts` named `williams-r`,
 *                                       a directive that no `register()` call ever reached.
 *
 * ⚠️ THE DEFECT IS THE SHAPE, NOT THE TYPO. An import is a DECLARATION that a class exists; a
 * `register()` call is the act that makes it reachable by `runAll(filter)`. A check that cannot
 * tell those apart reports on an artefact it is not testing — the same failure as #881, and the
 * same lesson #1169 records: *registration has to be read from the file the app actually
 * instantiates, and read for the act, not the name.*
 *
 * WHY A MODULE RATHER THAN MORE COPIES
 * ------------------------------------
 * `validate-duplication.cjs` fails the build on new duplicate blocks (#966), and the repo's own
 * rule is *prefer the existing canonical mechanism*. Four independent parsers of the same file is
 * exactly how the wrong one survived.
 *
 * THE RULE, STATED ONCE
 * ---------------------
 * A directive class is registered only if all three exist in `directives.module.ts`:
 *   1. a provider entry (not checked here — it is implied by the constructor parameter),
 *   2. a constructor parameter `private readonly <name>: <ClassName>,`
 *   3. a call `this.directivesService.register(this.<name>)`
 *
 * Step 3 is back-matched to the class through step 2. That is the same signal the runtime uses.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_MODULE = path.join(REPO_ROOT, 'nest', 'src', 'modules', 'directives', 'directives.module.ts');
const DEFAULT_DIR = path.join(REPO_ROOT, 'nest', 'src', 'modules', 'directives', 'implementations');

/**
 * Every directive class the runtime actually registered, resolved from the module's own
 * constructor parameter list and `register()` calls.
 *
 * ⚠️ ALIASES ARE RESOLVED (measured 2026-11-01). `directives.module.ts` imports one class under a
 * different local name — `import { MondayEffectDirective as MondayEffectRealDirective }` — and a
 * naive constructor-parameter match yields the ALIAS, not the declared class name. `monday-effect`
 * is genuinely registered, but every audit reported it as unreachable, and a DELETE decision was
 * being prepared for a live class on the strength of that false negative.
 *
 * So the parameter's type is mapped back through the import table to the DECLARED class name before
 * the comparison. A registration check that cannot read an alias reports on a name, not an act.
 *
 * @param {string} moduleSrc  text of `directives.module.ts`
 * @returns {Set<string>} declared class names
 */
function registeredClassNames(moduleSrc) {
  // local name -> declared name, from `import { Declared, Declared as Local } from '...'`
  const localToDeclared = new Map();
  for (const m of moduleSrc.matchAll(/import\s*\{([^}]+)\}\s*from\s*'[^']+'/g)) {
    for (const part of m[1].split(',')) {
      const bits = part.trim().split(/\s+as\s+/);
      const declared = bits[0].trim();
      const local = (bits[1] ?? bits[0]).trim();
      if (declared) localToDeclared.set(local, declared);
    }
  }

  const paramToType = new Map();
  for (const m of moduleSrc.matchAll(/private\s+readonly\s+(\w+)\s*:\s*(\w+)\s*,/g)) {
    paramToType.set(m[1], m[2]);
  }
  const registered = new Set();
  for (const m of moduleSrc.matchAll(/directivesService\.register\(\s*this\.(\w+)\s*\)/g)) {
    const type = paramToType.get(m[1]);
    if (!type) continue;
    registered.add(localToDeclared.get(type) ?? type);
  }
  return registered;
}

/**
 * Every class in the directive library, with the `id` it would register under.
 *
 * ⚠️ Scoped to the CLASS, not the file. `momentum-and-macro.directives.ts` holds several classes
 * and an early version borrowed a neighbouring class's retirement note, which made a live
 * directive read as deliberately retired.
 *
 * @param {string} dir  the implementations directory
 * @returns {Array<{className: string, id: string, file: string, readiness: string, source: string}>}
 */
function libraryClasses(dir = DEFAULT_DIR) {
  const out = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'))) {
    const src = fs.readFileSync(path.join(dir, file), 'utf8');
    const starts = [...src.matchAll(/export\s+class\s+(\w+)[\s\S]*?implements\s+IDirective/g)];
    for (let i = 0; i < starts.length; i++) {
      const end = i + 1 < starts.length ? starts[i + 1].index : src.length;
      const body = src.slice(starts[i].index, end);
      const id = (/readonly id = '([^']+)'/.exec(body) || [])[1];
      if (!id) continue;
      out.push({
        className: starts[i][1],
        id,
        file,
        readiness: (/readonly readiness = '([^']+)'/.exec(body) || [])[1] ?? '?',
        source: body,
      });
    }
  }
  return out;
}

/**
 * The full picture in one call: the library, what is registered, and both directions of the
 * difference.
 *
 * @param {{ modulePath?: string, dir?: string }} [opts]
 */
function loadRegistry(opts = {}) {
  const modulePath = opts.modulePath ?? DEFAULT_MODULE;
  const dir = opts.dir ?? DEFAULT_DIR;
  const moduleSrc = fs.readFileSync(modulePath, 'utf8');
  const registered = registeredClassNames(moduleSrc);
  const library = libraryClasses(dir);

  const registeredIds = new Set();
  const unregistered = [];
  for (const row of library) {
    if (registered.has(row.className)) registeredIds.add(row.id);
    else unregistered.push(row);
  }

  return { moduleSrc, registered, library, registeredIds, unregistered };
}

module.exports = {
  REPO_ROOT,
  DEFAULT_MODULE,
  DEFAULT_DIR,
  registeredClassNames,
  libraryClasses,
  loadRegistry,
};
