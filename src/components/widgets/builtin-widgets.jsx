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

/* ── System Health ─────────────────────────────────────────────── */
function SystemHealthWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ['wb-health'],
    queryFn: () => apiGet('/api/health').catch(() => null),
    refetchInterval: 30_000,
  });

  if (isLoading) return <p className="wb-muted">Loading…</p>;
  if (!data) return <p className="wb-muted">Health unavailable.</p>;

  const db = data.subsystems?.database;
  const queue = data.subsystems?.queue;
  const providers = data.subsystems?.providers;
  const providerTotal = Number(providers?.total ?? (providers ? Object.keys(providers).length : 0));
  const providerHealthy = Number(providers?.healthy ?? 0);

  return (
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
        <strong className={db?.status === 'ok' ? 'wb-pos' : 'wb-warn'}>
          {db?.status || '—'}
          {db?.latency != null ? ` · ${db.latency}ms` : ''}
        </strong>
      </li>
      <li>
        <span>Queue</span>
        <strong>{queue?.status || '—'}</strong>
      </li>
      {providerTotal > 0 && (
        <li>
          <span>Providers</span>
          <strong className={providerHealthy === providerTotal ? 'wb-pos' : 'wb-warn'}>
            {providerHealthy}/{providerTotal} healthy
          </strong>
        </li>
      )}
    </ul>
  );
}

/* ── Open Positions ────────────────────────────────────────────── */
function PositionsWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ['symbols-positions'],
    queryFn: () => apiGet('/api/symbols/positions').catch(() => ({ positions: [] })),
    refetchInterval: 60_000,
  });

  const rows = Array.isArray(data?.positions) ? data.positions : [];

  if (isLoading) return <p className="wb-muted">Loading…</p>;
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

  const strategies = Array.isArray(data.activeStrategies) ? data.activeStrategies.length : 0;
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
        <span>Strategies</span>
        <strong>{strategies}</strong>
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
  const { data, isLoading } = useQuery({
    queryKey: ['wb-alerts'],
    queryFn: () => apiGet('/api/alerts/active').catch(() => []),
    refetchInterval: 60_000,
  });

  const rows = (Array.isArray(data) ? data : [])
    .filter((a) => !a.dismissed)
    .map(normaliseAlert);

  if (isLoading) return <p className="wb-muted">Loading…</p>;
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
  title: 'System Health',
  icon: '🩺',
  category: 'Status',
  description: 'API, database, queue and provider health.',
  frame: true,
  size: { w: 4, h: 5, minW: 3, minH: 4 },
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
