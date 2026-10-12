/**
 * Board store — persistence seam for widget boards
 * ================================================
 * A widget board is a **screen**: `dashboard`, `lab`, and later `cockpit-1/2/3`
 * for the META.Stack cockpit. Everything a board needs to restore itself is
 * one versioned document:
 *
 *   {
 *     v: 3,
 *     items:   [{ uid, widgetId }],                    // what is on the board
 *     layouts: { lg: [{ i, x, y, w, h, minW, minH }],  // where, per breakpoint
 *                md: [...], sm: [...], xs: [...] },
 *     seeded:  [widgetId],                            // defaults already offered
 *   }
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Storage used to be two ad-hoc localStorage keys written straight from the
 * component (`widgets:<id>` + `widgets-layout:<id>`). Two consequences:
 *   1. every future shape change meant another bespoke migration in the
 *      component, and
 *   2. moving boards server-side (needed so several screens share one
 *      arrangement) would have meant rewriting persistence inside the UI.
 *
 * So persistence lives here behind `loadBoard()` / `saveBoardLocal()`, and the
 * stored document carries a version. Adding a field later = bump `v` and add a
 * step to `migrate()`. Moving to the API = add a `loadBoardRemote()` next to
 * these and switch the mode — the board component does not change again.
 *
 * `localStorage` is the only backend today (single local instance, no user
 * accounts yet). The seam is what matters now; the server implementation is a
 * drop-in when the multi-screen cockpit needs it.
 */
import { getWidget } from './widget-registry';

export const BOARD_VERSION = 3;

/** 12-column reference grid; narrower breakpoints scale down from it. */
export const COLS = { lg: 12, md: 8, sm: 4, xs: 2 };
const REFERENCE_COLS = 12;
const FALLBACK_SIZE = { w: 4, h: 5, minW: 3, minH: 4 };

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

let uidCounter = 0;
export const nextUid = () => `w${Date.now().toString(36)}${(uidCounter++).toString(36)}`;

/** New key. Replaces the legacy `widgets:<id>` / `widgets-layout:<id>` pair. */
const boardStorageKey = (boardId) => `widgets-board:${boardId}`;

function sizeFor(def, cols) {
  const base = def?.size || FALLBACK_SIZE;
  const minW = clamp(base.minW ?? 2, 1, cols);
  return {
    w: clamp(Math.round(((base.w ?? 4) * cols) / REFERENCE_COLS), minW, cols),
    h: base.h ?? 5,
    minW,
    minH: base.minH ?? 3,
  };
}

/**
 * Left-to-right packing — used for seeding, migration and appending.
 *
 * ⚠️ EACH ROW IS STRETCHED TO FILL THE GRID (2026-10-11). Owner report on /dashboard/dashboard:
 * *"this area that includes the tiles also doesn't allow widgets to be dragged into a large portion
 * of the page area."* MEASURED on the real board: most rows used only 50–83% of the grid, with up to
 * **924px** unused to the right, and some rows beginning at x=925 — a gap on the LEFT as well.
 *
 * The cause was this function. It packed first-fit at each widget's FIXED default width, so a row of
 * 596 + 749 in a 12-column grid left three columns empty; the next widget's 901 did not fit in the
 * remainder, so it wrapped and the gap stayed. ⚠️ Packing alone therefore could not close it —
 * measured: re-packing an existing board changed nothing at all. The gap had to be filled here.
 *
 * ⚠️ WHY THE STRETCH IS APPLIED WHEN A ROW CLOSES (on wrap, and once more after the loop): a row's
 * used width is only final once the next item has failed to fit. Growing the last widget then is the
 * only point at which the leftover is known. A row that already fills `cols` gets nothing, and the
 * stretch is clamped to `cols` so a single-widget row becomes full width rather than overflowing.
 *
 * ⚠️ `rowStart` guards a wrapped row: without it, `fillRow()` after a wrap would grow the FIRST widget
 * of the NEW row using the OLD row's leftover.
 */
