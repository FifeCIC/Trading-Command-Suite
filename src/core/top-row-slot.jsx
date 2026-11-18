/**
 * TopRowSlot — lets any page inject content into the app shell's top row
 * (next to the breadcrumbs), without the shell needing to know about the page.
 * =============================================================================
 * The `.main-top-row` in App.jsx is part of the shared shell. Pages render
 * below it, so they can't place content there directly. This module provides
 * a portal-like slot:
 *
 *   // Inside any page component (must be rendered within <TopRowSlotProvider>):
 *   <TopRowSlotContent>
 *     <span className="pl-refresh">⟳ 12s</span>
 *   </TopRowSlotContent>
 *
 * The content is lifted into the shell's top row and removed when the page
 * unmounts (or stops rendering <TopRowSlotContent>).
 *
 * Design notes:
 *   - Two contexts: a stable setter (never changes) and the content itself.
 *     Pages consume the setter only, so they don't re-render when content
 *     changes; the Host consumes the content only, so it re-renders on change.
 *   - Single-slot: last page to render wins. The app renders one view at a
 *     time, so this is sufficient.
 */
import { createContext, useContext, useEffect, useState } from 'react';

const SlotSetterContext = createContext(null);
const SlotContentContext = createContext(null);
const PageInfoSetterContext = createContext(null);
const PageInfoContentContext = createContext(null);

export function TopRowSlotProvider({ children }) {
  const [content, setContent] = useState(null);
  const [pageInfo, setPageInfo] = useState(null);
  return (
    <SlotSetterContext.Provider value={setContent}>
      <SlotContentContext.Provider value={content}>
        <PageInfoSetterContext.Provider value={setPageInfo}>
          <PageInfoContentContext.Provider value={pageInfo}>
            {children}
          </PageInfoContentContext.Provider>
        </PageInfoSetterContext.Provider>
      </SlotContentContext.Provider>
    </SlotSetterContext.Provider>
  );
}

/**
 * PageInfoSlot — lets a page put LIVE content inside the shell's ℹ popover.
 * =========================================================================
 * The shell renders one ℹ in `.main-top-row`, next to the breadcrumbs, for any view with a
 * `VIEW_EXPLANATIONS` entry. That text is static (it lives in a data file), so a page could not
 * contribute a figure that changes every refresh — and the alternative, which the app had drifted
 * into, was a per-page ℹ somewhere on the page and a second "12 venues · 2 tradeable" line under a
 * section heading. That is two explanations of one view, in two places, with no rule about which is
 * authoritative.
 *
 *   // inside any page (must be within <TopRowSlotProvider>)
 *   <PageInfoSlotContent>
 *     <p>12 venues · 2 tradeable in TCS</p>
 *   </PageInfoSlotContent>
 *
 * Same single-slot rule and same unmount-clearing as the top-row slot beside it.
 */

/** Registers children inside the shell's ℹ popover on mount; clears on unmount. */
export function PageInfoSlotContent({ children }) {
  const setPageInfo = useContext(PageInfoSetterContext);
  useEffect(() => {
    if (!setPageInfo) return;
    setPageInfo(children);
    return () => setPageInfo(null);
  }, [setPageInfo, children]);
  return null;
}

/** Reads the current page-info content — used by the shell to decide whether the ℹ renders at all. */
export function usePageInfoContent() {
  return useContext(PageInfoContentContext);
}

export { PageInfoSlotContent as default };

/**
 * Renders whatever the current page registered into the top-row slot.
 *
 * ⚠️ RETURNS NOTHING WHEN EMPTY (2026-10-11) — do not "tidy" this back into an always-rendered
 * wrapper. It used to render `<div className="main-top-slot">{content ?? null}</div>`
 * unconditionally, which meant an empty wrapper existed in the shell on every page that used no slot.
 * The consequence was measured on /dashboard/dashboard: `.main-top-right` could never be `:empty`, so
 * the `index.css` rule that collapses `.main-top-row` when it holds nothing could never fire — and
 * the row's padding (0.3rem + 0.1rem) rendered as a **1885px × 6px empty bar** with no purpose. The
 * owner reported it as *"a very thin bar reaching from left to right of the widgets area."*
 *
 * A wrapper that exists only to be empty is the thing that made the row undetectably empty. Returning
 * null restores the DOM truth: no content → no element → the row collapses, and a page that DOES
 * inject (SymbolsLadderPage's refresh countdown) brings the row back with no CSS change.
 */
export function TopRowSlotHost() {
  const content = useContext(SlotContentContext);
  if (!content) return null;
  return <div className="main-top-slot">{content}</div>;
}

/** Registers children into the top-row slot on mount; clears on unmount. */
export function TopRowSlotContent({ children }) {
  const setContent = useContext(SlotSetterContext);
  useEffect(() => {
    if (!setContent) return;
    setContent(children);
    return () => setContent(null);
  }, [setContent, children]);
  return null;
}
