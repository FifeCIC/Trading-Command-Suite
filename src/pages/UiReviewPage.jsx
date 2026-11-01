import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { apiGet, apiPut } from '../core/api/client';
import NoticeBlock from '../components/NoticeBlock';
import { noticeFromError } from '../core/notices/from-error.js';
// ⚠️ DEFAULT import — `src/core/view-meta.js` exports VIEW_META as its default and exposes only
// helper functions by name. A former generated variant exported a NAMED `VIEW_META`, and assuming
// the two matched failed the build with [MISSING_EXPORT].
import VIEW_META from '../core/view-meta.js';
import { NAV_TREE } from '../core/nav-tree.js';
import './ui-review.css';

/**
 * UiReviewPage — the owner walks EVERY page and records a verdict on each one.
 *
 * STEP IN THE PIPELINE:
 *   BEFORE: the app's view list exists only as code (`view-meta.js` + `nav-tree.js`).
 *   THIS:   the owner records importance / hide-now / a 1–10 UI rating / two rounds of notes per page.
 *   AFTER:  every interaction PUTs to `/api/system/settings/ui-review`, which persists to the
 *           `appsetting` row AND mirrors to `nest/app-settings.json` — the file an agent reads to
 *           work from. No export step, no "remember to save".
 *
 * ⚠️ THE ROWS COME FROM `VIEW_META`, NOT FROM A LIST IN THIS FILE. A hand-kept list of pages would
 * be wrong the first time someone adds a page — and this repo has paid for that shape repeatedly
 * (a registry keyed by hand that silently drifts from the thing it describes).
 *
 * ⚠️ NAV ORDER IS PRESERVED, and the views that are NOT sidebar entries are listed separately. The
 * largest page is a detail route (`/research/symbol`) that appears nowhere in the nav — a
 * walkthrough built from the sidebar alone would never have shown it.
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
/**
 * The UI-quality rating — 1–10.
 *
 * ⚠️ REPLACED `KEEN` (1–3, "how keen are you on this page") on 2026-10-06 at the owner's request:
 * *"replace `<th>Keen</th>` with a 1 to 10 rating on how good the UI is … I will use that column to
 * comment on which aspects of the page's UI is to be kept and make part of the core/default theme
 * structure and styling."*
 *
 * ⚠️ IT WRITES A NEW FIELD (`uiScore`), IT DOES NOT WIDEN `keen`. 80 of the 100 stored verdicts carry
 * a `keen` value meaning "keenness", so reusing that key would have re-rendered 27 "Very keen (3)"
 * entries as **3/10**. Old values are left as they are.
 *
 * ⚠️ THE SCALE IS DELIBERATELY UNANCHORED. No words are attached to 8 or 3, because the rubric is the
 * owner's to set — labelled bands ("8–10 = keep") would put a standard in their mouth and then get
 * quoted back at them as if they had agreed to it.
 */
