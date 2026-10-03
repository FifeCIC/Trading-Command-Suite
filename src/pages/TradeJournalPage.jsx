import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '../core/api/client';
import { normaliseAlert } from '../core/alerts';
import { formatDuration, timeAgo } from '../core/format-utils';
import { decisionScore } from '../core/decision-score';
import './trade-journal-page.css';
// ⚠️ RENAMED from execution-queue.css (2026-10-02). The Execution Queue page was DELETED — its
// Live Events feed moved here, its Protocol Queue tab to /protocols/protocol-queue and its Scheduled
// Jobs tab to /status/scheduled-jobs — so this stylesheet is now shared by three survivors and
// belongs to no single page. The name follows the mechanism, not the page that used to own it.
import './queue-ui.css';

/**
 * Map a Trade row (the app's own audit trail — /api/trading/trade-history)
 * to a journal entry. This is the DB-first source of truth: it includes
 * brokerTicket (64-bit MT5 ticket), origin (manual/bot/external), source
 * pipeline, and the real exit price + PnL from position reconciliation.
 */
/**
 * Close-reason labels — MIRROR of `nest/src/common/trading/close-reason.ts` (#916).
 *
 * The CODE is the stable identity (quote it in a bug report); the LABEL is for people. The TONE is
 * what this page exists to show: WHO closed the trade — a broker stop, the time stop, the app, or
 * the desktop terminal — because that is what explains an exit that beat or betrayed its plan.
 *
 * ⚠️ #916 (2026-10-02) — `broker:terminal` was labelled "Desktop terminal", which ASSERTS a human.
 * Measured, it is not one: the largest population behind that code arrives in batches of up to six
 * positions inside two seconds, with an EMPTY closing comment — and our own bridge stamps
 * `TCS:<origin>` on every close it sends, so an empty comment proves the close did NOT come from
 * us. The label now says what is true: the actor is not identified. **The previous wording is why
 * "something closes winners early" stayed unexplained for thirteen days — it read as an answer.**
 */
const CLOSE_REASON_META = {
  'system:time-stop':  { label: 'Time stop',        tone: 'system' },
  'system:reconciled': { label: 'Reconciled',       tone: 'system' },
  'user:manual':       { label: 'App close',        tone: 'app' },
  'broker:sl':         { label: 'Stop loss',        tone: 'sl' },
  'broker:tp':         { label: 'Take profit',      tone: 'tp' },
  'broker:terminal':   { label: 'Broker — actor unknown', tone: 'terminal' },
  'broker:stop-out':   { label: 'Margin stop-out',  tone: 'sl' },
  'broker:unknown':    { label: 'Not reported',     tone: 'unknown' },
};
const closeReasonMeta = (code) =>
  CLOSE_REASON_META[code] ?? { label: code || 'Not recorded', tone: 'unknown' };

function mapTradeToEntry(t) {
  const isOpen = t.status === 'open';
  return {
    id: t.id,
    symbol: t.symbol || '—',
    type: (t.side || 'buy').toLowerCase(),
    pnl: t.pnl ?? 0,
    volume: t.quantity || 0,
    entryPrice: t.entryPrice || 0,
    exitPrice: t.exitPrice ?? null,
    holdDuration: '—',
    date: (t.closedAt || t.openedAt || t.createdAt || new Date()).toString(),
    notes: t.brokerComment || '',
    tags: [],
    brokerTicket: t.brokerTicket || null,
    origin: t.origin || 'unknown',
    source: t.source || null,
    status: t.status,
    strategy: t.strategy || null,
    isOpen,
    /** #916 — WHO closed it (`broker:sl` | `broker:terminal` | `system:time-stop` | …). */
    closeReason: t.closeReason || null,
  };
}

