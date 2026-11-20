/**
 * movers-dataset.spec.ts — pins the rule that a movers dataset describes exactly ONE day, and that
 * the side it ranks for can never disagree silently with the protocol being measured.
 *
 * ⚠️ THE CASES BELOW ARE THE MEASURED FAILURE, NOT HYPOTHETICALS. Before this module existed the
 * selection page ranked `movers-losers-2026-11-10` on all five warm-up sessions as well as the answer
 * day, and decided the side from the dataset name with no cross-check against the protocol.
 */
import { parseMoversDatasetName, resolveMoversSide } from './movers-dataset';

describe('parseMoversDatasetName', () => {
  it('reads the day and the side from a losers list', () => {
    expect(parseMoversDatasetName('movers-losers-2026-11-10')).toEqual({
      value: { name: 'movers-losers-2026-11-10', answerDate: '2026-11-10', side: 'losers' },
      reason: null,
    });
  });

  it('reads the day and the side from a winners list', () => {
    expect(parseMoversDatasetName('movers-winners-2026-11-11')).toEqual({
      value: { name: 'movers-winners-2026-11-11', answerDate: '2026-11-11', side: 'winners' },
      reason: null,
    });
  });

  it('trims surrounding whitespace rather than refusing a padded name', () => {
    expect(parseMoversDatasetName('  movers-winners-2026-11-11 ').value?.answerDate).toBe('2026-11-11');
  });

  it.each([
    ['dev-window-v1', /does not name a movers day/],
    ['movers-losers-2026-11', /does not name a movers day/],
    ['movers-losers-2026-11-10-extra', /does not name a movers day/],
    ['movers-loser-2026-11-10', /does not name a movers day/],
    ['', /no name/],
  ])('refuses %p and says why', (name, reason) => {
    const result = parseMoversDatasetName(name);
    expect(result.value).toBeNull();
    expect(result.reason).toMatch(reason);
  });

  it('refuses a day that is not on the calendar, because Date would roll it forward silently', () => {
    const feb30 = parseMoversDatasetName('movers-losers-2026-02-30');
    expect(feb30.value).toBeNull();
    expect(feb30.reason).toMatch(/not a real date/);

    expect(parseMoversDatasetName('movers-winners-2026-13-01').value).toBeNull();
  });

  it('accepts a leap day', () => {
    expect(parseMoversDatasetName('movers-winners-2028-02-29').value?.answerDate).toBe('2028-02-29');
  });
});

describe('resolveMoversSide', () => {
  it('takes the protocol direction when nothing is explicit', () => {
    expect(resolveMoversSide({ protocolDirection: 'LONG_ONLY', datasetSide: 'winners' })).toEqual({
      side: 'winners',
      source: 'protocol',
    });
    expect(resolveMoversSide({ protocolDirection: 'SHORT_ONLY', datasetSide: 'losers' })).toEqual({
      side: 'losers',
      source: 'protocol',
    });
  });

  it('accepts the lowercase form the database can hold', () => {
    expect(resolveMoversSide({ protocolDirection: 'short', datasetSide: 'losers' })).toEqual({
      side: 'losers',
      source: 'protocol',
    });
  });

  it('REFUSES a long leg measured on a losers list instead of picking a side', () => {
    const r = resolveMoversSide({ protocolDirection: 'LONG_ONLY', datasetSide: 'losers' });
    expect(r.side).toBeNull();
    expect(r.source).toBe('protocol');
    expect(r.conflict).toMatch(/trades the winners side/);
  });

  it('refuses an explicit side that disagrees with the list', () => {
    const r = resolveMoversSide({ explicit: 'winners', datasetSide: 'losers' });
    expect(r.side).toBeNull();
    expect(r.conflict).toMatch(/asks for the 'winners' side/);
  });

  /**
   * The request body is JSON with no runtime enum check, so `side` reaches here as an arbitrary
   * string. `'long'` is the natural mistake — the sides ARE long/short trades — and before this case
   * existed it produced *"the dataset is a losers list"*, blaming the dataset for a bad request field.
   */
  it('names an invalid side as invalid, instead of blaming the dataset', () => {
    const r = resolveMoversSide({ explicit: 'long' as never, datasetSide: 'losers' });
    expect(r.side).toBeNull();
    expect(r.conflict).toMatch(/'long' is not a side this run can rank/);
    expect(r.conflict).not.toMatch(/dataset is a/);
  });

  it('lets an agreement through', () => {
    expect(resolveMoversSide({ explicit: 'losers', datasetSide: 'losers' })).toEqual({
      side: 'losers',
      source: 'explicit',
    });
  });

  it('falls back to the dataset name, and SAYS the side was inferred', () => {
    expect(resolveMoversSide({ protocolDirection: null, datasetSide: 'winners' })).toEqual({
      side: 'winners',
      source: 'dataset-name',
    });
  });

  it('does not invent a side from a BOTH protocol', () => {
    // `both` is refused on the run path, so mapping it to a movers side here would hide that refusal.
    expect(resolveMoversSide({ protocolDirection: 'BOTH', datasetSide: 'losers' })).toEqual({
      side: 'losers',
      source: 'dataset-name',
    });
  });
});
