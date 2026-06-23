import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import OrderModal from '../components/OrderModal';

// ── Available data sources ──────────────────────────────────
const PLATFORMS_DEMO_LIVE = [
  { id: 'trading212-demo', label: 'T212 Demo', provider: 'trading212', mode: 'demo' },
  { id: 'trading212-live', label: 'T212 Live', provider: 'trading212', mode: 'live' },
  { id: 'mt5', label: 'MT5' },
  { id: 'alpaca', label: 'Alpaca' },
  { id: 'all', label: 'All Platforms' },
];

// ── Allocation Bar ──────────────────────────────────────────
function AllocationBar({ positions, total }) {
  const colors = ['#00a63e', '#0ea5a6', '#8f7dff', '#ffb347', '#ff6b6b'];
  return (
    <div className="pf-alloc-bar">
      {positions.map((p, i) => {
        const pct = total > 0 ? (p.value / total * 100) : 0;
        return (
          <motion.div
            key={p.symbol}
            className="pf-alloc-seg"
            initial={{ flex: 0 }}
            animate={{ flex: p.allocation }}
            transition={{ duration: 0.5, delay: i * 0.06, ease: 'easeOut' }}
            style={{ background: colors[i % colors.length] }}
            title={`${p.symbol}: ${pct.toFixed(1)}%`}
          >
            {pct > 8 && <span>{p.symbol}</span>}
          </motion.div>
        );
      })}
    </div>
  );
}

