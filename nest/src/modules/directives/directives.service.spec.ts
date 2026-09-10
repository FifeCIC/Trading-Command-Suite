import { DirectivesService } from './directives.service';
import type { DirectiveInput, IDirective } from './interfaces/directive.interface';

const conditionVector = {
  regime: 'trending', regimeStrength: 1,
  regimeComponents: { hurst: 1, adx: 1, volatilityPercentile: 1 },
  hurstExponent: 1, volatility: 'normal', activeSession: 'US', adx: 50,
  atrPercentile: 0.5, preEvent: false, timestamp: new Date(0),
};

function directive(id: string): IDirective {
  return {
    id, name: id, description: id, readiness: 'ready', directionBias: 'neutral',
    maxScore: 100, version: '1.0.0',
    calculate: input => ({
      score: input.bars.at(-1)?.close ?? 0,
      confidence: 0.5,
      reason: id,
      signalClass: 'bullish',
    }),
  };
}

describe('DirectivesService evaluation cache', () => {
  const service = new DirectivesService(
    { detect: () => conditionVector } as any,
    {} as any,
    {} as any,
  );
  service.register(directive('a'));
  service.register(directive('b'));

  const input = (close: number): DirectiveInput => ({
    symbol: 'TEST',
    asOf: new Date('2026-01-01T00:00:00Z'),
    bars: [{ timestamp: new Date('2026-01-01T00:00:00Z'), open: 1, high: close, low: 1, close, volume: 10 }],
  });

  it('isolates directive filters regardless of call order', async () => {
    expect([...(await service.runAll(input(10), new Set(['a']))).keys()]).toEqual(['a']);
    expect([...(await service.runAll(input(10), new Set(['b']))).keys()]).toEqual(['b']);
  });

  it('includes bar contents and protects cached values from caller mutation', async () => {
    const first = await service.runAll(input(10), new Set(['a']));
    first.get('a')!.score = 99;
    expect((await service.runAll(input(10), new Set(['a']))).get('a')!.score).toBe(10);
    expect((await service.runAll(input(20), new Set(['a']))).get('a')!.score).toBe(20);
  });

  it('clamps non-finite and out-of-range directive values', async () => {
    service.register({
      ...directive('invalid'),
      calculate: () => ({ score: Number.POSITIVE_INFINITY, confidence: 5, reason: 'bad' }),
    });
    const result = (await service.runAll(input(10), new Set(['invalid']))).get('invalid')!;
    expect(result.score).toBe(0);
    expect(result.confidence).toBe(1);
    expect(result.signalClass).toBe('neutral');
  });
});

/**
 * Bar ordering contract (#751).
 *
 * `DirectiveInput.bars` is documented oldest → newest and ~34 directives read
 * `bars[bars.length - 1]` as the CURRENT bar. Callers that need "the newest N
 * bars" naturally query `orderBy: desc, take: N` and used to pass that array
 * straight through — silently reversing the series, so "current price" became
 * the OLDEST bar in the window. These tests pin the boundary behaviour that
 * makes caller order irrelevant.
 */
describe('DirectivesService bar ordering (#751)', () => {
  /**
   * Build a bar series. `order: 'desc'` replicates what callers naturally get
   * from `orderBy: { timestamp: 'desc' }, take: N` — the newest N bars, delivered
   * newest-first. Chronological order of the CLOSES is always the same; only the
   * array order differs, which is exactly the bug.
   */
  function barsInput(closes: number[], order: 'asc' | 'desc' = 'asc'): DirectiveInput {
    const bars = closes.map((close, i) => ({
      timestamp: new Date(Date.UTC(2026, 0, 1, 0, i)),
      open: close, high: close, low: close, close, volume: 10,
    }));
    return {
      symbol: 'TEST',
      asOf: new Date('2026-01-01T00:00:00Z'),
      bars: order === 'desc' ? bars.reverse() : bars,
    };
  }

  const newestClose = (closes: number[]) => closes[closes.length - 1];

  it('scores the NEWEST bar even when the caller passes bars newest-first', async () => {
    const svc = new DirectivesService({ detect: () => conditionVector } as any, {} as any, {} as any);
    svc.register(directive('latest'));

    const ascending = await svc.runAll(barsInput([1, 2, 3]), new Set(['latest']));
    const descending = await svc.runAll(barsInput([1, 2, 3], 'desc'), new Set(['latest']));

    // directive() reports `input.bars.at(-1).close`, i.e. the "current" bar —
    // before the fix the newest-first payload scored the OLDEST close (1).
    expect(ascending.get('latest')!.score).toBe(newestClose([1, 2, 3]));
    expect(descending.get('latest')!.score).toBe(newestClose([1, 2, 3]));
  });

  it('reorders the caller array itself into oldest → newest', async () => {
    const svc = new DirectivesService({ detect: () => conditionVector } as any, {} as any, {} as any);
    svc.register(directive('latest'));

    const payload = barsInput([1, 2, 3], 'desc');
    await svc.runAll(payload, new Set(['latest']));

    expect(payload.bars!.map((b) => b.close)).toEqual([1, 2, 3]);
  });

  it('orders the higher-timeframe bundles too', async () => {
    const svc = new DirectivesService({ detect: () => conditionVector } as any, {} as any, {} as any);
    svc.register(directive('latest'));

    const payload: DirectiveInput = {
      ...barsInput([1, 2, 3], 'desc'),
      dayBars: barsInput([10, 20, 30], 'desc').bars,
      hourBars: barsInput([100, 200, 300], 'desc').bars,
      min15Bars: barsInput([1000, 2000, 3000], 'desc').bars,
    };
    await svc.runAll(payload, new Set(['latest']));

    expect((payload as any).dayBars.map((b: any) => b.close)).toEqual([10, 20, 30]);
    expect((payload as any).hourBars.map((b: any) => b.close)).toEqual([100, 200, 300]);
    expect((payload as any).min15Bars.map((b: any) => b.close)).toEqual([1000, 2000, 3000]);
  });

  it('produces an order-independent evaluation cache key', async () => {
    const svc = new DirectivesService({ detect: () => conditionVector } as any, {} as any, {} as any);
    let calls = 0;
    svc.register({
      ...directive('counted'),
      calculate: () => { calls++; return { score: 1, confidence: 1, reason: 'x', signalClass: 'neutral' as const }; },
    });

    await svc.runAll(barsInput([1, 2, 3]), new Set(['counted']));
    await svc.runAll(barsInput([1, 2, 3], 'desc'), new Set(['counted']));

    // Same bars in a different order must hit the same cache entry, not recompute.
    expect(calls).toBe(1);
  });
});
