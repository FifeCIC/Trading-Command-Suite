import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import MetaStackPipeline from '../components/MetaStackPipeline';
import ScoreCard from '../components/ScoreCard';
import SignalCard from '../components/SignalCard';
import CockpitPanelCard from '../components/CockpitPanelCard';
import { apiGet } from '../core/api/client';
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
const COCKPIT_ROUTE = '/development/meta-stack-cockpit';
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

  /* ── Data for the remaining pipeline stages ─────────────────────────────────
   * Every endpoint below already existed and is already used elsewhere; none is new. The
   * rule for this page is "re-display what exists", so a stage with no existing card shares
   * `CockpitPanelCard` rather than growing its own.
   */
  const riskQuery = useQuery({
    queryKey: ['strategy-risk-limits'],
    queryFn: () => apiGet('/api/trading/strategies/risk-limits').catch(() => null),
    staleTime: 60_000,
  });

  const ratingsQuery = useQuery({
    queryKey: ['metastack-ratings'],
    queryFn: () => apiGet('/api/scoring/metastacks/ratings'),
    refetchInterval: 30_000,
  });

  // ⚠️ SYMBOLS: deduped, because the same ticker is resolved by many protocols. The count of
  // protocols scanning a symbol is the interesting number — it is why a symbol appears at all.
  const symbolRows = useMemo(() => {
    const bySymbol = new Map();
    for (const p of protocols) {
      if (p.active === false) continue;
      for (const s of p.resolvedSymbols || []) {
        const ticker = String(s).toUpperCase();
        const entry = bySymbol.get(ticker) || { symbol: ticker, protocols: 0 };
        entry.protocols += 1;
        bySymbol.set(ticker, entry);
      }
    }
    return [...bySymbol.values()].sort(
      (a, b) => b.protocols - a.protocols || a.symbol.localeCompare(b.symbol),
    );
  }, [protocols]);

  const activeProtocols = useMemo(
    () => protocols.filter((p) => p.active !== false),
    [protocols],
  );

  // ⚠️ EXECUTION uses `/api/automation/status`, NOT `/api/symbols/positions`.
  //
  // Measured 2026-09-17: `/api/symbols/positions` returns 25 rows ALL with `hasPosition: true`
  // and non-zero `quantity` — including `3NVD`, `8XP`, `ACIC`, which nothing is holding. The
  // marquee's own position count is 0, and `brokerStates.mt5.positionCount` is EMPTY. So that
  // endpoint cannot be trusted for "what is open", and rendering it would have shown 25
  // fabricated holdings — precisely the "plausible numbers, no error" failure this repo keeps
  // hitting. `/api/automation/status` is where the marquee's real figure comes from.
  const automationQuery = useQuery({
    queryKey: ['automation-status'],
    queryFn: () => apiGet('/api/automation/status').catch(() => null),
    refetchInterval: 15_000,
  });

  /* ── Execution: portfolio + trade queue ────────────────────────────────────────
   * With no live MT5 positions there is nothing to list per-position, so the Execution column
   * shows what IS real and useful: where the money actually is, and whether anything is queued.
   *
   * `categories` splits LIVE from DEMO. That split is the point — `Live: 0` next to
   * `Demo: 25,862` tells an operator at a glance that no real capital is at work, which no
   * aggregate total can express.
   */
  const portfolioQuery = useQuery({
    queryKey: ['portfolio-accounts'],
    queryFn: () => apiGet('/api/portfolio/accounts').catch(() => null),
    refetchInterval: 60_000,
  });

  /**
   * Queue DEPTH and queue CONFIG are two different facts from two different endpoints.
   *
   * ⚠️ `GET /api/trading/strategies/bot-queue` DOES NOT EXIST (fixed 2026-09-17). The strategies
   * controller declares `@Get()`, `with-ratios`, `queues`, `risk-limits`, `bot-rules` and `:id` — so
   * that URL fell through to `@Get(':id')` and called `findOne('bot-queue')`. It returned null, the
   * `.catch(() => null)` hidden it further, and the badge rendered `?` permanently with no error
   * anywhere. Same defect class as `apiGet('/api/speed/scan')` on a POST-only route.
   *
   *   depth  ← GET /api/trading/strategies/queues  → bare ARRAY of pending rows
   *   config ← GET /api/automation/bot-queue       → OBJECT { enabled, interTradeDelayMinutes }
   *
   * They are not interchangeable: one counts work waiting, the other says whether the dispatcher
   * will act on it. An empty queue that is being drained is a healthy idle system; an empty queue
   * with the switch OFF is a stalled one, and only showing the count cannot tell them apart.
   */
  const queueQuery = useQuery({
    queryKey: ['trading-queue-depth'],
    queryFn: () => apiGet('/api/trading/strategies/queues').catch(() => null),
    refetchInterval: 15_000,
  });

  // #722 — the bot-queue kill switch and inter-trade delay lost their only UI surface when the
  // pipeline page pills were removed (styling reasons, 2026-09-03). This card is now that surface.
  // `enabled` is the kill switch for the bot dispatch path only; the delay spaces consecutive
  // bot trades.
  const botQueueQuery = useQuery({
    queryKey: ['bot-queue-config'],
    queryFn: () => apiGet('/api/automation/bot-queue').catch(() => null),
    refetchInterval: 30_000,
  });

  const metaStacks = ratingsQuery.data?.metaStacks || [];

  // `brokerStates` is an object keyed by broker name, not an array. `activeStrategies` may be a
  // count or a list depending on the endpoint's mood — handle both rather than printing
  // "[object Object]".
  const brokerRows = Object.entries(automationQuery.data?.brokerStates || {});
