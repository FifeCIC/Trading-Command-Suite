/**
 * signal-actions.service.spec.ts — the manual-trade rejection contract.
 *
 * WHY THIS TEST EXISTS (added 2026-09-20 with the #826 Phase 1 fix)
 * -----------------------------------------------------------------
 * `placeManualTrade` refused a blocked signal with
 * `throw new BadRequestException(first.message)`, which dropped two things:
 *
 *   · the blocker's `hint` — the only actionable remedy the library computed
 *   · its identity — no `code`, so the client's `noticeFromError()` fell through to its
 *     HTTP-status branch and rendered `TCS-SYS-002`, *the API failed*, with the advice
 *     "check the API is running, then retry" — for a domain refusal, not a transport fault
 *
 * Measured live: a BTC manual trade was refused with a correctly-worded cause and a remedy
 * that could not work, indistinguishable from a dead API.
 *
 * ⚠️ The assertions below are deliberately TIGHT on the hint. Asserting only "a coded
 * exception was thrown" would pass with the hint still dropped — which is the exact defect.
 * The test must fail if the hint stops being carried, so it names the hint's own text.
 */
import { Test } from '@nestjs/testing';
import { SignalActionsService } from './signal-actions.service';
import { PrismaService } from '../../database/prisma.service';
import { AdapterFactory } from '../providers/adapter-factory';
import { TradeRecorderService } from '../trading/trade-recorder.service';
import { ExecutionFeasibilityService } from '../trading/execution-feasibility.service';
import { ManualTradeDefaultsService } from './manual-trade-defaults.service';
// ⚠️ Injectable since 2026-09-23: a BLOCKED trade writes a durable alert (the toast is not a
// record). The rejection contract below is also asserted to still hold with this in place — a
// refusal must reach the user even if the alert write is what failed.
import { AlertsService } from '../alerts/alerts.service';
// ⚠️ #945 — the manual path now runs the portfolio risk gate (assessGlobalRiskLimits). The
// refusal contract below must hold when THAT gate refuses too, not only feasibility.
import { TradingStrategyService } from '../trading/trading-strategy.service';

/** The real blocker shape, taken from `execution-feasibility.service.ts` (size-below-minimum). */
const SIZE_BLOCKER = {
  key: 'size-below-minimum',
  message: `0.1 lots is below BTC's 1-lot minimum on broker 0`,
  hint: `Raise the manual trade size to at least 1 lots (Settings → manual trade defaults)`,
};

const OTHER_BLOCKER = {
  key: 'market-closed',
  message: 'Market closed for XYZ — manual trade blocked (closed)',
  hint: 'Wait for the market to open',
};

function buildModule(feasibilityResult: unknown) {
  const prisma = {
    score: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'sig-1',
        strategyId: 'btc-speed-v1',
        breakdown: {
          protocolId: 'btc-speed-v1',
          marketStatus: { open: true, stale: false },
        },
        timestamp: new Date('2026-09-20T00:00:00Z'),
        symbol: { ticker: 'BTC' },
      }),
    },
  };

  const adapterFactory = {
    create: jest.fn().mockReturnValue({ placeOrder: jest.fn() }),
  };

  const feasibility = {
    assess: jest.fn().mockResolvedValue(feasibilityResult),
  };

  const tradeRecorder = { record: jest.fn() };

  const tradeDefaults = {
    getDefaults: jest.fn().mockResolvedValue({ size: 0.1, slPct: 2, tpPct: 4 }),
  };

  const alerts = {
    addAlert: jest.fn().mockResolvedValue({ id: 'alert-1' }),
  };

  // ⚠️ #945 — defaults to ALLOWED so every existing test above keeps its meaning; the gate
  // tests below override it with a refusal. Defaulting to `allowed: false` would make this
  // suite pass for the wrong reason everywhere.
  const strategyService = {
    assessGlobalRiskLimits: jest.fn().mockResolvedValue({ allowed: true, reason: '' }),
  };

  return Test.createTestingModule({
    providers: [
      SignalActionsService,
      { provide: PrismaService, useValue: prisma },
      { provide: AdapterFactory, useValue: adapterFactory },
      { provide: TradeRecorderService, useValue: tradeRecorder },
      { provide: ExecutionFeasibilityService, useValue: feasibility },
      { provide: ManualTradeDefaultsService, useValue: tradeDefaults },
      { provide: AlertsService, useValue: alerts },
      { provide: TradingStrategyService, useValue: strategyService },
    ],
  }).compile();
}

