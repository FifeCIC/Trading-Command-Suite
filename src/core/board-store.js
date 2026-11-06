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
import { BOARD_RETIRED } from './board-defaults.js';

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
 *
 * ⚠️ "NOT ALREADY PLACED" IS A SEPARATE TEST FROM "NOT ALREADY OFFERED" (added 2026-11-06).
 * `seeded` lists only the defaults the seeder has handed out; a widget the user added BY HAND from the
 * library lives in `items` and never in `seeded`. So a default added later is appended even when the
 * board already shows that widget, and the user gets two tiles and has to work out which is "theirs".
 * A duplicate is worse than a missing default — it reads as a board bug rather than a seeding one.
 *
 * ⚠️ THIS WAS ADDED AS A GUARD, NOT AS A FIX — say so rather than implying an incident. Measured
 * 2026-11-06 on /dashboard/dashboard when `system-health` became a default: the board went 14 → 15
 * items and the stored document contains **one** System Status, so the append was correct on that
 * board because it genuinely had none. The duplicate was never observed; the condition that would
 * produce it (hand-placed widget + later default) is what this line closes.
 */
export function applyNewDefaults(board, defaultWidgets = []) {
  const offered = Array.isArray(board.seeded) ? board.seeded : [];
  const wanted = (defaultWidgets || []).filter((id) => !!getWidget(id));
  const placed = new Set((board.items || []).map((it) => it.widgetId));
  const additions = wanted.filter((id) => !offered.includes(id) && !placed.has(id));

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
 * applyRetired(board, retiredWidgets) — remove a default that the owner has since RETIRED, once.
 *
 * WHY THIS EXISTS BESIDE applyNewDefaults: changing `BOARD_DEFAULTS` only affects a brand-new board.
 * A widget the owner asked to hide is already sitting in his stored board, so hiding it needs a
 * one-time REMOVAL — and it has to be one-time, because the widget stays in the library and he may
 * add it back by hand. `retired` records what has been removed; a widget re-added later is not
 * removed again.
 *
 * Measured 2026-11-06: the dashboard board held 15 items, of which `diversification` (a two-line
 * "Mode: OFF / no duplicates" panel) and `automation` (a duplicate of the loop state now shown inside
 * System Status) were the two the owner asked to hide.
 */
export function applyRetired(board, retiredWidgets = []) {
  const done = Array.isArray(board.retired) ? board.retired : [];
  const wanted = (retiredWidgets || []).filter((id) => !done.includes(id));
  if (!wanted.length) return board;

  const dropUids = new Set(
    (board.items || []).filter((it) => wanted.includes(it.widgetId)).map((it) => it.uid),
  );
  const items = (board.items || []).filter((it) => !dropUids.has(it.uid));
  const layouts = { ...board.layouts };
  for (const [bp, list] of Object.entries(layouts)) {
    if (Array.isArray(list)) layouts[bp] = list.filter((l) => !dropUids.has(l.i));
  }
  return { ...board, items, layouts, retired: [...new Set([...done, ...wanted])] };
}

/**
 * loadBoard(boardId, defaultWidgets) — read the stored board, migrating the
 * retired split keys on the way through. Synchronous because the current
 * backend is localStorage; the component only ever calls this once per mount.
 */
export function loadBoard(boardId, defaultWidgets = []) {
  if (typeof localStorage === 'undefined') return createBoard(defaultWidgets);

  const current = migrate(safeParse(localStorage.getItem(`tcs:view-state:${boardStorageKey(boardId)}`)));
  if (current) return applyRetired(applyNewDefaults(current, defaultWidgets), BOARD_RETIRED[boardId] || []);

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
      return applyRetired(applyNewDefaults(board, defaultWidgets), BOARD_RETIRED[boardId] || []);
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
