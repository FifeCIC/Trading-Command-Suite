/**
 * WidgetBoard
 * ===========
 * A widget dashboard surface: pulls widget definitions from the widget registry
 * and lets the user add them from a library, then arrange them on a snapped
 * grid. The chosen arrangement persists per `boardId`.
 *
 * Built on **react-grid-layout v2** (MIT) rather than hand-rolled drag code:
 *   - tiles snap to grid cells while dragging, and push their neighbours aside
 *     (vertical compaction) instead of overlapping;
 *   - tiles resize in whole grid units from the corner/edge handles, bounded by
 *     each widget's `minW`/`minH` and by the column count;
 *   - a `GridBackground` overlay draws the actual cells behind the tiles while
 *     the user is dragging/resizing (or pinned on via the Grid toggle), so the
 *     snap that the pointer is committing to is visible;
 *   - the drop target is shown by the library's own placeholder.
 *
 * Layout is persisted by `src/core/board-store.js` — one versioned document per
 * board (`tcs:view-state:widgets-board:<boardId>`), not the retired
 * `widgets:<id>` / `widgets-layout:<id>` split keys. Read that file before
 * changing what a board stores.
 *
 * Keyboard: react-grid-layout is pointer-only, so each tile exposes a grip that
 * opens an arrange strip (WCAG 2.2 AA needs a non-pointer path). Arrow keys on
 * the grip move the tile, Shift+arrow resizes it.
 *
 * Reuse story ("the bridge"): a widget is just a React component registered in
 * `src/core/widget-registry.js`. Components that already draw their own card
 * chrome register with `frame: false` and are dropped in as-is; bare components
 * register with `frame: true` and get the board's title bar. Inline JSX inside a
 * page cannot be reused until it is extracted into its own component.
 *
 * Props:
 *   boardId        — storage namespace for this board's layout
 *   defaultWidgets — widget ids seeded on first visit
 *   title          — optional heading
 *   editable       — set false for a locked/read-only board
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Responsive, verticalCompactor } from 'react-grid-layout';
import { GridBackground } from 'react-grid-layout/extras';
// Library CSS: `.react-grid-item` transitions + the `.react-resizable-handle`
// affordance. We override its greys/red placeholder in widget-board.css.
import 'react-grid-layout/css/styles.css';
import { usePersistentState } from '../hooks/usePersistentState';
import { getWidget, getWidgets } from '../core/widget-registry';
import {
  COLS,
  bottomOf,
  buildAllLayouts,
  loadBoard,
  nextUid,
  packLayout,
  saveBoardLocal,
  seedItems,
  subscribeBoard,
} from '../core/board-store';
import './widgets/builtin-widgets'; // side-effect: registers built-in widgets
import './widgets/dashboard-widgets'; // side-effect: registers the converted dashboard cards
import './widget-board.css';

/**
 * Rendering geometry. The column counts and the registry-to-grid footprint
 * maths live in the board store (they are part of the persisted contract);
 * these are presentation concerns only. Row height 28 + margin 12 gives a 40px
 * rhythm, so a widget with h=5 is ~190px tall.
 */
const BREAKPOINTS = { lg: 1400, md: 1000, sm: 640, xs: 0 };
const ROW_HEIGHT = 28;
const MARGIN = [12, 12];

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/**
 * ArrangeKeys — keyboard equivalent of drag & resize (WCAG 2.1.1: every
 * pointer interaction needs a keyboard path, and react-grid-layout is
 * pointer-only). Rendered when the tile's grip is toggled.
 */
