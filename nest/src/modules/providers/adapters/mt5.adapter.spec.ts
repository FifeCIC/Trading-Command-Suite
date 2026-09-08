import { Mt5Adapter } from './mt5.adapter';

describe('Mt5Adapter execution contracts', () => {
  const response = (body: unknown) => ({
    ok: true,
    status: 200,
    json: jest.fn().mockResolvedValue(body),
  }) as any;

  beforeEach(() => jest.clearAllMocks());

  it('marks a successfully fetched empty position snapshot as authoritative', async () => {
    global.fetch = jest.fn().mockResolvedValue(response({ positions: [], count: 0 })) as any;
    const adapter = new Mt5Adapter();

    await expect(adapter.getPositionSnapshot()).resolves.toEqual({
      positions: [],
      authoritative: true,
    });
  });

  it('marks a failed position fetch as non-authoritative', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('connection refused')) as any;
    const adapter = new Mt5Adapter();

    await expect(adapter.getPositionSnapshot()).resolves.toEqual({
      positions: [],
      authoritative: false,
    });
  });

  it('forwards idempotency and exposes partial fills', async () => {
    global.fetch = jest.fn().mockResolvedValue(response({
      success: true,
      ticket: 99,
      status: 'partially_filled',
      filledVolume: 0.05,
      price: 1.1,
    })) as any;
    const adapter = new Mt5Adapter();

    const result = await adapter.placeOrder({
      symbol: 'EURUSD',
      side: 'BUY',
      quantity: 0.1,
      clientOrderId: 'queue-1',
    });

    const init = (global.fetch as jest.Mock).mock.calls[0][1];
    expect(JSON.parse(init.body)).toMatchObject({ clientOrderId: 'queue-1' });
    expect(result).toMatchObject({
      success: true,
      status: 'PARTIALLY_FILLED',
      filledQuantity: 0.05,
    });
  });
});
