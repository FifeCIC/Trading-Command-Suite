import { useState, useCallback, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import { usePreferences } from '../core/hooks/usePreferences';
import './market-tape.css';
import { computeSessionStates, nextSessionLabel } from '../core/session-utils';
import { timeAgo } from '../core/format-utils';

/* ── Preference key ── */
const PREFS_KEY = 'tcs:market-tape';

/* ── All available sections ── */
const ALL_SECTIONS = [
  { key: 'sessions', label: 'Sessions', defaultOn: true },
  { key: 'events', label: 'Events / Timeline', defaultOn: true },
  { key: 'providers', label: 'Provider Health', defaultOn: true },
  { key: 'auto', label: 'Automation Pulse', defaultOn: true },
  { key: 'next', label: 'Next Session', defaultOn: true },
  { key: 'news', label: 'News Headline', defaultOn: false },
  { key: 'trade', label: 'Recent Trade', defaultOn: false },
  { key: 'uptime', label: 'App Uptime', defaultOn: false },
];

function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  const defaults = {};
  for (const s of ALL_SECTIONS) defaults[s.key] = s.defaultOn;
  return defaults;
}

function savePrefs(prefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
}

/* ── Helpers ── */
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function providerColor(status) {
  if (status === 'healthy' || status === 'connected') return 'var(--market-open, #22c55e)';
  if (status === 'degraded' || status === 'slow') return 'var(--market-closing, #eab308)';
  return 'var(--danger, #ef4444)';
}

function timeUntil(dateStr) {
  const diff = new Date(dateStr) - Date.now();
  if (diff <= 0) return 'now';
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}


