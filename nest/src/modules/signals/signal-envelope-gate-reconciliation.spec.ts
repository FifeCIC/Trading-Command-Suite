import { SignalEnvelopeService } from './signal-envelope.service';

/**
 * #759 (corrected 2026-10-06) — "the bots that participate in this signal" must resolve through
 * SUBSCRIPTIONS, not the legacy `trading_strategy.protocolId` column.
 *
 * THE DEFECT THIS PINS
 * --------------------
 * `reconcileGateWithBots()` read `tradingStrategy.protocolId` — the column `bot-rules.ts` declares
 * `display-only`, whose caveat says routing uses `strategy_protocol` — while the component that
 * actually creates queue entries (`SignalQueueService.syncQueues`) joins `strategy_protocol`.
 * Two sources for one question, and BOTH failure modes were live:
 *
 *   1. a SUBSCRIBED bot whose `protocolId` column had drifted   → its bar never lowered the gate
 *                                                                  (the #759 starvation, again);
 *   2. a bot carrying the column but with NO subscription        → could lower a gate for a
 *                                                                  protocol it can never trade.
 *
 * Measured before the change: all 40 active bots AGREE between the two sources, so the gate value
 * is unchanged today — which is exactly why this pins the SOURCE rather than a number. A suite that
 * only asserted the resulting threshold would pass against both implementations.
 *
 * CANARIES (each observed to fail against the previous implementation):
 *   1. subscribed bot + mismatched column  → old code left the gate at the style bar (10);
 *   2. column-matching bot + NO subscription → old code lowered the gate to its bar (7).
 * Both were run against the old query during this change; see the handoff for the observed output.
 */
describe('SignalEnvelopeService — gate reconciliation resolves SUBSCRIPTIONS (#759)', () => {
  const strategyProtocol = { findMany: jest.fn() };
  const tradingStrategy = { findMany: jest.fn() };
  const prisma = { strategyProtocol, tradingStrategy };

  /** 10 required deps; only `prisma` is exercised by `reconcileGateWithBots`. */
  function makeService(): any {
    return new SignalEnvelopeService(
      prisma as any,
      {} as any, {} as any, {} as any, {} as any, {} as any,
      {} as any, {} as any, {} as any, {} as any,
    );
  }

  const styleBar = (): any => ({
    threshold: 10,
    source: 'style',
    style: 'day-trade',
    label: "'Session / Mean Reversion' (extended vocabulary): 10",
  });

  beforeEach(() => {
    jest.clearAllMocks();
    strategyProtocol.findMany.mockResolvedValue([]);
    tradingStrategy.findMany.mockResolvedValue([]);
  });

  it('a SUBSCRIBED bot lowers the gate even when its protocolId column disagrees', async () => {
    // The subscription is what routes this bot's signals; the column is stale. Old code never
    // asked the subscription table, so this bot's bar could not reach the gate.
    strategyProtocol.findMany.mockResolvedValue([{ strategyId: 'bot-subscribed' }]);
    tradingStrategy.findMany.mockResolvedValue([{ minComposite: 7, mode: 'auto', symbol: 'EURJPY' }]);

    const out = await makeService().reconcileGateWithBots(styleBar(), 'forex-session-v1');

    expect(out.threshold).toBe(7);
    expect(out.label).toContain('lowest participating bot bar (7)');
    expect(strategyProtocol.findMany).toHaveBeenCalledWith({
      where: { protocolId: 'forex-session-v1' },
      select: { strategyId: true },
    });
    // …and the bot lookup is scoped by the SUBSCRIPTION's strategy ids.
    expect(tradingStrategy.findMany.mock.calls[0][0].where).toEqual({
      id: { in: ['bot-subscribed'] },
      active: true,
    });
  });

  it('a bot with a matching protocolId column but NO subscription does NOT lower the gate', async () => {
    // The repository declares (database-seed-discipline, #874): a bot with no subscription never
    // trades. It must therefore not be allowed to shape the gate either. The trading_strategy mock
    // here RETURNS a low bar on purpose — the old implementation would have consumed it and the
    // gate would read 7; the new one must never ask.
    strategyProtocol.findMany.mockResolvedValue([]);
    tradingStrategy.findMany.mockResolvedValue([{ minComposite: 7, mode: 'auto', symbol: 'EURJPY' }]);

    const out = await makeService().reconcileGateWithBots(styleBar(), 'forex-session-v1');

    expect(out.threshold).toBe(10);
    expect(tradingStrategy.findMany).not.toHaveBeenCalled();
  });

  it('lowers only — never raises above the style bar', async () => {
    strategyProtocol.findMany.mockResolvedValue([{ strategyId: 'bot-strict' }]);
    tradingStrategy.findMany.mockResolvedValue([{ minComposite: 25, mode: 'auto', symbol: 'XAUUSD' }]);

    const base = styleBar();
    const out = await makeService().reconcileGateWithBots(base, 'xau-speed-v1');

    expect(out).toBe(base); // untouched object, untouched label
    expect(out.threshold).toBe(10);
  });

  it('ignores bots whose bar is 0/NULL (no operator intent to defer to)', async () => {
    strategyProtocol.findMany.mockResolvedValue([{ strategyId: 'bot-zero' }]);
    tradingStrategy.findMany.mockResolvedValue([{ minComposite: 0, mode: 'auto', symbol: 'EURJPY' }]);

    const out = await makeService().reconcileGateWithBots(styleBar(), 'forex-session-v1');
    expect(out.threshold).toBe(10);
  });

  it('an explicit signals.gate override is left verbatim — never second-guessed', async () => {
    const override = { threshold: 15, source: 'override', label: 'override signals.gate.forex-session-v1 = 15' };

    const out = await makeService().reconcileGateWithBots(override as any, 'forex-session-v1');

    expect(out).toBe(override);
    expect(strategyProtocol.findMany).not.toHaveBeenCalled();
    expect(tradingStrategy.findMany).not.toHaveBeenCalled();
  });
});
