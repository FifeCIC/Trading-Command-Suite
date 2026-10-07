import { resolveAbArmAccounts } from './automation-loop.service';

/**
 * #1079 — AN A/B PAIR NEEDS TWO ACCOUNTS, OR IT IS NOT A COMPARISON.
 *
 * WHY THIS SUITE EXISTS
 *
 * The runner resolved ONE account for BOTH arms:
 *
 *     const brokerId = (controlCfg.brokerId ?? variantCfg.brokerId ?? 'mt5') as string;
 *
 * Measured 2026-10-07 against the two live snapshots of run `b50727ee`
 * (`SELECT JSON_EXTRACT(snapshot,'$.brokerId') FROM metastack_snapshot`): both carried `'mt5'`.
 *
 * ⚠️ WHAT ONE ACCOUNT DOES — and none of it is visible in a log line:
 *
 *   1. The broker NETS the arms. Three XAUUSD orders became ONE position of 0.04 (2026-09-23); ~9
 *      orders were booked into one position on 2026-09-30 (#1080). The two arms are then one
 *      position wearing two labels — nothing to measure, and nothing that a bigger sample fixes.
 *   2. The bots are locked out. `duplicate-guard.service.ts` counts any open position for
 *      `symbol + provider`, so while the pair held XAUUSD all 8 gold bots were refused it, and the
 *      pair was refused while they held it. A running test silently disables a bot family.
 *   3. The orders escape the safety chain entirely (they go `dispatchSideTrade` -> `placeOrder`,
 *      never `dispatchTrade`) — that half remains open on #1079 and is tracked by #1082.
 *
 * OWNER DIRECTION (2026-10-07, `external-systems-are-data.instructions.md`):
 *   > The pair must refuse to run when it cannot get two distinct, viable accounts — never fall
 *   > back to one.
 *
 * ⚠️ WHAT THIS SUITE CAN AND CANNOT COVER (stated, per the honest-partial rule)
 *
 * It covers the DECISION — that a shared or missing account is a refusal rather than a default.
 * It cannot exercise `runAbTest`, whose host service takes ~28 injected services, so the decision
 * is exported as a value with no `AbTest` and no position list in its signature: there is nothing
 * for a future edit to reach for to break the tie. Same technique as `authoritativeFromSnapshot()`
 * (#1058) and `TickDecisionScore` (#937).
 *
 * It does NOT cover the wiring end-to-end: that `runAbTest` refuses before scoring and passes
 * `accounts.accountA` / `accounts.accountB` to the two sides. That is a reviewed call site, plus
 * the SOURCE guard at the end of this file, which fails if the shared resolution returns.
 */

