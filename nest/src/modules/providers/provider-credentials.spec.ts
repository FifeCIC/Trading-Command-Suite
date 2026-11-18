/**
 * provider-credentials.spec.ts — a broker that is trading must not report "not configured" (#1259).
 *
 * ⚠️ THE DEFECT. `providers.module.ts` registers MT5 with `apiKeyEnv: 'MT5_ACCOUNT'`; `nest/.env`
 * defines `MT5_ACCOUNT_1..4` and never the bare name. So `hasCredentials('mt5')` was permanently
 * false and `/api/providers/health` + `/api/brokers/status` reported
 * `credentialsConfigured: false` **while MT5 was placing orders**. Measured 2026-11-10:
 * `mt5  tradingEnabled=True  canPlaceOrder=True  credentialsConfigured=False`.
 *
 * Both directions are asserted, because the opposite mistake is just as costly: counting a
 * look-alike variable (`MT5_ACCOUNT_EXTRA`) would report configured for a broker with no usable
 * credentials.
 */
import { hasNumberedVariant } from './adapter-factory';

describe('hasNumberedVariant — `_1`.._n` counts, a shared prefix does not', () => {
  it('⚠️ the measured case: MT5_ACCOUNT_1..4 with no bare MT5_ACCOUNT', () => {
    const env = {
      MT5_ACCOUNT_1: '1001',
      MT5_ACCOUNT_2: '1002',
      MT5_ACCOUNT_3: '1003',
      MT5_ACCOUNT_4: '1004',
    };
    expect(hasNumberedVariant(env, 'MT5_ACCOUNT')).toBe(true);
  });

  it('a single numbered variable is enough', () => {
    expect(hasNumberedVariant({ MT5_ACCOUNT_1: '1001' }, 'MT5_ACCOUNT')).toBe(true);
  });

  it('⚠️ a shared PREFIX is not a credential — MT5_ACCOUNT_EXTRA must not count', () => {
    expect(hasNumberedVariant({ MT5_ACCOUNT_EXTRA: 'x' }, 'MT5_ACCOUNT')).toBe(false);
    expect(hasNumberedVariant({ MT5_ACCOUNT_OLD: 'x', MT5_ACCOUNT_BACKUP: 'y' }, 'MT5_ACCOUNT')).toBe(false);
  });

  it('⚠️ a numbered name with an EMPTY value is a placeholder, not an account', () => {
    expect(hasNumberedVariant({ MT5_ACCOUNT_1: '' }, 'MT5_ACCOUNT')).toBe(false);
  });

  it('an unrelated variable is not a match', () => {
    expect(hasNumberedVariant({ MT4_ACCOUNT_1: 'x' }, 'MT5_ACCOUNT')).toBe(false);
  });

  it('the bare name alone is NOT what this helper answers — the caller checks it first', () => {
    // `hasCredentials` returns true on the exact name before reaching here. This pins the contract so
    // a future edit cannot make this helper silently answer a DIFFERENT question.
    expect(hasNumberedVariant({ MT5_ACCOUNT: 'x' }, 'MT5_ACCOUNT')).toBe(false);
  });

  it('underscores and regex-special characters in the key are treated literally', () => {
    expect(hasNumberedVariant({ 'MY.KEY_1': 'v' }, 'MY.KEY')).toBe(true);
    // `.` must not act as a wildcard: `MYXKEY_1` shares no real prefix with `MY.KEY`.
    expect(hasNumberedVariant({ MYXKEY_1: 'v' }, 'MY.KEY')).toBe(false);
  });

  it('an empty environment is false, not an error', () => {
    expect(hasNumberedVariant({}, 'MT5_ACCOUNT')).toBe(false);
  });
});
