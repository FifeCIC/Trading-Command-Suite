/**
 * bullish-directives-current.spec.ts — THE HARDCODED LIST MUST MATCH THE CLASSES, AND THE FIRST
 * VERSION OF THIS GUARD DID NOT.
 *
 * ── THE DEFECT (measured 2026-11-19) ──────────────────────────────────────────────────────────────
 * `protocols-seed-data.ts` carries `BULLISH_DIRECTIVES`, hardcoded, "measured 2026-11-02 from the
 * compiled classes". By 2026-11-19 **four of its eleven entries had become direction-NEUTRAL** in
 * their own classes:
 *
 *     earnings-proximity · momentum-exhaustion · panic-exhaustion-absorption · target-achieved
 *
 * The short-leg generator DROPS anything it believes is bullish, so every derived short protocol was
 * losing four directives it is entitled to keep — including `panic-exhaustion-absorption` (the
 * capitulation read) and `earnings-proximity` (which is why `momentum-stock-v1-short` had **no
 * earnings directive at all**).
 *
 * ⚠️ **NO GUARD COULD HAVE FAILED.** `validate-protocol-directions.cjs` checks the opposite direction:
 * a *bullish* id inside a SHORT_ONLY protocol is a red build. A *stale* entry merely over-drops —
 * silently, and in the direction that looks healthy.
 *
 * ── 🛑 AND THE FIRST VERSION OF THIS SPEC WAS A DECORATION ───────────────────────────────────────
 * It compared the two legs of each shipped pair to recover which ids the generator dropped. Then the
 * canary — re-adding `panic-exhaustion-absorption` to the set — **still passed 8/8**, because **no
 * shipped long leg carries that directive**, so it never appeared in the `dropped` set and the
 * assertion was trivially true. A guard that cannot fail is not a guard.
 *
 * ⇒ So this reads the CLASSES from disk, statically: every id the set calls bullish must have
 * `directionBias = 'bullish'` in its own source. A missing `directionBias` means neutral, which is
 * exactly the state the four stale entries were in.
 */
import * as fs from 'fs';
import * as path from 'path';
import { BULLISH_DIRECTIVES, PROTOCOL_SEED_DATA } from '../scoring/protocols-seed-data';

const IMPL_DIR = path.join(__dirname, 'implementations');

/** id → declared `directionBias` (absent = neutral), read from the directive sources. */
function directionBiasById(): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith('.ts') || entry.name.includes('.spec.')) continue;
      const src = fs.readFileSync(full, 'utf8');
      const idMatch = src.match(/id\s*[=:]\s*'([^']+)'/);
      if (!idMatch) continue;
      const biasMatch = src.match(/directionBias\s*=\s*'([a-z]+)'/);
      out.set(idMatch[1], biasMatch ? biasMatch[1] : 'neutral');
    }
  };
  walk(IMPL_DIR);
  return out;
}

describe('BULLISH_DIRECTIVES must match the directive classes', () => {
  const bias = directionBiasById();

  it('reads the directive sources at all (a guard with no input must fail, not pass)', () => {
    // ⚠️ THE INPUT ASSERTION. If the path or the regex breaks, every assertion below would pass
    // vacuously — which is precisely how the first version of this spec became a decoration.
    expect(bias.size).toBeGreaterThan(50);
  });

  it('⚠️ every id the seed calls BULLISH really is bullish in its own class', () => {
    const wrong: string[] = [];
    for (const id of BULLISH_DIRECTIVES) {
      const declared = bias.get(id);
      if (declared !== 'bullish') wrong.push(`${id}: class says '${declared ?? 'NOT FOUND'}'`);
    }
    expect(wrong).toEqual([]);
  });

  it('⚠️ KEEPS the four that were stale — the regression itself', () => {
    for (const id of [
      'panic-exhaustion-absorption',
      'earnings-proximity',
      'momentum-exhaustion',
      'target-achieved',
    ]) {
      expect(BULLISH_DIRECTIVES.has(id)).toBe(false);
      // …and the class agrees they are neutral, so the pair cannot drift back.
      expect(bias.get(id)).toBe('neutral');
    }
  });

  it('still names the directives whose classes really are bullish', () => {
    for (const id of ['ema-structure', 'rsi-oversold', 'volume-surge', 'momentum-continuation-combo']) {
      expect(BULLISH_DIRECTIVES.has(id)).toBe(true);
      expect(bias.get(id)).toBe('bullish');
    }
  });
});

describe('the movers pair exists and is a real pair', () => {
  it('has both legs, derived from one declaration', () => {
    expect(PROTOCOL_SEED_DATA['movers-v1-long']).toBeDefined();
    expect(PROTOCOL_SEED_DATA['movers-v1-short']).toBeDefined();
    expect(PROTOCOL_SEED_DATA['movers-v1-long'].directionMode).toBe('LONG_ONLY');
    expect(PROTOCOL_SEED_DATA['movers-v1-short'].directionMode).toBe('SHORT_ONLY');
  });

  it('⚠️ a SHORT_ONLY protocol contains no bullish directive', () => {
    const ids = PROTOCOL_SEED_DATA['movers-v1-short'].groups.flatMap((g) => g.directiveIds);
    for (const bullish of BULLISH_DIRECTIVES) {
      expect(ids).not.toContain(bullish);
    }
  });

  it('keeps the short leg non-empty and gated — a derived leg that scores nothing is silent', () => {
    const short = PROTOCOL_SEED_DATA['movers-v1-short'];
    expect(short.groups.flatMap((g) => g.directiveIds).length).toBeGreaterThan(3);
    expect(short.groups.some((g) => g.isRiskGate)).toBe(true);
  });

  it('keeps the formerly-dropped directives in the derived short leg', () => {
    const longIds = PROTOCOL_SEED_DATA['movers-v1-long'].groups.flatMap((g) => g.directiveIds);
    const shortIds = PROTOCOL_SEED_DATA['movers-v1-short'].groups.flatMap((g) => g.directiveIds);
    for (const id of ['panic-exhaustion-absorption', 'earnings-proximity', 'momentum-exhaustion', 'target-achieved']) {
      if (longIds.includes(id)) expect(shortIds).toContain(id);
    }
  });
});