// ── Activity events ─────────────────────────────────────────────────────
//
// ⚠️ ABSORBED from the Execution Queue's "Live Events" tab, 2026-10-02. That page was the ONLY
// surface that showed a BLOCKED signal — a symbol that was scored and then REFUSED. Deleting it
// without moving this feed would have removed the ability to see a refusal, which is precisely the
// case where nothing else in the app reports anything at all.
const STATUS_COLORS = {
  queued: '#f59e0b', running: '#3b82f6', complete: '#22c55e', failed: '#ef4444', cancelled: '#94a3b8',
  success: '#22c55e', error: '#ef4444', info: '#3b82f6', warning: '#f59e0b',
  EXECUTED: '#22c55e', FAILED: '#ef4444', SCORED: '#8b5cf6', SKIP: '#94a3b8', BLOCKED: '#ef4444',
  // #971 — an observation (no consumer). Same muted slate as SKIP: it states an absence of action,
  // and it must not read as a signal that did something.
  OBSERVED: '#94a3b8',
};

const EVENT_TYPE_STYLE = {
  automation: { bg: '#3b82f618', border: '#3b82f6', label: 'Tick', icon: '⟳' },
  decision: { bg: '#8b5cf618', border: '#8b5cf6', label: 'Decision', icon: '⚡' },
  protocol: { bg: '#f59e0b18', border: '#f59e0b', label: 'Protocol', icon: '🏗' },
};

/** One row of the absorbed Live Events feed. Markup unchanged from the Execution Queue page. */
function ActivityRow({ event }) {
  const style = EVENT_TYPE_STYLE[event.type] || EVENT_TYPE_STYLE.automation;
  const statusColor = STATUS_COLORS[event.status] || '#94a3b8';
  return (
    <div className="eq-event-row">
      <div className="eq-event-left" style={{ borderColor: style?.border }}>
        <span className="eq-event-type-badge" style={{ background: style?.bg, color: style?.border }}>
          {style?.icon} {style?.label}
        </span>
        <span className="eq-event-time">{timeAgo(event.timestamp)}</span>
        {event.symbol && <span className="eq-event-symbol">{event.symbol}</span>}
      </div>
      <div className="eq-event-main">
        <span className="eq-event-task">{event.taskName}</span>
        {event.detail && <span className="eq-event-detail">{event.detail}</span>}
      </div>
      <div className="eq-event-right">
        <span className="eq-event-status" style={{ color: statusColor, borderColor: statusColor }}>{event.status}</span>
        {event.durationMs > 0 && <span className="eq-event-dur">{formatDuration(event.durationMs)}</span>}
        {/* #909 — unit-aware score (raw / percentage / historical-untyped), or nothing at all. */}
        {decisionScore(event).text && (
          <span className="eq-event-composite" title={decisionScore(event).title || undefined}>{decisionScore(event).text}</span>
        )}
      </div>
    </div>
  );
}

// ── Alerts (absorbed from the deleted /automation/alert-center, 2026-10-02) ───────────
//
// ⚠️ THE PAGE BEING REPLACED NEVER PERSISTED "READ". It kept `readIds` in local useState, so every
// acknowledgement was thrown away on reload — while `POST /api/alerts/:id/acknowledge` had been
// DB-backed since 2026-09-23. This merge does NOT copy that defect: marking a row seen calls the
// endpoint. That is the owner's own instruction working as intended — "Treat compacted journal
// entries with an alert status attached as seen and the alert becomes seen."
const ALERT_LEVEL_SEVERITY = {
  critical: 'high', high: 'high', warning: 'medium', medium: 'medium', info: 'low', low: 'low',
};
const SEVERITY_COLORS = { high: '#ef4444', medium: '#f59e0b', low: '#64748b' };

/** Category → fallback route when an alert has no ticker and no link of its own. */
const ALERT_FALLBACKS = {
  // §9.14 — the Ladder is PREMIUM, so the free build is sent where a daily alert goes rather than to
  // a path that does not ship. The define folds at build time.
  signal: import.meta.env.VITE_EDITION === 'free' ? '/dashboard' : '/scoring/live-ordering-stack',
  drawdown: '/trading/portfolio-overview',
  system: '/status/setup',
  daily: '/dashboard',
};

/**
 * Compact CONSECUTIVE identical alerts into one row with a repeat count.
 *
 * ⚠️ This is the ONLY compaction that exists, and it is carried over rather than invented. The owner
 * said "There might need to be mechanism to compact related information" — that is a design question
 * (which alerts are 'related'?) and is NOT answered here. This does what the deleted page did.
 */
