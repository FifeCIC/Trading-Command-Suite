/**
 * Built-in widgets
 * ================
 * Widgets available in the widget library. Every widget renders BARE content
 * (no card chrome of its own) unless registered with `frame: false`, in which
 * case the board lets the component draw its own card.
 *
 * Hard rules:
 *   - Real data only. No demo/sample data (no-demo-data policy).
 *   - Read-only: these widgets must not trigger imports or provider fetches;
 *     they read stored data from the API.
 *   - Importing this module registers everything below (side-effect import).
 */
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../../core/api/client';
import { registerWidget } from '../../core/widget-registry';
import { timeAgo, formatNumber } from '../../core/format-utils';
import { normaliseAlert, ALERT_LEVEL_WEIGHT } from '../../core/alerts';
import MarketContextWidget from '../MarketContextWidget';
import LoopControls from '../LoopControls';

/* ── System Status (health + the automation loop) ─────────────────
 *
 * ⚠️ THE LOOP CONTROLS LIVE HERE NOW (owner, 2026-11-06): *"Merge `<div.lc-strip>` … so that widget
 * becomes system status with the control over the loop which is a key functionality."* They used to
 * render as a standalone strip above the board, which put the app's most consequential switch in a
 * band of its own and left it off every OTHER board (the Lab board, the screenshot cockpit) that has
 * this widget.
 *
 * ⚠️ ORDER IS DELIBERATE — loop first, health second. The loop is the thing that acts; the health
 * facts are the thing that explains why it cannot. A reader who scrolls no further than the tile's
 * first row still sees whether the loop is running.
 */
function SystemHealthWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ['wb-health'],
    queryFn: () => apiGet('/api/health').catch(() => null),
    refetchInterval: 30_000,
  });

  const health = isLoading ? (
    <p className="wb-muted">Loading…</p>
  ) : !data ? (
    <p className="wb-muted">Health unavailable.</p>
  ) : (
    <ul className="wb-facts">
      <li>
        <span>API</span>
        <strong className={data.status === 'ok' ? 'wb-pos' : 'wb-warn'}>{data.status || '—'}</strong>
      </li>
      <li>
        <span>Mode</span>
        <strong>{data.mode || '—'}</strong>
      </li>
      <li>
        <span>Database</span>
        <strong className={data.subsystems?.database?.status === 'ok' ? 'wb-pos' : 'wb-warn'}>
          {data.subsystems?.database?.status || '—'}
          {data.subsystems?.database?.latency != null ? ` · ${data.subsystems.database.latency}ms` : ''}
        </strong>
      </li>
      <li>
        <span>Queue</span>
        <strong>{data.subsystems?.queue?.status || '—'}</strong>
      </li>
      {Number(data.subsystems?.providers?.total ?? 0) > 0 && (
        <li>
          <span>Providers</span>
          <strong
            className={
              Number(data.subsystems.providers.healthy ?? 0) === Number(data.subsystems.providers.total)
                ? 'wb-pos'
                : 'wb-warn'
            }
          >
            {Number(data.subsystems.providers.healthy ?? 0)}/{Number(data.subsystems.providers.total)} healthy
          </strong>
        </li>
      )}
    </ul>
  );

  return (
    <>
      <LoopControls variant="embedded" />
      {health}
    </>
  );
}

