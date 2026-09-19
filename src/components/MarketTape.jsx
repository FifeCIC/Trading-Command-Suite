import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiGet } from '../core/api/client';
import { usePreferences } from '../core/hooks/usePreferences';
import './market-tape.css';
import { computeSessionStates, nextSessionLabel } from '../core/session-utils';
import { timeAgo } from '../core/format-utils';

/* ── Preference keys ──
 *
 * ⚠️ WHY THESE MOVED (2026-09-11). The tape used to own a PRIVATE localStorage key
 * (`tcs:market-tape`) with its own load/save, while `usePreferences` held a second,
 * server-synced store. Two stores for one concept meant a section could be turned on
 * in Settings and stay off on the tape — a toggle that silently does nothing. All tape
 * sections now live in `usePreferences` (keys below), which is server-synced so the
 * choice follows the user across devices.
 *
 * LEGACY_KEY is read ONCE by `readLegacyTapePrefs()` and then deleted. It exists so an
 * existing user's on/off choices survive the migration instead of being reset to
 * defaults — a preference silently changing back is the same defect this fix removes.
 */
const LEGACY_KEY = 'tcs:market-tape';

/** Old section key → new usePreferences key. */
const LEGACY_MAP = {
  sessions: 'tapeSessions',
  events: 'tapeEvents',
  providers: 'tapeProviders',
  auto: 'tapeAuto',
  next: 'tapeNext',
  news: 'tapeNews',
  trade: 'tapeTrade',
  uptime: 'tapeUptime',
};

/**
 * Read the pre-2026-09-11 tape preferences, if any are still present.
 * Returns a partial map of `usePreferences` keys, or null when there is nothing to
 * migrate. Purely a read — the caller decides when it is safe to delete the old key.
 */
function readLegacyTapePrefs() {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return null;
    const old = JSON.parse(raw);
    if (!old || typeof old !== 'object') return null;
    const migrated = {};
    for (const [oldKey, newKey] of Object.entries(LEGACY_MAP)) {
      if (typeof old[oldKey] === 'boolean') migrated[newKey] = old[oldKey];
    }
    return Object.keys(migrated).length > 0 ? migrated : null;
  } catch {
    return null; // malformed JSON — treat as "nothing to migrate"
  }
}

/* ── All available sections ──
 * The list is exported so the Settings page renders the SAME catalog. Two hand-kept
 * lists would drift, and a section missing from one is a section the user cannot
 * switch on. `defaultOn` documents intent; the live default is in usePreferences.js.
 */
export const ALL_SECTIONS = [
  { key: 'tapeSessions', label: 'Sessions', defaultOn: true },
  { key: 'tapeEvents', label: 'Events / Timeline', defaultOn: true },
  { key: 'tapeProviders', label: 'Provider Health', defaultOn: true },
  { key: 'tapeAuto', label: 'Automation Pulse', defaultOn: true },
  { key: 'tapeNext', label: 'Next Session', defaultOn: true },
  { key: 'tapeNews', label: 'News Headline', defaultOn: false },
  { key: 'tapeTrade', label: 'Recent Order', defaultOn: false },
  { key: 'tapeUptime', label: 'App Uptime', defaultOn: false },
  { key: 'tapeScore', label: 'Latest Score', defaultOn: false },
  { key: 'tapeProfit', label: 'Latest Profit Taken', defaultOn: false },
  { key: 'tapeLoss', label: 'Latest Loss Taken', defaultOn: false },
];

