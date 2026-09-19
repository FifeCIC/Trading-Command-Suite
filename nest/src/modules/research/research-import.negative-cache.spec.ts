/**
 * #887 — unguarded on-demand import retry.
 * ==================================================================
 * THE DEFECT THIS GUARDS
 *
 * `InsiderActivityDirective` asked `ResearchImportService` to import a symbol's
 * insider transactions whenever its DB read came back empty — on EVERY scoring
 * run, with no cooldown and no negative cache. Measured 2026-09-18: the same
 * five FX pairs (GBPCAD, EURCAD, EURCHF, EURGBP, GBPJPY) were re-imported every
 * ~31s. `insidertransaction` held 2,209 rows across 123 symbols and **0 rows for
 * any FX pair** — insider filings are an SEC concept and FX pairs are not
 * issuers, so the retry could never succeed.
 *
 * Each attempt spent a call from the SHARED Finnhub 60/min budget
 * (`finnhub.adapter.ts:70` counts every endpoint on one counter), and a 429 on
 * that path blocks the caller for 60s (`:102`) — on the scoring tick's own call
 * stack. Observed in-window: `Finnhub: 9 calls in the last minute`.
 *
 * `DilutionImpactDirective` had the identical shape for company metrics. Both
 * callers are covered by the cache in the shared service — that is deliberate,
 * so the fix closes the CLASS rather than the instance.
 *
 * ⚠️ CANARY — this spec is only a guard if it fails when the fix is removed.
 *   Remove `if (this.isNegativelyCached(...)) return 0;` from
 *   `importInsiderTransactionsForSymbol` → "asks the provider once" MUST fail
 *   (provider called 5×, spec expects 1).
 *   Remove `unmeasured: true` from either directive's no-data return → the
 *   matching "marks ... as unmeasured" test MUST fail.
 *   Restore, and confirm this file passes again.
 *
 * ⚠️ LIMITATION — this spec pins the two KNOWN callers. It cannot by itself stop
 * a THIRD directive from calling an on-demand import without a guard; that would
 * need a static check over `nest/src/modules/directives/**`. Not built — stated
 * so nobody assumes coverage that is not there.
 */

import { Logger } from '@nestjs/common';
import { ResearchImportService } from './research-import.service';
import { InsiderActivityDirective } from '../directives/implementations/insider-activity.directive';
import { DilutionImpactDirective } from '../directives/implementations/dilution-impact.directive';

/** A Finnhub adapter double that counts how many times it was actually asked. */
function fakeFinnhub() {
  return {
    getInsiderTransactions: jest.fn(),
    getCompanyMetrics: jest.fn(),
  };
}

function buildPrisma() {
  return {
    insiderTransaction: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 1 }),
    },
    companyMetric: {
      upsert: jest.fn().mockResolvedValue({ symbol: 'X' }),
    },
  };
}

function buildService(prisma: any, finnhub: any): ResearchImportService {
  const providers = { getAdapter: jest.fn().mockReturnValue(finnhub) };
  // nasdaqEarnings / settingsService / jobQueue are unused by the two methods
  // under test — the on-demand single-symbol paths touch only prisma + finnhub.
  return new ResearchImportService(prisma, providers as any, {} as any, {} as any, {} as any);
}

/** A row that survives the de-dupe check, so an import can "succeed". */
const insiderRow = {
  name: 'A Person',
  share: 100,
  change: 100,
  transactionDate: new Date('2026-09-01'),
  transactionCode: 'P',
  filingDate: new Date('2026-09-02'),
  currency: 'USD',
};

