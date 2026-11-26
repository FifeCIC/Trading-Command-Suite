import { BACKTEST_WINDOW_SIZE } from './backtest.service';
import { buildSelectionPreview, type BuildPreviewInput } from './selection-preview';

/**
 * The pre-run coverage summary.
 *
 * ⚠️ THE BOUNDARY CASES CARRY THE TEST (measured 2026-11-25): `SFWL` holds 42, 51 and 59 bars in
 * three stored day-lists against a floor of 100, and the engine REFUSES such a symbol rather than
 * trading zero. A preview that rounded, or that judged the floor on the ranking's publisher, would
 * report those days clean and the run would then error — so 99-vs-100 is asserted explicitly, and
 * the floor is read from the constant the engine throws on.
 */

const base: BuildPreviewInput = {
  datasetName: 'movers-winners-2026-11-11',
  protocolId: 'movers-v1-long',
  answerDate: '2026-11-11',
  side: 'winners',
  sideSource: 'protocol',
  timeframe: '5m',
  topN: 3,
  cutoffUtc: '15:30',
  candidates: ['AAA', 'BBB', 'CCC'],
  selected: ['AAA', 'BBB'],
  rankingProvider: { provider: 'yahoo', available: ['yahoo'], ambiguous: false, note: null },
  cutoffBarsBySymbol: { AAA: 12, BBB: 9, CCC: 7 },
  windowBarsBySymbol: {
    AAA: { bars: 200, provider: 'yahoo' },
    BBB: { bars: 180, provider: 'yahoo' },
    CCC: { bars: 160, provider: 'yahoo' },
  },
};

const build = (over: Partial<BuildPreviewInput> = {}) => buildSelectionPreview({ ...base, ...over });

describe('buildSelectionPreview', () => {
  it('reports a clean day as ready, with no notes', () => {
    const p = build();
    expect(p.status).toBe('ready');
    expect(p.notes).toEqual([]);
    expect(p.candidates).toBe(3);
    expect(p.usable).toBe(3);
    expect(p.selected).toBe(2);
    expect(p.barFloor).toBe(BACKTEST_WINDOW_SIZE);
  });

  it('treats the floor as INCLUSIVE: 100 bars clears it, 99 does not', () => {
    const atFloor = build({
      windowBarsBySymbol: { ...base.windowBarsBySymbol, CCC: { bars: BACKTEST_WINDOW_SIZE, provider: 'yahoo' } },
    });
    expect(atFloor.symbols.find((s) => s.symbol === 'CCC')?.clearsFloor).toBe(true);

    const under = build({
      windowBarsBySymbol: { ...base.windowBarsBySymbol, CCC: { bars: BACKTEST_WINDOW_SIZE - 1, provider: 'yahoo' } },
    });
    const ccc = under.symbols.find((s) => s.symbol === 'CCC');
    expect(ccc?.clearsFloor).toBe(false);
    expect(under.usable).toBe(2);
    expect(under.status).toBe('thin');
    // The note states the SYMBOL and its count, so the reader can act without opening anything.
    expect(under.notes[0]).toContain('CCC');
    expect(under.notes[0]).toContain(String(BACKTEST_WINDOW_SIZE - 1));
  });

  it('names a candidate the ranking cannot see, and does not count it as usable', () => {
    const p = build({ cutoffBarsBySymbol: { AAA: 12, BBB: 9, CCC: 0 } });
    expect(p.symbols.find((s) => s.symbol === 'CCC')?.visibleToRanking).toBe(false);
    expect(p.usable).toBe(2);
    expect(p.notes.join(' ')).toContain('yahoo');
    expect(p.notes.join(' ')).toContain('CCC');
  });

  it('reports a thin ranking basis from the SELECTED symbols only', () => {
    // A quiet unselected candidate must not make the ranking look thin.
    const p = build({ cutoffBarsBySymbol: { AAA: 1, BBB: 6, CCC: 0 } });
    expect(p.rankBasisBars).toBe(1);
    expect(p.notes.some((n) => n.includes('rests on 1 bar'))).toBe(true);
  });

  it('warns when topN exceeds the number of candidates', () => {
    const p = build({ topN: 5 });
    expect(p.status).toBe('thin');
    expect(p.notes.some((n) => n.includes('list holds fewer names'))).toBe(true);
  });

  it('is blocked when nothing can be ranked and run, and names both causes', () => {
    const p = build({
      cutoffBarsBySymbol: { AAA: 0, BBB: 0, CCC: 0 },
      windowBarsBySymbol: {
        AAA: { bars: 0, provider: null },
        BBB: { bars: 0, provider: null },
        CCC: { bars: 0, provider: null },
      },
    });
    expect(p.usable).toBe(0);
    expect(p.status).toBe('blocked');
    expect(p.notes).toHaveLength(2);
  });

  it('never returns the selected names, only their count', () => {
    const p = build();
    expect(JSON.stringify(p)).not.toContain('"selected":["');
    expect(p.selected).toBe(2);
  });
});
