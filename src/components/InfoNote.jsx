/**
 * InfoNote — ONE structure for every sentence that annotates a result.
 * ==================================================================
 *
 * ── DECISION (2026-10-30, primary) ──
 * WHAT:      every sentence that annotates data is this component. Five roles, one anatomy, tone on
 *            the border and the label only.
 * WHY:      six statements on one page arrived in five shapes and five type scales. Each was locally
 *            reasonable; the set was incoherent, because there was no pattern to converge on.
 * INSTEAD OF: tightening each one in place. That would have left the *next* page free to invent a
 *            seventh shape — the failure was the absence of a reference, not the six instances.
 * REVERSE BY: deleting `info-note.css`'s import and going back to per-page classes; nothing else
 *            depends on this file.
 * REGISTER:  docs/SETTLED-DECISIONS.md row 100
 * GUARD:     `/appearance/info` renders this component, so it cannot drift from the pages that use it.
 *            ⚠️ No build gate stops a hand-rolled paragraph — the open question (density, attention,
 *            progressive disclosure) is #1152.
 *
 * ⚠️ WHY THIS EXISTS. Owner report, 2026-10-30, pointing at five stacked pieces of prose on
 * `/lab/backtest-strategies`: *"We've got too much mixed styling when displaying sentences … This is a
 * perfect example of agentic AI working on a UI without any reference to an established theme like we
 * are trying to do in the appearance area."*
 *
 * Measured on that page: a legend in `.bt-compare-legend`, an outcome in `.app-notice--warning`, a
 * provenance line in `.bt-period`, caveats in an unstyled `<ul>`, and applied settings in
 * `.bt-execution-info` — **five different shapes and five different type scales for five sentences
 * that do the same job.** Each was locally reasonable and the set was incoherent, which is what a
 * missing pattern looks like from the outside.
 *
 * ── THE ANATOMY (fixed; do not vary it per page) ──────────────────────────────────────────────
 *
 *     ┌─────────────────────────────────────────────────────────┐
 *     │ ⚑  LABEL            uppercase · 0.65–0.72rem · 600      │   ← names the ROLE, not the topic
 *     │    The sentence.     body · 0.82rem · line-height 1.45  │
 *     │    meta              caption · 0.62rem · tabular-nums   │   ← optional: values, ids, counts
 *     └─────────────────────────────────────────────────────────┘
 *
 * ── THE FIVE ROLES THIS COVERS, AND THE TONE EACH TAKES ──────────────────────────────────────
 *
 *   | Role            | `label` example        | `tone`             |
 *   |-----------------|------------------------|--------------------|
 *   | Provenance      | "Window measured"      | neutral            |
 *   | Encoding key    | "Comparison"           | neutral            |
 *   | Applied config  | "Costs applied"        | neutral            |
 *   | Outcome/decision| "Auto-Accept"          | success / warning  |
 *   | Limitation      | "What this cannot claim" | warning          |
 *
 * ⚠️ TONE GOES ON THE BORDER AND THE LABEL — NEVER ON THE BODY TEXT. `ui-standards.instructions.md`:
 * *"leave the tone on the BORDER — never on the body text (the semantic tones fail WCAG AA as text on
 * a light panel)."* `.app-notice--warning` predates that rule and colours its whole body amber; this
 * component does not repeat it. Body text is `--ink` in every tone, so a warning is still comfortable
 * to read.
 *
 * ⚠️ NOT A REPLACEMENT FOR `NoticeBlock`. `NoticeBlock` renders a REGISTRY NOTICE — a machine-readable
 * failure with a stable code, a cause and a fix. This renders a STATEMENT about data the reader is
 * already looking at. A failure belongs in `NoticeBlock`; a fact does not belong in an error channel.
 *
 * ⚠️ `tone="neutral"` IS THE DEFAULT AND IS NOT A COP-OUT. Most sentences on a results page are
 * provenance, and painting them all amber is how a reader learns to ignore amber.
 */
import './info-note.css';

/** Tone → the emoji that names the role at a glance. Callers may override with `icon`. */
const TONE_ICON = {
  neutral: null,
  info: 'ℹ️',
  success: '✅',
  warning: '⚠️',
  critical: '⛔',
};

/**
 * @param {object}  props
 * @param {'neutral'|'info'|'success'|'warning'|'critical'} [props.tone='neutral']
 * @param {string}   props.label   Names the ROLE ("Window measured"), not the subject.
 * @param {React.ReactNode} [props.icon]  Overrides the tone's default marker.
 * @param {React.ReactNode} props.children  The sentence.
 * @param {React.ReactNode} [props.meta]  Values, ids, counts — one caption line.
 * @param {string}   [props.role='note']  'status' when the note reports something that just happened.
 * @param {string}   [props.className]
 */
export default function InfoNote({
  tone = 'neutral',
  label,
  icon,
  children,
  meta = null,
  role = 'note',
  className = '',
}) {
  const marker = icon ?? TONE_ICON[tone] ?? null;
  return (
    <div className={`info-note info-note--${tone}${className ? ` ${className}` : ''}`} role={role}>
      <div className="info-note-head">
        {marker && <span className="info-note-icon" aria-hidden="true">{marker}</span>}
        {/* A <p>, not a heading: this label names the role of the box, and an h-tag here would put
            five new entries into the document outline for a page whose headings are the steps. */}
        <p className="info-note-label">{label}</p>
      </div>
      <div className="info-note-body">{children}</div>
      {meta != null && meta !== '' && <p className="info-note-meta">{meta}</p>}
    </div>
  );
}
