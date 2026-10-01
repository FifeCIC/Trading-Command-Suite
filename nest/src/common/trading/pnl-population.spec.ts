/**
 * pnl-population.spec.ts — the classification that decides what a closed trade IS (#1044).
 *
 * ⚠️ WHY THESE CASES
 * Every case below is a REAL row shape measured on the live database on 2026-10-01, not an
 * invented fixture. The defect being guarded is that two consumers of the same table disagreed
 * about its size (264 rows vs 243) and neither reported an error.
 */
import {
  classifyPnlRow,
  isRealisedResult,
  isUnflaggedPhantom,
  placeholderZeroReason,
  summarisePopulations,
  realisedPnlWhere,
  REALISED_PNL_SQL,
  NON_RESULT_PNL_SQL,
} from './pnl-population';

describe('classifyPnlRow — the four populations', () => {
  it('an open trade is not a result', () => {
    expect(classifyPnlRow({ closedAt: null, exitPrice: null, pnl: 0, pnlInvalid: 0 })).toBe('open');
  });

  it('a missing exit price with a REAL value is realised — the value decides, not the input', () => {
    expect(classifyPnlRow({ closedAt: 'x', exitPrice: null, pnl: -234.52, pnlInvalid: 0 })).toBe('realised');
  });

  it('exit price present + not flagged is REALISED', () => {
    expect(classifyPnlRow({ closedAt: '2026-09-01', exitPrice: 1.16, pnl: 42.5, pnlInvalid: 0 })).toBe('realised');
  });

  it('a genuine break-even (pnl = 0 WITH an exit price) is REALISED, not discarded', () => {
    // The whole point of splitting on structure rather than on the value: a priced scratch is
    // a real outcome and must survive. Treating `0` as "no result" would hide real trades.
    expect(classifyPnlRow({ closedAt: '2026-09-01', exitPrice: 1.16, pnl: 0, pnlInvalid: 0 })).toBe('realised');
  });

  it('a row flagged pnlInvalid is QUARANTINED even when pnl looks real', () => {
    // The flag is a human declaration and OUTRANKS the data — a flagged row with a populated
    // pnl is exactly the contradiction #1044 was filed for.
    expect(classifyPnlRow({ closedAt: '2026-09-01', exitPrice: 1.16, pnl: 99.9, pnlInvalid: 1 })).toBe('quarantined');
  });

  it('closed, no exit price, NOT flagged is EXIT-UNKNOWN — the 21-row gap', () => {
    // Measured 2026-10-01: structurally identical to the 113 quarantined rows; only the flag is
    // missing. A `pnlInvalid`-only filter accepts these and books 21 fabricated zeros.
    // ⚠️ The zero is what makes it a phantom — a NON-zero value here is a real number.
    expect(classifyPnlRow({ closedAt: '2026-09-30', exitPrice: null, pnl: 0, pnlInvalid: 0 })).toBe('exit-unknown');
  });

  it('treats a boolean pnlInvalid=true the same as 1 (Prisma may hand back either)', () => {
    expect(classifyPnlRow({ closedAt: '2026-09-01', exitPrice: 1.16, pnl: 0, pnlInvalid: true })).toBe('quarantined');
  });
});

describe('isRealisedResult — the single question consumers ask', () => {
  it('accepts only the realised population', () => {
    expect(isRealisedResult({ closedAt: 'x', exitPrice: 1, pnl: 5 })).toBe(true);
    expect(isRealisedResult({ closedAt: 'x', exitPrice: null, pnl: 0 })).toBe(false);
    expect(isRealisedResult({ closedAt: null, exitPrice: 1, pnl: 5 })).toBe(false);
  });

  it('does not require a brokerTicket — a real P&L with no ticket is still a result', () => {
    // Measured 2026-10-01: 12 rows carry a real exit price and a real P&L with no ticket.
    // bot-performance.service.ts requires a ticket because it needs attribution; discarding a
    // number that exists is a different, and wrong, decision here.
    expect(isRealisedResult({ closedAt: 'x', exitPrice: 1.16, pnl: -22.36, brokerTicket: null })).toBe(true);
  });

  it('KEEPS a real recovered P&L even when the exit price is missing', () => {
    // The structural fact is applied to the VALUE. Discarding a real number because an input was
    // not captured is a different error from keeping a fabricated one, and it is not this one.
    expect(isRealisedResult({ closedAt: 'x', exitPrice: null, pnl: -234.52 })).toBe(true);
  });
});