/* ── Open Positions ────────────────────────────────────────────── */
function PositionsWidget() {
  // ⚠️ NO `.catch(() => ({ positions: [] }))` (#782). "No open positions." was printed for both a
  // genuinely flat book and a failed request — the same string for two opposite facts.
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['symbols-positions'],
    queryFn: () => apiGet('/api/symbols/positions'),
    refetchInterval: 60_000,
  });

  const rows = Array.isArray(data?.positions) ? data.positions : [];

  if (isLoading) return <p className="wb-muted">Loading…</p>;
  if (isError) {
    return (
      <p className="wb-muted">
        ⚠️ Positions unavailable — this is <strong>not</strong> a flat book.{' '}
        <button type="button" className="wb-retry" onClick={() => refetch()}>retry</button>
      </p>
    );
  }
  if (!rows.length) return <p className="wb-muted">No open positions.</p>;

  const withPnl = rows.filter((p) => typeof p.pnl === 'number');
  const totalPnl = withPnl.reduce((sum, p) => sum + p.pnl, 0);

  return (
    <>
      <div className="wb-stat">
        <span className="wb-stat-num">{rows.length}</span>
        <span className="wb-muted">open position{rows.length === 1 ? '' : 's'}</span>
        {withPnl.length > 0 && (
          <span className={`wb-stat-pnl ${totalPnl >= 0 ? 'wb-pos' : 'wb-neg'}`} title="Total P&L across stored positions">
            P&amp;L {totalPnl >= 0 ? '+' : ''}
            {totalPnl.toFixed(2)}
          </span>
        )}
      </div>
      <ul className="wb-list">
        {rows.slice(0, 6).map((p, i) => (
          <li key={p.symbol || i}>
            <span>{p.symbol || '—'}</span>
            <span className={typeof p.pnl === 'number' ? (p.pnl >= 0 ? 'wb-pos' : 'wb-neg') : 'wb-muted'}>
              {typeof p.pnl === 'number' ? `${p.pnl >= 0 ? '+' : ''}${p.pnl.toFixed(2)}` : '—'}
            </span>
          </li>
        ))}
      </ul>
      {rows.length > 6 && <p className="wb-muted wb-more">+{rows.length - 6} more</p>}
    </>
  );
}

/* ── Top Signals ───────────────────────────────────────────────── */
function TopSignalsWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ['wb-signals-best'],
    queryFn: () => apiGet('/api/signals/best').catch(() => null),
    refetchInterval: 60_000,
  });

  const envelopes = Array.isArray(data?.envelopes) ? data.envelopes : [];

  if (isLoading) return <p className="wb-muted">Loading…</p>;
  if (!envelopes.length) return <p className="wb-muted">No actionable signals.</p>;

  return (
    <ul className="wb-list">
      {envelopes.slice(0, 6).map((env, i) => {
        const strength = env.combinedStrength != null ? Math.round(env.combinedStrength) : null;
        return (
          <li key={`${env.symbol}-${env.protocolId || i}`}>
            <span>
              <strong>{env.symbol}</strong>
              <em className="wb-sub">{env.signal || ''}</em>
            </span>
            <span className={strength == null ? 'wb-muted' : ''}>{strength == null ? '—' : strength}</span>
          </li>
        );
      })}
    </ul>
  );
}

/* ── Automation Pulse ──────────────────────────────────────────
 * Reads /api/automation/status: loopEnabled, tickIntervalMs, activeStrategies,
 * globalRiskMultiplier, lastTickAt, brokerStates.
 *
 * ⚠️ CORRECTION (2026-09-22): this header previously claimed the field names were "verified
 * against the live response", including "brokerStates (per-broker positionCount)". That was
 * not true — `positionCount` did not exist on the payload at all, so the widget below read
 * `undefined` and the `|| 0` turned it into a permanent, confident `0`. A comment asserting a
 * verification that was never performed is worse than no comment: it is what stopped anyone
 * looking. `positionCount` is genuinely populated now (see BrokerLoopState in
 * automation-loop.service.ts) — null still means NOT MEASURED and must render as "?".
 */
function AutomationPulseWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ['wb-automation'],
    queryFn: () => apiGet('/api/automation/status').catch(() => null),
    refetchInterval: 30_000,
  });

  if (isLoading) return <p className="wb-muted">Loading…</p>;
  if (!data) return <p className="wb-muted">Automation status unavailable.</p>;

  // ⚠️ BOTS, not strategies (#878). `activeStrategies` is built server-side from
  // `tradingStrategy.findMany({ where: { active: true } })` — `trading_strategy` rows. The app
  // already uses "strategy" in three narrower senses, so labelling a bot count that way made the
  // number unreadable. The variable is named for what it holds.
  const bots = Array.isArray(data.activeStrategies) ? data.activeStrategies.length : 0;
  // null ≠ 0 — see the file header. Only total when every broker reported; otherwise the
  // honest answer is "unknown", because a partial sum understates and a 0 is a fabrication.
  const brokerStates = (data.brokerStates && typeof data.brokerStates === 'object')
    ? Object.values(data.brokerStates) : [];
  const counts = brokerStates.map((b) => b?.positionCount).filter((n) => typeof n === 'number');
  const positions = brokerStates.length > 0 && counts.length === brokerStates.length
    ? counts.reduce((sum, n) => sum + n, 0)
    : null;
  const tickMinutes = data.tickIntervalMs ? Math.round(data.tickIntervalMs / 60_000) : null;

  return (
    <ul className="wb-facts">
      <li>
        <span>Loop</span>
        <strong className={data.loopEnabled ? 'wb-pos' : 'wb-warn'}>
          {data.loopEnabled ? 'Running' : 'Paused'}
        </strong>
      </li>
      <li>
        <span>Bots</span>
        <strong>{bots}</strong>
      </li>
      <li>
        <span>Positions</span>
        <strong>{positions == null ? '?' : positions}</strong>
      </li>
      <li>
        <span>Risk mult.</span>
        <strong>{data.globalRiskMultiplier != null ? Number(data.globalRiskMultiplier).toFixed(2) : '—'}</strong>
      </li>
      <li>
        <span>Tick</span>
        <strong>{tickMinutes != null ? `${tickMinutes}m` : '—'}</strong>
      </li>
      <li>
        <span>Last tick</span>
        <strong>{data.lastTickAt ? timeAgo(data.lastTickAt) : '—'}</strong>
      </li>
    </ul>
  );
}

/* ── Active Alerts ─────────────────────────────────────────────
 * Reads /api/alerts/active (AlertTriggerService, polled every 60s, in-memory
 * capped list persisted to the `alert` table). Dismissed alerts are excluded;
 * acknowledged ones still show — acknowledged means the user has seen the
 * condition, not that it has cleared.
 *
 * ⚠️ Rows arrive in two column layouts (see src/core/alerts.js) — always read
 * through normaliseAlert(), never straight off `title`/`severity`.
 */
function ActiveAlertsWidget() {
  // ⚠️ NO `.catch(() => [])` (#782) — a failed request would render "No active alerts.", i.e. it would
  // quietly assert that nothing needs attention at the exact moment nothing could be checked.
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['wb-alerts'],
    queryFn: () => apiGet('/api/alerts/active'),
    refetchInterval: 60_000,
  });

  const rows = (Array.isArray(data) ? data : [])
    .filter((a) => !a.dismissed)
    .map(normaliseAlert);

  if (isLoading) return <p className="wb-muted">Loading…</p>;
  if (isError) {
    return (
      <p className="wb-muted">
        ⚠️ Alerts unavailable — this does not mean there are none.{' '}
        <button type="button" className="wb-retry" onClick={() => refetch()}>retry</button>
      </p>
    );
  }
  if (!rows.length) return <p className="wb-muted">No active alerts.</p>;

  const sorted = [...rows].sort(
    (a, b) => (ALERT_LEVEL_WEIGHT[b.level] || 0) - (ALERT_LEVEL_WEIGHT[a.level] || 0)
  );
  const urgent = rows.filter((a) => a.level === 'critical' || a.level === 'high').length;

  return (
    <>
      <div className="wb-stat">
        <span className="wb-stat-num">{rows.length}</span>
        <span className="wb-muted">active alert{rows.length === 1 ? '' : 's'}</span>
        {urgent > 0 && <span className="wb-stat-pnl wb-neg">{urgent} urgent</span>}
      </div>
      <ul className="wb-list wb-list--alerts">
        {sorted.slice(0, 5).map((a) => (
          <li key={a.id}>
            <span className={`wb-dot wb-dot--${a.level}`} aria-hidden="true" />
            <span className="wb-alert-title" title={a.message || a.title}>
              {a.title}
            </span>
            <span className="wb-muted wb-alert-age">{a.createdAt ? timeAgo(a.createdAt) : ''}</span>
          </li>
        ))}
      </ul>
      {rows.length > 5 && <p className="wb-muted wb-more">+{formatNumber(rows.length - 5)} more</p>}
    </>
  );
}

/* ── Protocol Readiness ────────────────────────────────────────
 * Reads /api/scoring/protocols. Fields verified live: name, active,
 * directiveCount, maxPossibleScore, lastRunAt, lastRunSymbols.
 */
function ProtocolsWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ['wb-protocols'],
    queryFn: () => apiGet('/api/scoring/protocols').catch(() => null),
    refetchInterval: 120_000,
  });

  const protocols = Array.isArray(data?.protocols) ? data.protocols : [];

  if (isLoading) return <p className="wb-muted">Loading…</p>;
  if (!protocols.length) return <p className="wb-muted">No protocols configured.</p>;

  const active = protocols.filter((p) => p.active);
  const ranked = [...active].sort((a, b) => (b.directiveCount || 0) - (a.directiveCount || 0));

  return (
    <>
      <div className="wb-stat">
        <span className="wb-stat-num">
          {active.length}
          <em className="wb-stat-of">/{protocols.length}</em>
        </span>
        <span className="wb-muted">protocols active</span>
      </div>
      <ul className="wb-list">
        {ranked.slice(0, 5).map((p) => (
          <li key={p.id}>
            <span title={p.description || p.name}>{p.name}</span>
            <span className="wb-muted">
              {p.directiveCount || 0} dir{p.lastRunAt ? ` · ${timeAgo(p.lastRunAt)}` : ''}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

/* ── Registration ──────────────────────────────────────────────── */
registerWidget({
  id: 'market-context',
  title: 'Market Context',
  icon: '🌐',
  category: 'Research',
  description: 'Day mood, active sessions and upcoming events.',
  frame: false, // draws its own card chrome
  size: { w: 4, h: 6, minW: 3, minH: 5 },
  Component: MarketContextWidget,
});

registerWidget({
  id: 'system-health',
  // ⚠️ TITLE CHANGED 2026-11-06 (owner): the tile now carries the automation loop's Start / Stop /
  // Run Now as well as the subsystem facts, so "System Health" described less than half of it.
  // ⚠️ THE ID IS UNCHANGED ON PURPOSE — a board stores `widgetId`, so renaming the id would orphan
  // every tile already placed and the `seeded` list would re-add it as if it were new.
  title: 'System Status',
  icon: '🩺',
  category: 'Status',
  description: 'Loop control (start, stop, run now) plus API, database, queue and provider health.',
  frame: true,
  // ⚠️ TALLER THAN THE OLD h=5 / minH=4 (2026-11-06), measured rather than guessed. The tile now
  // carries the loop strip AND the five subsystem facts: title bar 39px + strip 53px + facts 132px
  // + spacing = **218px** of content. At h=5 the body is 189px, so the last fact was clipped and the
  // tile body showed a scrollbar. h=7 gives a 268px tile / 229px body — the first height that fits.
  // ⚠️ At w=4 the strip wraps to two lines (83px, content 248px), so minH stays 7 and a 4-wide tile
  // wants one drag taller. Default width is 6 for that reason.
  size: { w: 6, h: 7, minW: 4, minH: 7 },
  Component: SystemHealthWidget,
});

registerWidget({
  id: 'positions',
  title: 'Open Positions',
  icon: '💼',
  category: 'Trading',
  description: 'Stored open positions with total P&L.',
  frame: true,
  size: { w: 4, h: 6, minW: 3, minH: 4 },
  Component: PositionsWidget,
});

registerWidget({
  id: 'top-signals',
  title: 'Top Signals',
  icon: '📡',
  category: 'Signals',
  description: 'Ranked actionable signal envelopes.',
  frame: true,
  size: { w: 4, h: 6, minW: 3, minH: 4 },
  Component: TopSignalsWidget,
});

registerWidget({
  id: 'automation',
  title: 'Automation Pulse',
  icon: '⚙️',
  category: 'Status',
  description: 'Loop state, strategies, positions and risk multiplier.',
  frame: true,
  size: { w: 4, h: 5, minW: 3, minH: 4 },
  Component: AutomationPulseWidget,
});

registerWidget({
  id: 'alerts',
  title: 'Active Alerts',
  icon: '🔔',
  category: 'Status',
  description: 'Non-dismissed alerts, highest severity first.',
  frame: true,
  size: { w: 5, h: 6, minW: 3, minH: 4 },
  Component: ActiveAlertsWidget,
});

registerWidget({
  id: 'protocols',
  title: 'Protocol Readiness',
  icon: '🧭',
  category: 'Signals',
  description: 'Active protocols and their directive counts.',
  frame: true,
  size: { w: 4, h: 5, minW: 3, minH: 4 },
  Component: ProtocolsWidget,
});
