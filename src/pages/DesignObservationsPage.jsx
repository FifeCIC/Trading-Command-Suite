import PageInfoPopover from '../components/PageInfoPopover';
import { DESIGN_OBSERVATIONS, OBSERVATION_STATUSES } from '../data/design-observations';
import './design-observations.css';

/**
 * DesignObservationsPage — the readable face of `src/data/design-observations.js`.
 *
 * WHY THIS PAGE EXISTS (review row R21, answered 2026-09-24; issue #990)
 * ----------------------------------------------------------------------
 * Owner: *"Are we noting observations for review and consideration? This is important for
 * re-considering designs."* The answer was no — the finding that prompted it went into a code
 * comment, which is durable but invisible to the person who reconsiders designs. The owner chose a
 * dedicated register over a second section in the review queue.
 *
 * WHAT MAKES THIS A REGISTER AND NOT A LIST OF GRIPES
 * ---------------------------------------------------
 * **`reconsiderIf` leads.** An observation says *"this looks wrong"*; `reconsiderIf` says *"change
 * the design when THIS becomes true"*. An entry without the second half is a preference, and the
 * register's own validator refuses one. So every card carries the condition that should re-open it,
 * and that condition is what a reader is here to judge.
 *
 * ⚠️ NO STATE, NO FETCH, NO CONTROLS. The page renders a static module, deliberately, matching the
 * theory registry next door: every control is an accessibility surface and a way to hide a row.
 * Filtering can be added when there are enough rows to need it — and should be a real request.
 */

const ISSUE_BASE = 'https://github.com/FifeCIC/Trading-Command-Suite/issues/';

/**
 * Status presentation.
 * ⚠️ `rejected` is a DECISION, not a failure — the styling must not punish it, or the register stops
 * receiving observations. That is the same rule the theory registry applies to `refuted`.
 */
const STATUS_META = {
  raised: { icon: '·', label: 'Raised', note: 'Noted, not yet examined. The lowest-cost state.' },
  considering: { icon: '◐', label: 'Considering', note: 'Being weighed. A fork may already be open on the review queue.' },
  decided: { icon: '✓', label: 'Decided', note: 'Settled, and what was done is recorded below.' },
  rejected: { icon: '✕', label: 'Rejected', note: 'Considered and declined. Recorded so the same ground is not re-covered.' },
};

/** ⚠️ This badge is the most important element on a card: it grades the evidence. */
const BASIS_META = {
  measurement: { label: 'measured here', tone: 'strong', note: 'We counted it here. The sample size is shown.' },
  'code-read': { label: 'code read', tone: 'medium', note: 'A fact about the source, not a sample. No n.' },
  cited: { label: 'cited', tone: 'weak', note: 'Carried from an issue or another agent — a CLAIM, not our observation.' },
};

/** Open rows first: the register exists to be read for what still wants attention. */
const GROUPS = [
  { statuses: ['raised', 'considering'], head: 'Open — for consideration', note: 'Each row names the condition that should re-open the design.' },
  { statuses: ['decided', 'rejected'], head: 'Closed — settled', note: 'Kept because the reasoning is the durable part; a silently deleted observation is one somebody re-raises.' },
];

function Field({ term, children, className }) {
  if (children === null || children === undefined || children === '') return null;
  return (
    <>
      <dt>{term}</dt>
      <dd>
        <span className={className}>{children}</span>
      </dd>
    </>
  );
}

function ObservationCard({ o }) {
  const status = STATUS_META[o.status] || STATUS_META.raised;
  const basis = o.evidence ? BASIS_META[o.evidence.basis] : null;
  const closed = o.status === 'decided' || o.status === 'rejected';

  return (
    <article className={`do-card do-card--${o.status}`}>
      <div className="do-card-top">
        <span className={`do-status do-status--${o.status}`} title={status.note}>
          <span aria-hidden="true">{status.icon}</span> {status.label}
        </span>
        {basis && (
          <span className={`do-basis do-basis--${basis.tone}`} title={basis.note}>
            {basis.label}
            {o.evidence.n != null ? ` · n=${o.evidence.n}` : ''}
          </span>
        )}
        <span className="do-area">{o.area}</span>
      </div>

      <h3 className="do-title">{o.title}</h3>
      <p className="do-observation">{o.observation}</p>

      <dl className="do-fields">
        <Field term="Why it matters">{o.why}</Field>
        {o.evidence && (
          <>
            <Field term={`Evidence (${o.evidence.basis})`}>{o.evidence.detail}</Field>
            <Field term="Recorded">{`${o.evidence.observedAt} — source: ${o.evidence.source}`}</Field>
          </>
        )}

        {/* ⚠️ The load-bearing field. Shown ABOVE the decision, because the condition that re-opens
            the row is what a reader is judging — the decision is only its current outcome. */}
        <Field term="Reconsider if" className="do-reconsider">
          {o.reconsiderIf}
        </Field>

        <Field term={closed ? 'Decision' : 'Decision'}>
          <span className={closed ? 'do-decision' : undefined}>
            {o.decision || 'No decision yet — this row is open.'}
          </span>
        </Field>

        <Field term="Raised">{`${o.raisedAt} — ${o.raisedBy}`}</Field>
      </dl>

      {o.issue ? (
        <a className="do-issue" href={`${ISSUE_BASE}${o.issue}`} target="_blank" rel="noopener noreferrer">
          Issue #{o.issue} ↗
        </a>
      ) : null}
    </article>
  );
}

export default function DesignObservationsPage() {
  const counts = OBSERVATION_STATUSES.map((s) => ({
    status: s,
    n: DESIGN_OBSERVATIONS.filter((o) => o.status === s).length,
  })).filter((c) => c.n > 0);

  return (
    <div className="do-page">
      <header className="do-header">
        <h1>
          Design Observations
          <PageInfoPopover>
            Things noticed about how this app is designed, held open on purpose. Each one names what
            was seen, how strong the evidence is, and the condition that should make us reconsider the
            design. An observation without that condition is an opinion, and the validator refuses one.
          </PageInfoPopover>
        </h1>
        <p className="do-lede">
          Not defects, and not decisions. A <strong>design tension held open on purpose</strong>, with
          the condition that would close it — so a design is reconsidered on evidence rather than on
          somebody remembering it.
        </p>
      </header>

      <div className="do-tally" role="list" aria-label="Observations by status">
        {counts.map(({ status, n }) => (
          <span className="do-tally-item" role="listitem" key={status}>
            <span className="do-tally-n">{n}</span>
            <span className="do-tally-label">{STATUS_META[status]?.label || status}</span>
          </span>
        ))}
      </div>

      {DESIGN_OBSERVATIONS.length === 0 ? (
        <p className="do-empty">
          No observations recorded. The register being empty is a real state, not a failed read — the
          file is the source of truth and it was read successfully.
        </p>
      ) : (
        GROUPS.map((group) => {
          const rows = DESIGN_OBSERVATIONS.filter((o) => group.statuses.includes(o.status));
          if (rows.length === 0) return null;
          return (
            <section className="do-group" key={group.head}>
              <h2 className="do-group-head">
                {group.head}
                <span className="do-area">{rows.length}</span>
              </h2>
              <p className="do-group-note">{group.note}</p>
              {rows.map((o) => (
                <ObservationCard key={o.id} o={o} />
              ))}
            </section>
          );
        })
      )}
    </div>
  );
}
