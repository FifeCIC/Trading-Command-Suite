/**
 * symbol-discovery.service.spec.ts — the rule the owner stated, pinned so it cannot be softened.
 *
 * Owner, 2026-11-18: *"they just won't be set as active until the users actions or a bot trades …
 * We cannot activate every symbol that appears in top losers or top winners else by the end of a month
 * we'll have hundreds of active symbols being monitored."*
 *
 * ⚠️ THE FAILURE THIS GUARDS IS THE QUIET ONE. An `upsert` with `update: { active: false }` would
 * DEACTIVATE a symbol the owner had activated — silently, on every re-discovery — which removes it from
 * monitoring while looking like a successful write. That is worse than activating one by mistake,
 * because nobody goes looking for a symbol that disappeared from a list nobody was watching.
 */
import { SymbolDiscoveryService, symbolType } from './symbol-discovery.service';

/** The smallest Prisma stub that can answer what this service asks. */
function stubPrisma({ existing = [] as string[] } = {}) {
  const created: Array<Record<string, unknown>> = [];
  const updates: Array<Record<string, unknown>> = [];
  const prisma = {
    symbol: {
      findMany: jest.fn(async ({ where }: any) => {
        const wanted: string[] = where.ticker.in;
        return existing.filter((t) => wanted.includes(t)).map((ticker) => ({ ticker }));
      }),
      create: jest.fn(async ({ data }: any) => { created.push(data); return data; }),
      /**
       * ⚠️ DELIBERATELY PRESENT SO A REGRESSION IS VISIBLE. The service must never call it; the spec
       * asserts the call count is zero rather than relying on the absence of the method.
       */
      update: jest.fn(async ({ data }: any) => { updates.push(data); return data; }),
      upsert: jest.fn(async ({ update }: any) => { updates.push(update ?? {}); return {}; }),
    },
  };
  return { prisma, created, updates };
}

describe('SymbolDiscoveryService.recordDiscovered', () => {
  it('records an unknown ticker with active=FALSE', async () => {
    const { prisma, created } = stubPrisma();
    const svc = new SymbolDiscoveryService(prisma as any);
    const out = await svc.recordDiscovered([
      { ticker: 'tenb', name: 'Tenable Holdings, Inc.', exchange: 'NasdaqGS', type: 'EQUITY' },
    ]);

    expect(out).toEqual({ created: 1, existing: 0 });
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      active: false,               // ← the whole point
      ticker: 'TENB',              // normalised
      name: 'Tenable Holdings, Inc.',
      exchange: 'NasdaqGS',
      type: 'stock',               // ← lowercase: the column's established vocabulary (see symbolType)
    });
  });

  it('⚠️ NEVER calls update or upsert — a re-discovery must not touch an existing row', async () => {
    const { prisma } = stubPrisma({ existing: ['TENB'] });
    const svc = new SymbolDiscoveryService(prisma as any);
    await svc.recordDiscovered([{ ticker: 'TENB', type: 'EQUITY' }]);

    expect(prisma.symbol.update).not.toHaveBeenCalled();
    expect(prisma.symbol.upsert).not.toHaveBeenCalled();
  });

  it('leaves an already-active symbol alone and reports it as existing', async () => {
    // The stub returns it from findMany, so it is "known" and no write of any kind happens.
    const { prisma, created } = stubPrisma({ existing: ['AAPL'] });
    const svc = new SymbolDiscoveryService(prisma as any);
    const out = await svc.recordDiscovered([{ ticker: 'AAPL' }, { ticker: 'NEWX' }]);

    expect(out).toEqual({ created: 1, existing: 1 });
    expect(created.map((c) => c.ticker)).toEqual(['NEWX']);
  });

  it('is idempotent — the same batch twice creates once', async () => {
    const { prisma, created } = stubPrisma();
    const svc = new SymbolDiscoveryService(prisma as any);
    await svc.recordDiscovered([{ ticker: 'AAA' }, { ticker: 'BBB' }]);
    // Second call: the stub does not remember, so emulate the DB by pre-seeding the known list.
    const second = stubPrisma({ existing: ['AAA', 'BBB'] });
    const svc2 = new SymbolDiscoveryService(second.prisma as any);
    const out2 = await svc2.recordDiscovered([{ ticker: 'AAA' }, { ticker: 'BBB' }]);

    expect(created).toHaveLength(2);
    expect(out2).toEqual({ created: 0, existing: 2 });
  });

  it('de-duplicates the batch itself before writing', async () => {
    const { prisma, created } = stubPrisma();
    const svc = new SymbolDiscoveryService(prisma as any);
    await svc.recordDiscovered([{ ticker: 'AAA' }, { ticker: 'aaa' }, { ticker: ' AAA ' }]);
    expect(created).toHaveLength(1);
  });

  it('an empty batch does not query the database at all', async () => {
    const { prisma } = stubPrisma();
    const svc = new SymbolDiscoveryService(prisma as any);
    await expect(svc.recordDiscovered([])).resolves.toEqual({ created: 0, existing: 0 });
    expect(prisma.symbol.findMany).not.toHaveBeenCalled();
  });

  it('a concurrent insert is counted as existing, not thrown', async () => {
    const { prisma } = stubPrisma();
    prisma.symbol.create = jest.fn(async () => {
      throw new Error('Unique constraint failed on the fields: (`ticker`)');
    });
    const svc = new SymbolDiscoveryService(prisma as any);
    await expect(svc.recordDiscovered([{ ticker: 'RACE' }])).resolves.toEqual({ created: 0, existing: 1 });
  });

  it('one failing row does not stop the batch', async () => {
    const { prisma } = stubPrisma();
    let n = 0;
    prisma.symbol.create = jest.fn(async ({ data }: any) => {
      n += 1;
      if (n === 1) throw new Error('connection reset');
      return data;
    });
    const svc = new SymbolDiscoveryService(prisma as any);
    const out = await svc.recordDiscovered([{ ticker: 'BAD' }, { ticker: 'GOOD' }]);
    expect(out.created).toBe(1);
    expect(out.existing).toBe(1);
  });
});

