import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchEarningsCalendar,
  fetchEarningsSettings,
  fetchEarningsImportStatus,
  updateEarningsSettings,
  importEarnings,
  purgeEarningsData,
} from '../core/api/research.js';
import '../core/forms.css'; // canonical Form System (.ff-*) — segmented + compact .ff-bar
import NoticeBlock from '../components/NoticeBlock';
import { noticeFromError } from '../core/notices/from-error.js';
import RegisterSymbolOverlay from '../components/RegisterSymbolOverlay.jsx';
import './earnings-calendar.css';

/** Hard cap on rendered rows — 5k+ DOM rows chokes the page. */
const RENDER_CAP = 400;

function getWeekLabel(dateStr) {
  const d = new Date(dateStr);
  const startOfMonth = new Date(d.getFullYear(), d.getMonth(), 1);
  const diffDays = Math.floor((d - startOfMonth) / (1000 * 60 * 60 * 24));
  const weekNum = Math.floor(diffDays / 7) + 1;
  const monthName = d.toLocaleString('en-US', { month: 'short' });
  return `${monthName} W${weekNum}`;
}

function formatRev(val) {
  if (val == null) return '—';
  if (val >= 1e9) return `${(val / 1e9).toFixed(1)}B`;
  if (val >= 1e6) return `${(val / 1e6).toFixed(1)}M`;
  return `${val}`;
}

function scopeLabelMap(sc) {
  return { all: 'All symbols', watchlist: 'Watchlist only', portfolio: 'Portfolio only' }[sc] ?? sc;
}

function localDateStr(d) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

/** True when reportDate falls inside the selected time window. */
function inWindow(dateStr, w) {
  if (w === 'all') return true;
  const d = new Date(dateStr + 'T00:00:00');
  const t0 = new Date(localDateStr(new Date()) + 'T00:00:00');
  const diff = Math.round((d - t0) / 86400000);
  if (w === 'today') return diff === 0;
  if (w === 'tomorrow') return diff === 1;
  if (w === 'week') return diff >= 0 && diff <= 6;
  if (w === 'nextWeek') return diff >= 7 && diff <= 13;
  return true;
}

function capBucket(cap) {
  if (cap == null) return null;
  if (cap >= 200e9) return 'mega';
  if (cap >= 10e9) return 'large';
  if (cap >= 2e9) return 'mid';
  return 'small';
}

const CAP_LABELS = { mega: 'Mega ≥$200B', large: 'Large $10–200B', mid: 'Mid $2–10B', small: 'Small <$2B' };

// ── Table sorting ────────────────────────────────────────
// One accessor per column; null/undefined/'' always sorts LAST regardless
// of direction (so '—' rows sink instead of interleaving with data).
const SORT_ACCESSORS = {
  symbol: (r) => r.symbol ?? '',
  company: (r) => (r.name || r.companyName || r.symbol || '').toLowerCase(),
  date: (r) => r.reportDate ?? '',
  time: (r) => ({ 'Before Open': 0, 'After Close': 1 })[r.timeOfDay] ?? 2,
  epsEst: (r) => r.epsEstimate,
  priorEps: (r) => r.lastYearEps,
  revEst: (r) => r.revenueEstimate,
  mktCap: (r) => r.marketCap,
};

function compareRows(a, b, key, dir) {
  const va = SORT_ACCESSORS[key](a);
  const vb = SORT_ACCESSORS[key](b);
  const aNull = va == null || va === '';
  const bNull = vb == null || vb === '';
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;
  const cmp = typeof va === 'number'
    ? va - vb
    : String(va).localeCompare(String(vb), undefined, { numeric: true });
  return dir === 'asc' ? cmp : -cmp;
}

