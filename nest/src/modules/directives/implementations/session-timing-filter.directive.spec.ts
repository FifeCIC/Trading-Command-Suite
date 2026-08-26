import { SessionTimingFilterDirective } from './session-timing-filter.directive';
import { MarketBar } from '../interfaces/directive.interface';
import { MarketSessionsService } from '../../calendar/market-sessions.service';

function makeBar(timestamp: Date, i = 0): MarketBar {
  return { timestamp, open: 100, high: 101, low: 99, close: 100, volume: 1000000 };
}

describe('SessionTimingFilterDirective', () => {
  // v2.0.0 added a MarketSessionsService dependency (DST-aware session detection).
  // It is dependency-free (only a Logger), so inject the real service.
  const directive = new SessionTimingFilterDirective(new MarketSessionsService());

  it('should return score=0 with empty bars', () => {
    const result = directive.calculate({ symbol: 'TEST', bars: [] });
    expect(result.score).toBe(0);
    expect(result.confidence).toBe(0.1);
  });

  it('should detect US session (high quality)', () => {
    // 14:00 UTC = US session
    const bar = makeBar(new Date('2026-06-10T14:00:00Z'));
    const result = directive.calculate({ symbol: 'TEST', bars: [bar] });
    expect(result.score).toBeGreaterThanOrEqual(50);
    // The reason names the session by its SCOPE slug ("ny session active"),
    // not the display name — the directive maps activeScopes to {name: scope}.
    // Do NOT change this to 'New York' (would break the assertion).
    expect(result.reason).toContain('ny session active');
  });

  it('should mark weekend as closed', () => {
    const bar = makeBar(new Date('2026-06-14T14:00:00Z')); // Sunday
    const result = directive.calculate({ symbol: 'TEST', bars: [bar] });
    expect(result.score).toBe(0);
    expect(result.reason).toContain('Weekend');
  });
});
