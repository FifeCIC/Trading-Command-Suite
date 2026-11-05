import { PROTOCOL_SEED_DATA } from './protocols-seed-data';

/**
 * Focus ranks in the seed (#1187, owner request 2026-11-03).
 *
 * ⚠️ WHY A TEST AND NOT A SCRIPT. The repo has 207 tools and 80 orphans; a new script that only this
 * change needs would be the 81st. The suite already runs in `prebuild`, so a spec gates the build
 * without adding a surface nobody will find again.
 *
 * ⚠️ WHAT COULD ACTUALLY GO WRONG, and therefore what is asserted:
 *   · a copy-pasted protocol block keeps its parent's `focusRank`, so two unrelated protocols both
 *     claim rank 1 and "show me my focus protocols" returns a set the owner did not choose;
 *   · a rank is removed from the middle and the sequence reads 1, 3, 4 — not fatal, but it makes the
 *     reading order meaningless the next time someone counts;
 *   · the derived SHORT leg loses its parent's rank, so a pair is half-rankable and the list splits a
 *     strategy across two positions.
 *
 * ⚠️ WHAT IT DELIBERATELY DOES NOT ASSERT: any particular protocol IS a focus protocol. Which ones
 * are under active work is the owner's decision and changes without a code change being wrong.
 */

const seedEntries = Object.entries(PROTOCOL_SEED_DATA);
const longs = seedEntries.filter(([slug]) => !slug.endsWith('-short'));
const shorts = seedEntries.filter(([slug]) => slug.endsWith('-short'));

const rankedLongs = longs.filter(([, p]) => (p as any).focusRank != null);

describe('protocol focus ranks (#1187)', () => {
  it('has at least one focus protocol — an empty set would make every surface silently unsorted', () => {
    expect(rankedLongs.length).toBeGreaterThan(0);
  });

  it('gives every long protocol a rank that is UNIQUE among longs', () => {
    const ranks = rankedLongs.map(([, p]) => (p as any).focusRank as number);
    const duplicates = ranks.filter((r, i) => ranks.indexOf(r) !== i);
    expect(duplicates).toEqual([]);
  });

  it('numbers the ranks contiguously from 1 — a gap makes the reading order a lie', () => {
    const ranks = rankedLongs.map(([, p]) => (p as any).focusRank as number).sort((a, b) => a - b);
    expect(ranks).toEqual(ranks.map((_, i) => i + 1));
  });

  it('every rank is a positive integer — a float or a 0 orders nothing predictably', () => {
    for (const [slug, p] of rankedLongs) {
      const rank = (p as any).focusRank;
      expect(`${slug}=${rank}`).toMatch(/^[a-z0-9-]+=[1-9][0-9]*$/);
    }
  });

  it('a SHORT leg carries its PARENT rank — a pair must not straddle two positions in the list', () => {
    expect(shorts.length).toBeGreaterThan(0);
    for (const [slug, p] of shorts) {
      // The pair shares a base, so the parent of `<base>-short` is `<base>-long`, not `<base>`.
      const parentSlug = slug.replace(/-short$/, '-long');
      const parent = PROTOCOL_SEED_DATA[parentSlug];
      // A short leg is derived from a protocol that is in the seed, so the parent must exist.
      expect(`${slug} -> parent ${parentSlug}: ${parent ? 'present' : 'MISSING'}`).toBe(
        `${slug} -> parent ${parentSlug}: present`,
      );
      expect(`${slug} rank ${(p as any).focusRank} vs parent ${(parent as any)?.focusRank}`).toBe(
        `${slug} rank ${(parent as any)?.focusRank} vs parent ${(parent as any)?.focusRank}`,
      );
    }
  });
});
