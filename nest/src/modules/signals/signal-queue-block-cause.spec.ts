/**
 * The pre-trade block CAUSE must reach the audit log verbatim (#974).
 *
 * ── WHY THIS FILE EXISTS ──────────────────────────────────────────────────────────────────────
 * `SignalQueueService` used to keep the block reason in a formatted STRING and log it. It now also
 * persists a machine `cause` — and the whole value of that field is that it is the gate's own word
 * for what happened, not something re-derived later.
 *
 * So the assertions below are deliberately **decoys**: the reason TEXT and the CODE disagree on
 * purpose. A test that used a matching pair would pass whether the implementation forwarded the
 * code or inferred it from the message, and inferring it is the failure mode being guarded against
 * (a second source of truth for one fact, which breaks on the first reword).
 *
 * A live observation of the real path was NOT available when this was written: the market was
 * closing for the week and the loop had not produced a new block since the change. This file is
 * therefore the observation of the mechanism, and the live path is reported as unobserved.
 */

import { SignalQueueService } from './signal-queue.service';

describe('SignalQueueService — pre-trade block cause is forwarded, not inferred (#974)', () => {
  function make() {
    const svc = new SignalQueueService({ isAvailable: true } as any);
    const persisted: Array<{ protocolId: string; symbol: string; cause: string; reason: string }> = [];
    const deleted: string[] = [];

    (svc as any).prisma = {
      isAvailable: true,
      $executeRawUnsafe: jest.fn(async (sql: string, ...args: any[]) => {
        deleted.push(sql);
        return 0;
      }),
      $queryRawUnsafe: jest.fn(async () => []),
    };
    (svc as any).logger = { log: jest.fn(), warn: jest.fn() };
    // Stands in for AuditLogService, which is @Global() at runtime and @Optional() in the ctor.
    (svc as any).auditLog = {
      logPreTradeBlocked: (protocolId: string, symbol: string, cause: string, reason: string) => {
        persisted.push({ protocolId, symbol, cause, reason });
      },
    };
    return { svc, persisted, deleted };
  }

  it('persists the CODE from the map even when the reason TEXT implies a different one', async () => {
    const { svc, persisted } = make();
    // ⚠️ DECOY, both halves. A text classifier would read "Signal below" and say BELOW_GATE.
    const notRouteable = new Map<string, { code: string; reason: string }>([
      ['dax-speed-v1|GER40', {
        code: 'MARKET_UNAVAILABLE',
        reason: "Signal below 12% (6.5%) [style 'Mean Reversion / Scalp' → scalp]",
      }],
    ]);

    await svc.syncQueues([], new Set(['dax-speed-v1|GER40']), notRouteable);

    expect(persisted).toHaveLength(1);
    expect(persisted[0].protocolId).toBe('dax-speed-v1');
    expect(persisted[0].symbol).toBe('GER40');
    // The gate's word wins. If this ever reads BELOW_GATE, someone started parsing the message.
    expect(persisted[0].cause).toBe('MARKET_UNAVAILABLE');
    // The human text is carried through UNMODIFIED — it is what an operator reads.
    expect(persisted[0].reason).toContain('Signal below 12%');
  });

  it('the reverse decoy also holds — the code is not a function of the text', async () => {
    const { svc, persisted } = make();
    const notRouteable = new Map<string, { code: string; reason: string }>([
      ['ftse-speed-v1|UK100', {
        code: 'BELOW_GATE',
        reason: 'Market unavailable: US market closed',
      }],
    ]);

    await svc.syncQueues([], new Set(['ftse-speed-v1|UK100']), notRouteable);

    expect(persisted).toHaveLength(1);
    expect(persisted[0].cause).toBe('BELOW_GATE');
  });

  it('a pair with NO entry is silent, and is NOT persisted as a block', async () => {
    const { svc, persisted, deleted } = make();
    // No notRouteable entry → the protocol never signalled → the void pass runs, no block recorded.
    await svc.syncQueues([], new Set(['forex-session-v1|EURUSD']));

    expect(persisted).toHaveLength(0);
    // Still voids the pending row, which is the pre-existing behaviour this must not disturb.
    expect(deleted.some((sql) => sql.includes('DELETE FROM strategy_signal_queue'))).toBe(true);
  });

  it('records one event per blocked symbol, not one per protocol', async () => {
    const { svc, persisted } = make();
    const notRouteable = new Map<string, { code: string; reason: string }>([
      ['momentum-stock-v1|AAPL', { code: 'BELOW_GATE', reason: 'below 10% (6.1%)' }],
      ['momentum-stock-v1|AMZN', { code: 'BELOW_GATE', reason: 'below 10% (6.1%)' }],
      ['momentum-stock-v1|MARA', { code: 'DIRECTIVE_CONFLICT', reason: 'high-severity conflict' }],
    ]);

    await svc.syncQueues(
      [],
      new Set(['momentum-stock-v1|AAPL', 'momentum-stock-v1|AMZN', 'momentum-stock-v1|MARA']),
      notRouteable,
    );

    expect(persisted.map((p) => p.symbol).sort()).toEqual(['AAPL', 'AMZN', 'MARA']);
    expect(persisted.find((p) => p.symbol === 'MARA')!.cause).toBe('DIRECTIVE_CONFLICT');
  });

  it('does not throw when the audit log is absent — the @Optional() path', async () => {
    const { svc } = make();
    // This is the shape `signal-queue-expiry.spec.ts` constructs: prisma stub only.
    (svc as any).auditLog = undefined;
    const notRouteable = new Map<string, { code: string; reason: string }>([
      ['dax-speed-v1|GER40', { code: 'BELOW_GATE', reason: 'below 12% (6.5%)' }],
    ]);

    await expect(
      svc.syncQueues([], new Set(['dax-speed-v1|GER40']), notRouteable),
    ).resolves.toBeUndefined();
  });
});
