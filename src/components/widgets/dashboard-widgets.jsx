/**
 * Dashboard widgets
 * =================
 * The cards that used to be hard-coded in `DashboardPage.jsx`, extracted into
 * standalone components so they can be placed on any board (epic #746).
 *
 * Notes for anyone editing these:
 *   - Each widget owns its own queries. Query keys are deliberately the SAME as
 *     the ones the old page used (`dash-*`), so several widgets sharing a source
 *     (portfolio / P&L / worst-case all read MT5 positions) collapse into one
 *     request via React Query's cache.
 *   - Widgets render BARE content — the board supplies the tile chrome, so no
 *     `dash-card` wrapper and no `<h3>`.
 *   - The `dash-*` classes live in `src/pages/home-dashboard.css`, which stays in
 *     the bundle because `DashboardPage` imports it.
 *   - Real data only; every source is an existing read-only endpoint.
 */
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiGet } from '../../core/api/client';
import { registerWidget } from '../../core/widget-registry';
import { signalColor } from '../../core/signal-utils';

/** MT5 bridge diagnostics — connection, balance, equity. */
const useMt5Diag = () =>
  useQuery({
    queryKey: ['dash-diag'],
    queryFn: () => apiGet('/api/providers/mt5/diagnostics').catch(() => null),
    refetchInterval: 30_000,
  }).data || {};

/** Live MT5 positions (broker truth, not the stored Position table). */
function useMt5Positions(enabled = true) {
  return useQuery({
    queryKey: ['dash-positions'],
    queryFn: () => apiGet('/api/providers/mt5/positions').catch(() => ({ positions: [] })),
    refetchInterval: 30_000,
    enabled,
  }).data?.positions || [];
}

function useT212() {
  return useQuery({
    queryKey: ['dash-t212'],
    queryFn: () => apiGet('/api/portfolio?source=trading212').catch(() => ({ positions: [] })),
    refetchInterval: 60_000,
    staleTime: 30_000,
  }).data || {};
}

function useIsa() {
  return useQuery({
    queryKey: ['dash-isa'],
    queryFn: () => apiGet('/api/isa/dashboard').catch(() => ({})),
    refetchInterval: 60_000,
    staleTime: 30_000,
  }).data || {};
}

/** Per-broker rollup — shared by the portfolio, P&L and worst-case widgets. */
function useBrokerRollup() {
  const diag = useMt5Diag();
  const mt5Connected = diag.connected === true;
  const positions = useMt5Positions(mt5Connected);
  const t212 = useT212();
  const isaData = useIsa();

  const t212Positions = t212.positions || [];
  const t212Account = t212.account || {};
  const isaSummary = isaData.summary || {};

  const count = (list, key) => ({
    winners: list.filter((p) => (p[key] || 0) > 0).length,
    losers: list.filter((p) => (p[key] || 0) < 0).length,
  });
  const sum = (list, key) => list.reduce((total, p) => total + (p[key] || 0), 0);

  const mt5 = {
    pnl: sum(positions, 'profit'),
    ...count(positions, 'profit'),
    count: positions.length,
    balance: diag.balance ?? 0,
    equity: diag.equity ?? 0,
  };
  const t212Row = {
    pnl: sum(t212Positions, 'pnl'),
    ...count(t212Positions, 'pnl'),
    count: t212Positions.length,
    balance: t212Account.balance,
    equity: t212Account.equity,
  };
  const isa = {
    pnl: isaSummary.totalPnl !== undefined ? isaSummary.totalPnl : (isaSummary.unrealizedPnl || 0),
    value: isaSummary.totalValueGbp || 0,
    count: isaSummary.positionCount || 0,
  };

  return {
    diag,
    mt5Connected,
    positions,
    mt5,
    t212: t212Row,
    isa,
    // ISA accounts are always live; T212 reports its own mode.
    t212Mode: (t212.mode || 'demo') === 'live' ? 'live' : 'practice',
    total: mt5.pnl + t212Row.pnl + isa.pnl,
  };
}

