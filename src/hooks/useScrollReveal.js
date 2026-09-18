/**
 * useScrollReveal(rootRef, deps) — reveal-on-scroll for cards inside `rootRef`.
 * ============================================================================
 * Extracted from `LadderPage.jsx` (2026-09-17, issue #672 logic) so the META.Stack
 * Cockpit gets the SAME behaviour by calling the hook, rather than either
 * (a) copying this 30-line observer, or
 * (b) reusing the `lad-reveal` class without it.
 *
 * 🛑 WHY THIS IS SHARED AND NOT OPTIONAL
 * `.lad-reveal` is `opacity: 0` in `ladder.css`. Visibility is granted ONLY by the
 * `lad-reveal--show` class, which this hook adds. So a page that renders a score
 * card but never calls this hook renders **completely invisible cards** — no
 * error, no warning, just an empty column. That is exactly the "plausible output,
 * no error" signature the project's development philosophy warns about, so the
 * behaviour travels with the card instead of being re-established per page.
 *
 * SAFE BY DESIGN — the original invariants are preserved verbatim:
 *   - any card already within the viewport is revealed immediately (before paint,
 *     no flash) — a warm-up is NOT required and must not replace this;
 *   - cards are never left hidden while visible;
 *   - if IntersectionObserver is unavailable, OR the viewport cannot be measured
 *     (headless / embedded contexts where `innerHeight` is 0), EVERYTHING is
 *     revealed rather than risking stuck-hidden cards.
 *
 * popLayout / reordering / exit animations are untouched because only an inner
 * content div (`.lad-reveal`) is observed — never the motion wrapper itself.
 *
 * @param {{current: HTMLElement|null}} rootRef  scroll container holding the cards
 * @param {Array} deps  re-run when the rendered card set changes (e.g. `[list]`)
 */
import { useLayoutEffect } from 'react';

export function useScrollReveal(rootRef, deps = []) {
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const ioSupported = typeof IntersectionObserver !== 'undefined';
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;

    const revealAll = () => root.querySelectorAll('.lad-reveal').forEach((el) => {
      el.classList.add('lad-reveal--show');
      el.dataset.revealed = '1';
    });

    // Safety: never leave cards hidden. If IO is unavailable OR we cannot
    // reliably measure the viewport, reveal everything rather than risk
    // stuck-hidden cards.
    if (!ioSupported || vh <= 0) { revealAll(); return; }

    const observers = [];
    root.querySelectorAll('.lad-reveal').forEach((el) => {
      if (el.dataset.revealed === '1') return;
      const reveal = () => { el.classList.add('lad-reveal--show'); el.dataset.revealed = '1'; };
      const r = el.getBoundingClientRect();
      if (r.top < vh - 24 && r.bottom > 0) { reveal(); return; } // already in viewport
      // ⚠️ Already ABOVE the viewport means the reader has scrolled past it. Reveal immediately.
      // Without this a fast scroll (Page Down, scrollbar drag, Ctrl+End) can carry an element from
      // below the fold to above it BETWEEN frames, so it is never intersecting and the observer
      // never fires - leaving the element permanently at `opacity: 0` with its content INVISIBLE.
      // Measured 2026-09-18 on the per-bot truth view: 6 of 7 groups revealed, 1 skipped.
      if (r.bottom < 0) { reveal(); return; }
      const io = new IntersectionObserver((entries, obs) => {
        if (entries.some((en) => en.isIntersecting)) { reveal(); obs.disconnect(); }
        // The root is expanded 10000px UPWARD so anything already scrolled past counts as
        // intersecting. Elements BELOW the viewport are still outside it and still wait for the
        // scroll, so the reveal effect is preserved - the skip simply becomes impossible.
      }, { threshold: 0.05, rootMargin: '10000px 0px -24px 0px' });
      io.observe(el);
      observers.push(io);
    });

    return () => observers.forEach((o) => o.disconnect());
    // `deps` is supplied by the caller — the card set is what should re-arm this,
    // not the identity of the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
