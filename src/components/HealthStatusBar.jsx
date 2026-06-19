import { useState, useEffect, useCallback, useRef } from 'react';
import { apiGet } from '../core/api/client';
import './HealthStatusBar.css';

const STATUS = { ONLINE: 'online', DEGRADED: 'degraded', OFFLINE: 'offline', UNKNOWN: 'unknown' };

const STATUS_ICONS = {
  [STATUS.ONLINE]: '🟢',
  [STATUS.DEGRADED]: '🟡',
  [STATUS.OFFLINE]: '🔴',
  [STATUS.UNKNOWN]: '⚫',
};

const STATUS_LABELS = {
  [STATUS.ONLINE]: 'Online',
  [STATUS.DEGRADED]: 'Degraded',
  [STATUS.OFFLINE]: 'Offline',
  [STATUS.UNKNOWN]: 'Unknown',
};

function ServiceDot({ name, status, onClick, active }) {
  return (
    <button
      type="button"
      className={`health-dot health-dot--${status}${active ? ' health-dot--active' : ''}`}
      onClick={() => onClick(name)}
      title={`${name}: ${STATUS_LABELS[status]}`}
    >
      <span className="health-dot-icon">{STATUS_ICONS[status]}</span>
      <span className="health-dot-label">{name}</span>
    </button>
  );
}

function DetailPanel({ services, overallStatus, uptime, lastChecked, onRetry, onClose }) {
  return (
    <div className="health-detail-panel">
      <div className="health-detail-header">
        <span>System Health</span>
        <span className={`health-overall health-overall--${overallStatus}`}>
          {STATUS_ICONS[overallStatus]} {STATUS_LABELS[overallStatus]}
        </span>
        <button type="button" className="health-detail-close" onClick={onClose}>&times;</button>
      </div>
      <div className="health-detail-body">
        {services.map((svc) => (
          <div key={svc.name} className={`health-service-row health-service-row--${svc.status}`}>
            <span className="health-service-icon">{STATUS_ICONS[svc.status]}</span>
            <span className="health-service-name">{svc.name}</span>
            <span className="health-service-status">{STATUS_LABELS[svc.status]}</span>
            {svc.latency != null && (
              <span className="health-service-latency">{svc.latency}ms</span>
            )}
            {svc.reason && (
              <span className="health-service-reason">{svc.reason}</span>
            )}
          </div>
        ))}
      </div>
      <div className="health-detail-footer">
        <span>Uptime: {Math.floor(uptime / 60)}m {Math.floor(uptime % 60)}s</span>
        <span>Checked: {lastChecked || 'never'}</span>
        <button type="button" className="health-retry-btn" onClick={onRetry}>Retry All</button>
      </div>
    </div>
  );
}

