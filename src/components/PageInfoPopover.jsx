/**
 * PageInfoPopover — ℹ icon that shows a tooltip with page description
 * ===================================================================
 * Replaces visible subtitle text on page headers. Reduces screen clutter
 * by hiding explanatory text behind a hover/click info icon.
 *
 * Uses the native Popover API for positioning.
 *
 * Usage:
 *   <h1>My Page <PageInfoPopover>A description of this page.</PageInfoPopover></h1>
 */

import { useId } from 'react';
import './page-info-popover.css';

export default function PageInfoPopover({ children }) {
  const id = useId();

  if (!children) return null;

  return (
    <>
      <button
        type="button"
        className="pip-trigger"
        popovertarget={id}
        aria-label="Page info"
        title="Page info"
      >
        ℹ
      </button>
      <div id={id} popover="auto" className="pip-popover">
        <div className="pip-content">{children}</div>
      </div>
    </>
  );
}