export default function EarningsCalendarPage() {
  const [sectorFilter, setSectorFilter] = useState('all');
  const [expandedSym, setExpandedSym] = useState(null);
  const [selectedMonth, setSelectedMonth] = useState(3); // default 3 months
  const [windowFilter, setWindowFilter] = useState('all'); // all|today|tomorrow|week|nextWeek
  const [sessionFilter, setSessionFilter] = useState('all'); // all|bmo|amc
  const [capFilter, setCapFilter] = useState('all'); // all|mega|large|mid|small
  const [estimatesOnly, setEstimatesOnly] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState(null);
  const [settingsMsg, setSettingsMsg] = useState(null);
  // Failures are kept SEPARATE from `settingsMsg`, which also carries progress and success text.
  // Mixing them meant a failure had to be squeezed into a status string ("Save failed: …"), which
  // is where its code, status and remedy were lost.
  const [settingsNotice, setSettingsNotice] = useState(null);
  const [showAll, setShowAll] = useState(false); // renders all rows (heavy — opt-in)
  const [sortKey, setSortKey] = useState(null); // column id, or null = API order
  const [sortDir, setSortDir] = useState('asc');

  /** Click a header: same column toggles asc⇄desc, new column starts asc. */
  const toggleSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };
  const sortIcon = (key) => (sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '');
  const ariaSort = (key) => (sortKey === key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['earnings-calendar', selectedMonth],
    queryFn: () => fetchEarningsCalendar({ months: selectedMonth }),
    staleTime: 15 * 60 * 1000, // 15 min — earnings calendar doesn't change rapidly
  });

  // Required by saveSettings() below to invalidate the calendar after a purge.
  // See the comment at that call site — this hook was MISSING and its absence
  // was a ReferenceError masked as a "Save & apply failed" message.
  const queryClient = useQueryClient();

  const settingsQuery = useQuery({
    queryKey: ['earnings-settings'],
    queryFn: fetchEarningsSettings,
    staleTime: 60 * 1000,
  });

  const statusQuery = useQuery({
    queryKey: ['earnings-import-status'],
    queryFn: fetchEarningsImportStatus,
    // Poll every 4s while an import runs (cheap count query), else every 30s.
    refetchInterval: (q) => (q.state.data?.running ? 4000 : 30000),
  });

  // ── Settings edit flow ──────────────────────────────────────────
  // Edits are staged in settingsDraft and only sent to the API on
  // "Save settings". The panel reads `s` = draft ?? server copy, so the
  // summary row reflects in-progress edits without touching the backend.
  // Saving PUTs the draft, clears it, and refetches both queries — the
  // backend reschedules the scheduled_job row on the PUT itself.
  const savedSettings = settingsQuery.data ?? {};
  const s = settingsDraft ?? savedSettings;
  const setField = (patch) => {
    setSettingsDraft((prev) => ({ ...(prev ?? savedSettings), ...patch }));
  };

  const saveSettings = async () => {
    try {
      const saved = await updateEarningsSettings(settingsDraft ?? {});
      setSettingsDraft(null);
      setSettingsMsg('Settings saved.');
      settingsQuery.refetch();
      statusQuery.refetch();
      setTimeout(() => setSettingsMsg(null), 4000);
    } catch (e) {
        setSettingsMsg(null);
        setSettingsNotice(noticeFromError(e, 'TCS-SYS-007', { operation: 'save the earnings settings' }));
    }
  };

  const saveAndApply = async () => {
    setSettingsMsg('Saving settings & purging non-matching rows…');
    try {
      await updateEarningsSettings(settingsDraft ?? {});
      setSettingsDraft(null);
      const purgeRes = await purgeEarningsData();
      setSettingsMsg(
        `Settings saved. Purged ${purgeRes?.removed ?? 0} rows (${purgeRes?.kept ?? 0} kept).`,
      );
      settingsQuery.refetch();
      statusQuery.refetch();
      // ⚠️ `queryClient.invalidateQueries(...)` used to be called here, but
      // `queryClient` was never imported or instantiated — so this threw a
      // ReferenceError. Because the throw happened AFTER the settings were
      // saved and the purge succeeded, the user saw "Save & apply failed:
      // queryClient is not defined" even though the operation had worked, and
      // the calendar never refreshed.
      //
      // The calendar query's key is ['earnings-calendar', selectedMonth], so
      // invalidating the 'earnings-calendar' PREFIX is what refreshes the month
      // grid — and it is deliberately a prefix rather than a refetch, because
      // the purge may have changed months the user has already browsed.
      queryClient.invalidateQueries({ queryKey: ['earnings-calendar'] });
      setShowAll(false);
    } catch (e) {
        setSettingsNotice(noticeFromError(e, 'TCS-SYS-007', { operation: 'save and apply the earnings settings' }));
    }
    setTimeout(() => setSettingsMsg(null), 8000);
  };

  const doImport = async () => {
    setSettingsMsg('Import started — it runs in the background.');
    try {
      // Fire-and-forget: the backend returns { started } immediately and the
      // import runs detached; progress is read from the status query's poll.
      const res = await importEarnings();
      if (!res?.started) setSettingsMsg('An import is already running.');
      statusQuery.refetch();
    } catch (e) {
        setSettingsNotice(noticeFromError(e, 'TCS-SYS-007', { operation: 'start the import' }));
    }
    setTimeout(() => setSettingsMsg(null), 6000);
  };

  const lastImport = statusQuery.data?.lastImport;
  const scopeLabel = scopeLabelMap(s.scope);
  const nextRunAt = statusQuery.data?.nextRunAt;
  const nextRunText = nextRunAt ? new Date(nextRunAt).toLocaleString() : null;
  const sessionLabel = { all: 'Any session', bmo: 'Before open', amc: 'After close' }[s.timeOfDay] ?? s.timeOfDay;

  const events = data?.events ?? [];
  const sectors = useMemo(() => {
    const set = new Set();
    events.forEach((e) => { if (e.sector) set.add(e.sector); });
    return ['all', ...Array.from(set).sort()];
  }, [events]);

  // ── Filtering + display cap ─────────────────────────────────
  // 5k+ rows is a real DOM problem (multi-MB snapshots, janky scroll).
  // Compute the filtered set first, then cap RENDERING at RENDER_CAP with a
  // "Show all" opt-in — grouping/filtering always sees the full set.
  const filteredEvents = useMemo(() => {
    return events.filter((e) => {
      if (sectorFilter !== 'all' && e.sector !== sectorFilter) return false;
      if (!inWindow(e.reportDate, windowFilter)) return false;
      if (sessionFilter === 'bmo' && e.timeOfDay !== 'Before Open') return false;
      if (sessionFilter === 'amc' && e.timeOfDay !== 'After Close') return false;
      if (capFilter !== 'all') {
        const bucket = capBucket(e.marketCap);
        if (bucket !== capFilter) return false; // null-cap rows drop when a bucket is chosen
      }
      if (estimatesOnly && e.epsEstimate == null) return false;
      return true;
    });
  }, [events, sectorFilter, windowFilter, sessionFilter, capFilter, estimatesOnly]);

  // Sorting runs BEFORE the render cap so "first N" honours the sort order
  // (e.g. top market caps, not just the earliest dates).
  const sortedEvents = useMemo(() => {
    if (!sortKey) return filteredEvents;
    return [...filteredEvents].sort((a, b) => compareRows(a, b, sortKey, sortDir));
  }, [filteredEvents, sortKey, sortDir]);

  const grouped = useMemo(() => {
    const visible = showAll ? sortedEvents : sortedEvents.slice(0, RENDER_CAP);
    const groups = {};
    visible.forEach((e) => {
      const wk = getWeekLabel(e.reportDate);
      if (!groups[wk]) groups[wk] = [];
      groups[wk].push(e);
    });
    return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]));
  }, [sortedEvents, showAll]);

  // ── Loading State ──
  if (isLoading) {
    return (
      <div className="ec-page">
        <header className="ec-header">
          <h1>Earnings Calendar</h1>
        </header>
        <div className="ec-loading">Loading earnings calendar…</div>
      </div>
    );
  }

  // ── Error State ──
  if (isError) {
    return (
      <div className="ec-page">
        <header className="ec-header">
          <h1>Earnings Calendar</h1>
        </header>
        <div className="ec-error">
          <NoticeBlock notice={noticeFromError(error)} />
        </div>
      </div>
    );
  }

  return (
    <div className="ec-page">
      <header className="ec-header">
        <h1>Earnings Calendar</h1>
        <p className="ec-subtitle">
          {data?.count ?? 0} upcoming earnings reports from{' '}
          {data?.source === 'db'
            ? 'stored data (imported from Finnhub + Nasdaq)'
            : data?.source === 'nasdaq'
              ? 'Nasdaq (live fallback)'
              : data?.source === 'finnhub'
                ? 'Finnhub (live)'
                : 'no source'}.
          <span className="ec-source"> Data refreshes every 15 min.</span>
        </p>
      </header>

      {/* ── Import Settings Panel ── */}
      <details className="ec-settings-card">
        <summary className="ec-settings-summary">
          <span>Import settings</span>
          <span className="ec-settings-current">
            {scopeLabel} · {sessionLabel} · {s.minMarketCap > 0 ? `≥$${(s.minMarketCap / 1e9).toFixed(1)}B` : 'any cap'}
            {s.requireKnownSession ? ' · known session only' : ''} · {s.autoImportEnabled ? `${s.scheduleDays} ${s.scheduleTime}` : 'auto off'}
          </span>
        </summary>
        <div className="ec-settings-body">
          <div className="ec-field">
            <label>Import scope</label>
            <div className="ec-chip-tabs">
              {['all', 'watchlist', 'portfolio'].map((sc) => (
                <button key={sc} type="button" className={`ec-chip ${s.scope === sc ? 'ec-chip-active' : ''}`} onClick={() => setField({ scope: sc })}>
                  {scopeLabelMap(sc)}
                </button>
              ))}
            </div>
            <p className="ec-field-hint">
              'all' imports every symbol the sources report; watchlist/portfolio only keeps symbols you already track.
            </p>
          </div>

          <div className="ec-field">
            <label>Session</label>
            <div className="ec-chip-tabs">
              {['all', 'bmo', 'amc'].map((td) => (
                <button key={td} type="button" className={`ec-chip ${s.timeOfDay === td ? 'ec-chip-active' : ''}`} onClick={() => setField({ timeOfDay: td })}>
                  {{ all: 'Any session', bmo: 'Before open', amc: 'After close' }[td]}
                </button>
              ))}
            </div>
          </div>

          <div className="ec-field">
            <label>Min market cap ($B, 0 = off)</label>
            <input
              type="number"
              className="ec-input"
              min="0"
              step="0.1"
              value={s.minMarketCap > 0 ? (s.minMarketCap / 1e9).toFixed(1) : ''}
              placeholder="0"
              onChange={(e) => setField({ minMarketCap: Math.max(0, parseFloat(e.target.value) || 0) * 1e9 })}
            />
            <p className="ec-field-hint">
              Applied where the source provides market cap (Nasdaq does, Finnhub doesn't) — unknown-cap events are kept.
            </p>
          </div>

          <div className="ec-field">
            <label>Import horizon</label>
            <select className="ec-input" value={s.horizonMonths ?? 3} onChange={(e) => setField({ horizonMonths: parseInt(e.target.value, 10) })}>
              {[1, 2, 3, 6, 12].map((m) => (
                <option key={m} value={m}>{m} month{m > 1 ? 's' : ''}</option>
              ))}
            </select>
          </div>

          <div className="ec-field">
            <label>
              <input
                type="checkbox"
                checked={s.autoImportEnabled !== false}
                onChange={(e) => setField({ autoImportEnabled: e.target.checked })}
              />
              {' '}Auto-import via the job queue (scheduled_job)
            </label>
            <p className="ec-field-hint">
              Runs through the unified job queue on every automation tick — visible under Automation → Jobs.
            </p>
          </div>

          <div className="ec-field">
            <label>Schedule time</label>
            <input
              type="time"
              className="ec-input"
              value={s.scheduleTime ?? '07:00'}
              onChange={(e) => e.target.value && setField({ scheduleTime: e.target.value })}
            />
          </div>

          <div className="ec-field">
            <label>Schedule days</label>
            <div className="ec-chip-tabs">
              {['daily', 'weekdays'].map((d) => (
                <button key={d} type="button" className={`ec-chip ${s.scheduleDays === d ? 'ec-chip-active' : ''}`} onClick={() => setField({ scheduleDays: d })}>
                  {d === 'daily' ? 'Every day' : 'Weekdays only'}
                </button>
              ))}
            </div>
          </div>

          <div className="ec-field">
            <label>
              <input
                type="checkbox"
                checked={s.requireKnownSession === true}
                onChange={(e) => setField({ requireKnownSession: e.target.checked })}
              />
              {' '}Only events with a known session (BMO/AMC)
            </label>
            <p className="ec-field-hint">
              Drops reports whose pre/post-market session is unknown — keeps the calendar cleaner.
            </p>
          </div>

          <div className="ec-settings-actions">
            <button type="button" className="ec-btn ec-btn-primary" onClick={saveSettings}>Save settings</button>
            <button type="button" className="ec-btn ec-btn-danger" onClick={saveAndApply} title="Save settings and delete stored rows that no longer match them (future reports only)">Save &amp; apply (purge)</button>
            <button type="button" className="ec-btn" onClick={doImport}>Import now</button>
            <span className="ec-settings-msg">{settingsMsg ?? ''}</span>
        {settingsNotice && <NoticeBlock notice={settingsNotice} compact />}
          </div>

          <div className="ec-import-status">
            {statusQuery.data?.running
              ? '⏳ Import running — polling status…'
              : lastImport
                ? `Last import ${lastImport.filters?.scope ?? '—'} @ ${lastImport.at} — ${lastImport.total ?? 0} stored of ${lastImport.fetched ?? 0} fetched`
                  + ` (${lastImport.dropped?.droppedScope ?? 0} scope / ${lastImport.dropped?.droppedSession ?? 0} session / ${lastImport.dropped?.droppedMarketCap ?? 0} cap dropped, source ${lastImport.source ?? '—'})`
                : 'No import recorded yet — the scheduled job or Import now will populate the database.'}
            {nextRunText ? ` Next scheduled run: ${nextRunText}.` : ''}
            <span className="ec-stored-count"> · {statusQuery.data?.storedEvents ?? 0} events in DB</span>
          </div>
        </div>
      </details>

      <div className="ff-bar">
        {/* Horizon — segmented (low-cardinality) */}
        <div className="ff-field">
          <span className="ff-label">Horizon</span>
          <div className="ff-seg" role="group" aria-label="Horizon">
            {[1, 2, 3].map((m) => (
              <button
                key={`m-${m}`}
                type="button"
                className={`ff-seg-btn ${selectedMonth === m ? 'ff-seg-btn--active' : ''}`}
                aria-pressed={selectedMonth === m}
                onClick={() => setSelectedMonth(m)}
              >
                {m}mo
              </button>
            ))}
          </div>
        </div>

        {/* Sector — high-cardinality, compact dropdown instead of inline pills */}
        <div className="ff-field">
          <label className="ff-label" htmlFor="ec-sector-filter">Sector</label>
          <select
            id="ec-sector-filter"
            className="ff-select"
            value={sectorFilter}
            onChange={(e) => setSectorFilter(e.target.value)}
          >
            {sectors.map((s) => (
              <option key={`s-${s}`} value={s}>{s === 'all' ? 'All Sectors' : s}</option>
            ))}
          </select>
        </div>

        {/* Time window — segmented */}
        <div className="ff-field">
          <span className="ff-label">Time window</span>
          <div className="ff-seg" role="group" aria-label="Time window">
            {[
              ['all', 'All'],
              ['today', 'Today'],
              ['tomorrow', 'Tomorrow'],
              ['week', 'This Week'],
              ['nextWeek', 'Next Week'],
            ].map(([w, label]) => (
              <button
                key={`w-${w}`}
                type="button"
                className={`ff-seg-btn ${windowFilter === w ? 'ff-seg-btn--active' : ''}`}
                aria-pressed={windowFilter === w}
                onClick={() => setWindowFilter(w)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Session — segmented */}
        <div className="ff-field">
          <span className="ff-label">Session</span>
          <div className="ff-seg" role="group" aria-label="Session">
            {[
              ['all', 'Any'],
              ['bmo', '☀️ BMO'],
              ['amc', '🌙 AMC'],
            ].map(([s2, label]) => (
              <button
                key={`sd-${s2}`}
                type="button"
                className={`ff-seg-btn ${sessionFilter === s2 ? 'ff-seg-btn--active' : ''}`}
                aria-pressed={sessionFilter === s2}
                onClick={() => setSessionFilter(s2)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Market cap — segmented */}
        <div className="ff-field">
          <span className="ff-label">Market cap</span>
          <div className="ff-seg" role="group" aria-label="Market cap">
            {[
              ['all', 'Any'],
              ['mega', 'Mega'],
              ['large', 'Large'],
              ['mid', 'Mid'],
              ['small', 'Small'],
            ].map(([c, label]) => (
              <button
                key={`c-${c}`}
                type="button"
                className={`ff-seg-btn ${capFilter === c ? 'ff-seg-btn--active' : ''}`}
                aria-pressed={capFilter === c}
                onClick={() => setCapFilter(c)}
                title={CAP_LABELS[c]}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Estimates only — labelled checkbox */}
        <label className="ff-checkbox-label" style={{ paddingBottom: '0.3rem' }}>
          <input type="checkbox" checked={estimatesOnly} onChange={(e) => setEstimatesOnly(e.target.checked)} />
          <span>Estimates only</span>
        </label>
      </div>

      {/* ── Empty State ── */}
      {grouped.length === 0 && (
        <div className="ec-empty">
          <p>No upcoming earnings found{data?.count > 0 ? ' for this filter' : ''}.</p>
          <p className="ec-empty-hint">Try a longer horizon or remove the sector filter.</p>
        </div>
      )}

      {/* ── Display cap notice ── */}
      {filteredEvents.length > RENDER_CAP && !showAll && (
        <div className="ec-cap-notice">
          Showing the first {RENDER_CAP} of {filteredEvents.length} reports to keep the page fast.
          <button type="button" className="ec-chip" onClick={() => setShowAll(true)}>
            Show all {filteredEvents.length} (may be slow)
          </button>
        </div>
      )}

      {grouped.map(([week, reports]) => (
        <section key={week} className="ec-week">
          <h2 className="ec-week-label">{week} <span className="ec-count">{reports.length} reports</span></h2>
          <div className="ec-table-wrap">
            <table className="ec-table">
              <thead>
                <tr>
                  <th aria-sort={ariaSort('symbol')}>
                    <button type="button" className={`ec-th-sort ${sortKey === 'symbol' ? 'ec-sort-active' : ''}`} onClick={() => toggleSort('symbol')}>Symbol{sortIcon('symbol')}</button>
                  </th>
                  <th aria-sort={ariaSort('company')}>
                    <button type="button" className={`ec-th-sort ${sortKey === 'company' ? 'ec-sort-active' : ''}`} onClick={() => toggleSort('company')}>Company{sortIcon('company')}</button>
                  </th>
                  <th aria-sort={ariaSort('date')}>
                    <button type="button" className={`ec-th-sort ${sortKey === 'date' ? 'ec-sort-active' : ''}`} onClick={() => toggleSort('date')}>Date{sortIcon('date')}</button>
                  </th>
                  <th aria-sort={ariaSort('time')}>
                    <button type="button" className={`ec-th-sort ${sortKey === 'time' ? 'ec-sort-active' : ''}`} onClick={() => toggleSort('time')}>Time{sortIcon('time')}</button>
                  </th>
                  <th className="ec-right" aria-sort={ariaSort('epsEst')}>
                    <button type="button" className={`ec-th-sort ${sortKey === 'epsEst' ? 'ec-sort-active' : ''}`} onClick={() => toggleSort('epsEst')}>EPS Est{sortIcon('epsEst')}</button>
                  </th>
                  <th className="ec-right" aria-sort={ariaSort('priorEps')}>
                    <button type="button" className={`ec-th-sort ${sortKey === 'priorEps' ? 'ec-sort-active' : ''}`} onClick={() => toggleSort('priorEps')}>Prior EPS{sortIcon('priorEps')}</button>
                  </th>
                  <th className="ec-right" aria-sort={ariaSort('revEst')}>
                    <button type="button" className={`ec-th-sort ${sortKey === 'revEst' ? 'ec-sort-active' : ''}`} onClick={() => toggleSort('revEst')}>Rev Est{sortIcon('revEst')}</button>
                  </th>
                  <th className="ec-right" aria-sort={ariaSort('mktCap')}>
                    <button type="button" className={`ec-th-sort ${sortKey === 'mktCap' ? 'ec-sort-active' : ''}`} onClick={() => toggleSort('mktCap')}>Mkt Cap{sortIcon('mktCap')}</button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r, idx) => {
                  const isExpanded = expandedSym === r.symbol;
                  const isToday = r.reportDate === localDateStr(new Date());
                  const priorPct =
                    r.epsEstimate != null && r.lastYearEps != null && r.lastYearEps !== 0
                      ? Math.round(((r.epsEstimate - r.lastYearEps) / Math.abs(r.lastYearEps)) * 100)
                      : null;
                  return (
                    <tr
                      key={r.symbol + '-' + idx}
                      className={`ec-row ${isExpanded ? 'ec-row-expanded' : ''} ${isToday ? 'ec-row-today' : ''}`}
                      onClick={() => setExpandedSym(isExpanded ? null : r.symbol)}
                      /* ⚠️ KEYBOARD PATH (accessibility policy). A row that only answers a pointer is
                         one a keyboard user cannot open. `tabIndex` + Enter/Space is the fix that does
                         NOT change the row's role — setting `role="button"` here would remove the row
                         from the table and break screen-reader table navigation, which is worse. */
                      tabIndex={0}
                      title="Open symbol actions — register this symbol or add it to a watchlist"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setExpandedSym(isExpanded ? null : r.symbol);
                        }
                      }}
                    >
                      <td className="ec-sym">
                        {r.tracked ? <span className="ec-tracked-star" title="In your watchlist or portfolio">★</span> : null}
                        {r.symbol}
                      </td>
                      <td>{r.name || r.companyName || r.symbol}</td>
                      <td>{r.reportDate}{isToday ? ' (today)' : ''}</td>
                      <td>
                        <span className={`ec-time-badge ${r.timeOfDay === 'After Close' ? 'ec-time-pm' : r.timeOfDay === 'Before Open' ? 'ec-time-am' : 'ec-time-na'}`}>
                          {r.timeOfDay === 'Before Open' ? '☀️ Before Open' : r.timeOfDay === 'After Close' ? '🌙 After Close' : 'Unscheduled'}
                        </span>
                      </td>
                      <td className="ec-right ec-mono">{r.epsEstimate != null ? `$${r.epsEstimate}` : '—'}</td>
                      <td className="ec-right ec-mono">
                        {r.lastYearEps != null ? `$${r.lastYearEps}` : '—'}
                        {priorPct != null ? (
                          <span className={priorPct >= 0 ? 'ec-delta ec-delta-up' : 'ec-delta ec-delta-down'} title={`${priorPct >= 0 ? '+' : ''}${priorPct}% vs prior-year quarter`}>
                            {' '}{priorPct >= 0 ? '▲' : '▼'}{Math.abs(priorPct)}%
                          </span>
                        ) : null}
                      </td>
                      <td className="ec-right ec-mono">{formatRev(r.revenueEstimate)}</td>
                      <td className="ec-right ec-mono ec-cap">{r.marketCap != null ? formatRev(r.marketCap) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      {/* ⚠️ THE SHARED OVERLAY, driven by the row state that already existed. Clicking a row set
          `expandedSym` before this change and NOTHING rendered from it — a buried ability. Rather
          than add a second piece of state, the row toggle now opens the overlay and `onClose`
          clears it, so Escape, the close button and re-clicking the row all agree. */}
      {expandedSym && (
        <RegisterSymbolOverlay ticker={expandedSym} onClose={() => setExpandedSym(null)} />
      )}
    </div>
  );
}
