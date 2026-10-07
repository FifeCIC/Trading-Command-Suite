import { AlertTriggerService } from './alert-trigger.service';

/**
 * alert-risk-cap-breach.spec.ts — the two risk-cap breach triggers (#1086).
 *
 * WHY THIS SUITE EXISTS
 *
 * Both caps refuse an order by returning `{ allowed: false }` and **nothing else**. Measured
 * 2026-10-07: `risk.maxDailyLoss` refused **440** orders across 13 symbols and `risk.maxPortfolioRisk`
 * **~282** across ~10, and the operator was told none of it — the app simply went quiet, which reads
 * as "not finding trades" rather than "locked out". The only way that day's lockout was found was by
 * querying `decision_log` by hand.
 *
 * ⚠️ THE TWO TRIGGERS ARE DELIBERATELY NOT THE SAME, and that is what most of this suite pins:
 *
 *   risk.maxDailyLoss   — a **LATCH**. Cannot clear until local midnight, so every bot stays blocked
 *                         for the rest of the day. → `critical`, and attended (Windows toast).
 *   risk.maxPortfolioRisk — a **CAPACITY STATE**. Clears itself as positions close or stops tighten.
 *                         → `warning`, in-app only.
 *
 * A single generic "trading blocked" alert would collapse those two into one — which is the same
 * conflation the caps themselves avoid, and it would spend the toast channel on a condition that
 * resolves on its own.
 */

