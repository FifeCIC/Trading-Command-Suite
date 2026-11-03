/**
 * The trend reading must stay an OBSERVATION (#1190).
 *
 * ⚠️ WHY THIS IS A TEST AND NOT A COMMENT. The whole value of the experiment depends on one property:
 * the reading is allowed to be wrong because nothing acts on it. The moment a directive, a gate, a
 * sizing step or the automation loop imports it, the reading stops being an observation and becomes
 * a maths change — which under the owner's own rule needs a COPIED configuration and a monitored A/B
 * against the incumbent. A docblock cannot prevent that; a failing build can.
 *
 * ⚠️ THE FIRST VERSION OF THIS FILE WAS BROKEN, AND PASSED. It joined `__dirname` with
 * `'src/modules/scoring'`, but `__dirname` is ALREADY inside `nest/src/modules/trend` — so the path
 * resolved to `nest/src/src/modules/scoring`, which does not exist, and `walk()` returned `[]`.
 * Zero files scanned, zero offenders, green tick. Canarying it (inserting the import into
 * `protocol-gating.service.ts`) still passed, which is what exposed it.
 *
 * That is the repo's most expensive failure shape — a verifier that cannot read its input reporting
 * OK — so the guard now has TWO defences: the root is derived from this file's own location, and a
 * test asserts that a real number of files were read. **A scan that inspects nothing FAILS.**
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, resolve, basename } from 'path';

/** Directories whose code makes DECISIONS. Anything here must not reach into the reading. */
const DECISION_PATHS = [
  'modules/scoring',
  'modules/trading',
  'modules/automation',
  'modules/signals',
  'modules/backtest',
];

/** Import path fragments that would mean "this decision path reads the trend experiment". */
const FORBIDDEN = ['trend-read', 'modules/trend'];

/** `nest/src` — derived from this file's location, so it cannot drift from the filesystem. */
const SRC_ROOT = resolve(__dirname, '..', '..');

/** Measured 2026-11-03: ~250 `.ts` files across these paths. 40 trips on a rename, not on a tidy-up. */
const MIN_EXPECTED_FILES = 40;

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, out);
    else if (/\.ts$/.test(name) && !/\.spec\.ts$/.test(name)) out.push(full);
  }
  return out;
}

/** Every non-spec `.ts` file under the decision paths, with the relative path it came from. */
function decisionFiles(): Array<{ rel: string; file: string }> {
  const out: Array<{ rel: string; file: string }> = [];
  for (const rel of DECISION_PATHS) {
    for (const file of walk(join(SRC_ROOT, rel))) out.push({ rel, file });
  }
  return out;
}

describe('trend reading is an observation, not a decision path (#1190)', () => {
  it('scans a REAL number of files — a guard that inspects nothing must FAIL, not pass', () => {
    const files = decisionFiles();
    // This single assertion is the defence against the bug described in the header. Without it,
    // every other assertion in this file is vacuously true.
    expect(files.length).toBeGreaterThan(MIN_EXPECTED_FILES);
    // And the root really is `nest/src`, not `nest/src/src`.
    expect(existsSync(join(SRC_ROOT, 'modules', 'scoring'))).toBe(true);
  });

  it('is imported by NOTHING under the scoring, trading, automation, signals or backtest modules', () => {
    const files = decisionFiles();
    const offenders: string[] = [];
    for (const { rel, file } of files) {
      const src = readFileSync(file, 'utf8');
      for (const frag of FORBIDDEN) {
        // Only an IMPORT counts. A comment mentioning the path is fine — documentation referring to
        // the experiment is desirable, and failing on it would get the guard switched off.
        const re = new RegExp(`(?:import|require)[^;\\n]*${frag.replace(/[/\\-]/g, (m) => `\\${m}`)}`);
        if (re.test(src)) offenders.push(`${rel}/${basename(file)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the maths module is PURE — it imports no database, service or clock', () => {
    const mathPath = join(__dirname, 'trend-read.math.ts');
    expect(existsSync(mathPath)).toBe(true);
    const src = readFileSync(mathPath, 'utf8');
    const imports = [...src.matchAll(/^import\s+[^;]*?from\s+'([^']+)';/gm)].map((m) => m[1]);
    // The one permitted import is the indicator helpers — pure functions over arrays.
    expect(imports).toEqual(['../directives/utils/indicators']);
  });

  it('does not read the wall clock, so the same bars always produce the same reading', () => {
    const src = readFileSync(join(__dirname, 'trend-read.math.ts'), 'utf8');
    // `Date.now()`/`new Date()` inside the maths would make a reading depend on WHEN it was taken,
    // which breaks both reproducibility and any before/after comparison.
    expect(/Date\.now\s*\(/.test(src)).toBe(false);
    expect(/new Date\s*\(/.test(src)).toBe(false);
  });
});
