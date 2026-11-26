import { BACKTEST_WINDOW_SIZE, PERIOD_BAR_CAP } from './backtest.service';
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

  it('is blocked when nothing can be ranked and run, and names every cause', () => {
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
    // ⚠️ A COUNT WOULD BE A WEAKER TEST than naming the three causes: it passed at 2 until the third
    // (the engine refusing the picks) was added, and a count tells the next reader nothing about which.
    const joined = p.notes.join(' ');
    expect(joined).toContain('fewer than 100 bars');
    expect(joined).toContain('cannot see them');
    expect(joined).toContain('cannot be run');
  });

  it('never returns the selected names, only their count', () => {
    const p = build();
    expect(JSON.stringify(p)).not.toContain('"selected":["');
    expect(p.selected).toBe(2);
  });

  /**
   * ── COST (2026-11-26) ─────────────────────────────────────────────────────────────────────────
   * The engine scores one bar per `fullScore()` after a 100-bar warm-up, for the PICKED symbols only.
   * Measured live: `movers-losers-2026-11-09` holds a 9,332-bar candidate the ranking did not pick, and
   * the run spent 558 bar-scores. A cost taken over the whole list would be wrong by 29× on that day.
   */
  it('counts bar-scores over the PICKED symbols only, after the warm-up', () => {
    const p = build({
      // A huge candidate that was NOT picked must not appear in the cost.
      windowBarsBySymbol: { ...base.windowBarsBySymbol, CCC: { bars: 9_332, provider: 'yahoo' } },
    });
    // AAA 200−100 + BBB 180−100 = 180; CCC contributes nothing.
    expect(p.cost.scoreEvaluations).toBe(180);
    expect(p.cost.barsLoaded).toBe(380);
    // The whole-list figure carries it separately, which is what the topN decision reads.
    expect(p.cost.ifAllRankable).toBe(180 + (9_332 - BACKTEST_WINDOW_SIZE));
  });

  it('treats a symbol at exactly the warm-up size as zero work, never negative', () => {
    const p = build({
      windowBarsBySymbol: {
        AAA: { bars: BACKTEST_WINDOW_SIZE, provider: 'yahoo' },
        BBB: { bars: BACKTEST_WINDOW_SIZE + 5, provider: 'yahoo' },
        CCC: { bars: 500, provider: 'yahoo' },
      },
    });
    expect(p.cost.scoreEvaluations).toBe(5);
  });

  it('reports the estimate as a band from the measured rate, and names the basis', () => {
    const p = build();
    expect(p.cost.estimatedSeconds.low).toBeCloseTo((180 * 12) / 1000, 1);
    expect(p.cost.estimatedSeconds.high).toBeCloseTo((180 * 30) / 1000, 1);
    expect(p.cost.estimatedSeconds.high).toBeGreaterThan(p.cost.estimatedSeconds.low);
    expect(p.cost.basis).toContain('per bar scored');
  });

  it('excludes an unrankable candidate from the whole-list ceiling', () => {
    const p = build({ cutoffBarsBySymbol: { AAA: 12, BBB: 9, CCC: 0 } });
    // CCC is invisible to the ranking, so raising topN could not pick it.
    expect(p.cost.ifAllRankable).toBe(100 + 80);
  });

  it('flags a candidate that exceeds the period cap, and does not call it usable', () => {
    // Read from the constant the engine throws on, so this cannot drift from the guard.
    const p = build({
      windowBarsBySymbol: { ...base.windowBarsBySymbol, CCC: { bars: PERIOD_BAR_CAP + 1, provider: 'yahoo' } },
    });
    const ccc = p.symbols.find((s) => s.symbol === 'CCC');
    expect(ccc?.exceedsCap).toBe(true);
    expect(p.usable).toBe(2);
    expect(p.notes.join(' ')).toContain('period cap');
    expect(p.barCap).toBe(PERIOD_BAR_CAP);
  });

  /**
   * ── THE PICK THE ENGINE REFUSES (found live 2026-11-26) ──────────────────────────────────────
   * `movers-winners-2026-11-17` with `topN 1` ranks `SFWL` (59 bars) first. The run spends ZERO
   * bar-scores and reports no trades — which reads exactly like "the strategy found nothing". The
   * preview must call that day BLOCKED, not merely thin, or the reader draws the wrong conclusion.
   */
  it('blocks a day whose only pick the engine will refuse, and costs it at zero', () => {
    const p = build({
      selected: ['CCC'],
      windowBarsBySymbol: { ...base.windowBarsBySymbol, CCC: { bars: 59, provider: 'yahoo' } },
    });
    expect(p.cost.unrunnablePicks).toBe(1);
    expect(p.cost.scoreEvaluations).toBe(0);
    expect(p.status).toBe('blocked');
    expect(p.notes.join(' ')).toContain('cannot be run');
    expect(p.notes.join(' ')).toContain('says nothing about the strategy');
  });

  it('is only thin, not blocked, when SOME picks still run', () => {
    const p = build({
      selected: ['AAA', 'CCC'],
      windowBarsBySymbol: { ...base.windowBarsBySymbol, CCC: { bars: 59, provider: 'yahoo' } },
    });
    expect(p.cost.unrunnablePicks).toBe(1);
    expect(p.cost.scoreEvaluations).toBe(100);   // AAA only
    expect(p.status).toBe('thin');
  });

  it('does not charge bar-scores for an over-cap pick the engine refuses', () => {
    const p = build({
      selected: ['AAA', 'CCC'],
      windowBarsBySymbol: { ...base.windowBarsBySymbol, CCC: { bars: PERIOD_BAR_CAP + 500, provider: 'yahoo' } },
    });
    expect(p.cost.unrunnablePicks).toBe(1);
    expect(p.cost.scoreEvaluations).toBe(100);   // the 20k-bar window is never scored
  });
});
