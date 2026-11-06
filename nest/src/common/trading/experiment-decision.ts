/**
 * experiment-decision.ts — "is this experiment finished, and what do I DO about it?"
 *
 * ── WHY THIS EXISTS (2026-11-06, owner) ──────────────────────────────────────────────────────
 * > "I will need agentic AI to be able to pickup on A/B tests and decide how to proceed. Else we
 * > will have clutter and strategies that run for months needlessly."
 *
 * The repo already had the pieces and no judgement:
 *   • `verdict-bar.ts` decides whether a SAMPLE is big enough to speak (≥30 per side).
 *   • `ab-test.service.ts` refuses to name a winner below that bar — correctly.
 *   • `docs/SETTLED-DECISIONS.md` and the maths rule prescribe copied configurations.
 * What none of them answer is the LIFECYCLE question: an experiment that can never reach the bar,
 * or that passed its review date, or whose bot is switched off, is **not "running"** — it is a thing
 * to close. Measured the day this file was written: **both** live A/B tests were dead and nothing
 * said so. `b50727ee` was `cancelled` (never reported) and `a1bfc533` was `complete` with **0 v 0**
 * closed trades; both reported `tradeAuthority.reason: "every bot ... is inactive"`. Two dead
 * experiments rendered exactly like two live ones.
 *
 * ── THE ONE RULE THIS FILE DOES NOT DUPLICATE ────────────────────────────────────────────────
 * The sample bar is NOT redeclared here. `assessSamples()` owns it (#965's one-definition rule), so
 * this module only adds the lifecycle on top. A second bar would agree today and drift at the first
 * tuning — the exact technical debt `verdict-bar.ts` was created to remove.
 *
 * ── WHY A PURE FUNCTION ──────────────────────────────────────────────────────────────────────
 * No Prisma, no clock, no I/O: `now` is an input. A decision rule that reads the clock cannot be
 * tested for "the deadline passed", and a rule that cannot be tested for its own failure is a
 * decoration. `experiment-decision.spec.ts` canaries every branch, in both directions.
 */

import { assessSamples, MIN_SAMPLES_FOR_VERDICT, SampleSide } from './verdict-bar';

/**
 * Lifecycle policy — a DECISION, stated once, with its reverse.
 *
 * ⚠️ `stallDays: 7` is not arbitrary. Measured 2026-11-06: the only measurable A/B run collected
 * **13 closed trades in ~11 hours** and then stopped entirely when its bots were deactivated. Seven
 * days with no new closed trade is therefore not "a quiet week" — on this app it is a stopped
 * experiment. Narrow beats broad: a shorter window would fire on a weekend, and a guard that fires
 * on a weekend gets allowlisted.
 */
export const EXPERIMENT_RULES = {
  /** Days with no new closed trade before an experiment is called STALLED. */
  stallDays: 7,
  /** Used when a test carries no `endAt` of its own. Review, not result. */
  defaultReviewDays: 14,
} as const;

export type ExperimentKind = 'ab-test' | 'bot-pair';

/**
 * What to do. Ordered from "nothing" to "act now" — the ORDER is the rule, and it is enforced by
 * the sequence of checks in `decideExperiment()`.
 */
export type ExperimentAction =
  | 'ARCHIVED'      // cancelled / complete / already decided: no decision is outstanding
  | 'NO-ARMS'       // the two sides cannot differ, so the experiment cannot answer its question
  | 'BLOCKED'       // data cannot arrive (no active bot, disabled stack) — fix it or kill it
  | 'UNMEASURED'    // a side's sample was never recorded: "not measured" is not "no trades"
  | 'DECIDE'        // the sample cleared the bar: name the winner and act on it
  | 'INCONCLUSIVE'  // the review date passed without a usable sample: close it, say why
  | 'STALLED'       // no new closed trade for `stallDays`: fix it or kill it
  | 'RUNNING';      // genuinely collecting: leave it alone

