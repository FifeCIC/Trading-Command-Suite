/**
 * Widget Registry
 * ===============
 * Single source of truth for dashboard/board widgets. Any surface (the Lab
 * widget board, later the Dashboard) can list available widgets and render one
 * by id, so existing UI can be reused as widgets instead of re-implemented.
 *
 * A widget definition:
 *   {
 *     id:          string   — stable id (storage key)
 *     title:       string   — display name
 *     icon:        string   — glyph shown in library + tile header
 *     category:    string   — grouping in the library (e.g. 'Trading')
 *     description: string   — one-line summary for the library
 *     frame:       boolean  — true  → the board draws the tile chrome (title bar)
 *                             false → the widget renders its OWN card chrome
 *                                     (used for existing self-contained cards)
 *     size:        object   — default footprint on a 12-column grid:
 *                             { w, h, minW, minH }. The board scales `w` for
 *                             narrower breakpoints and clamps to `minW`.
 *                             Row height = 28px, so h=5 ≈ 190px tall.
 *     Component:   React component — rendered inside the tile
 *   }
 *
 * Widgets render BARE content when `frame: true`; the board provides the title,
 * drag handle and remove control. This is the "bridge" that lets existing
 * components be pulled into other views with minimal adaptation.
 *
 * The board itself (drag/resize/grid-snap/persistence) lives in
 * `src/components/WidgetBoard.jsx` and is built on react-grid-layout.
 */
const registry = new Map();

export function registerWidget(def) {
  if (def && def.id && def.Component) registry.set(def.id, def);
  return def;
}

export function getWidget(id) {
  return registry.get(id);
}

export function getWidgets() {
  return Array.from(registry.values());
}

export function isRegistered(id) {
  return registry.has(id);
}
