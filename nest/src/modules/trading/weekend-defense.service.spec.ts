import { WeekendDefenseService, positionExposure } from './weekend-defense.service';

/**
 * weekend-defense — the Friday/Wednesday checklist (#869).
 *
 * ⚠️ THIS SUITE EXISTS BECAUSE THE SERVICE REPORTED EVERY POSITION AS SHORT.
 *
 * The retired expression was:
 *
 *     const direction = pos.type === 0 ? 'BUY' : 'SELL';      // weekend-defense.service.ts:76
 *
 * `pos.type` arrives from the bridge as the STRING `"buy"` (`Mt5Position.type` is
 * `number | 'buy' | 'sell'` — both arms are real). `"buy" === 0` is `false`, so **every long
 * position was reported as SELL**. Measured 2026-09-18 — all three open positions were long and
 * all three were reported short:
 *
 *     ticket 152648715111 EURGBP  bridge "type": "buy"  →  checklist "direction": "SELL"
 *     ticket 152653048611 GBPJPY  bridge "type": "buy"  →  checklist "direction": "SELL"
 *     ticket 152653323088 XAUUSD  bridge "type": "buy"  →  checklist "direction": "SELL"
 *
 * The first test below is those exact rows. It is written against the measured data rather than a
 * shape I invented, because the defect was invisible to anyone reasoning from the interface: the
 * interface said `number`, and the bridge sent a string.
 *
 * ⚠️ `pos.type === 0` is also the same bug class already recorded in this repo — a comparison that
 * silently takes the wrong branch rather than failing. The guard is the DIRECTION, not the branch.
 */

const build = () => {
  const swapCost = { forecastSwap: jest.fn().mockResolvedValue(null) };
  const gapRisk = { projectExposure: jest.fn().mockResolvedValue(null) };
  const svc = new (WeekendDefenseService as any)(swapCost, gapRisk);
  return { svc, swapCost, gapRisk };
};

/** The three rows measured on the live bridge, 2026-09-18. */
const MEASURED = [
  { symbol: 'EURGBP', ticket: 152648715111, side: 'buy' as const, volume: 0.1, openPrice: 0.85982, currentPrice: 0.8621, profit: -24, marketValue: 8621 },
  { symbol: 'GBPJPY', ticket: 152653048611, side: 'buy' as const, volume: 0.01, openPrice: 210.637, currentPrice: 209.7, profit: -4, marketValue: 209700 },
  { symbol: 'XAUUSD', ticket: 152653323088, side: 'buy' as const, volume: 0.01, openPrice: 4300, currentPrice: 4346.06, profit: 12, marketValue: 434606 },
];

