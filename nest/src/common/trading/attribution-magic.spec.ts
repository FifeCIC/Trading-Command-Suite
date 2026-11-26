/**
 * attribution-magic.spec.ts — the magic that means "no bot" must never read as a bot (#1018, #1349).
 *
 * ⚠️ WHY THIS SUITE EXISTS RATHER THAN A COMMENT. `234000` is the MT5 bridge's `DEFAULT_MAGIC`, so
 * every order sent without one carries it. A consumer that treats it as an ordinary magic attributes
 * an unattributed position to whichever bot happens to sit at 234000 — or, worse, to *any* bot whose
 * lookup tolerates it. Both are silent: the position is managed by the wrong owner, or by nobody, and
 * nothing errors.
 *
 * ⚠️ CANARY BOTH WAYS: delete the `magic !== BRIDGE_DEFAULT_MAGIC` line and the first test fails;
 * return `true` unconditionally and the null/undefined cases fail.
 */
import { BRIDGE_DEFAULT_MAGIC, FIRST_BOT_MAGIC, isAttributableMagic } from './attribution-magic';

describe('attribution magic', () => {
  it('the bridge default is 234000 and is NOT attributable', () => {
    expect(BRIDGE_DEFAULT_MAGIC).toBe(234000);
    expect(isAttributableMagic(BRIDGE_DEFAULT_MAGIC)).toBe(false);
  });

  it('null and undefined are not attributable — "the broker reported none" is not a bot', () => {
    expect(isAttributableMagic(null)).toBe(false);
    expect(isAttributableMagic(undefined)).toBe(false);
  });

  it('the first allocated bot magic IS attributable, so the boundary is on the right side', () => {
    expect(isAttributableMagic(FIRST_BOT_MAGIC)).toBe(true);
    expect(isAttributableMagic(FIRST_BOT_MAGIC - 1)).toBe(true); // 234099 is not reserved
  });

  it('a real per-bot magic measured from the book is attributable', () => {
    // 234141 / 234178 / 234144 were the three most common non-default magics on 2026-11-26.
    for (const m of [234141, 234178, 234144, 234181, 234193]) {
      expect(isAttributableMagic(m)).toBe(true);
    }
  });

  it('rejects values that cannot come from the adapter, rather than coercing them', () => {
    // ⚠️ `Number('234000')` would be 234000 and would re-admit the bridge default. A string is
    // rejected by the type, not by a conversion, so a caller passing one is corrected rather than
    // silently obeyed.
    expect(isAttributableMagic(0)).toBe(false);
    expect(isAttributableMagic(-1)).toBe(false);
    expect(isAttributableMagic(234100.5)).toBe(false);
    expect(isAttributableMagic('234141' as unknown as number)).toBe(false);
  });
});
