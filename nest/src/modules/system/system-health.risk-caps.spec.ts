import { SystemHealthService } from './system-health.service';

/**
 * checkRiskCapAlignment() — the #901 sync guard, canaried in BOTH directions.
 *
 * ⚠️ WHY THIS GUARD EXISTS. The same cap lives in two stores: the app's LIVE setting
 * (`risk.maxOpenPositions`, read at order time) and each MT5 bridge's env-read copy
 * (`MT5_MAX_OPEN_POSITIONS`, read ONCE at import — restart-bound). Measured 2026-09-19: the app
 * showed 20 while the running bridge still enforced 5, 28 orders were refused naming a control
 * that could not clear the error, and NOTHING in the product could see the disagreement — the
 * bridge endpoint reports its own copy, the settings endpoint reports the app's, and no surface
 * compared them. This check is that comparison.
 *
 * The failure mode this test class protects is the expensive one: a guard that reports OK while
 * inspecting nothing. So the no-report direction (bridge predates the field) must WARN, never pass.
 */
describe('SystemHealthService.checkRiskCapAlignment — app caps vs bridge copies (#901)', () => {
  function build(
    bridges: Array<{ brokerId: number; riskLimits?: Record<string, number> }>,
    appCaps: Record<string, number> = {
      'risk.maxOpenPositions': 20,
      'risk.maxPositionSize': 1,
      'risk.maxDailyLoss': 100,
    },
  ) {
    const svc = new SystemHealthService(
      {} as any, // prisma — untouched by this check
      { create: jest.fn() } as any, // adapterFactory — untouched by this check
      {
        getAllBrokerHealths: jest.fn(async () => bridges.map((b) => ({
          brokerId: b.brokerId,
          server: 'test',
          url: `http://localhost:${5000 + b.brokerId}`,
          reachable: true,
          health: { connected: true, mt5Package: true, riskLimits: b.riskLimits },
        }))),
      } as any,
      { get: jest.fn(async (k: string) => appCaps[k]) } as any,
    );
    return svc as any;
  }

  it('PASSES when every bridge enforces the same caps as the app', async () => {
    const svc = build([
      { brokerId: 2, riskLimits: { maxOpenPositions: 20, maxPositionSize: 1, maxDailyLoss: 100 } },
      { brokerId: 3, riskLimits: { maxOpenPositions: 20, maxPositionSize: 1, maxDailyLoss: 100 } },
    ]);
    const item = await svc.checkRiskCapAlignment();
    expect(item.status).toBe('pass');
    expect(item.detail).toContain('maxOpenPositions=20');
  });

  it('WARNS when a bridge enforces a DIFFERENT cap — the measured #901 divergence', async () => {
    // The exact measured case: app raised to 20, bridge stale at 5 from an import hours earlier.
    const svc = build([
      { brokerId: 2, riskLimits: { maxOpenPositions: 5, maxPositionSize: 1, maxDailyLoss: 100 } },
    ]);
    const item = await svc.checkRiskCapAlignment();
    expect(item.status).toBe('warn');
    expect(item.detail).toContain('MISMATCH');
    // It must name the broker, BOTH values, and the restart — the refusal advice in
    // TCS-TRADE-017 was wrong for a day because it named only one of the two controls.
    expect(item.detail).toContain('broker 2');
    expect(item.detail).toContain('app=20');
    expect(item.detail).toContain('bridge=5');
    expect(item.detail).toMatch(/RESTART/i);
  });

  it('WARNS — never passes — when no bridge reports its limits (cannot verify ≠ aligned)', async () => {
    // A bridge build predating the riskLimits field. "We could not check" must not render as OK —
    // that is the #638/#848 failure shape this codebase keeps paying for.
    const svc = build([{ brokerId: 2, riskLimits: undefined }]);
    const item = await svc.checkRiskCapAlignment();
    expect(item.status).toBe('warn');
    expect(item.detail).toContain('cannot verify');
  });
});
