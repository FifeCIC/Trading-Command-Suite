/**
 * ProtocolCarousel — a fixed panel that shows ONE protocol at a time and lets the wheel scroll
 * through them, snapping each card into place (#1128).
 *
 * ── Why not a <select> ──
 * The flat menu listed 47 rows of `name · N directives · max 1395`, and none of it was readable
 * while choosing: a native dropdown shows one line per option, cannot show a description, and
 * cannot show which protocol is currently active. The owner asked for the arcade-style
 * "slide, then lock" panel used in game menus.
 *
 * ── How the snap works ──
 * CSS only, for the motion: `scroll-snap-type: y mandatory` on the track and
 * `scroll-snap-align: center` on every card. The browser does the sliding and the locking — with
 * wheel, trackpad, touch and keyboard all behaving the same — so there is no scroll-hijacking
 * JavaScript and no library. `scroll-snap-stop: always` prevents a fast flick from skimming past
 * several protocols.
 *
 * This component only READS the resting position (which card is nearest the middle) and reports
 * it. It never animates scrollTop itself except when `value` is changed from outside — arrow keys.
 *
 * ⚠️ ACCESSIBILITY (`.github/instructions/accessibility-policy.instructions.md`):
 *   • The track is a `listbox` and each card an `option`, so a screen reader announces selection.
 *   • The track is focusable and Arrow Up/Down move the selection — wheel-only would make the
 *     control unusable by keyboard.
 *   • Focus is never trapped; Tab leaves the list.
 *   • Motion is dropped under `prefers-reduced-motion` (see the CSS).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import './protocol-carousel.css';

/**
 * Cards are this tall, WITH their margin (must match `--pc-card-h` in the CSS).
 *
 * ⚠️ IT MUST TRACK THE CSS. Measured 2026-10-30: the card height was 132px here and 132px in the
 * stylesheet, and both moved to 76px together. A mismatch is not a crash — it makes Arrow Up/Down land
 * between two cards, which the snap then resolves to *a* card, so the arrow appears to work while
 * skipping one.
 */
