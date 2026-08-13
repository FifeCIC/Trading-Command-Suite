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

export function TopRowSlotProvider({ children }) {
  const [content, setContent] = useState(null);
  return (
    <SlotSetterContext.Provider value={setContent}>
      <SlotContentContext.Provider value={content}>
        {children}
      </SlotContentContext.Provider>
    </SlotSetterContext.Provider>
  );
}

/** Renders whatever the current page registered into the top-row slot. */
export function TopRowSlotHost() {
  const content = useContext(SlotContentContext);
  return <div className="main-top-slot">{content ?? null}</div>;
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
