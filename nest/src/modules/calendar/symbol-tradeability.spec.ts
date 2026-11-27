/**
 * #1359 follow-up — a symbol is paused only when its venue is NOT TRADING AT ALL.
 *
 * ⚠️ Both directions are asserted. A guard that only proves "closed pauses" would also pass if
 * extended hours were treated as closed — which is the exact behaviour the owner overruled:
 * "Extended hours means more trading."
 */
import { assessSymbolTradeability, assessSymbolsTradeability } from './symbol-tradeability';
import type { MarketStatus } from './market-calendar.service';

const US = 'US';

function status(over: Partial<MarketStatus>): MarketStatus {
  return {
    isOpen: false,
    status: 'closed',
    exchange: US,
    nextOpen: null,
    nextClose: null,
    minutesUntilClose: null,
    holidayName: null,
    currentSession: null,
    ...over,
  };
}

const getter = (s: MarketStatus) => (_exchange: string) => s;

describe('assessSymbolTradeability — the pause rule (#1359 follow-up)', () => {
  it('TRADEABLE, state regular, while the regular session is live', () => {
    const r = assessSymbolTradeability('AAPL', getter(status({ isOpen: true, status: 'open' })));
    expect(r.state).toBe('regular');
    expect(r.tradeable).toBe(true);
  });

  it('TRADEABLE in pre-market — extended hours are opportunity, not a pause', () => {
    const r = assessSymbolTradeability(
      'AAPL',
      getter(status({ status: 'pre-market', nextOpen: '2026-11-30T14:30:00.000Z' })),
    );
    expect(r.state).toBe('extended');
    expect(r.tradeable).toBe(true);
    expect(r.reason).toContain('extended hours are tradeable');
  });

  it('TRADEABLE after the close on a trading day', () => {
    const r = assessSymbolTradeability(
      'AAPL',
      getter(status({ status: 'after-hours', nextOpen: '2026-11-30T14:30:00.000Z' })),
    );
    expect(r.state).toBe('extended');
    expect(r.tradeable).toBe(true);
  });

  it('an early close is still the regular session', () => {
    const r = assessSymbolTradeability('AAPL', getter(status({ isOpen: true, status: 'early-close' })));
    expect(r.state).toBe('regular');
    expect(r.tradeable).toBe(true);
  });

  it('PAUSED at a weekend, naming when it reopens', () => {
    const r = assessSymbolTradeability(
      'AAPL',
      getter(status({ status: 'closed', nextOpen: '2026-11-30T14:30:00.000Z' })),
    );
    expect(r.state).toBe('paused');
    expect(r.tradeable).toBe(false);
    expect(r.reason).toContain('2026-11-30');
  });

  it('PAUSED on a holiday, naming the holiday', () => {
    const r = assessSymbolTradeability(
      'AAPL',
      getter(status({ status: 'closed', holidayName: 'Thanksgiving Day' })),
    );
    expect(r.tradeable).toBe(false);
    expect(r.reason).toContain('Thanksgiving Day');
  });

  it('crypto is continuous and never paused', () => {
    const r = assessSymbolTradeability('BTCUSD', getter(status({ status: 'closed' })));
    expect(r.state).toBe('continuous');
    expect(r.tradeable).toBe(true);
  });

  it('an UNKNOWN venue fails OPEN — "cannot judge" must not switch trading off', () => {
    const r = assessSymbolTradeability('3AMZ', getter(status({ status: 'closed' })));
    expect(r.state).toBe('unknown');
    expect(r.tradeable).toBe(true);
    expect(r.reason).toContain('freshness');
  });

  it('assessSymbolsTradeability keeps the caller’s order', () => {
    const rows = assessSymbolsTradeability(['BTCUSD', 'AAPL'], getter(status({ status: 'after-hours' })));
    expect(rows.map((r) => [r.symbol, r.state])).toEqual([
      ['BTCUSD', 'continuous'],
      ['AAPL', 'extended'],
    ]);
  });
});
