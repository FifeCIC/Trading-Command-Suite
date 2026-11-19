import { insufficientBarsMessage, BACKTEST_WINDOW_SIZE } from './backtest.service';

/**
 * The refusal for a window too short to reach its first evaluable bar.
 *
 * ⚠️ THE BUG THIS GUARDS (measured 2026-11-19): the message said *"The window exists but holds no
 * bars — import them first"* for EVERY shortfall. A real run against a 42-bar 5m period printed that
 * while holding 42 bars, so the reader was told to re-import data that was already imported. An EMPTY
 * window and a THIN window are different problems — the distinction is the whole point of the test.
 */

const period = {
  id: 'abc-123',
  name: 'movers-winners-2026-11-11',
  from: new Date('2026-11-04T00:00:00.000Z'),
  to: new Date('2026-11-12T00:00:00.000Z'),
};

describe('insufficientBarsMessage', () => {
  it('names an EMPTY period window as empty and gives the import endpoint', () => {
    const msg = insufficientBarsMessage({ period, symbol: 'SFWL', timeframe: '5m', have: 0 });
    expect(msg).toContain('EMPTY');
    expect(msg).toContain(`/api/backtest/periods/${period.id}/import`);
    expect(msg).toContain('need 100+ 5m bars, have 0');
  });

  it('does NOT call a THIN window empty — it names the shortfall instead', () => {
    const msg = insufficientBarsMessage({ period, symbol: 'SFWL', timeframe: '5m', have: 42 });
    // The exact sentence that used to be printed for this state.
    expect(msg).not.toContain('holds no bars');
    expect(msg).not.toContain('EMPTY');
    expect(msg).toContain('need 100+ 5m bars, have 42');
    expect(msg).toContain('58 more bar(s)');
    expect(msg).toContain('widening the window');
  });

  it('names the SYMBOL rather than a period when there is no stored window', () => {
    const msg = insufficientBarsMessage({ period: null, symbol: 'NVDA', timeframe: '1h', have: 0 });
    expect(msg).toContain('for NVDA');
    expect(msg).not.toContain('period');
    expect(msg).toContain('no bars in this window');
  });

  it('counts against the ONE declared warm-up constant', () => {
    // If the guard and the scoring loop ever disagree about the warm-up, a run is admitted that the
    // loop then walks past — zero evaluable bars, no error. This asserts the number the message uses.
    expect(BACKTEST_WINDOW_SIZE).toBe(100);
    const msg = insufficientBarsMessage({ period, symbol: 'X', timeframe: '5m', have: 1 });
    expect(msg).toContain(`need ${BACKTEST_WINDOW_SIZE}+`);
  });
});
