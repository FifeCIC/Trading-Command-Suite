/**
 * Symbol-derivation contract — INV-NO-SYMBOL-GUESSING (#761 → #764)
 * =================================================================
 *
 * HISTORY, because the point of this file changed and that matters.
 *
 * **#761** asserted that every target `SINGLE_SYMBOL_HINTS` could produce resolved to a
 * live, active, bar-delivering ticker. That was the right guard for the time: the table
 * mapped a protocol-name fragment to a ticker, four of fifteen entries pointed at retired
 * (`BTCUSD`, `USOIL`, `DOGEUSD`) or non-existent (`CHN50`) tickers after the #760
 * consolidation, and a protocol aimed at a dead ticker failed **silently**.
 *
 * **#764** went further. The audit (`scripts/audit-hint-dependency.cjs`) showed 20 protocols
 * — 10 of them ACTIVE — resolved their symbols through those tables and nothing else. In
 * other words four fifths of the guessing was load-bearing, and the #761 fix had corrected
 * the target list without addressing the practice.
 *
 * Fixing targets is the wrong level. A guess cannot survive a rename, cannot report that it
 * broke, and is indistinguishable from a working relationship once the bars arrive. So the
 * tables were emptied and every protocol was wired by foreign key.
 *
 * WHAT THIS FILE NOW ASSERTS
 * --------------------------
 *   1. The hint tables are EMPTY. Repopulating one is a regression, because it silently
 *      reintroduces a guessed symbol for any protocol that is not wired.
 *   2. `deriveSingleSymbolFromSlug` therefore always returns null.
 *   3. The guessing path still exists and still WARNS — emptying the tables must not delete
 *      the diagnostic that tells an operator a protocol is unwired.
 *
 * The live half of this contract (every protocol resolves by FK) is enforced by the probe
 * and by `audit-hint-dependency.cjs`, which both report `HINT_ONLY=0`.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  SINGLE_SYMBOL_HINTS,
  WATCHLIST_HINTS,
  deriveSingleSymbolFromSlug,
  allDerivedSymbolTargets,
} from '../scoring/protocol-db.service';

const NEST_ROOT = path.resolve(__dirname, '..', '..', '..');

function readSource(relPath: string): string {
  return fs.readFileSync(path.join(NEST_ROOT, relPath), 'utf8');
}

/** Strip comments so prose describing a pattern cannot satisfy an assertion about code. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('symbol derivation is retired (#764)', () => {
  describe('the hint tables are empty', () => {
    it('SINGLE_SYMBOL_HINTS has no entries', () => {
      // A non-empty entry here means some protocol can have its symbol GUESSED from its
      // slug. That is the regression this guards: it is how BTCUSD/USOIL/DOGEUSD/CHN50
      // went stale, and how 20 protocols ended up with no declared relationship at all.
      expect(SINGLE_SYMBOL_HINTS).toEqual([]);
    });

    it('WATCHLIST_HINTS has no entries', () => {
      expect(WATCHLIST_HINTS).toEqual([]);
    });

    it('exposes no derivable targets at all', () => {
      expect(allDerivedSymbolTargets()).toEqual([]);
    });
  });

  describe('deriveSingleSymbolFromSlug never guesses', () => {
    it('returns null for slugs that used to be hint-matched', () => {
      // Every one of these resolved to a symbol before #764. They must now return null so
      // the protocol reaches the loud unwired-warning instead of a plausible value.
      for (const slug of [
        'btc-halving-cycle', 'eth-speed-v1', 'sol-momentum-v1', 'doge-speed-v1',
        'oil-macro-v1', 'china-speed-v1', 'gold-macro-v1', 'xau-speed-m5',
        'spy-day-v1', 'qqq-day-v1', 'vix-spike-v1', 'tsla-speed-v1',
      ]) {
        expect(deriveSingleSymbolFromSlug(slug)).toBeNull();
      }
    });

    it('returns null for a slug matching no hint', () => {
      expect(deriveSingleSymbolFromSlug('forex-session-v1')).toBeNull();
    });
  });

  describe('the unwired diagnostic survives the empty tables', () => {
    it('protocol-db still warns and names the fix when it cannot resolve a protocol', () => {
      const src = stripComments(readSource('src/modules/scoring/protocol-db.service.ts'));

      // Emptying the tables must NOT delete the warning — that warning is the only thing
      // telling an operator their protocol is unwired. A silent empty set would be the
      // original bug wearing a different hat.
      expect(src).toMatch(/NO assignment and NO linked watchlist/);
      expect(src).toMatch(/GUESSED from its name/);

      // And it must tell them the actual fix.
      expect(src).toMatch(/watchlist\.protocolId/);
    });

    it('resolveSymbols still prefers an assignment and a linked watchlist', () => {
      const src = stripComments(readSource('src/modules/scoring/protocol-db.service.ts'));
      expect(src).toMatch(/symbolProtocolAssignment\.findMany/);
      expect(src).toMatch(/protocolId IN\s*\(/);
    });
  });
});
