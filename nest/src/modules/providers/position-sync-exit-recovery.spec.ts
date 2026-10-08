import { PositionSyncService } from './position-sync.service';

/**
 * #1093 — the EXIT-DATA RECOVERY report must be as honest as the recovery itself.
 *
 * Kept as its own suite (the `position-sync-ticketed-reap.spec.ts` convention) because it tests a
 * distinct branch whose failure mode is invisible in the happy path.
 *
 * ⚠️ WHAT THE SECOND LIVE RUN MEASURED, WHICH THIS LOCKS
 * -----------------------------------------------------
 * The first counter counted RE-FINALISATIONS. Run 2 reported **"Recovered 13 of the 60"** while
 * the gap list did not move by a single row (171 → 171): those 13 rows do have their closing deals
 * — the finaliser re-prices their P&L — but the deal carries no reason the enum can map, so
 * `closeReason` stays `broker:unknown`. A button that reports 13 on every press while nothing
 * changes is this repo's "plausible output, no error" signature, so:
 *
 *   · `recovered` counts only rows whose gap actually CLOSED (read back from the rows), and
 *   · the re-read-but-unattributable remainder is NAMED in the note instead of re-advertised.
 *
 * ⚠️ MOCKS MIRROR PRISMA, NOT CONVENIENCE. `findMany` is driven by its ARGUMENTS (the read-back
 * selects by `id: { in }`), so a service change that stopped reading the rows back would receive
 * the gap rows again and the count assertions would fail — the mock cannot certify a call shape
 * the service no longer makes.
 */
