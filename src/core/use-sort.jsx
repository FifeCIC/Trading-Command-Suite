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

  const toggle = (nextKey) => {
    if (nextKey === key) {
      setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setKey(nextKey);
    setDir('desc');
  };

  /** `aria-sort` for the <th>, so a screen reader hears the ordering rather than inferring it. */
  const ariaSort = (col) => (col !== key ? 'none' : dir === 'asc' ? 'ascending' : 'descending');

  return { sorted, sortKey: key, dir, toggle, ariaSort };
}

/** A sortable header cell. Keeps the button inside the <th> so the column keeps its semantics. */
export function SortableTh({ col, label, title, api, className }) {
  const active = api.sortKey === col;
  return (
    <th scope="col" aria-sort={api.ariaSort(col)} title={title} className={className}>
      <button
        type="button"
        className={`bt-sort${active ? ' bt-sort--on' : ''}`}
        onClick={() => api.toggle(col)}
      >
        {label}
        <span aria-hidden="true">{active ? (api.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
      </button>
    </th>
  );
}
