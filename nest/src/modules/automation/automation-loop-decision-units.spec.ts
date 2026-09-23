import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * TickDecision units are ENFORCED, not documented (#937).
 *
 * ⚠️ WHY THIS SPEC EXISTS. #909 split the old `composite` column into `compositeRaw` /
 * `compositePct` and its closure claimed "the build fails if a writer omits the unit". The
 * verifier measured that this was NOT true: both slots were independent optionals, the
 * persistence spec even asserted a BOTH-NULL write was legal, and no validator enforced
 * anything. A guard-shaped statement without a guard.
 *
 * The enforcement is now the `TickDecisionScore` union in `automation-loop.service.ts` — a
 * literal that sets neither slot or both is a compile error, and ts-jest diagnostics make that
 * a TEST failure. This spec holds the enforcement itself in place, because a type change is
 * invisible to a running system until someone weakens it:
 *
 *   1. the exactly-one-slot union must EXIST (reverting to two loose optionals fails here);
 *   2. every `decision: 'SCORED'` writer site must declare a unit;
 *   3. no writer literal may set BOTH units (the #909 exactly-one rule);
 *   4. (#971) an `OBSERVED` row must have NO strategyId — the marker means "nothing consumes this",
 *      so writing a bot's row as OBSERVED would hide a real signal.
 *
 * Canary note: temporarily deleting `compositeRaw:` from a SCORED push site fails these tests
 * (site scan) AND fails compilation (ts-jest) — the check bites from two directions.
 */
describe('TickDecision units are enforced, not documented (#937)', () => {
  const raw = readFileSync(join(__dirname, 'automation-loop.service.ts'), 'utf8');
  // Comments are stripped before scanning: the docblocks legitimately MENTION the slot names,
  // and a scan that cannot tell code from prose would pass for the wrong reason.
  const code = raw.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const pushBlocks = [...code.matchAll(/decisions\.push\(\{([\s\S]*?)\n\s*\}\);/g)].map((m) => m[1]);

  it('the exactly-one-slot union EXISTS (reverting it to two optionals fails here)', () => {
    expect(code).toContain('compositeRaw: number | null; compositePct?: never');
    expect(code).toContain('compositePct: number | null; compositeRaw?: never');
  });

  it('every SCORED writer site declares a unit (the pipeline sets it)', () => {
    const scored = pushBlocks.filter((b) => /decision:\s*'SCORED'/.test(b));
    // #971 moved the LADDER row from SCORED to OBSERVED (it has no consumer), so the A/B
    // threshold row is now the only SCORED writer. If a future refactor removes it the guard
    // should be re-pointed, not silently vacuous — the OBSERVED test below carries the other half.
    expect(scored.length).toBeGreaterThanOrEqual(1);
    for (const block of scored) {
      const hasUnit = /compositeRaw:/.test(block) || /compositePct:/.test(block);
      expect(hasUnit).toBe(true);
    }
  });

  it('an OBSERVED row is a row with NO consumer — and it declares its unit (#971)', () => {
    const observed = pushBlocks.filter((b) => /decision:\s*'OBSERVED'/.test(b));
    // The ladder block is the only observation writer today; a scanner that matches nothing
    // would pass the loop below for the wrong reason, so assert it found one.
    expect(observed.length).toBeGreaterThanOrEqual(1);
    for (const block of observed) {
      // ⚠️ The marker MEANS "nothing reads this". A row with a strategyId (i.e. a bot attached)
      // must not be written as OBSERVED — that would hide a real signal, the inverse of the bug
      // #971 fixes, and it is the direction a careless refactor would break first.
      expect(/strategyId:\s*''/.test(block)).toBe(true);
      expect(/compositeRaw:|compositePct:/.test(block)).toBe(true);
    }
  });

  it('no writer literal sets BOTH units (#909 exactly-one rule)', () => {
    // Sanity: the scanner actually found the writer sites (a scanner that matches nothing
    // passes every assertion — the "a check that inspects nothing and reports OK" defect).
    expect(pushBlocks.length).toBeGreaterThanOrEqual(10);
    for (const block of pushBlocks) {
      const both = /compositeRaw:/.test(block) && /compositePct:/.test(block);
      expect(both).toBe(false);
    }
  });
});
