/**
 * use-explanations.js — ONE page-level preference: are the "how to read this" sentences shown inline?
 *
 * ── WHY A PREFERENCE AND NOT A DELETION (decided 2026-11-27) ───────────────────────────────────────
 * The owner's verdict after using the page for a long session: *too much text presented instantly, and
 * sentences all the way down the page are overwhelming.* The sentences were not wrong — each one was
 * written because a reader had misread the table it sits above. Deleting them would bring those
 * misreadings back; leaving them expanded makes the page hostile to the person who uses it most.
 *
 * So they become OPTIONAL: collapsed to a small marker by default, one click from full text, and the
 * choice is remembered per browser.
 *
 * ⚠️ WHAT THIS MUST NEVER COLLAPSE. An explanation answers "how do I read this number". It is NOT the
 * place for "these totals are not a result", "the engine assumed a fill", "this symbol could not run" —
 * statements about the RUN rather than about reading. Those stay in the open at all times, because a
 * reader who has hidden explanations must still be told when a number is invalid. `Explanation` is for
 * the first kind only; a warning belongs in `mvp-note--warn` or a notice block.
 *
 * ⚠️ DEFAULT IS OFF. A preference that must be discovered and turned off has already cost the reader
 * the thing it was meant to save.
 */
import { useCallback, useEffect, useState } from 'react';

const KEY = 'tcs:movers:explanations';

/** Read the stored preference. Anything unreadable is `false` — the quiet default, never a throw. */
export function readExplanations() {
  try {
    return window.localStorage.getItem(KEY) === 'on';
  } catch {
    // A blocked store (private mode, policy) is not an error the reader can act on.
    return false;
  }
}

/** Persist the preference. A blocked store is ignored: the toggle still works for this session. */
export function writeExplanations(on) {
  try {
    window.localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* the in-memory state is still correct for this page view */
  }
}

/**
 * The preference, shared by every `Explanation` on the page.
 *
 * ⚠️ A module-level listener set, not React context, deliberately: `Explanation` is mounted from SIX
 * files in three folders (the page, four step components, two backtest panels), and threading a context
 * provider through all of them would put a prop on every one — the shape this repo keeps paying for.
 */
const listeners = new Set();
let current = null;

export function useExplanations() {
  const [on, setOn] = useState(() => {
    if (current === null) current = readExplanations();
    return current;
  });

  useEffect(() => {
    const fn = (value) => setOn(value);
    listeners.add(fn);
    // Another tab toggling the preference should not leave this one disagreeing.
    const onStorage = (e) => {
      if (e.key !== KEY) return;
      current = e.newValue === 'on';
      for (const l of listeners) l(current);
    };
    window.addEventListener('storage', onStorage);
    return () => {
      listeners.delete(fn);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const set = useCallback((value) => {
    current = value;
    writeExplanations(value);
    for (const l of listeners) l(value);
  }, []);

  return [on, set];
}
