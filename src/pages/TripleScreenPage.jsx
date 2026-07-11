import { useState, useCallback, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import './triple-screen.css';

const SCREEN_SLOTS = [
  { id: 'left', label: 'Screen Left', shortcut: 'Win+Shift+Left', desc: 'Watchlists, positions, account summary' },
  { id: 'center', label: 'Screen Center', shortcut: 'Primary', desc: 'Charts, price action, DOM, time and sales' },
  { id: 'right', label: 'Screen Right', shortcut: 'Win+Shift+Right', desc: 'Execution, orders, alerts, scoring feed' },
];

export default function TripleScreenPage() {
  const [tripleWindow, setTripleWindow] = useState(null);
  const [tripleReady, setTripleReady] = useState(false);
  const [screenInfo, setScreenInfo] = useState(null);
  const channelRef = useRef(null);

  useEffect(() => {
    const detect = async () => {
      try {
        if ('getScreenDetails' in window) {
          const details = await window.getScreenDetails();
          setScreenInfo({
            count: details.screens.length,
            screens: details.screens.map((s) => ({
              left: s.left, top: s.top, width: s.width, height: s.height, isPrimary: s.isPrimary,
            })),
          });
        } else {
          const primary = window.screen;
          setScreenInfo({
            count: primary.width > 3000 ? 3 : 1,
            screens: primary.width > 3000
              ? [
                  { left: 0, top: 0, width: primary.width / 3, height: primary.height, isPrimary: false },
                  { left: primary.width / 3, top: 0, width: primary.width / 3, height: primary.height, isPrimary: true },
                  { left: (primary.width / 3) * 2, top: 0, width: primary.width / 3, height: primary.height, isPrimary: false },
                ]
              : [{ left: 0, top: 0, width: primary.width, height: primary.height, isPrimary: true }],
          });
        }
      } catch {
        const primary = window.screen;
        setScreenInfo({ count: 1, screens: [{ left: 0, top: 0, width: primary.width, height: primary.height, isPrimary: true }] });
      }
    };
    detect();
  }, []);

  useEffect(() => {
    const channel = new BroadcastChannel('tcs:triple-screen');
    channelRef.current = channel;
    channel.onmessage = (event) => {
      if (event.data && event.data.type === 'ready') setTripleReady(true);
      if (event.data && event.data.type === 'closed') { setTripleWindow(null); setTripleReady(false); }
    };
    return () => channel.close();
  }, []);

  useEffect(() => {
    if (!tripleWindow) return;
    const interval = setInterval(() => {
      if (tripleWindow.closed) { setTripleWindow(null); setTripleReady(false); }
    }, 1000);
    return () => clearInterval(interval);
  }, [tripleWindow]);

  const handleLaunch = useCallback(() => {
    if (!screenInfo || screenInfo.count < 2) {
      const w = window.open(
        '/lab/triple-screen?mode=triple',
        'tcs-triple-screen',
        'width=' + window.screen.availWidth + ',height=' + window.screen.availHeight + ',left=0,top=0,menubar=no,toolbar=no,status=no'
      );
      if (w) { setTripleWindow(w); }
      return;
    }
    const screens = screenInfo.screens;
    const minLeft = Math.min(...screens.map(function (s) { return s.left; }));
    const minTop = Math.min(...screens.map(function (s) { return s.top; }));
    const maxRight = Math.max(...screens.map(function (s) { return s.left + s.width; }));
    const maxBottom = Math.max(...screens.map(function (s) { return s.top + s.height; }));
    const totalW = maxRight - minLeft;
    const totalH = maxBottom - minTop;
    const w = window.open(
      '/lab/triple-screen?mode=triple',
      'tcs-triple-screen',
      'width=' + totalW + ',height=' + totalH + ',left=' + minLeft + ',top=' + minTop + ',menubar=no,toolbar=no,status=no,location=no'
    );
    if (w) {
      try { w.moveTo(minLeft, minTop); w.resizeTo(totalW, totalH); } catch (e) { /* blocked by browser */ }
      setTripleWindow(w);
    }
  }, [screenInfo]);

  const handleClose = useCallback(function () {
    if (tripleWindow && !tripleWindow.closed) tripleWindow.close();
    setTripleWindow(null);
    setTripleReady(false);
  }, [tripleWindow]);

  const isTripleMode = new URLSearchParams(window.location.search).get('mode') === 'triple';

  useEffect(function () {
    if (!isTripleMode) return;
    var channel = new BroadcastChannel('tcs:triple-screen');
    setTimeout(function () { channel.postMessage({ type: 'ready' }); }, 500);
    return function () { channel.close(); };
  }, [isTripleMode]);

  return (
    <div className={'ts-page ' + (isTripleMode ? 'ts-mode-triple' : 'ts-mode-preview')}>
      {!isTripleMode && (
        <>
          <header className="ts-header">
            <div>
              <h2>Triple-Screen Cockpit</h2>
              <p className="ts-subtitle">
                Multi-monitor trading layout with independent left, center, and right screen areas.
              </p>
            </div>
            <div className="ts-header-actions">
              {!tripleWindow && (
                <button className="ts-btn-launch" onClick={handleLaunch}>
                  Launch Triple Screen
                </button>
              )}
              {tripleWindow && (
                <>
                  <span className={'ts-status ' + (tripleReady ? 'ready' : 'waiting')}>
                    {tripleReady ? 'Connected' : 'Waiting...'}
                  </span>
                  <button className="ts-btn-close" onClick={handleClose}>Close</button>
                </>
              )}
            </div>
          </header>

          {screenInfo && (
            <div className="ts-screen-info">
              <span>{screenInfo.count} monitor{screenInfo.count !== 1 ? 's' : ''} detected</span>
              {screenInfo.screens.map(function (s, i) {
                return (
                  <span key={i} className="ts-screen-detail">
                    Screen {i + 1}: {s.width}x{s.height} {s.isPrimary ? '(primary)' : ''}
                  </span>
                );
              })}
            </div>
          )}

          <div className="ts-preview-grid">
            {SCREEN_SLOTS.map(function (slot, i) {
              return (
                <motion.div
                  key={slot.id}
                  className={'ts-preview-slot ts-slot-' + slot.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.08 }}
                >
                  <div className="ts-slot-header">
                    <span className="ts-slot-label">{slot.label}</span>
                    <span className="ts-slot-key">{slot.shortcut}</span>
                  </div>
                  <p className="ts-slot-desc">{slot.desc}</p>
                  <div className="ts-slot-placeholder">
                    <span>Widget slot - drag panels here</span>
                  </div>
                </motion.div>
              );
            })}
          </div>

          <div className="ts-notes">
            <h4>How it works</h4>
            <ol>
              <li>Click <strong>Launch Triple Screen</strong> - opens a new window spanning all monitors</li>
              <li>Drag the window to cover 3 screens (or use Win+Shift+Left/Right if already positioned)</li>
              <li>Each screen column is an independent panel area</li>
              <li>Widgets can be dragged between panels via the DetachableWidget system</li>
              <li>BroadcastChannel keeps main window and triple window in sync</li>
            </ol>
          </div>
        </>
      )}

      {isTripleMode && (
        <div className="ts-triple-layout">
          {SCREEN_SLOTS.map(function (slot) {
            return (
              <div key={slot.id} className={'ts-screen-panel ts-panel-' + slot.id}>
                <div className="ts-panel-titlebar">
                  <span>{slot.label}</span>
                  <span className="ts-panel-hint">{slot.desc}</span>
                </div>
                <div className="ts-panel-body">
                  <div className="ts-panel-placeholder">
                    <span className="ts-placeholder-label">{slot.label}</span>
                    <span className="ts-placeholder-desc">{slot.desc}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
