import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import './MarketTape.css';

/* ── Section colour helpers ── */
function sessionColor(session) {
  if (session?.active) return 'var(--market-open, #22c55e)';
  if (session?.closingSoon) return 'var(--market-closing, #eab308)';
  return 'var(--ink-soft, #64748b)';
}

function providerColor(status) {
  if (status === 'healthy' || status === 'connected') return 'var(--market-open, #22c55e)';
  if (status === 'degraded' || status === 'slow') return 'var(--market-closing, #eab308)';
  return 'var(--danger, #ef4444)';
}

function providerLabel(status) {
  if (status === 'healthy' || status === 'connected') return 'green';
  if (status === 'degraded' || status === 'slow') return 'amber';
  return 'red';
}

/* ── Time helpers ── */
function timeUntil(dateStr) {
  const diff = new Date(dateStr) - Date.now();
  if (diff <= 0) return 'now';
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h > 24) return `${Math.floor(h/24)}d ${h%24}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/* ── Session definitions ── */
const SESSIONS = [
  { id: 'london', label: 'London', flag: '🇬🇧', tz: 'Europe/London', openHour: 8, closeHour: 16 },
  { id: 'ny', label: 'NY', flag: '🇺🇸', tz: 'America/New_York', openHour: 9, closeHour: 16 },
  { id: 'tokyo', label: 'Tokyo', flag: '🇯🇵', tz: 'Asia/Tokyo', openHour: 9, closeHour: 15 },
];

function computeSessions() {
  const now = new Date();
  return SESSIONS.map((s) => {
    try {
      const opts = { timeZone: s.tz, hour: '2-digit', minute: '2-digit', hour12: false };
      const timeStr = now.toLocaleString('en-GB', opts);
      const [h, m] = timeStr.split(':').map(Number);
      const minutes = h * 60 + m;
      const openMin = s.openHour * 60;
      const closeMin = s.closeHour * 60;
      const active = minutes >= openMin && minutes < closeMin;
      const closingSoon = active && (closeMin - minutes <= 30);
      return { ...s, active, closingSoon, openMin, closeMin };
    } catch {
      return { ...s, active: false, closingSoon: false };
    }
  });
}

function nextSessionLabel(sessions) {
  const now = new Date();
  const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  let closest = null;
  for (const s of sessions) {
    if (!s.active && s.openMin > nowMin) {
      const diff = s.openMin - nowMin;
      if (!closest || diff < closest.diff) closest = { session: s, diff };
    }
  }
  if (!closest) {
    const first = sessions.find((s) => !s.active);
    return first ? `${first.flag} ${first.label}` : '';
  }
  const h = Math.floor(closest.diff / 60);
  const m = closest.diff % 60;
  return `${closest.session.flag} ${closest.session.label} in ${h}h ${m}m`;
}

/* ── Component ── */
export default function MarketTape() {
  /* ── Provider health ── */
  const healthQuery = useQuery({
    queryKey: ['market-tape', 'providers'],
    queryFn: () => apiGet('/api/providers/health').catch(() => null),
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: 1,
  });

  /* ── Timeline events ── */
  const timelineQuery = useQuery({
    queryKey: ['market-tape', 'timeline'],
    queryFn: () => apiGet('/api/automation/timeline?lookahead=120').catch(() => null),
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: 1,
  });

  /* ── Automation status ── */
  const autoQuery = useQuery({
    queryKey: ['market-tape', 'automation'],
    queryFn: () => apiGet('/api/automation/status').catch(() => null),
    refetchInterval: 30_000,
    staleTime: 15_000,
    retry: 1,
  });

  /* ── Sessions (computed client-side) ── */
  const sessions = computeSessions();

  /* ── Build sections ── */
  const sections = [];

  // 1. Session status
  const sessionParts = sessions.map((s) => {
    const status = s.active ? (s.closingSoon ? 'closing' : 'open') : 'closed';
    return `${s.flag} ${s.label} ${status}`;
  });
  sections.push({
    key: 'sessions',
    label: 'Sessions',
    content: sessionParts.join(' · '),
    color: 'var(--ink)',
  });

  // 2. Upcoming events
  const upcomingEvents = timelineQuery.data?.events?.slice(0, 3) || [];
  if (upcomingEvents.length > 0) {
    const eventParts = upcomingEvents.map((e) => {
      const prefix = e.type === 'economic' ? '📊' : e.type === 'earnings' ? '💰' : '📅';
      return `${prefix} ${e.label || e.type} (${timeUntil(e.startsAt)})`;
    });
    sections.push({
      key: 'events',
      label: 'Events',
      content: eventParts.join(' · '),
      color: 'var(--market-closing, #eab308)',
    });
  }

  // 3. Provider health dots
  const providers = healthQuery.data?.providers || [];
  if (providers.length > 0) {
    const providerParts = providers.slice(0, 5).map((p) => {
      const status = p.status || 'unknown';
      const color = providerColor(status);
      const initial = (p.provider || '?').substring(0, 3).toUpperCase();
      return `<span style="color:${color}">●</span> ${initial}`;
    });
    sections.push({
      key: 'providers',
      label: 'Providers',
      htmlContent: providerParts.join(' '),
      color: 'var(--ink)',
    });
  }

  // 4. Automation pulse
  if (autoQuery.data) {
    const auto = autoQuery.data;
    const strategies = auto.activeStrategies?.length || 0;
    const positions = (auto.brokerStates && typeof auto.brokerStates === 'object')
      ? Object.values(auto.brokerStates).reduce((sum, b) => sum + (b.positionCount || 0), 0)
      : 0;
    const pulse = auto.loopEnabled ? 'Live' : 'Paused';
    const lastTick = auto.lastTickAt ? timeUntil(auto.lastTickAt) + ' ago' : '—';
    sections.push({
      key: 'auto',
      label: 'Auto',
      content: `${pulse} · ${strategies} strategies · ${positions} positions · Last tick ${lastTick}`,
      color: auto.loopEnabled ? 'var(--market-open, #22c55e)' : 'var(--ink-soft, #64748b)',
    });
  }

  // 5. Next session
  sections.push({
    key: 'next',
    label: 'Next',
    content: nextSessionLabel(sessions),
    color: 'var(--ink-soft, #64748b)',
  });

  /* ── Build ticker tape ── */
  const tapeItems = sections.map((s) => {
    if (s.htmlContent) {
      return `<span class="mkt-tape-section" style="color:${s.color}" data-key="${s.key}"><span class="mkt-tape-label">${s.label}</span> ${s.htmlContent}</span>`;
    }
    return `<span class="mkt-tape-section" style="color:${s.color}" data-key="${s.key}"><span class="mkt-tape-label">${s.label}</span> ${s.content || ''}</span>`;
  });

  // Duplicate for seamless scroll
  const tapeHTML = tapeItems.join('<span class="mkt-tape-sep">│</span>');
  const doubled = `${tapeHTML}<span class="mkt-tape-sep">│</span>${tapeHTML}`;

  return (
    <div className="market-tape" aria-label="Market status ticker">
      <div
        className="mkt-tape-track"
        dangerouslySetInnerHTML={{ __html: doubled }}
      />
    </div>
  );
}
