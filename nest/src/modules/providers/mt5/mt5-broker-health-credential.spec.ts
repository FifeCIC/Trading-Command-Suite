/**
 * mt5-broker-health-credential.spec.ts — the #1035 fields must REACH THE API, not just the bridge.
 *
 * ⚠️ THE DEFECT THIS PINS (#1035). The bridge published `credentialMismatch` and `orderReady` on
 * `/health`, refused every order while attached to the wrong account, and **nothing in `nest/src`
 * read either field** — a grep returned nothing. That is the buried-ability shape on a money path:
 * the bridge knew, the app did not.
 *
 * ⚠️ WHY A SPEC AND NOT ONLY A LIVE CURL. The live end-to-end observation requires pointing the
 * running API at a deliberately MISMATCHED bridge. With `MT5_ACTIVE_BROKERS=2,3` that means either
 *   (a) repointing slot 2 at the canary — which makes a live broker's real positions look ABSENT,
 *       and `PositionSyncService` treats absence as closure ("0 closed, 0 stranded" is a claim it
 *       earns by reading every active broker); or
 *   (b) adding a canary slot — which puts a second account's book into position scope.
 * Both risk corrupting a money-path record to tick a checkbox, so the mapping is pinned here
 * instead, and the live mismatch observation is left for a controlled window.
 *
 * ⚠️ `process.env` is read in the CONSTRUCTOR, so the env is set immediately before `new`. Leaking
 * it would change every subsequent manager in the same file — the reason it is restored in
 * `afterEach` rather than at the end of each case.
 */
import { Mt5ConnectionManager } from './mt5-connection-manager.service';

const SAVED_ENV = { ...process.env };
const realFetch = global.fetch;

/** The shape the bridge actually sends when it is attached to the wrong account. */
const MISMATCH = {
  requested: { account: '99999999', server: 'NoSuchServer-Demo' },
  actual: { account: '10011309743', server: 'MetaQuotes-Demo' },
  reason: 'initialize(path=…) attached to the account the running terminal held',
};

function stubHealth(payload: any) {
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => payload,
  })) as any;
}

function managerFor(brokers: string) {
  process.env.MT5_ACTIVE_BROKERS = brokers;
  return new Mt5ConnectionManager();
}

describe('Mt5ConnectionManager.getAllBrokerHealths — #1035 fields survive the hop to the API', () => {
  afterEach(() => {
    process.env = { ...SAVED_ENV };
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  it('carries a NON-NULL credentialMismatch and orderReady:false — the money-relevant direction', async () => {
    const conn = managerFor('2');
    stubHealth({ connected: true, connectionState: 'ok', credentialMismatch: MISMATCH, orderReady: false });

    const [b] = await conn.getAllBrokerHealths();

    // ⚠️ The whole point: `connected: true` and `orderReady: false` together. The session is UP on
    // the WRONG BOOK. Collapsing this into `connectionState` would recreate the conflation.
    expect(b.health?.connected).toBe(true);
    expect(b.credentialMismatch).toEqual(MISMATCH);
    expect(b.orderReady).toBe(false);
  });

  it('carries null / true for a healthy bridge — so the field cannot be a constant', async () => {
    const conn = managerFor('2');
    stubHealth({ connected: true, connectionState: 'ok', credentialMismatch: null, orderReady: true });

    const [b] = await conn.getAllBrokerHealths();

    expect(b.credentialMismatch).toBeNull();
    expect(b.orderReady).toBe(true);
  });

  it('defaults both to null when the bridge omits them — absent is not "safe"', async () => {
    const conn = managerFor('2');
    stubHealth({ connected: true, connectionState: 'ok' });

    const [b] = await conn.getAllBrokerHealths();

    // ⚠️ An older bridge that never sends the field must read as UNKNOWN (null), never as `false`
    // (which would look like a refusal) and never as `true` (which would look like permission).
    expect(b.credentialMismatch).toBeNull();
    expect(b.orderReady).toBeNull();
  });

  it('keeps the mismatch per-BROKER — one wrong book must not mark the others', async () => {
    const conn = managerFor('2,3');
    // ⚠️ Keyed on the broker's URL, NOT on call order. `getAllBrokerHealths` fans out with
    // Promise.all, so a counter is a race — my first version used one and failed for exactly that
    // reason. The URL is the broker's identity (slot 2 → :5000, slot 3 → :5001 in list order).
    global.fetch = jest.fn(async (url: any) => ({
      ok: true,
      status: 200,
      json: async () => (String(url).includes(':5000')
        ? { connected: true, connectionState: 'ok', credentialMismatch: MISMATCH, orderReady: false }
        : { connected: true, connectionState: 'ok', credentialMismatch: null, orderReady: true }),
    })) as any;

    const results = await conn.getAllBrokerHealths();
    const byId = new Map(results.map((r) => [r.brokerId, r]));

    expect(byId.size).toBe(2);
    expect(byId.get(2)!.orderReady).toBe(false);
    expect(byId.get(2)!.credentialMismatch).toEqual(MISMATCH);
    expect(byId.get(3)!.orderReady).toBe(true);
    expect(byId.get(3)!.credentialMismatch).toBeNull();
  });

  it('reports an unreachable bridge as answered:false rather than a silent healthy row', async () => {
    const conn = managerFor('2');
    global.fetch = jest.fn(async () => { throw new Error('ECONNREFUSED'); }) as any;

    const [b] = await conn.getAllBrokerHealths();

    expect(b.answered).toBe(false);
    expect(b.reachable).toBe(false);
    // A bridge that did not answer must not report the wrong-account field at all.
    expect(b.credentialMismatch).toBeNull();
  });
});
