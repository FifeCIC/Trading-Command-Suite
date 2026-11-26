/**
 * bot-resolution.spec.ts — the guard for register row 299.
 *
 * ⚠️ THE CANARY THIS REPLACES WAS A REAL RESULT. On 2026-11-26 an unnamed `movers-v1-long` run resolved
 * to `Movers V1 Long — 2h hold (mechanism test)` — a throwaway probe — because `resolveBotForRun` ranked
 * `active desc, updatedAt desc` and the probe had been edited last. Four of the five bots naming that
 * protocol have **no `strategy_protocol` subscription**, so they can never receive a live signal.
 * Every case below fails against the old rule.
 */
import { rankBotCandidates, type BotCandidate } from './bot-resolution';

const bot = (over: Partial<BotCandidate> & { id: string }): BotCandidate => ({
  name: `bot ${over.id}`,
  protocolId: 'movers-v1-long',
  active: false,
  updatedAt: '2026-11-20T00:00:00.000Z',
  ...over,
});

const PROTOCOL = 'movers-v1-long';

describe('rankBotCandidates', () => {
  it('returns none and says why when no bot names the protocol', () => {
    const r = rankBotCandidates([], { protocolId: PROTOCOL, subscribedIds: new Set() });
    expect(r.bot).toBeNull();
    expect(r.resolvedBy).toBe('none');
    expect(r.resolution.reason).toMatch(/engine literals/);
  });

  it('prefers a SUBSCRIBED bot over a newer unsubscribed one — the measured defect', () => {
    const probe = bot({ id: 'probe', updatedAt: '2026-11-25T13:38:00.000Z' });
    const real = bot({ id: 'real', updatedAt: '2026-11-23T20:45:00.000Z' });
    const r = rankBotCandidates([probe, real], {
      protocolId: PROTOCOL,
      subscribedIds: new Set(['real']),
    });
    expect(r.bot?.id).toBe('real');
    expect(r.resolution.ambiguous).toBe(false);
    expect(r.resolution.reason).toMatch(/only one the signal queue is subscribed to/);
  });

  it('prefers an ACTIVE bot over a subscribed inactive one', () => {
    const active = bot({ id: 'active', active: true });
    const subscribed = bot({ id: 'sub', updatedAt: '2026-11-25T00:00:00.000Z' });
    const r = rankBotCandidates([subscribed, active], {
      protocolId: PROTOCOL,
      subscribedIds: new Set(['sub']),
    });
    expect(r.bot?.id).toBe('active');
    expect(r.resolution.reason).toMatch(/only active bot/);
  });

  it('prefers the PRIMARY leg over a bot that names the protocol as its short leg', () => {
    const shortLeg = bot({ id: 'short', protocolId: null, shortProtocolId: PROTOCOL, active: true });
    const primary = bot({ id: 'primary' });
    const r = rankBotCandidates([shortLeg, primary], { protocolId: PROTOCOL, subscribedIds: new Set() });
    expect(r.bot?.id).toBe('primary');
    expect(r.resolution.candidates.find((c) => c.id === 'primary')?.primary).toBe(true);
    expect(r.resolution.candidates.find((c) => c.id === 'short')?.primary).toBe(false);
  });

  it('says so when it has to fall back to short-leg bots', () => {
    const shortLeg = bot({ id: 'short', protocolId: null, shortProtocolId: PROTOCOL });
    const r = rankBotCandidates([shortLeg], { protocolId: PROTOCOL, subscribedIds: new Set() });
    expect(r.bot?.id).toBe('short');
    expect(r.resolution.reason).toMatch(/no bot names this protocol as its primary leg/);
  });

  it('REPORTS a tie rather than presenting a timestamp as a rule', () => {
    const older = bot({ id: 'older', updatedAt: '2026-11-20T00:00:00.000Z' });
    const newer = bot({ id: 'newer', updatedAt: '2026-11-25T00:00:00.000Z' });
    const r = rankBotCandidates([older, newer], { protocolId: PROTOCOL, subscribedIds: new Set() });
    expect(r.bot?.id).toBe('newer');
    expect(r.resolution.ambiguous).toBe(true);
    expect(r.resolution.reason).toMatch(/tiebreak on edit time/);
  });

  it('is NOT ambiguous when the decisive level separates them', () => {
    const a = bot({ id: 'a', active: true });
    const b = bot({ id: 'b', updatedAt: '2026-12-01T00:00:00.000Z' });
    const r = rankBotCandidates([a, b], { protocolId: PROTOCOL, subscribedIds: new Set() });
    expect(r.resolution.ambiguous).toBe(false);
    expect(r.resolution.candidateCount).toBe(2);
  });

  it('lists every candidate with its facts, and marks exactly one chosen', () => {
    const r = rankBotCandidates(
      [bot({ id: 'a' }), bot({ id: 'b' }), bot({ id: 'c' })],
      { protocolId: PROTOCOL, subscribedIds: new Set(['b']) },
    );
    expect(r.resolution.candidates).toHaveLength(3);
    expect(r.resolution.candidates.filter((c) => c.chosen)).toHaveLength(1);
    expect(r.resolution.candidates.find((c) => c.id === 'b')?.subscribed).toBe(true);
  });

  it('treats an unparseable timestamp as oldest, never as newest', () => {
    const broken = bot({ id: 'broken', updatedAt: 'not-a-date' });
    const dated = bot({ id: 'dated', updatedAt: '2026-11-20T00:00:00.000Z' });
    const r = rankBotCandidates([broken, dated], { protocolId: PROTOCOL, subscribedIds: new Set() });
    expect(r.bot?.id).toBe('dated');
  });
});
