import { SuitabilityService } from './suitability.service';

describe('SuitabilityService', () => {
  let svc: SuitabilityService;

  beforeEach(() => {
    svc = new SuitabilityService();
  });

  const proto = (over: Partial<any> = {}) => ({
    slug: 'p1',
    name: 'P1',
    directionMode: 'LONG_ONLY',
    ...over,
  });

  it('fits a LONG_ONLY protocol regardless of shortability', () => {
    const v = svc.evaluateOne({ ticker: 'NVDA', type: 'stock', shortable: false }, proto());
    expect(v.fits).toBe(true);
    expect(v.direction).toBe('LONG');
  });

  it('rejects a non-shortable symbol from a SHORT_ONLY protocol', () => {
    const v = svc.evaluateOne({ ticker: 'NVDA', type: 'stock', shortable: false }, proto({ directionMode: 'SHORT_ONLY' }));
    expect(v.fits).toBe(false);
    expect(v.reasons.join(' ')).toContain('not short-suitable');
  });

  it('does NOT reject when shortability is unknown (zero market data)', () => {
    const v = svc.evaluateOne({ ticker: 'NEWCO' }, proto({ directionMode: 'SHORT_ONLY' }));
    expect(v.fits).toBe(true);
    expect(v.reasons.join(' ')).toContain('unknown');
  });

  it('excludes a known type mismatch', () => {
    const v = svc.evaluateOne(
      { ticker: 'NVDA', type: 'stock' },
      proto({ symbolTypes: ['forex', 'crypto'] }),
    );
    expect(v.fits).toBe(false);
    expect(v.reasons.join(' ')).toContain('not in');
  });

  it('passes when the symbol type is unknown (no constraint)', () => {
    const v = svc.evaluateOne({ ticker: 'NEWCO' }, proto({ symbolTypes: ['forex'] }));
    expect(v.fits).toBe(true);
  });

  it('treats timeframe as informational only', () => {
    const v = svc.evaluateOne({ ticker: 'NVDA', type: 'stock' }, proto({ recommendedTimeframe: '4h' }));
    expect(v.fits).toBe(true);
    expect(v.reasons.join(' ')).toContain('4h');
  });

  describe('deriveShortable', () => {
    it('forex and crypto are structurally shortable', () => {
      expect(svc.deriveShortable('forex')).toBe(true);
      expect(svc.deriveShortable('crypto')).toBe(true);
    });

    it('unknown type → unknown shortability', () => {
      expect(svc.deriveShortable(undefined)).toBeUndefined();
    });

    it('stock shortability comes from tags', () => {
      expect(svc.deriveShortable('stock', ['shortable'])).toBe(true);
      expect(svc.deriveShortable('stock', ['no-short'])).toBe(false);
      expect(svc.deriveShortable('stock', [])).toBeUndefined();
    });
  });

  describe('inferProtocolSymbolTypes', () => {
    it('recognises forex from slug', () => {
      expect(svc.inferProtocolSymbolTypes({ slug: 'forex-session-v1' })).toContain('forex');
    });
    it('recognises gold as commodity', () => {
      expect(svc.inferProtocolSymbolTypes({ slug: 'gold-macro-v1' })).toContain('commodity');
    });
    it('returns empty when unsure', () => {
      expect(svc.inferProtocolSymbolTypes({ slug: 'mystery-protocol' })).toEqual([]);
    });
  });
});
