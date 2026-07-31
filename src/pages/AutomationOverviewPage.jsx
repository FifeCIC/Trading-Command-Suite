/**
 * Automation Overview — Strategy Chain & Services Snapshot
 * =========================================================
 * Parent-child view of the automation pipeline:
 *   Trading Strategies → Scoring Strategies → Protocols
 *
 * Plus a quick snapshot of automation services (loop, brokers, tick info).
 *
 * Route: /automation/overview
 */

import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import './automation-overview.css';
import PageInfoPopover from '../components/PageInfoPopover';

/* ── Helpers ── */
function StatusDot({ on }) {
  return <span className={`ao-dot ${on ? 'ao-dot--on' : 'ao-dot--off'}`} />;
}

function ago(iso) {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m ago`;
}

/* ── Main Component ── */
export default function AutomationOverviewPage() {
  const autoQuery = useQuery({
    queryKey: ['ao-automation-status'],
    queryFn: () => apiGet('/api/automation/status').catch(() => ({})),
    refetchInterval: 30_000,
  });
  const scoringStratsQuery = useQuery({
    queryKey: ['ao-scoring-strategies'],
    queryFn: () => apiGet('/api/automation/scoring-strategies').catch(() => []),
    staleTime: 60_000,
  });
  const tradingStratsQuery = useQuery({
    queryKey: ['ao-trading-strategies'],
    queryFn: () => apiGet('/api/trading/strategies').catch(() => []),
    staleTime: 60_000,
  });
  const protocolsQuery = useQuery({
    queryKey: ['ao-protocols'],
    queryFn: () => apiGet('/api/scoring/protocols').catch(() => ({ protocols: [] })),
    staleTime: 120_000,
  });
  const providersQuery = useQuery({
    queryKey: ['ao-provider-health'],
    queryFn: () => apiGet('/api/providers/health').catch(() => ({})),
    staleTime: 60_000,
  });

  const isLoading =
    autoQuery.isLoading &&
    scoringStratsQuery.isLoading &&
    tradingStratsQuery.isLoading;

  if (isLoading) return <div className="ao-page"><LoadingSkeleton variant="text" lines={12} /></div>;

  const autoStatus = autoQuery.data || {};
  const scoringStrats = Array.isArray(scoringStratsQuery.data) ? scoringStratsQuery.data : [];
  const tradingStrats = Array.isArray(tradingStratsQuery.data) ? tradingStratsQuery.data : [];
  const protocols = protocolsQuery.data?.protocols || [];
  const providerList = providersQuery.data?.providers || [];
  const activeStrategies = autoStatus.activeStrategies || [];
  const brokerStates = autoStatus.brokerStates || {};
  const recentDecisions = autoStatus.recentDecisions || [];

  // Group chains: Trading Strategy → Scoring Strategy → Protocol
  const chains = tradingStrats.map(ts => {
    const ss = scoringStrats.find(s => s.protocolId === ts.protocolId) || null;
    const proto = protocols.find(p => p.id === ts.protocolId) || null;
    const loopState = activeStrategies.find(a => a.id === ts.id);
    return { trading: ts, scoring: ss, protocol: proto, loopState };
  });

  // Active chains first, then inactive
  const sortedChains = [...chains].sort((a, b) => {
    if (a.trading.active !== b.trading.active) return a.trading.active ? -1 : 1;
    return (a.trading.name || '').localeCompare(b.trading.name || '');
  });

  const tickCount = autoStatus.tickCount || 0;
  const tickIntervalMs = autoStatus.tickIntervalMs || 0;
  const loopRunning = autoStatus.loopEnabled === true;
  const lastTick = autoStatus.lastTickAt;
  const lastTickMs = autoStatus.lastTickMs;
  const providerCount = providerList.length;
  const healthyProviders = providerList.filter(p => p.status === 'healthy' || p.status === 'connected').length;

  return (
    <div className="ao-page">
      <header className="ao-header">
        <h1>Automation Overview
          <PageInfoPopover>
            Strategy chain snapshot — see what the automation system is running right now.
          </PageInfoPopover>
        </h1>
      </header>

      {/* ── Services Snapshot ── */}
      <section className="ao-services">
        <h2>Services</h2>
        <div className="ao-service-grid">
          <div className="ao-service-card">
            <div className="ao-service-head">
              <StatusDot on={loopRunning} />
              <strong>Automation Loop</strong>
            </div>
            <div className="ao-service-body">
              <span>{loopRunning ? 'Running' : 'Paused'}</span>
              <span>Tick #{tickCount} · every {(tickIntervalMs / 1000).toFixed(0)}s</span>
              {lastTick && <span>Last tick {ago(lastTick)}{lastTickMs ? ` (${lastTickMs}ms)` : ''}</span>}
            </div>
          </div>
          <div className="ao-service-card">
            <div className="ao-service-head">
              <StatusDot on={healthyProviders > 0} />
              <strong>Providers</strong>
            </div>
            <div className="ao-service-body">
              <span>{healthyProviders}/{providerCount} healthy</span>
              <span>{providerList.slice(0, 6).map(p => p.provider?.toUpperCase?.() || p.id).join(', ')}</span>
            </div>
          </div>
          {Object.entries(brokerStates).map(([id, state]) => (
            <div key={id} className="ao-service-card">
              <div className="ao-service-head">
                <StatusDot on={state?.enabled} />
                <strong>Broker: {id.toUpperCase()}</strong>
              </div>
              <div className="ao-service-body">
                <span>{state?.enabled ? 'Enabled' : 'Disabled'}{state?.tradingEnabled ? ' · Trading' : ''}</span>
                <span>{state?.scoreIntervalMs ? `Score every ${(state.scoreIntervalMs / 1000).toFixed(0)}s` : ''}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Strategy Chains ── */}
      <section className="ao-chains">
        <h2>Strategy Chains ({sortedChains.length})</h2>
        <p className="ao-hint">
          Grouped by Trading Strategy → Scoring Strategy → Protocol.
          Active strategies are in the automation loop.
        </p>

        {sortedChains.length === 0 ? (
          <div className="ao-empty">No trading strategies configured.</div>
        ) : (
          <div className="ao-chain-list">
            {sortedChains.map(chain => (
              <div key={chain.trading.id} className={`ao-chain-card ${chain.trading.active ? '' : 'ao-chain--inactive'}`}>
                {/* ── Trading Strategy (parent) ── */}
                <div className="ao-chain-level ao-chain-trading">
                  <div className="ao-chain-level-head">
                    <StatusDot on={chain.trading.active} />
                    <strong>{chain.trading.name}</strong>
                    {chain.loopState ? (
                      <span className="ao-badge ao-badge-loop">In Loop</span>
                    ) : (
                      <span className="ao-badge ao-badge-idle">Idle</span>
                    )}
                    <span className="ao-chain-id">TS: {chain.trading.id?.slice(0, 8)}</span>
                  </div>
                  <div className="ao-chain-level-meta">
                    <span>{chain.trading.symbol} · {chain.trading.timeframe || '1h'}</span>
                    {chain.trading.mode && <span>{chain.trading.mode}</span>}
                    {chain.loopState?.lastSignal && (
                      <span className={`ao-signal ao-signal-${chain.loopState.lastSignal?.toLowerCase()}`}>
                        {chain.loopState.lastSignal}
                      </span>
                    )}
                  </div>
                </div>

                {/* ── Scoring Strategy (child) ── */}
                <div className="ao-chain-level ao-chain-scoring">
                  <div className="ao-chain-level-head">
                    <span className="ao-chain-arrow">├─</span>
                    <StatusDot on={chain.scoring?.enabled} />
                    <strong>{chain.scoring?.name || '—'}</strong>
                    {chain.scoring?.enabled ? (
                      <span className="ao-badge ao-badge-active">Active</span>
                    ) : (
                      <span className="ao-badge ao-badge-idle">Disabled</span>
                    )}
                    {chain.scoring?.id && <span className="ao-chain-id">SS: {chain.scoring.id.slice(0, 8)}</span>}
                  </div>
                  <div className="ao-chain-level-meta">
                    {chain.scoring && (
                      <>
                        <span>Threshold: {chain.scoring.tradeThreshold || 0}</span>
                        <span>Watchlist: {chain.scoring.watchlistName || '—'}</span>
                        <span>Size: {chain.scoring.baseSize || '—'} lots</span>
                        {chain.scoring.tradingEnabled === false && <span className="ao-warn">Trading OFF</span>}
                      </>
                    )}
                    {!chain.scoring && <span className="ao-muted">No scoring strategy linked</span>}
                  </div>
                </div>

                {/* ── Protocol (grandchild) ── */}
                <div className="ao-chain-level ao-chain-protocol">
                  <div className="ao-chain-level-head">
                    <span className="ao-chain-arrow">├─</span>
                    <StatusDot on={!!chain.protocol} />
                    <strong>{chain.protocol?.name || '—'}</strong>
                    {chain.protocol?.id && <span className="ao-chain-id">Proto: {chain.protocol.id.slice(0, 8)}</span>}
                  </div>
                  <div className="ao-chain-level-meta">
                    {chain.protocol ? (
                      <>
                        <span>{chain.protocol.directiveCount || 0} directives</span>
                        <span>{chain.protocol.groupCount || chain.protocol.groups?.length || 0} groups</span>
                        {chain.protocol.directionMode && <span>{chain.protocol.directionMode}</span>}
                      </>
                    ) : (
                      <span className="ao-muted">No protocol linked</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Recent Decisions (last tick summary) ── */}
      {recentDecisions.length > 0 && (
        <section className="ao-decisions">
          <h2>Recent Decisions (last tick)</h2>
          <div className="ao-decisions-grid">
            {recentDecisions.slice(0, 20).map((d, i) => (
              <div key={i} className={`ao-decision ao-decision-${d.decision?.toLowerCase()}`}>
                <span className="ao-decision-symbol">{d.symbol}</span>
                <span className="ao-decision-action">{d.decision} → {d.signal}</span>
                <span className="ao-decision-composite">{d.composite || 0}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