describe('weekend-defense (#869)', () => {
  describe('⭐ REGRESSION — direction is read, never compared', () => {
    it('reports the three measured long positions as BUY, not SELL', async () => {
      const { svc } = build();
      const checklist = await svc.buildChecklist(MEASURED as any);

      expect(checklist.positions.map((p) => p.direction)).toEqual(['BUY', 'BUY', 'BUY']);
      // The exact defect: the old ternary returned 'SELL' for every one of these.
      expect(checklist.positions.some((p) => p.direction === 'SELL')).toBe(false);
    });

    it('still handles the numeric MT5 codes the interface documented', async () => {
      const { svc } = build();
      const checklist = await svc.buildChecklist([
        { symbol: 'A', ticket: 1, side: 0, volume: 1, openPrice: 1, currentPrice: 1, profit: 0 },
        { symbol: 'B', ticket: 2, side: 1, volume: 1, openPrice: 1, currentPrice: 1, profit: 0 },
      ] as any);
      // Both arms must work — the bug was assuming only this one existed.
      expect(checklist.positions.map((p) => p.direction)).toEqual(['BUY', 'SELL']);
    });

    it('flags a position whose direction the broker did not state', async () => {
      const { svc } = build();
      const checklist = await svc.buildChecklist([
        { symbol: 'A', ticket: 1, side: null, volume: 1, openPrice: 1, currentPrice: 1, profit: 0 },
      ] as any);

      // `normalizeSide(null)` falls back to 'buy'. That default is the SHARED canonical behaviour,
      // so it is kept — but it is a DEFAULT, not a reading, and the checklist must say so. A swap or
      // gap figure derived from an assumed direction must not read as knowledge.
      expect(checklist.positions[0].direction).toBe('BUY');
      expect(checklist.positions[0].sideKnown).toBe(false);
      expect(checklist.unknownSideCount).toBe(1);
    });

    it('counts no unknown sides when every direction was stated', async () => {
      const { svc } = build();
      const checklist = await svc.buildChecklist(MEASURED as any);
      expect(checklist.unknownSideCount).toBe(0);
      expect(checklist.positions.every((p) => p.sideKnown)).toBe(true);
    });
  });

  describe('exposure is money, or it says it is not', () => {
    it('prefers the broker\'s own marketValue', () => {
      expect(positionExposure({ symbol: 'X', marketValue: 1234.5, volume: 0.1, contractSize: 100000, currentPrice: 1.09 } as any))
        .toEqual({ value: 1234.5, basis: 'market-value' });
    });

    it('falls back to volume × contractSize × price when marketValue is absent', () => {
      // 0.1 × 100000 × 1.09 = 10,900 — the FX convention, and real money.
      expect(positionExposure({ symbol: 'X', volume: 0.1, contractSize: 100000, currentPrice: 1.09 } as any))
        .toEqual({ value: 10900, basis: 'contract-size' });
    });

    it('refuses to return volume × price as though it were money', () => {
      // ⚠️ The old code did `pos.volume * pos.price_current` = 0.109 and reported it as a currency
      // total. A ratio that reads like money is worse than an absent figure, because it is trusted.
      expect(positionExposure({ symbol: 'X', volume: 0.1, currentPrice: 1.09 } as any))
        .toEqual({ value: 0, basis: 'not-money' });
      expect(positionExposure({ symbol: 'X', volume: 0.1, contractSize: 0, currentPrice: 1.09 } as any).basis)
        .toBe('not-money');
    });

    it('marks the whole total not-money if ANY position could not be valued', async () => {
      const { svc } = build();
      const checklist = await svc.buildChecklist([
        { symbol: 'OK', ticket: 1, side: 'buy', volume: 0.1, openPrice: 1, currentPrice: 1, profit: 0, marketValue: 500 },
        { symbol: 'NOVALUE', ticket: 2, side: 'buy', volume: 0.1, openPrice: 1, currentPrice: 1.09, profit: 0 },
      ] as any);

      // A sum of money and a ratio is neither. The basis is reported so a consumer cannot render
      // the total as a currency amount without contradicting the data it was built from.
      expect(checklist.totalExposureBasis).toBe('not-money');
      expect(checklist.positions[1].exposureBasis).toBe('not-money');
      expect(checklist.positions[0].exposureBasis).toBe('market-value');
    });

    it('reports market-value when every position was valued that way', async () => {
      const { svc } = build();
      const checklist = await svc.buildChecklist(MEASURED as any);
      expect(checklist.totalExposureBasis).toBe('market-value');
      expect(checklist.totalExposure).toBeCloseTo(8621 + 209700 + 434606, 0);
    });
  });

  describe('the checklist still behaves as a checklist', () => {
    it('counts every position in the summary', async () => {
      const { svc } = build();
      const checklist = await svc.buildChecklist(MEASURED as any);
      const { holdCount, reduceCount, closeCount, totalPositions } = checklist.summary;
      expect(totalPositions).toBe(3);
      expect(holdCount + reduceCount + closeCount).toBe(3);
    });

    it('never returns a NaN recommendation when a field is missing', async () => {
      // Defensive: the loop path and the endpoint path supply different subsets of fields.
      const { svc } = build();
      const checklist = await svc.buildChecklist([
        { symbol: 'SPARSE', ticket: 'x', side: 'buy', volume: 0, openPrice: 0, currentPrice: 0, profit: 0 },
      ] as any);
      expect(checklist.positions).toHaveLength(1);
      expect(Number.isNaN(checklist.positions[0].exposure)).toBe(false);
      expect(Number.isNaN(checklist.positions[0].profit)).toBe(false);
      expect(['HOLD', 'REDUCE', 'CLOSE']).toContain(checklist.positions[0].recommendation);
    });
  });
});