describe('placeholderZeroReason — an absence wearing the clothes of a number', () => {
  it('names the flagged case', () => {
    expect(placeholderZeroReason({ closedAt: 'x', exitPrice: null, pnl: 0, pnlInvalid: 1 })).toContain('flagged');
  });

  it('names the UNflagged case — the one nothing currently reports', () => {
    expect(placeholderZeroReason({ closedAt: 'x', exitPrice: null, pnl: 0, pnlInvalid: 0 })).toContain('NOT flagged');
  });

  it('is silent for a genuine result, including a real break-even', () => {
    expect(placeholderZeroReason({ closedAt: 'x', exitPrice: 1.16, pnl: 0 })).toBeNull();
    expect(placeholderZeroReason({ closedAt: 'x', exitPrice: 1.16, pnl: 42 })).toBeNull();
  });

  it('is silent for an open trade — no P&L yet is not a placeholder', () => {
    expect(placeholderZeroReason({ closedAt: null, exitPrice: null, pnl: 0 })).toBeNull();
  });

  it('does not claim a NON-zero value on a row with no exit price is a placeholder — it is a result', () => {
    expect(placeholderZeroReason({ closedAt: 'x', exitPrice: null, pnl: 13.4, pnlInvalid: 0 })).toBeNull();
  });
});

describe('isUnflaggedPhantom — the 21 rows no existing flag catches', () => {
  it('is true only for exit-unknown', () => {
    expect(isUnflaggedPhantom({ closedAt: 'x', exitPrice: null, pnl: 0, pnlInvalid: 0 })).toBe(true);
    expect(isUnflaggedPhantom({ closedAt: 'x', exitPrice: null, pnl: 0, pnlInvalid: 1 })).toBe(false);
    expect(isUnflaggedPhantom({ closedAt: 'x', exitPrice: 1, pnl: 0, pnlInvalid: 0 })).toBe(false);
  });
});

describe('the SQL and the Prisma where agree with the classifier', () => {
  it('realisedPnlWhere carries every constraint on separate keys', () => {
    const w: any = realisedPnlWhere({ symbol: 'XAUUSD' });
    expect(w.symbol).toBe('XAUUSD');
    expect(w.pnlInvalid).toBe(0);
    // ⚠️ closedAt must carry the not-null constraint in the SAME key — written as two separate
    // `closedAt` properties, JavaScript keeps the last and the filter silently disappears.
    expect(w.closedAt).toEqual({ not: null });
    // The structural half, as an OR: an exit price exists, OR a real non-zero value does.
    expect(w.OR).toEqual([{ exitPrice: { not: null } }, { NOT: { pnl: 0 } }]);
  });

  it('the SQL constants name the same predicates', () => {
    for (const frag of ['closedAt IS NOT NULL', 'pnlInvalid = 0', 'exitPrice IS NOT NULL', 'pnl <> 0']) {
      expect(REALISED_PNL_SQL).toContain(frag);
    }
    expect(NON_RESULT_PNL_SQL).toContain('pnlInvalid = 1');
    expect(NON_RESULT_PNL_SQL).toContain('exitPrice IS NULL');
    expect(NON_RESULT_PNL_SQL).toContain('pnl = 0');
  });
});

describe('summarisePopulations', () => {
  it('counts every population, including the empty ones', () => {
    const s = summarisePopulations([
      { closedAt: 'x', exitPrice: 1, pnl: 5 },
      { closedAt: 'x', exitPrice: 1, pnl: 0 },
      { closedAt: 'x', exitPrice: null, pnl: 0, pnlInvalid: 1 },
      { closedAt: 'x', exitPrice: null, pnl: 0, pnlInvalid: 0 },
      { closedAt: null, exitPrice: null, pnl: null },
    ]);
    expect(s).toEqual({ realised: 2, quarantined: 1, 'exit-unknown': 1, open: 1 });
  });

  it('reports zeros rather than omitting a population — an absent key reads as "not counted"', () => {
    expect(summarisePopulations([])).toEqual({ realised: 0, quarantined: 0, 'exit-unknown': 0, open: 0 });
  });
});