function compactAlerts(list) {
  const out = [];
  for (const a of list) {
    const key = `${a.category || ''}|${a.title || ''}|${a.message || ''}`;
    const prev = out[out.length - 1];
    if (prev && prev.key === key) { prev.count += 1; continue; }
    out.push({ ...a, key, count: 1 });
  }
  return out;
}

function AlertRow({ alert, onSeen, onOpen, acking }) {
  const sev = ALERT_LEVEL_SEVERITY[alert.level] || 'low';
  return (
    <div className="eq-event-row" style={{ borderLeft: `3px solid ${SEVERITY_COLORS[sev]}` }}>
      <div className="eq-event-left">
        <span className="eq-event-type-badge" style={{ background: SEVERITY_COLORS[sev] + '22', color: SEVERITY_COLORS[sev] }}>
          ⚑ {alert.category || 'alert'} · {sev}
        </span>
        <span className="eq-event-time">{timeAgo(alert.time || alert.timestamp)}</span>
      </div>
      <div className="eq-event-main" style={{ cursor: 'pointer' }} onClick={() => onOpen(alert)}>
        <span className="eq-event-task">{alert.title}</span>
        {alert.message && <span className="eq-event-detail">{alert.message}</span>}
        {alert.count > 1 && <span className="eq-event-dur">×{alert.count} consecutive</span>}
      </div>
      <div className="eq-event-right">
        <button
          className="tj-btn-ai"
          style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem' }}
          disabled={acking}
          onClick={() => onSeen(alert)}
        >
          {acking ? '…' : '✓ Seen'}
        </button>
      </div>
    </div>
  );
}

