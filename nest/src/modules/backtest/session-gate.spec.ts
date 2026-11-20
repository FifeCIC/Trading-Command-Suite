/**
 * session-gate.spec.ts — the boundary that turned 26 trades into 0, and the four "no window" inputs.
 *
 * ⚠️ THE FAILURE IS SILENT BY CONSTRUCTION. Applying a session window to daily bars excludes every bar
 * and returns an empty trade list, which reads as a strategy that never fires rather than as a gate
 * measured on the wrong kind of bar. Measured 2026-11-20 on NVDA 1d: 26 trades → 0.
 */
import { sessionGatePlan, INTRADAY_MAX_BAR_MINUTES } from './session-gate';

describe('sessionGatePlan', () => {
  it('applies on an intraday timeframe', () => {
    for (const [minutes, label] of [[5, '5m'], [60, '1h'], [240, '4h'], [INTRADAY_MAX_BAR_MINUTES, '1439m']] as const) {
      expect(sessionGatePlan('["us"]', minutes, label)).toEqual({ apply: true, notice: null });
    }
  });

  it('▶ CANARY — refuses on a daily bar and explains, instead of excluding every bar', () => {
    const plan = sessionGatePlan('["us"]', 1440, '1d');
    expect(plan.apply).toBe(false);
    expect(plan.notice).toMatch(/NOT applied/);
    expect(plan.notice).toContain('1d');
    expect(plan.notice).toMatch(/26 trades → 0/);
  });

  it('refuses on anything longer than a day too', () => {
    expect(sessionGatePlan('["us"]', 10080, '1w').apply).toBe(false);
  });

  it('is silent when no window is declared — the normal case, and not a refusal', () => {
    for (const raw of [null, undefined, '', '   ', '[]']) {
      expect(sessionGatePlan(raw, 1440, '1d')).toEqual({ apply: false, notice: null });
    }
  });

  it('treats a non-JSON alias as a declaration, so a daily run still says why it was skipped', () => {
    // `checkSessionWindow` accepts city/alias words; the planner must not read them as "no window".
    expect(sessionGatePlan('us', 1440, '1d').notice).toMatch(/NOT applied/);
    expect(sessionGatePlan('us', 60, '1h').apply).toBe(true);
  });

  it('an unreadable bar length is treated as not-intraday rather than as "fine"', () => {
    // NaN minutes must never fall through to `apply: true` — "cannot judge" refuses.
    expect(sessionGatePlan('["us"]', Number.NaN, 'unknown').apply).toBe(false);
  });
});
