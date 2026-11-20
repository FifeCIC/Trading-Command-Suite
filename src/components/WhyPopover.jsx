/**
 * WhyPopover — an explanation that is READ ON DEMAND, not dumped into the page.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────────
 * The owner's note on 2026-11-20 about the movers page: *"we really need to enhance the Appearance
 * areas library of text presentation because this text dump to the page between containers and headers
 * is really dull"* — and, of the same text, *"this particular paragraph makes me think the pointers idea
 * is perfect for training a user on a feature."*
 *
 * So the rule this component encodes: **a paragraph that explains the UI is not content, it is help.**
 * Content belongs in a table; help belongs behind a control. A page that mixes them makes the reader
 * skim both.
 *
 * ⚠️ NOT A `title` ATTRIBUTE. `title` is hover-only, so it is unreachable by keyboard, touch and screen
 * readers — the accessibility policy forbids it for anything a reader needs, and this repo has already
 * paid for that lesson once (#824, "Unsupported filling mode" with no remedy shown).
 *
 * ⚠️ NOT A SECOND `PageInfoSlotContent` EITHER. The shell owns ONE ℹ per page (`MainTopInfo`). This is
 * for a *specific* table, row or value — a local explanation attached to its subject, which is the one
 * thing the shell cannot position.
 */
import { useEffect, useId, useRef, useState } from 'react';
import '../styles/why-popover.css';

export default function WhyPopover({
  /** Visible label; defaults to a "?" glyph. Always accompany with an `aria-label`. */
  label = '?',
  /** Accessible name — required, because the glyph alone says nothing. */
  title,
  children,
  /** `inline` fits inside a table cell; `block` sits under a heading. */
  variant = 'inline',
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef(null);

  // A transient overlay must not survive a click elsewhere — every other surface in the app closes on
  // outside click, and a stuck popover covers the row underneath.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <span className={`why-pop why-pop--${variant}`} ref={ref}>
      <button
        type="button"
        className="why-pop-btn"
        aria-label={title}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
        }}
      >
        {label}
      </button>
      {open && (
        <span className="why-pop-panel" id={id} role="note">
          {children}
        </span>
      )}
    </span>
  );
}
