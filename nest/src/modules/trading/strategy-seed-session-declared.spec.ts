/**
 * strategy-seed-session-declared.spec.ts — THE BUILD GATE for #982.
 * ================================================================
 *
 * WHAT THIS PINS: every entry in `DEFAULT_TRADING_STRATEGIES` DECLARES its session slot. The
 * deliberate all-hours case is the positive literal `'all-hours'` (or a non-empty tag array);
 * NULL / empty / unreadable are not declarations and FAIL the build.
 *
 * ⚠️ WHY A GATE AND NOT A CONVENTION. `NULL` used to mean two opposite things at once —
 * "I deliberately allow this bot to act at any hour" AND "nobody ever filled this slot in" — with
 * no error either way. Measured 2026-10-06: four city-named TWIN bots disagree inside one protocol
 * (USDJPY declares `asian`, EURJPY is NULL; Sydney/NZDJPY/Zurich likewise), and nothing could say
 * which NULL was intent and which was an omission. This spec is in the `prebuild` jest list, so
 * "set one to NULL" is now a BUILD failure, not a discovery.
 *
 * ⚠️ THE TYPE DOCUMENTS, THIS SPEC ENFORCES. `SeedTradingStrategy.sessionWindow` no longer permits
 * `null` in its declared union — but MEASURED (canary 2026-10-08): this project compiles with
 * `strictNullChecks` OFF, so `tsc` does NOT reject a null entry. The spec below is therefore the
 * EFFECTIVE build gate, and it also catches what a type could not: an EMPTY ARRAY (parses to no
 * tags, indistinguishable from unfilled) and an unreadable string.
 *
 * Canary (observed 2026-10-08): setting one seed entry back to `sessionWindow: null` fails this
 * spec with the bot named ("Sydney AUDJPY Session: unfilled — null") while `typecheck` stays GREEN
 * — which is exactly why this spec exists; restore → 3/3 green, `git diff` clean.
 */
import { DEFAULT_TRADING_STRATEGIES } from './strategy-seed-data';
import { sessionSlotKind } from './session-window';

describe('every seeded bot DECLARES its session slot (#982)', () => {
  it('the seed is non-trivial — a gate that inspects nothing must ERROR, not pass', () => {
    // Same rule as every audit script in this repo: a validator that reads an empty set and
    // reports OK is worse than no validator.
    expect(DEFAULT_TRADING_STRATEGIES.length).toBeGreaterThan(30);
  });

  it('no seeded bot has an UNFILLED (or unreadable) session slot', () => {
    const undeclared = DEFAULT_TRADING_STRATEGIES
      .filter((s) => !['tags', 'all-hours'].includes(sessionSlotKind(s.sessionWindow)))
      .map((s) => `${s.name}: ${sessionSlotKind(s.sessionWindow)} — ${JSON.stringify(s.sessionWindow)}`);
    expect(undeclared).toEqual([]);
  });

  it('a tag array is never empty — `[]` is a non-declaration, not an all-hours choice', () => {
    for (const s of DEFAULT_TRADING_STRATEGIES) {
      if (Array.isArray(s.sessionWindow)) {
        expect(s.sessionWindow.length).toBeGreaterThan(0);
      }
    }
  });
});
