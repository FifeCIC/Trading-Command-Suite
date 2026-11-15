import * as fs from 'fs';
import * as path from 'path';

/**
 * The directive-version guard must be WIRED INTO THE BUILD, not merely exist (#1274).
 *
 * ⚠️ WHY THIS SPEC EXISTS AT ALL. `validate-directive-versions.cjs --self-test` already proves the
 * LOGIC: that a comment edit is ignored, that a code edit is caught, that a bump clears it. What no
 * self-test can prove is that the script ever RUNS. A validator that nothing invokes is
 * indistinguishable from one that does not exist — this repo has a measured precedent
 * (`analyse-unreachable-capacity.cjs`, unreachable for weeks while an agent hunted for exactly that
 * capability), and #1274's whole premise is that a silent change went unnoticed.
 *
 * So this pins the two facts a self-test cannot: the guard is in `prebuild`, and the record it
 * compares against covers every directive in the library.
 */
const ROOT = path.join(__dirname, '..', '..', '..', '..');

// ⚠️ `prebuild` lives in `nest/package.json`, not the root one — the root `prebuild` is the two
// frontend validators. Reading the wrong file would make this spec pass by finding the string
// nowhere and asserting on an empty file.
const nestPackage = JSON.parse(fs.readFileSync(path.join(ROOT, 'nest', 'package.json'), 'utf8'));
const prebuild: string = nestPackage.scripts?.prebuild ?? '';
const recordPath = path.join(ROOT, 'docs', 'directive-versions.json');
const srcDir = path.join(ROOT, 'nest', 'src', 'modules', 'directives', 'implementations');

describe('directive-version guard is wired (#1274)', () => {
  it('runs in prebuild', () => {
    expect(prebuild).toContain('validate-directive-versions.cjs');
  });

  it('runs BEFORE the build can produce dist — a post-build check cannot save a shipped change', () => {
    const guardAt = prebuild.indexOf('validate-directive-versions.cjs');
    const rimrafAt = prebuild.indexOf('rimraf dist');
    expect(guardAt).toBeGreaterThan(-1);
    expect(rimrafAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(rimrafAt);
  });

  it('the record exists and covers every directive class', () => {
    expect(fs.existsSync(recordPath)).toBe(true);
    const record = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
    const recorded = Object.keys(record.directives ?? {});

    const files = fs
      .readdirSync(srcDir)
      .filter((f) => f.endsWith('.directive.ts'))
      .map((f) => fs.readFileSync(path.join(srcDir, f), 'utf8'))
      .map((src) => src.match(/readonly id = '([^']+)'/)?.[1])
      .filter((id): id is string => Boolean(id));

    expect(recorded.length).toBeGreaterThan(0);
    // Every directive must be in the record, or `--check` reports it stale — but assert it here too,
    // because a silently-shrinking record is how a gate stops covering things it used to cover.
    for (const id of files) expect(recorded).toContain(id);
  });

  it('every recorded directive carries both a version and a hash', () => {
    const record = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
    for (const [id, entry] of Object.entries<any>(record.directives ?? {})) {
      expect(`${id} version`).toBe(`${id} version`); // keeps the failure message naming the directive
      expect(typeof entry.version).toBe('string');
      expect(typeof entry.hash).toBe('string');
      expect(entry.hash.length).toBeGreaterThan(7);
    }
  });
});
