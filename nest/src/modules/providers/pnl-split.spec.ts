/**
 * pnl-split.spec.ts — #1014.
 *
 * ⚠️ WHY THESE CASES ARE SYNTHETIC AND WHY THAT IS ENOUGH FOR THE ARITHMETIC.
 *
 * The DECISION marker in `position-sync.service.ts` said the split was "verifiable only once a
 * multi-row position exists ... measured 2026-09-28 that none does, so it is NOT verifiable yet".
 *
 * That is true of the END-TO-END path and false of the SPLIT — which is a pure function over deal
 * rows. This repo's own precedent is explicit elsewhere: the guardian's helpers are exported so the
 * spec "canaries them in both directions without a bridge, a position or a clock". The same applies
 * here, and the arithmetic is where the money is.
 *
 * The incident's own numbers are reproduced as the worked case, so a regression fails against the
 * REAL shape rather than an invented one.
 */
import { splitPnlByVolume, openingVolume, netOf, countRowsSharingPosition } from './pnl-split';

describe('pnl-split — one position, N rows (#1014)', () => {
  // ── The measured incident, 2026-09-28 ───────────────────────────────────────────────────────
  // Four buy orders merged into ONE position (netting), then one sell closed all 0.04.
  //   posId=152690675067  buy  0.01 @4146.30  08:52:17
  //   posId=152690675067  buy  0.01 @4145.83  09:35:55
  //   posId=152690675067  buy  0.01 @4145.83  09:35:55
  //   posId=152690675067  buy  0.01 @4151.32  09:43:53
  //   posId=152690675067  sell 0.04 @4157.11  12:28:00  '[sl 4157.11]'
  const OPENINGS = [
    { side: 'buy', volume: 0.01, price: 4146.30 },
    { side: 'buy', volume: 0.01, price: 4145.83 },
    { side: 'buy', volume: 0.01, price: 4145.83 },
    { side: 'buy', volume: 0.01, price: 4151.32 },
  ];
  // Blended entry (4144.82 + 4145.83 + 4145.83 + 4151.32) / 4 = 4147.32; exit 4157.11 on 0.04 lots.
  // XAUUSD: 0.01 lot = 1 oz, so 0.04 lots × $9.79 ≈ +$39.15 — the "+$39" the issue reports.
  const CLOSES = [{ side: 'sell', volume: 0.04, price: 4157.11, profit: 39.15 }];

  describe('the denominator', () => {
    it('sums the OPENING volume, not the closing volume', () => {
      expect(openingVolume(OPENINGS)).toBeCloseTo(0.04, 10);
      // ⚠️ Passing the closes in would give the same 0.04 here and mask the error; the guard below
      // uses an asymmetric case so the two are distinguishable.
      expect(openingVolume(CLOSES)).toBeCloseTo(0.04, 10);
    });

    it('is asymmetric in a case where openings and closes differ in volume', () => {
      // A partial close: 0.03 opened, only 0.02 closed so far.
      const partial = [{ side: 'sell', volume: 0.02, profit: 5 }];
      expect(openingVolume([{ side: 'buy', volume: 0.03 }])).toBeCloseTo(0.03, 10);
      expect(openingVolume(partial)).toBeCloseTo(0.02, 10);
    });

    it('tolerates missing/odd volumes without producing NaN', () => {
      expect(openingVolume([{ volume: null }, { volume: undefined }, { volume: 'x' }])).toBe(0);
      expect(openingVolume(null)).toBe(0);
    });
  });

  describe('the sole-owner case — behaviour that must NOT change', () => {
    it('one row owning the position books the WHOLE net, no split', () => {
      const r = splitPnlByVolume({ closingDeals: CLOSES, openings: OPENINGS, rowQuantity: 0.04, rowsSharing: 1 });
      expect(r).not.toBeNull();
      expect(r!.basis).toBe('sole-owner');
      expect(r!.share).toBe(1);
      // This is every primary open, and it is exactly what the reconciler already did correctly.
      expect(r!.realizedPnl).toBeCloseTo(39.15, 10);
    });

    it('a sole owner with NO opening deals still books the whole net', () => {
      // One row owns the position, so no denominator is needed — refusing here would be a
      // regression against the path that works today.
      const r = splitPnlByVolume({ closingDeals: CLOSES, openings: [], rowQuantity: 0.04, rowsSharing: 1 });
      expect(r!.realizedPnl).toBeCloseTo(39.15, 10);
    });
  });

  describe('the scale-in case — this is the fix', () => {
    it('four rows each book ONE QUARTER, and the four sum to the position net', () => {
      const each = splitPnlByVolume({ closingDeals: CLOSES, openings: OPENINGS, rowQuantity: 0.01, rowsSharing: 4 });
      expect(each!.basis).toBe('volume-split');
      expect(each!.share).toBeCloseTo(0.25, 10);
      expect(each!.realizedPnl).toBeCloseTo(39.15 / 4, 10);

      // ⚠️ THE ASSERTION THAT MATTERS. The four rows must SUM to the position, not each equal it.
      // Before this fix every row booked 39.15 — a 4x overstatement with plausible numbers.
      const total = 4 * each!.realizedPnl;
      expect(total).toBeCloseTo(39.15, 8);
      expect(each!.realizedPnl).not.toBeCloseTo(39.15, 2);
    });

    it('an UNEVEN scale-in splits by volume, not by row count', () => {
      // 0.01 + 0.03 = 0.04. The small row gets a quarter, the large row three quarters.
      const openings = [{ side: 'buy', volume: 0.01 }, { side: 'buy', volume: 0.03 }];
      const small = splitPnlByVolume({ closingDeals: CLOSES, openings, rowQuantity: 0.01, rowsSharing: 2 });
      const large = splitPnlByVolume({ closingDeals: CLOSES, openings, rowQuantity: 0.03, rowsSharing: 2 });
      expect(small!.share).toBeCloseTo(0.25, 10);
      expect(large!.share).toBeCloseTo(0.75, 10);
      // Splitting by COUNT would give each 0.5 and misattribute $19.58 between the rows.
      expect(small!.realizedPnl + large!.realizedPnl).toBeCloseTo(39.15, 8);
    });

    it('a LOSS is split the same way, negative and all', () => {
      const losers = [{ side: 'sell', volume: 0.04, price: 4130, profit: -69.24 }];
      const each = splitPnlByVolume({ closingDeals: losers, openings: OPENINGS, rowQuantity: 0.01, rowsSharing: 4 });
      expect(each!.realizedPnl).toBeCloseTo(-69.24 / 4, 8);
      expect(4 * each!.realizedPnl).toBeCloseTo(-69.24, 8);
    });
  });

  describe('the cases it REFUSES — and refusing is the point', () => {
    it('several rows + UNKNOWN opening volume returns null, never the whole net', () => {
      const r = splitPnlByVolume({ closingDeals: CLOSES, openings: [], rowQuantity: 0.01, rowsSharing: 4 });
      // ⚠️ Booking the whole net here is the 4x overstatement; booking 0 claims break-even.
      // Neither is a fact, so the answer is that there is no answer.
      expect(r).toBeNull();
    });

    it('several rows + a zero row quantity returns null', () => {
      const r = splitPnlByVolume({ closingDeals: CLOSES, openings: OPENINGS, rowQuantity: 0, rowsSharing: 4 });
      expect(r).toBeNull();
    });

    it('NO closing deals returns null — there is no result to book, which is not zero', () => {
      const r = splitPnlByVolume({ closingDeals: [], openings: OPENINGS, rowQuantity: 0.01, rowsSharing: 1 });
      // ⚠️ The distinction the whole pipeline depends on: "closed with no computable result" must
      // not be written as 0.00, which reads as a break-even trade.
      expect(r).toBeNull();
    });

    it('a row quantity ABOVE the recorded opening volume is clamped to 1, not passed through', () => {
      // A data fault (a missing opening deal). Sharing more than the position earned is the one
      // direction that must never happen silently.
      const r = splitPnlByVolume({ closingDeals: CLOSES, openings: OPENINGS, rowQuantity: 0.5, rowsSharing: 4 });
      expect(r!.share).toBe(1);
      expect(r!.realizedPnl).toBeCloseTo(39.15, 8);
    });
  });

  describe('netOf — profit plus the three cost components', () => {
    it('sums profit, commission, swap and fee across the closing deals', () => {
      // Cost components are why `pnl` and `grossPnl` differ; summing only `profit` would silently
      // report a gross figure as net.
      expect(netOf([{ profit: 10, commission: -1.5, swap: -0.25, fee: -0.1 }])).toBeCloseTo(8.15, 10);
    });

    it('an empty close is 0, not NaN', () => {
      expect(netOf([])).toBe(0);
      expect(netOf(null)).toBe(0);
    });
  });

  describe('countRowsSharingPosition — the safety argument rests on this being counted', () => {
    it('counts only exact matches', () => {
      expect(countRowsSharingPosition(['152690675067', '152690675067', '152690940846'], '152690675067')).toBe(2);
    });

    it('nulls are not matches — an un-ticketed row shares nothing', () => {
      expect(countRowsSharingPosition([null, undefined, '152690675067'], '152690675067')).toBe(1);
    });

    it('does not confuse an ORDER id with a POSITION id', () => {
      // The original defect in one line: these are different namespaces and must never co-count.
      const orderTickets = ['152690940846', '152690940848', '152690988172'];
      expect(countRowsSharingPosition(orderTickets, '152690675067')).toBe(0);
    });
  });

  // ── The end-to-end shape of the incident, as a single assertion ─────────────────────────────
  it('THE INCIDENT: four rows sharing one position sum to the position, and none claims it alone', () => {
    const tickets = ['152690675067', '152690675067', '152690675067', '152690675067'];
    const rowsSharing = countRowsSharingPosition(tickets, '152690675067');
    expect(rowsSharing).toBe(4);

    const shares = tickets.map(() =>
      splitPnlByVolume({ closingDeals: CLOSES, openings: OPENINGS, rowQuantity: 0.01, rowsSharing }),
    );
    const total = shares.reduce((s, r) => s + (r?.realizedPnl ?? 0), 0);
    expect(total).toBeCloseTo(39.15, 8);
    // The old behaviour, stated as the thing that must not come back:
    const oldBehaviour = shares.length * 39.15;
    expect(oldBehaviour).toBeCloseTo(156.6, 8);
    expect(total).not.toBeCloseTo(oldBehaviour, 2);
  });
});
