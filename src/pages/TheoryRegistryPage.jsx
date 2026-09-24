import PageInfoPopover from '../components/PageInfoPopover';
import { THEORIES, THEORY_STATUSES } from '../data/theories';
import './theory-registry.css';

/**
 * TheoryRegistryPage — the readable face of `src/data/theories.js` (#944).
 *
 * WHY THIS PAGE EXISTS
 * --------------------
 * The registry is only useful if the project owner can READ it. Owner, 2026-09-24: *"I still want to
 * monitor the development, and read the decisions being made. I will interject when I read something
 * that doesn't seem right."*
 *
 * So this page is written for a reader making a decision, not for a developer: the STATEMENT leads,
 * the evidence basis is a visible badge (a measurement and a citation must not look alike), and the
 * DECISION is always shown — because an answer nobody acted on is trivia.
 *
 * It sits in the Development area, which is the sandbox: the place an agent may build a competing
 * approach and produce a decision. This page is that sandbox's output.
 *
 * ⚠️ NO STATE, NO FETCH, NO CONTROLS. The page renders a static module. That is deliberate for a
 * first version — every control is an accessibility surface and a way to hide a row. Filtering can
 * be added when there are enough theories to need it, and it should be a real request, not a guess.
 */

const ISSUE_BASE = 'https://github.com/FifeCIC/Trading-Command-Suite/issues/';

/** Status presentation. ⚠️ `refuted` is a RESULT, not a failure — the styling must not punish it. */
const STATUS_META = {
  refuted: { icon: '✕', label: 'Refuted', note: 'Tested, and the theory does not hold. A finding.' },
  supported: { icon: '✓', label: 'Supported', note: 'Tested, and the theory holds so far.' },
  testing: { icon: '◐', label: 'Testing', note: 'There is evidence, but it is not yet settled.' },
  untested: { icon: '·', label: 'Untested', note: 'Named, with a test defined, and not yet run.' },
};

/** ⚠️ This badge is the most important element on the page: it grades how strong the evidence is. */
const BASIS_META = {
  measurement: { label: 'measured here', tone: 'strong', note: 'We counted it. The sample size is shown.' },
  'code-read': { label: 'code read', tone: 'medium', note: 'A fact about the source, not a sample. No n.' },
  cited: { label: 'cited', tone: 'weak', note: 'Carried from another issue — a CLAIM, not our observation.' },
};

function Field({ term, children }) {
  if (children === null || children === undefined || children === '') return null;
  return (
    <>
      <dt>{term}</dt>
      <dd>{children}</dd>
    </>
  );
}

function TheoryCard({ t }) {
  const status = STATUS_META[t.status] || STATUS_META.untested;
  const basis = t.evidence ? BASIS_META[t.evidence.basis] : null;

  return (
    <article className={`tr-card tr-card--${t.status}`}>
      <div className="tr-card-top">
        <span className={`tr-status tr-status--${t.status}`} title={status.note}>
          <span aria-hidden="true">{status.icon}</span> {status.label}
        </span>
        {basis && (
          <span className={`tr-basis tr-basis--${basis.tone}`} title={basis.note}>
            {basis.label}
            {t.evidence.n != null ? ` · n=${t.evidence.n}` : ''}
          </span>
        )}
        <span className="tr-area">{t.area}</span>
      </div>

      <p className="tr-statement">{t.statement}</p>

      <dl className="tr-fields">
        <Field term="Predicted direction">{t.predictedDirection}</Field>
        <Field term="Measure">{`${t.measure} — in ${t.unit}`}</Field>
        <Field term="Window">{t.window}</Field>
        <Field term="Falsification">{t.falsification}</Field>
        {t.evidence && (
          <>
            <Field term={`Evidence (${t.evidence.basis})`}>{t.evidence.result}</Field>
            <Field term="Recorded">{`${t.evidence.measuredAt} — source: ${t.evidence.source}`}</Field>
          </>
        )}
        <Field term="Decision">
          <span className="tr-decision">{t.decision || 'No decision recorded yet.'}</span>
        </Field>
      </dl>

      {t.issue ? (
        <a className="tr-issue" href={`${ISSUE_BASE}${t.issue}`} target="_blank" rel="noopener noreferrer">
          Issue #{t.issue} ↗
        </a>
      ) : null}
    </article>
  );
}

export default function TheoryRegistryPage() {
  const byStatus = THEORY_STATUSES.map((s) => ({ status: s, rows: THEORIES.filter((t) => t.status === s) }));
  const counts = byStatus.filter((g) => g.rows.length > 0);

  return (
    <div className="tr-page">
      <header className="tr-header">
        <h1>
          Theory Registry
          <PageInfoPopover>
            Every belief this app holds about the market, written as a claim someone can refute, with
            the test that would kill it and the decision that came out of it. A theory without a
            falsification test is a preference — and preferences do not belong here.
          </PageInfoPopover>
        </h1>
        <p className="tr-lede">
          A belief is only useful once it can be wrong. Each entry names what would falsify it,
          what was measured, and what we did about the answer.
        </p>
      </header>

      <div className="tr-tally" role="list" aria-label="Theories by status">
        {counts.map(({ status, rows }) => (
          <span className="tr-tally-item" role="listitem" key={status}>
            <span className={`tr-tally-n tr-status--${status}`}>{rows.length}</span>
            <span className="tr-tally-label">{STATUS_META[status]?.label || status}</span>
          </span>
        ))}
      </div>

      {counts.map(({ status, rows }) => (
        <section className="tr-group" key={status}>
          <h2 className={`tr-group-head tr-status--${status}`}>
            <span aria-hidden="true">{STATUS_META[status]?.icon}</span> {STATUS_META[status]?.label} · {rows.length}
          </h2>
          <p className="tr-group-note">{STATUS_META[status]?.note}</p>
          {rows.map((t) => (
            <TheoryCard key={t.id} t={t} />
          ))}
        </section>
      ))}
    </div>
  );
}
