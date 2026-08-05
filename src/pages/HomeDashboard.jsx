import { useQuery } from '@tanstack/react-query';
import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet } from '../core/api/client';
import ScreenOptions from '../components/ScreenOptions';
import MarketContextWidget from '../components/MarketContextWidget';
import './home-dashboard.css';
import PageInfoPopover from '../components/PageInfoPopover';

export default function HomeDashboard() {
  const navigate = useNavigate();
  const [restarting, setRestarting] = useState(false);
  const [restartMsg, setRestartMsg] = useState(null);
  const [screenOptionsOpen, setScreenOptionsOpen] = useState(false);

  const healthQuery = useQuery({
    queryKey: ['home-health'],
    queryFn: () => apiGet('/api/').catch(() => null),
    staleTime: 30_000,
  });

  const serverData = healthQuery.data;
  const isApiOnline = Boolean(serverData?.database);
  const version = serverData?.version || '—';
  const statusDot = isApiOnline ? '🟢' : healthQuery.isLoading ? '⏳' : '🔴';
  const statusLabel = isApiOnline ? `API Online (v${version})` : healthQuery.isLoading ? 'Checking…' : 'API Offline';

  // MT5 bridge/AutoTrading status
  const mt5 = serverData?.mt5Bridge;
  const mt5Connected = mt5?.connected;
  const mt5TradeAllowed = mt5?.tradeAllowed;
  const mt5StatusClass = mt5Connected ? (mt5TradeAllowed ? 'ok' : 'warn') : 'err';

  // Stop Guardian status
  const sg = serverData?.stopGuardian;
  const sgEnabled = sg?.enabled;
  const sgGuardedCount = sg?.guardedCount ?? 0;

  const handleRestartBackend = useCallback(async () => {
    setRestarting(true);
    setRestartMsg('Sending start command...');
    try {
      const res = await fetch('/intranet/api-tasks.php?action=start&task=tradercore:all', {
        method: 'POST',
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) {
        setRestartMsg('Start command sent. Waiting for NestJS to come online...');
        let attempts = 0;
        const poll = setInterval(async () => {
          attempts++;
          try {
            const health = await apiGet('/api/version');
            if (health?.version) {
              clearInterval(poll);
              setRestartMsg('Backend is online! Refreshing...');
              setRestarting(false);
              healthQuery.refetch();
              setTimeout(() => setRestartMsg(null), 3000);
            } else if (attempts > 20) {
              clearInterval(poll);
              setRestartMsg('Backend did not respond after 40s. Check the terminal for errors.');
              setRestarting(false);
            }
          } catch {
            if (attempts > 20) {
              clearInterval(poll);
              setRestartMsg('Backend did not respond after 40s. Check the terminal for errors.');
              setRestarting(false);
            }
          }
        }, 2000);
      } else {
        setRestartMsg('Failed to send start command. Is WAMP running?');
        setRestarting(false);
      }
    } catch (err) {
      setRestartMsg(`Failed: ${err.message || 'Could not reach task runner'}`);
      setRestarting(false);
    }
  }, [healthQuery]);

  return (
    <div className="nav-dashboard nav-dashboard--landing">
      {/* ── Centered Logo ── */}
      <div className="nd-hero">
        <img src="/tcs-logo.png" alt="Trading Command Suite" className="nd-hero-logo" />
        <h1 className="nd-hero-title">Trading Command Suite
          <PageInfoPopover>
            Algorithmic analysis &amp; portfolio management
          </PageInfoPopover>
        </h1>
        <div className="nd-hero-status">
          <span className="nd-hero-dot" data-status={isApiOnline ? 'ok' : healthQuery.isLoading ? 'loading' : 'err'}>{statusDot}</span>
          <span>{statusLabel}</span>
        </div>
        <button
          className="nd-hero-enter"
          onClick={() => navigate('/dashboard')}
        >
          Enter Dashboard
        </button>
      </div>

      {/* ── System Status ── */}
      <section className="nd-section nd-status-section">
        <h2>System Status</h2>
        <div className="nd-status-grid">
          <div className="nd-status-item">
            <span className="nd-status-label">NestJS API</span>
            <span className={`nd-status-value ${isApiOnline ? 'ok' : 'err'}`}>
              {isApiOnline ? 'Running' : 'Offline'}
            </span>
          </div>
          <div className="nd-status-item">
            <span className="nd-status-label">Database</span>
            <span className="nd-status-value ok">MySQL (tradingcs)</span>
          </div>
          <div className="nd-status-item">
            <span className="nd-status-label">MT5 Bridge</span>
            <span className={`nd-status-value ${mt5StatusClass}`}>
              {mt5Connected ? `Port 5000 — $${mt5?.balance?.toLocaleString() ?? '—'}` : 'Offline'}
            </span>
          </div>
          <div className="nd-status-item">
            <span className="nd-status-label">MT5 AutoTrading</span>
            <span className={`nd-status-value ${mt5TradeAllowed === null ? '' : mt5TradeAllowed ? 'ok' : 'warn'}`}>
              {mt5TradeAllowed === null ? '—' : mt5TradeAllowed ? 'Enabled' : 'Disabled'}
            </span>
          </div>
          <div className="nd-status-item">
            <span className="nd-status-label">Stop Guardian</span>
            <span className={`nd-status-value ${sgEnabled ? 'ok' : ''}`}>
              {sgEnabled ? `Guarding ${sgGuardedCount}` : 'Stopped'}
            </span>
          </div>
          <div className="nd-status-item">
            <span className="nd-status-label">Trading212</span>
            <span className="nd-status-value ok">Live — $2,393</span>
          </div>
          <div className="nd-status-item">
            <span className="nd-status-label">Frontend</span>
            <span className="nd-status-value ok">Vite (5173)</span>
          </div>
          <div className="nd-status-item">
            <span className="nd-status-label">Version</span>
            <span className="nd-status-value">{version}</span>
          </div>
        </div>
      </section>

      {/* ── Market Context Widget ── */}
      {isApiOnline && (
        <section className="nd-section">
          <MarketContextWidget />
        </section>
      )}

      {!isApiOnline && (
        <section className="nd-section nd-setup">
          <h2>Backend Not Connected</h2>
          <p className="nd-setup-text">
            The NestJS API server isn't running.
          </p>
          <div className="nd-setup-actions">
            <button
              onClick={handleRestartBackend}
              disabled={restarting}
              className="nd-restart-btn"
            >
              {restarting ? 'Starting...' : 'Restart Backend'}
            </button>
            {restartMsg && (
              <span className="nd-restart-msg">{restartMsg}</span>
            )}
          </div>
          <p className="nd-setup-hint">
            Or run manually: <code>npm --prefix c:/wamp64/www/trading-command-suite/nest run start:dev</code>
          </p>
        </section>
      )}
      <ScreenOptions
        activeView={null}
        isOpen={screenOptionsOpen}
        onToggle={() => setScreenOptionsOpen((v) => !v)}
        isBookmarked={false}
        onToggleBookmark={() => {}}
        statusLevel={healthQuery.isLoading ? null : isApiOnline ? 'online' : 'offline'}
        isMt5Online={mt5Connected || false}
        isApiOnline={isApiOnline}
        isDbOnline={isApiOnline}
      />
    </div>
  );
}
