import { TradingStrategyService } from './trading-strategy.service';
import { RiskService } from '../risk/risk.service';

/**
 * assessGlobalRiskLimits() — the drawdown gate must never fabricate its own baseline (#848).
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * THE BUG (measured live 2026-09-16)
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * The account was read as `account?.equity ?? account?.balance ?? 10_000`, and that value seeded
 * `peakEquity`, which is MONOTONIC (only ever increases). So a bridge outage — when `getAccount()`
 * fails and `account` is `null` — permanently stamped **10,000** as the high-water mark. When the
 * bridge RECOVERED, the real ~$1,389 account read as a catastrophic loss:
 *
 *     08:28-18:40   bridge unreachable — 707 FAILED decisions; account=null -> peak = 10,000
 *     ~18:40        bridge recovers (both bridges connected=true)
 *     18:42, 18:44  EURCAD/NZDJPY/EURCHF/GBPCAD blocked: "Drawdown 86.1% exceeds limit"
 *     arithmetic    (10_000 - 1,389.37) / 10_000 = 86.11%   <- the logged figure, exactly
 *
 * Two properties made this worse than a normal bug:
 *
 *   1. It was SELF-INFLICTED BY RECOVERY — the bridge coming back is what triggered the block, so
 *      the system got worse as infrastructure got better.
 *   2. It NEVER EXPIRED — `peakEquity` is an in-memory field, so trading stayed blocked until the
 *      API process restarted.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * THE PRINCIPLE
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * A drawdown cannot be measured without a real account value. `?? 10_000` invented one, and the
 * invented value became a *baseline* rather than a placeholder — the same shape as #839 (a
 * hand-copied bar that kept blocking trades) and #847 (a wrong scale that rendered "low" for 100%
 * of rows). In all three, **nothing errors and the output looks like a normal result.**
 *
 * These tests use the REAL `RiskService`, so the drawdown arithmetic under test is the one that
 * ships. Mocking `checkDrawdown` would only prove the mock agrees with itself.
 */
describe('assessGlobalRiskLimits — drawdown baseline must be real (#848)', () => {
  /** Small enough that `canOpenPosition`'s maxPerSymbol (25%) never masks the drawdown result. */
  const SIZE = 0.001;

  function build(mt5: { getPositions: jest.Mock; getAccount: jest.Mock }) {
    const notificationService = {
      notifyDrawdown: jest.fn().mockResolvedValue(undefined),
    } as any;
    // The real service — the arithmetic is part of what is being tested.
    const riskService = new RiskService(notificationService);

    // Only used for the daily-loss query, which is wrapped in try/catch and not under test.
    const prisma = {
      trade: { findMany: jest.fn().mockRejectedValue(new Error('not under test')) },
    } as any;

    /**
     * ⚠️ The risk caps moved from env to `SettingsResolverService` (risk.maxPositionSize,
     * risk.maxOpenPositions, risk.maxDailyLoss). This stub returns the DEFAULTS DECLARED IN
     * `settings-registry.ts` (1.0 / 5 / 100), which is what a real `get()` yields when no row
     * exists — `resolve()` falls back to the declared default rather than returning undefined.
     *
     * A bare `{}` would make `settings.get(...)` throw and the whole method would be skipped,
     * so these tests would pass while testing nothing. Same defect as the time-stop fixture that
     * fed a comment format the writer never emits.
     */
    const settings = {
      get: jest.fn(async (key: string) =>
        ({
          'risk.maxPositionSize': 1.0,
          'risk.maxOpenPositions': 5,
          'risk.maxDailyLoss': 100,
        } as Record<string, number>)[key],
      ),
    } as any;

    return new TradingStrategyService(
      prisma,
      mt5 as any,
      {} as any, // conditionDetector  — untouched by this method
      riskService,
      notificationService,
      {} as any, // protocolGating     — untouched by this method
      settings,  // SettingsResolverService — risk caps resolve from here
    );
  }

  it('a bridge outage must not become a permanent 86% drawdown once the bridge recovers', async () => {
    const mt5 = { getPositions: jest.fn(), getAccount: jest.fn() };
    const svc = build(mt5);

    // ── tick 1: bridge unreachable — exactly the 707 ticks measured on 2026-09-16 ──
    mt5.getPositions.mockRejectedValue(new Error('Bridge unreachable (circuit breaker active)'));
    mt5.getAccount.mockRejectedValue(new Error('Bridge unreachable (circuit breaker active)'));

    const first = await svc.assessGlobalRiskLimits(SIZE);
    expect(first.allowed).toBe(true); // drawdown is 0% on the first call either way

    // ── tick 2: SAME account, bridge healthy again. Nothing about the account changed. ──
    mt5.getPositions.mockResolvedValue([]);
    mt5.getAccount.mockResolvedValue({ equity: 1389.37, balance: 1389.37, margin: 100 });

    const second = await svc.assessGlobalRiskLimits(SIZE);

    // REGRESSION GUARD: before the fix this was
    //   { allowed: false, reason: 'Drawdown 86.1% exceeds limit' }
    // — a risk gate failing CLOSED on a number it had invented.
    expect(second.reason).not.toContain('Drawdown');
    expect(second.allowed).toBe(true);
  });

  it('does not record a peak at all while the account is unreadable', async () => {
    const mt5 = { getPositions: jest.fn(), getAccount: jest.fn() };
    const svc = build(mt5);

    mt5.getPositions.mockRejectedValue(new Error('bridge down'));
    mt5.getAccount.mockRejectedValue(new Error('bridge down'));

    await svc.assessGlobalRiskLimits(SIZE);

    // The peak is private, so assert it through behaviour: a LARGE first real reading must not be
    // treated as a drawdown from anything, and a small one must not be reported as a loss.
    mt5.getPositions.mockResolvedValue([]);
    mt5.getAccount.mockResolvedValue({ equity: 500, balance: 500, margin: 100 });

    const after = await svc.assessGlobalRiskLimits(SIZE);
    expect(after.allowed).toBe(true);
    expect(after.reason).not.toContain('Drawdown');
  });

  it('STILL blocks a genuine drawdown against a real peak — the gate is not disabled', async () => {
    const mt5 = { getPositions: jest.fn().mockResolvedValue([]), getAccount: jest.fn() };
    const svc = build(mt5);

    mt5.getAccount.mockResolvedValue({ equity: 1000, balance: 1000, margin: 100 });
    const atPeak = await svc.assessGlobalRiskLimits(SIZE);
    expect(atPeak.allowed).toBe(true);

    // A real 40% fall — above the 25% maxDrawdown.
    mt5.getAccount.mockResolvedValue({ equity: 600, balance: 600, margin: 100 });
    const afterDrop = await svc.assessGlobalRiskLimits(SIZE);

    expect(afterDrop.allowed).toBe(false);
    expect(afterDrop.reason).toContain('Drawdown');
    expect(afterDrop.reason).toContain('40.0%');
  });
});