describe('resolveAbArmAccounts — two accounts or no orders (#1079)', () => {
  it('two distinct accounts pass, and are returned unchanged', () => {
    const r = resolveAbArmAccounts({ brokerId: 'account-a' }, { brokerId: 'account-b' });
    expect(r.ok).toBe(true);
    expect(r.refusal).toBeNull();
    expect(r.accountA).toBe('account-a');
    expect(r.accountB).toBe('account-b');
  });

  it('⚠️ THE CANARY — the same account on both arms is REFUSED, and the reason names the netting', () => {
    // This is the measured live state: both snapshots carried 'mt5'.
    const r = resolveAbArmAccounts({ brokerId: 'mt5' }, { brokerId: 'mt5' });
    expect(r.ok).toBe(false);
    // The reason must name WHY, because "refused" with no cause sends the operator to the wrong
    // place — the failure class this repo keeps finding is a plausible outcome with no explanation.
    //
    // ⚠️ `String(...)` rather than a narrowing `if (!r.ok)` block: `strictNullChecks: false`
    // erases the null arm of any union here, so `if (!r.ok)` was measured NOT to narrow — tsc
    // reported "Property 'refusal' does not exist on type 'AbArmAccounts'". Asserting on the
    // value directly is what survives the repo's actual compiler settings.
    expect(String(r.refusal)).toContain('one position');
    expect(String(r.refusal)).toMatch(/NETS|nets/);
    expect(String(r.refusal)).toContain('mt5');
    // And the accounts are NOT handed back, so nothing downstream can quietly use one anyway.
    expect(r.accountA).toBeNull();
    expect(r.accountB).toBeNull();
  });

  it('⚠️ a pair with ONE account does not fall back to it — arm A present, arm B missing', () => {
    // The old chain was `controlCfg.brokerId ?? variantCfg.brokerId` — a missing B silently
    // inherited A's account, which is how a pair that cannot be compared still placed orders.
    const r = resolveAbArmAccounts({ brokerId: 'mt5' }, {});
    expect(r.ok).toBe(false);
    expect(String(r.refusal)).toContain('arm B');
  });

  it('⚠️ and not the other way round — arm B present, arm A missing', () => {
    const r = resolveAbArmAccounts({}, { brokerId: 'mt5' });
    expect(r.ok).toBe(false);
    expect(String(r.refusal)).toContain('arm A');
  });

  it('neither arm naming an account is refused (the 4th state is not a licence to guess)', () => {
    const r = resolveAbArmAccounts({}, {});
    expect(r.ok).toBe(false);
    expect(String(r.refusal)).toContain('neither');
  });

  it('does not coerce a truthy non-string, or whitespace, into an account', () => {
    // A shape that carries the wrong type must not be read as permission to place an order. Same
    // rule as `authoritativeFromSnapshot`'s truthy-value test: `1` and `'true'` are not accounts,
    // and `'  '` names nothing.
    const cases: Array<[any, any]> = [
      [{ brokerId: 1 }, { brokerId: 2 }],
      [{ brokerId: true }, { brokerId: 'b' }],
      [{ brokerId: '  ' }, { brokerId: 'b' }],
      [{ brokerId: 'a' }, { brokerId: '' }],
      [{ brokerId: null }, { brokerId: undefined }],
    ];
    for (const [c, v] of cases) {
      expect(resolveAbArmAccounts(c, v).ok).toBe(false);
    }
  });

  it('trims, so " a " and "a" are the SAME account and are refused as duplicates', () => {
    // ⚠️ Not cosmetic: without trimming, `' mt5'` and `'mt5'` would pass as two distinct accounts
    // and the pair would net — the exact defect this suite exists to stop, reached by a typo.
    const r = resolveAbArmAccounts({ brokerId: ' mt5 ' }, { brokerId: 'mt5' });
    expect(r.ok).toBe(false);
  });

  /**
   * ⚠️ THE CALL-SITE GUARD — a SOURCE check on purpose.
   *
   * The narrowed return type stops the FUNCTION expressing a shared account, but it cannot stop a
   * future edit restoring the old line at the CALL SITE:
   *     const brokerId = (controlCfg.brokerId ?? variantCfg.brokerId ?? 'mt5') as string;
   * …which is what actually placed both arms' orders on one account. #1079's acceptance requires a
   * regression test that fails if that shape returns, so this reads the real source rather than
   * trusting the helper's signature.
   *
   * ⚠️ DELIBERATELY NARROW: one file, `const brokerId =` assignments only. A broad "no `??` in the
   * A/B runner" rule would fire on the legitimate option lookups beside it and be allowlisted
   * within a week — an allowlisted guard is worse than none.
   */
  it('⚠️ THE SOURCE no longer resolves ONE account to be shared by BOTH arms', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, 'automation-loop.service.ts'),
      'utf8',
    ) as string;

    const assignments = src
      .split(/\r?\n/)
      // ⚠️ COMMENT LINES ARE EXCLUDED, AND THIS IS NOT COSMETIC. The docblock above `runAbTest`
      // deliberately QUOTES the old line so the next reader can see what was replaced — and on the
      // first run of this guard that quote was the only thing it matched. A guard that fails on
      // its own explanation is a false positive, and the standard repair for a false positive is an
      // allowlist, which is worse than no guard at all. So: code only.
      .filter((l: string) => {
        const t = l.trim();
        return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*');
      })
      .filter((l: string) => /const\s+brokerId\s*=/.test(l));

    // ⚠️ NARROWED A SECOND TIME, AND BOTH NARROWINGS WERE PAID FOR BY A FALSE POSITIVE.
    //
    // The first draft was "no `const brokerId =` line may contain `??`", which matched:
    //   (a) my own docblock quoting the old line, and — after that was excluded —
    //   (b) the BOT's own account resolution at L2165: `strategy.brokerId || 'mt5'`.
    //
    // (b) is not this defect and is not even in this function; a guard that fires on unrelated
    // code gets allowlisted within a week, and an allowlisted guard is worse than none. The defect
    // shape is specifically "resolve an account FROM THE A/B CONFIGS", so that is all this matches.
    const sharedResolution = assignments.filter(
      (l: string) => /controlCfg|variantCfg/.test(l),
    );
    expect(sharedResolution).toEqual([]);

    // A check that inspects nothing must not report OK. The two asserts above pass vacuously on an
    // empty or renamed file, so the search is proved MEANINGFUL: the A/B configs must still be in
    // use here, and the account refusal must still be wired.
    expect(src).toContain('resolveAbArmAccounts(controlCfg, variantCfg)');
    expect(src).toContain('const accounts = resolveAbArmAccounts(');
    expect(src).toContain('if (!accounts.ok)');

    // The refusal must be wired, and the two sides must be handed DIFFERENT values. If either
    // call site were changed to pass the same account, the suite above would still pass.
    expect(src).toContain('resolveAbArmAccounts(controlCfg, variantCfg)');
    expect(src).toContain("evalSide('A', controlCfg, scoreA, accounts.accountA)");
    expect(src).toContain("evalSide('B', variantCfg, scoreB, accounts.accountB)");
  });
});
