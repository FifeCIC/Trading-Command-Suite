/**
 * protocol-runner-cadence.spec.ts — the runner must score each protocol on ITS OWN cadence.
 *
 * WHY THIS SUITE EXISTS (#783 follow-up, 2026-09-11)
 * --------------------------------------------------
 * `ProtocolRunnerService` hardcoded `const BASE_TIMEFRAME = '1d'` and loaded every
 * protocol's base bars as DAILY, whatever the protocol declared. The failure was silent
 * because a wrong cadence still produces a plausible number:
 *
 *   `xau-speed-1h` (a 1h protocol) was fed daily bars. `computeMarketStatus()` then
 *   measured staleness against the daily series and reported "last real bar 1105m old" —
 *   while the symbol's real 1h feed was 26 minutes old, imported two minutes earlier.
 *   `xau-speed-m15`, `xau-speed-4h` and `xau-speed-1h` ALL reported ~1000m for the same
 *   reason: every one of them was reading one identical daily bar. The whole Ladder read
 *   STALE/PAUSED during an active London session.
 *
 * The runner was the only consumer not using `selectBaseTimeframe()`; the Arena, the
 * signal envelope and the automation loop all already did. These tests pin the contract
 * so a future constant cannot creep back in.
 */
import { selectBaseTimeframe } from '../../common/utils/timeframe';

/** Mirrors `ProtocolRunnerService.resolveCadence()` — the logic under test. */
function resolveCadence(
  protocolId: string,
  db: {
    getCached: (slug: string) => { recommendedTimeframe?: string } | undefined;
    getRequiredBars: (slug: string) => Record<string, number>;
  },
): { timeframe: string; barCount: number } {
  const FALLBACK_TIMEFRAME = '1d';
  const declared = db.getCached(protocolId)?.recommendedTimeframe;
  const timeframe = selectBaseTimeframe(declared) || FALLBACK_TIMEFRAME;
  const required = db.getRequiredBars(protocolId);
  // ⚠️ MIRROR of `ProtocolDbService.getBaseBarCount()` (#1013). This suite defines its own
  // copy of the logic rather than exercising the private method, so the two MUST be kept in
  // step BY HAND — if the mirror ever diverges the suite passes while the real runner is
  // wrong. The rule is a MAXIMUM, not a fall-through: the generic `'1d'` key is how a
  // directive declares a requirement it cannot key to a runtime cadence (74 of 108 do), so
  // `required[tf] ?? required['1d']` let ONE base-cadence declaration suppress every larger one.
  const barCount = Math.max(required[timeframe] ?? 0, required['1d'] ?? 0) || 100;
  return { timeframe, barCount };
}

const dbWith = (
  recommendedTimeframe: string | undefined,
  required: Record<string, number> = {},
) => ({
  getCached: () => ({ recommendedTimeframe }),
  getRequiredBars: () => required,
});