function fmtUptime(seconds) {
  if (!seconds || seconds <= 0) return '—';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/* ── Sessions ──
 * Session definitions/state now come from the canonical DST-aware util
 * (src/core/session-utils.js) which mirrors the backend MarketSessionsService.
 * NY opens at 09:30 ET (not 09:00) and DST is handled automatically.
 */
function computeSessions() {
  return computeSessionStates();
}

/* ── Component ── */
export default function MarketTape() {
  const [prefs, setPrefs] = useState(loadPrefs);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const { prefs: userPrefs } = usePreferences();

  // Rotate between the global and symbol-priority headlines.
  const [newsIdx, setNewsIdx] = useState(0);
  useEffect(() => {
    const rotSec = Math.max(5, Number(userPrefs.newsTapeRotateSec) || 30);
    const id = setInterval(() => setNewsIdx((i) => i + 1), rotSec * 1000);
    return () => clearInterval(id);
  }, [userPrefs.newsTapeRotateSec]);

  const toggleSection = useCallback((key) => {
    setPrefs((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      savePrefs(next);
      return next;
    });
  }, []);

  /* ── Data queries ── */
  const healthQuery = useQuery({
    queryKey: ['market-tape', 'providers'],
    queryFn: () => apiGet('/api/providers/health').catch(() => null),
    refetchInterval: 60_000, staleTime: 30_000, retry: 1,
  });

  const timelineQuery = useQuery({
    queryKey: ['market-tape', 'timeline'],
    queryFn: () => apiGet('/api/automation/timeline?lookahead=120').catch(() => null),
    refetchInterval: 60_000, staleTime: 30_000, retry: 1,
  });

  const autoQuery = useQuery({
    queryKey: ['market-tape', 'automation'],
    queryFn: () => apiGet('/api/automation/status').catch(() => null),
    refetchInterval: 30_000, staleTime: 15_000, retry: 1,
  });

  // New: news headline — prioritized tape headlines (global + symbol-priority)
  const newsQuery = useQuery({
    queryKey: ['market-tape', 'news'],
    queryFn: () => apiGet('/api/news/tape').catch(() => null),
    refetchInterval: 120_000, staleTime: 60_000, retry: 1,
    enabled: prefs.news,
  });

  // New: recent trade
  const tradeQuery = useQuery({
    queryKey: ['market-tape', 'recent-trade'],
    queryFn: () => apiGet('/api/providers/mt5/history?limit=1').catch(() => null),
    refetchInterval: 60_000, staleTime: 30_000, retry: 1,
    enabled: prefs.trade,
  });

  // New: app uptime
  const uptimeQuery = useQuery({
    queryKey: ['market-tape', 'health'],
    queryFn: () => apiGet('/api/health').catch(() => null),
    refetchInterval: 60_000, staleTime: 30_000, retry: 1,
    enabled: prefs.uptime,
  });

  const sessions = computeSessions();

  /* ── Build sections ── */
  const sections = [];

  // 1. Sessions
  if (prefs.sessions) {
    const parts = sessions.map((s) => {
      const status = s.active ? (s.closesSoon ? 'closing' : 'open') : 'closed';
      return `${s.flag} ${s.name} ${status}`;
    });
    sections.push({ key: 'sessions', label: 'Sessions', content: parts.join(' · '), color: 'var(--ink)' });
  }

  // 2. Events
  if (prefs.events) {
    const upcoming = timelineQuery.data?.events?.slice(0, 3) || [];
    if (upcoming.length > 0) {
      const parts = upcoming.map((e) => {
        const prefix = e.type === 'economic' ? '📊' : e.type === 'earnings' ? '💰' : '📅';
        return `${prefix} ${e.label || e.type} (${timeUntil(e.startsAt)})`;
      });
      sections.push({ key: 'events', label: 'Events', content: parts.join(' · '), color: 'var(--market-closing, #eab308)' });
    }
  }

  // 3. Providers
  if (prefs.providers) {
    const providers = healthQuery.data?.providers || [];
    if (providers.length > 0) {
      const parts = providers.slice(0, 5).map((p) => {
        const status = p.status || 'unknown';
        const color = providerColor(status);
        const initial = (p.provider || '?').substring(0, 3).toUpperCase();
        return `<span style="color:${color}">●</span> ${initial}`;
      });
      sections.push({ key: 'providers', label: 'Providers', htmlContent: parts.join(' '), color: 'var(--ink)' });
    }
  }

  // 4. Automation pulse
  if (prefs.auto && autoQuery.data) {
    const auto = autoQuery.data;
    const strategies = auto.activeStrategies?.length || 0;
    const positions = (auto.brokerStates && typeof auto.brokerStates === 'object')
      ? Object.values(auto.brokerStates).reduce((sum, b) => sum + (b.positionCount || 0), 0) : 0;
    const pulse = auto.loopEnabled ? 'Live' : 'Paused';
    const lastTick = auto.lastTickAt ? timeAgo(auto.lastTickAt) : '—';
    sections.push({
      key: 'auto', label: 'Auto',
      content: `${pulse} · ${strategies} strategies · ${positions} positions · Last tick ${lastTick}`,
      color: auto.loopEnabled ? 'var(--market-open, #22c55e)' : 'var(--ink-soft, #64748b)',
    });
  }

  // 5. Next session
  if (prefs.next) {
    sections.push({ key: 'next', label: 'Next', content: nextSessionLabel(sessions), color: 'var(--ink-soft, #64748b)' });
  }

  // 6. News headline — prioritized tape headlines (global 🌐 + symbol-priority)
  if (prefs.news && newsQuery.data) {
    const { global, symbol } = newsQuery.data || {};
    const candidates = [];
    if (userPrefs.newsTapeGlobal && global) candidates.push({ ...global, kind: 'global' });
    if (userPrefs.newsTapeSymbol && symbol) candidates.push({ ...symbol, kind: 'symbol' });
    if (candidates.length > 0) {
      const active = candidates[newsIdx % candidates.length];
      const rawTitle = active.title || '';
      const headline = escapeHtml(rawTitle.substring(0, 80) + (rawTitle.length > 80 ? '…' : ''));
      const tag = active.kind === 'symbol'
        ? `<span style="color:var(--accent);font-weight:700">${escapeHtml(active.symbol || '')}</span>`
        : '<span style="color:var(--accent);font-weight:700">🌐</span>';
      const isExternal = active.url && active.url !== '#';
      const url = isExternal ? active.url : '/research/news-intel';
      const target = isExternal ? ' target="_blank" rel="noopener noreferrer"' : '';
      sections.push({
        key: 'news', label: 'News',
        htmlContent: `📰 ${tag} <a href="${url}"${target} style="color:inherit;text-decoration:none">${headline}</a>`,
        color: 'var(--ink-soft, #94a3b8)',
      });
    }
  }

  // 7. Recent trade (new)
  if (prefs.trade && tradeQuery.data) {
    const deals = tradeQuery.data?.deals || [];
    const lastDeal = deals[0];
    if (lastDeal) {
      const dir = lastDeal.type === 'DEAL_TYPE_BUY' ? 'BUY' : lastDeal.type === 'DEAL_TYPE_SELL' ? 'SELL' : escapeHtml(lastDeal.type || '');
      const sym = escapeHtml(lastDeal.symbol || '');
      const pnl = lastDeal.profit ?? 0;
      const pnlColor = pnl >= 0 ? '#22c55e' : '#ef4444';
      sections.push({
        key: 'trade', label: 'Trade',
        htmlContent: `↕ ${dir} ${sym} <span style="color:${pnlColor}">${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}</span>`,
        color: 'var(--ink-soft, #94a3b8)',
      });
    }
  }

  // 8. App uptime (new)
  if (prefs.uptime && uptimeQuery.data) {
    const uptime = uptimeQuery.data?.uptime || uptimeQuery.data?.process?.uptime || 0;
    sections.push({
      key: 'uptime', label: 'Uptime',
      content: `⏱ Up ${fmtUptime(uptime)}`,
      color: 'var(--ink-soft, #94a3b8)',
    });
  }

  /* ── Build ticker tape ── */
  const tapeItems = sections.map((s) => {
    if (s.htmlContent) {
      return `<span class="mkt-tape-section" style="color:${s.color}" data-key="${s.key}"><span class="mkt-tape-label">${s.label}</span> ${s.htmlContent}</span>`;
    }
    return `<span class="mkt-tape-section" style="color:${s.color}" data-key="${s.key}"><span class="mkt-tape-label">${s.label}</span> ${s.content || ''}</span>`;
  });

  const tapeHTML = tapeItems.join('<span class="mkt-tape-sep">│</span>');
  const doubled = sections.length > 0
    ? `${tapeHTML}<span class="mkt-tape-sep">│</span>${tapeHTML}`
    : '<span class="mkt-tape-section" style="color:var(--ink-soft)">All sections hidden — click ⚙ to configure</span>';

  return (
    <div className="market-tape" aria-label="Market status ticker" aria-live="polite" aria-atomic="true">
      <div className="mkt-tape-track" dangerouslySetInnerHTML={{ __html: doubled }} />
      {/* Preferences toggle */}
      <button
        className="mkt-tape-gear"
        onClick={() => setPrefsOpen((v) => !v)}
        title="Configure tape sections"
        aria-label="Configure tape sections"
      >
        ⚙
      </button>
      {prefsOpen && (
        <>
          <div className="mkt-tape-backdrop" onClick={() => setPrefsOpen(false)} />
          <div className="mkt-tape-prefs">
            <div className="mkt-tape-prefs-title">Market Tape Sections</div>
            {ALL_SECTIONS.map((s) => (
              <label key={s.key} className="mkt-tape-pref-row">
                <input type="checkbox" checked={prefs[s.key] || false} onChange={() => toggleSection(s.key)} />
                <span>{s.label}</span>
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