export interface ExperimentFacts {
  kind: ExperimentKind;
  id: string;
  title: string;
  /** Raw status from the record — `running` | `complete` | `cancelled` for an A/B test. */
  status: string;
  startedAt: Date | null;
  /** The date by which a decision was promised. `null` means the caller supplied none. */
  reviewBy: Date | null;
  now: Date;
  sides: SampleSide[];
  /** When the most recent closed sample landed. `null` = never. */
  lastSampleAt: Date | null;
  /**
   * Can data reach this experiment at all? `null` means **cannot judge** — never defaulted to
   * `true`, because a default of "it's fine" is how a dead experiment stays invisible.
   */
  canCollect: boolean | null;
  /** Why not, in the producer's own words (e.g. "every bot on ss-… is inactive"). */
  blockedReason?: string | null;
  /** `ab_test.results.arms.measurable` — false when the arms differ only in INERT fields. */
  measurable?: boolean | null;
  /** Only meaningful at DECIDE. `null` when the winner is not determinable. */
  winner?: string | null;
}

export interface ExperimentDecision {
  kind: ExperimentKind;
  id: string;
  title: string;
  action: ExperimentAction;
  /** One line: why this action and not another. */
  reason: string;
  /** Imperative, one sentence, safe for an agent to act on. Never "investigate further". */
  nextStep: string;
  requiredPerSide: number;
  n: Record<string, number | null>;
  /** Whole days until `reviewBy`; negative when it has passed; null when no date was given. */
  daysLeft: number | null;
  /** Projected days to clear the bar at the observed rate. null when it cannot be projected. */
  etaDays: number | null;
}

const DAY_MS = 86_400_000;

function daysBetween(a: Date, b: Date): number {
  return Math.floor((a.getTime() - b.getTime()) / DAY_MS);
}

/**
 * Project days-to-bar from the observed rate.
 *
 * ⚠️ Returns `null` rather than `Infinity` or `0` when the rate is zero: a projection of 0 implies
 * "about to happen", and an experiment that has closed nothing is not about to close thirty.
 */
export function projectEtaDays(facts: ExperimentFacts): number | null {
  const closed = facts.sides.reduce((sum, s) => sum + (s.n ?? 0), 0);
  if (closed <= 0 || !facts.startedAt) return null;
  const elapsed = Math.max((facts.now.getTime() - facts.startedAt.getTime()) / DAY_MS, 1 / 24);
  const perDay = closed / elapsed;
  if (!(perDay > 0)) return null;
  const shortest = Math.min(...facts.sides.map((s) => s.n ?? 0));
  const stillNeeded = MIN_SAMPLES_FOR_VERDICT - shortest;
  if (stillNeeded <= 0) return 0;
  // Both sides draw from the same trade stream, so the rate that matters is the slower side's and
  // the total rate is what's observed — dividing the shortfall by the per-side rate double-counts.
  return Math.ceil(stillNeeded / (perDay / 2));
}

/**
 * ── OBJECTIVE REVIEW — a DIFFERENT rule, on purpose ─────────────────────────────────────────────
 *
 * Owner, 2026-11-06: *"You could use the Goals page as a way to remind us to check results."*
 *
 * ⚠️ WHY THIS IS NOT ANOTHER `ExperimentAction`. An experiment has a SAMPLE (closed trades) and the
 * verdict question is "is it big enough to speak?". An objective has a DATE and a PROMISE — no
 * sample exists, and inventing one (`progressPct` as `n`) would compare a percentage against a trade
 * count, which is the exact unit error `development-philosophy` §3 records. Merging them would give
 * every objective a permanent `UNMEASURED` and teach the reader to ignore the panel.
 *
 * So: same output shape, its own vocabulary, one shared `nextStep` discipline — a single sentence an
 * agent can act on.
 */
export const OBJECTIVE_RULES = {
  /** An objective within this many days of its date is called out rather than left silent. */
  dueSoonDays: 7,
} as const;

export type ObjectiveReviewAction = 'SETTLED' | 'NO-DATE' | 'ON-TIME' | 'DUE-SOON' | 'OVERDUE';

export interface ObjectiveReviewFacts {
  id: string;
  title: string;
  status: string;
  targetDate: Date | null;
  now: Date;
  /** 0–100, the objective's own measure. Reported, never used as a sample size. */
  progressPct?: number | null;
  linkedStrategy?: string | null;
  /** Only used to detect a falsifiable prediction — see `hasPrediction` on the result. */
  description?: string | null;
}

export interface ObjectiveReview {
  id: string;
  title: string;
  action: ObjectiveReviewAction;
  reason: string;
  nextStep: string;
  daysLeft: number | null;
  progressPct: number | null;
  /** A falsifiable prediction in the description is what makes this checkable — not decoration. */
  hasPrediction: boolean;
}