function ArrangeKeys({ title, onNudge, onGrow, onClose }) {
  const move = [
    { label: 'left', dx: -1, dy: 0, glyph: '◀' },
    { label: 'right', dx: 1, dy: 0, glyph: '▶' },
    { label: 'up', dx: 0, dy: -1, glyph: '▲' },
    { label: 'down', dx: 0, dy: 1, glyph: '▼' },
  ];
  const size = [
    { label: 'narrower', dw: -1, dh: 0, glyph: '⇥' },
    { label: 'wider', dw: 1, dh: 0, glyph: '⇤' },
    { label: 'shorter', dw: 0, dh: -1, glyph: '⌃' },
    { label: 'taller', dw: 0, dh: 1, glyph: '⌄' },
  ];
  return (
    <div className="wb-keys" role="group" aria-label={`Arrange ${title} with the keyboard`}>
      {move.map((m) => (
        <button
          key={m.label}
          type="button"
          className="wb-key"
          title={`Move ${m.label}`}
          aria-label={`Move ${title} ${m.label}`}
          onClick={() => onNudge(m.dx, m.dy)}
        >
          <span aria-hidden="true">{m.glyph}</span>
        </button>
      ))}
      <span className="wb-keys-sep" aria-hidden="true" />
      {size.map((s) => (
        <button
          key={s.label}
          type="button"
          className="wb-key"
          title={`Make ${s.label}`}
          aria-label={`Make ${title} ${s.label}`}
          onClick={() => onGrow(s.dw, s.dh)}
        >
          <span aria-hidden="true">{s.glyph}</span>
        </button>
      ))}
      <button
        type="button"
        className="wb-key wb-key--done"
        onClick={onClose}
        title="Finish arranging"
        aria-label="Finish arranging"
      >
        <span aria-hidden="true">✓</span>
      </button>
    </div>
  );
}

