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
  /** Accessible name — the glyph alone says nothing. Required when the trigger is the info icon. */
  title,
  children,
  /** `inline` fits inside a table cell; `block` sits under a heading. */
  variant = 'inline',
  /**
   * Render a bare info glyph that also opens on HOVER while staying click/keyboard operable. Use it
   * BESIDE a value as a help affordance (a step card, a metric); use the default (a click-only button)
   * when the trigger has its own visible label.
   */
  hover = false,
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

  // ⚠️ HOVER IS AN ENHANCEMENT, NEVER THE ONLY WAY IN. Click, Enter/Space and keyboard focus all still
  // open it, because a hover-only help is unreachable on touch and by anyone using a keyboard — the
  // accessibility policy forbids `title` for exactly this reason.
  const hoverProps = hover
    ? {
        onMouseEnter: () => setOpen(true),
        onMouseLeave: () => setOpen(false),
      }
    : {};

  return (
    <span className={`why-pop why-pop--${variant}${hover ? ' why-pop--hover' : ''}`} ref={ref} {...hoverProps}>
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
        {label === '?' ? (
          /* A borderless info glyph (info-in-a-circle), the modern convention (Linear, Stripe, the
             shadcn/Radix libraries) — not a bordered “?” pill, which reads as a button. */
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.4" />
            <rect x="7.25" y="6.9" width="1.5" height="4.6" rx="0.75" fill="currentColor" />
            <circle cx="8" cy="4.6" r="0.95" fill="currentColor" />
          </svg>
        ) : (
          label
        )}
      </button>
      {open && (
        <span className="why-pop-panel" id={id} role="note">
          {children}
        </span>
      )}
    </span>
  );
}