/**
 * decideObjectiveReview() — is this promise overdue, and what closes it?
 *
 * Ordering: settled first (nothing outstanding), then no-date (cannot judge — and THAT is the
 * finding), then overdue, due-soon, on-time.
 */
export function decideObjectiveReview(facts: ObjectiveReviewFacts): ObjectiveReview {
  const status = String(facts.status || 'active').toLowerCase();
  const daysLeft = facts.targetDate ? daysBetween(facts.targetDate, facts.now) : null;
  const progressPct = facts.progressPct ?? null;
  const hasPrediction = /\bPREDICTION\b|\bFALSIFIED IF\b/i.test(String(facts.description ?? ''));
  const base = { id: facts.id, title: facts.title, daysLeft, progressPct, hasPrediction };

  if (status !== 'active') {
    return {
      ...base,
      action: 'SETTLED',
      reason: `Status is '${facts.status}' — nothing is outstanding.`,
      nextStep: 'Nothing to do.',
    };
  }

  if (daysLeft === null) {
    return {
      ...base,
      action: 'NO-DATE',
      reason: 'Active with no review date — nothing will ever prompt a check, so it can sit here for months.',
      nextStep:
        'Set a review date (or close it). An objective with no date is the mechanism by which a promise quietly becomes permanent.',
    };
  }

  if (daysLeft < 0) {
    return {
      ...base,
      action: 'OVERDUE',
      reason: `Review date passed ${-daysLeft} day(s) ago and it is still active`
        + (progressPct !== null ? ` at ${progressPct}%.` : '.'),
      nextStep:
        'Check it and close the loop: mark it achieved, restate the date with a reason, or abandon it and say why. Leaving it active is the clutter.',
    };
  }

  if (daysLeft <= OBJECTIVE_RULES.dueSoonDays) {
    return {
      ...base,
      action: 'DUE-SOON',
      reason: `Due in ${daysLeft} day(s)${progressPct !== null ? `, at ${progressPct}%` : ''}.`,
      nextStep:
        'Look at the numbers NOW rather than on the day: an experiment judged before its deadline can still be extended; one judged after it has already wasted the time.',
    };
  }

  return {
    ...base,
    action: 'ON-TIME',
    reason: `Due in ${daysLeft} day(s)${progressPct !== null ? `, at ${progressPct}%` : ''}.`,
    nextStep: 'Leave it alone until the review date.',
  };
}

/**
 * decideExperiment() — THE rule. First matching check wins; the order is the policy.
 *
 * ⚠️ ORDER MATTERS AND ONE PAIR IS SUBTLE. `DECIDE` sits ABOVE `BLOCKED` deliberately: a test that
 * already collected enough on both sides and only *then* had its bot switched off must still be
 * decided — its question is answered. Checked the other way round, the most valuable outcome in the
 * system (a finished experiment) would be reported as an obstacle. The ordering cases are pinned in
 * the spec so a future reorder fails a test rather than silently changing the policy.
 *
 * Read the order as a priority list of reasons an experiment can be finished:
 *   1. nothing outstanding (ARCHIVED)
 *   2. it cannot answer (NO-ARMS)
 *   3. it has enough (DECIDE)
 *   4. it never measured (UNMEASURED)
 *   5. it cannot collect (BLOCKED)
 *   6. it ran out of time (INCONCLUSIVE)
 *   7. it stopped moving (STALLED)
 *   8. otherwise it is working (RUNNING)
 */
