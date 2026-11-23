/**
 * StatusCard — a headline number, a short label, and detail that waits to be asked for.
 * =====================================================================================
 *
 * Requirement (2026-11-18), on /development/movers-treatment:
 *   *"I do not like screen clutter - large blocks of information need to be displayed through the
 *   users desire to see it."* … *"some of the values within it could be status cards … and hovering
 *   over tells us more information. This should be a standard approach presented in the Theme
 *   gallery to encourage it. Maybe a small icon in the top right corner of cards that have additional
 *   information would help users realise that there is more to read."*
 *
 * ── WHERE THIS SITS AMONG THE EXISTING PATTERNS ───────────────────────────────────────────────
 * `InfoNote` fixes how a SENTENCE about data is displayed, how a FAILURE is displayed
 * (`NoticeBlock`), and that an explanation of what a control IS lives behind ℹ
 * (`PageInfoPopover`). This is the fourth case, and it was missing:
 *
 *   a NUMBER that can be read at a glance, whose justification is worth reading only sometimes.
 *
 * ── ⚠️ HOVER IS THE TRIGGER, CLICK IS THE GUARANTEE ───────────────────────────────────────────
 * `accessibility-policy` is explicit: *"No hover-only interactions — all functionality available via
 * tap/click."* So hover and focus reveal the detail, and the whole card is a real `<button>` that
 * PINS it open. A hover-only card would be unreadable on touch and unreachable by keyboard, which is
 * most of this app's usage.
 *
 * ⚠️ `aria-expanded` REPORTS WHAT IS ACTUALLY RENDERED — `pinned || hovered`, not `pinned` alone.
 * Announcing "collapsed" while the detail is on screen is the same class of defect as a status field
 * that reports a state it is not in, and this repo has paid for that repeatedly.
 *
 * ── ⚠️ THE DETAIL IS AN OVERLAY, NOT AN EXPANSION ─────────────────────────────────────────────
 * It is absolutely positioned below the card, so revealing it never reflows the row. The alternative
 * (inline growth, or a native `[popover]`) was rejected on measured grounds: `page-info-popover.css`
 * records that a `[popover]` in this app lands at the wrong coordinates because `motion` wrappers set
 * `transform`, which makes them the containing block for `position: fixed`. This component inherits
 * no such trap — it positions against its own `position: relative` card.
 *
 * ── ⚠️ TONE COLOURS THE BORDER AND THE LABEL ONLY ─────────────────────────────────────────────
 * The deleted `AppearanceInfoPage` recorded why: the semantic tones fail WCAG AA as body text on a light panel.
 * `.app-notice--warning` predates that rule and colours its whole body amber; this does not repeat it.
 */

import { useId, useState } from 'react';
import './status-card.css';

const TONES = new Set(['neutral', 'ok', 'warn', 'bad']);

export default function StatusCard({ value, label, icon, detail, tone = 'neutral', className = '' }) {
  const id = useId();
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);

  const toneClass = TONES.has(tone) ? tone : 'neutral';
  // The single source of truth for "is the detail on screen RIGHT NOW". `aria-expanded` reads this.
  const shown = pinned || hovered;

  const face = (
    <>
      <span className="sc-value">{value}</span>
      <span className="sc-label">
        {icon ? <span aria-hidden="true">{icon} </span> : null}
        {label}
      </span>
    </>
  );

  // ⚠️ A card with nothing more to say is NOT a button. Making it one is a control that does nothing,
  // which is worse than plain text: it invites a click and reports no change.
  if (!detail) {
    return <div className={`sc sc--${toneClass} ${className}`.trim()}>{face}</div>;
  }

  return (
    <div
      className={`sc sc--${toneClass} sc--openable ${shown ? 'is-open' : ''} ${className}`.trim()}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        className="sc-hit"
        aria-expanded={shown}
        aria-controls={id}
        onClick={() => setPinned((p) => !p)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
      >
        {face}
        {/* The disclosure cue. A CHEVRON, not an ⓘ — see the stylesheet's note on why. */}
        <span className="sc-caret" aria-hidden="true" />
      </button>
      <div id={id} className="sc-detail" hidden={!shown}>
        {detail}
      </div>
    </div>
  );
}

