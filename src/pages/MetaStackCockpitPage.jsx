import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import MetaStackPipeline from '../components/MetaStackPipeline';
import ScoreCard from '../components/ScoreCard';
import SignalCard from '../components/SignalCard';
import { buildScoreEntries } from '../core/score-card-entries';
import { useProtocolData } from '../core/useProtocolData';
import { SIGNAL_REFRESH_MS, readDismissHours } from '../core/signal-card-view';
import { fetchBestSignals, fetchTradeDefaults } from '../core/api/signals';
import { useScrollReveal } from '../hooks/useScrollReveal';
import { useSymbolLookups } from '../hooks/useSymbolLookups';
import './metastack-cockpit.css';

/**
 * The launcher and the pop-out it opens are the same page, so these three literals
 * MUST agree or the launcher shows "Waiting..." forever:
 *  - COCKPIT_CHANNEL is opened by both and carries the ready/closed handshake.
 *  - COCKPIT_WINDOW_NAME is the window.open target name (refocus/close reuse it).
 *  - the ?mode= param tells a pop-out to render the layout WITHOUT the launcher chrome.
 *
 * ⚠️ Renamed 2026-09-17 from `tcs:triple-screen` / `/lab/triple-screen?mode=triple`.
 * "Triple" encoded a monitor count, which is a hardware fact, not a layout fact.
 */
const COCKPIT_CHANNEL = 'tcs:meta-stack-cockpit';
const COCKPIT_WINDOW_NAME = 'tcs-meta-stack-cockpit';
const COCKPIT_ROUTE = '/lab/meta-stack-cockpit';
const COCKPIT_MODE = 'cockpit';