/* ── Helpers ── */
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/** Plain text from a section body that may contain markup (for the live region). */
function stripTags(html) {
  return String(html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

/* ⚠️ THESE MUST USE TOKENS, NOT HEX (2026-09-18).
 *
 * The tape used to hardcode `#22c55e` / `#ef4444`, which broke two accessibility
 * features silently — and silently is the problem, because the tape is on screen for
 * every page and every session:
 *
 *   1. HIGH CONTRAST was bypassed. `:root[data-high-contrast='true']` overrides
 *      `--color-loss` to `#fca5a5` and `--ink-soft` to `#cbd5e1`; a literal `#ef4444`
 *      ignores all of it. The preference rendered as a working toggle that changed
 *      nothing here.
 *   2. `#ef4444` is the value `index.css` records as REPLACED for failing WCAG AA —
 *      `--danger` / `--color-loss` were both boosted to `#f87171` (5.1:1 on black)
 *      precisely because `#ef4444` does not clear 4.5:1. At `0.78rem` (~12.5px) this is
 *      small text, so 1.4.3 applies and the old value was a real failure, not a nitpick.
 */
function providerColor(status) {
  if (status === 'healthy' || status === 'connected') return 'var(--color-profit, #22c55e)';
  if (status === 'degraded' || status === 'slow') return 'var(--color-warning, #f59e0b)';
  return 'var(--color-loss, #f87171)';
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

/** Signed money, always 2dp, with an explicit + for gains. */
function fmtMoney(v) {
  const n = Number(v) || 0;
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}`;
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
  const { prefs: userPrefs, set: setPref } = usePreferences();
  const navigate = useNavigate();

  // Rotate between the global and symbol-priority headlines.
  const [newsIdx, setNewsIdx] = useState(0);
  useEffect(() => {
    const rotSec = Math.max(5, Number(userPrefs.newsTapeRotateSec) || 30);
    const id = setInterval(() => setNewsIdx((i) => i + 1), rotSec * 1000);
    return () => clearInterval(id);
  }, [userPrefs.newsTapeRotateSec]);

  // One-shot legacy migration (see LEGACY_KEY note). Runs once on mount, writes any
  // old choices through to the server-synced store, then removes the stale key so
  // there is exactly one source of truth from then on.
  useEffect(() => {
    const legacy = readLegacyTapePrefs();
    if (!legacy) return;
    for (const [key, value] of Object.entries(legacy)) setPref(key, value);
    try { localStorage.removeItem(LEGACY_KEY); } catch { /* noop */ }
    // Intentionally mount-only: this is a migration, not a sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    enabled: !!userPrefs.tapeNews,
  });

  /* ⚠️ ENDPOINT FIX (2026-09-11). This used to call
   * `/api/providers/mt5/history?limit=1` and read `data.deals[0]` with `deal.profit`.
   * That endpoint returns `{ orders: [...] }` and MT5 orders carry NO profit field —
   * so `deals` was always undefined, `lastDeal` was always undefined, and the section
   * silently rendered NOTHING when switched on. A toggle that produces no output is
   * indistinguishable from a broken one.
   *
   * It now reads the trade audit trail, which has a real `pnl` on CLOSED trades and is
   * the same source the profit/loss sections use. One source, three sections.
   */
  const tradesQuery = useQuery({
    queryKey: ['market-tape', 'closed-trades'],
    queryFn: () => apiGet('/api/trading/trade-history?status=closed&limit=25&days=90').catch(() => null),
    refetchInterval: 60_000, staleTime: 30_000, retry: 1,
    enabled: !!(userPrefs.tapeTrade || userPrefs.tapeProfit || userPrefs.tapeLoss),
  });

  // New: app uptime
  const uptimeQuery = useQuery({
    queryKey: ['market-tape', 'health'],
    queryFn: () => apiGet('/api/health').catch(() => null),
    refetchInterval: 60_000, staleTime: 30_000, retry: 1,
    enabled: !!userPrefs.tapeUptime,
  });

  // Latest score — newest row from the ranked scoring store.
  const scoreQuery = useQuery({
    queryKey: ['market-tape', 'latest-score'],
    queryFn: () => apiGet('/api/scoring/ranked?limit=1').catch(() => null),
    refetchInterval: 60_000, staleTime: 30_000, retry: 1,
    enabled: !!userPrefs.tapeScore,
  });

  const sessions = computeSessions();

  /* ── Closed-trade slices (profit taken / loss taken) ──
   * `trades` is already closedAt-desc from the API, so the FIRST row matching each
   * predicate is the most recent one. It is re-sorted defensively here too, because
   * "latest" silently becoming "some" is what makes a tape untrustworthy.
   *
   * ⚠️ `exitPrice != null` IS REQUIRED (2026-09-18). A row can be `status='closed'` with
   * NO exit price and `pnl = 0`: 103 of 155 closed rows measured, all written by a
   * reconciler closing a row that had no broker counterpart (#885). Those are not trades,
   * and `pnl = 0` renders as `+0.00` in PROFIT GREEN — so the tape was showing
   * "↕ BUY VIX +0.00" for a position that was still OPEN at the broker (#883).
   * The win/loss slices below are unaffected (they require pnl > 0 / < 0); this filter is
   * what makes the plain "Trade" slice honest.
   */
  const closedTrades = (() => {
    const raw = tradesQuery.data?.trades;
    if (!Array.isArray(raw)) return [];
    return [...raw]
      .filter((t) => t && t.pnl != null && t.closedAt && t.exitPrice != null)
      .sort((a, b) => Date.parse(b.closedAt) - Date.parse(a.closedAt));
  })();
  const lastWin = closedTrades.find((t) => Number(t.pnl) > 0) || null;
  const lastLoss = closedTrades.find((t) => Number(t.pnl) < 0) || null;
  const lastClose = closedTrades[0] || null;

  /* ── Build sections ── */
  const sections = [];

  // 1. Sessions
  if (userPrefs.tapeSessions) {
    const parts = sessions.map((s) => {
      const status = s.active ? (s.closesSoon ? 'closing' : 'open') : 'closed';
      return `${s.flag} ${s.name} ${status}`;
    });
    sections.push({ key: 'sessions', label: 'Sessions', content: parts.join(' · '), color: 'var(--ink)' });
  }

  // 2. Events
  if (userPrefs.tapeEvents) {
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
  if (userPrefs.tapeProviders) {
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
  if (userPrefs.tapeAuto && autoQuery.data) {
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
  if (userPrefs.tapeNext) {
    sections.push({ key: 'next', label: 'Next', content: nextSessionLabel(sessions), color: 'var(--ink-soft, #64748b)' });
  }

  // 6. News headline — prioritized tape headlines (global 🌐 + symbol-priority).
  // The LINK is carried through so a headline is clickable to its source article; it
  // falls back to the in-app news page when the source gave no external URL.
  if (userPrefs.tapeNews && newsQuery.data) {
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

  // 7. Recent order — the newest CLOSED trade with a real exit, whatever its result.
  if (userPrefs.tapeTrade && lastClose) {
    const sym = escapeHtml(lastClose.symbol || '');
    const dir = escapeHtml(String(lastClose.side || '').toUpperCase());
    const pnl = Number(lastClose.pnl) || 0;
    const pnlColor = pnl >= 0 ? 'var(--color-profit, #22c55e)' : 'var(--color-loss, #f87171)';
    sections.push({
      key: 'trade', label: 'Trade',
      htmlContent: `↕ ${dir} ${sym} <span style="color:${pnlColor}">${fmtMoney(pnl)}</span>`,
      color: 'var(--ink-soft, #94a3b8)',
    });
  }

  // 8. Latest profit taken — most recent closed trade that made money.
  if (userPrefs.tapeProfit && lastWin) {
    const sym = escapeHtml(lastWin.symbol || '');
    sections.push({
      key: 'profit', label: 'Profit',
      htmlContent: `✅ ${sym} <span style="color:var(--color-profit)">${fmtMoney(lastWin.pnl)}</span>`
        + `<span style="color:var(--ink-soft)"> · ${escapeHtml(timeAgo(lastWin.closedAt))}</span>`,
      color: 'var(--ink-soft, #94a3b8)',
    });
  }

  // 9. Latest loss taken — most recent closed trade that lost money.
  // Shown with the same prominence as profit-taken. Surfacing wins while hiding losses
  // would make the tape actively misleading.
  if (userPrefs.tapeLoss && lastLoss) {
    const sym = escapeHtml(lastLoss.symbol || '');
    sections.push({
      key: 'loss', label: 'Loss',
      htmlContent: `⚠ ${sym} <span style="color:var(--color-loss)">${fmtMoney(lastLoss.pnl)}</span>`
        + `<span style="color:var(--ink-soft)"> · ${escapeHtml(timeAgo(lastLoss.closedAt))}</span>`,
      color: 'var(--ink-soft, #94a3b8)',
    });
  }

  // 10. Latest score — the newest scoring run, linked to its symbol page.
  //
  // ⚠️ Field names verified against the live endpoint (2026-09-11). `/api/scoring/ranked`
  // returns `{ ranked: [...] }` — NOT `scores[]` or `rows[]` (both were wrong first time
  // and produced a section that silently rendered nothing). A row carries `ticker`,
  // `signal`, `score` and `maxPossibleScore`; there is NO precomputed percentage, so it
  // is derived here. Shows the signal word AND the percentage: a bare percentage is not
  // actionable without knowing which side it favours.
  if (userPrefs.tapeScore && scoreQuery.data) {
    const d = scoreQuery.data;
    const row = Array.isArray(d) ? d[0] : (d.ranked?.[0] || d.scores?.[0] || d.rows?.[0] || null);
    if (row && (row.ticker || row.symbol)) {
      const symRaw = String(row.ticker || row.symbol);
      const sym = escapeHtml(symRaw);
      const sigRaw = String(row.signal || '').replace('STRONG_', '') || '—';
      const sig = escapeHtml(sigRaw);
      const max = Number(row.maxPossibleScore) || 0;
      const raw = Number(row.score);
      const pct = Number.isFinite(raw) && max > 0 ? Math.round((raw / max) * 100) : null;
      const sigColor = sigRaw === 'BUY' ? 'var(--color-profit, #22c55e)'
        : sigRaw === 'SELL' ? 'var(--color-loss, #f87171)'
          : 'var(--ink-soft, #94a3b8)';
      sections.push({
        key: 'score', label: 'Score',
        htmlContent: `<a href="/research/symbol/${encodeURIComponent(symRaw)}" style="color:inherit;text-decoration:none">`
          + `<span style="font-weight:700">${sym}</span> `
          + `<span style="color:${sigColor};font-weight:700">${sig}</span>`
          + `${pct != null ? ` ${pct}%` : ''}</a>`,
        color: 'var(--ink-soft, #94a3b8)',
      });
    }
  }

  // 11. App uptime
  if (userPrefs.tapeUptime && uptimeQuery.data) {
    const uptime = uptimeQuery.data?.uptime || uptimeQuery.data?.process?.uptime || 0;
    sections.push({
      key: 'uptime', label: 'Uptime',
      content: `⏱ Up ${fmtUptime(uptime)}`,
      color: 'var(--ink-soft, #94a3b8)',
    });
  }

  /* ── Build ticker tape ──
   *
   * ⚠️ SEAMLESS LOOP (fixed 2026-09-11). The old code emitted exactly TWO copies and
   * animated `translateX(0 → -50%)`. That only loops seamlessly when ONE copy is at
   * least as wide as the viewport — otherwise the track runs out of content, the tail
   * of copy 2 appears, and the whole strip visibly snaps back to the right. Measured
   * live: one copy was 753px in a 1229px window, so the loop was broken by construction.
   *
   * The fix is geometric, not cosmetic. We repeat the content N times and animate by
   * exactly `-100% / N`. At that offset the layout is pixel-identical to the start
   * (copy k sits where copy k+1 was), so the reset is invisible.
   *
   * ⚠️ THE CONDITION IS `oneCopy × (N − 1) ≥ viewport`, NOT `oneCopy ≥ viewport`.
   * The track must still cover the window AFTER one copy has scrolled past. Measured:
   * one copy is ~763px, so a 1214px window needs 3; a 3440px ultrawide needs 6.
   *
   * N is a fixed 8 rather than measured, because a ResizeObserver would re-render on
   * every window drag for a decorative strip. 8 copies keeps the loop seamless up to
   * `763 × 7 ≈ 5.3k px` — beyond any practical display. It costs nothing when unused:
   * the extra copies are off-screen and the strip is a few hundred bytes of text.
   * If N ever changes the CSS keyframe MUST change with it, so N is injected as a CSS
   * variable rather than duplicated in the stylesheet.
   */
  const COPIES = 8;

  // Duration keeps the SCROLL SPEED constant as the number of copies changes. Seconds
  // are PER COPY, so the perceived speed is independent of COPIES — otherwise raising
  // the copy count would make the tape sprint without anyone touching "speed".
  //
  // ⚠️ This is USER-CONFIGURABLE (`tapeScrollSecPerCopy`, Settings → Market Tape). It is
  // a DIFFERENT control from `newsTapeRotateSec` above, which only swaps the news
  // headline — the two were previously adjacent in Settings with no speed control at all,
  // so changing the rotation value looked like it should speed the tape up and did not.
  // Clamped here as well as in the input: a 0 or negative would divide to an invalid
  // animation duration and freeze the strip silently.
  const SECONDS_PER_COPY = Math.min(120, Math.max(2, Number(userPrefs.tapeScrollSecPerCopy) || 12));

  const tapeItems = sections.map((s) => {
    if (s.htmlContent) {
      return `<span class="mkt-tape-section" style="color:${s.color}" data-key="${s.key}"><span class="mkt-tape-label">${s.label}</span> ${s.htmlContent}</span>`;
    }
    return `<span class="mkt-tape-section" style="color:${s.color}" data-key="${s.key}"><span class="mkt-tape-label">${s.label}</span> ${s.content || ''}</span>`;
  });

  const sep = '<span class="mkt-tape-sep">│</span>';
  // One copy ends with a separator so the join between copies is spaced like any other.
  const oneCopy = tapeItems.join(sep) + sep;
  const repeated = sections.length > 0
    ? oneCopy.repeat(COPIES)
    : '<span class="mkt-tape-section" style="color:var(--ink-soft)">All sections hidden — open Settings → Market Tape to choose what shows</span>';

  /* ── Screen-reader live region — ONE copy, not eight ──
   *
   * ⚠️ WHAT WAS WRONG (fixed 2026-09-18). `aria-live="polite" aria-atomic="true"` sat on
   * the `.market-tape` WRAPPER, and the seamless-loop fix (2026-09-11) had just put EIGHT
   * identical copies of every section inside that wrapper. `aria-atomic="true"` means the
   * whole region is re-announced whenever any part of it changes — and `dangerouslySetInnerHTML`
   * rewrites the track's entire innerHTML on every render, while the news headline rotates
   * every 30s on purpose. Net effect: a screen-reader user was read the complete tape,
   * eight times over, roughly every 30 seconds.
   *
   * The two fixes were individually correct and combined badly: one made the strip wider,
   * the other promised to narrate it. That is why the live region now lives here, on a
   * single visually-hidden copy, and the track is left as plain content.
   *
   * ⚠️ The track is deliberately NOT `aria-hidden`. Hiding it would also remove its only
   * link (the latest score's symbol) from screen-reader reach, and an `aria-hidden` ancestor
   * containing a focusable element is its own WCAG 4.1.2 failure. Duplicated text that must
   * be navigated into is a far smaller problem than a control that cannot be reached.
   *
   * Only genuine changes are announced: if the computed text is identical React does not
   * touch the DOM, so no mutation fires.
   */
  const liveSummary = sections.length > 0
    ? sections.map((s) => `${s.label}: ${s.content || stripTags(s.htmlContent || '')}`).join(' · ')
    : 'All market tape sections hidden.';

  return (
    <div className="market-tape" aria-label="Market status ticker">
      <p className="sr-only-alert" aria-live="polite" aria-atomic="true">
        {liveSummary}
      </p>
      <div
        className="mkt-tape-track"
        style={{
          '--mkt-tape-copies': COPIES,
          '--mkt-tape-duration': `${COPIES * SECONDS_PER_COPY}s`,
        }}
        dangerouslySetInnerHTML={{ __html: repeated }}
      />
      {/* The gear goes to the REAL settings surface rather than a private popover.
          A tape-only configuration UI is a second source of truth: the two lists
          drift, and a section added to one silently misses the other.
          ⚠️ 2026-09-16 (§617): the tape controls moved from General to Appearance, so this
          target changed with them. `?section=market-tape` matches the `id` on that page's
          section — if either half is renamed the gear still renders and still navigates,
          it just lands at the top of the page instead of on the control, with no error. */}
      <button
        className="mkt-tape-gear"
        onClick={() => navigate('/settings/appearance?section=market-tape')}
        title="Configure the market tape in Appearance settings"
        aria-label="Configure the market tape in Appearance settings"
      >
        ⚙
      </button>
    </div>
  );
}