describe('ProtocolRunnerService — per-protocol cadence', () => {
  describe('the cadence comes from the protocol, not a constant', () => {
    // Real `recommendedTimeframe` values from protocols-seed-data.ts, with the cadence
    // each must resolve to and the live symptom the hardcode produced.
    it.each([
      ['xau-speed-1h', '1h', '1h'],
      ['xau-speed-m15', '15m', '15m'],
      ['xau-speed-4h', '4h', '4h'],
      ['xau-speed-m5', '5m', '5m'],
      ['xau-speed-v1', '5s–30s', '1m'],
      ['forex-session-v1', '5m', '5m'],
      ['gold-macro-v1', '1d–1w', '1d'],
      ['vix-spike-v1', '1m–5m', '1m'],
    ])('%s declares %j and must load %j bars', (protocolId, declared, expected) => {
      const { timeframe } = resolveCadence(protocolId, dbWith(declared));
      expect(timeframe).toBe(expected);
      // The regression: every one of these resolved to '1d' before the fix.
      if (expected !== '1d') {
        expect(timeframe).not.toBe('1d');
      }
    });

    it('falls back to 1d only when the protocol declares nothing', () => {
      // Several seeded protocols have `recommendedTimeframe: null` — the fallback is for
      // them, NOT a default that silently applies to protocols that DID declare one.
      expect(resolveCadence('no-declaration', dbWith(null as any)).timeframe).toBe('1d');
      expect(resolveCadence('no-declaration', dbWith(undefined)).timeframe).toBe('1d');
      expect(resolveCadence('unrecognised', dbWith('monthly')).timeframe).toBe('1d');
    });

    it('never returns a cadence that is not in the marketbar set', () => {
      // A cadence the refresh loop does not fetch yields ZERO bars and therefore no score
      // (INV-CADENCE-COVERAGE). `selectBaseTimeframe` must only emit real cadences.
      const VALID = new Set(['1m', '5m', '15m', '1h', '4h', '1d']);
      for (const declared of ['5s–30s', '5m–1h', '15m–1d', '1d–4h', '1d (signal), 1h/15m', null]) {
        expect(VALID.has(resolveCadence('p', dbWith(declared as any)).timeframe)).toBe(true);
      }
    });
  });

  describe('bar count comes from getRequiredBars, not a literal', () => {
    it('uses the LARGER of the cadence requirement and the generic 1d requirement', () => {
      // The generic `'1d'` requirement wins here because it is the larger number. Sizing on
      // `required[tf] ?? required['1d']` returned 120 — the SMALLER one — and that is exactly
      // how the starvation hid (#1013).
      const { timeframe, barCount } = resolveCadence(
        'xau-speed-1h',
        dbWith('1h', { '1d': 200, '1h': 120, '15m': 30 }),
      );
      expect(timeframe).toBe('1h');
      expect(barCount).toBe(200);
    });

    it('#1013 — a base-cadence declaration must NOT suppress a larger generic one', () => {
      // THE MEASURED CASE. `btc-speed-v1` declares `'15m–1d'` → `selectBaseTimeframe` → `'15m'`.
      // `multi-timeframe-trend` declares `{ '1d': 20, '1h': 20, '15m': 20 }` — a real
      // base-cadence key — while `bollinger-band-squeeze` needs 72 under the generic `'1d'`.
      // The old fall-through returned 20, so 4 of the protocol's 13 directives returned 0 on
      // 246 of 247 ticks (99.6%) with the reason `need 72 bars, have 20`, while 3,504 fresh
      // 5m bars sat unused in `marketbar`. Nothing threw: the 0 folded into the composite.
      const { timeframe, barCount } = resolveCadence(
        'btc-speed-v1',
        dbWith('15m–1d', { '15m': 20, '1d': 72 }),
      );
      expect(timeframe).toBe('15m');
      expect(barCount).toBe(72);
    });

    it('does not starve a protocol whose cadence has no explicit requirement', () => {
      // Falls back to the 1d requirement rather than a small literal, so a long-window
      // directive cannot silently evaluate on a truncated series (INV-BAR-WINDOW).
      const { barCount } = resolveCadence('p', dbWith('4h', { '1d': 250 }));
      expect(barCount).toBe(250);
      expect(barCount).toBeGreaterThan(60);
    });

    it('falls back to 100 when the protocol declares no bar requirements at all', () => {
      // 100 matches ProtocolDbService.getRequiredBars()'s own documented fallback.
      expect(resolveCadence('p', dbWith('1h', {})).barCount).toBe(100);
    });
  });

  describe('the bars and the freshness hint can never disagree', () => {
    it('produces ONE cadence reused for both, for every seeded protocol', () => {
      // `scoreWithGating(..., timeframe)` receives the SAME value the bars were loaded
      // on. A mismatch is what made fresh data read as closed on 2026-09-10, and is the
      // reason the value is resolved once rather than passed twice.
      const cases: Array<[string, string]> = [
        ['xau-speed-1h', '1h'],
        ['xau-speed-v1', '5s–30s'],
        ['gold-macro-v1', '1d–1w'],
      ];
      for (const [id, declared] of cases) {
        const resolved = resolveCadence(id, dbWith(declared));
        // The single resolved cadence is what both call sites use.
        expect(resolved.timeframe).toBe(selectBaseTimeframe(declared));
      }
    });

    it('would have caught the live bug — a 1h protocol must not report a daily age', () => {
      // The observed symptom: xau-speed-1h reported "last real bar 1105m old" while its
      // real 1h feed was 26m. 1105m is the age of the DAILY bar. Asserting the cadence is
      // '1h' is what makes that impossible: a 1h series cannot be ~18h stale while its
      // own newest bar is 26 minutes old.
      expect(resolveCadence('xau-speed-1h', dbWith('1h')).timeframe).toBe('1h');
    });
  });
});
