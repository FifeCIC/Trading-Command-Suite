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
