/**
 * alert-route-stranding.spec.ts — the MT5 alert must name the CONSEQUENCE, not just the broker.
 *
 * ── WHY THIS FILE EXISTS (measured 2026-10-11) ────────────────────────────────────────────────
 * Broker 3's demo expired; its session was down ~24h. The live alert read:
 *
 *     MT5 Bridge(s) Down: broker 3 unreachable. Only 1/2 active.
 *
 * Every word true — and it did not say that **8 active bots** (XAGUSD ×2, UK100, FRA40, GER40,
 * US30, US500, VIX) were unable to trade, most on Pepperstone-ONLY routes (MetaQuotes reports
 * tradeMode=0 for them, so "just fall back to broker 2" is not available). The operator's actual
 * question — "are any BOTS affected?" — could not be answered from the alert.
 *
 * The second half of the fix is the branch that fires with EVERY bridge healthy: a route pointing
 * at a broker id that is not in `MT5_ACTIVE_BROKERS` at all. That is a bot assigned an account
 * that is no longer available, in its purest form — and before this it produced NO alert.
 *
 * ⚠️ The counts here are the ASSERTION, not decoration: a message that names the broker but prints
 * "Affected: 0" would pass a contains('broker 3') test while being useless.
 */

import { AlertTriggerService } from './alert-trigger.service';

function build(opts: {
  brokers: any[];
  activeIds?: number[];
  routes?: Array<{ symbol: string; brokerId: number }>;
  botCount?: number;
  prismaAvailable?: boolean;
}) {
  const svc: any = Object.create(AlertTriggerService.prototype);
  svc.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  svc.mt5Connection = {
    getAllBrokerHealths: jest.fn(async () => opts.brokers),
    getBrokerIds: () => opts.activeIds ?? [2, 3],
  };
  svc.prisma =
    opts.prismaAvailable === false
      ? {}
      : {
          isAvailable: true,
          symbolRoute: { findMany: jest.fn(async () => opts.routes ?? []) },
          tradingStrategy: { count: jest.fn(async () => opts.botCount ?? 0) },
        };
  return svc;
}

const healthy = (brokerId: number, server: string) => ({
  brokerId,
  server,
  url: `http://localhost:${4998 + brokerId}`,
  reachable: true,
  health: { connected: true },
});
const down = (brokerId: number) => ({
  brokerId,
  server: '?',
  url: `http://localhost:${4998 + brokerId}`,
  reachable: false,
  health: null,
});

describe('checkMt5Connection — stranded routing is named', () => {
  it('partial outage names the affected bot count and symbols — and NOT the healthy broker routes', async () => {
    const svc = build({
      brokers: [healthy(2, 'MetaQuotes-Demo'), down(3)],
      activeIds: [2, 3],
      // XAUUSD is routed to the HEALTHY broker 2 — it must not appear in the stranded list.
      routes: [
        { symbol: 'XAGUSD', brokerId: 3 },
        { symbol: 'UK100', brokerId: 3 },
        { symbol: 'XAUUSD', brokerId: 2 },
      ],
      botCount: 8,
    });

    const result = await svc.checkMt5Connection();

    expect(result.triggered).toBe(true);
    expect(result.message).toContain('broker 3');
    expect(result.message).toContain('1/2');
    expect(result.message).toContain('Affected: 8 active bot(s)');
    expect(result.message).toContain('UK100, XAGUSD');
    expect(result.message).not.toContain('XAUUSD');
    expect(result.message).not.toContain('null');
  });

  it('stays silent about consequences when no active bot is stranded (0 must say nothing, not "0 bots")', async () => {
    const svc = build({
      brokers: [healthy(2, 'MetaQuotes-Demo'), down(3)],
      routes: [{ symbol: 'XAGUSD', brokerId: 3 }],
      botCount: 0,
    });
    const r = await svc.checkMt5Connection();
    expect(r.triggered).toBe(true);
    expect(r.message).not.toContain('Affected');
  });

  it('EVERY bridge healthy but a route targets an INACTIVE broker → its own alert', async () => {
    const svc = build({
      brokers: [healthy(2, 'MetaQuotes-Demo')],
      activeIds: [2], // broker 3 removed from MT5_ACTIVE_BROKERS
      routes: [{ symbol: 'XAGUSD', brokerId: 3 }],
      botCount: 2,
    });
    const r = await svc.checkMt5Connection();
    expect(r.triggered).toBe(true);
    expect(r.title).toBe('MT5 Route(s) Target Inactive Broker');
    expect(r.message).toContain('XAGUSD');
    expect(r.message).toContain('broker 3');
    expect(r.message).toContain('2 active bot(s)');
    expect(r.severity).toBe('warning');
  });

  it('healthy bridges + only-active routes → silent', async () => {
    const svc = build({
      brokers: [healthy(2, 'MetaQuotes-Demo'), healthy(3, 'PepperstoneUK-Demo')],
      routes: [{ symbol: 'XAGUSD', brokerId: 3 }],
      botCount: 2,
    });
    const r = await svc.checkMt5Connection();
    expect(r.triggered).toBe(false);
  });

  it('database unreadable → the original message survives, no fabricated zeros', async () => {
    const svc = build({
      brokers: [healthy(2, 'MetaQuotes-Demo'), down(3)],
      prismaAvailable: false,
    });
    const r = await svc.checkMt5Connection();
    expect(r.triggered).toBe(true);
    expect(r.message).toContain('broker 3');
    expect(r.message).not.toContain('Affected');
    expect(r.message).not.toContain('0 active bot');
  });
});