describe('SignalActionsService.placeManualTrade — rejection contract', () => {
  it('carries the notice CODE when a safety gate refuses the order', async () => {
    const moduleRef = await buildModule({
      feasible: false,
      blockers: [SIZE_BLOCKER],
    });
    const service = moduleRef.get(SignalActionsService);

    await expect(
      service.placeManualTrade('sig-1', { side: 'BUY' } as any),
    ).rejects.toMatchObject({ code: 'TCS-RISK-001' });
  });

  it('carries the HINT — the regression that made the fix necessary', async () => {
    const moduleRef = await buildModule({
      feasible: false,
      blockers: [SIZE_BLOCKER],
    });
    const service = moduleRef.get(SignalActionsService);

    let thrown: any;
    try {
      await service.placeManualTrade('sig-1', { side: 'BUY' } as any);
    } catch (e) {
      thrown = e;
    }

    // The message alone was never the problem — the message was already correct.
    expect(thrown.params.reason).toContain(SIZE_BLOCKER.message);
    // ⚠️ This is the assertion that fails if the hint is dropped again.
    expect(thrown.params.reason).toContain(SIZE_BLOCKER.hint);
    // And the remedy must be marked as the remedy, not buried mid-sentence.
    expect(thrown.params.reason).toContain(' · ');
  });

  it('keeps the blocker key for attribution, as data rather than prose', async () => {
    const moduleRef = await buildModule({
      feasible: false,
      blockers: [SIZE_BLOCKER],
    });
    const service = moduleRef.get(SignalActionsService);

    await expect(
      service.placeManualTrade('sig-1', { side: 'BUY' } as any),
    ).rejects.toMatchObject({
      detail: expect.stringContaining('size-below-minimum'),
    });
  });

  it('returns 400, not the undeclared-code fallback of 500', async () => {
    const moduleRef = await buildModule({
      feasible: false,
      blockers: [OTHER_BLOCKER],
    });
    const service = moduleRef.get(SignalActionsService);

    let thrown: any;
    try {
      await service.placeManualTrade('sig-1', { side: 'SELL' } as any);
    } catch (e) {
      thrown = e;
    }
    // A pre-trade refusal is client-actionable; a 500 would say "server fault".
    expect(thrown.getStatus()).toBe(400);
    expect(thrown.noticeHttpStatus).toBe(400);
  });

  it('persists the refusal as a durable alert — the toast is not the record', async () => {
    // WHY THIS EXISTS: a blocked manual trade used to leave NO trace anywhere. The refusal was
    // rendered, dismissed, and gone — measured on a FRA40 buy blocked by the 0.1-lot floor. The
    // alert below is what makes "why did my trade not go through an hour ago?" answerable.
    const moduleRef = await buildModule({ feasible: false, blockers: [SIZE_BLOCKER] });
    const service = moduleRef.get(SignalActionsService);
    const alerts = moduleRef.get(AlertsService) as any;

    await expect(
      service.placeManualTrade('sig-1', { side: 'BUY' } as any),
    ).rejects.toMatchObject({ code: 'TCS-RISK-001' });

    expect(alerts.addAlert).toHaveBeenCalledWith(
      'trading',
      'Trade blocked: BTC',
      expect.stringContaining('size-below-minimum'),
      'warning',
      'BTC',
    );
  });

  it('still refuses correctly when the alert write itself fails', async () => {
    // The refusal must never depend on the alert write: a broken alerts table cannot become a
    // reason that a blocked trade silently proceeds OR that the user gets a different error.
    const moduleRef = await buildModule({ feasible: false, blockers: [SIZE_BLOCKER] });
    const service = moduleRef.get(SignalActionsService);
    (moduleRef.get(AlertsService) as any).addAlert.mockRejectedValueOnce(new Error('alerts down'));

    await expect(
      service.placeManualTrade('sig-1', { side: 'BUY' } as any),
    ).rejects.toMatchObject({ code: 'TCS-RISK-001' });
  });

  it('uses the FIRST blocker, and reports that one', async () => {
    const moduleRef = await buildModule({
      feasible: false,
      blockers: [OTHER_BLOCKER, SIZE_BLOCKER],
    });
    const service = moduleRef.get(SignalActionsService);

    await expect(
      service.placeManualTrade('sig-1', { side: 'BUY' } as any),
    ).rejects.toMatchObject({
      detail: expect.stringContaining('market-closed'),
    });
  });

  it('still places the order when the gate passes — the fix must not block trading', async () => {
    const moduleRef = await buildModule({ feasible: true, blockers: [] });
    const service = moduleRef.get(SignalActionsService);

    // ⚠️ The SAME object must serve getQuote and placeOrder — `create()` is called once by
    // the service, so a mock that returns a fresh object per call would assert against a
    // different instance than the one used.
    const placeOrder = jest
      .fn()
      .mockResolvedValue({ success: true, ticket: 12345, price: 100 });
    const broker = {
      getQuote: jest.fn().mockResolvedValue({ last: 100 }),
      placeOrder,
    };
    (service as any).adapterFactory.create.mockReturnValue(broker);

    const res: any = await service.placeManualTrade('sig-1', {
      side: 'BUY',
    } as any);
    expect(res?.success).toBe(true);
    expect(placeOrder).toHaveBeenCalledTimes(1);
  });

  // ── #945 — the portfolio risk gate on the manual path ─────────────────────────────────────
  describe('portfolio risk gate (#945)', () => {
    const GATE_REFUSAL = {
      allowed: false,
      reason: 'Position size 5 exceeds risk.maxPositionSize (1)',
    };

    it('⭐ CANARY — refuses BEFORE the broker when the gate refuses, carrying the gate reason', async () => {
      const moduleRef = await buildModule({ feasible: true, blockers: [] });
      const service = moduleRef.get(SignalActionsService);
      const placeOrder = jest.fn();
      (service as any).adapterFactory.create.mockReturnValue({
        getQuote: jest.fn().mockResolvedValue({ last: 100 }),
        placeOrder,
      });
      (service as any).strategyService.assessGlobalRiskLimits.mockResolvedValue(GATE_REFUSAL);

      let thrown: any;
      try {
        await service.placeManualTrade('sig-1', { side: 'BUY' } as any);
      } catch (e) {
        thrown = e;
      }

      // The whole point of #945: the broker is never reached on a gate refusal...
      expect(placeOrder).not.toHaveBeenCalled();
      // ...and the refusal is CODED, naming the cap and the number (the #826 pattern).
      expect(thrown.code).toBe('TCS-RISK-001');
      expect(thrown.params.reason).toBe(GATE_REFUSAL.reason);
    });

    it('calls the gate with the size and symbol actually being ordered — wiring canary', async () => {
      const moduleRef = await buildModule({ feasible: true, blockers: [] });
      const service = moduleRef.get(SignalActionsService);
      const placeOrder = jest.fn().mockResolvedValue({ success: true, ticket: 1 });
      (service as any).adapterFactory.create.mockReturnValue({
        getQuote: jest.fn().mockResolvedValue({ last: 100 }),
        placeOrder,
      });

      await service.placeManualTrade('sig-1', { side: 'BUY' } as any);

      // Fails if the call is dropped again (the #945 defect): the gate must see the REAL order
      // (0.1 from the defaults fixture, BTC from the signal), not a placeholder.
      expect((service as any).strategyService.assessGlobalRiskLimits).toHaveBeenCalledWith(0.1, 'BTC');
      expect(placeOrder).toHaveBeenCalledTimes(1); // a passing gate must not impede trading
    });

    it('the gate refusal survives a failing alert write — the refusal must not depend on it', async () => {
      const moduleRef = await buildModule({ feasible: true, blockers: [] });
      const service = moduleRef.get(SignalActionsService);
      (service as any).adapterFactory.create.mockReturnValue({
        getQuote: jest.fn(),
        placeOrder: jest.fn(),
      });
      (service as any).strategyService.assessGlobalRiskLimits.mockResolvedValue(GATE_REFUSAL);
      (moduleRef.get(AlertsService) as any).addAlert.mockRejectedValueOnce(new Error('alerts down'));

      await expect(
        service.placeManualTrade('sig-1', { side: 'BUY' } as any),
      ).rejects.toMatchObject({ code: 'TCS-RISK-001' });
    });
  });
});