const CARD_STEP_PX = 84;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function ProtocolCarousel({ items, value, onChange, label = 'Protocol', emptyMessage }) {
  const trackRef = useRef(null);
  const cardRefs = useRef(new Map());
  const [activeIndex, setActiveIndex] = useState(0);
  const settleTimer = useRef(null);

  /**
   * Content-space centre of a card, measured against the TRACK.
   *
   * ⚠️ WAS `el.offsetTop`, AND IT PICKED THE WRONG CARD. `offsetTop` is relative to the nearest
   * POSITIONED ancestor, and `.pc-track` was not positioned — so every card's coordinate carried
   * the same constant offset from wherever the offsetParent happened to be. A constant shift does
   * not cancel in a nearest-to-centre comparison: with the track ~300px down the page, the card at
   * the TOP of the viewport measured nearest the centre, so the highlight always sat one row above
   * the card actually resting in the middle (owner report 2026-10-17).
   *
   * Rects are used instead because they need no positioning contract: the element's viewport top
   * minus the track's viewport top gives its offset within the visible box, and adding the current
   * `scrollTop` converts that to content coordinates.
   */
  const cardCentre = useCallback((track, el) => {
    const trackRect = track.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    return rect.top - trackRect.top + track.scrollTop + rect.height / 2;
  }, []);

  const scrollToIndex = useCallback((index, smooth = true) => {
    const track = trackRef.current;
    const item = items[index];
    if (!track || !item) return;
    const el = cardRefs.current.get(item.id);
    if (!el) return;
    track.scrollTo({
      top: cardCentre(track, el) - track.clientHeight / 2,
      behavior: smooth && !prefersReducedMotion() ? 'smooth' : 'auto',
    });
  }, [items, cardCentre]);

  /** Which card is resting nearest the vertical centre of the track. */
  const measure = useCallback(() => {
    const track = trackRef.current;
    if (!track) return 0;
    const centre = track.scrollTop + track.clientHeight / 2;
    let best = 0;
    let bestDistance = Infinity;
    items.forEach((item, index) => {
      const el = cardRefs.current.get(item.id);
      if (!el) return;
      const distance = Math.abs(cardCentre(track, el) - centre);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    });
    return best;
  }, [items, cardCentre]);

  // Report the resting card only once scrolling SETTLES — reporting on every scroll event would
  // fire onChange for cards merely passed through on the way to the chosen one.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return undefined;

    const onScroll = () => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
      settleTimer.current = setTimeout(() => {
        const index = measure();
        setActiveIndex((prev) => {
          if (prev === index) return prev;
          const next = items[index];
          if (next && next.id !== value) onChange(next.id);
          return index;
        });
      }, 110);
    };

    track.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      track.removeEventListener('scroll', onScroll);
      if (settleTimer.current) clearTimeout(settleTimer.current);
    };
  }, [items, measure, onChange, value]);

  // Adopt an externally-set value (arrow keys, or the page restoring a selection).
  useEffect(() => {
    const index = items.findIndex((item) => item.id === value);
    if (index < 0) return;
    setActiveIndex((prev) => {
      if (prev === index) return prev;
      scrollToIndex(index);
      return index;
    });
  }, [items, value, scrollToIndex]);

  /**
   * Re-seat the resting card when the LIST changes (a filter narrowed it).
   *
   * ⚠️ The effect above only scrolls when the INDEX changes. Filtering can replace the list and
   * leave the index at 0 while `scrollTop` stays where the previous list left it — the panel then
   * shows card 3 of the new list while card 0 is marked selected. Keyed on the id sequence so it
   * fires on list identity, not on every render.
   */
  const itemsKey = items.map((item) => item.id).join('|');
  useEffect(() => {
    const index = items.findIndex((item) => item.id === value);
    if (index < 0) return;
    setActiveIndex(index);
    scrollToIndex(index, false);
    // Deliberately keyed on itemsKey alone — `value` changes are handled above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsKey]);

  /**
   * With nothing chosen yet, the card resting in the middle is the one on show — so it is the
   * selection. Without this the panel displayed a protocol while the page considered none chosen,
   * and the run button said "Select a protocol" beside a visible protocol.
   */
  useEffect(() => {
    if (value || !items.length) return;
    const resting = items[measure()];
    if (resting) onChange(resting.id);
    // Deliberately not dependent on `measure` identity: this runs when items load or the last
    // selection is cleared, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, value]);

  const move = (delta) => {
    const next = Math.min(items.length - 1, Math.max(0, activeIndex + delta));
    if (next === activeIndex) return;
    scrollToIndex(next);
    setActiveIndex(next);
    const nextItem = items[next];
    if (nextItem) onChange(nextItem.id);
  };

  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown' || event.key === 'PageDown') {
      event.preventDefault();
      move(1);
    } else if (event.key === 'ArrowUp' || event.key === 'PageUp') {
      event.preventDefault();
      move(-1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      scrollToIndex(0);
      onChange(items[0]?.id ?? '');
    } else if (event.key === 'End') {
      event.preventDefault();
      const last = items.length - 1;
      scrollToIndex(last);
      onChange(items[last]?.id ?? '');
    }
  };

  if (!items.length) {
    return <p className="pc-empty">{emptyMessage ?? 'No protocols are available to backtest.'}</p>;
  }

  return (
    <div className="pc-wrap">
      <div className="pc-head">
        <span className="pc-label">{label}</span>
        {/* ⚠️ THE POSITION COUNTER IS GONE (owner direction, 2026-10-30: *"Remove 40 of 40
            strategies"*). It restated the length of a list the reader is already scrolling, and the
            selected card is the position — a number beside a visible one is volume, not information.
            The count is still announced where it MATTERS: the empty state names how many exist, and
            the search filter names how many match. */}
      </div>

      <div
        className="pc-track"
        ref={trackRef}
        role="listbox"
        aria-label={label}
        aria-orientation="vertical"
        aria-activedescendant={items[activeIndex] ? `pc-opt-${items[activeIndex].id}` : undefined}
        tabIndex={0}
        onKeyDown={onKeyDown}
        /* Keyboard step is declared for assistive tech; the scroll handler does the real work. */
        data-step={CARD_STEP_PX}
      >
        {items.map((item, index) => {
          const selected = index === activeIndex;
          return (
            <div
              key={item.id}
              id={`pc-opt-${item.id}`}
              role="option"
              aria-selected={selected}
              ref={(el) => {
                if (el) cardRefs.current.set(item.id, el);
                else cardRefs.current.delete(item.id);
              }}
              className={`pc-card${selected ? ' pc-card--active' : ''}`}
              // The description is hidden at compact height (2026-10-30) — it is a full paragraph and
              // would be clipped. Kept reachable as a tooltip so nothing is lost, and screen readers
              // still get it from the option's accessible name.
              title={item.description || undefined}
              onClick={() => {
                scrollToIndex(index);
                setActiveIndex(index);
                onChange(item.id);
              }}
            >
              <div className="pc-card-top">
                <span className="pc-name">{item.name || item.id}</span>
                {item.directionMode && (
                  <span className="pc-badge">{String(item.directionMode).replace('_ONLY', ' only')}</span>
                )}
              </div>

              {/* ⚠️ "capacity", NOT "max". The old menu said `max 1395`, which reads as a target a
                  run should approach. It is the sum of EVERY directive's maximum, and several are
                  mutually exclusive by design, so no run can ever reach it — a protocol that scores
                  12% of it is behaving normally. Labelled here so the number stops implying a score. */}
              {/* ⚠️ EVERY META FIELD IS NULLABLE (2026-10-22). This track is shared: the Backtest
                  Lab lists STRATEGIES in it as well as protocols (#1134), and a bot has no
                  directive count and no ceiling of its own — those belong to its protocol. Rendering
                  them unconditionally printed "undefined directives · ceiling undefined", which
                  reads as a broken protocol rather than as a bot. A field that is absent now renders
                  nothing, so one track serves both subjects without a second component. */}
              {/* ⚠️ ONE ROW FOR THE SECONDARY FACTS (2026-10-30). The card was cut to ~half its height
                  on the owner's direction, and three stacked lines (meta, style, warning) do not fit —
                  they would have been clipped by `overflow: hidden` rather than shrinking. Side by side
                  they read in one line and nothing is lost. */}
              <div className="pc-sub">
                <div className="pc-meta">
                {item.directiveCount != null && <span>{item.directiveCount} directives</span>}
                {item.directiveCount != null && item.maxScore != null && (
                  <span className="pc-dot" aria-hidden="true">·</span>
                )}
                {item.maxScore != null && (
                  <span title="Sum of every directive's maximum — a theoretical ceiling no run can reach, because several directives cannot fire on the same bar.">
                    ceiling {item.maxScore}
                  </span>
                )}
                {item.recommendedTimeframe && (
                  <>
                    {(item.directiveCount != null || item.maxScore != null) && (
                      <span className="pc-dot" aria-hidden="true">·</span>
                    )}
                    <span>{item.recommendedTimeframe}</span>
                  </>
                )}
              </div>

              {item.tradingStyle && <div className="pc-style">{item.tradingStyle}</div>}
              </div>
              {/* ⚠️ A PROTOCOL THAT CANNOT RUN SAYS SO HERE (2026-10-25). This replaced the "Has
                  symbols" filter checkbox: filtering for a broken state hides it, whereas a badge on
                  the card tells the operator which card is broken. Measured the day it shipped: 14 of
                  47 protocols resolve zero symbols, one of them ACTIVE. */}
              {item.unrunnable && (
                <div className="pc-warn" title="This protocol resolves NO symbols, so it cannot be scored or backtested. Give it a watchlist or a designated symbol.">
                  ⚠ no symbols — cannot run
                </div>
              )}
              {item.description && <p className="pc-desc">{item.description}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