export default function MetaStackCockpitPage() {
  const [cockpitWindow, setCockpitWindow] = useState(null);
  const [cockpitReady, setCockpitReady] = useState(false);
  const [screenInfo, setScreenInfo] = useState(null);
  const channelRef = useRef(null);

  /* ── Column data ─────────────────────────────────────────────────────────────
   * Each column RE-DISPLAYS an existing page through that page's own data path and the
   * SAME shared card component — no new endpoint, no second card implementation:
   *
   *   Scores  → the Ladder's  (useProtocolData → buildScoreEntries)
   *   Signals → Signals Overview's (GET /api/signals/best → .envelopes)
   *
   * So a fix made for either source page lands here automatically. Query keys are shared
   * with those pages, so visiting both costs no extra requests.
   */
  const { protocols, runs, isLoading: scoresLoading } = useProtocolData();
  const scoreEntries = useMemo(() => buildScoreEntries(protocols, runs), [protocols, runs]);
  const { positionBySymbol, symbolMeta } = useSymbolLookups();

  const signalsQuery = useQuery({
    queryKey: ['signals-best'],
    queryFn: fetchBestSignals,
    refetchInterval: SIGNAL_REFRESH_MS,
  });
  const envelopes = signalsQuery.data?.envelopes || [];

  // Manual-trade defaults feed the card's order preview (size / SL / TP).
  const defaultsQuery = useQuery({
    queryKey: ['manual-trade-defaults'],
    queryFn: fetchTradeDefaults,
    staleTime: 60_000,
  });

  const queryClient = useQueryClient();
  const refreshSignals = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['signals-best'] });
    queryClient.invalidateQueries({ queryKey: ['signal-action'] });
  }, [queryClient]);

  // The dismissal horizon is the user's Screen Option, read from the SHARED helper so the
  // cockpit dismisses for the same window the Signals page does.
  const dismissHours = readDismissHours();

  // ⚠️ REQUIRED, not optional. `.lad-reveal` is `opacity: 0` and only this hook adds
  // `lad-reveal--show` — without it the Scores column renders INVISIBLE cards and reports
  // no error at all. See src/hooks/useScrollReveal.js.
  const columnsRef = useRef(null);
  useScrollReveal(columnsRef, [scoreEntries, envelopes]);

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
    const channel = new BroadcastChannel(COCKPIT_CHANNEL);
    channelRef.current = channel;
    channel.onmessage = (event) => {
      if (event.data && event.data.type === 'ready') setCockpitReady(true);
      if (event.data && event.data.type === 'closed') { setCockpitWindow(null); setCockpitReady(false); }
    };
    return () => channel.close();
  }, []);

  useEffect(() => {
    if (!cockpitWindow) return;
    const interval = setInterval(() => {
      if (cockpitWindow.closed) { setCockpitWindow(null); setCockpitReady(false); }
    }, 1000);
    return () => clearInterval(interval);
  }, [cockpitWindow]);

  const handleLaunch = useCallback(() => {
    if (!screenInfo || screenInfo.count < 2) {
      const w = window.open(
        COCKPIT_ROUTE + '?mode=' + COCKPIT_MODE,
        COCKPIT_WINDOW_NAME,
        'width=' + window.screen.availWidth + ',height=' + window.screen.availHeight + ',left=0,top=0,menubar=no,toolbar=no,status=no'
      );
      if (w) { setCockpitWindow(w); }
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
      COCKPIT_ROUTE + '?mode=' + COCKPIT_MODE,
      COCKPIT_WINDOW_NAME,
      'width=' + totalW + ',height=' + totalH + ',left=' + minLeft + ',top=' + minTop + ',menubar=no,toolbar=no,status=no,location=no'
    );
    if (w) {
      try { w.moveTo(minLeft, minTop); w.resizeTo(totalW, totalH); } catch { /* blocked by browser */ }
      setCockpitWindow(w);
    }
  }, [screenInfo]);

  const handleClose = useCallback(function () {
    if (cockpitWindow && !cockpitWindow.closed) cockpitWindow.close();
    setCockpitWindow(null);
    setCockpitReady(false);
  }, [cockpitWindow]);

  const isCockpitMode = new URLSearchParams(window.location.search).get('mode') === COCKPIT_MODE;

  useEffect(function () {
    if (!isCockpitMode) return;
    var channel = new BroadcastChannel(COCKPIT_CHANNEL);
    setTimeout(function () { channel.postMessage({ type: 'ready' }); }, 500);
    return function () { channel.close(); };
  }, [isCockpitMode]);

  /**
   * The two live columns.
   *
   * Each is a HOST FOR CONTROLS, not just a list: it uses the same `.cockpit-screen-panel`
   * container as the pop-out layout, so whatever gets added later (quick trade actions,
   * on-the-fly settings) lands in a real column rather than a one-off box.
   *
   * ⚠️ `showTop={false}` on every score card. Each column starts at rank 0, so the default
   * would badge the FIRST card of the column as "the top opportunity" — a highlight that
   * only carries meaning inside a single ranked list, and which would then appear on two
   * cards at once (LadderPage passes nothing, so it keeps the highlight there).
   */
  const cockpitColumns = (
    <div className="cockpit-columns cockpit-columns--page" ref={columnsRef}>
      <section className="cockpit-screen-panel cockpit-panel-left">
        <div className="cockpit-panel-titlebar">
          <span>Scores</span>
          <span className="cockpit-panel-hint">
            {scoresLoading ? 'loading…' : `${scoreEntries.length} card${scoreEntries.length === 1 ? '' : 's'}`}
          </span>
        </div>
        <div className="cockpit-panel-body cockpit-panel-cards">
          {scoreEntries.map((e, i) => (
            <ScoreCard
              key={`${e.protocolId}::${e.symbol}`}
              entry={e}
              rank={i}
              showTop={false}
              scoreDisplay="both"
              meta={symbolMeta[e.symbol] || null}
              pos={positionBySymbol[e.symbol] || null}
            />
          ))}
        </div>
      </section>

      <section className="cockpit-screen-panel cockpit-panel-center">
        <div className="cockpit-panel-titlebar">
          <span>Signals</span>
          <span className="cockpit-panel-hint">
            {signalsQuery.isLoading ? 'loading…' : `${envelopes.length} live`}
          </span>
        </div>
        <div className="cockpit-panel-body cockpit-panel-cards">
          {envelopes.map((env) => (
            <SignalCard
              key={env.scoreId || `${env.symbol}::${env.protocolId}`}
              envelope={env}
              dismissHours={dismissHours}
              defaults={defaultsQuery.data}
              onDismissed={refreshSignals}
            />
          ))}
        </div>
      </section>
    </div>
  );

  return (
    <>
      {!isCockpitMode && (
        <>
          {/* ⚠️ `cockpit-*`, not `ts-*` (2026-09-17). `trading-strategies.css` and
              `TradingStrategiesPage.jsx` both use `ts-header` / `ts-subtitle`, and all page CSS
              is bundled globally — so this page and Trading Strategies were styling EACH OTHER.
              Measured before the rename, `/trading/trading-strategies` `.ts-header` reported
              `display:flex`, `border-bottom:1px` and `align-items:flex-start`, none of which its
              own stylesheet declares. Keep this prefix unique. */}
          <header className="cockpit-header">
            <div>
              <h2>META.Stack Cockpit</h2>
              <p className="cockpit-subtitle">
                Multi-monitor trading layout with independent left, center, and right screen areas.
              </p>
            </div>
            <div className="cockpit-header-actions">
              {!cockpitWindow && (
                <button className="cockpit-btn-launch" onClick={handleLaunch}>
                  Launch Cockpit
                </button>
              )}
              {cockpitWindow && (
                <>
                  <span className={'cockpit-status ' + (cockpitReady ? 'ready' : 'waiting')}>
                    {cockpitReady ? 'Connected' : 'Waiting...'}
                  </span>
                  <button className="cockpit-btn-close" onClick={handleClose}>Close</button>
                </>
              )}
            </div>
          </header>

          {screenInfo && (
            <div className="cockpit-screen-info">
              <span>{screenInfo.count} monitor{screenInfo.count !== 1 ? 's' : ''} detected</span>
              {screenInfo.screens.map(function (s, i) {
                return (
                  <span key={i} className="cockpit-screen-detail">
                    Screen {i + 1}: {s.width}x{s.height} {s.isPrimary ? '(primary)' : ''}
                  </span>
                );
              })}
            </div>
          )}

          {cockpitColumns}

          <MetaStackPipeline title="META.Stack Cockpit" subtitle="Multi-monitor META.Stack pipeline layout" />
        </>
      )}

      {isCockpitMode && cockpitColumns}
    </>
  );
}
