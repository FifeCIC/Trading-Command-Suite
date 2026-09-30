import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { apiGet, apiPut } from '../core/api/client';
import NoticeBlock from '../components/NoticeBlock';
import { noticeFromError } from '../core/notices/from-error.js';
// ⚠️ DEFAULT import — `src/core/view-meta.js` exports VIEW_META as its default and exposes only
// helper functions by name. The GENERATED free copy (`src/editions/view-meta.free.js`) is the one
// that exports a NAMED `VIEW_META`, and assuming the two matched failed the build with
// [MISSING_EXPORT]. The default import is the shape both files have in common.
import VIEW_META from '../core/view-meta.js';
import { NAV_TREE } from '../core/nav-tree.js';
import './ui-review.css';

/**
 * UiReviewPage — the owner walks EVERY page and records a verdict on each one.
 *
 * STEP IN THE PIPELINE:
 *   BEFORE: the app's view list exists only as code (`view-meta.js` + `nav-tree.js`).
 *   THIS:   the owner records importance / hide-now / keenness / a note per page.
 *   AFTER:  every interaction PUTs to `/api/system/settings/ui-review`, which persists to the
 *           `appsetting` row AND mirrors to `nest/app-settings.json` — the file an agent reads to
 *           work from. No export step, no "remember to save".
 *
 * ⚠️ THE ROWS COME FROM `VIEW_META`, NOT FROM A LIST IN THIS FILE. A hand-kept list of pages would
 * be wrong the first time someone adds a page — and this repo has paid for that shape repeatedly
 * (a registry keyed by hand that silently drifts from the thing it describes).
 *
 * ⚠️ NAV ORDER IS PRESERVED, and the views that are NOT sidebar entries are listed separately. The
 * largest page in the free edition is a detail route (`/research/symbol`) that appears nowhere in
 * the nav — a walkthrough built from the sidebar alone would never have shown it.
 *
 * ⚠️ SAVES ON EVERY INTERACTION. The note field is debounced (a request per keystroke would be
 * absurd), everything else writes immediately, and each row reports what actually happened —
 * "saving" / "saved" / "failed" — because a silent save that failed looks exactly like one that
 * worked.
 */

const IMPORTANCE = [
  { v: 'H', label: 'High' },
  { v: 'M', label: 'Medium' },
  { v: 'L', label: 'Low' },
];
const KEEN = [
  { v: 3, label: 'Very keen (3)' },
  { v: 2, label: 'Keen (2)' },
  { v: 1, label: 'Not bothered (1)' },
];

/** Build the row set: nav leaves in nav order first, then every non-nav view alphabetically. */
function buildRows() {
  const inNav = new Map();
  let i = 0;
  for (const [areaId, area] of Object.entries(NAV_TREE)) {
    for (const v of area.views || []) {
      if (v.kind === 'section-header') continue;
      i += 1;
      inNav.set(`/${areaId}/${v.id}`, { order: i, area: area.label || areaId });
    }
  }
  const rows = Object.entries(VIEW_META).map(([key, meta]) => {
    const nav = inNav.get(key);
    return {
      key,
      label: meta.label || key,
      tier: meta.tier === 'free' ? 'free' : 'premium',
      navOrder: nav ? nav.order : null,
      area: nav ? nav.area : '— not in the sidebar —',
    };
  });
  rows.sort((a, b) => {
    if (a.navOrder !== null && b.navOrder !== null) return a.navOrder - b.navOrder;
    if (a.navOrder !== null) return -1;
    if (b.navOrder !== null) return 1;
    return a.key.localeCompare(b.key);
  });
  return rows;
}

