import { AutomationLoopService } from './automation-loop.service';

/**
 * AutomationLoopService.processSignalQueues — the freshness gate (#882).
 *
 * ⚠️ THE ESCALATION THESE TESTS GUARD (measured 2026-09-21, issue #882 comment):
 *   A stale queue entry EXECUTES — there was no age condition anywhere in the consumer path,
 *   a 120-hour-old entry executed, an order was placed on a 20.6-hour-old score, and the
 *   `createdAt ASC` tiebreak actively preferred the stalest candidate.
 *
 * Contract now:
 *   • a head whose LAST CONFIRMATION (`updatedAt`) is older than the shared bound is
 *     archived (`status='expired'`) and NEVER reaches the gates — with a decision row naming
 *     expiry, so it is distinguishable from every other skip;
 *   • a re-confirming entry (fresh `updatedAt`, however old its `createdAt`) passes through —
 *     the upsert-refresh case that must never expire.
 *
 * Harness note: `processSignalQueues` is private; the prototype is borrowed and only
 * `prisma`, `logger`, `state` and the per-bot maps are stubbed. The fresh-head case is made to
 * stop at Gate 2 (manual mode) so no dispatch machinery is needed.
 */
describe('AutomationLoopService.processSignalQueues — freshness gate (#882)', () => {
  function make(rows: any[]) {
    const svc = Object.create(AutomationLoopService.prototype) as AutomationLoopService;
    const exec = jest.fn(async () => 0);
    const query = jest.fn(async () => rows);
    (svc as any).prisma = { isAvailable: true, $executeRawUnsafe: exec, $queryRawUnsafe: query };
    (svc as any).logger = { log: jest.fn(), warn: jest.fn(), debug: jest.fn() };
    (svc as any).state = {
      botQueueEnabled: true,
      activeStrategies: [
        {
          id: 'bot-1', symbol: 'GBPUSD', mode: 'manual', brokerId: 'mt5', active: true,
          minComposite: 0, dataStatus: 'ok', slPct: 1, tpPct: 1, baseSize: 0.01,
        },
      ],
      tradingEnabled: false,
      brokerStates: {},
    };
    (svc as any).strategyService = { recordEvaluation: jest.fn(async () => ({})) };
    (svc as any).lastTradeTime = new Map();
    (svc as any).lastBotTradeAt = new Map();
    (svc as any).sessionSkipLog = new Map();
    (svc as any).sessionGated = new Map();
    (svc as any).gateNoteAt = new Map();
    (svc as any).protocolDb = { getRequiredBars: () => ({}) };
    (svc as any).marketData = { getBars: async () => [] };
    const decisions: any[] = [];
    return { svc, exec, decisions };
  }

  const row = (over: any) => ({
    id: 'q1', strategyId: 'bot-1', symbol: 'GBPUSD', protocolId: 'forex-session-v1',
    direction: 'LONG', signal: 'BUY', compositePct: 30, combinedStrength: 30,
    scoreId: 's1', createdAt: new Date(Date.now() - 10 * 86400000), updatedAt: new Date(), ...over,
  });

  it('archives a stale head and NEVER dispatches it — the decision row names expiry', async () => {
    const { svc, exec, decisions } = make([row({ updatedAt: new Date(Date.now() - 8 * 3600 * 1000) })]);
    await (svc as any).processSignalQueues(decisions);

    const expireCall = exec.mock.calls.find((c) => String(c[0]).includes("SET status = 'expired'"));
    expect(expireCall).toBeTruthy();
    expect(expireCall![1]).toBe('q1'); // the archive write targets the stale row

    const d = decisions.find((x) => String(x.reason ?? '').includes('expired'));
    expect(d).toBeTruthy();
    expect(d.decision).toBe('SKIP');
    expect(d.reason).toContain('not executed');
    expect(d.reason).toContain('> 360m max');
  });

  it('a re-confirmed entry (fresh updatedAt, ancient createdAt) passes the gate untouched', async () => {
    // createdAt is 10 days old by default in `row()` — the upsert-refresh canary case.
    const { svc, exec, decisions } = make([row({ updatedAt: new Date() })]);
    await (svc as any).processSignalQueues(decisions);

    expect(exec.mock.calls.find((c) => String(c[0]).includes("SET status = 'expired'"))).toBeFalsy();
    // It proceeded to Gate 2 and stopped there (manual mode) — freshness let it through.
    expect(decisions.some((x) => String(x.reason ?? '').includes('mode is'))).toBe(true);
  });
});