// ── Unavailable Notice ──────────────────────────────────────
function UnavailableNotice({ reason, source, onRefresh }) {
  const notices = {
    no_key: {
      title: 'Trading212 API Key Required',
      body: 'Set TRADING212_API_KEY and TRADING212_API_SECRET in your .env file to connect your Trading212 account.',
      help: 'See SETUP.md for API key configuration instructions.',
    },
    no_connection: {
      title: 'Cannot Reach Trading212',
      body: 'The API returned an error or could not be reached. Check your internet connection and API key.',
    },
    no_positions: {
      title: 'No Open Positions',
      body: source === 'trading212'
        ? 'Your Trading212 account has no open positions.'
        : source === 'mt5'
          ? 'MT5 integration is pending. Switch to Trading212 for live portfolio data.'
          : 'No positions available from the selected source.',
    },
    not_implemented: {
      title: `${source === 'mt5' ? 'MT5' : source === 'alpaca' ? 'Alpaca' : 'This source'} Not Yet Available`,
      body: `Portfolio data from ${source === 'mt5' ? 'MT5' : source === 'alpaca' ? 'Alpaca' : 'this source'} is not yet implemented. Switch to Trading212 for live data.`,
    },
  };

  const n = notices[reason] || notices.no_connection;

  return (
    <div className="pf-unavailable">
      <h2>{n.title}</h2>
      <p>{n.body}</p>
      {n.help && <p className="pf-hint">{n.help}</p>}
      {onRefresh && (
        <button className="pf-refresh-btn" onClick={onRefresh} style={{ marginTop: '0.5rem' }}>
          ↻ Retry
        </button>
      )}
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────
export default function PortfolioPage() {
  const [source, setSource] = useState('trading212-demo');
  const [sellPosition, setSellPosition] = useState(null);
  const [adapterMode, setAdapterMode] = useState('demo');
  const [lastUpdated, setLastUpdated] = useState(null);
  const [refreshCooldown, setRefreshCooldown] = useState(0);
  const [t212Mode, setT212Mode] = useState(null);

  // Fetch T212 mode on mount
  useEffect(() => {
    apiGet('/api/portfolio/trading212/mode')
      .then(d => setT212Mode(d))
      .catch(() => setT212Mode({ current: 'unknown' }));
  }, []);

  // Resolve current platform config
  const currentPlatform = PLATFORMS_DEMO_LIVE.find(p => p.id === source) || {};
  const isT212 = currentPlatform.provider === 'trading212';
  const currentT212Mode = isT212 ? currentPlatform.mode : null;

  // Cooldown countdown timer
  useEffect(() => {
    if (refreshCooldown <= 0) return;
    const t = setTimeout(() => setRefreshCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [refreshCooldown]);

  const portfolioQuery = useQuery({
    queryKey: ['portfolio', source],
    queryFn: async () => {
      if (source === 'mt5' || source === 'alpaca') {
        return { unavailable: 'not_implemented' };
      }
      const url = source === 'all' ? '/api/portfolio/holdings?source=all' : `/api/portfolio?source=${currentPlatform.provider || source}${currentPlatform.mode ? '&mode=' + currentPlatform.mode : ''}`;
      const data = await apiGet(url);
      setLastUpdated(new Date());
      return data || { unavailable: 'no_connection' };
    },
    staleTime: Infinity,
    refetchInterval: false,
  });

  const scoresQuery = useQuery({
    queryKey: ['portfolio-scores'],
    queryFn: () => apiGet('/api/portfolio/scores').then((d) => d?.scores || []).catch(() => []),
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const data = portfolioQuery.data;
  const unavailable = data?.unavailable;

  // Detect mode mismatch between selection and actual adapter
  const actualMode = data?.summary?.mode;
  const modeMismatch = isT212 && actualMode && currentT212Mode && actualMode !== currentT212Mode;

  const hasData = !unavailable && data?.positions?.length > 0;
  const summary = data?.summary;
  const positions = data?.positions || [];
  const account = data?.account;
  const error = data?.error;

  const timeSinceUpdate = lastUpdated
    ? Math.round((Date.now() - lastUpdated.getTime()) / 1000)
    : null;
  const timeAgo = timeSinceUpdate === null ? 'never'
    : timeSinceUpdate < 60 ? `${timeSinceUpdate}s ago`
    : timeSinceUpdate < 3600 ? `${Math.round(timeSinceUpdate / 60)}m ago`
    : `${Math.round(timeSinceUpdate / 3600)}h ago`;

  const handleRefresh = () => {
    if (refreshCooldown > 0) return;
    portfolioQuery.refetch();
    scoresQuery.refetch();
    setRefreshCooldown(6); // 6s cooldown to respect rate limits
  };

  // Still loading
  if (portfolioQuery.isLoading) {
    return (
      <div className="pf-page">
        <h1>Portfolio</h1>
        <p className="pf-hint">Loading portfolio data…</p>
      </div>
    );
  }

  // API returned an error
  if (error && !hasData) {
    return (
      <div className="pf-page">
        <div className="pf-header">
          <h1>Portfolio</h1>
        </div>
        <UnavailableNotice reason="no_connection" source={source} onRefresh={() => portfolioQuery.refetch()} />
      </div>
    );
  }

  // Source not implemented / no key / no connection / no positions
  if (!hasData) {
    const reason = unavailable || (positions.length === 0 ? 'no_positions' : 'no_connection');
    return (
      <div className="pf-page">
        <div className="pf-header">
          <div>
            <h1>Portfolio</h1>
          </div>
          <div className="pf-header-actions">
            <select className="pf-source-select" value={source} onChange={(e) => setSource(e.target.value)}>
              {PLATFORMS_DEMO_LIVE.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
            <button className="pf-refresh-btn" onClick={() => portfolioQuery.refetch()} disabled={portfolioQuery.isFetching}>
              {portfolioQuery.isFetching ? '⟳' : '↻'} Refresh
            </button>
          </div>
        </div>
        <UnavailableNotice reason={reason} source={source} onRefresh={() => portfolioQuery.refetch()} />
      </div>
    );
  }

  // ── Live data display ────────────────────────────────────
  const totalValue = summary?.totalValue || 0;
  const cash = summary?.cash || 0;
  const totalPnl = summary?.totalPnl || 0;
  const pnlPct = summary?.pnlPct || 0;

  return (
    <div className="pf-page">
      <div className="pf-header">
        <div>
          <h1>Portfolio</h1>
          {isT212 && (
            <span className={`pf-mode-badge pf-mode-${currentT212Mode}`}>
              {currentT212Mode === 'demo' ? '🟡 DEMO' : '🟢 LIVE'}
            </span>
          )}
          {summary?.lastRefreshed && <span className="pf-refreshed">Updated: {timeAgo}</span>}
        </div>
        <div className="pf-header-actions">
          <select className="pf-source-select" value={source} onChange={(e) => setSource(e.target.value)}>
            {PLATFORMS_DEMO_LIVE.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
          <button
            className="pf-refresh-btn"
            onClick={handleRefresh}
            disabled={portfolioQuery.isFetching || refreshCooldown > 0}
          >
            {portfolioQuery.isFetching ? '⟳' : refreshCooldown > 0 ? `${refreshCooldown}s` : '↻'} Refresh
          </button>
        </div>
      </div>

      {modeMismatch && (
        <div className="pf-mode-mismatch">
          ⚠️ You selected <strong>{currentT212Mode === 'live' ? 'T212 Live' : 'T212 Demo'}</strong>, but the backend is running in <strong>{actualMode}</strong> mode.
          Set <code>TRADING212_MODE={currentT212Mode}</code> in <code>nest/.env</code> and restart the NestJS server to switch.
        </div>
      )}

      {portfolioQuery.isFetching && !portfolioQuery.isLoading && (
        <div className="pf-refresh-indicator">⟳ Refreshing…</div>
      )}

      <div className="pf-summary">
        <div className="pf-sum-card"><div className="pf-sum-val">${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div><div>Total Value</div></div>
        <div className="pf-sum-card"><div className="pf-sum-val">${cash.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div><div>Cash</div></div>
        <div className="pf-sum-card"><div className={`pf-sum-val ${totalPnl >= 0 ? 'pf-green' : 'pf-red'}`}>{totalPnl >= 0 ? '+' : ''}{totalPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div><div>Total P&amp;L</div></div>
        <div className="pf-sum-card"><div className={`pf-sum-val ${pnlPct >= 0 ? 'pf-green' : 'pf-red'}`}>{pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%</div><div>Return</div></div>
        <div className="pf-sum-card"><div className="pf-sum-val">{summary?.positionCount || positions.length}</div><div>Positions</div></div>
      </div>

      {positions.length > 0 && (
        <div className="pf-section">
          <h2>Allocation</h2>
          <AllocationBar positions={positions} total={totalValue - cash} />
          <div className="pf-alloc-legend">
            {positions.map((p) => {
              const pct = (totalValue - cash) > 0 ? (p.value / (totalValue - cash) * 100) : 0;
              return <span key={p.symbol} className="pf-legend-item">{p.symbol}: {pct.toFixed(1)}%</span>;
            })}
          </div>
        </div>
      )}

      <div className="pf-section">
        <h2>Positions</h2>
        <table className="pf-table">
          <thead>
            <tr><th>Symbol</th><th>Shares</th><th>Avg Cost</th><th>Price</th><th>Value</th><th>P&amp;L</th><th>%</th><th>Data</th><th></th></tr>
          </thead>
          <tbody>
            {positions.map((p, i) => {
              const s = (scoresQuery.data || []).find((sc) => sc.symbol === p.symbol);
              const dataStatus = s?.dataStatus || 'untracked';
              return (
              <motion.tr
                key={p.symbol}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.25, delay: i * 0.04 }}
              >
                <td><strong>{p.symbol}</strong></td>
                <td>{p.shares?.toLocaleString() || p.quantity?.toLocaleString() || '—'}</td>
                <td>${(p.avgCost || 0).toFixed(2)}</td>
                <td>${(p.currentPrice || 0).toFixed(2)}</td>
                <td>${(p.value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                <td className={(p.pnl || 0) >= 0 ? 'pf-green' : 'pf-red'}>{(p.pnl || 0) >= 0 ? '+' : ''}${Math.abs(p.pnl || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                <td className={(p.pnlPct || 0) >= 0 ? 'pf-green' : 'pf-red'}>{(p.pnlPct || 0) >= 0 ? '+' : ''}{(p.pnlPct || 0).toFixed(1)}%</td>
                <td>
                  <span className={`pf-data-status pf-ds-${dataStatus}`} title={dataStatus === 'live' ? 'Live market data flowing' : dataStatus === 'stale' ? 'Market data is stale' : 'No market data available'}>
                    {dataStatus === 'live' ? 'Live' : dataStatus === 'stale' ? 'Stale' : 'No Data'}
                  </span>
                </td>
                <td>
                  <button
                    className="pf-sell-btn"
                    onClick={() => {
                      setAdapterMode(summary?.mode === 'mock' ? 'demo' : (summary?.mode || 'demo'));
                      setSellPosition(p);
                    }}
                  >
                    Sell...
                  </button>
                </td>
              </motion.tr>
            )})}
          </tbody>
        </table>
      </div>

      {account && (
        <div className="pf-section pf-account-detail">
          <h2>Account</h2>
          <div className="pf-account-grid">
            <div><span>Free</span><strong>${account.free?.toLocaleString() ?? '—'}</strong></div>
            <div><span>Invested</span><strong>${account.invested?.toLocaleString() ?? '—'}</strong></div>
            <div><span>Blocked</span><strong>${account.blocked?.toLocaleString() ?? '—'}</strong></div>
            <div><span>Result</span><strong>${account.result?.toLocaleString() ?? '—'}</strong></div>
          </div>
          <p className="pf-hint">Account details from Trading212.</p>
        </div>
      )}

      {/* ── Order Modal ────────────────────────────────── */}
      {sellPosition && (
        <OrderModal
          position={sellPosition}
          accountCash={summary?.cash || 0}
          mode="sell"
          adapterMode={adapterMode}
          onClose={() => setSellPosition(null)}
          onComplete={(result) => {
            if (result?.success) {
              portfolioQuery.refetch();
            }
          }}
        />
      )}
    </div>
  );
}
