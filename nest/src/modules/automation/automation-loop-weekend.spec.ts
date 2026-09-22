import { AutomationLoopService } from './automation-loop.service';

/**
 * #869 Finding A — the weekend check must RUN and LOG.
 *
 * ⚠️ THE DEFECT THESE TESTS GUARD. The block read `allPositions` ~25 lines before the portfolio
 * fetch filled it, so `mt5Positions.length` was always 0 and the block — including its own log
 * line — never executed. Measured on Friday 2026-09-18 with the loop at Tick #25/#26: the string
 * "Weekend Defense" appeared NOWHERE in logs/api-out.log.
 *
 * ⚠️ HOW YOU KNOW THESE TESTS WOULD CATCH IT. They are two-directional by construction: forcing
 * day 5 / day 3 must call the service and log; forcing day 2 must be SILENT. A check that never
 * runs passes the "nothing logged on Tuesday" test and fails the "logged on Friday" test — which
 * is the whole point of having both.
 *
 * `day` is a parameter of `runWeekendDefenseCheck()` precisely so this file can force it; the tick
 * passes `new Date().getUTCDay()`.
 */
describe('AutomationLoopService.runWeekendDefenseCheck (#869 Finding A)', () => {
  const checklist = (over: any = {}) => ({
    positions: [],
    summary: { totalPositions: 1 },
    totalSwapCostTonight: 1.23,
    totalGapRisk: 4.56,
    totalExposure: 573.31,
    totalExposureBasis: 'contract-size',
    unknownSideCount: 0,
    ...over,
  });

  function make(result: any = checklist()) {
    const buildChecklist = jest.fn(async () => result);
    const svc = Object.create(AutomationLoopService.prototype) as AutomationLoopService;
    (svc as any).weekendDefense = { buildChecklist };
    (svc as any).logger = { log: jest.fn(), warn: jest.fn() };
    return { svc, buildChecklist, logger: (svc as any).logger };
  }

  const pos = (over: any = {}) => ({
    symbol: 'XAUUSD',
    side: 'buy',
    quantity: 0.1,
    avgCost: 2400,
    currentPrice: 2410,
    unrealizedPnl: 10,
    marketValue: 2410,
    brokerTicket: 'T1',
    ...over,
  });

  it('FRIDAY (day 5): runs, maps BrokerPosition fields, and logs the summary with its basis', async () => {
    const { svc, buildChecklist, logger } = make();
    await (svc as any).runWeekendDefenseCheck(5, [pos()]);

    expect(buildChecklist).toHaveBeenCalledTimes(1);
    expect(buildChecklist).toHaveBeenCalledWith([
      expect.objectContaining({
        symbol: 'XAUUSD',
        side: 'buy',
        ticket: 'T1',
        volume: 0.1,
        openPrice: 2400,
        currentPrice: 2410,
        marketValue: 2410,
      }),
    ]);
    const lines: string[] = logger.log.mock.calls.map((c: any[]) => String(c[0]));
    expect(lines.some((l) => l.includes('Weekend Defense') && l.includes('(contract-size)'))).toBe(true);
  });

  it('WEDNESDAY (day 3): also runs — triple swap', async () => {
    const { svc, buildChecklist } = make();
    await (svc as any).runWeekendDefenseCheck(3, [pos()]);
    expect(buildChecklist).toHaveBeenCalledTimes(1);
  });

  it('CANARY, other direction: Tuesday (day 2) is SILENT — nothing called, nothing logged', async () => {
    const { svc, buildChecklist, logger } = make();
    await (svc as any).runWeekendDefenseCheck(2, [pos()]);
    expect(buildChecklist).not.toHaveBeenCalled();
    expect(logger.log).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('surfaces the UNSTATED-direction count — a shape mismatch cannot be silent', async () => {
    const { svc, logger } = make(checklist({ unknownSideCount: 2 }));
    await (svc as any).runWeekendDefenseCheck(5, [pos({ side: undefined })]);
    const all = [...logger.log.mock.calls, ...logger.warn.mock.calls]
      .map((c: any[]) => String(c[0]))
      .join('\n');
    expect(all).toContain('UNSTATED direction');
  });

  it('a checklist build FAILURE is logged, never silent', async () => {
    const { svc, logger } = make();
    (svc as any).weekendDefense = {
      buildChecklist: jest.fn(async () => {
        throw new Error('boom');
      }),
    };
    await (svc as any).runWeekendDefenseCheck(5, [pos()]);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Weekend defense check skipped: boom'));
  });

  it('no symbol-bearing positions → the service is not called at all', async () => {
    const { svc, buildChecklist } = make();
    await (svc as any).runWeekendDefenseCheck(5, [{ side: 'buy' }]);
    expect(buildChecklist).not.toHaveBeenCalled();
  });
});
