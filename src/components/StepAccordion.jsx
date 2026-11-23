/**
 * StepAccordion — one STEP of a working page, collapsible, with the answer in its header.
 *
 * ── WHY A STEP AND NOT JUST A PANEL ──────────────────────────────────────────────────────────────
 * Owner, 2026-11-23: every section and table becomes an accordion, and each accordion is examined as
 * one step of the process. A collapsible panel that hides its contents behind a bare title makes a page
 * WORSE to examine — you have to open it to find out whether it was worth opening. So the header
 * carries `meta`: a short set of figures pulled from the step's own data, so a COLLAPSED step still
 * answers "is there anything in here?".
 *
 * ── ⚠️ NATIVE `<details>`, AND THE REASONS ARE NOT COSMETIC ─────────────────────────────────────
 *   · keyboard operable and screen-reader announced with no JavaScript (no focus trap to get wrong);
 *   · find-in-page opens a closed section — a `div`-based accordion silently hides text from Ctrl+F,
 *     which is the opposite of what an examination page needs;
 *   · the browser remembers nothing for us, so `localStorage` is used deliberately and ONLY to keep a
 *     step's open state across a reload. A fault there must not break the page, so every access is
 *     guarded — storage can throw in private mode and in some embedding contexts.
 *
 * ── ACCESSIBILITY NOTES ─────────────────────────────────────────────────────────────────────────
 * `<summary>` is the control: it is focusable, toggles on Enter/Space for free, and exposes
 * `aria-expanded` itself. The step number is text, not a decorative glyph, so it survives greyscale
 * and a screen reader; the ▸/▾ marker is CSS-only and must never be the only signal (the `<summary>`
 * text is).
 */
import { useEffect, useRef, useState } from 'react';
import './step-accordion.css';

const PREFIX = 'tcs:step-accordion:';

function readStored(pageId, id) {
  try {
    const raw = window.localStorage.getItem(`${PREFIX}${pageId}:${id}`);
    if (raw === '1') return true;
    if (raw === '0') return false;
    return null;
  } catch {
    // Storage unavailable: fall back to the declared default. Never throw — a page must not fail to
    // render because a preference could not be read.
    return null;
  }
}

function writeStored(pageId, id, open) {
  try {
    window.localStorage.setItem(`${PREFIX}${pageId}:${id}`, open ? '1' : '0');
  } catch {
    /* a preference that cannot be saved is not an error the reader needs to see */
  }
}

/**
 * @param {object} props
 * @param {string} props.pageId   Namespace for the stored open state (one per page).
 * @param {string} props.id       Stable step id — also the anchor target.
 * @param {number} [props.step]   Step number shown in the header; omit for a non-sequential section.
 * @param {string} props.title    What this step is.
 * @param {string} [props.purpose] One line on what the step is FOR — the question it answers.
 * @param {import('react').ReactNode} [props.meta] Figures from this step's own data, shown when closed.
 * @param {boolean} [props.defaultOpen]
 * @param {number} [props.openSignal] Bump to OPEN the step from outside (e.g. a "change settings"
 *   button that lives in another step). A monotonic counter, not a boolean: a boolean that is already
 *   `true` cannot express "open it again", and the reader would press a button that does nothing.
 * @param {import('react').ReactNode} [props.actions] Controls that belong to the header (e.g. a link).
 */
export default function StepAccordion({
  pageId,
  id,
  step,
  title,
  purpose,
  meta,
  defaultOpen = false,
  openSignal,
  actions,
  children,
}) {
  const [open, setOpen] = useState(() => readStored(pageId, id) ?? defaultOpen);
  const detailsRef = useRef(null);
  const lastSignal = useRef(openSignal);

  /**
   * An external opener. ⚠️ It fires only when the COUNTER CHANGES — a plain effect on a boolean would
   * re-open a step the reader had just closed, every time the parent re-rendered.
   */
  useEffect(() => {
    if (openSignal === undefined || openSignal === lastSignal.current) return;
    lastSignal.current = openSignal;
    setOpen(true);
    writeStored(pageId, id, true);
  }, [openSignal, pageId, id]);

  // Keep the real `<details>` in step with state (it is the source of truth for rendering).
  useEffect(() => {
    const el = detailsRef.current;
    if (el && el.open !== open) el.open = open;
  }, [open]);

  /**
   * A step must be reachable by link — the page links to its own sections (`#mvp-sec-*`) and a
   * collapsed target would land the reader on a closed box.
   */
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const openIfTargeted = () => {
      if (window.location.hash === `#${id}` && !open) setOpen(true);
    };
    openIfTargeted();
    window.addEventListener('hashchange', openIfTargeted);
    return () => window.removeEventListener('hashchange', openIfTargeted);
  }, [id, open]);

  return (
    <details
      ref={detailsRef}
      id={id}
      className="step-acc"
      open={open}
      onToggle={(e) => {
        const next = e.currentTarget.open;
        if (next !== open) {
          setOpen(next);
          writeStored(pageId, id, next);
        }
      }}
    >
      <summary className="step-acc__summary">
        <span className="step-acc__marker" aria-hidden="true" />
        <span className="step-acc__heading">
          <span className="step-acc__title" id={`${id}-title`}>
            {step != null && <span className="step-acc__num">Step {step}</span>}
            {title}
          </span>
          {purpose && <span className="step-acc__purpose">{purpose}</span>}
        </span>
        {meta && <span className="step-acc__meta">{meta}</span>}
      </summary>

      {actions && <div className="step-acc__actions">{actions}</div>}
      {/*
        ⚠️ THE BODY IS A NAMED GROUP. Removing the page's inner `<section aria-label="…">` (owner,
        2026-11-23) removed a landmark with it, so the step's title now NAMES the body: a screen-reader
        user moving into the content is told which step they are in, which the visual reader gets from
        the summary directly above.
      */}
      <div className="step-acc__body" role="group" aria-labelledby={`${id}-title`}>
        {children}
      </div>
    </details>
  );
}

/** One figure in a collapsed step's header: a value and what it counts. */
export function StepMeta({ value, label, tone = '' }) {
  return (
    <span className={`step-acc__stat${tone ? ` is-${tone}` : ''}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </span>
  );
}