export default function TradeJournalPage() {
  const [analyzing, setAnalyzing] = useState(null);

  // ── DB-first: the app's own reconciled trade history ──
  const historyQuery = useQuery({
    queryKey: ['journal-trade-history'],
    queryFn: () => apiGet('/api/trading/trade-history?limit=500').catch(() => ({ trades: [] })),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const trades = historyQuery.data?.trades || [];
  const entries = useMemo(() => trades.map(mapTradeToEntry), [trades]);

  // ── Activity: the Live Events feed absorbed from the Execution Queue page (2026-10-02) ──
  const [view, setView] = useState('trades'); // trades | activity | all
  const [hideBlocked, setHideBlocked] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');

  const eventsQuery = useQuery({
    queryKey: ['journal-activity-events'],
    queryFn: () => apiGet('/api/automation/events?limit=100').catch(() => ({ events: [] })),
    refetchInterval: 5000,
  });
  const loopQuery = useQuery({
    queryKey: ['journal-automation-status'],
    queryFn: () => apiGet('/api/automation/status').catch(() => null),
    refetchInterval: 15_000,
  });

  const events = eventsQuery.data?.events || [];
  const loopStatus = loopQuery.data || null;
  const eventStats = { automation: 0, decision: 0, total: events.length };
  for (const e of events) eventStats[e.type] = (eventStats[e.type] || 0) + 1;

  // ⚠️ `hideBlocked` defaults OFF on purpose. BLOCKED is the most common refusal, and hiding it by
  // default would make the journal read as though everything executed. The owner asked for the
  // CONTROL ("Create controls for filtering journal entries including filter out BLOCKED signals"),
  // not for a different default.
  const activity = useMemo(() => events.filter((e) => {
    if (hideBlocked && e.status === 'BLOCKED') return false;
    if (statusFilter !== 'all' && e.status !== statusFilter) return false;
    return true;
  }), [events, hideBlocked, statusFilter]);

  // ── Alerts: the Alert Center's subject, absorbed 2026-10-02 ──
  const qc = useQueryClient();
  const navigate = useNavigate();
  const alertsQuery = useQuery({
    queryKey: ['journal-alerts'],
    queryFn: () => apiGet('/api/alerts/active').catch(() => []),
    staleTime: 10_000,
    refetchInterval: 30_000,
  });
  // The acknowledge call, NOT local state — see the note above AlertRow.
  const acknowledge = useMutation({
    mutationFn: (id) => apiPost(`/api/alerts/${id}/acknowledge`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['journal-alerts'] }),
  });

  const rawAlerts = useMemo(() => (alertsQuery.data || []).map(normaliseAlert), [alertsQuery.data]);
  const alerts = useMemo(() => compactAlerts(rawAlerts), [rawAlerts]);

  const openAlert = (alert) => {
    if (alert.ticker) navigate(`/research/symbol/${alert.ticker}`);
    else if (alert.link) window.location.href = alert.link;
    else if (ALERT_FALLBACKS[alert.category]) navigate(ALERT_FALLBACKS[alert.category]);
  };

  // ── Compute stats from real data ──
  const stats = useMemo(() => {
    if (entries.length === 0) return {};
    const closed = entries.filter(e => !e.isOpen);
    const wins = closed.filter(e => e.pnl > 0);
    const losses = closed.filter(e => e.pnl < 0);
    const totalPnl = closed.reduce((s, e) => s + e.pnl, 0);
    const winRate = closed.length > 0 ? ((wins.length / closed.length) * 100).toFixed(0) + '%' : '—';
    const avgWinPnl = wins.length > 0 ? (wins.reduce((s, e) => s + e.pnl, 0) / wins.length).toFixed(2) : '0';
    const avgLossPnl = losses.length > 0 ? Math.abs(losses.reduce((s, e) => s + e.pnl, 0) / losses.length).toFixed(2) : '0';

    // ── Realised payoff, in PERCENT OF PRICE (#916) ──
    // The journal used to report only dollar amounts. The number that decides whether a bot
    // deserves risk is the RATIO: measured 2026-09-20, 67.9% wins with a 0.448 payoff LOSES money
    // (break-even at that payoff needs 69.1%). Percent rather than dollars because it stays
    // comparable across symbols and position sizes. Requires BOTH prices — unpriced closes are
    // excluded and the sample size is reported so nobody over-reads it.
    const pctOf = (e) => (e.entryPrice > 0 && e.exitPrice != null
      ? ((e.exitPrice - e.entryPrice) / e.entryPrice) * 100 * (e.type === 'sell' ? -1 : 1)
      : null);
    const pricedPcts = closed.map(pctOf).filter((v) => v != null);
    const winPcts = pricedPcts.filter((v) => v > 0);
    const lossPcts = pricedPcts.filter((v) => v < 0);
    const avgWinPct = winPcts.length ? winPcts.reduce((s, v) => s + v, 0) / winPcts.length : null;
    const avgLossPct = lossPcts.length ? Math.abs(lossPcts.reduce((s, v) => s + v, 0) / lossPcts.length) : null;
    const payoff = avgWinPct && avgLossPct ? avgWinPct / avgLossPct : null;
    const winShare = pricedPcts.length ? winPcts.length / pricedPcts.length : 0;
    const expectancy = avgWinPct != null && avgLossPct != null
      ? winShare * avgWinPct - (1 - winShare) * avgLossPct
      : null;
    const byReason = {};
    closed.forEach((e) => { const k = closeReasonMeta(e.closeReason).label; byReason[k] = (byReason[k] || 0) + 1; });
    const reasonSummary = Object.entries(byReason).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(' · ');
    const byDay = {};
    closed.forEach(e => {
      const day = new Date(e.date).toLocaleDateString();
      byDay[day] = (byDay[day] || 0) + e.pnl;
    });
    const days = Object.entries(byDay).sort((a, b) => b[1] - a[1]);
    const bestDay = days[0]?.[0] || '—';
    const worstDay = days[days.length - 1]?.[0] || '—';
    return {
      totalTrades: entries.length, closedCount: closed.length, winRate, totalPnl, avgWinPnl, avgLossPnl,
      pricedCount: pricedPcts.length, avgWinPct, avgLossPct, payoff, expectancy, reasonSummary,
      bestDay, worstDay,
    };
  }, [entries]);

  const handleAnalyze = async (id) => {
    setAnalyzing(id);
    try {
      await apiPost('/api/journal/entries/analyze', { id });
    } catch { /* analysis endpoint may not exist yet */ }
    setAnalyzing(null);
  };

  const currencySymbol = '$'; // MT5 is USD-denominated

  return (
    <div className="tj-page">
      <header className="tj-header">
        <h2>Trade Journal</h2>
        <p>Reconciled trades from the app's own audit trail — includes externally-opened and manually-closed positions.</p>
        <p>Every closed trade now names <strong>who closed it</strong> — stop loss, take profit, time stop, the app, or the desktop terminal — taken from the broker's closing deal (#916).</p>
        <p className="tj-privacy">Source: <strong>database</strong> (live MT5 deals are shown on Trade History).</p>
      </header>

      {/* ── Primary Loop (absorbed from the Execution Queue's `.eq-routine`) ──
          ⚠️ `execution.willPlaceRealOrders` is the EFFECTIVE state and is kept verbatim, because the
          layer flag ALONE once showed "🟢 Trading" while every dispatch was being diverted to paper
          — which hid a months-long throughput collapse. The owner asked for "some of the stats"; the
          per-step tick sequence stays with the dashboard's automation controls. */}
      {loopStatus && (
        <section className="eq-routine">
          <div className="eq-routine-head">
            <span className={`eq-routine-dot ${loopStatus.loopEnabled ? 'eq-on' : 'eq-off'}`} />
            <strong>Primary Loop</strong>
            <span className="eq-routine-chip">⟳ every {loopStatus.tickIntervalMs ? formatDuration(loopStatus.tickIntervalMs) : '—'}</span>
            <span className="eq-routine-chip">Tick #{loopStatus.tickCount ?? 0}</span>
            <span className="eq-routine-chip">last tick {formatDuration(loopStatus.lastTickMs)}</span>
            <span className="eq-routine-chip">risk ×{loopStatus.globalRiskMultiplier ?? 1}</span>
            {loopStatus.execution && (
              <span
                className={`eq-routine-chip ${loopStatus.execution.willPlaceRealOrders ? 'eq-on' : 'eq-off'}`}
                title={`layer tradingEnabled=${loopStatus.execution.layerTradingEnabled}; brokers=${Object.entries(loopStatus.execution.brokerTradingEnabled || {}).map(([id, on]) => `${id}=${on}`).join(', ')}`}
              >
                {loopStatus.execution.willPlaceRealOrders ? '⚡ Real orders' : `🧾 ${loopStatus.execution.mode}`}
              </span>
            )}
          </div>
        </section>
      )}

      {stats.totalTrades > 0 && (
        <div className="tj-stats">
          <div className="tj-stat-card"><span className="tj-stat-num">{stats.totalTrades}</span><span>Total</span></div>
          <div className="tj-stat-card"><span className="tj-stat-num">{stats.closedCount}</span><span>Closed</span></div>
          <div className="tj-stat-card"><span className="tj-stat-num">{stats.winRate}</span><span>Win Rate</span></div>
          <div className="tj-stat-card"><span className={`tj-stat-num ${stats.totalPnl >= 0 ? 'tj-green' : 'tj-red'}`}>{stats.totalPnl >= 0 ? '+' : ''}{currencySymbol}{Math.abs(stats.totalPnl || 0).toFixed(2)}</span><span>Total P&amp;L</span></div>
          <div className="tj-stat-card"><span className="tj-stat-num tj-green">+{currencySymbol}{stats.avgWinPnl}</span><span>Avg Win</span></div>
          <div className="tj-stat-card"><span className="tj-stat-num tj-red">-{currencySymbol}{stats.avgLossPnl}</span><span>Avg Loss</span></div>
          {/* #916 — the payoff RATIO, not the win rate, decides whether a bot makes money. */}
          <div className="tj-stat-card" title={`Realised payoff = avg win % / avg loss %, measured on ${stats.pricedCount ?? 0} priced close(s). Below 1.0 needs a win rate above ~50% just to break even.`}>
            <span className={`tj-stat-num ${stats.payoff == null ? '' : stats.payoff >= 1 ? 'tj-green' : 'tj-red'}`}>{stats.payoff != null ? stats.payoff.toFixed(2) : '—'}</span>
            <span>Payoff</span>
          </div>
          <div className="tj-stat-card" title={`Expectancy per trade = (win share × avg win %) − (loss share × avg loss %), on the ${stats.pricedCount ?? 0} priced close(s) only.`}>
            <span className={`tj-stat-num ${stats.expectancy == null ? '' : stats.expectancy >= 0 ? 'tj-green' : 'tj-red'}`}>{stats.expectancy != null ? `${stats.expectancy >= 0 ? '+' : ''}${stats.expectancy.toFixed(3)}%` : '—'}</span>
            <span>Expectancy / trade</span>
          </div>
        </div>
      )}
      {stats.bestDay && (
        <div className="tj-ai-summary">
          <h3>Trade Summary</h3>
          <p><strong>Best day:</strong> {stats.bestDay} | <strong>Worst:</strong> {stats.worstDay}</p>
          {stats.reasonSummary && (
            <p><strong>Closed by:</strong> {stats.reasonSummary} — the actor, from the broker's closing deal (#916).</p>
          )}
        </div>
      )}
      {/* View switcher — the journal now carries TWO kinds of row: reconciled trades (its own data)
          and the activity feed absorbed from the Execution Queue. The owner's instruction was that
          this becomes "essentially a journal of most activity, even rejected trades". */}
      <div className="eq-tabs">
        <button className={`eq-tab ${view === 'trades' ? 'eq-tab-active' : ''}`} onClick={() => setView('trades')}>
          ▤ Trades <span className="eq-tab-count">{entries.length}</span>
        </button>
        <button className={`eq-tab ${view === 'activity' ? 'eq-tab-active' : ''}`} onClick={() => setView('activity')}>
          ⟳ Activity <span className="eq-tab-count">{events.length}</span>
        </button>
        <button className={`eq-tab ${view === 'alerts' ? 'eq-tab-active' : ''}`} onClick={() => setView('alerts')}>
          ⚑ Alerts <span className="eq-tab-count">{alerts.length}</span>
        </button>
        <button className={`eq-tab ${view === 'all' ? 'eq-tab-active' : ''}`} onClick={() => setView('all')}>
          ▤⟳ All
        </button>
      </div>

      {view !== 'trades' && (
        <div className="eq-event-stats">
          <span className="eq-event-stat-chip">⟳ Automation: <b>{eventStats.automation}</b></span>
          <span className="eq-event-stat-chip">⚡ Decisions: <b>{eventStats.decision}</b></span>
          <span className="eq-event-stat-chip">📋 Total: <b>{eventStats.total}</b></span>
          <label className="eq-event-stat-chip" style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={hideBlocked} onChange={(e) => setHideBlocked(e.target.checked)} /> Hide BLOCKED
          </label>
          <label className="eq-event-stat-chip">
            Status{' '}
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              {['all', 'EXECUTED', 'BLOCKED', 'SKIP', 'FAILED', 'SCORED', 'OBSERVED'].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
        </div>
      )}

      {/* ⚠️ The SAME loose-condition trap as the activity block, and the second half of the same
          measurement: `view !== 'activity'` was also true for 'alerts', so the Alerts tab rendered
          all 376 trade cards beneath 41 alerts. Each block now names the views it belongs to. */}
      {(view === 'trades' || view === 'all') && (
      <div className="tj-entries">
        {historyQuery.isLoading && <p>Loading trades from the audit trail...</p>}
        {!historyQuery.isLoading && entries.length === 0 && (
          <div className="tj-empty"><p>No trades recorded yet. The automation loop records every position it sees — open a position (via Signals, the bot, or directly in MT5) and it will appear here.</p></div>
        )}
        {entries.map((entry) => {
          const why = entry.isOpen ? null : closeReasonMeta(entry.closeReason);
          return (
          <div key={entry.id} className={`tj-card ${entry.isOpen ? 'tj-open' : entry.pnl >= 0 ? 'tj-win' : 'tj-loss'}`}>
            <div className="tj-card-header">
              <span className="tj-symbol">{entry.symbol}</span>
              <span className={`tj-type ${entry.type === 'buy' ? 'tj-buy' : 'tj-sell'}`}>{entry.type?.toUpperCase()}</span>
              {entry.brokerTicket && <span className="tj-ticket" title={`MT5 ticket #${entry.brokerTicket}`}>#{entry.brokerTicket}</span>}
              <span className={`tj-origin tj-origin-${entry.origin}`}>{entry.origin}</span>
              {why && (
                <span
                  className={`tj-closewhy tj-closewhy-${why.tone}`}
                  title={`closeReason = ${entry.closeReason}. 'Desktop terminal' means it was closed OUTSIDE the app (broker deal reason 0, empty comment); 'App close' and 'Time stop' are ours (#916).`}
                >
                  {why.label}
                </span>
              )}
              <span className={`tj-pnl ${entry.isOpen ? '' : entry.pnl >= 0 ? 'tj-green' : 'tj-red'}`}>{entry.isOpen ? 'OPEN' : entry.pnl >= 0 ? '+' : ''}{!entry.isOpen ? currencySymbol + Math.abs(entry.pnl).toFixed(2) : ''}</span>
            </div>
            <div className="tj-card-body">
              <div className="tj-details">
                <span>Vol: {entry.volume}</span><span>Entry: {currencySymbol}{Number(entry.entryPrice).toFixed(2)}</span>
                {entry.exitPrice != null && <span>Exit: {currencySymbol}{Number(entry.exitPrice).toFixed(2)}</span>}
                {entry.strategy && <span>Strategy: {entry.strategy}</span>}
                {why && <span>Closed by: {why.label}</span>}
                <span>{new Date(entry.date).toLocaleDateString()}</span>
              </div>
              {entry.tags && <div className="tj-tags">{entry.tags.map((tag) => <span key={tag} className="tj-tag">{tag}</span>)}</div>}
              {entry.notes && <p className="tj-note">{entry.notes}</p>}
            </div>
            <div className="tj-card-footer">
              <button className="tj-btn-ai" onClick={() => handleAnalyze(entry.id)} disabled={analyzing === entry.id}>
                {analyzing === entry.id ? 'Analyzing...' : 'AI Review'}
              </button>
              {entry.aiAnalysis && <div className="tj-analysis"><pre>{entry.aiAnalysis}</pre></div>}
            </div>
          </div>
          );
        })}
      </div>
      )}

      {/* ⚠️ `view === 'activity' || view === 'all'`, NOT `view !== 'trades'`. Measured: the loose
          form also rendered the activity feed on the ALERTS tab — 141 rows where 41 were expected
          (100 events + 41 alerts) — because 'alerts' is neither 'trades' nor 'activity'. */}
      {(view === 'activity' || view === 'all') && (
        <div className="tj-entries">
          {eventsQuery.isLoading && <p>Loading activity...</p>}
          {!eventsQuery.isLoading && activity.length === 0 && (
            <div className="tj-empty">
              <p>{events.length === 0 ? 'No activity logged yet.' : 'No activity matches the current filter.'}</p>
            </div>
          )}
          {activity.map((event) => <ActivityRow key={event.id} event={event} />)}
        </div>
      )}

      {/* Alerts — shown for the Alerts tab and for All. ⚠️ A refreshed list losing rows is the
          ACKNOWLEDGE taking effect, not a fetch error: the endpoint removes the alert from
          /api/alerts/active, which is the behaviour the owner described. */}
      {(view === 'alerts' || view === 'all') && (
        <div className="tj-entries">
          {alertsQuery.isLoading && <p>Loading alerts...</p>}
          {!alertsQuery.isLoading && alerts.length === 0 && (
            <div className="tj-empty"><p>No active alerts.</p></div>
          )}
          {alerts.map((alert) => (
            <AlertRow
              key={alert.id || alert.key}
              alert={alert}
              acking={acknowledge.isPending && acknowledge.variables === alert.id}
              onSeen={(a) => a.id && acknowledge.mutate(a.id)}
              onOpen={openAlert}
            />
          ))}
        </div>
      )}
    </div>
  );
}
