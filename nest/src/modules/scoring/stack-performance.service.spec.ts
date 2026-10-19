/**
 * StackPerformanceService — guard for the consistency factor (#review-2026-10-17).
 *
 * THE DEFECT: `consistencyFactor` was `1 - Math.abs(winRate - 0.5) * 0.3`, i.e. DISTANCE FROM A
 * COIN FLIP. A stack winning 80% of its trades and one winning 20% therefore scored IDENTICALLY
 * (both 0.91), and 50% was treated as the ideal. That factor multiplies `rating`, so the rating
 * could not distinguish a good hit-rate from a bad one.
 *
 * THE GUARD: two stacks with the SAME total P&L, the same trade count and the same timestamps —
 * so effectiveness, confidence and recency are identical — but opposite win rates. Under the old
 * formula their ratings were EQUAL; here the higher win rate must rate higher.
 *
 * ⚠️ Ratios, not absolutes: this asserts ORDER, which is the property that was broken. It does not
 * pin the 0.30 penalty budget, so re-tuning that number will not fail the guard — only reverting
 * to the symmetric form will.
 */
import { StackPerformanceService } from './stack-performance.service';

/**
 * A permissive Prisma stub. Unknown models/methods resolve to `null` rather than throwing, so the
 * guard keeps working when `computeMetaStackRating` grows another read — a stub that throws on
 * contact would fail for the wrong reason and read as a broken service.
 */
function stubPrisma(trades: unknown[]) {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'trade') return { findMany: async () => trades };
        return new Proxy({}, { get: () => async () => null });
      },
    },
  ) as never;
}

function trades(winCount: number, winAmount: number, lossCount: number, lossAmount: number) {
  const openedAt = new Date(Date.now() - 60 * 60 * 1000);
  const rows: { pnl: number; openedAt: Date }[] = [];
  for (let i = 0; i < winCount; i++) rows.push({ pnl: winAmount, openedAt });
  for (let i = 0; i < lossCount; i++) rows.push({ pnl: -lossAmount, openedAt });
  return rows;
}

async function ratingFor(tradeRows: { pnl: number; openedAt: Date }[]): Promise<number> {
  const service = new StackPerformanceService(stubPrisma(tradeRows));
  // Fingerprinting reads component state; irrelevant to the rating maths and not the subject here.
  (service as unknown as { computeFingerprint: () => Promise<string> }).computeFingerprint =
    async () => 'stub-fingerprint';

  const rating = await service.computeMetaStackRating(
    'ss-guard',
    'Guard Stack',
    'probe-1dir-v1',
    'Guard Watchlist',
    '2',
    null,
  );
  return rating.rating;
}

describe('StackPerformanceService — consistency is monotonic in win rate (#review-2026-10-17)', () => {
  // Both stacks: 100 trades, identical total P&L (+100), identical timestamps.
  //   high win rate: 80 × +2  + 20 × -3  = +160 - 60 = +100   (winRate 0.80)
  //   low  win rate: 20 × +9  + 80 × -1  = +180 - 80 = +100   (winRate 0.20)
  const HIGH_WINRATE = trades(80, 2, 20, 3);
  const LOW_WINRATE = trades(20, 9, 80, 1);

  it('rates an 80% win rate above a 20% win rate at identical P&L', async () => {
    const high = await ratingFor(HIGH_WINRATE);
    const low = await ratingFor(LOW_WINRATE);

    // The regression: under `1 - |wr - 0.5| * 0.3` these were EQUAL.
    expect(high).not.toBe(low);
    expect(high).toBeGreaterThan(low);
  });

  it('rates a 50% win rate below an 80% win rate — 50% is not the ideal', async () => {
    // 50% wr, same +100 total: 50 × +3 + 50 × -1 = +150 - 50 = +100
    const fiftyPct = await ratingFor(trades(50, 3, 50, 1));
    const high = await ratingFor(HIGH_WINRATE);

    expect(high).toBeGreaterThan(fiftyPct);
  });
});