export function packLayout(items, cols, startY = 0) {
  const layout = [];
  let x = 0;
  let y = startY;
  let rowH = 0;
  let rowStart = 0; // index in `layout` of the first item on the current row

  /** Give the current row's last widget the columns the row left unused. */
  const fillRow = () => {
    if (layout.length - 1 < rowStart) return; // no item has been placed on this row yet
    const last = layout[layout.length - 1];
    const leftover = cols - x;
    if (leftover > 0) last.w = Math.min(cols, last.w + leftover);
  };

  for (const item of items) {
    const { w, h, minW, minH } = sizeFor(getWidget(item.widgetId), cols);
    if (x + w > cols) {
      fillRow();
      x = 0;
      y += rowH;
      rowH = 0;
      rowStart = layout.length;
    }
    layout.push({ i: item.uid, x, y, w, h, minW, minH });
    x += w;
    rowH = Math.max(rowH, h);
  }
  fillRow();
  return layout;
}

export const bottomOf = (layout) =>
  (Array.isArray(layout) ? layout : []).reduce((max, l) => Math.max(max, l.y + l.h), 0);

export const buildAllLayouts = (items) => {
  const out = {};
  for (const [bp, cols] of Object.entries(COLS)) out[bp] = packLayout(items, cols);
  return out;
};

export const seedItems = (ids) =>
  (ids || []).filter((id) => !!getWidget(id)).map((widgetId) => ({ uid: nextUid(), widgetId }));

/** A brand-new board for `defaultWidgets`. */
function createBoard(defaultWidgets = []) {
  const ids = (defaultWidgets || []).filter((id) => !!getWidget(id));
  const items = seedItems(ids);
  return { v: BOARD_VERSION, items, layouts: buildAllLayouts(items), seeded: [...ids] };
}

/**
 * applyNewDefaults(board, defaultWidgets) — append any default widget this board
 * has never been offered, once.
 *
 * WHY: when more of the app becomes widgets (e.g. the Dashboard's old cards),
 * existing boards would otherwise never see them, and shipping them by changing
 * `defaultWidgets` only affects brand-new boards. `seeded` records what has been
 * offered, so a widget the user deliberately removed is NOT re-added.
 */
export function applyNewDefaults(board, defaultWidgets = []) {
  const offered = Array.isArray(board.seeded) ? board.seeded : [];
  const wanted = (defaultWidgets || []).filter((id) => !!getWidget(id));
  const additions = wanted.filter((id) => !offered.includes(id));

  if (!additions.length) {
    const nextOffered = [...new Set([...offered, ...wanted])];
    return nextOffered.length === offered.length ? board : { ...board, seeded: nextOffered };
  }

  const added = additions.map((widgetId) => ({ uid: nextUid(), widgetId }));
  const items = [...board.items, ...added];
  const layouts = { ...board.layouts };
  for (const [bp, cols] of Object.entries(COLS)) {
    const base = Array.isArray(layouts[bp]) ? layouts[bp] : [];
    layouts[bp] = [...base, ...packLayout(added, cols, bottomOf(base))];
  }
  return { ...board, v: BOARD_VERSION, items, layouts, seeded: [...new Set([...offered, ...wanted])] };
}

/**
 * migrate(doc) — bring any stored document up to BOARD_VERSION.
 * Add a new step at the top when the shape changes; never mutate in place.
 */
