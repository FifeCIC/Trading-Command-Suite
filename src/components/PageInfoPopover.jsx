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
 *
 * `label` names the overlay for assistive tech and the native tooltip. It defaults to "Page info"
 * because the component began on page headers; a caller that hides a PANEL's explanation behind
 * the same trigger should say so ("Run facts and engine limits"), otherwise a screen reader
 * announces "Page info" twice on a page that has both.
 */

import { useId } from 'react';
import './page-info-popover.css';

export default function PageInfoPopover({ children, label = 'Page info' }) {
  const id = useId();

  if (!children) return null;

  return (
    <>
      <button
        type="button"
        className="pip-trigger"
        popovertarget={id}
        aria-label={label}
        title={label}
      >
        ℹ
      </button>
      <div id={id} popover="auto" className="pip-popover">
        <div className="pip-content">{children}</div>
      </div>
    </>
  );
}