describe('symbolType', () => {
  it('maps the FEED vocabulary onto the APP vocabulary, not to a lowercased copy of it', () => {
    // ⚠️ This is a dictionary mapping, not a case change. `suitability.service.ts` compares a
    // symbol's type against a protocol's declared `symbolTypes` by exact lowercased equality, so a
    // `cryptocurrency` row would be REFUSED by a protocol declaring `crypto` — the scoring gate
    // declining a symbol the owner had just discovered, with no error anywhere.
    expect(symbolType('EQUITY')).toBe('stock');
    expect(symbolType('CRYPTOCURRENCY')).toBe('crypto');
    expect(symbolType('CURRENCY')).toBe('forex');
    expect(symbolType('FUTURE')).toBe('commodity');
    expect(symbolType('ETF')).toBe('etf');
    expect(symbolType('INDEX')).toBe('index');
  });

  /**
   * 🛑 THE REGRESSION THIS BLOCK EXISTS FOR. Measured 2026-11-19: the first version returned
   * UPPERCASE, discovery wrote `STOCK` ×120 / `ETF` ×11, and two case-sensitive comparisons in
   * JavaScript silently disagreed while every SQL check matched (the column collates
   * `utf8mb4_unicode_ci`). An equity was reported as having no company profile, and a foreign-listed
   * ticker returned no bars. The assertion is deliberately over the WHOLE map, not one branch: a new
   * branch added without lowercasing fails here rather than in the UI six weeks later.
   */
  it('⚠️ always returns LOWERCASE — the column accepts both cases and the JS does not', () => {
    const branches = [
      'EQUITY', 'ETF', 'MUTUALFUND', 'INDEX', 'CRYPTOCURRENCY',
      'equity', 'Etf', 'cryptocurrency', 'SOMETHING-NEW', ' something-new ', null, '', undefined,
    ];
    for (const b of branches) {
      expect(symbolType(b)).toBe(symbolType(b).toLowerCase());
    }
    // And the established vocabulary it must agree with (measured across 401 rows).
    const vocabulary = ['stock', 'forex', 'etf', 'index', 'crypto', 'commodity', 'unknown'];
    for (const b of ['EQUITY', 'ETF', 'INDEX', null]) {
      expect(vocabulary).toContain(symbolType(b));
    }
  });

  it('⚠️ says `unknown` rather than inventing an equity when the feed did not say', () => {
    // `symbol.type` is NOT NULL, and a fabricated instrument kind is a fact other code may trust.
    expect(symbolType(null)).toBe('unknown');
    expect(symbolType('')).toBe('unknown');
    expect(symbolType(undefined)).toBe('unknown');
  });

  it('passes an unrecognised type through, lowercased, rather than dropping it', () => {
    expect(symbolType('MUTUALFUND')).toBe('mutualfund');
    expect(symbolType('something-new')).toBe('something-new');
  });
});