function migrate(doc) {
  if (!doc || typeof doc !== 'object') return null;
  let next = doc;

  // v2 → v3: `seeded` tracks which defaults a board has been offered. A v2
  // board is treated as having been offered exactly what it currently holds.
  if (next.v === 2) {
    next = { ...next, v: BOARD_VERSION, seeded: (next.items || []).map((it) => it.widgetId) };
  }

  // v1 → v2: the retired split-key shape. Item uids were the only geometry
  // anchor, so if a layout was missing it is re-packed (uids preserved).
  if (next.v === 1 || (!next.v && Array.isArray(next.items))) {
    const items = (next.items || []).map((it) => ({ uid: it.uid || nextUid(), widgetId: it.widgetId }));
    const layouts = next.layouts && Object.keys(next.layouts).length
      ? next.layouts
      : buildAllLayouts(items);
    next = { ...next, v: BOARD_VERSION, items, layouts, seeded: (next.seeded || items.map((i) => i.widgetId)) };
  }

  if (next.v !== BOARD_VERSION) return null; // unknown/newer — treat as absent
  return next;
}

const safeParse = (raw) => {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

/**
 * loadBoard(boardId, defaultWidgets) — read the stored board, migrating the
 * retired split keys on the way through. Synchronous because the current
 * backend is localStorage; the component only ever calls this once per mount.
 */
export function loadBoard(boardId, defaultWidgets = []) {
  if (typeof localStorage === 'undefined') return createBoard(defaultWidgets);

  const current = migrate(safeParse(localStorage.getItem(`tcs:view-state:${boardStorageKey(boardId)}`)));
  if (current) return applyNewDefaults(current, defaultWidgets);

  // ── Legacy migration (pre-v2 split keys) ──
  const legacyItems = safeParse(localStorage.getItem(`tcs:view-state:widgets:${boardId}`));
  if (Array.isArray(legacyItems) && legacyItems.length) {
    const legacyLayouts = safeParse(localStorage.getItem(`tcs:view-state:widgets-layout:${boardId}`));
    const board = migrate({
      v: 1,
      items: legacyItems,
      layouts: legacyLayouts && Object.keys(legacyLayouts).length ? legacyLayouts : undefined,
      seeded: legacyItems.map((it) => it.widgetId),
    });
    if (board) {
      // Old keys are consumed exactly once — leaving them would resurrect a
      // stale arrangement if the document is ever cleared.
      try {
        localStorage.removeItem(`tcs:view-state:widgets:${boardId}`);
        localStorage.removeItem(`tcs:view-state:widgets-layout:${boardId}`);
      } catch { /* noop */ }
      return applyNewDefaults(board, defaultWidgets);
    }
  }

  return createBoard(defaultWidgets);
}

/**
 * saveBoardLocal(boardId, board) — the local backend. When boards move to the
 * API, add `loadBoardRemote`/`saveBoardRemote` beside this and pick between
 * them at the top of the module; nothing in `WidgetBoard` needs to change.
 */
export function saveBoardLocal(boardId, board) {
  try {
    localStorage.setItem(`tcs:view-state:${boardStorageKey(boardId)}`, JSON.stringify(board));
  } catch { /* quota / no storage */ }
}

/**
 * listBoards() — board ids that have saved state, discovered from storage.
 *
 * Used by the screen cockpit's board picker and by the `/dashboard/screen` view
 * so a board arranged once can be shown on any monitor. It reports only what
 * actually exists locally — the built-in ids come from
 * `src/core/board-defaults.js`, so callers union the two and never invent a board.
 */
export function listBoards() {
  if (typeof localStorage === 'undefined') return [];
  const prefix = `tcs:view-state:${boardStorageKey('')}`;
  const ids = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key && key.startsWith(prefix)) ids.push(key.slice(prefix.length));
  }
  return ids;
}

/**
 * subscribeBoard(boardId, onChange) → unsubscribe.
 * Cross-tab/window sync. Matters for the multi-screen cockpit, where the same
 * board can be open in more than one window: the other window's edit arrives as
 * a `storage` event and replaces the in-memory document.
 */
export function subscribeBoard(boardId, onChange) {
  if (typeof window === 'undefined') return () => {};
  const key = `tcs:view-state:${boardStorageKey(boardId)}`;
  const onStorage = (event) => {
    if (event.key !== key || event.newValue == null) return;
    const next = migrate(safeParse(event.newValue));
    if (next) onChange(next);
  };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}