export default function HealthStatusBar() {
  const [services, setServices] = useState([
    { name: 'API', status: STATUS.UNKNOWN, latency: null, reason: null },
    { name: 'DB', status: STATUS.UNKNOWN, latency: null, reason: null },
    { name: 'Alpaca', status: STATUS.UNKNOWN, latency: null, reason: null },
    { name: 'MT5', status: STATUS.UNKNOWN, latency: null, reason: null },
  ]);
  const [uptime, setUptime] = useState(0);
  const [lastChecked, setLastChecked] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [activeService, setActiveService] = useState(null);
  const pollRef = useRef(null);
  const mountedRef = useRef(true);

  const checkHealth = useCallback(async () => {
    const start = Date.now();
    const newServices = [...services];
    let allOnline = true;

    try {
      // Try the real health endpoint first (Q141)
      const health = await apiGet('/api/health');
      const end = Date.now();

      // API
      newServices[0] = {
        name: 'API',
        status: health?.status && health.status !== 'down' ? STATUS.ONLINE : STATUS.DEGRADED,
        latency: end - start,
        reason: health?.status === 'degraded' ? 'Some subsystems degraded' : null,
      };

      // DB
      const dbStatus = health?.subsystems?.database?.status;
      newServices[1] = {
        name: 'DB',
        status: dbStatus === 'connected' ? STATUS.ONLINE : dbStatus === 'disconnected' ? STATUS.OFFLINE : STATUS.UNKNOWN,
        latency: health?.subsystems?.database?.latency ?? null,
        reason: dbStatus !== 'connected' ? 'Database unreachable' : null,
      };

      // Alpaca
      const providers = health?.subsystems?.providers || {};
      const hasAlpaca = (providers.healthy ?? 0) > 0 || (providers.degraded ?? 0) > 0;
      newServices[2] = {
        name: 'Alpaca',
        status: providers.failed > 0 ? STATUS.DEGRADED : hasAlpaca ? STATUS.ONLINE : STATUS.DEGRADED,
        latency: null,
        reason: !hasAlpaca ? 'Not configured' : providers.failed > 0 ? 'Some providers failed' : null,
      };

      // MT5 — query the real bridge diagnostics endpoint
      try {
        const mt5 = await apiGet('/api/providers/mt5/diagnostics');
        newServices[3] = {
          name: 'MT5',
          status: mt5?.connected ? STATUS.ONLINE : mt5?.bridgeRunning ? STATUS.DEGRADED : STATUS.OFFLINE,
          latency: null,
          reason: mt5?.connected
            ? (mt5.account ? `${mt5.account} @ ${mt5.server || ''}`.trim() : 'Connected')
            : mt5?.bridgeRunning
              ? 'Bridge running, MT5 not logged in'
              : mt5?.bridgeError || 'Bridge unreachable',
        };
      } catch {
        newServices[3] = {
          name: 'MT5',
          status: STATUS.OFFLINE,
          latency: null,
          reason: 'Bridge unreachable — python bridge not running',
        };
      }

      if (health?.uptime != null) setUptime(health.uptime);

      allOnline = newServices.every((s) => s.status === STATUS.ONLINE || s.status === STATUS.UNKNOWN);
    } catch {
      // Fallback: ping /api/version
      try {
        const ver = await apiGet('/api/version');
        const end = Date.now();
        newServices[0] = {
          name: 'API',
          status: ver?.version ? STATUS.ONLINE : STATUS.DEGRADED,
          latency: end - start,
          reason: null,
        };
        newServices[1] = {
          name: 'DB',
          status: ver?.services?.databaseConnected ? STATUS.ONLINE : STATUS.OFFLINE,
          latency: null,
          reason: ver?.services?.databaseConnected ? null : 'DB not connected',
        };
        newServices[2] = { name: 'Alpaca', status: STATUS.UNKNOWN, latency: null, reason: null };
        newServices[3] = { name: 'MT5', status: STATUS.OFFLINE, latency: null, reason: 'API degraded — cannot check bridge' };
        allOnline = newServices[0].status === STATUS.ONLINE;
      } catch {
        newServices[0] = { name: 'API', status: STATUS.OFFLINE, latency: null, reason: 'Connection refused' };
        newServices[1] = { name: 'DB', status: STATUS.UNKNOWN, latency: null, reason: null };
        newServices[2] = { name: 'Alpaca', status: STATUS.UNKNOWN, latency: null, reason: null };
        newServices[3] = { name: 'MT5', status: STATUS.OFFLINE, latency: null, reason: 'API unreachable — cannot check bridge' };
        allOnline = false;
      }
    }

    if (mountedRef.current) {
      setServices(newServices);
      setLastChecked(new Date().toLocaleTimeString());
    }

    return allOnline;
  }, []);

  // Polling
  useEffect(() => {
    mountedRef.current = true;

    const poll = async () => {
      const allOnline = await checkHealth();
      // Adjust interval: 10s when any offline, 30s when all online
      const interval = allOnline ? 30000 : 10000;
      if (mountedRef.current) {
        pollRef.current = setTimeout(poll, interval);
      }
    };

    poll();

    return () => {
      mountedRef.current = false;
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [checkHealth]);

  const handleDotClick = useCallback((name) => {
    if (activeService === name && detailOpen) {
      setDetailOpen(false);
      setActiveService(null);
    } else {
      setActiveService(name);
      setDetailOpen(true);
    }
  }, [activeService, detailOpen]);

  const overallStatus = services.every((s) => s.status === STATUS.OFFLINE)
    ? STATUS.OFFLINE
    : services.some((s) => s.status === STATUS.OFFLINE)
      ? STATUS.DEGRADED
      : STATUS.ONLINE;

  return (
    <div className="health-status-bar">
      {services.map((svc) => (
        <ServiceDot
          key={svc.name}
          name={svc.name}
          status={svc.status}
          onClick={handleDotClick}
          active={activeService === svc.name && detailOpen}
        />
      ))}
      {detailOpen && (
        <DetailPanel
          services={services}
          overallStatus={overallStatus}
          uptime={uptime}
          lastChecked={lastChecked}
          onRetry={checkHealth}
          onClose={() => { setDetailOpen(false); setActiveService(null); }}
        />
      )}
    </div>
  );
}
