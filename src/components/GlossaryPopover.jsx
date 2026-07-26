/**
 * GlossaryPopover — hover tooltip for glossary terms
 * ====================================================
 * Renders a term as bold, underlined text. On hover, shows a popover
 * with the plain-language definition.
 *
 * Usage:
 *   <GlossaryPopover term="ATR" />
 *   <GlossaryPopover term="pullback">pullbacks</GlossaryPopover>
 *
 * If the term isn't in the glossary, it renders as plain text (no popover).
 */

import { useState, useRef, useCallback } from 'react';
import { lookupGlossary } from '../data/glossary';
import './glossary-popover.css';

const POPOVER_ID = 'glossary-popover-root';

export default function GlossaryPopover({ term, children }) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const triggerRef = useRef(null);
  const timeoutRef = useRef(null);

  const entry = lookupGlossary(term);
  const displayText = children || term;

  // If not a glossary term, render as plain text
  if (!entry) return <span>{displayText}</span>;

  const show = useCallback(() => {
    clearTimeout(timeoutRef.current);
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    // Position popover above the term, centered horizontally, with viewport clamping
    const popoverWidth = 300;
    let x = rect.left + rect.width / 2 - popoverWidth / 2;
    x = Math.max(8, Math.min(x, window.innerWidth - popoverWidth - 8));
    setPosition({ x, y: rect.top - 8 });
    setVisible(true);
  }, []);

  const hide = useCallback(() => {
    timeoutRef.current = setTimeout(() => setVisible(false), 150);
  }, []);

  const handlePopoverEnter = useCallback(() => {
    clearTimeout(timeoutRef.current);
  }, []);

  return (
    <>
      <span
        ref={triggerRef}
        className="glossary-term"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        tabIndex={0}
        role="button"
        aria-describedby={visible ? POPOVER_ID : undefined}
      >
        {displayText}
      </span>
      {visible && (
        <div
          id={POPOVER_ID}
          className="glossary-popover"
          role="tooltip"
          style={{ left: position.x, top: position.y }}
          onMouseEnter={handlePopoverEnter}
          onMouseLeave={hide}
        >
          <div className="glossary-popover-term">{entry.term}</div>
          <div className="glossary-popover-def">{entry.definition}</div>
          {entry.category && (
            <div className="glossary-popover-cat">{entry.category}</div>
          )}
        </div>
      )}
    </>
  );
}
