import { TradeRecorderService } from './trade-recorder.service';

/**
 * TradeRecorderService.close — the strategy must ride the CLOSE (#884).
 *
 * ⚠️ WHY THIS EXISTS. Measured 2026-09-19: of 155 closed rows, TWO carried a strategy — and
 * both were phantoms (no broker ticket, no exit price). The app recorded the strategy when a
 * trade was REFUSED and dropped it when the trade was TAKEN and closed, so the Strategy
 * Comparison page was built entirely on the reject half of the ledger. The fix carries the
 * parsed comment through `close()`; these tests pin both directions of that contract:
 *   • given a strategy → it is written;
 *   • not given one → the existing column value is left ALONE (a reconciler must not erase a
 *     tag the open path wrote).
 */
describe('TradeRecorderService.close — strategy rides the close (#884)', () => {
  function make() {
    const svc = Object.create(TradeRecorderService.prototype) as TradeRecorderService;
    const update = jest.fn(async ({ where, data }: any) => ({ id: where.id, ...data }));
    (svc as any).prisma = { trade: { update } };
    (svc as any).syslog = { trade: jest.fn() };
    return { svc, update };
  }

  it('writes the strategy when one is given', async () => {
    const { svc, update } = make();
    await svc.close('t1', 1.2345, 5.25, 'user:manual', 'Gold Swing 1H');
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 't1' },
        data: expect.objectContaining({
          status: 'closed',
          strategy: 'Gold Swing 1H',
          exitPrice: 1.2345,
          pnl: 5.25,
        }),
      }),
    );
  });

  it('leaves the strategy column untouched when none is given', async () => {
    const { svc, update } = make();
    await svc.close('t1', 1.2345, 5.25);
    const data = update.mock.calls[0][0].data;
    expect('strategy' in data).toBe(false);
    expect(data.status).toBe('closed');
  });

  it('a priced break-even close writes pnl 0 through unchanged', async () => {
    const { svc, update } = make();
    await svc.close('t1', 1.2345, 0, 'automation:time-stop', 'XAU Speed M15');
    const data = update.mock.calls[0][0].data;
    expect(data.pnl).toBe(0);
    expect(data.strategy).toBe('XAU Speed M15');
  });
});
