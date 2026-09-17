/**
 * Screen Assignment — /lab/screen-assignment (epic #746, phase 3)
 * ========================================================
 * Assign a widget board to each physical monitor, then open that board on the
 * monitor it belongs to. This is the multi-screen half of the widget epic: the
 * boards themselves are already per-screen documents (`src/core/board-store.js`),
 * so "which screen shows what" is the only thing left to own — and that is a
 * *screen profile* (`src/core/screen-profiles.js`).
 *
 * FLOW
 * ----
 *   1. Detect screens (Window Management API, or the single `window.screen`).
 *   2. Assign a board to each screen — persisted immediately, so a reload or a
 *      second window sees the same assignment.
 *   3. Open the assigned board on that screen. Each screen gets its own named
 *      window, so "open" focuses an existing window instead of stacking copies.
 *
 * ⚠️ WHY OPENING A WINDOW IS A USER ACTION
 * Browsers only allow `window.open()` with a size/position in the same gesture as
 * a click, and popups can be blocked outright. Both are surfaced as visible
 * states ("Popup blocked — allow popups for localhost") rather than silent
 * failures, because silently doing nothing here looks like the feature is broken.
 *
 * ⚠️ THE PIECES THE BROWSER REFUSES TO DO
 * `getScreenDetails()` needs the `window-management` permission; a refusal is a
 * normal state, not an error (see screen-profiles.js). Per-monitor placement
 * also needs the popup to be allowed — when it is, the window opens over that
 * monitor; when it is not, the browser decides and we show what happened.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PageInfoPopover from '../components/PageInfoPopover';
import { listBoards } from '../core/board-store';
import { BUILT_IN_BOARDS, boardLabel, defaultWidgetsFor } from '../core/board-defaults';
import {
  SCREEN_CHANNEL,
  SCREEN_DETECT_TIMEOUT_MS,
  describeScreen,
  detectScreens,
  loadScreenProfile,
  openScreenWindow,
  saveScreenProfile,
  subscribeScreenProfile,
  windowNameFor,
} from '../core/screen-profiles';
import './screen-cockpit.css';

/** Board ids offered in the picker: the shipped ones, plus anything stored. */
function useBoardChoices() {
  return useMemo(() => {
    const ids = [...new Set([...BUILT_IN_BOARDS, ...listBoards()])];
    return ids.sort((a, b) => boardLabel(a).localeCompare(boardLabel(b)));
  }, []);
}

