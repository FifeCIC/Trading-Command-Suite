/**
 * use-popover.js — the open/close mechanics behind every on-demand panel.
 *
 * ── WHY IT IS A HOOK AND NOT COPY-PASTED ────────────────────────────────────────────────────────
 * `WhyPopover` already had the right behaviour: outside-click closes, Escape closes, and hover is an
 * ENHANCEMENT layered on a button that still works by click and keyboard. The qualifier chips need the
 * same behaviour, and a second copy is the drift this repo pays for — one gets the next fix (a focus
 * trap, a touch dismissal) and the other does not.
 *
 * ⚠️ HOVER IS NEVER THE ONLY WAY IN. The trigger is a real `<button>`, so Enter/Space opens it and
 * `aria-expanded` reports the state. A hover-only panel is unreachable on touch and by keyboard, which
 * is why the accessibility policy forbids `title` for anything a reader needs.
 */
import { useEffect, useId, useRef, useState } from 'react';

/**
 * @param {{ hover?: boolean }} [options] `hover: true` opens on pointer-enter as well as by click.
 * @returns {{
 *   open: boolean,
 *   setOpen: (v: boolean | ((prev: boolean) => boolean)) => void,
 *   ref: object,
 *   id: string,
 *   hoverProps: object,
 *   triggerProps: object,
 * }} `triggerProps` are spread onto the button; `ref`/`hoverProps` onto the wrapping element so that
 *   moving the pointer from the trigger into the panel does not close it.
 */
export function usePopover({ hover = false } = {}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef(null);

  // A transient overlay must not survive a click elsewhere — every other surface in the app closes on
  // outside click, and a stuck panel covers the row underneath.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return {
    open,
    setOpen,
    ref,
    id,
    hoverProps: hover
      ? { onMouseEnter: () => setOpen(true), onMouseLeave: () => setOpen(false) }
      : {},
    triggerProps: {
      'aria-expanded': open,
      'aria-controls': open ? id : undefined,
      onClick: () => setOpen((v) => !v),
      onKeyDown: (e) => {
        if (e.key === 'Escape') setOpen(false);
      },
    },
  };
}