const UI_SCORE = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((v) => ({ v, label: String(v) }));

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

  /**
   * Both note columns are typed, so they wait for a pause; the selectors write at once.
   *
   * ⚠️ `field` IS A PARAMETER because there are now TWO note columns — "Old …" writes `note`, "New …"
   * writes `noteNew`. The timer is keyed by FIELD as well as row: one timer per row would let a
   * keystroke in the New column cancel a pending save in the Old column, which is silent data loss.
   */
  const saveNoteDebounced = (viewKey, field, value) => {
    setEntries((e) => ({ ...e, [viewKey]: { ...(e[viewKey] || {}), [field]: value } }));
    setStatus((s) => ({ ...s, [viewKey]: 'typing' }));
    const timerKey = `${viewKey}::${field}`;
    clearTimeout(noteTimers.current[timerKey]);
    noteTimers.current[timerKey] = setTimeout(() => save(viewKey, { [field]: value }), 700);
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
  // ⚠️ `e.keen` is kept in this test even though the column is gone: entries answered ONLY on the old
  // keenness scale still hold a verdict, and dropping them would silently shrink the "answered" count
  // and make the walkthrough look less complete than it is.
  const isAnswered = (e) => Boolean(e && (e.importance || e.keen || e.uiScore || e.note || e.noteNew || e.hide === true || e.hide === false));

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

  /**
   * ⚠️ SPLIT, BECAUSE ONLY ONE HALF CAN ACT (measured 2026-11-01). `filterHiddenViews` removes a
   * page from the nav by view id, so a `hide: true` on a view that is not a sidebar entry changes
   * nothing. Eight of the owner's nine verdicts were exactly that, and nothing said so — the
   * summary showed "9 marked hide" while only one page had ever disappeared. Counting them together
   * reports an intention as an effect.
   */
  const hiddenWanted = rows.filter((r) => entries[r.key]?.hide === true);
  const hiddenInNav = hiddenWanted.filter((r) => r.navOrder !== null).length;
  const hiddenInert = hiddenWanted.length - hiddenInNav;

  /**
   * Applied-status tallies — the headline number for *"how well did agentic AI follow my instructions"*.
   *
   * ⚠️ Each count is over JUDGED rows, not all rows. "3 of 12 applied" and "3 of 200 applied" say
   * different things, and only the second invites the wrong conclusion. A row nobody has judged yet is
   * counted in neither half, so the ratio cannot be diluted by rows the owner has not reached.
   */
  const judged = (field) =>
    rows.filter((r) => {
      const v = entries[r.key]?.[field];
      return v === true || v === false;
    });
  const oldJudged = judged('noteApplied');
  const newJudged = judged('noteNewApplied');
  const oldApplied = oldJudged.filter((r) => entries[r.key].noteApplied === true).length;
  const newApplied = newJudged.filter((r) => entries[r.key].noteNewApplied === true).length;

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
        <span title="Marked hide AND a sidebar entry — these actually disappear">
          <b>{hiddenInNav}</b> hidden from the sidebar
        </span>
        {hiddenInert > 0 ? (
          <span title="Marked hide, but not a sidebar entry — hiding cannot change anything for these">
            <b>{hiddenInert}</b> marked but not in the sidebar
          </span>
        ) : null}
        <span title="First round of comments: applied, out of those judged so far">
          <b>{oldApplied}</b> of {oldJudged.length} old changes applied
        </span>
        <span title="Second round of comments: applied, out of those judged so far">
          <b>{newApplied}</b> of {newJudged.length} new changes applied
        </span>
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
            {/* Replaced the `Keen` column 2026-10-06 — see UI_SCORE above for why the stored values
                were not carried over. */}
            <th
              scope="col"
              title="How good is this page's UI, 1–10 — theme match, layout, and how it handles its own unique needs. Null = not rated."
            >
              UI /10
            </th>
            {/* ⚠️ TWO comment columns since 2026-10-07. The first is the pre-existing `note` field,
                renamed IN THE UI ONLY — the stored values keep their meaning. The owner keeps both side
                by side to judge whether the first round was actually followed:
                *"This is how I'm going to determine how well agentic AI followed my instructions."* */}
            <th
              scope="col"
              title="The comments from the first review round. The field behind it is still `note` — the header changed, the data did not."
            >
              Old Changes I suggest
            </th>
            <th
              scope="col"
              title="Agent-reported: has the first round been applied? ✅ appplied · ❌ outstanding · — not assessed yet (which is NOT the same as outstanding). Set via the API by the agent that did the work."
            >
              Old Applied?
            </th>
            {/* ⚠️ RENAMED 2026-10-10 at the owner's request — and the column's PURPOSE changed with the
                label, it is not a cosmetic rename: *"the field in the column will be used to note which
                parts of the page I think are strong."* It previously held round-2 change suggestions.
                ⚠️ The STORED FIELD is still `noteNew` and existing values are untouched — the header
                changed, the data did not. Do not "tidy" the key to match the header: that would orphan
                every note already written here. */}
            <th
              scope="col"
              title="Which parts of this page do you consider STRONG? Stored in `noteNew` — the field name is historical; the data did not change when the header did."
            >
              Preferred Elements
            </th>
            <th
              scope="col"
              title="Agent-reported: has the agent acted on the preferred-element notes? ✅ applied · ❌ outstanding · — not assessed yet (which is NOT the same as outstanding). Set via the API."
            >
              New Applied?
            </th>
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
                    <th colSpan={10} scope="colgroup">{r.area}</th>
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
                    {/* ⚠️ Disabled for rows that are NOT sidebar entries. Hiding works by removing a
                        view id from the navigation, so on a detail route the switch is a no-op that
                        still looks like a decision. Offering a control that cannot act is how eight
                        verdicts went inert without anyone noticing (2026-11-01). */}
                    <select
                      aria-label={`Hide ${r.label} now`}
                      disabled={r.navOrder === null}
                      title={
                        r.navOrder === null
                          ? 'Not a sidebar entry — this page is reached from another page, so there is nothing to hide'
                          : 'Hide this page from the sidebar'
                      }
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
                      aria-label={`UI rating out of 10 for ${r.label}`}
                      title="1–10: how good is this page's UI"
                      value={e.uiScore ?? ''}
                      onChange={(ev) => save(r.key, { uiScore: ev.target.value ? Number(ev.target.value) : null })}
                    >
                      <option value="">—</option>
                      {UI_SCORE.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
                    </select>
                  </td>
                  <td>
                    <input
                      type="text"
                      className="uir-note"
                      aria-label={`Old suggested changes for ${r.label}`}
                      value={e.note || ''}
                      placeholder="first round"
                      onChange={(ev) => saveNoteDebounced(r.key, 'note', ev.target.value)}
                    />
                  </td>
                  <td>
                    {/* ⚠️ AN INDICATOR, NOT A CONTROL. Owner, 2026-10-08: *"I meant an indicator for
                        agentic AI - not a menu for the user to select."* Nothing here is clickable —
                        the value is written through the API by whichever agent did the work, and this
                        cell only reports it. ⚠️ The three states must stay visually distinct: `—`
                        (nobody has assessed this round yet) is NOT the same as ❌ (assessed, and the
                        work is outstanding), and the owner is using exactly that difference to see what
                        is left. */}
                    <span
                      className={`uir-applied uir-applied--${e.noteApplied === true ? 'done' : e.noteApplied === false ? 'outstanding' : 'unassessed'}`}
                      title={
                        e.noteApplied === true
                          ? 'An agent reports the first round of comments has been applied'
                          : e.noteApplied === false
                            ? 'Assessed by an agent — this round is NOT fully applied'
                            : 'Not assessed yet — no agent has reported on this round'
                      }
                    >
                      {e.noteApplied === true ? '✅ applied' : e.noteApplied === false ? '❌ outstanding' : '—'}
                    </span>
                  </td>
                  <td>
                    <input
                      type="text"
                      className="uir-note uir-note--new"
                      aria-label={`Preferred elements for ${r.label} — the parts of this page you consider strong`}
                      value={e.noteNew || ''}
                      placeholder="strong parts"
                      onChange={(ev) => saveNoteDebounced(r.key, 'noteNew', ev.target.value)}
                    />
                  </td>
                  <td>
                    {/* Same indicator, second round — see the Old column above for why it is not a control. */}
                    <span
                      className={`uir-applied uir-applied--${e.noteNewApplied === true ? 'done' : e.noteNewApplied === false ? 'outstanding' : 'unassessed'}`}
                      title={
                        e.noteNewApplied === true
                          ? 'An agent reports the preferred-element notes have been acted on'
                          : e.noteNewApplied === false
                            ? 'Assessed by an agent — the preferred-element notes are NOT fully addressed'
                            : 'Not assessed yet — no agent has reported on the preferred-element notes'
                      }
                    >
                      {e.noteNewApplied === true ? '✅ applied' : e.noteNewApplied === false ? '❌ outstanding' : '—'}
                    </span>
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
