import { useState, useCallback, useEffect, useRef } from 'react';
import MetaStackPipeline from '../components/MetaStackPipeline';
import './triple-screen.css';

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
    <>
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

          <MetaStackPipeline title="Triple-Screen Cockpit" subtitle="Multi-monitor META.Stack pipeline layout" />
        </>
      )}

      {isTripleMode && (
        <MetaStackPipeline title="Triple-Screen Cockpit" subtitle="Multi-monitor META.Stack pipeline layout" />
      )}
    </>
  );
}
