import { SignalEnvelopeService } from './signal-envelope.service';

/**
 * signal-envelope-bot-verdict.spec.ts — the ONE bot sentence (#911 → single service, 2026-10-12).
 *
 * WHY THIS FILE EXISTS. The sentence "REFUSED by every subscribed bot — the lowest threshold is X% and
 * this reading is Y%, a shortfall of Z points." used to be generated client-side
 * (`src/core/tradeability.js`) from a bot list built on the DISPLAY-ONLY `trading_strategy.protocolId`
 * column — while the server's gate reconciliation (#759, corrected 2026-10-06) had already moved
 * onto `strategy_protocol` SUBSCRIPTIONS. Two implementations of one fact, two bot lists, two views.
 * The owner (2026-10-12): bots do not belong on the scoring ladder; ONE service generates the
 * sentence and the signal card renders it.
 *
 * ⚠️ The grammar case is here because the retired client implementation shipped
 * `a shortfall of 1 points` on live cards — a visible defect only the exact-string assertion catches.
 *
 * CANARY: mutate the canonical sentence template in `buildBotGate` (e.g. `REFUSED` → `REFUSEDXX`)
 * and case 1 must fail; restore and it passes (verified 2026-10-12, hash-compared).
 */
describe('buildBotGate — the ONE bot sentence', () => {
  /** Only the two pure builders are exercised — no dependency is touched. */
  function svc(): any {
    return new SignalEnvelopeService(
      {} as any, {} as any, {} as any, {} as any, {} as any,
      {} as any, {} as any, {} as any, {} as any, {} as any,
    );
  }

  it('refused: canonical sentence, reading rounded to 1dp, shortfall pluralised', () => {
    const v = svc().buildBotGate({ count: 3, thresholds: [9, 9, 10] }, 8.27);

    expect(v.state).toBe('refused');
    expect(v.sentence).toBe(
      'REFUSED by every subscribed bot — the lowest threshold is 9% and this reading is 8.3%, a shortfall of 0.7 points.',
    );
    expect(v.notice).toBe(true);
    expect(v.lowestThresholdPct).toBe(9);
    expect(v.shortfall).toBe(0.7);
  });

  it('refused: a shortfall of exactly one is SINGULAR ("1 point", not the retired "1 points")', () => {
    const v = svc().buildBotGate({ count: 1, thresholds: [9] }, 8);

    expect(v.sentence).toContain('a shortfall of 1 point.');
    expect(v.sentence).not.toContain('1 points');
  });

  it('clear: the counting sentence, and NOT a notice', () => {
    const v = svc().buildBotGate({ count: 3, thresholds: [7, 9, 12] }, 9);

    expect(v.state).toBe('clear');
    expect(v.clearingBots).toBe(2);
    expect(v.sentence).toBe('2 of 3 subscribed bot(s) have a threshold this reading meets.');
    expect(v.notice).toBe(false);
  });

  it('unsubscribed: fires with a notice — nothing can act, whatever the strength', () => {
    const v = svc().buildBotGate({ count: 0, thresholds: [] }, 23);

    expect(v.state).toBe('unsubscribed');
    expect(v.notice).toBe(true);
    expect(v.sentence).toContain('No ACTIVE bot subscribes');
  });

  it('no lookup ran (override gate / no protocol) → unknown and silent — never a guess', () => {
    const v = svc().buildBotGate(undefined, 8.3);

    expect(v.state).toBe('unknown');
    expect(v.notice).toBe(false);
    expect(v.sentence).toBe('');
  });
});

describe('applyBotGate — one fact, one sentence', () => {
  function svc(): any {
    return new SignalEnvelopeService(
      {} as any, {} as any, {} as any, {} as any, {} as any,
      {} as any, {} as any, {} as any, {} as any, {} as any,
    );
  }

  const refused = {
    state: 'refused' as const,
    sentence: 'REFUSED by every subscribed bot — the lowest threshold is 9% and this reading is 8%, a shortfall of 1 point.',
    lowestThresholdPct: 9,
    readingPct: 8,
    shortfall: 1,
    subscribedBots: 3,
    clearingBots: 0,
    notice: true,
  };

  it('bots refuse + gate blocked → the below-gate blocker IS the bot sentence (no duplicate notice)', () => {
    const out = svc().applyBotGate(
      ['Signal below 9% (8%) [style …, reconciled down to the lowest participating bot threshold (9)]'],
      ['BELOW_GATE'],
      refused,
    );

    expect(out.blockers).toEqual([refused.sentence]);
    expect(out.notice).toBe(false);
  });

  it('bots refuse + gate PASSED → readiness untouched; the notice carries the sentence', () => {
    const out = svc().applyBotGate([], [], refused);

    expect(out.blockers).toEqual([]); // preTradeReady must NOT flip — display is not readiness
    expect(out.notice).toBe(true);
  });
});