const money = (value, symbol = '$') =>
  typeof value === 'number' ? `${symbol}${value.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '—';

const signed = (value) => `${value >= 0 ? '+' : ''}${(value || 0).toFixed(2)}`;

/* ── MT5 Portfolio Summary ───────────────────────────────────── */
function Mt5PortfolioWidget() {
  const { diag, mt5Connected, mt5 } = useBrokerRollup();
  return (
    <div className="dash-card-stats">
      <div className="dash-stat">
        <span className="dash-stat-label">MT5 Bridge</span>
        <span className={`dash-stat-value ${mt5Connected ? 'ok' : 'err'}`}>
          {mt5Connected ? 'Connected' : 'Offline'}
        </span>
      </div>
      <div className="dash-stat">
        <span className="dash-stat-label">Balance</span>
        <span className="dash-stat-value ok">{money(diag.balance ?? 0)}</span>
      </div>
      <div className="dash-stat">
        <span className="dash-stat-label">Equity</span>
        <span className="dash-stat-value ok">{money(diag.equity ?? 0)}</span>
      </div>
      <div className="dash-stat">
        <span className="dash-stat-label">Open Positions</span>
        <span className="dash-stat-value">{mt5.count}</span>
      </div>
      <div className="dash-stat">
        <span className="dash-stat-label">Unrealized P&amp;L</span>
        <span className={`dash-stat-value ${mt5.pnl >= 0 ? 'ok' : 'err'}`}>{signed(mt5.pnl)}</span>
      </div>
    </div>
  );
}

/* ── P&L by Broker ───────────────────────────────────────────── */
function BrokerPnlRow({ icon, name, badge, badgeClass, metrics }) {
  return (
    <div className="dash-broker-row">
      <div className="dash-broker-head">
        <span className="dash-broker-icon">{icon}</span>
        <span className="dash-broker-name">{name}</span>
        {badge && <span className={`dash-broker-badge ${badgeClass}`}>{badge}</span>}
      </div>
      <div className="dash-broker-metrics">
        {metrics.map((m) => (
          <div key={m.label} className="dash-broker-metric">
            <span className="dash-broker-mlabel">{m.label}</span>
            <span className={`dash-broker-mval ${m.tone || ''}`}>{m.value}</span>
            {m.sub && <span className="dash-broker-sub">{m.sub}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function BrokerPnlWidget() {
  const { mt5Connected, mt5, t212, isa, t212Mode, total } = useBrokerRollup();
  const showMt5 = mt5.pnl !== 0 || mt5Connected;
  const showT212 = t212.pnl !== 0 || t212Mode === 'live';

  return (
    <div className="dash-broker-grid">
      {showMt5 && (
        <BrokerPnlRow
          icon="📡"
          name="MetaQuotes (MT5)"
          badge={mt5Connected ? 'PRACTICE' : 'OFFLINE'}
          badgeClass={mt5Connected ? 'badge-practice' : 'badge-off'}
          metrics={[
            { label: 'Balance', value: money(mt5.balance) },
            { label: 'Equity', value: money(mt5.equity) },
            { label: 'Positions', value: mt5.count },
            {
              label: 'P&L',
              value: signed(mt5.pnl),
              tone: mt5.pnl >= 0 ? 'ok' : 'err',
              sub: `${mt5.winners}W / ${mt5.losers}L`,
            },
          ]}
        />
      )}
      {showT212 && (
        <BrokerPnlRow
          icon="🏦"
          name="Trading212"
          badge={t212Mode === 'live' ? 'LIVE' : 'PRACTICE'}
          badgeClass={t212Mode === 'live' ? 'badge-live' : 'badge-practice'}
          metrics={[
            { label: 'Balance', value: money(t212.balance) },
            { label: 'Equity', value: money(t212.equity) },
            { label: 'Positions', value: t212.count },
            {
              label: 'P&L',
              value: signed(t212.pnl),
              tone: t212.pnl >= 0 ? 'ok' : 'err',
              sub: `${t212.winners}W / ${t212.losers}L`,
            },
          ]}
        />
      )}
      <BrokerPnlRow
        icon="🏛️"
        name="Trading212 Stocks ISA"
        badge="LIVE"
        badgeClass="badge-live"
        metrics={[
          { label: 'Value', value: isa.value > 0 ? money(isa.value, '£') : '—' },
          { label: 'Positions', value: isa.count },
          { label: 'P&L', value: signed(isa.pnl), tone: isa.pnl >= 0 ? 'ok' : 'err' },
        ]}
      />
      <div className="dash-broker-row dash-broker-total">
        <div className="dash-broker-head">
          <span className="dash-broker-name">All Brokers</span>
        </div>
        <div className="dash-broker-metrics">
          <div className="dash-broker-metric">
            <span className="dash-broker-mlabel">Total P&amp;L</span>
            <span className={`dash-broker-mval dash-broker-total-val ${total >= 0 ? 'ok' : 'err'}`}>
              {signed(total)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Diversification ─────────────────────────────────────────── */
function DiversificationWidget() {
  const { data } = useQuery({
    queryKey: ['dash-diversification'],
    queryFn: () => apiGet('/api/diversification/summary').catch(() => null),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const summary = data || {};
  const dupes = summary.crossBrokerDuplicates || [];
  const warnings = summary.warnings || [];
  const mode = (summary.settings || {})['diversification.mode'] || 'warn';

  if (!data) return <p className="dash-hint">Diversification summary unavailable.</p>;

  return (
    <>
      <p className="dash-hint" style={{ marginTop: 0 }}>
        Mode:{' '}
        <span className={`dash-div-mode-badge ${mode === 'strict' ? 'mode-strict' : mode === 'warn' ? 'mode-warn' : 'mode-off'}`}>
          {mode.toUpperCase()}
        </span>
      </p>
      {dupes.length > 0 ? (
        <div className="dash-div-dupes">
          <p className="dash-div-warn">⚠️ {dupes.length} symbol(s) held across multiple brokers:</p>
          {dupes.map((d) => (
            <div key={d.symbol} className="dash-div-dupe-row">
              <span className="dash-div-dupe-symbol">{d.symbol}</span>
              <span className="dash-div-dupe-brokers">{d.brokers.join(' + ')}</span>
              <span className="dash-div-dupe-val">
                £{d.totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="dash-div-clean">✅ No cross-broker duplicates — good diversification.</p>
      )}
      {warnings.slice(0, 2).map((w, i) => (
        <p key={i} className="dash-div-warn-msg">⚠️ {w}</p>
      ))}
      <a href="/planner/allocator" className="dash-div-link">View Strategy Allocator →</a>
    </>
  );
}

/* ── Open Positions (live MT5) ───────────────────────────────── */
function Mt5PositionsWidget() {
  const navigate = useNavigate();
  const { mt5Connected, positions } = useBrokerRollup();
  const count = positions.length;

  if (!mt5Connected) return <p className="dash-hint">MT5 bridge offline — connect to see positions.</p>;
  if (count === 0) return <p className="dash-hint">No open positions.</p>;

  return (
    <>
      <div className="dash-table-wrap">
        <table className="dash-table">
          <thead>
            <tr><th>Symbol</th><th>Type</th><th>Vol</th><th>Open</th><th>Current</th><th>P&amp;L</th></tr>
          </thead>
          <tbody>
            {positions.slice(0, 5).map((p) => (
              <tr key={p.ticket}>
                <td><strong>{p.symbol}</strong></td>
                <td className={p.type === 'buy' ? 'dash-buy' : 'dash-sell'}>{p.type?.toUpperCase()}</td>
                <td>{p.volume}</td>
                <td>{p.priceOpen?.toFixed(2)}</td>
                <td>{p.priceCurrent?.toFixed(2)}</td>
                <td className={p.profit >= 0 ? 'dash-profit' : 'dash-loss'}>{signed(p.profit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {count > 5 && (
        <p className="dash-hint">
          +{count - 5} more —{' '}
          <button className="dash-link" onClick={() => navigate('/trading/positions-monitor')}>view all</button>
        </p>
      )}
    </>
  );
}

/* ── Recent Trades ───────────────────────────────────────────── */
function RecentTradesWidget() {
  const { mt5Connected } = useBrokerRollup();
  const { data } = useQuery({
    queryKey: ['dash-history'],
    queryFn: () => apiGet('/api/providers/mt5/history?limit=5').catch(() => ({ deals: [] })),
    refetchInterval: 60_000,
    staleTime: 30_000,
    enabled: mt5Connected,
  });
  const trades = data?.deals || (Array.isArray(data) ? data : []);

  if (!mt5Connected) return <p className="dash-hint">MT5 bridge offline.</p>;
  if (!trades.length) return <p className="dash-hint">No recent trades.</p>;

  return (
    <div className="dash-table-wrap">
      <table className="dash-table">
        <thead>
          <tr><th>Symbol</th><th>Type</th><th>Vol</th><th>Price</th><th>P&amp;L</th><th>Time</th></tr>
        </thead>
        <tbody>
          {trades.slice(0, 5).map((t, i) => (
            <tr key={t.ticket || i}>
              <td><strong>{t.symbol}</strong></td>
              <td className={String(t.type).toLowerCase() === 'buy' ? 'dash-buy' : 'dash-sell'}>
                {(t.type || '').toUpperCase()}
              </td>
              <td>{t.volume}</td>
              <td>{t.price?.toFixed(2) || '—'}</td>
              <td className={(t.profit || 0) >= 0 ? 'dash-profit' : 'dash-loss'}>{signed(t.profit)}</td>
              <td className="dash-time">{t.time ? new Date(t.time).toLocaleTimeString() : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Worst-Case Monitor ──────────────────────────────────────── */
function WorstCaseWidget() {
  const { positions } = useBrokerRollup();
  const losers = positions.filter((p) => (p.profit || 0) < 0);
  const worst = [...positions].sort((a, b) => (a.profit || 0) - (b.profit || 0))[0];

  if (!worst || (worst.profit || 0) >= 0) return <p className="dash-hint">No losing positions — nothing at risk.</p>;

  const totalLoss = losers.reduce((sum, p) => sum + (p.profit || 0), 0);
  return (
    <div className="dash-card-stats">
      <div className="dash-stat">
        <span className="dash-stat-label">Biggest Loser</span>
        <span className="dash-stat-value err">{worst.symbol} {worst.profit?.toFixed(2)}</span>
      </div>
      <div className="dash-stat">
        <span className="dash-stat-label">Losing Positions</span>
        <span className="dash-stat-value err">{losers.length} of {positions.length}</span>
      </div>
      <div className="dash-stat">
        <span className="dash-stat-label">Total at Risk</span>
        <span className="dash-stat-value err">{totalLoss.toFixed(2)}</span>
      </div>
    </div>
  );
}

/* ── Market Sessions ─────────────────────────────────────────── */
const SESSIONS = [
  { label: 'London', open: 8, close: 16, tz: 'GMT/BST', offset: 1 },
  { label: 'New York', open: 9, close: 16, tz: 'ET', offset: -4 },
  { label: 'Tokyo', open: 9, close: 15, tz: 'JST', offset: 9 },
];

function MarketSessionsWidget() {
  const now = new Date();
  const utc = now.getUTCHours();
  const utcMin = now.getUTCMinutes();

  return (
    <div className="dash-sessions">
      {SESSIONS.map((s) => {
        const local = (utc + s.offset + 24) % 24;
        const isOpen = local >= s.open && local < s.close;
        const nowTotalMin = local * 60 + utcMin;
        const openTotalMin = s.open * 60;
        const closeTotalMin = s.close * 60;
        const nextMins = isOpen
          ? closeTotalMin - nowTotalMin
          : (nowTotalMin < openTotalMin ? openTotalMin - nowTotalMin : 24 * 60 - nowTotalMin + openTotalMin);
        const nextStr = `${Math.floor(nextMins / 60)}h ${nextMins % 60}m`;
        return (
          <div
            key={s.label}
            className={`dash-session ${isOpen ? 'dash-session-open' : 'dash-session-closed'} dash-session-hoverable`}
          >
            <span className={`dash-session-dot ${isOpen ? 'dash-session-dot-open' : 'dash-session-dot-closed'}`} />
            <span>{s.label}</span>
            <span className="dash-session-status">{isOpen ? 'Open' : 'Closed'}</span>
            <div className="dash-session-popover">
              <div className="dash-session-pop-title">{s.label} — {isOpen ? 'Open' : 'Closed'}</div>
              <div className="dash-session-pop-row">
                <span>Hours</span>
                <span>{String(s.open).padStart(2, '0')}:00–{String(s.close).padStart(2, '0')}:00 ({s.tz})</span>
              </div>
              <div className="dash-session-pop-row">
                <span>GMT Offset</span>
                <span>{s.offset >= 0 ? `+${s.offset}` : s.offset}</span>
              </div>
              <div className="dash-session-pop-row">
                <span>{isOpen ? 'Closes in' : 'Opens in'}</span>
                <span>{nextStr}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── News & Sentiment sources ──────────────────────────────────
 * ⚠️ The card this came from hard-coded `['finnhub', 'fmp']` as the source
 * keys, but `/api/news/counts` keys `counts` by PROVIDER NAME
 * (`{SeekingAlpha, Yahoo, Benzinga, ChartMill, CNBC, Fintel}`). The lookup never
 * matched, so the dashboard reported "0 sources" and "Unverified" while 3,614
 * articles existed. Derive the rows from the response instead.
 */
function NewsSourcesWidget() {
  const { data } = useQuery({
    queryKey: ['dash-news-counts'],
    queryFn: () => apiGet('/api/news/counts').catch(() => null),
    refetchInterval: 120_000,
    staleTime: 60_000,
  });

  if (!data) return <p className="dash-hint">News counts unavailable.</p>;

  const counts = data.counts || {};
  const total = data.total || 0;
  const rows = Object.entries(counts)
    .map(([name, count]) => ({ name, count: Number(count) || 0 }))
    .sort((a, b) => b.count - a.count);
  const active = rows.filter((r) => r.count > 0).length;
  const unverified = rows.length - active;

  if (!rows.length) return <p className="dash-hint">No news sources configured.</p>;

  return (
    <div className="dash-news-list">
      {rows.map((r) => (
        <div key={r.name} className="dash-news-row">
          <span className={`dash-news-dot ${r.count > 0 ? 'dash-news-dot-active' : 'dash-news-dot-muted'}`}>
            {r.count > 0 ? '●' : '◐'}
          </span>
          <span className="dash-news-name">{r.name}</span>
          <span className={`dash-news-status ${r.count > 0 ? 'dash-news-dot-active' : 'dash-news-dot-muted'}`}>
            {r.count > 0 ? `${r.count.toLocaleString()} articles` : 'Unverified'}
          </span>
        </div>
      ))}
      <p className="dash-news-summary">
        {total > 0
          ? `${total.toLocaleString()} total articles across ${active} source${active === 1 ? '' : 's'}`
          : 'No articles imported yet'}
        {unverified > 0 && total > 0 && ` · ${unverified} source${unverified === 1 ? '' : 's'} unverified`}
      </p>
    </div>
  );
}

/* ── Hot Picks ───────────────────────────────────────────────── */
function HotPicksWidget() {
  const navigate = useNavigate();
  const { data, isFetching } = useQuery({
    queryKey: ['dash-hot-picks'],
    queryFn: () => apiGet('/api/scoring/ranked?limit=5'),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const picks = data?.ranked ?? [];

  if (!picks.length) return <p className="dash-hint">Waiting for scoring data…</p>;

  return (
    <>
      <div className="dash-hp-list">
        {picks.slice(0, 5).map((pick, i) => (
          <a
            key={pick.symbolId}
            href={`/research/symbol/${pick.ticker}`}
            className="dash-hp-item"
            onClick={(e) => { e.preventDefault(); navigate(`/research/symbol/${pick.ticker}`); }}
          >
            <span className="dash-hp-rank">#{i + 1}</span>
            <span className="dash-hp-ticker">{pick.ticker}</span>
            <span className="dash-hp-signal">
              {pick.signal === 'entry' ? '🎯' : pick.signal === 'watch' ? '👁' : '—'}
            </span>
            {/* Colour = the SERVER's classification (`pick.signal`), not a remembered 0-100 bar.
                Measured 2026-09-20: ranked `score` is 29-57 — a display number with no owning bar,
                and the client never re-derives a classification from a number (#847). */}
            <span className="dash-hp-score" style={{ color: signalColor(pick.signal) }}>{pick.score}</span>
          </a>
        ))}
      </div>
      <button className="dash-hp-link" onClick={() => navigate('/lab/hot-stock-picks')}>
        View all picks{isFetching ? ' ⟳' : ''} →
      </button>
    </>
  );
}

/* ── Registration ────────────────────────────────────────────── */
registerWidget({
  id: 'mt5-portfolio',
  title: 'MT5 Portfolio',
  icon: '📊',
  category: 'Trading',
  description: 'Bridge state, balance, equity, open positions and unrealized P&L.',
  frame: true,
  size: { w: 6, h: 4, minW: 4, minH: 3 },
  Component: Mt5PortfolioWidget,
});

registerWidget({
  id: 'broker-pnl',
  title: 'P&L by Broker',
  icon: '💼',
  category: 'Trading',
  description: 'MT5, Trading212 and ISA performance side by side, plus the total.',
  frame: true,
  size: { w: 6, h: 6, minW: 4, minH: 4 },
  Component: BrokerPnlWidget,
});

registerWidget({
  id: 'diversification',
  title: 'Diversification',
  icon: '🌐',
  category: 'Risk',
  description: 'Cross-broker duplicates and diversification warnings.',
  frame: true,
  size: { w: 4, h: 6, minW: 3, minH: 4 },
  Component: DiversificationWidget,
});

registerWidget({
  id: 'mt5-positions',
  title: 'Open Positions (live)',
  icon: '📈',
  category: 'Trading',
  description: 'Live MT5 positions from the broker bridge.',
  frame: true,
  size: { w: 6, h: 6, minW: 4, minH: 4 },
  Component: Mt5PositionsWidget,
});

registerWidget({
  id: 'recent-trades',
  title: 'Recent Trades',
  icon: '🔄',
  category: 'Trading',
  description: 'Last five closed MT5 deals.',
  frame: true,
  size: { w: 6, h: 6, minW: 4, minH: 4 },
  Component: RecentTradesWidget,
});

registerWidget({
  id: 'worst-case',
  title: 'Worst-Case Monitor',
  icon: '⚠️',
  category: 'Risk',
  description: 'Biggest loser, count of losing positions and total at risk.',
  frame: true,
  size: { w: 4, h: 4, minW: 3, minH: 3 },
  Component: WorstCaseWidget,
});

registerWidget({
  id: 'market-sessions',
  title: 'Market Sessions',
  icon: '🌍',
  category: 'Research',
  description: 'London, New York and Tokyo open/closed with time to next change.',
  frame: true,
  size: { w: 4, h: 5, minW: 3, minH: 4 },
  Component: MarketSessionsWidget,
});

registerWidget({
  id: 'news-sources',
  title: 'News Sources',
  icon: '📰',
  category: 'Research',
  description: 'Article counts per news provider, and unverified sources.',
  frame: true,
  size: { w: 4, h: 4, minW: 3, minH: 3 },
  Component: NewsSourcesWidget,
});

registerWidget({
  id: 'hot-picks',
  title: 'Hot Picks',
  icon: '🔥',
  category: 'Signals',
  description: 'Top ranked symbols from the scoring engine.',
  frame: true,
  size: { w: 4, h: 6, minW: 3, minH: 4 },
  Component: HotPicksWidget,
});
