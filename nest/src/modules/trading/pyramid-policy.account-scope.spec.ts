import { PyramidPolicyService } from './pyramid-policy.service';

/**
 * #1079 — the pyramid policy scoped positions by SYMBOL only, so one provider id (`mt5`) covering
 * several accounts let another account's position block this order. Measured 2026-10-07: the A/B
 * pair holding XAUUSD locked all 8 gold bots out of the symbol (and the pair was locked out while
 * the bots held it). The policy now accepts the incoming order's `accountId` and excludes only
 * positions whose own accountId is a DIFFERENT non-empty account.
 *
 * The conservative direction is asserted explicitly: a position with NO accountId still counts,
 * because "unknown account" must never read as "no open position".
 */
describe('PyramidPolicyService — PER-BOT scoping on a hedging account (2026-11-04)', () => {
  /**
   * ⚠️ WHY THIS SUITE EXISTS. Until 2026-11-04 the open-position filter matched symbol + account
   * only, so Bot B was blocked by Bot A's position on the same symbol. That is right on a NETTING
   * account (a second order MERGES into A's position, silently rewriting size and price) and wrong
   * on a HEDGING account (the broker opens a second, separate position). Measured: broker 2
   * (MetaQuotes-Demo) is netting, broker 3 (PepperstoneUK-Demo) is hedging.
   *
   * The conservative direction is asserted too: with no model, or no magic, the old symbol-wide
   * blocking survives — being wrong towards "allow" would scale into a position we do not own.
   */
  function make(maxTiers = 1) {
    const svc = Object.create(PyramidPolicyService.prototype) as PyramidPolicyService;
    (svc as any).logger = { warn: jest.fn(), log: jest.fn() };
    (svc as any).resolvePolicy = jest.fn(async () => ({ maxTiers, baseSize: 0.01, source: 'bot' }));
    return svc;
  }
  const pos = (magic: number | null) => ({ symbol: 'XAUUSD', volume: 0.01, quantity: 0.01, accountId: null, magic });
  const base = { symbol: 'XAUUSD', side: 'BUY' as const, brokerId: 'mt5', accountId: null };

  it('⭐ another bot\'s position does NOT block on a HEDGING account', async () => {
    const res = await make().evaluate({ ...base, positions: [pos(234104)], positionModel: 'hedging', incomingMagic: 234105 });
    expect(res.hasOpenPosition).toBe(false);
    expect(res.allowed).toBe(true);
  });

  it('⭐ OWN position still blocks on a HEDGING account (scale-in needs maxPyramidTiers > 1)', async () => {
    const res = await make().evaluate({ ...base, positions: [pos(234105)], positionModel: 'hedging', incomingMagic: 234105 });
    expect(res.hasOpenPosition).toBe(true);
    expect(res.allowed).toBe(false);
  });

  it('⭐ the same input on a NETTING account BLOCKS — a second order would merge', async () => {
    const res = await make().evaluate({ ...base, positions: [pos(234104)], positionModel: 'netting', incomingMagic: 234105 });
    expect(res.hasOpenPosition).toBe(true);
    expect(res.allowed).toBe(false);
  });

  it('unknown model, or no incoming magic, keeps the conservative block', async () => {
    for (const args of [
      { positions: [pos(234104)], positionModel: 'unknown', incomingMagic: 234105 },
      { positions: [pos(234104)], positionModel: undefined, incomingMagic: 234105 },
      { positions: [pos(234104)], positionModel: 'hedging', incomingMagic: null },
      { positions: [pos(null)], positionModel: 'hedging', incomingMagic: 234105 },
    ]) {
      const res = await make().evaluate({ ...base, ...(args as any) });
      expect(res.hasOpenPosition).toBe(true);
      expect(res.allowed).toBe(false);
    }
  });

  it('a bot with maxPyramidTiers > 1 may scale into its OWN position', async () => {
    const res = await make(2).evaluate({ ...base, positions: [pos(234105)], positionModel: 'hedging', incomingMagic: 234105 });
    expect(res.hasOpenPosition).toBe(true);
    // Allowed past the tier gate; the scale-in conditions still have to pass.
    expect(String(res.blockers.map((b) => b.key).join(','))).not.toContain('duplicate-position');
  });
});

describe('PyramidPolicyService — account scoping (#1079)', () => {
  function make() {
    const svc = Object.create(PyramidPolicyService.prototype) as PyramidPolicyService;
    (svc as any).logger = { warn: jest.fn(), log: jest.fn() };
    // Bypasses the DB lookup — this suite is about the position filter, not policy resolution.
    (svc as any).resolvePolicy = jest.fn(async () => ({ maxTiers: 1, baseSize: 0.01, source: 'default' }));
    return svc;
  }

  const pos = (accountId: string | null) => ({
    symbol: 'XAUUSD',
    volume: 0.01,
    quantity: 0.01,
    accountId,
  });

  it('a position on ANOTHER account is not this account\'s open position (#1079)', async () => {
    const svc = make();
    const res = await svc.evaluate({
      symbol: 'XAUUSD',
      side: 'BUY',
      brokerId: 'mt5',
      positions: [pos('62148195')],
      accountId: '10011309743',
    });
    expect(res.hasOpenPosition).toBe(false);
    expect(res.allowed).toBe(true);
  });

  it('CONTROL — a position on the SAME account still blocks (maxTiers 1)', async () => {
    const svc = make();
    const res = await svc.evaluate({
      symbol: 'XAUUSD',
      side: 'BUY',
      brokerId: 'mt5',
      positions: [pos('10011309743')],
      accountId: '10011309743',
    });
    expect(res.hasOpenPosition).toBe(true);
    expect(res.allowed).toBe(false);
  });

  it('a position with NO accountId still blocks — unknown is not "clear" (#1079)', async () => {
    const svc = make();
    const res = await svc.evaluate({
      symbol: 'XAUUSD',
      side: 'BUY',
      brokerId: 'mt5',
      positions: [pos(null)],
      accountId: '10011309743',
    });
    expect(res.hasOpenPosition).toBe(true);
    expect(res.allowed).toBe(false);
  });

  it('without an account argument the legacy symbol-wide behaviour is unchanged (#1079)', async () => {
    const svc = make();
    const res = await svc.evaluate({
      symbol: 'XAUUSD',
      side: 'BUY',
      brokerId: 'mt5',
      positions: [pos('62148195')],
    });
    expect(res.hasOpenPosition).toBe(true);
    expect(res.allowed).toBe(false);
  });
});
