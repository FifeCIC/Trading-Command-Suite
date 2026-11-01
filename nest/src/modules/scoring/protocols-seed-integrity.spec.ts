/**
 * protocols-seed-integrity.spec.ts — INSTALLING A PROTOCOL MUST BE SUPPORTED BY INSTALLED DIRECTIVE DATA.
 *
 * The seed is what a fresh database is built from, so a seed that names something the codebase cannot
 * answer to installs a protocol that is arithmetically plausible and quietly incomplete: `runAll`
 * skips an id it cannot resolve, and nothing reports the missing directive.
 *
 * Two measurements made this necessary (2026-11-01):
 *   - #1169 deleted 17 directive classes. Every seed id was checked at the time; this keeps it true
 *     for the next deletion, which is otherwise invisible.
 *   - #1165 added per-entry `params`, which the seed can now declare. A seed parameter with a typo'd
 *     key or an out-of-range value would install a number no directive reads — silence of exactly the
 *     kind this repo keeps re-finding.
 *
 * ⚠️ CANARY IT BEFORE TRUSTING IT. Add a bogus id to any group in `protocols-seed-data.ts` and this
 * file must fail naming it; same for `directiveParams: { notAKey: 1 }`. A guard observed only in the
 * passing direction proves nothing.
 */
import * as fs from 'fs';
import * as path from 'path';
import { PROTOCOL_SEED_DATA } from './protocols-seed-data';
import { validateSupplied } from '../directives/parameters';

const DIRECTIVES_MODULE = path.join(__dirname, '..', 'directives', 'directives.module.ts');

/** Every directive the application registers: id → the instance the app would construct. */
function registeredById(): Map<string, any> {
  const source = fs.readFileSync(DIRECTIVES_MODULE, 'utf8');
  const files = new Set<string>();
  for (const m of source.matchAll(/from '\.\/implementations\/([^']+)'/g)) files.add(m[1]);

  const byId = new Map<string, any>();
  for (const rel of files) {
    if (rel.endsWith('.spec')) continue;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(`../directives/implementations/${rel}`);
    for (const val of Object.values(mod)) {
      if (typeof val !== 'function') continue;
      const proto = (val as any).prototype;
      if (!proto || typeof proto.calculate !== 'function') continue;
      let instance: any;
      try {
        instance = new (val as any)();
      } catch {
        continue;
      }
      if (typeof instance.id === 'string') byId.set(instance.id, instance);
    }
  }
  return byId;
}

const byId = registeredById();

describe('protocol seed — installation is supported by installed directive data', () => {
  it('the registry scan found the directives (a scan that finds nothing must FAIL, not pass)', () => {
    expect(byId.size).toBeGreaterThan(100);
  });

  it('every protocol in the seed names only directives that resolve to a registered class', () => {
    const dangling: string[] = [];
    for (const [slug, proto] of Object.entries(PROTOCOL_SEED_DATA)) {
      for (const group of proto.groups ?? []) {
        for (const directiveId of group.directiveIds ?? []) {
          if (!byId.has(directiveId)) dangling.push(`${slug} / ${group.id} → ${directiveId}`);
        }
      }
    }
    // A seeded protocol that names an unresolvable directive scores one fewer than it claims, with
    // no error. Fail with the list, not a count — the fix is per id.
    expect(dangling).toEqual([]);
  });

  it('no group lists the same directive twice (a duplicate is two entries for one class)', () => {
    const dupes: string[] = [];
    for (const [slug, proto] of Object.entries(PROTOCOL_SEED_DATA)) {
      for (const group of proto.groups ?? []) {
        const seen = new Set<string>();
        for (const directiveId of group.directiveIds ?? []) {
          if (seen.has(directiveId)) dupes.push(`${slug} / ${group.id} → ${directiveId}`);
          seen.add(directiveId);
        }
      }
    }
    expect(dupes).toEqual([]);
  });

  it('every seeded directiveParams entry is a real, in-range parameter of that directive', () => {    const problems: string[] = [];
    for (const [slug, proto] of Object.entries(PROTOCOL_SEED_DATA)) {
      for (const group of proto.groups ?? []) {
        for (const [directiveId, params] of Object.entries(group.directiveParams ?? {})) {
          const instance = byId.get(directiveId);
          if (!instance) {
            problems.push(`${slug} / ${group.id} → ${directiveId}: declares params but the directive does not resolve`);
            continue;
          }
          const specs = instance.params ?? [];
          try {
            validateSupplied(directiveId, specs, params);
          } catch (err) {
            problems.push(`${slug} / ${group.id} → ${directiveId}: ${(err as Error).message}`);
          }
          // A param declared for a directive that is not IN the group would never be read.
          if (!(group.directiveIds ?? []).includes(directiveId)) {
            problems.push(`${slug} / ${group.id} → ${directiveId}: declares params but is not in directiveIds`);
          }
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('every seeded NAMED instance is well-formed and names a directive the group already lists', () => {
    const problems: string[] = [];
    for (const [slug, proto] of Object.entries(PROTOCOL_SEED_DATA)) {
      for (const group of proto.groups ?? []) {
        const labels = new Set<string>();
        for (const inst of group.directiveInstances ?? []) {
          const where = `${slug} / ${group.id}`;
          if (!inst?.directiveId) {
            problems.push(`${where}: an instance has no directiveId`);
            continue;
          }
          // `''` is the PRIMARY instance, declared by `directiveIds`. A seed cannot declare a second
          // primary — the database refuses it (UNIQUE on groupId+directiveId+instanceLabel), so the
          // failure would arrive as a raw 1062 at install time rather than as a readable message.
          if (!inst.label) {
            problems.push(`${where} → ${inst.directiveId}: instanceLabel is empty; '' is the PRIMARY instance`);
            continue;
          }
          if (labels.has(inst.label)) {
            problems.push(`${where} → ${inst.directiveId}: duplicate instanceLabel "${inst.label}"`);
          }
          labels.add(inst.label);
          // A named instance of a directive the group does not list would never be scored.
          if (!(group.directiveIds ?? []).includes(inst.directiveId)) {
            problems.push(`${where} → ${inst.directiveId}: declares an instance but the directive is not in directiveIds`);
          }
          const instance = byId.get(inst.directiveId);
          if (!instance) {
            problems.push(`${where} → ${inst.directiveId}: no registered class answers to that id`);
            continue;
          }
          if (inst.params) {
            try {
              validateSupplied(inst.directiveId, instance.params ?? [], inst.params);
            } catch (err) {
              problems.push(`${where} → ${inst.directiveId} [${inst.label}]: ${(err as Error).message}`);
            }
          }
        }
      }
    }
    expect(problems).toEqual([]);
  });
});
