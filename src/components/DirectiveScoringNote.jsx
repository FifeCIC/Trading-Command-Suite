/**
 * DirectiveScoringNote — "how does this directive affect the score?" in one sentence per case.
 *
 * ⚠️ WHY THIS EXISTS (owner question, 2026-11-06)
 * -------------------------------------------------
 * *"I need to understand the 'no direction' directives… are we avoiding using a no-direction
 * directive in the scoring system and only using them as gating in bots or the SIGNAL part?"*
 *
 * The answer was in `protocol-gating.service.ts` and nowhere a reader could see it. Concretely:
 *
 *     if (!isGateGroup) {
 *       capacityMax += maxScore;          // ← EVERY non-gate directive counts here, neutral included
 *       directionEligibleCount++;
 *       if (!NEUTRAL_ONLY_DIRECTIVES.has(directiveId)) earnableMaxTotal += maxScore;
 *     }
 *
 * and the SIGNAL is `selectedEvidence.raw / capacityMaxTotal`, where `raw` only accrues from
 * directives whose runtime `signalClass` matched the selected side. So a neutral directive:
 *
 *   - SCORES (a real 0-100 score, shown in `breakouts`, used for opportunity ranking), and
 *   - contributes **exactly 0** to the signal numerator, while
 *   - still occupying the denominator — which is the measured fault in #1122 (31% of the divisor is
 *     unearnable for `xau-speed-m15-long`, 58% for `vix-spike-v1-long`).
 *
 * That is a fact about the RULE, not a fault in the directive. Presenting it here stops the two
 * misreadings this page invited: that "no direction" means "broken", and that a neutral directive is
 * doing nothing at all.
 *
 * ⚠️ `direction` comes from `DIRECTIVE_DIRECTION` — derived from each class's own source literals —
 * NOT from `directionBias`, which is a declaration (ten directives declare a bias their code does not
 * do). When the static scanner cannot judge a class it says `indeterminate`, and that is rendered as
 * its own case: "cannot judge" must never be shown as "neutral".
 */

import './directive-scoring-note.css';

const TONE = {
  signal: { label: 'Contributes to the signal', colour: 'var(--color-profit)' },
  oneSide: { label: 'Contributes to ONE side only', colour: 'var(--notice-warning-text, #b45309)' },
  neutral: { label: 'No direction — does not move the signal', colour: 'var(--color-muted)' },
  unknown: { label: 'Direction could not be determined', colour: 'var(--notice-warning-text, #b45309)' },
};

/** Which case a directive falls into, from the DERIVED capability (never the declaration). */
export function scoringCaseFor(direction) {
  if (direction === 'both') return 'signal';
  if (direction === 'bullish-only' || direction === 'bearish-only') return 'oneSide';
  if (direction === 'none') return 'neutral';
  return 'unknown';
}

export default function DirectiveScoringNote({ direction, directionBias, maxScore }) {
  const kase = scoringCaseFor(direction);
  const tone = TONE[kase];
  const declared = directionBias ? ` (it declares \`${directionBias}\`)` : '';
  const capacity = Number.isFinite(Number(maxScore)) ? `${maxScore} pts` : 'its maxScore';

  // Rendered as JSX, not a markdown string — `**bold**` inside a text node prints its asterisks.
  const detail = {
    signal: (
      <>
        Can read bullish AND bearish, so {capacity} of capacity can be earned on either side. It is
        included in the signal denominator and can move BUY/SELL strength.
      </>
    ),
    oneSide: (
      <>
        Can only read ONE side. {capacity} is earnable in a protocol built for that side; in the
        opposite-direction protocol the same {capacity} sits in the denominator and can never be
        earned{declared}.
      </>
    ),
    neutral: (
      <>
        It cannot emit a direction in ANY market, so it adds <strong>exactly 0</strong> to the signal
        percentage however high it scores{declared}. Its {capacity} of capacity still counts in the
        denominator, so it dilutes signal strength — the measured fault in #1122. It is not doing
        nothing: its score is real, it appears in the scoring breakdown, and it is used for
        opportunity ranking.
      </>
    ),
    unknown: (
      <>
        The static scanner cannot tell: this class assigns its signalClass from a variable. Treated
        as direction-capable, because &ldquo;cannot judge&rdquo; must never be read as
        &ldquo;neutral&rdquo;{declared}.
      </>
    ),
  }[kase];

  return (
    <section className="directive-scoring-note" aria-label="How this directive affects the score">
      <h3>How it affects the score</h3>
      <p className="directive-scoring-note-headline" style={{ color: tone.colour }}>
        {tone.label}
      </p>
      <p className="directive-scoring-note-body">{detail}</p>
      <p className="directive-scoring-note-scenario">
        <strong>When it matters:</strong>{' '}
        {kase === 'signal'
          ? 'it is part of the directional evidence — a change in its score moves the BUY/SELL percentage.'
          : kase === 'oneSide'
            ? 'inside a protocol trading its own direction it adds conviction; inside the opposite direction it only dilutes.'
            : kase === 'neutral'
              ? 'as context: it scores, it is reported, and it is ranked on — but reading it as evidence for a side would be wrong, and adding many of them to a protocol weakens every signal it produces.'
              : 'it must be checked at runtime; nothing static can say whether it will contribute.'}
      </p>
    </section>
  );
}
