import {
  decideExperiment,
  isMarketOpenNow,
  decideObjectiveReview,
  OBJECTIVE_RULES,
  projectEtaDays,
  EXPERIMENT_RULES,
  ExperimentFacts,
} from './experiment-decision';

/**
 * experiment-decision.spec.ts — the lifecycle rule, branch by branch.
 *
 * ⚠️ WHY THIS SPEC EXISTS. An unbranched rule is a decoration: it reads well, fires never, and
 * nothing notices. Every action below is asserted with a fixture that reaches it, and the ORDERING
 * cases (DECIDE above BLOCKED, ARCHIVED above everything) are pinned — because "first match wins"
 * is the policy, and a silent reorder would change what the app tells an agent to do without
 * changing a single message.
 *
 * CANARY (recorded 2026-11-06, both directions — a guard must be observed to fail):
 *   • delete the `assessment.outcome === 'ok'` branch  → 'DECIDE on a full sample' fails
 *   • move the BLOCKED check above DECIDE              → 'DECIDE survives a bot that was switched off later' fails
 *   • drop the `measurable === false` branch           → 'NO-ARMS' fails
 *   • return `0` instead of `null` from projectEtaDays → 'no closed trades has no projection' fails
 * Restore and confirm the suite is green again before trusting any of it.
 */