export default function WidgetBoard({
  boardId = 'default',
  defaultWidgets = [],
  title,
  editable = true,
}) {
  // One versioned document per board (= per screen) plus a saved search of the
  // grid overlay. Persistence itself lives in src/core/board-store.js so the
  // server-backed version drops in without touching this component.
  const [board, setBoard] = useState(() => loadBoard(boardId, defaultWidgets));
  const [gridPinned, setGridPinned] = usePersistentState(`widgets-grid:${boardId}`, false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [interacting, setInteracting] = useState(false);
  const [keysFor, setKeysFor] = useState(null);
  /**
   * Container width — OUR OWN measurement, replacing the library's `useContainerWidth`.
   *
   * ⚠️ WHY, MEASURED 2026-10-08. The dashboard scrolled horizontally on a narrow window: the grid's
   * content measured **1188px inside an 817px box**, with 6 of 13 tiles past its right edge and the
   * document 1222px wide. The tiles' inline widths were computed for a **~1200px container** — exactly
   * the library's `initialWidth` — so the layout was being built for a width the container never had.
   *
   * `useContainerWidth` measures through a ResizeObserver. When that observer does not fire, the
   * initial value simply STANDS, and nothing corrects it. The failure is silent by construction: a
   * layout that is too wide still renders perfectly, just past the edge of the page.
   *
   * Measuring here and re-measuring on BOTH the observer and a plain `resize` event means a missed
   * observer callback is recoverable rather than permanent. Same class as the `.market-tape` / #853
   * trap: one measurement taken once and never revisited.
   *
   * ⚠️ `mounted` is set AFTER the first measure, so the grid's first paint already uses the real width
   * rather than the fallback — the library's own latch could mount before it had measured.
   */
  const containerRef = useRef(null);
  const [width, setWidth] = useState(1200);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // ⚠️ `mounted` IS SET UNCONDITIONALLY, FIRST. An earlier version returned early when the shell was
    // not yet in the DOM, which skipped this line — so the board rendered NOTHING. That failure is
    // worth recording because it looked like success: `document.scrollWidth` fell to exactly the
    // viewport width, i.e. "no overflow", and the real reason was that there was no grid to overflow.
    // A measurement that reads as a fix while the thing under test is absent is worse than no
    // measurement.
    setMounted(true);

    let cleanup = () => {};
    const attach = () => {
      const el = containerRef.current;
      if (!el) return false;
      const measure = () => {
        const w = Math.round(el.getBoundingClientRect().width);
        // A zero width (display:none, mid-unmount) would collapse every tile — ignore it.
        if (w > 0) setWidth((prev) => (prev === w ? prev : w));
      };
      measure();
      let ro = null;
      if (typeof ResizeObserver !== 'undefined') {
        ro = new ResizeObserver(measure);
        ro.observe(el);
      }
      window.addEventListener('resize', measure);
      cleanup = () => {
        if (ro) ro.disconnect();
        window.removeEventListener('resize', measure);
      };
      return true;
    };

    // The shell only exists once the board is in grid mode, so the first pass can find no element.
    // Retry briefly rather than depending on the name of the flag that gates it — and stop after ~2s
    // so a board that never mounts does not leave a timer running.
    if (!attach()) {
      let tries = 0;
      const t = setInterval(() => {
        tries += 1;
        if (attach() || tries > 40) clearInterval(t);
      }, 50);
      cleanup = () => clearInterval(t);
    }
    return () => cleanup();
  }, []);

  const items = board.items;
  const layouts = board.layouts;

  // Same call shape the board always used (`setItems(fn)` / `setLayouts(fn)`) —
  // they just write into the one document now.
  const setItems = useCallback(
    (updater) => setBoard((prev) => ({ ...prev, items: typeof updater === 'function' ? updater(prev.items) : updater })),
    []
  );
  const setLayouts = useCallback(
    (updater) => setBoard((prev) => ({ ...prev, layouts: typeof updater === 'function' ? updater(prev.layouts) : updater })),
    []
  );

  useEffect(() => {
    saveBoardLocal(boardId, board);
  }, [boardId, board]);

  // Another tab/screen editing the same board wins the race rather than
  // silently diverging (multi-screen setups run several windows side by side).
  useEffect(() => subscribeBoard(boardId, setBoard), [boardId]);

  /**
   * Active breakpoint is derived from the measured width — the same rule
   * react-grid-layout applies — rather than tracked via onBreakpointChange.
   * ⚠️ If these ever disagree, edits are written to the wrong stored layout key
   * (the tile appears to snap back on the next render).
   */
  const activeBp = useMemo(() => {
    const sorted = Object.entries(BREAKPOINTS).sort((a, b) => b[1] - a[1]);
    const match = sorted.find(([, minWidth]) => width >= minWidth);
    return match ? match[0] : 'xs';
  }, [width]);

  const cols = COLS[activeBp] ?? COLS.lg;
  const gridShown = interacting || gridPinned;

  /**
   * Reconcile stored geometry against the current widget list: drop entries for
   * widgets that no longer exist, and append (at the bottom) any widget lacking
   * geometry — e.g. one just added, or a board stored before geometry existed.
   * react-grid-layout requires a layout entry per child, so this guarantees one.
   */
  const safeLayouts = useMemo(() => {
    const known = new Set(items.map((it) => it.uid));
    const out = {};
    for (const [bp, colCount] of Object.entries(COLS)) {
      const base = (Array.isArray(layouts?.[bp]) ? layouts[bp] : []).filter((l) => known.has(l.i));
      const placed = new Set(base.map((l) => l.i));
      const missing = items.filter((it) => !placed.has(it.uid));
      out[bp] = missing.length ? [...base, ...packLayout(missing, colCount, bottomOf(base))] : base;
    }
    return out;
  }, [items, layouts]);

  const rendered = useMemo(
    () =>
      items
        .map((item) => ({ item, def: getWidget(item.widgetId) }))
        .filter((entry) => !!entry.def),
    [items]
  );

  const maxRow = bottomOf(safeLayouts[activeBp]) + 1;

  // ⚠️ Dragging must not start from the tile's own buttons — hence `cancel`.
  const dragConfig = useMemo(
    () => ({
      enabled: editable,
      handle: '.wb-tile-head, .wb-drag-handle',
      cancel: 'button:not(.wb-grip-btn), .wb-keys, .wb-keys *',
    }),
    [editable]
  );

  const resizeConfig = useMemo(
    () => ({ enabled: editable, handles: ['se', 'e', 's'] }),
    [editable]
  );

  /**
   * Persist geometry. ⚠️ Do NOT rely on `onLayoutChange` alone: with the
   * responsive grid it does not fire on every drop, which silently left the
   * tile visually moved while the stored layout stayed stale. The drag/resize
   * stop callbacks hand over the committed layout as their first argument
   * (EventCallback), so those are the authoritative write points.
   */
  const commitLayout = useCallback(
    (layout) => {
      if (!Array.isArray(layout) || layout.length === 0) return;
      setLayouts((prev) => {
        const current = prev?.[activeBp];
        if (JSON.stringify(current) === JSON.stringify(layout)) return prev;
        return { ...(prev || {}), [activeBp]: layout.map((l) => ({ ...l })) };
      });
    },
    [activeBp, setLayouts]
  );

  /**
   * Sync breakpoints the user is NOT currently editing (react-grid-layout
   * derives narrower/wider variants from the active one). The active breakpoint
   * is deliberately skipped — it is owned by commitLayout(), and letting this
   * callback write it too meant the drop was immediately overwritten by the
   * pre-drop layout.
   */
  const handleLayoutChange = useCallback(
    (_layout, allLayouts) => {
      if (!allLayouts) return;
      setLayouts((prev) => {
        const current = prev || {};
        const next = { ...current };
        let changed = false;
        for (const [bp, list] of Object.entries(allLayouts)) {
          if (bp === activeBp) continue;
          if (JSON.stringify(current[bp]) !== JSON.stringify(list)) {
            next[bp] = list;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    },
    [activeBp, setLayouts]
  );

  const addWidget = useCallback(
    (widgetId) => {
      const uid = nextUid();
      setItems((prev) => [...(Array.isArray(prev) ? prev : []), { uid, widgetId }]);
      setLayouts((prev) => {
        const next = { ...(prev || {}) };
        for (const [bp, colCount] of Object.entries(COLS)) {
          const base = Array.isArray(next[bp]) ? next[bp] : [];
          next[bp] = [...base, ...packLayout([{ uid, widgetId }], colCount, bottomOf(base))];
        }
        return next;
      });
      return uid;
    },
    [setItems, setLayouts]
  );

  const removeWidget = useCallback(
    (uid) => {
      setItems((prev) => (Array.isArray(prev) ? prev.filter((it) => it.uid !== uid) : []));
      setLayouts((prev) => {
        const next = {};
        for (const [bp, list] of Object.entries(prev || {})) {
          next[bp] = (Array.isArray(list) ? list : []).filter((l) => l.i !== uid);
        }
        return next;
      });
      setKeysFor((current) => (current === uid ? null : current));
    },
    [setItems, setLayouts]
  );

  const resetLayout = useCallback(() => {
    const seeded = seedItems(defaultWidgets);
    setItems(seeded);
    setLayouts(buildAllLayouts(seeded));
    setKeysFor(null);
  }, [defaultWidgets, setItems, setLayouts]);

  /**
   * fillWidth() — re-pack the CURRENT widgets so they span the full grid. Owner request 2026-10-11:
   * *"this area that includes the tiles also doesn't allow widgets to be dragged into a large portion
   * of the page area."*
   *
   * ⚠️ THIS IS NOT `resetLayout`, AND THE TWO MUST NOT BE MERGED. `resetLayout` above re-seeds from
   * `defaultWidgets`, so it DISCARDS a hand-arranged board. This packs the widgets the user actually
   * has. Conflating them would make "fill the width" silently delete widgets, which is the sort of
   * helpful-looking button that costs a user their arrangement.
   *
   * WHY IT IS NEEDED AT ALL: tiles are positioned in COLUMNS, and a saved layout can leave columns
   * unused — measured on the dashboard, one row used 9 of 12 columns, so three columns rendered as an
   * empty gap beside the tiles and no amount of dragging filled it permanently. `buildAllLayouts` —
   * the same packing the board already uses for a fresh board — closes those gaps across every
   * breakpoint. Nothing moves until this is pressed, so the arrangement stays the user's.
   */
  const fillWidth = useCallback(() => {
    if (!items.length) return;
    setLayouts(buildAllLayouts(items));
    setKeysFor(null);
  }, [items, setLayouts]);

  const clearBoard = useCallback(() => {
    setItems([]);
    setLayouts({});
    setKeysFor(null);
  }, [setItems, setLayouts]);

  /** Keyboard move/resize — only touches the active breakpoint. */
  const mutateItem = useCallback(
    (uid, fn) =>
      setLayouts((prev) => {
        const next = { ...(prev || {}) };
        const list = Array.isArray(next[activeBp]) ? next[activeBp] : [];
        next[activeBp] = list.map((l) => (l.i === uid ? fn(l) : l));
        return next;
      }),
    [activeBp, setLayouts]
  );

  const nudge = useCallback(
    (uid, dx, dy) =>
      mutateItem(uid, (l) => ({
        ...l,
        x: clamp(l.x + dx, 0, Math.max(0, cols - l.w)),
        y: Math.max(0, l.y + dy),
      })),
    [cols, mutateItem]
  );

  const grow = useCallback(
    (uid, dw, dh) =>
      mutateItem(uid, (l) => ({
        ...l,
        w: clamp(l.w + dw, l.minW || 1, clamp(cols - l.x, l.minW || 1, cols)),
        h: Math.max(l.minH || 3, l.h + dh),
      })),
    [cols, mutateItem]
  );

  return (
    <div className="wb">
      <div className="wb-toolbar">
        {editable && (
          <button
            type="button"
            className={`wb-btn ${libraryOpen ? 'wb-btn--ghost' : 'wb-btn--primary'}`}
            aria-expanded={libraryOpen}
            onClick={() => setLibraryOpen((open) => !open)}
          >
            {libraryOpen ? 'Close library' : '+ Add widget'}
          </button>
        )}
        {title && <span className="wb-title">{title}</span>}
        <span className="wb-count">
          {items.length} widget{items.length === 1 ? '' : 's'}
        </span>
        <span className="wb-spacer" />
        {editable && (
          <button
            type="button"
            className={`wb-btn ${gridPinned ? 'wb-btn--on' : 'wb-btn--ghost'}`}
            aria-pressed={gridPinned}
            title="Keep the grid visible while arranging"
            onClick={() => setGridPinned((on) => !on)}
          >
            ▦ Grid
          </button>
        )}
        {editable && items.length > 0 && (
          <>
            <button
              type="button"
              className="wb-btn wb-btn--ghost"
              onClick={fillWidth}
              title="Re-pack the widgets you have so they span the full grid width. Moves tiles; removes nothing."
            >
              Fill width
            </button>
            <button
              type="button"
              className="wb-btn wb-btn--ghost"
              onClick={resetLayout}
              title="Restore the default widget set for this board — this REPLACES the widgets you have added."
            >
              Reset
            </button>
            <button type="button" className="wb-btn wb-btn--ghost" onClick={clearBoard}>
              Clear
            </button>
          </>
        )}
      </div>

      {editable && libraryOpen && <WidgetLibrary layout={items} onAdd={addWidget} />}

      {rendered.length === 0 ? (
        <div className="wb-empty">
          <p>No widgets yet.</p>
          {editable && (
            <p className="wb-muted">
              Open the library to add widgets — then drag a tile by its header to move it, or pull
              the bottom-right corner to resize. Your layout is saved for this board.
            </p>
          )}
        </div>
      ) : (
        <div className={`wb-grid-shell${interacting ? ' is-interacting' : ''}`} ref={containerRef}>
          {gridShown && mounted && (
            <div className="wb-grid-bg" aria-hidden="true">
              <GridBackground
                width={width}
                cols={cols}
                rowHeight={ROW_HEIGHT}
                margin={MARGIN}
                rows={maxRow}
                color="currentColor"
              />
            </div>
          )}
          {mounted && (
            <Responsive
              className="wb-grid"
              width={width}
              layouts={safeLayouts}
              breakpoints={BREAKPOINTS}
              cols={COLS}
              rowHeight={ROW_HEIGHT}
              margin={MARGIN}
              compactor={verticalCompactor}
              dragConfig={dragConfig}
              resizeConfig={resizeConfig}
              onBreakpointChange={() => {} /* breakpoint is derived from width */}
              onLayoutChange={handleLayoutChange}
              onDragStart={() => setInteracting(true)}
              onDragStop={(layout) => {
                setInteracting(false);
                commitLayout(layout);
              }}
              onResizeStart={() => setInteracting(true)}
              onResizeStop={(layout) => {
                setInteracting(false);
                commitLayout(layout);
              }}
            >
              {rendered.map(({ item, def }) => {
                const Component = def.Component;
                const ownChrome = def.frame === false;
                const keysOpen = keysFor === item.uid;
                return (
                  <section
                    key={item.uid}
                    className={`wb-tile ${ownChrome ? 'wb-tile--own-chrome' : ''}`}
                  >
                    {!ownChrome ? (
                      <header className="wb-tile-head">
                        <button
                          type="button"
                          className="wb-grip-btn"
                          aria-expanded={keysOpen}
                          aria-label={`Arrange ${def.title}`}
                          title="Drag to move · click for keyboard controls"
                          onClick={() => setKeysFor(keysOpen ? null : item.uid)}
                          onKeyDown={(event) => {
                            const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[
                              event.key
                            ];
                            if (!step) return;
                            event.preventDefault();
                            if (event.shiftKey) grow(item.uid, step[0], step[1]);
                            else nudge(item.uid, step[0], step[1]);
                          }}
                        >
                          <span aria-hidden="true">⠿</span>
                        </button>
                        <span className="wb-tile-title">
                          <span aria-hidden="true">{def.icon}</span> {def.title}
                        </span>
                        {editable && (
                          <button
                            type="button"
                            className="wb-tile-btn"
                            title={`Remove ${def.title}`}
                            aria-label={`Remove ${def.title}`}
                            onClick={() => removeWidget(item.uid)}
                          >
                            ✕
                          </button>
                        )}
                      </header>
                    ) : (
                      editable && (
                        <button
                          type="button"
                          className="wb-drag-handle"
                          aria-expanded={keysOpen}
                          aria-label={`Arrange ${def.title}`}
                          title="Drag to move · click for keyboard controls"
                          onClick={() => setKeysFor(keysOpen ? null : item.uid)}
                        >
                          <span aria-hidden="true">⠿</span>
                        </button>
                      )
                    )}
                    {ownChrome && editable && (
                      <button
                        type="button"
                        className="wb-tile-btn wb-tile-btn--float"
                        title={`Remove ${def.title}`}
                        aria-label={`Remove ${def.title}`}
                        onClick={() => removeWidget(item.uid)}
                      >
                        ✕
                      </button>
                    )}
                    <div className="wb-tile-body">
                      <Component />
                    </div>
                    {editable && keysOpen && (
                      <ArrangeKeys
                        title={def.title}
                        onNudge={(dx, dy) => nudge(item.uid, dx, dy)}
                        onGrow={(dw, dh) => grow(item.uid, dw, dh)}
                        onClose={() => setKeysFor(null)}
                      />
                    )}
                  </section>
                );
              })}
            </Responsive>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * WidgetLibrary — picker listing every registered widget. Duplicates are
 * allowed (e.g. two lots of Open Positions), so the button never disables.
 */
function WidgetLibrary({ layout, onAdd }) {
  const widgets = getWidgets();
  const counts = useMemo(() => {
    const map = new Map();
    (layout || []).forEach((item) => map.set(item.widgetId, (map.get(item.widgetId) || 0) + 1));
    return map;
  }, [layout]);

  const byCategory = useMemo(() => {
    const groups = new Map();
    widgets.forEach((w) => {
      const key = w.category || 'Other';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(w);
    });
    return Array.from(groups.entries());
  }, [widgets]);

  return (
    <div className="wb-library" role="region" aria-label="Widget library">
      <div className="wb-library-head">
        <strong>Widget library</strong>
        <span className="wb-muted">{widgets.length} available</span>
      </div>
      {byCategory.map(([category, list]) => (
        <div key={category} className="wb-lib-section">
          <span className="wb-library-cat">{category}</span>
          <ul className="wb-library-list">
            {list.map((w) => (
              <li key={w.id} className="wb-library-item">
                <span className="wb-library-icon" aria-hidden="true">
                  {w.icon}
                </span>
                <span className="wb-library-info">
                  <strong>{w.title}</strong>
                  <span className="wb-muted">{w.description}</span>
                </span>
                {counts.get(w.id) > 0 && <span className="wb-library-badge">{counts.get(w.id)}</span>}
                <button type="button" className="wb-btn wb-btn--add" onClick={() => onAdd(w.id)}>
                  Add
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
