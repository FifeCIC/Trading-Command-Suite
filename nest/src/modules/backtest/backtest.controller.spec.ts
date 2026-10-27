import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BacktestController } from './backtest.controller';

/**
 * backtest.controller.spec.ts — a MISSING RUN IS A 404, not `200 { error }`.
 *
 * WHY THIS EXISTS (measured 2026-10-27)
 * --------------------------------------
 * `GET /api/backtest/results/:runId`, `/equity/:runId` and `/replay/:runId` all answered
 * **HTTP 200** with `{error: 'Run not found'}`. Every reader that branches on the transport result saw
 * SUCCESS, so a deleted run rendered as a run whose every field was `undefined` — the page showed
 * "Accepted baseline — undefine" over a table of dashes. That is the "plausible output, no error"
 * defect at the transport layer, and it is invisible in a unit test of the service because the service
 * was honest; only the controller lied.
 *
 * The three routes are asserted together because they share the defect: fixing one and leaving a
 * sibling returning 200 is how the next reader concludes that 200-with-error is the convention.
 */

function controllerWith(service: Record<string, unknown>) {
  return new BacktestController(
    service as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

describe('BacktestController — a missing run is 404', () => {
  it('results/:runId throws NotFound for an unknown id and returns the run when present', async () => {
    const run = { id: 'abc', symbol: 'BTC' };
    const missing = controllerWith({ getResult: () => Promise.resolve(null) });
    await expect(missing.getResult('abc')).rejects.toBeInstanceOf(NotFoundException);

    const present = controllerWith({ getResult: () => Promise.resolve(run) });
    await expect(present.getResult('abc')).resolves.toBe(run);
  });

  it('replay/:runId throws NotFound for an unknown id', async () => {
    const missing = controllerWith({ getReplay: () => Promise.resolve(null) });
    await expect(missing.getReplay('abc')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('equity/:runId throws NotFound when the service answers with its `{ error }` sentinel', async () => {
    const missing = controllerWith({
      getEquityCurve: () => Promise.resolve({ error: 'Run not found' }),
    });
    await expect(missing.getEquityCurve('abc')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('equity/:runId still returns a real curve unchanged', async () => {
    const curve = { equity: [{ time: '2026-10-01T00:00:00Z', equity: 1 }] };
    const present = controllerWith({ getEquityCurve: () => Promise.resolve(curve) });
    await expect(present.getEquityCurve('abc')).resolves.toBe(curve);
  });
});

/**
 * ⚠️ ONE WINDOW IS A VALID REQUEST (measured 2026-10-27, on the running app).
 *
 * The A/B tab always sends its own pair as window 1, because its totals table reads that measurement.
 * The route used to reject a single window with 400 — and the client ALSO posted a bare array instead
 * of `{ windows }`, so every call it did make failed too. Both failures landed on screen as `—` and
 * `…` placeholders, which read as "nothing was measured" and looked exactly like data.
 *
 * These two cases pin the contract the UI depends on: the measurement is returned for one window, and
 * the verdict for one window is `cannot-judge` WITH a reason — not a refusal, and not a pass.
 */
describe('BacktestController — repeat-check accepts one window', () => {
  const bars = (n: number, value: number) =>
    Array.from({ length: n }, (_, i) => ({
      time: 1_789_000_000 + i * 900,
      signalPct: value,
      opportunityPct: value * 2,
      opportunityScore: value * 10,
      opportunityMax: 100,
    }));

  function withRuns(aSeries: unknown, bSeries: unknown) {
    return controllerWith({
      getResult: (id: string) =>
        Promise.resolve({
          id,
          protocolId: 'btc-speed-v1',
          scoreSeries: id === 'aaa' ? aSeries : bSeries,
        }),
    });
  }

  it('returns the measurement for a single window and says why it cannot judge', async () => {
    const c = withRuns(bars(30, 40), bars(30, 45));
    const out = await c.repeatCheck({ windows: [{ aId: 'aaa', bId: 'bbb', label: 'w1' }] });

    expect(out.windows).toHaveLength(1);
    expect(out.windows[0].blocked).toBeUndefined();
    expect(out.windows[0].bars).toBe(30);
    expect(out.windows[0].scores.signal.sumA).toBe(1200);
    expect(out.windows[0].scores.signal.sumB).toBe(1350);
    expect(out.windows[0].scores.signal.delta).toBe(150);
    expect(out.verdict).toBe('cannot-judge');
    expect(out.reason).toMatch(/two windows/);
  });

  it('rejects the empty body the server would otherwise answer with a fake verdict', async () => {
    const c = withRuns(bars(30, 40), bars(30, 45));
    await expect(c.repeatCheck({})).rejects.toBeInstanceOf(BadRequestException);
    // A bare array deserialises to an object with no `windows`, so this is the shape the client sent.
    await expect(c.repeatCheck([{ aId: 'aaa', bId: 'bbb' }] as never)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
