/**
 * StepAuditNote — the "what this step does not yet show" card that sits BETWEEN steps.
 *
 * ── WHY BETWEEN STEPES AND NOT INSIDE THEM ───────────────────────────────────────────────────────
 * Owner, 2026-11-23: audit notes and suggestions between each accordion, suggesting possible steps or
 * enhancements that use data already being generated. Putting them INSIDE a step would mix what the run
 * DID with what we might do next — and the reader would scroll past the data to reach the ideas. Between
 * them, the note belongs to neither and reads as a margin annotation, which is what it is.
 *
 * ── ⚠️ THIS IS NOT DECORATION AND IT IS NOT A TODO LIST ─────────────────────────────────────────
 * Every line comes from a MEASURED gap: a field the payload already carries and no table uses, or a
 * directive score that is computed on every bar and never displayed. A note that says "could be nicer"
 * would be exactly the kind of prose the owner asked to have removed from the page.
 *
 * ⚠️ ONE LINE EACH, and the count is capped by the step definition. The volume problem is the reason
 * the caveat list was deleted, so an audit note that grows into paragraphs has failed its own purpose.
 */
import './step-audit-note.css';

export default function StepAuditNote({ afterStep, ideas }) {
  if (!Array.isArray(ideas) || ideas.length === 0) return null;

  return (
    <aside className="step-audit" aria-label={`Ideas for the step above (${afterStep})`}>
      <span className="step-audit__tag">
        <span aria-hidden="true">✎</span>
        Possible next
      </span>
      <ul className="step-audit__list">
        {ideas.map((idea) => (
          <li key={idea}>{idea}</li>
        ))}
      </ul>
    </aside>
  );
}