describe('AlertTriggerService — risk-cap breach alerts (#1086)', () => {
  const CFG = (threshold = 5, severity: 'critical' | 'warning' = 'critical') =>
    ({ enabled: true, cooldownSeconds: 0, severity, threshold });

  /** The two shapes the check reads: the COUNT query, then the NEWEST-reason query. */
  function build(counts: { n: number; symbols: number }, newest: { reason: string }[] = []) {
    const addAlert = jest.fn();
    const send = jest.fn().mockResolvedValue(undefined);
    const query = jest.fn((sql: string) => {
      if (/COUNT\(\*\)/.test(sql)) return Promise.resolve([{ n: counts.n, symbols: counts.symbols }]);
      return Promise.resolve(newest);
    });
    const svc = new AlertTriggerService(
      { addAlert } as any,
      { $queryRawUnsafe: query } as any,
      {} as any,
      {} as any,
      { send } as any,
    );
    return { svc, addAlert, send, query };
  }

  const REASON = 'Daily loss $178.02 exceeds risk.maxDailyLoss ($100)';

  it('⚠️ THE CANARY — below the bar it stays SILENT (a transient is not an alert)', async () => {
    // 4 refusals against a threshold of 5. The book was momentarily over its cap, or one order was
    // refused — reporting that is how an alert channel gets ignored before it is ever useful.
    const { svc, addAlert, send } = build({ n: 4, symbols: 3 });

    await (svc as any).evaluateTrigger('risk-daily-loss', CFG(5));

    expect(addAlert).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('fires at the bar, and the message carries the count, the span and the RECORDED reason', async () => {
    const { svc, addAlert } = build({ n: 440, symbols: 13 }, [{ reason: REASON }]);

    await (svc as any).evaluateTrigger('risk-daily-loss', CFG());

    expect(addAlert).toHaveBeenCalledTimes(1);
    const [type, title, detail, severity] = addAlert.mock.calls[0];
    // Argument order matters — see the fireAlert() warning comment.
    expect(type).toBe('trading');
    expect(severity).toBe('critical');
    // The reason is quoted rather than re-derived: it already names the cap, the figure and (for the
    // portfolio cap) the accountable positions, and it is the same row an operator would grep for.
    expect(detail).toContain(REASON);
    expect(detail).toContain('440');
    expect(detail).toContain('13');
  });

  it('⚠️ the title is STABLE — no count in it, or one condition fractures into many rows', async () => {
    // The same mistake was made and corrected for `symbol-silent` (2026-09-23): a `${n} order(s)`
    // title produced a separate alert row for every count.
    const a = build({ n: 6, symbols: 2 }, [{ reason: REASON }]);
    const b = build({ n: 440, symbols: 13 }, [{ reason: REASON }]);
    await (a.svc as any).evaluateTrigger('risk-daily-loss', CFG());
    await (b.svc as any).evaluateTrigger('risk-daily-loss', CFG());

    expect(a.addAlert.mock.calls[0][1]).toBe(b.addAlert.mock.calls[0][1]);
    expect(String(a.addAlert.mock.calls[0][1])).not.toMatch(/\d/);
  });

  it('⚠️ the LATCH cap says it cannot clear, and warns what it means', async () => {
    const { svc, addAlert } = build({ n: 440, symbols: 13 }, [{ reason: REASON }]);

    await (svc as any).evaluateTrigger('risk-daily-loss', CFG());

    const detail = String(addAlert.mock.calls[0][2]);
    expect(detail).toContain('LATCH');
    expect(detail).toContain('midnight');   // the fact that makes it different from the other cap
  });

  it('⚠️ the CAPACITY cap says it CLEARS ITSELF, and must not read as a fault', async () => {
    const { svc, addAlert } = build({ n: 282, symbols: 10 }, [
      { reason: 'Portfolio at risk 18.1% exceeds risk.maxPortfolioRisk 15% — #152730169965 AMZN' },
    ]);

    await (svc as any).evaluateTrigger('risk-portfolio-risk', CFG(5, 'warning'));

    const detail = String(addAlert.mock.calls[0][2]);
    expect(detail).toContain('CLEARS ITSELF');
    expect(detail).not.toContain('LATCH');
    // And the accountable position from the reason survives into the message.
    expect(detail).toContain('AMZN');
  });

  it('⚠️ only the LATCH cap is ATTENDED — the self-clearing one must not spend the toast channel', async () => {
    const latch = build({ n: 440, symbols: 13 }, [{ reason: REASON }]);
    await (latch.svc as any).evaluateTrigger('risk-daily-loss', CFG());
    expect(latch.send).toHaveBeenCalledTimes(1);

    const capacity = build({ n: 282, symbols: 10 }, [{ reason: 'Portfolio at risk …' }]);
    await (capacity.svc as any).evaluateTrigger('risk-portfolio-risk', CFG(5, 'warning'));
    expect(capacity.addAlert).toHaveBeenCalledTimes(1);   // the in-app row still appears
    expect(capacity.send).not.toHaveBeenCalled();         // but no Windows notification
  });

  it('each trigger filters on ITS OWN cap marker, so they cannot report each other', async () => {
    const { svc, query } = build({ n: 1, symbols: 1 });
    await (svc as any).evaluateTrigger('risk-portfolio-risk', CFG(5, 'warning'));

    const markers = query.mock.calls.map((c: any[]) => String(c[1]));
    expect(markers.every((m: string) => m.includes('risk.maxPortfolioRisk'))).toBe(true);
    expect(markers.some((m: string) => m.includes('risk.maxDailyLoss'))).toBe(false);
  });

  /**
   * ⚠️ THE SOURCE GUARD — because the window is the part that fails SILENTLY.
   *
   * `decision_log.timestamp` is stored in UTC while the MySQL session runs in local time (BST here),
   * so a window built from `NOW()` is an hour out and reports **nothing at all** — an alert that
   * never fires, with no error. That cost an hour of misreading on 2026-09-22 in this same file
   * (`checkSymbolSilent`). The convention is asserted here rather than left to memory.
   */
  it('⚠️ THE SOURCE windows on UTC_TIMESTAMP(), never NOW()', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, 'alert-trigger.service.ts'), 'utf8') as string;

    const start = src.indexOf('private async checkRiskCapBreach');
    expect(start).toBeGreaterThan(-1);          // renamed away => do not pass on an empty slice
    const body = src.slice(start, src.indexOf('private fireAlert', start));
    expect(body.length).toBeGreaterThan(200);   // a truncated slice must not read as OK

    expect(body).toContain('UTC_TIMESTAMP()');
    expect(body).not.toContain('NOW()');
  });
});
