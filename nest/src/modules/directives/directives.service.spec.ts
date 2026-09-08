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
