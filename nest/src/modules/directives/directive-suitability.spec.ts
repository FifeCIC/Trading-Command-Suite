/**
 * directive-suitability.spec.ts — proves the declared `instrumentTypes` is now READ (#1051).
 *
 * ⚠️ This spec is the CANARY for the whole issue. Before it, `DIRECTIVE_SUITABILITY` was imported by
 * nothing while its header claimed activation gates used it — a declaration that reads correctly and
 * fires never. These cases fail the moment it goes back to being dead.
 */
import {
  directiveFitsSymbolClass,
  normaliseSymbolClass,
  auditSuitability,
  registryCoverage,
  SYMBOL_CLASS_ALIAS,
} from './directive-suitability';

describe('the registry is actually reachable — the canary', () => {
  it('is non-trivial: the registry declares many constraints', () => {
    const c = registryCoverage();
    expect(c.total).toBeGreaterThan(50);
    expect(c.withConstraint).toBeGreaterThan(50);
  });

  it('resolves a REAL directive by id — proof the import works at runtime', () => {
    // If the registry import is ever removed or the key format changes, this is where it shows.
    const v = directiveFitsSymbolClass('rsi-oversold', 'stock');
    expect(v.unknownDirective).toBe(false);
    expect(v.declared.length).toBeGreaterThan(0);
    expect(v.fits).toBe(true);
  });
});

describe('normaliseSymbolClass — the two vocabularies', () => {
  it('maps each of the six symbol.type values to the registry plural', () => {
    expect(normaliseSymbolClass('stock')).toBe('stocks');
    expect(normaliseSymbolClass('index')).toBe('indices');
    expect(normaliseSymbolClass('commodity')).toBe('commodities');
    expect(normaliseSymbolClass('forex')).toBe('forex');
    expect(normaliseSymbolClass('crypto')).toBe('crypto');
  });

  it('maps etf to stocks, NOT to indices', () => {
    // An ETF is a basket of equities. An index is not a tradeable basket — conflating them would
    // let index-only directives score ETFs.
    expect(normaliseSymbolClass('etf')).toBe('stocks');
    expect(SYMBOL_CLASS_ALIAS.etf).not.toBe('indices');
  });

  it('returns null for an unmappable or missing type rather than guessing', () => {
    expect(normaliseSymbolClass('municipal-bond')).toBeNull();
    expect(normaliseSymbolClass(null)).toBeNull();
    expect(normaliseSymbolClass('')).toBeNull();
  });
});

describe('directiveFitsSymbolClass — unknown NEVER excludes', () => {
  it('excludes a stocks-only directive from a forex symbol — the measured case', () => {
    // `analyst-adjustments` declares ['stocks'] and is placed in `forex-session-v1`.
    const v = directiveFitsSymbolClass('analyst-adjustments', 'forex');
    expect(v.fits).toBe(false);
    expect(v.symbolClass).toBe('forex');
    expect(v.reason).toContain('forex');
  });

  it('does not exclude the same directive from a stock symbol', () => {
    expect(directiveFitsSymbolClass('analyst-adjustments', 'stock').fits).toBe(true);
  });

  it('treats an ETF as a stock, so a stocks-only directive still fits', () => {
    expect(directiveFitsSymbolClass('analyst-adjustments', 'etf').fits).toBe(true);
  });

  it('does NOT exclude on an unmappable symbol type', () => {
    const v = directiveFitsSymbolClass('analyst-adjustments', 'municipal-bond');
    expect(v.fits).toBe(true);
    expect(v.symbolClass).toBeNull();
  });

  it('does NOT exclude on a directive missing from the registry', () => {
    const v = directiveFitsSymbolClass('a-directive-that-does-not-exist', 'forex');
    expect(v.fits).toBe(true);
    expect(v.unknownDirective).toBe(true);
  });

  it('a wildcard declaration fits everything', () => {
    for (const t of ['stock', 'forex', 'crypto', 'index', 'commodity']) {
      expect(directiveFitsSymbolClass('rsi-oversold', t).fits).toBe(true);
    }
  });
});

describe('auditSuitability — the blast radius, as a pure function', () => {
  const placements = [
    { protocolSlug: 'p-a', protocolId: 'A', directiveId: 'analyst-adjustments' }, // stocks only
    { protocolSlug: 'p-b', protocolId: 'B', directiveId: 'rsi-oversold' },        // all classes
  ];
  const symbols = [
    { protocolId: 'A', ticker: 'EURUSD', type: 'forex' },
    { protocolId: 'A', ticker: 'AAPL', type: 'stock' },
    { protocolId: 'B', ticker: 'XAUUSD', type: 'commodity' },
  ];

  it('reports only the pairs that would be excluded, and counts them by each axis', () => {
    const a = auditSuitability(placements, symbols);
    expect(a.totals.wouldExclude).toBe(1);
    expect(a.pairs[0]).toMatchObject({ protocolSlug: 'p-a', directiveId: 'analyst-adjustments', ticker: 'EURUSD' });
    expect(a.byDirective[0]).toMatchObject({ directiveId: 'analyst-adjustments', pairs: 1 });
    expect(a.byProtocol[0]).toMatchObject({ protocolSlug: 'p-a', pairs: 1 });
    expect(a.bySymbolClass[0]).toMatchObject({ symbolClass: 'forex', pairs: 1 });
  });

  it('counts pairs CONSIDERED, so "none excluded" and "nothing checked" differ', () => {
    const a = auditSuitability(placements, symbols);
    expect(a.totals.pairsConsidered).toBe(3);
    const empty = auditSuitability([], []);
    expect(empty.totals.pairsConsidered).toBe(0);
    expect(empty.totals.wouldExclude).toBe(0);
  });

  it('separates the two kinds of "could not judge"', () => {
    const a = auditSuitability(
      [{ protocolSlug: 'p', protocolId: 'P', directiveId: 'nope-not-registered' }],
      [{ protocolId: 'P', ticker: 'X', type: 'forex' }],
    );
    expect(a.unknown.directiveNotInRegistry).toBe(1);
    expect(a.unknown.unmappableSymbolClass).toBe(0);

    const b = auditSuitability(
      [{ protocolSlug: 'p', protocolId: 'P', directiveId: 'analyst-adjustments' }],
      [{ protocolId: 'P', ticker: 'Y', type: 'municipal-bond' }],
    );
    expect(b.unknown.unmappableSymbolClass).toBe(1);
    expect(b.unknown.directiveNotInRegistry).toBe(0);
    expect(b.totals.wouldExclude).toBe(0);
  });

  it('a protocol reaching no symbols contributes no pairs', () => {
    const a = auditSuitability(
      [{ protocolSlug: 'p', protocolId: 'EMPTY', directiveId: 'analyst-adjustments' }],
      [{ protocolId: 'OTHER', ticker: 'X', type: 'forex' }],
    );
    expect(a.totals.pairsConsidered).toBe(0);
    expect(a.totals.wouldExclude).toBe(0);
  });
});
