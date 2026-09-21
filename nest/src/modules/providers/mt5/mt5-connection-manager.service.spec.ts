/**
 * Mt5ConnectionManager — broker id 0 is a REAL id (#914).
 * =======================================================
 *
 * The defect: `getUrl(brokerId?)` used `if (brokerId && …)`, so `0` — the id on the four crypto
 * `symbol_route` rows — was indistinguishable from "not specified" and silently returned the
 * DEFAULT bridge's URL. Every caller that asked about broker 0 was answered by MetaQuotes.
 *
 * Asserted in BOTH directions: a registered broker still resolves (restore), an unregistered one
 * throws rather than substituting the default (canary), and no id at all still means default.
 */

import { Mt5ConnectionManager } from './mt5-connection-manager.service';

describe('Mt5ConnectionManager.getUrl — distinction between 0 and "not specified" (#914)', () => {
  const saved = process.env.MT5_ACTIVE_BROKERS;

  beforeAll(() => {
    process.env.MT5_ACTIVE_BROKERS = '2,3';
  });

  afterAll(() => {
    if (saved === undefined) delete process.env.MT5_ACTIVE_BROKERS;
    else process.env.MT5_ACTIVE_BROKERS = saved;
  });

  it('no id → the default bridge (first active)', () => {
    const conn = new Mt5ConnectionManager();
    expect(conn.getUrl()).toBe('http://localhost:5000');
    expect(conn.getUrl(undefined)).toBe('http://localhost:5000');
  });

  it('a registered broker resolves to ITS bridge (restore direction)', () => {
    const conn = new Mt5ConnectionManager();
    expect(conn.getUrl(2)).toBe('http://localhost:5000');
    expect(conn.getUrl(3)).toBe('http://localhost:5001');
  });

  it('broker 0 THROWS — it must never be answered by the default bridge', () => {
    const conn = new Mt5ConnectionManager();

    expect(() => conn.getUrl(0)).toThrow(/not an MT5 bridge/);
  });

  it('isBroker() tells 0 and undefined apart — the falsy-zero canary', () => {
    const conn = new Mt5ConnectionManager();

    expect(conn.isBroker(2)).toBe(true);
    expect(conn.isBroker(3)).toBe(true);
    expect(conn.isBroker(0)).toBe(false);
    expect(conn.isBroker(undefined)).toBe(false);
    expect(conn.isBroker(null)).toBe(false);
  });
});