export function decideExperiment(facts: ExperimentFacts): ExperimentDecision {
  const assessment = assessSamples(facts.sides, { what: 'closed trades' });
  const base = {
    kind: facts.kind,
    id: facts.id,
    title: facts.title,
    requiredPerSide: assessment.requiredPerSide,
    n: assessment.n,
    daysLeft: facts.reviewBy ? daysBetween(facts.reviewBy, facts.now) : null,
    etaDays: null as number | null,
  };
  const nText = facts.sides
    .map((s) => `${s.label} ${s.n === null ? 'UNKNOWN' : s.n}`)
    .join(' / ');

  // 1. Nothing to decide — and NOT "we decided it was fine".
  const settled = ['cancelled', 'complete', 'decided', 'archived'];
  if (settled.includes(String(facts.status).toLowerCase())) {
    return {
      ...base,
      action: 'ARCHIVED',
      reason: `Status is '${facts.status}' — no decision is outstanding (${nText}).`,
      nextStep:
        String(facts.status).toLowerCase() === 'cancelled'
          ? 'Nothing to do: the run was cancelled and never produced a verdict. If the question still matters, start a new test rather than reopening this one.'
          : 'Nothing to do: already settled. If the winner is still running live, check it is the one you meant to keep.',
    };
  }

  // 2. The arms cannot differ, so no amount of waiting produces an answer.
  if (facts.measurable === false) {
    return {
      ...base,
      action: 'NO-ARMS',
      reason:
        'The two arms differ only in fields declared INERT — the comparison cannot produce a difference, so the sample size is irrelevant.',
      nextStep:
        'Kill this test and re-run the comparison with a field that is actually branched on. Record the inert field in docs/SETTLED-DECISIONS.md so the next person does not test it again.',
    };
  }

  // 3. Enough sample on both sides. ABOVE BLOCKED on purpose — see the note in the docblock.
  if (assessment.outcome === 'ok') {
    const winner = facts.winner ? ` Winner so far: ${facts.winner}.` : '';
    return {
      ...base,
      action: 'DECIDE',
      reason: `${assessment.note}${winner}`,
      nextStep: facts.winner
        ? `Conclude the test: keep '${facts.winner}' and retire the other arm. Write the verdict, the sample and the date into the strategy's track record so the next writer does not re-run it.`
        : 'Conclude the test: the sample cleared the bar, so compare the two sides now and keep one. If the difference is not explainable, record that it was not.',
    };
  }

  // 4. A side was never measured. Distinct from "no trades", and must not read the same.
  if (assessment.outcome === 'sample-unknown') {
    return {
      ...base,
      action: 'UNMEASURED',
      reason: assessment.note,
      nextStep:
        'Fix the measurement before judging anything: find out why the sample was not recorded, then re-run the comparison. A null here is missing data, not a zero.',
    };
  }

  // 5. Data cannot arrive, and the sample is short. This is the case that hid both live tests on
  //    2026-11-06.
  if (facts.canCollect === false) {
    return {
      ...base,
      action: 'BLOCKED',
      reason: `No closed trade can arrive: ${facts.blockedReason || 'the producer reports it cannot collect'} (${nText}).`,
      nextStep:
        'Decide in one minute: either activate a bot on the tested stack and give it a review date, or kill the test and say so. Do not leave it running — it cannot finish.',
    };
  }

  // 6. Out of time. Close it WITH the reason rather than letting it linger.
  if (facts.reviewBy && facts.now > facts.reviewBy) {
    return {
      ...base,
      action: 'INCONCLUSIVE',
      reason: `Review date passed ${Math.abs(base.daysLeft ?? 0)} day(s) ago without clearing the bar (${nText}, need ≥${assessment.requiredPerSide} per side).`,
      nextStep:
        'Close it as inconclusive and record why (sample too small / too slow / market moved). An inconclusive test that is closed is information; the same test left running is clutter.',
    };
  }

  // 7. Stopped moving.
  if (facts.lastSampleAt) {
    const idleDays = daysBetween(facts.now, facts.lastSampleAt);
    if (idleDays >= EXPERIMENT_RULES.stallDays) {
      return {
        ...base,
        action: 'STALLED',
        reason: `Last closed trade was ${idleDays} day(s) ago — the experiment has stopped collecting (${nText}).`,
        nextStep: `Find out why no trade has closed in ${idleDays} days (bot inactive? no signal? market shut?) and wake it up or kill it this week.`,
      };
    }
  } else if (base.daysLeft !== null && base.daysLeft < EXPERIMENT_RULES.stallDays) {
    return {
      ...base,
      action: 'STALLED',
      reason: `Not one closed trade has ever been recorded and the review date is ${base.daysLeft} day(s) away (${nText}).`,
      nextStep:
        'Treat as not running: a test that has never closed a trade with its deadline this close will not finish. Wake it up or kill it now.',
    };
  }

  // 8. Working.
  const eta = projectEtaDays(facts);
  return {
    ...base,
    action: 'RUNNING',
    etaDays: eta,
    reason: `${assessment.note}${eta !== null ? ` At the observed rate the bar is ~${eta} day(s) away.` : ''}`,
    nextStep:
      'Leave it alone. Do not re-judge before the bar is cleared or the review date arrives — checking a small sample repeatedly is how noise becomes a decision.',
  };
}
