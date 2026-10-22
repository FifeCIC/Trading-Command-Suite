/**
 * Canary for `signal-threshold-basis.ts` (#1131).
 *
 * ⚠️ A guard that has never been observed to fail is a decoration. Each case names the WRONG
 * behaviour it catches. The two that matter most:
 *   • `demonstrates the redistribution` — fails if the calibrated bar is replaced by the incumbent
 *     carried across unchanged (the 19% loosening), or if conversion is inverted/identity.
 *   • `cannot judge returns the incumbent` — fails if an unknown earn-able denominator silently
 *     becomes a zero bar, which would label every tick STRONG.
 */
import {
  THRESHOLD_BASIS,
  EARN_ABLE_BAR,
  convertThresholds,
  thresholdsForBasis,
  classifyBothBases,
} from './signal-threshold-basis';

const XAU = { configured: 910, earnable: 630, entry: 6, strong: 13 };
const CLEAN = { configured: 725, earnable: 725, entry: 6, strong: 13 };

describe('signal-threshold-basis', () => {
  it('the incumbent basis is the one in use — flipping it is a maths change, not a fix', () => {
    expect(THRESHOLD_BASIS).toBe('configured');
  });

  it('configured basis returns the live constants untouched', () => {
    expect(thresholdsForBasis('configured', XAU)).toEqual({ entry: 6, strong: 13, converted: false });
  });

  it('converts the EAR-ABLE bar by the earn-able share', () => {
    const conv = convertThresholds(XAU);
    expect(conv.converted).toBe(true);
    expect(conv.entry).toBeCloseTo(EARN_ABLE_BAR.entry * (630 / 910), 6);   // 5.19
    expect(conv.strong).toBeCloseTo(EARN_ABLE_BAR.strong * (630 / 910), 6); // 13.85
  });

  it('a raw worth exactly 20% of earn-able capacity lands exactly on the converted STRONG bar', () => {
    // The invariant: 20% of EARN-ABLE means the same conviction in every protocol.
    for (const p of [XAU, { configured: 480, earnable: 200, entry: 6, strong: 13 }, CLEAN]) {
      const conv = convertThresholds(p);
      const pctConfigured = ((EARN_ABLE_BAR.strong / 100) * p.earnable / p.configured) * 100;
      expect(pctConfigured).toBeCloseTo(conv.strong, 6);
    }
  });

  it('demonstrates the redistribution — a dirty protocol loosens entry and tightens strong', () => {
    // XAU: converted entry 5.19 (below the live 6 → looser), converted strong 13.85 (above 13 → tighter).
    // This is what "corrected basis + preserved frequency" looks like, and it is NOT what you get by
    // carrying 6/13 across unchanged.
    const conv = convertThresholds(XAU);
    expect(conv.entry).toBeLessThan(XAU.entry);
    expect(conv.strong).toBeGreaterThan(XAU.strong);

    // raw 50 of 910 = 5.49% → dead under the incumbent, an entry signal under the calibrated bar.
    expect(classifyBothBases(50, 'bullish', XAU).configured.label).toBe('HOLD');
    expect(classifyBothBases(50, 'bullish', XAU).earnable.label).toBe('BUY');

    // raw 120 of 910 = 13.19% → STRONG under the incumbent, only an entry signal under the calibrated bar.
    expect(classifyBothBases(120, 'bullish', XAU).configured.label).toBe('STRONG_BUY');
    expect(classifyBothBases(120, 'bullish', XAU).earnable.label).toBe('BUY');
  });

  it('a fully-earnable protocol gets a STRICTER bar, not an unchanged one', () => {
    // The calibration preserves total frequency, so a protocol with nothing unearnable must give
    // something up. Fails if the conversion is skipped when earnable == configured.
    expect(convertThresholds(CLEAN).strong).toBeCloseTo(EARN_ABLE_BAR.strong, 6);
    expect(convertThresholds(CLEAN).strong).toBeGreaterThan(CLEAN.strong);
  });

  it('cannot judge → returns the incumbent, never a zero bar', () => {
    for (const input of [
      { configured: 910, earnable: 0, entry: 6, strong: 13 },
      { configured: 0, earnable: 0, entry: 6, strong: 13 },
      { configured: 100, earnable: 120, entry: 6, strong: 13 },
    ]) {
      expect(convertThresholds(input)).toEqual({ entry: 6, strong: 13, converted: false });
    }
  });

  it('no reading is HOLD on BOTH bases, however large the raw', () => {
    const both = classifyBothBases(500, 'none', XAU);
    expect(both.configured.label).toBe('HOLD');
    expect(both.earnable.label).toBe('HOLD');
  });

  it('reports both percentages so a reader can check them against the stored denominators', () => {
    const split = classifyBothBases(63, 'bullish', { configured: 1260, earnable: 630, entry: 6, strong: 13 });
    expect(split.pctConfigured).toBeCloseTo(5, 6);
    expect(split.pctEarnable).toBeCloseTo(10, 6);
  });

  it('the swap and the bar-scale are the SAME condition (documented identity, not an alternative)', () => {
    // `raw/earnable >= 13` and `raw/configured >= 13*earnable/configured` must agree on every sample.
    // This pins the fact that an earlier version of this module got wrong.
    const bar = 13;
    for (const raw of [0, 10, 45.5, 62, 100, 118.3, 500]) {
      const bySwap = (raw / XAU.earnable) * 100 >= bar;
      const byBar = (raw / XAU.configured) * 100 >= (bar * XAU.earnable) / XAU.configured;
      expect(byBar).toBe(bySwap);
    }
  });
});