export default function UiReviewPage() {
  const rows = useMemo(buildRows, []);
  const [entries, setEntries] = useState({});
  const [status, setStatus] = useState({});
  const [loadError, setLoadError] = useState(null);
  const [openNote, setOpenNote] = useState(null);
  const [loading, setLoading] = useState(true);

  // Filters — 140 rows is too many to scan, and "what is still unanswered" is the question that
  // actually drives the walkthrough.
  const [search, setSearch] = useState('');
  const [onlyUnanswered, setOnlyUnanswered] = useState(false);
  const [onlyFree, setOnlyFree] = useState(false);

  const noteTimers = useRef({});

  useEffect(() => {
    let alive = true;
    apiGet('/api/system/settings/ui-review')
      .then((data) => { if (alive) setEntries(data?.entries || {}); })
      .catch((err) => { if (alive) setLoadError(err); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const save = async (viewKey, patch) => {
    setStatus((s) => ({ ...s, [viewKey]: 'saving' }));
    try {
      const saved = await apiPut('/api/system/settings/ui-review', { viewKey, patch });
      setEntries((e) => ({ ...e, [viewKey]: saved }));
      setStatus((s) => ({ ...s, [viewKey]: 'saved' }));
    } catch (err) {
      setStatus((s) => ({ ...s, [viewKey]: 'error' }));
      setLoadError(err);
    }
  };

  /** The note is typed, so it waits for a pause; the three selectors write at once. */
  const saveNoteDebounced = (viewKey, note) => {
    setEntries((e) => ({ ...e, [viewKey]: { ...(e[viewKey] || {}), note } }));
    setStatus((s) => ({ ...s, [viewKey]: 'typing' }));
    clearTimeout(noteTimers.current[viewKey]);
    noteTimers.current[viewKey] = setTimeout(() => save(viewKey, { note }), 700);
  };

  /**
   * openOnNextScreen() — open a page in a WINDOW placed on your other monitor.
   *
   * HOW THIS WORKS, because it is not obvious:
   *   `window.open(url, name, features)` creates a real POPUP WINDOW rather than a tab, and the
   *   `left` / `top` / `width` / `height` features position it. A tab cannot be positioned — that is
   *   the whole reason this uses features. A popup opened from inside a click IS allowed, so the
   *   browser will not block it.
   *
   * ⚠️ "The screen to the right" is MEASURED where the browser will let us, and assumed only as a
   * fallback. `getScreenDetails()` reports every screen and its real bounds, so a monitor arranged
   * to the LEFT, or stacked vertically, is handled correctly. The first call asks the browser for
   * the "window management" permission — in Chrome/Edge you get a prompt; if it is denied or
   * unsupported, the fallback assumes one screen sits immediately to the right, which is right for
   * the common arrangement and wrong for the others.
   *
   * ⚠️ Each page gets its OWN window name, so opening five pages gives five windows side by side
   * rather than one window being replaced five times.
   */
  const openOnNextScreen = async (path, label) => {
    const width = Math.round((window.screen?.availWidth || 1500) * 0.92);
    const height = Math.round((window.screen?.availHeight || 900) * 0.92);
    const winName = `tcs-review-${path.replace(/[^a-zA-Z0-9]+/g, '-')}`;
    const features = (l, t) => `popup=yes,left=${l},top=${t},width=${width},height=${height},noopener`;

    try {
      if (typeof window.getScreenDetails === 'function') {
        const details = await window.getScreenDetails();
        const current = details.currentScreen;
        const others = (details.screens || []).filter((s) => s !== current);
        if (others.length) {
          // Prefer a screen whose left edge starts at/after this screen's right edge...
          const toTheRight = others
            .filter((s) => s.availLeft >= (current?.availLeft ?? 0) + (current?.availWidth ?? 0) - 8)
            .sort((a, b) => a.availLeft - b.availLeft);
          // ...otherwise fall back to the first other screen, so a left-hand or stacked monitor still works.
          const target = toTheRight[0] || others[0];
          const l = target.availLeft + Math.round((target.availWidth - width) / 2);
          const t = target.availTop + Math.round((target.availHeight - height) / 2);
          setOpenNote(`Opened “${label}” on a second screen (${target.availWidth}\u00d7${target.availHeight}).`);
          window.open(path, winName, features(l, t));
          return;
        }
      }
    } catch {
      // Permission denied or unsupported — fall through rather than failing the click.
    }

    const s2 = window.screen;
    const left = (s2?.availLeft ?? 0) + (s2?.availWidth ?? 0);
    window.open(path, winName, features(left, 40));
    setOpenNote(
      'No second screen was reported, so “' + label + '” was placed just right of this one. Allow ' +
        'the browser\u2019s window-management permission for it to use your real screens.',
    );
  };

  /**
   * Is a verdict recorded for this page?
   *
   * ⚠️ Written as one named predicate on purpose. The first version was an inline
   * `e.importance || e.hide !== null && e.hide !== undefined || …`, which reads as "answered" for
   * an entry whose ONLY content is a timestamp — and `&&` binding tighter than `||` made the
   * intent unreadable. 'No' is an ANSWER, so a stored `false` counts; a stored `null` does not.
   */
  const isAnswered = (e) => Boolean(e && (e.importance || e.keen || e.note || e.hide === true || e.hide === false));

  const answered = rows.filter((r) => isAnswered(entries[r.key])).length;

  const visible = rows.filter((r) => {
    if (onlyFree && r.tier !== 'free') return false;
    if (onlyUnanswered) {
      if (isAnswered(entries[r.key])) return false;
    }
    if (search) {
      const q = search.toLowerCase();
      if (!r.key.toLowerCase().includes(q) && !r.label.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const hiddenWanted = rows.filter((r) => entries[r.key]?.hide === true).length;

  return (
    <div className="uir-page">
      <header className="uir-header">
        <h2>Page walkthrough — verdicts</h2>
        <p className="uir-sub">
          Every page in the app, in sidebar order, with the views that are not sidebar entries listed
          after them. Each change saves immediately. <b>Click a page name</b> to open it in a new
          window, or <b>⇥ other screen</b> to place it on your second monitor.
        </p>
        {openNote ? <p className="uir-sub uir-sub--note">{openNote}</p> : null}
      </header>

      {loadError ? (
        <NoticeBlock notice={noticeFromError(loadError, 'TCS-SYS-007', { operation: 'load or save the page verdicts' })} />
      ) : null}

      <section className="uir-summary" aria-live="polite">
        <span><b>{rows.length}</b> pages</span>
        <span><b>{answered}</b> answered</span>
        <span><b>{rows.length - answered}</b> to go</span>
        <span><b>{hiddenWanted}</b> marked hide</span>
        <span className="uir-summary-note">
          You are seeing <b>{visible.length}</b> of {rows.length} (filters applied)
        </span>
      </section>

      <section className="uir-filters">
        <label>
          <span>Search</span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="page, label or path"
          />
        </label>
        <label className="uir-check">
          <input type="checkbox" checked={onlyUnanswered} onChange={(e) => setOnlyUnanswered(e.target.checked)} />
          <span>Only not-yet-answered</span>
        </label>
        <label className="uir-check">
          <input type="checkbox" checked={onlyFree} onChange={(e) => setOnlyFree(e.target.checked)} />
          <span>Only free-edition pages</span>
        </label>
      </section>

      {loading ? <p className="uir-sub">Loading saved verdicts…</p> : null}

      <table className="uir-table">
        <thead>
          <tr>
            <th scope="col">Page</th>
            <th scope="col">Edition</th>
            <th scope="col">Importance</th>
            <th scope="col">Hide now</th>
            <th scope="col">Keen</th>
            <th scope="col">Changes I suggest</th>
            <th scope="col">Saved</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((r, idx) => {
            const e = entries[r.key] || {};
            const st = status[r.key];
            const newArea = idx === 0 || visible[idx - 1].area !== r.area;
            return (
              <Fragment key={r.key}>
                {newArea ? (
                  <tr className="uir-area-row" key={`area-${r.area}`}>
                    <th colSpan={7} scope="colgroup">{r.area}</th>
                  </tr>
                ) : null}
                <tr key={r.key}>
                  <td className="uir-page-cell">
                    <a
                      className="uir-label uir-label--link"
                      href={r.key}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={`Open ${r.label} in a new window`}
                    >
                      {r.label}
                    </a>
                    <span className="uir-path-row">
                      <code className="uir-path">{r.key}</code>
                      <button
                        type="button"
                        className="uir-screen-btn"
                        onClick={() => openOnNextScreen(r.key, r.label)}
                        aria-label={`Open ${r.label} on another screen`}
                        title="Open on the next screen to the right — the browser asks for permission to see your screens the first time"
                      >
                        ⇥ other screen
                      </button>
                    </span>
                  </td>
                  <td>
                    <span className={`uir-tier uir-tier--${r.tier}`}>{r.tier === 'free' ? 'FREE' : 'premium'}</span>
                  </td>
                  <td>
                    <select
                      aria-label={`Importance for ${r.label}`}
                      value={e.importance || ''}
                      onChange={(ev) => save(r.key, { importance: ev.target.value || null })}
                    >
                      <option value="">—</option>
                      {IMPORTANCE.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
                    </select>
                  </td>
                  <td>
                    <select
                      aria-label={`Hide ${r.label} now`}
                      value={e.hide === true ? 'Y' : e.hide === false ? 'N' : ''}
                      onChange={(ev) => save(r.key, { hide: ev.target.value === '' ? null : ev.target.value === 'Y' })}
                    >
                      <option value="">—</option>
                      <option value="N">No</option>
                      <option value="Y">Yes</option>
                    </select>
                  </td>
                  <td>
                    <select
                      aria-label={`Keenness for ${r.label}`}
                      value={e.keen || ''}
                      onChange={(ev) => save(r.key, { keen: ev.target.value ? Number(ev.target.value) : null })}
                    >
                      <option value="">—</option>
                      {KEEN.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
                    </select>
                  </td>
                  <td>
                    <input
                      type="text"
                      className="uir-note"
                      aria-label={`Suggested changes for ${r.label}`}
                      value={e.note || ''}
                      placeholder="what would you change?"
                      onChange={(ev) => saveNoteDebounced(r.key, ev.target.value)}
                    />
                  </td>
                  <td className={`uir-status uir-status--${st || 'idle'}`}>
                    {st === 'saving' ? 'saving…' : st === 'saved' ? 'saved' : st === 'typing' ? '…' : st === 'error' ? 'FAILED' : ''}
                  </td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>

      {visible.length === 0 ? <p className="uir-sub">No pages match the filters.</p> : null}

      <footer className="uir-footer">
        <p>
          Saved to the app settings store, which is mirrored to <code>nest/app-settings.json</code> —
          the file an agent reads. Nothing here needs exporting.
        </p>
      </footer>
    </div>
  );
}
