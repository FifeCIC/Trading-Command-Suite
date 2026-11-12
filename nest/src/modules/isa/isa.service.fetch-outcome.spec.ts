/**
 * isa.service.fetch-outcome.spec.ts — a REJECTED key must not read as a healthy empty ISA.
 *
 * THE DEFECT THIS PINS (measured 2026-11-12)
 * ───────────────────────────────────────────
 * `TRADING212_ISA_API_KEY` was set, and Trading212 answered **HTTP 401** on both
 * `/equity/account/cash` and `/equity/portfolio`. The dashboard still returned
 *
 *     { status: 'connected', summary: { totalValueGbp: null, positionCount: 0 }, positions: [] }
 *
 * because the status was derived from `this.apiKey ? …` — whether a key EXISTS — not from whether a
 * fetch SUCCEEDED. To a reader that says "your ISA is connected and holds nothing", which is a claim
 * about their money. The truth was "we could not ask".
 *
 * ⚠️ Both directions matter and both are asserted here:
 *   • a 401 (or a missing key, or a 500) must NEVER produce `connected`;
 *   • a genuinely working key must STILL produce `connected` with real figures — or the fix would be
 *     "always report broken", which is the same class of lie in the other direction.
 */
import { IsaService } from './isa.service';

describe('IsaService — connected means READ, not merely configured (2026-11-12)', () => {
  const realFetch = global.fetch;
  const realKey = process.env.TRADING212_ISA_API_KEY;
  const realSecret = process.env.TRADING212_ISA_API_SECRET;

  const okResp = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as any;
  const errResp = (status: number) => ({ ok: false, status, json: async () => ({}) }) as any;

  /** A fresh service per case — the key is read into a field at construction. */
  const build = (key: string | undefined) => {
    if (key === undefined) delete process.env.TRADING212_ISA_API_KEY;
    else process.env.TRADING212_ISA_API_KEY = key;
    return new IsaService();
  };

  afterEach(() => {
    global.fetch = realFetch;
    if (realKey === undefined) delete process.env.TRADING212_ISA_API_KEY;
    else process.env.TRADING212_ISA_API_KEY = realKey;
    if (realSecret === undefined) delete process.env.TRADING212_ISA_API_SECRET;
    else process.env.TRADING212_ISA_API_SECRET = realSecret;
  });

  it('a key Trading212 REJECTS reports unauthorised — never connected, and summarises nothing', async () => {
    global.fetch = jest.fn().mockResolvedValue(errResp(401)) as any;
    const dash: any = await build('rejected-key').getDashboard();

    expect(dash.status).toBe('unauthorised');
    expect(dash.readable).toBe(false);
    // ⚠️ `positionCount: null`, not `0`. Zero is a claim that the account is empty.
    expect(dash.summary.positionCount).toBeNull();
    expect(dash.summary.totalValueGbp).toBeNull();
    // The warning must name the ACTION a person can take, not the HTTP mechanism.
    const w = dash.warnings.find((x: any) => x.type === 'isa_connection');
    expect(w.severity).toBe('error');
    expect(w.message).toContain('401');
    expect(w.message).toContain('TRADING212_ISA_API_KEY');
  });

  it('a 403 is also unauthorised (expired/scoped key), not a generic error', async () => {
    global.fetch = jest.fn().mockResolvedValue(errResp(403)) as any;
    const dash: any = await build('scoped-key').getDashboard();
    expect(dash.status).toBe('unauthorised');
  });

  it('a broker-side failure reports error — unavailable is not empty', async () => {
    global.fetch = jest.fn().mockResolvedValue(errResp(500)) as any;
    const dash: any = await build('good-key').getDashboard();
    expect(dash.status).toBe('error');
    expect(dash.readable).toBe(false);
    expect(dash.summary.positionCount).toBeNull();
  });

  it('NO key reports not_configured, with the setup instruction rather than an error', async () => {
    global.fetch = jest.fn() as any;
    const dash: any = await build(undefined).getDashboard();
    expect(dash.status).toBe('not_configured');
    expect(dash.readable).toBe(false);
    const w = dash.warnings.find((x: any) => x.type === 'isa_connection');
    expect(w.severity).toBe('info');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  // ── Canary, the OTHER direction ──────────────────────────────────────────────────────────────
  it('CANARY: a WORKING key still reports connected, with real figures', async () => {    global.fetch = jest.fn()
      .mockResolvedValueOnce(okResp({ total: 12345.67, free: 1000, invested: 11345.67, result: 345.67 }))
      .mockResolvedValueOnce(okResp([
        { ticker: 'AAPL_US_EQ', quantity: 10, currentPrice: 100, ppl: 50, fxPpl: 0 },
      ])) as any;
    const dash: any = await build('working-key').getDashboard();

    expect(dash.status).toBe('connected');
    expect(dash.readable).toBe(true);
    expect(dash.summary.totalValueGbp).toBe(12345.67);
    expect(dash.summary.positionCount).toBe(1);
    expect(dash.positions).toHaveLength(1);
    // No connection warning when it actually works, or the warning becomes noise nobody reads.
    expect(dash.warnings.find((x: any) => x.type === 'isa_connection')).toBeUndefined();
  });

  /**
   * THE HEADER IS THE FIX, SO IT GETS ITS OWN TEST (measured 2026-11-12).
   *
   * Trading212 rejects a key-only Authorization with 401 and accepts `Basic base64(key:secret)`.
   * The service sent the key alone, so every call failed while the dashboard said "connected".
   *
   * ⚠️ Asserted on the HEADER, not on the response: a test that only stubs a 200 proves the parsing
   * works, not that the request would ever be accepted. This repo's whole defect class is "the code
   * ran, the answer was wrong" — the header is where the wrongness lived.
   */
  it('sends HTTP BASIC with key:secret, not the bare key', async () => {
    process.env.TRADING212_ISA_API_KEY = 'k3y';
    process.env.TRADING212_ISA_API_SECRET = 's3cr3t';
    const fetchMock = jest.fn()
      .mockResolvedValue(okResp({ total: 1, free: 0, invested: 1, result: 0 })) as any;
    global.fetch = fetchMock;

    await new IsaService().getDashboard();

    const expected = `Basic ${Buffer.from('k3y:s3cr3t').toString('base64')}`;
    for (const call of fetchMock.mock.calls) {
      expect(call[1].headers.Authorization).toBe(expected);
    }
    delete process.env.TRADING212_ISA_API_SECRET;
  });

  // Direction check: with NO secret configured the header falls back to the bare key rather than
  // sending `Basic base64(key:)`, which fails in a less obvious way.
  it('falls back to the bare key when no secret is configured', async () => {
    process.env.TRADING212_ISA_API_KEY = 'k3y';
    delete process.env.TRADING212_ISA_API_SECRET;
    const fetchMock = jest.fn()
      .mockResolvedValue(okResp({ total: 1, free: 0, invested: 1, result: 0 })) as any;
    global.fetch = fetchMock;

    await new IsaService().getDashboard();

    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('k3y');
  });
});
