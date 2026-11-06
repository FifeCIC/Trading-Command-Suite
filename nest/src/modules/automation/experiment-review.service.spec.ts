import { diffTradeFields } from './experiment-review.service';

/**
 * diffTradeFields() — the input that decides NO-ARMS for a copied configuration.
 *
 * ⚠️ WHY THIS EXISTS. Two bots that differ in nothing trade identically, so their comparison can
 * never produce a difference however long it runs. Reporting that as "running" is exactly the
 * "strategies that run for months needlessly" the owner named on 2026-11-06. The check has to be
 * narrow in the OTHER direction too: a field that only describes a bot (name, magic, active) must
 * not count as a difference, or every pair looks measurable and the guard never fires.
 */

const base = {
  symbol: 'GER40', timeframe: '5m', slPct: 0.4, tpPct: 0.23, baseSize: 0.1,
  mode: 'auto', minComposite: 10, maxPositions: 1,
  // descriptive / enabling fields that MUST NOT count
  name: 'DAX Small Target Bot', slug: 'dax-small-target-bot', magic: 234189, active: 1,
  description: 'x', version: '1.0.0', createdAt: '2026-11-06T00:00:00Z',
};

describe('diffTradeFields — can these two bots produce a difference at all?', () => {
  it('finds the ONE field a clean A/B changes', () => {
    expect(diffTradeFields(base, { ...base, tpPct: 0.2 })).toEqual(['tpPct']);
  });

  it('returns nothing for two bots that differ only in how they are LABELLED', () => {
    // the NO-ARMS case: same trades, different names
    const renamed = { ...base, name: 'Twin', slug: 'twin', magic: 999, active: 0, description: 'y' };
    expect(diffTradeFields(base, renamed)).toEqual([]);
  });

  it('finds several fields when a "copy" changed more than the one variable under test', () => {
    const messy = { ...base, takeProfitAmount: 5, minComposite: 6, requireDirection: 'long' };
    expect(diffTradeFields(base, messy)).toEqual(['takeProfitAmount', 'minComposite', 'requireDirection']);
  });

  it('treats null and undefined as the SAME (both mean "not set")', () => {
    expect(diffTradeFields({ ...base, maxHoldHours: null }, { ...base, maxHoldHours: undefined })).toEqual([]);
  });

  it('treats 0 and null as DIFFERENT — a real value is not an absent one', () => {
    expect(diffTradeFields({ ...base, takeProfitAmount: null }, { ...base, takeProfitAmount: 0 })).toEqual([
      'takeProfitAmount',
    ]);
  });

  it('compares numbers as values, not as types (0.4 vs "0.4" is the same setting)', () => {
    expect(diffTradeFields({ ...base, slPct: 0.4 }, { ...base, slPct: '0.4' })).toEqual([]);
  });
});
