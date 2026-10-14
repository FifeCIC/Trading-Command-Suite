import { resolveRetentionDays, RETENTION_DAYS, RETENTION_TABLES } from './retention.config';

/**
 * #1117 — the EFFECTIVE retention window must be reportable, because a caller that reports a window
 * it did not measure is the defect, not the fix.
 *
 * ⚠️ WHY THIS EXISTS. `GET /api/scoring/gated/thresholds` computes each protocol's ceiling from a
 * pruned table and now declares the window as `ceilingWindowDays`. That number is only honest if it
 * is the window actually in force — so it must come from `resolveRetentionDays()`, never from a
 * literal `90` and never from `RETENTION_DAYS`, which is the derived DEFAULT and is wrong the moment
 * `DATA_RETENTION_SNAPSHOT_DAYS` is set.
 *
 * ⚠️ THE CASE THAT MATTERS IS THE OVERRIDE. The default is already correct in the payload, so a
 * hardcoded `90` would pass every test that only checks the default — and would silently misreport
 * the window on any deployment that tuned it.
 *
 * Canary: replacing the controller's `resolveRetentionDays('score_snapshot')` with the literal `90`
 * leaves this spec green (it tests the resolver, not the call site) — the call site is verified live
 * in the QA entry on the handoff. This spec pins the RESOLVER's contract.
 */
describe('resolveRetentionDays (#1117)', () => {
  const ENV = 'DATA_RETENTION_SNAPSHOT_DAYS';
  const original = process.env[ENV];

  afterEach(() => {
    if (original === undefined) delete process.env[ENV];
    else process.env[ENV] = original;
  });

  it('returns the declared default when no override is set', () => {
    delete process.env[ENV];
    expect(resolveRetentionDays('score_snapshot')).toBe(90);
    // …and that the default is genuinely 3× the `score` window, which is the #1115 cause.
    expect(resolveRetentionDays('score')).toBe(30);
    expect(resolveRetentionDays('score_snapshot')).toBeGreaterThan(resolveRetentionDays('score'));
  });

  it('honours the env override — the case a hardcoded `90` would get wrong', () => {
    process.env[ENV] = '45';
    expect(resolveRetentionDays('score_snapshot')).toBe(45);

    process.env[ENV] = '365';
    expect(resolveRetentionDays('score_snapshot')).toBe(365);
  });

  it('differs from the derived default constant, which is why the function exists', () => {
    process.env[ENV] = '7';
    expect(resolveRetentionDays('score_snapshot')).toBe(7);
    // The constant still reports the DEFAULT — a caller that read this instead would state a window
    // that is not in force. That is the whole reason for `resolveRetentionDays()`.
    expect(RETENTION_DAYS['score_snapshot']).toBe(90);
  });

  it('preserves the `0` quirk rather than silently fixing it', () => {
    // `parseInt('0' || default)` → 0, so an override of '0' means "prune everything older than now".
    // ⚠️ Pinned on purpose: it is existing behaviour, and changing it here would alter what the next
    // prune deletes. If it is ever fixed, that is a decision with a copied config, not a tidy-up.
    process.env[ENV] = '0';
    expect(resolveRetentionDays('score_snapshot')).toBe(0);
  });

  it('an empty override falls back to the default (the `||` in the original expression)', () => {
    process.env[ENV] = '';
    expect(resolveRetentionDays('score_snapshot')).toBe(90);
  });

  it('an unknown table is 0, not undefined — callers divide and compare with it', () => {
    expect(resolveRetentionDays('no_such_table')).toBe(0);
  });

  it('every declared table resolves to a finite number', () => {
    for (const table of Object.keys(RETENTION_TABLES)) {
      const days = resolveRetentionDays(table);
      expect(Number.isFinite(days)).toBe(true);
    }
  });
});
