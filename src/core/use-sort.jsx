/**
 * useSort — click-to-sort for the Backtest Lab's tables (owner request, 2026-10-27).
 *
 * ⚠️ WHY A HOOK AND NOT A TABLE COMPONENT. There are three tables on this page with different
 * columns (declared/realised pairs, per-bar scores, stored runs). A generic <DataTable> would need
 * a column-definition language for eleven columns and would hide the markup that makes each table
 * readable. What they genuinely share is the ORDERING rule — so that is all this provides, and the
 * markup stays visible at each call site.
 *
 * ⚠️ SORTING IS EXPLICIT ABOUT DIRECTION: a nullable value (`null`/`undefined`) always sorts LAST in
 * both directions. Rendering a "not recorded" row above a real 0 would make an absence look like a
 * measurement, which is the defect class this page keeps fixing.
 */
import { useMemo, useState } from 'react';

const isNil = (v) => v == null || v === '';

export function useSort(rows, initialKey = null, initialDir = 'desc') {
  const [key, setKey] = useState(initialKey);
  const [dir, setDir] = useState(initialDir);

  const sorted = useMemo(() => {
    if (!key) return rows;
    const sign = dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = a?.[key];
      const bv = b?.[key];
      // Nulls last, whatever the direction.
      if (isNil(av) && isNil(bv)) return 0;
      if (isNil(av)) return 1;
      if (isNil(bv)) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sign;
      return String(av).localeCompare(String(bv), undefined, { numeric: true }) * sign;
    });
  }, [rows, key, dir]);

  /**
   * `firstDir` is the direction a NEW column sorts in on its first click. Default `'desc'`, which
   * is right for a number ("highest first"); a TEXT column wants `'asc'` ("A first"), so the caller
   * passes it at the click site. Clicking the active column still just reverses.
   */
  const toggle = (nextKey, firstDir = 'desc') => {
    if (nextKey === key) {
      setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setKey(nextKey);
    setDir(firstDir);
  };

  /** `aria-sort` for the <th>, so a screen reader hears the ordering rather than inferring it. */
  const ariaSort = (col) => (col !== key ? 'none' : dir === 'asc' ? 'ascending' : 'descending');

  return { sorted, sortKey: key, dir, toggle, ariaSort };
}

/**
 * A sortable header cell. Keeps the button inside the <th> so the column keeps its semantics.
 *
 * ⚠️ `buttonClassName` (2026-11-18) — the button style used to be hardcoded to the Backtest Lab's
 * `bt-sort`, which lives in `components/backtest/backtest-panel-base.css`. That meant any other page
 * either dragged the Backtest stylesheet in or re-implemented this markup by hand (StrategiesListPage
 * does exactly that, and says so in a comment). Passing the GLOBAL `.th-sort` class from `index.css`
 * makes this component reusable app-wide, which is the point: ordering rules live here, the header
 * markup is written once, and only the class differs per surface.
 */
export function SortableTh({ col, label, title, api, className, buttonClassName = 'bt-sort', firstDir = 'desc' }) {
  const active = api.sortKey === col;
  return (
    <th scope="col" aria-sort={api.ariaSort(col)} title={title} className={className}>
      <button
        type="button"
        className={`${buttonClassName}${active ? ` ${buttonClassName}--on` : ''}`}
        onClick={() => api.toggle(col, firstDir)}
      >
        {label}
        <span aria-hidden="true">{active ? (api.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
      </button>
    </th>
  );
}
