/**
 * protocol-health.boot.spec.ts — the boot path must not gate `listen()` (#1232).
 *
 * ⚠️ THE MEASURED FAILURE (2026-11-07). `onApplicationBootstrap` AWAITED `validateAll()` (~31 s) and
 * `auditMeasuredCeilings()` (~62 s), and Nest does not bind the HTTP port until that hook resolves.
 * So the API took **~107 s** to answer `/api/health`, logging normally the whole time — two agents
 * killed it at 30-55 s believing it had wedged, and the frontend's auto-start (#1233) turned each
 * kill into another overlapping start.
 *
 * A timing-based test would be flaky, so this asserts the PROPERTY instead: `onApplicationBootstrap`
 * must resolve **while the audits are still in flight**. That is the actual contract — a diagnostic
 * may run for two minutes, but the port must not wait for it.
 *
 * Canaried in both directions:
 *   - await the audits again  → the "resolves while in flight" test fails (the hook never settles)
 *   - remove the diagnostics  → the "still runs, still logs" test fails
 */
import { ProtocolHealthService } from './protocol-health.service';

/** A promise that never settles — the audit as it would behave mid-query. */
function pending<T>(): Promise<T> {
  return new Promise<T>(() => { /* never resolves */ });
}

function makeService() {
  const service = new ProtocolHealthService({} as never, {} as never, {} as never);
  const logs: string[] = [];
  (service as unknown as { logger: Record<string, (...a: unknown[]) => void> }).logger = {
    log: (m: string) => logs.push(m),
    warn: (m: string) => logs.push(m),
    error: (m: string) => logs.push(m),
    debug: () => {},
  };
  // The #970 coverage check spawns a CLI child process; it is irrelevant here and must not run.
  (service as unknown as { checkBotSymbolCoverage: () => Promise<void> }).checkBotSymbolCoverage =
    () => Promise.resolve();
  return { service, logs };
}

describe('boot path does not wait for the protocol-health audits (#1232)', () => {
  it('onApplicationBootstrap RESOLVES while validateAll is still in flight', async () => {
    const { service } = makeService();
    jest.spyOn(service, 'validateAll').mockReturnValue(pending());
    jest.spyOn(service, 'auditMeasuredCeilings').mockResolvedValue([]);

    // If the hook awaits the audit, this never settles and jest times out — which IS the failure.
    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
  });

  it('onApplicationBootstrap RESOLVES while auditMeasuredCeilings is still in flight', async () => {
    const { service } = makeService();
    jest.spyOn(service, 'validateAll').mockResolvedValue([]);
    jest.spyOn(service, 'auditMeasuredCeilings').mockReturnValue(pending());

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
  });

  // ── the inverse: deferring must not mean skipping ──────────────────────────────────────────────
  it('the diagnostics still RUN and their findings still reach the log', async () => {
    const { service, logs } = makeService();
    const validate = jest.spyOn(service, 'validateAll').mockResolvedValue([
      { severity: 'warning', protocolId: 'p1', message: 'measured 11% of capacity' } as never,
    ]);
    const audit = jest.spyOn(service, 'auditMeasuredCeilings').mockResolvedValue([
      { severity: 'error', protocolId: 'p2', message: 'cannot reach its bar' } as never,
    ]);

    await service.onApplicationBootstrap();
    // Give the fire-and-forget promise a turn to run to completion.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    expect(validate).toHaveBeenCalled();
    expect(audit).toHaveBeenCalled();
    expect(logs.join('\n')).toContain('measured 11% of capacity');
    expect(logs.join('\n')).toContain('cannot reach its bar');
    expect(service.getLast().issues).toHaveLength(2);
  });

  it('a failing audit is reported, not swallowed, and still does not reject the hook', async () => {
    const { service, logs } = makeService();
    jest.spyOn(service, 'validateAll').mockResolvedValue([]);
    jest.spyOn(service, 'auditMeasuredCeilings').mockRejectedValue(new Error('collation clash'));

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    expect(logs.join('\n')).toContain('collation clash');
  });

  it('the ceiling audit runs AFTER validateAll so lastIssues carries both', async () => {
    const { service } = makeService();
    const order: string[] = [];
    jest.spyOn(service, 'validateAll').mockImplementation(async () => {
      order.push('validate');
      return [];
    });
    jest.spyOn(service, 'auditMeasuredCeilings').mockImplementation(async () => {
      order.push('ceilings');
      return [];
    });

    await service.onApplicationBootstrap();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    expect(order).toEqual(['validate', 'ceilings']);
  });

  // ── silence must be distinguishable from "never ran" (#1232) ──────────────────────────────────
  //
  // ⚠️ Before this, a CLEAN audit and an audit that never started produced the identical log —
  // nothing — because both the per-issue loop and the summary emit only when issues exist. That made
  // the deferred path unverifiable from the log, which is why the change could not be observed at
  // runtime while other sessions kept killing the process. Remove the "running"/"finished" lines and
  // this test fails.
  it('a CLEAN run still says it ran and finished — so silence is never ambiguous', async () => {
    const { service, logs } = makeService();
    jest.spyOn(service, 'validateAll').mockResolvedValue([]);
    jest.spyOn(service, 'auditMeasuredCeilings').mockResolvedValue([]);

    await service.onApplicationBootstrap();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    const text = logs.join('\n');
    expect(text).toContain('running deferred diagnostics');
    expect(text).toContain('no issues found');
    expect(text).toMatch(/finished in \d+ms/);
  });
});