describe('PositionSyncService — exit-data recovery (#1093)', () => {
  const trade = {
    findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(),
    update: jest.fn(), updateMany: jest.fn(), count: jest.fn(),
  };
  const position = {
    upsert: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(),
    create: jest.fn(), update: jest.fn(), delete: jest.fn(),
  };
  const prisma = { isAvailable: true, position, trade };
  const adapter = { getDeals: jest.fn(), recoverDeals: jest.fn() };
  const adapterFactory = { create: jest.fn(() => adapter) };
  let service: PositionSyncService;
  let finaliser: jest.SpyInstance;

  /** Four ticketed gap rows; the first three are served by the terminals, the fourth is not. */
  const gapRows = [
    { id: 'r1', symbol: 'XAUUSD', side: 'buy', brokerTicket: '152733639383', openedAt: new Date('2026-10-07T10:05:00Z'), exitPrice: null, quantity: 0.1, accountId: null },
    { id: 'r2', symbol: 'VIX', side: 'sell', brokerTicket: '93058998', openedAt: new Date('2026-10-02T13:53:20Z'), exitPrice: null, quantity: 0.1, accountId: null },
    { id: 'r3', symbol: 'US30', side: 'buy', brokerTicket: '93063964', openedAt: new Date('2026-10-02T14:05:23Z'), exitPrice: null, quantity: 0.1, accountId: null },
    { id: 'r4', symbol: 'GBPJPY', side: 'buy', brokerTicket: '152709531913', openedAt: new Date('2026-10-01T08:53:18Z'), exitPrice: null, quantity: 0.1, accountId: null },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    trade.update.mockResolvedValue({});
    trade.findMany.mockImplementation(async ({ where }: any) => {
      if (where?.id?.in) return []; // read-back default: nothing attributed
      return gapRows;
    });
    trade.count.mockResolvedValue(111);
    adapter.getDeals.mockResolvedValue([]);
    adapter.recoverDeals.mockResolvedValue({
      deals: [], recovered: [], stillMissing: [], byBroker: {}, failed: {},
    });
    service = new PositionSyncService(prisma as any, adapterFactory as any);
    finaliser = jest.spyOn(service as any, 'finalizeClosedPosition').mockResolvedValue(1);
  });

  it('⭐ counts a row as recovered only when its gap actually CLOSED (the 13-vs-0 correction)', async () => {
    adapter.recoverDeals.mockResolvedValue({
      deals: [],
      // All four tickets "served" — including r4, to prove the read-back (not the served set) decides.
      recovered: ['152733639383', '93058998', '93063964', '152709531913'],
      stillMissing: [], byBroker: {}, failed: {},
    });
    // The read-back returns EVERY re-finalised row (as Prisma would): r1 and r2 got a real
    // reason; r3 was re-read but stayed unattributed; r4 — served, but its deal is unmappable too.
    trade.findMany.mockImplementation(async ({ where }: any) =>
      where?.id?.in
        ? [
            { id: 'r1', closeReason: 'broker:sl' },
            { id: 'r2', closeReason: 'user:manual' },
            { id: 'r3', closeReason: 'broker:unknown' },
            { id: 'r4', closeReason: 'broker:unknown' },
          ]
        : gapRows,
    );

    const res = await service.recoverExitDataGaps('mt5');

    // ⚠️ THE REGRESSION: 4 rows were re-finalised, but only 2 gaps closed. Reporting 4 is the
    // defect — the second run of the live button did exactly that for 13 rows.
    expect(finaliser).toHaveBeenCalledTimes(4);
    expect(res.recovered).toBe(2);
    expect(res.requested).toBe(4);
    expect(res.stillMissing).toBe(2);
    expect(res.note).toContain('Recovered 2 of the 4');
    // The unattributable remainder is NAMED, and never counted as recovered.
    expect(res.note).toContain('The terminals served 4 of them');
    expect(res.note).toContain('2 of those carry a closing deal');
    // Nothing was unserved, so the note must not say anything was.
    expect(res.note).not.toContain('were not served');
    expect(res.unasked).toEqual([]);
  });

  it('⚠️ a repeat press reports 0 recovered without contradicting itself (the live 13-row case)', async () => {
    // Exactly what the live second run looked like: the same rows are served every time, their
    // deals have no mappable reason, and NO gap closes. The note must say that plainly — the
    // earlier wording put "did not serve any" beside "N further rows were re-read".
    adapter.recoverDeals.mockResolvedValue({
      deals: [], recovered: ['152733639383', '93058998'], stillMissing: [], byBroker: {}, failed: {},
    });
    trade.findMany.mockImplementation(async ({ where }: any) =>
      where?.id?.in
        ? [
            { id: 'r1', closeReason: 'broker:unknown' },
            { id: 'r2', closeReason: 'broker:unknown' },
          ]
        : gapRows,
    );

    const res = await service.recoverExitDataGaps('mt5');

    expect(res.recovered).toBe(0);
    expect(res.note).toContain('Recovered 0 of the 4');
    expect(res.note).toContain('The terminals served 2 of them, but those closing deals carry no reason');
    expect(res.note).toContain('2 were not served');
    // Neither half may claim the other's territory.
    expect(res.note).not.toContain('did not serve any');
    expect(res.note).not.toContain('further rows were re-read');
  });

  it('does NOT re-finalise a row the terminals did not serve', async () => {
    adapter.recoverDeals.mockResolvedValue({
      deals: [], recovered: ['93058998'], stillMissing: [], byBroker: {}, failed: {},
    });

    const res = await service.recoverExitDataGaps('mt5');

    // Only the served ticket reaches the finaliser — the other three are untouched.
    expect(finaliser).toHaveBeenCalledTimes(1);
    expect(finaliser.mock.calls[0][1].brokerTicket).toBe('93058998');
    expect(res.requested).toBe(4);
  });

  it('names an UNASKED broker instead of letting the note speak for terminals never consulted', async () => {
    adapter.recoverDeals.mockResolvedValue({
      deals: [], recovered: [], stillMissing: [], byBroker: {},
      // The first live run, verbatim: bridge 2 was on an older script and answered 404.
      failed: { '2': 'HTTP 404: {"error": "not found"}' },
    });

    const res = await service.recoverExitDataGaps('mt5');

    expect(res.recovered).toBe(0);
    expect(res.unasked).toEqual(['2']);
    expect(res.note).toContain('Broker(s) 2 could not be asked');
    // ...and the unticketed population is reconciled so 192 vs 81 cannot read as a bug.
    expect(res.note).toContain('111 closed trades have no broker ticket');
  });
});