beforeEach(() => {
  // Keep the spec output readable — the service logs a line per decision.
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('#887 — an empty on-demand import is not retried unboundedly', () => {
  it('asks the provider ONCE when it keeps returning no records (the live loop)', async () => {
    const prisma = buildPrisma();
    const finnhub = fakeFinnhub();
    finnhub.getInsiderTransactions.mockResolvedValue([]);
    const svc = buildService(prisma, finnhub);

    // Five consecutive scoring runs for the same symbol — the observed cadence.
    for (let i = 0; i < 5; i++) {
      await svc.importInsiderTransactionsForSymbol('GBPCAD');
    }

    expect(finnhub.getInsiderTransactions).toHaveBeenCalledTimes(1);
  });

  it('applies the same guard to the company-metrics import (dilution-impact)', async () => {
    const prisma = buildPrisma();
    const finnhub = fakeFinnhub();
    finnhub.getCompanyMetrics.mockResolvedValue(null);
    const svc = buildService(prisma, finnhub);

    for (let i = 0; i < 5; i++) {
      await svc.importCompanyMetricsForSymbol('GBPCAD');
    }

    expect(finnhub.getCompanyMetrics).toHaveBeenCalledTimes(1);
  });

  it('namespaces the cache per import kind — insider and metrics never collide', async () => {
    const prisma = buildPrisma();
    const finnhub = fakeFinnhub();
    finnhub.getInsiderTransactions.mockResolvedValue([]);
    finnhub.getCompanyMetrics.mockResolvedValue(null);
    const svc = buildService(prisma, finnhub);

    await svc.importInsiderTransactionsForSymbol('X');
    await svc.importCompanyMetricsForSymbol('X');
    // A shared key would suppress the second import entirely.
    await svc.importInsiderTransactionsForSymbol('X');
    await svc.importCompanyMetricsForSymbol('X');

    expect(finnhub.getInsiderTransactions).toHaveBeenCalledTimes(1);
    expect(finnhub.getCompanyMetrics).toHaveBeenCalledTimes(1);
  });

  it('does NOT cache a successful import — the symbol stays queryable', async () => {
    const prisma = buildPrisma();
    const finnhub = fakeFinnhub();
    finnhub.getInsiderTransactions.mockResolvedValue([insiderRow]);
    const svc = buildService(prisma, finnhub);

    await svc.importInsiderTransactionsForSymbol('AAPL');
    await svc.importInsiderTransactionsForSymbol('AAPL');

    expect(finnhub.getInsiderTransactions).toHaveBeenCalledTimes(2);
  });

  it('treats "rows returned but all already stored" as SUCCESS, not as empty', async () => {
    const prisma = buildPrisma();
    const finnhub = fakeFinnhub();
    finnhub.getInsiderTransactions.mockResolvedValue([insiderRow]);
    prisma.insiderTransaction.findFirst.mockResolvedValue({ id: 99 }); // already stored
    const svc = buildService(prisma, finnhub);

    const inserted = await svc.importInsiderTransactionsForSymbol('AAPL');
    expect(inserted).toBe(0); // nothing new...

    // ...but the DB HAS the data, so this must not be remembered as empty.
    // Getting this wrong would permanently suppress a symbol that is working.
    await svc.importInsiderTransactionsForSymbol('AAPL');
    expect(finnhub.getInsiderTransactions).toHaveBeenCalledTimes(2);
  });

  it('uses a SHORT cooldown for a transient failure, not the 24h empty TTL', async () => {
    const prisma = buildPrisma();
    const finnhub = fakeFinnhub();
    finnhub.getInsiderTransactions.mockRejectedValue(new Error('429 rate limited'));
    const svc = buildService(prisma, finnhub);

    await svc.importInsiderTransactionsForSymbol('GBPCAD');

    const entry = (svc as any).negativeImportCache.get('insider:GBPCAD');
    expect(entry).toBeDefined();
    const ttlMs = entry.until - Date.now();
    // A 24h TTL on a blip would starve a healthy symbol for a day.
    expect(ttlMs).toBeLessThan(10 * 60 * 1000);
    expect(ttlMs).toBeGreaterThan(0);
  });
});

describe('#887 — a no-reading zero is marked unmeasured (settled decision #6)', () => {
  it('insider-activity marks its no-data result as unmeasured', async () => {
    const prisma = buildPrisma();
    prisma.insiderTransaction.findMany.mockResolvedValue([]);
    const researchImport = {
      importInsiderTransactionsForSymbol: jest.fn().mockResolvedValue(0),
    };
    const directive = new InsiderActivityDirective(prisma as any, researchImport as any);

    const result = await directive.calculate({
      symbol: 'GBPCAD',
      bars: [{}],
      asOf: new Date(),
    } as any);

    expect(result.score).toBe(0);
    // Omitting this asserts the directive genuinely measured a zero.
    expect(result.unmeasured).toBe(true);
  });

  it('dilution-impact marks its no-data result as unmeasured', async () => {
    const prisma = buildPrisma();
    prisma.companyMetric.findUnique = jest.fn().mockResolvedValue(null);
    const researchImport = {
      importCompanyMetricsForSymbol: jest.fn().mockResolvedValue(false),
    };
    const directive = new DilutionImpactDirective(prisma as any, researchImport as any);

    const result = await directive.calculate({
      symbol: 'GBPCAD',
      bars: [{}],
      asOf: new Date(),
    } as any);

    expect(result.score).toBe(0);
    expect(result.unmeasured).toBe(true);
  });
});
