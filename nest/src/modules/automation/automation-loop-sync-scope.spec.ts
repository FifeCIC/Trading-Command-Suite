import { resolveSyncAccountScope } from './automation-loop.service';

/**
 * #1101 — the sync scope is the QUERIED set, not the payload's composition.
 *
 * WHY THIS SUITE EXISTS
 * ---------------------
 * `syncPositions()` reconciles by asking "is this trade's ticket in MY snapshot?" and treats
 * absence as closure. That question is only valid for accounts the snapshot actually COVERED.
 * The scope used to be derived from the accounts PRESENT in the payload, so a routed broker that
 * legitimately held nothing vanished from its own reconciliation.
 *
 * MEASURED 2026-10-08/09: broker 3's three positions (US30/US500/VIX) were closed by hand at
 * 22:10:54Z. From the next tick the payload held only broker 2's rows, the scope collapsed to
 * broker 2, and broker 3's three `trade` rows sat `open` with no broker counterpart for 20h+ —
 * silently, because `mayJudgeTrade()` correctly refuses to judge another account.
 *
 * ⚠️ THE FIRST CASE IS THE MEASURED SHAPE ITSELF and must fail on the old derivation
 * (narrow-when-one-account-present): two accounts QUERIED, payload holds only one.
 */

const A = '10011309743'; // MetaQuotes-Demo (broker 2)
const B = '62148195';    // PepperstoneUK-Demo (broker 3)

describe('resolveSyncAccountScope — the scope comes from what was QUERIED', () => {
  it('THE MEASURED REGRESSION — two queried, broker 3 empty → merged (all-accounts scope)', () => {
    // 2026-10-09: broker 3 hand-closed to zero; the payload held broker 2's five rows only.
    // The old derivation scoped the sync to A, and broker 3's rows could never be finalised.
    const scope = resolveSyncAccountScope({
      queriedAccountIds: [A, B],
      payloadAccountIds: [A, A, A, A, A],
    });
    expect(scope.merged).toBe(true);
    expect(scope.singleAccount).toBeNull();
  });

  it('two queried accounts, payload holds both → merged', () => {
    const scope = resolveSyncAccountScope({
      queriedAccountIds: [A, B],
      payloadAccountIds: [A, B, A],
    });
    expect(scope.merged).toBe(true);
  });

  it('ONE queried account, payload A → narrowed to A (unchanged behaviour)', () => {
    const scope = resolveSyncAccountScope({
      queriedAccountIds: [A],
      payloadAccountIds: [A, A],
    });
    expect(scope.merged).toBe(false);
    expect(scope.singleAccount).toBe(A);
  });

  it('no router (empty queried set), payload A → narrowed to A (single-bridge install)', () => {
    const scope = resolveSyncAccountScope({ queriedAccountIds: [], payloadAccountIds: [A] });
    expect(scope.merged).toBe(false);
    expect(scope.singleAccount).toBe(A);
  });

  it('nothing queried, empty payload → null (caller falls back to getAccount())', () => {
    const scope = resolveSyncAccountScope({ queriedAccountIds: [], payloadAccountIds: [] });
    expect(scope.merged).toBe(false);
    expect(scope.singleAccount).toBeNull();
  });

  it('null/undefined account ids never fabricate a scope', () => {
    const scope = resolveSyncAccountScope({
      queriedAccountIds: [],
      payloadAccountIds: [null, undefined, null],
    });
    expect(scope.singleAccount).toBeNull();
    expect(scope.merged).toBe(false);
  });

  /**
   * ⚠️ THE CALL-SITE GUARD — a SOURCE check on purpose, mirroring `ab-arm-accounts.spec.ts`.
   *
   * The unit cases above hold the FUNCTION; they cannot hold the WIRING. If the call site
   * returned to a payload-composition derivation while the helper stayed correct, every case
   * above would still pass — the same shape that let #883's comment and its code disagree.
   */
  it('⚠️ THE SOURCE derives the scope from the queried accounts, not the payload', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, 'automation-loop.service.ts'),
      'utf8',
    ) as string;

    // The wiring itself.
    expect(src).toContain('resolveSyncAccountScope({');
    expect(src).toContain('queriedAccountIds: adapter.getQueriedAccountIds?.() ?? []');

    // ⚠️ And the OLD identifier is GONE from the source entirely — not merely unused. It was
    // the payload-composition derivation; leaving it behind invites the next edit to re-use it.
    expect(src).not.toContain('distinctAccounts');
  });
});