// ⚠️ BOTS, not strategies (#878). `activeStrategies` comes from the automation status endpoint,
    // which builds it from `tradingStrategy.findMany({ where: { active: true } })` — i.e. rows in
    // `trading_strategy`. "Strategy" already means a derived strategy, a protocol subscription and
    // a strategy-library entry elsewhere in this app, so a bot count labelled "Strategies" showed a
    // number that no reader could tie back to anything. Named for what it holds, labelled the same.
    const botCount = Array.isArray(automationQuery.data?.activeStrategies)
    ? automationQuery.data.activeStrategies.length
    : (automationQuery.data?.activeStrategies ?? '—');

  // ⚠️ A raw number, rounded, with NO currency symbol. The endpoint reports a bare amount and
  // nothing in it says which denomination — printing "$" would be inventing a fact.
  const money = (v) => (v == null ? '—' : Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 }));

  const portfolioCategories = portfolioQuery.data?.categories || [];

  // ⚠️ `bot-queue` returns a bare array; an empty one means genuinely nothing queued. Distinguish
  // that from a failed request (`.data` undefined) rather than showing 0 for both.
  const queueLength = Array.isArray(queueQuery.data) ? queueQuery.data.length : null;

  /** Direction intent → the badge the Strategy column shows. Text carries the meaning. */
  const dirBadge = (mode) => (
    mode === 'SHORT_ONLY' ? { text: 'SHORT', tone: 'short' }
      : mode === 'BOTH' ? { text: 'L/S', tone: 'both' }
        : { text: 'LONG', tone: 'long' }
  );

  /** P&L → card tone. `up`/`down` colour the left edge only; the number is still the message. */
  const pnlTone = (v) => (Number(v) > 0 ? 'up' : Number(v) < 0 ? 'down' : null);

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

  /**
   * Make the pop-out ACTUALLY fullscreen.
   *
   * `cockpit-mode-full` gives the column grid `position: fixed; inset: 0`, so it covers the
   * viewport — but the app shell behind it is still in the DOM and still contributes to document
   * height. Measured 2026-09-17 at `?mode=cockpit`: the overlay filled 949/949px, yet
   * `documentElement.scrollHeight` was 1062px, so a vertical scrollbar appeared and scrolling
   * revealed the shell underneath the "fullscreen" view.
   *
   * ⚠️ Restores the previous value on unmount rather than clearing it — this runs inside the app
   * shell, and leaving `overflow: hidden` behind would break scrolling on every page the user
   * navigates to next.
   */
  useEffect(() => {
    if (!isCockpitMode) return undefined;
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = 'hidden';
    return () => { root.style.overflow = previous; };
  }, [isCockpitMode]);

  useEffect(function () {
    if (!isCockpitMode) return;
    var channel = new BroadcastChannel(COCKPIT_CHANNEL);
    setTimeout(function () { channel.postMessage({ type: 'ready' }); }, 500);
    return function () { channel.close(); };
  }, [isCockpitMode]);

  /**
   * The columns — one per META.Stack pipeline stage, in pipeline order:
   *
   *   Symbols → Strategy → Scores → Signals → Risk Rules → Execution → Results
   *
   * Each is a HOST FOR CONTROLS, not just a list: they share `.cockpit-screen-panel`, so whatever
   * gets added later (quick trade actions, on-the-fly settings) lands in a real column rather than
   * a one-off box.
   *
   * ⚠️ NO NEW ENDPOINTS. Two columns re-use a card that already existed on another page
   * (Scores ← Ladder, Signals ← Signals Overview). The other five share `CockpitPanelCard`,
   * because five bespoke cards would be five new implementations — the opposite of the point.
   *
   * ⚠️ `showTop={false}` on every score card. Each column starts at rank 0, so the default would
   * badge the FIRST card of the column as "the top opportunity" — a highlight that only carries
   * meaning inside a single ranked list (LadderPage passes nothing, so it keeps it there).
   */
  const panel = (key, icon, label, hint, cards) => (
    <section className="cockpit-screen-panel" key={key}>
      <div className="cockpit-panel-titlebar">
        <span><span aria-hidden="true">{icon}</span> {label}</span>
        <span className="cockpit-panel-hint">{hint}</span>
      </div>
      <div className="cockpit-panel-body cockpit-panel-cards">{cards}</div>
    </section>
  );

  const cockpitColumns = (
    <div
      // ⚠️ The pop-out gets `cockpit-mode-full` (position:fixed, inset 0) so it actually fills
      // the window it was launched into. Before 2026-09-17 that class existed in the stylesheet
      // and was NEVER applied, so a launched window rendered a 76vh box with page margins —
      // measured 721px of a 949px viewport, `hasFullscreenClass: false`.
      // `--page` is the in-page variant: a DEFINITE height, so each panel's internal scrolling
      // works inside normal document flow without taking over the viewport.
      className={`cockpit-columns ${isCockpitMode ? 'cockpit-mode-full' : 'cockpit-columns--page'}`}
      ref={columnsRef}
    >
      {panel('symbols', '★', 'Symbols', `${symbolRows.length} in play`,
        symbolRows.map((s) => (
          <CockpitPanelCard
            key={s.symbol}
            title={s.symbol}
            subtitle={symbolMeta[s.symbol]?.name || null}
            badge={symbolMeta[s.symbol]?.type ? { text: symbolMeta[s.symbol].type, tone: 'muted' } : null}
            rows={[['Protocols', s.protocols]]}
          />
        )))}

      {panel('strategy', '◆', 'Strategy', `${activeProtocols.length} active`,
        activeProtocols.map((p) => (
          <CockpitPanelCard
            key={p.id}
            title={p.name || p.id}
            subtitle={p.recommendedTimeframe ? `TF ${p.recommendedTimeframe}` : (p.tradingStyle || null)}
            badge={dirBadge(p.directionMode)}
            rows={[
              ['Directives', p.directiveCount ?? '—'],
              ['Symbols', (p.resolvedSymbols || []).length],
              ['Max', p.maxScore ?? '—'],
            ]}
            meta={p.adaptiveTargetActive ? `Adaptive target — peak ${Math.round(p.adaptiveTargetMax ?? 0)}` : null}
          />
        )))}

      {panel('scores', '◉', 'Scores',
        scoresLoading ? 'loading…' : `${scoreEntries.length} cards`,
        scoreEntries.map((e, i) => (
          <ScoreCard
            key={`${e.protocolId}::${e.symbol}`}
            entry={e}
            rank={i}
            showTop={false}
            scoreDisplay="both"
            meta={symbolMeta[e.symbol] || null}
            pos={positionBySymbol[e.symbol] || null}
          />
        )))}

      {panel('signals', '🚩', 'Signals',
        signalsQuery.isLoading ? 'loading…' : `${envelopes.length} live`,
        envelopes.map((env) => (
          <SignalCard
            key={env.scoreId || `${env.symbol}::${env.protocolId}`}
            envelope={env}
            dismissHours={dismissHours}
            defaults={defaultsQuery.data}
            onDismissed={refreshSignals}
          />
        )))}

      {panel('risk', '⚙', 'Risk Rules', 'server limits',
        riskQuery.data ? (
          <CockpitPanelCard
            title="Server hard limits"
            badge={{ text: 'ENFORCED', tone: 'muted' }}
            rows={[
              ['Max position', riskQuery.data.maxPositionSize],
              ['Max daily loss', riskQuery.data.maxDailyLoss],
              ['Max open', riskQuery.data.maxOpenPositions],
            ]}
            meta={riskQuery.data.note || null}
          />
        ) : (
          <CockpitPanelCard title="Server hard limits" subtitle="unavailable — see the notice" />
        ))}

      {panel('execution', '🔌', 'Execution',
        portfolioQuery.data ? `portfolio ${money(portfolioQuery.data.grandTotal)}` : 'unavailable',
        <>
          {/* Portfolio first: it is the one figure that is actually reported. The LIVE vs DEMO
              split is the point — "Live: 0" beside "Demo: 25,862" says no real capital is at
              work, which no aggregate total can express. */}
          <CockpitPanelCard
            title="Portfolio"
            badge={portfolioQuery.data ? { text: money(portfolioQuery.data.grandTotal), tone: 'muted' } : { text: 'unavailable', tone: 'warn' }}
            rows={portfolioCategories.map((c) => [c.label, money(c.total)])}
            meta={portfolioCategories.length > 0 ? 'Split by account category — LIVE vs DEMO' : null}
          />

          {/* ⚠️ `null` means the request FAILED; `0` means genuinely nothing queued. Never show
              one as the other. */}
          <CockpitPanelCard
            title="Trade queue"
            badge={
              queueLength == null ? { text: '?', tone: 'warn' }
                : queueLength === 0 ? { text: 'empty', tone: 'muted' }
                  : { text: `${queueLength} queued`, tone: 'both' }
            }
            rows={botQueueQuery.data ? [
              ['Dispatcher', botQueueQuery.data.enabled ? 'ON' : 'OFF'],
              ['Inter-trade', `${botQueueQuery.data.interTradeDelayMinutes ?? '—'}m`],
            ] : []}
            meta={
              botQueueQuery.data && !botQueueQuery.data.enabled
                ? 'Dispatcher OFF — queued signals will not be traded'
                : queueLength == null ? 'Queue status unavailable' : null
            }
          />

          {automationQuery.data && (
            <CockpitPanelCard
              title="Auto loop"
              badge={{ text: automationQuery.data.loopEnabled ? 'ON' : 'OFF', tone: automationQuery.data.loopEnabled ? 'both' : 'warn' }}
              rows={[
                ['Bots', botCount],
                ['Ticks', automationQuery.data.tickCount ?? 0],
                ['Risk ×', automationQuery.data.globalRiskMultiplier ?? '—'],
              ]}
            />
          )}

          {/* ⚠️ An UNKNOWN count prints "? count", never 0. `positionCount` is currently empty for
              mt5, and a 0 there would read as "nothing is open" — a claim this data cannot
              support. Distinguish "none" from "cannot tell". */}
          {brokerRows.map(([name, state]) => (
            <CockpitPanelCard
              key={name}
              title={name.toUpperCase()}
              badge={{ text: state?.positionCount == null ? '? count' : `${state.positionCount} open`, tone: state?.positionCount == null ? 'warn' : 'muted' }}
              meta={state?.positionCount == null ? 'Broker position count is not being reported' : null}
            />
          ))}
        </>)}

      {panel('results', '◈', 'Results',
        ratingsQuery.isLoading ? 'loading…' : `${metaStacks.length} stacks`,
        metaStacks.map((m) => (
          <CockpitPanelCard
            key={m.scoringStrategyId || m.metaStackName}
            title={m.metaStackName || '—'}
            subtitle={m.protocolId || null}
            badge={{ text: m.band || 'Untested', tone: (m.totalTrades ?? 0) > 0 ? 'both' : 'muted' }}
            tone={pnlTone(m.totalPnl)}
            rows={[
              ['Trades', m.totalTrades ?? 0],
              ['Win', m.winRate != null ? `${(m.winRate * 100).toFixed(0)}%` : '—'],
              ['Rating', m.rating ?? '—'],
            ]}
          />
        )))}
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