const NOW = new Date('2026-11-06T12:00:00.000Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);
const daysAhead = (d: number) => new Date(NOW.getTime() + d * 86_400_000);

function facts(over: Partial<ExperimentFacts> = {}): ExperimentFacts {
  return {
    kind: 'ab-test',
    id: 'exp-1',
    title: 'Harness experiment',
    status: 'running',
    startedAt: daysAgo(3),
    reviewBy: daysAhead(11),
    now: NOW,
    sides: [
      { label: 'control', n: 4 },
      { label: 'variant', n: 5 },
    ],
    lastSampleAt: daysAgo(1),
    canCollect: true,
    blockedReason: null,
    measurable: true,
    winner: null,
    ...over,
  };
}

describe('decideExperiment — the lifecycle rule', () => {
  it('RUNNING while the sample is short and the producer can still collect', () => {
    const d = decideExperiment(facts());
    expect(d.action).toBe('RUNNING');
    expect(d.requiredPerSide).toBe(30);
    expect(d.nextStep).toMatch(/leave it alone/i);
  });

  it('DECIDE on a full sample, and names the winner in the next step', () => {
    const d = decideExperiment(
      facts({
        sides: [
          { label: 'control', n: 31 },
          { label: 'variant', n: 34 },
        ],
        winner: 'variant',
      }),
    );
    expect(d.action).toBe('DECIDE');
    expect(d.nextStep).toContain('variant');
  });

  it('DECIDE survives a bot that was switched off later — its question is already answered', () => {
    // The ordering case: BLOCKED must not outrank DECIDE. A test that reached the bar and whose bot
    // then went inactive is FINISHED, not obstructed.
    const d = decideExperiment(
      facts({
        canCollect: false,
        blockedReason: 'every bot on ss-1 is inactive',
        sides: [
          { label: 'control', n: 30 },
          { label: 'variant', n: 30 },
        ],
      }),
    );
    expect(d.action).toBe('DECIDE');
  });

  it('BLOCKED when nothing can arrive and the sample is short — the 2026-11-06 case', () => {
    const d = decideExperiment(
      facts({ canCollect: false, blockedReason: 'every bot on ss-1 is inactive' }),
    );
    expect(d.action).toBe('BLOCKED');
    expect(d.reason).toContain('inactive');
    expect(d.nextStep).toMatch(/kill|activate/i);
  });

  it('UNMEASURED when a side was never recorded — null is not zero', () => {
    const d = decideExperiment(
      facts({
        sides: [
          { label: 'control', n: 8 },
          { label: 'variant', n: null },
        ],
      }),
    );
    expect(d.action).toBe('UNMEASURED');
    expect(d.n.variant).toBeNull();
  });

  it('NO-ARMS when the arms differ only in inert fields, however big the sample', () => {
    const d = decideExperiment(
      facts({
        measurable: false,
        sides: [
          { label: 'control', n: 100 },
          { label: 'variant', n: 100 },
        ],
      }),
    );
    expect(d.action).toBe('NO-ARMS');
  });

  it('ARCHIVED for a cancelled run, with no instruction to investigate', () => {
    const d = decideExperiment(facts({ status: 'cancelled' }));
    expect(d.action).toBe('ARCHIVED');
    expect(d.nextStep).toMatch(/nothing to do/i);
  });

  it('ARCHIVED for a complete run even though the sample looks short', () => {
    const d = decideExperiment(facts({ status: 'complete' }));
    expect(d.action).toBe('ARCHIVED');
  });

  it('INCONCLUSIVE once the review date passes without a usable sample', () => {
    const d = decideExperiment(facts({ reviewBy: daysAgo(2) }));
    expect(d.action).toBe('INCONCLUSIVE');
    expect(d.daysLeft).toBeLessThan(0);
    expect(d.nextStep).toMatch(/inconclusive/i);
  });

  it('STALLED when nothing has closed for the stall window', () => {
    const d = decideExperiment(facts({ lastSampleAt: daysAgo(EXPERIMENT_RULES.stallDays + 1) }));
    expect(d.action).toBe('STALLED');
    expect(d.reason).toContain(String(EXPERIMENT_RULES.stallDays + 1));
  });

  it('STALLED when nothing has EVER closed and the deadline is close', () => {
    const d = decideExperiment(facts({ lastSampleAt: null, reviewBy: daysAhead(2) }));
    expect(d.action).toBe('STALLED');
  });

  it('a fresh experiment with no closed trade yet is still RUNNING, not stalled', () => {
    // The mirror of the case above: the STALLED branch must not fire on every new experiment, or it
    // becomes a false positive and gets ignored.
    const d = decideExperiment(
      facts({
        startedAt: daysAgo(0.2),
        lastSampleAt: null,
        reviewBy: daysAhead(12),
        sides: [
          { label: 'control', n: 0 },
          { label: 'variant', n: 0 },
        ],
      }),
    );
    expect(d.action).toBe('RUNNING');
    expect(d.etaDays).toBeNull();
  });

  it('canCollect === null is NOT treated as "fine" — it falls through to the sample test', () => {
    // A null must never be the reason an experiment looks healthy. Here the short sample decides.
    const d = decideExperiment(facts({ canCollect: null }));
    expect(d.action).toBe('RUNNING');
  });
});

describe('projectEtaDays — a projection or an honest null', () => {
  it('projects from the observed rate of the SLOWER side', () => {
    const eta = projectEtaDays(facts({ startedAt: daysAgo(10) }));
    // 9 closed over 10 days ≈ 0.9/day, so ~0.45/side/day; 25 still needed on the short side (4).
    expect(eta).toBeGreaterThan(0);
    expect(eta).toBeLessThan(200);
  });

  it('has NO projection when nothing has closed — 0 would read as "about to happen"', () => {
    const eta = projectEtaDays(
      facts({
        sides: [
          { label: 'control', n: 0 },
          { label: 'variant', n: 0 },
        ],
      }),
    );
    expect(eta).toBeNull();
  });

  it('has NO projection without a start date', () => {
    expect(projectEtaDays(facts({ startedAt: null }))).toBeNull();
  });

  it('projects 0 when the bar is already cleared', () => {
    const eta = projectEtaDays(
      facts({
        sides: [
          { label: 'control', n: 40 },
          { label: 'variant', n: 41 },
        ],
      }),
    );
    expect(eta).toBe(0);
  });
});

describe('decideObjectiveReview — a promise has a DATE, not a sample', () => {
  const obj = (over: any = {}) => ({
    id: 'o1', title: 'Check the pair', status: 'active', targetDate: daysAhead(20), now: NOW,
    progressPct: 0, description: null, ...over,
  });

  it('OVERDUE once the date passes while still active', () => {
    const r = decideObjectiveReview(obj({ targetDate: daysAgo(3), progressPct: 40 }));
    expect(r.action).toBe('OVERDUE');
    expect(r.daysLeft).toBeLessThan(0);
    expect(r.reason).toContain('3 day(s)');
    expect(r.nextStep).toMatch(/close the loop/i);
  });

  it('DUE-SOON inside the window — and it says look NOW, not on the day', () => {
    const r = decideObjectiveReview(obj({ targetDate: daysAhead(OBJECTIVE_RULES.dueSoonDays) }));
    expect(r.action).toBe('DUE-SOON');
    expect(r.nextStep).toMatch(/NOW/);
  });

  it('ON-TIME well before the date, with the instruction to leave it alone', () => {
    const r = decideObjectiveReview(obj());
    expect(r.action).toBe('ON-TIME');
    expect(r.nextStep).toMatch(/leave it alone/i);
  });

  it('NO-DATE is a FINDING, not a blank — an undated promise never prompts a check', () => {
    const r = decideObjectiveReview(obj({ targetDate: null }));
    expect(r.action).toBe('NO-DATE');
    expect(r.reason).toMatch(/months/);
  });

  it('SETTLED wins over a passed date — an achieved objective is not overdue', () => {
    const r = decideObjectiveReview(obj({ status: 'achieved', targetDate: daysAgo(30) }));
    expect(r.action).toBe('SETTLED');
    expect(r.nextStep).toMatch(/nothing to do/i);
  });

  it('flags a falsifiable prediction so a reviewer knows the test was written down', () => {
    expect(decideObjectiveReview(obj({ description: 'PREDICTION: the twin wins more often.' })).hasPrediction).toBe(true);
    expect(decideObjectiveReview(obj({ description: 'FALSIFIED IF the control wins.' })).hasPrediction).toBe(true);
    expect(decideObjectiveReview(obj({ description: 'just a note' })).hasPrediction).toBe(false);
  });

  it('never treats progressPct as a sample size — the reason quotes it as a percentage', () => {
    const r = decideObjectiveReview(obj({ targetDate: daysAgo(1), progressPct: 62 }));
    expect(r.reason).toContain('62%');
    expect(r).not.toHaveProperty('requiredPerSide');
  });
});
describe('PAUSED-MARKET — a shut market is not a stall (#1210 follow-up)', () => {
  // Friday 2026-11-06 23:27 UTC, measured: FX stopped at 21:59:5x, crypto kept scoring.
  const FRIDAY = new Date('2026-11-06T23:27:00.000Z');
  const SATURDAY = new Date('2026-11-07T12:00:00.000Z');
  const MONDAY = new Date('2026-11-09T12:00:00.000Z');

  it('isMarketOpenNow: crypto is 24/7', () => {
    expect(isMarketOpenNow('crypto', SATURDAY)).toBe(true);
    expect(isMarketOpenNow('crypto', FRIDAY)).toBe(true);
  });

  it('isMarketOpenNow: non-crypto is shut at the weekend and open on a weekday', () => {
    expect(isMarketOpenNow('forex', SATURDAY)).toBe(false);
    expect(isMarketOpenNow('index', SATURDAY)).toBe(false);
    expect(isMarketOpenNow('forex', MONDAY)).toBe(true);
  });

  it('isMarketOpenNow: an unknown class is NULL, never a guess', () => {
    expect(isMarketOpenNow(null, SATURDAY)).toBeNull();
    expect(isMarketOpenNow('', SATURDAY)).toBeNull();
  });

  const idleForDays = (d: number) => facts({
    lastSampleAt: daysAgo(d),
    reviewBy: daysAhead(40),
  });

  it('a weekend on a non-crypto symbol is PAUSED-MARKET, not STALLED', () => {
    const d = decideExperiment({ ...idleForDays(9), now: SATURDAY, marketOpen: false });
    expect(d.action).toBe('PAUSED-MARKET');
    expect(d.nextStep).toMatch(/resumes when the market reopens/i);
  });

  it('the same 9-day idle WITHOUT the market fact is still STALLED — the old behaviour is intact', () => {
    const d = decideExperiment({ ...idleForDays(9), now: SATURDAY, marketOpen: null });
    expect(d.action).toBe('STALLED');
  });

  it('crypto past its idle window is STALLED even at the weekend — it CAN trade', () => {
    const d = decideExperiment({ ...idleForDays(9), now: SATURDAY, marketOpen: true });
    expect(d.action).toBe('STALLED');
  });

  it('DECIDE outranks PAUSED-MARKET — a finished experiment is finished', () => {
    const d = decideExperiment(facts({
      now: SATURDAY, marketOpen: false,
      sides: [{ label: 'control', n: 30 }, { label: 'variant', n: 31 }],
    }));
    expect(d.action).toBe('DECIDE');
  });

  it('INCONCLUSIVE outranks PAUSED-MARKET — a missed deadline is still a missed deadline', () => {
    const d = decideExperiment(facts({
      now: SATURDAY, marketOpen: false, reviewBy: daysAgo(3),
    }));
    expect(d.action).toBe('INCONCLUSIVE');
  });
});