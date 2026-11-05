/**
 * StatCard — one tile in the backtest Result grid, with an explanation that appears on HOVER AFTER
 * TWO SECONDS (owner direction, 2026-11-04: *"we need a popover explaining them when mouse hovered over
 * for 2 seconds."*)
 *
 * ── WHY A TIMER, AND WHY 2s ────────────────────────────────────────────────────────────────────
 * A `title` tooltip opens almost instantly, so sweeping the pointer across a row of twelve tiles
 * flashes twelve boxes and the reader learns to ignore all of them. Two seconds is enough that the
 * popover only appears on the tile someone actually stopped at, which is the whole point of an
 * explanation: it is read on demand, not sprayed.
 *
 * ⚠️ THE 2s RULE DOES NOT APPLY TO THE KEYBOARD. A reader who tabs to a tile has already declared
 * intent by parking focus on it, and making them wait two seconds per tile would make the grid
 * unusable without a mouse — so focus opens after 400 ms. WCAG 2.2.1 has no "no delay" requirement,
 * but a 2s delay on every tab stop is a keyboard barrier in practice.
 *
 * ⚠️ THE TILE IS FOCUSABLE (`tabIndex=0`) BECAUSE THE NOTE IS THE ONLY PLACE SOME OF THESE NUMBERS ARE
 * EXPLAINED. Content reachable only by hover is unreachable to a keyboard or screen-reader user, and
 * `aria-describedby` on a non-focusable div announces nothing.
 *
 * ⚠️ THE POPOVER IS RENDERED ONLY WHEN OPEN, not hidden with CSS, so a closed tile cannot be reached
 * by a screen reader reading the whole page as a wall of prose. Escape closes it, as expected of a
 * transient overlay.
 */
import { useEffect, useId, useRef, useState } from 'react';

/** Owner's stated delay for the pointer. */
const HOVER_DELAY_MS = 2000;
/** Keyboard focus has already shown intent — see the note above. */
const FOCUS_DELAY_MS = 400;

export default function StatCard({
  toneClass = '',
  valueClass = 'bt-stat-value',
  value,
  label,
  /** The explanation. Required in spirit: a tile with no note is a tile nobody can interpret. */
  note,
  /** Optional extra line under the label, e.g. a unit or a comparator. */
  sub,
}) {
  const [open, setOpen] = useState(false);
  const timer = useRef(null);
  const id = useId();

  const cancel = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };
  const schedule = (ms) => {
    cancel();
    if (!note) return;
    timer.current = setTimeout(() => setOpen(true), ms);
  };
  const close = () => {
    cancel();
    setOpen(false);
  };

  // A pending timer must not survive unmount (a new run re-renders the grid).
  useEffect(() => cancel, []);

  return (
    <div
      className={`bt-stat ${toneClass}${open ? ' bt-stat--open' : ''}`}
      tabIndex={0}
      aria-describedby={open ? id : undefined}
      onMouseEnter={() => schedule(HOVER_DELAY_MS)}
      onMouseLeave={close}
      onFocus={() => schedule(FOCUS_DELAY_MS)}
      onBlur={close}
      onKeyDown={(e) => {
        if (e.key === 'Escape') close();
      }}
    >
      <div className={valueClass}>{value}</div>
      <div className="bt-stat-label">{label}</div>
      {sub && <div className="bt-stat-sub">{sub}</div>}
      {open && note && (
        <div className="bt-stat-pop" id={id} role="tooltip">
          {note}
        </div>
      )}
    </div>
  );
}
