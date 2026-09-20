/**
 * close-reason.spec.ts — the close-attribution vocabulary (#916).
 *
 * ⚠️ Why two pure functions get a test: this mapping is what stands between "we know who closed
 * it" and the 2026-09-18 investigation that produced suspects and no cause. The contract is a
 * PRECEDENCE — a comment that names the actor beats the deal-reason enum, and an absent value is
 * reported as an honest unknown, never as a guess that reads like knowledge.
 */
import { CLOSE_REASONS, closeReasonFromComment, closeReasonFromDealReason } from './close-reason';

describe('closeReasonFromDealReason', () => {
  it.each([
    [4, CLOSE_REASONS.BROKER_SL],
    [5, CLOSE_REASONS.BROKER_TP],
    [6, CLOSE_REASONS.BROKER_STOP_OUT],
  ])('maps MT5 deal reason %i', (n, expected) => {
    expect(closeReasonFromDealReason(n as number)).toBe(expected);
  });

  it.each([0, 1, 2, 3, 7, 8, 9])('maps %i to broker:terminal', (n) => {
    expect(closeReasonFromDealReason(n)).toBe(CLOSE_REASONS.BROKER_TERMINAL);
  });

  it('maps undefined/null to broker:unknown — never to a guess', () => {
    expect(closeReasonFromDealReason(undefined)).toBe(CLOSE_REASONS.BROKER_UNKNOWN);
    expect(closeReasonFromDealReason(null)).toBe(CLOSE_REASONS.BROKER_UNKNOWN);
    expect(closeReasonFromDealReason(99)).toBe(CLOSE_REASONS.BROKER_UNKNOWN);
  });
});

describe('closeReasonFromComment (#916)', () => {
  it('names the ACTOR when the bridge stamped it onto the closing deal', () => {
    expect(closeReasonFromComment('TCS:time-stop')).toBe(CLOSE_REASONS.SYSTEM_TIME_STOP);
    expect(closeReasonFromComment('TCS:manual')).toBe(CLOSE_REASONS.USER_MANUAL);
  });

  it('returns null for foreign/empty/unknown comments so the caller falls through to the enum', () => {
    for (const c of ['', '   ', '[sl 4291.78]', 'Close by TCS', 'TCS:unknown-origin', null, undefined]) {
      expect(closeReasonFromComment(c)).toBeNull();
    }
  });

  it('is anchored — a comment merely CONTAINING our prefix is not ours', () => {
    expect(closeReasonFromComment('xTCS:manual')).toBeNull();
    expect(closeReasonFromComment('TCS:manual extra')).toBeNull();
  });
});