export default function ScreenCockpitPage() {
  const [detection, setDetection] = useState({ status: 'idle' });
  const [profile, setProfile] = useState(() => loadScreenProfile());
  const [openKeys, setOpenKeys] = useState(() => new Set());
  const [notice, setNotice] = useState(null);
  const windowsRef = useRef(new Map());
  const boardChoices = useBoardChoices();

  // Memoised: `screens` and `assignments` are dependency-array inputs for the
  // callbacks below, so recreating them each render would rebuild those handlers
  // on every paint for no reason.
  const screens = useMemo(() => detection.screens || [], [detection.screens]);
  const assignments = useMemo(() => profile.assignments || {}, [profile.assignments]);

  // ── Detection ──────────────────────────────────────────────────────────────
  const detect = useCallback(async () => {
    setDetection((prev) => ({ ...prev, status: 'detecting' }));
    const result = await detectScreens();
    setDetection({ status: 'done', ...result });
  }, []);

  // First render: try once. Chromium usually refuses without a gesture, which
  // lands in the 'denied' state and shows the Detect button as the way forward.
  useEffect(() => { detect(); }, [detect]);

  useEffect(() => subscribeScreenProfile((next) => setProfile(next)), []);

  // ── Which screen windows are actually alive ────────────────────────────────
  // The cockpit asks over the channel rather than trusting its own refs: a
  // reload would otherwise forget windows that are still open on other monitors.
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return undefined;
    const channel = new BroadcastChannel(SCREEN_CHANNEL);
    channel.onmessage = (event) => {
      const data = event.data || {};
      if (data.type === 'screen-alive') {
        setOpenKeys((prev) => (prev.has(data.key) ? prev : new Set([...prev, data.key])));
      }
      if (data.type === 'screen-closed') {
        setOpenKeys((prev) => {
          if (!prev.has(data.key)) return prev;
          const next = new Set(prev);
          next.delete(data.key);
          return next;
        });
      }
    };
    channel.postMessage({ type: 'cockpit-ping' });

    // A screen window that closed while the cockpit was not listening leaves a
    // stale "open" dot, so the poll also checks the handles we do hold.
    const poll = setInterval(() => {
      const stale = [];
      windowsRef.current.forEach((win, key) => { if (win.closed) stale.push(key); });
      if (stale.length) {
        windowsRef.current.clear();
        setOpenKeys((prev) => {
          const next = new Set(prev);
          stale.forEach((k) => next.delete(k));
          return next;
        });
      }
    }, 1500);

    return () => { clearInterval(poll); channel.close(); };
  }, []);

  // ── Mutations ──────────────────────────────────────────────────────────────
  const assign = useCallback((key, boardId) => {
    setProfile((prev) => {
      const next = { ...prev, assignments: { ...prev.assignments, [key]: boardId } };
      saveScreenProfile(next);
      return next;
    });
  }, []);

  const closeAll = useCallback(() => {
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel(SCREEN_CHANNEL);
      channel.postMessage({ type: 'cockpit-close-all' });
      channel.close();
    }
    windowsRef.current.forEach((win) => { try { win.close(); } catch { /* already gone */ } });
    windowsRef.current.clear();
    setOpenKeys(new Set());
    setNotice('Asked every screen window to close.');
  }, []);

  const openOn = useCallback((screen) => {
    const boardId = assignments[screen.key] || 'dashboard';
    const win = openScreenWindow(screen, boardId);

    if (!win) {
      setNotice('Popup blocked — allow popups for localhost, then press Open again.');
      return;
    }
    windowsRef.current.set(screen.key, win);
    setOpenKeys((prev) => new Set([...prev, screen.key]));
    setNotice(`Opened ${boardLabel(boardId)} on ${screen.label || 'screen'}.`);
  }, [assignments]);

  const openAll = useCallback(() => {
    const opened = screens.filter((screen) => {
      const win = openScreenWindow(screen, assignments[screen.key] || 'dashboard');
      if (win) windowsRef.current.set(screen.key, win);
      return Boolean(win);
    });
    setOpenKeys((prev) => new Set([...prev, ...opened.map((s) => s.key)]));
    setNotice(
      opened.length === screens.length
        ? `Opened ${opened.length} screen window${opened.length === 1 ? '' : 's'}.`
        : `Popup blocked — ${opened.length} of ${screens.length} windows opened.`
    );
  }, [assignments, screens]);

  // ── Render ─────────────────────────────────────────────────────────────────
  const status = detection.status;
  const permission = detection.permission;

  return (
    <div className="screencockpit-page">
      <header className="screencockpit-header">
        <h1>
          Screen Cockpit
          <PageInfoPopover>
            Assign a widget board to each monitor and open it there. Boards are arranged on the
            Dashboard or the Widget Library page; this page only decides which board lives on which
            screen, and remembers it.
            {'\n\n'}
            ⚠️ The dropdown below lists BOARDS (screens you can fill), not pages. A board named
            "Dashboard" is the Dashboard board — choosing it assigns that board to this monitor, it
            does not navigate anywhere.
            {'\n\n'}
            Detection uses the browser's Window Management API, which needs permission and a click —
            press Detect screens if a screen list does not appear. Each screen opens in its own named
            window, so reopening focuses the existing one instead of stacking duplicates. All screen
            windows share one board document: rearrange a board in any window and the others follow.
          </PageInfoPopover>
        </h1>
        <p className="screencockpit-subtitle">
          Multi-monitor layout for the widget cockpit. Each screen shows one board, full-bleed.
        </p>
      </header>

      <section className="screencockpit-actions">
        <button type="button" className="screencockpit-btn screencockpit-btn--primary" onClick={detect}>
          {status === 'detecting' ? 'Detecting…' : 'Detect screens'}
        </button>
        <button
          type="button"
          className="screencockpit-btn"
          onClick={openAll}
          disabled={!screens.length}
          title="Open the assigned board on every detected screen"
        >
          Open all screens
        </button>
        <button
          type="button"
          className="screencockpit-btn screencockpit-btn--ghost"
          onClick={closeAll}
          disabled={!screens.length}
          title="Close every screen window"
        >
          Close all windows
        </button>
        <span className="screencockpit-count">
          {screens.length} screen{screens.length === 1 ? '' : 's'} · {openKeys.size} window
          {openKeys.size === 1 ? '' : 's'} open
        </span>
      </section>

      {permission === 'denied' && (
        <p className="screencockpit-notice screencockpit-notice--warn">
          Screen detection was refused, so this list falls back to the one screen the browser always
          exposes. Grant the window-management permission (site settings) and press Detect screens to
          see every monitor.
        </p>
      )}
      {permission === 'unsupported' && (
        <p className="screencockpit-notice screencockpit-notice--warn">
          This browser has no Window Management API, so only the current screen is known. Screen
          windows still open — they just cannot be positioned onto a specific monitor.
        </p>
      )}
      {permission === 'timeout' && (
        <p className="screencockpit-notice screencockpit-notice--warn">
          Screen detection did not answer within {SCREEN_DETECT_TIMEOUT_MS / 1000}s, so only the
          current screen is listed. This happens when the page is not the focused window — click
          into this window and press Detect screens again.
        </p>
      )}
      {permission === 'error' && (
        <p className="screencockpit-notice screencockpit-notice--warn">
          Screen detection failed ({detection.error}). Showing the current screen only.
        </p>
      )}
      {notice && <p className="screencockpit-notice screencockpit-notice--info">{notice}</p>}

      <table className="screencockpit-table">
        <caption className="screencockpit-caption">
          One board per monitor. Assignments save as you change them.
        </caption>
        <thead>
          <tr>
            <th scope="col">Screen</th>
            <th scope="col">Geometry</th>
            <th scope="col">Board</th>
            <th scope="col">Window</th>
          </tr>
        </thead>
        <tbody>
          {screens.map((screen, i) => {
            const key = screen.key;
            const boardId = assignments[key] || '';
            const isOpen = openKeys.has(key);
            return (
              <tr key={key}>
                <th scope="row" className="screencockpit-screen-cell">
                  <span className="screencockpit-screen-name">{screen.label || `Screen ${i + 1}`}</span>
                  {screen.isPrimary && <span className="screencockpit-tag">primary</span>}
                  <span className="screencockpit-screen-key">{windowNameFor(key)}</span>
                </th>
                <td className="screencockpit-geometry">{describeScreen(screen)}</td>
                <td>
                  <label className="screencockpit-field">
                    <span className="screencockpit-sr">Board for {screen.label || `screen ${i + 1}`}</span>
                    <select
                      className="screencockpit-select"
                      value={boardId}
                      onChange={(e) => assign(key, e.target.value)}
                    >
                      <option value="">Unassigned</option>
                      {boardChoices.map((id) => (
                        <option key={id} value={id}>{boardLabel(id)}</option>
                      ))}
                      {boardId && !boardChoices.includes(boardId) && (
                        <option value={boardId}>{boardId}</option>
                      )}
                    </select>
                  </label>
                  <span className="screencockpit-hint">
                    {boardId
                      ? `${defaultWidgetsFor(boardId).length || 'any'} default widget${
                          defaultWidgetsFor(boardId).length === 1 ? '' : 's'
                        }`
                      : 'Nothing opens until a board is assigned'}
                  </span>
                </td>
                <td>
                  <button
                    type="button"
                    className="screencockpit-btn screencockpit-btn--open"
                    onClick={() => openOn(screen)}
                    disabled={!boardId}
                    title={boardId ? `Open ${boardLabel(boardId)} here` : 'Assign a board first'}
                  >
                    {isOpen ? 'Focus' : 'Open'}
                  </button>
                  <span className={isOpen ? 'screencockpit-dot screencockpit-dot--on' : 'screencockpit-dot'} aria-hidden="true" />
                  <span className="screencockpit-sr">{isOpen ? 'window open' : 'window closed'}</span>
                </td>
              </tr>
            );
          })}
          {!screens.length && (
            <tr>
              <td colSpan={4} className="screencockpit-empty">
                {status === 'detecting' ? 'Detecting screens…' : 'No screens detected yet.'}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <section className="screencockpit-notes">
        <h2 className="screencockpit-notes-title">How the windows behave</h2>
        <ul className="screencockpit-notes-list">
          <li>
            Each screen is a normal browser window at{' '}
            <code>{'window.open'}</code> geometry <code>left/top/width/height</code> taken from that
            monitor's available area, so it opens above the OS taskbar.
          </li>
          <li>
            Windows are named <code>tcs-screen-&lt;key&gt;</code>, so pressing Open twice focuses the
            window instead of creating a second copy of the same board.
          </li>
          <li>
            Several windows can show the same board. Editing it in one window updates the others —
            the layout is one document, not a copy per window.
          </li>
          <li>
            Closing a window is safe: the board's arrangement is saved as you change it, and the
            assignment stays, so you can reopen it later.
          </li>
        </ul>
      </section>
    </div>
  );
}
