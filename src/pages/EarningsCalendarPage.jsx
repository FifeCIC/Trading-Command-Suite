import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  fetchEarningsCalendar,
  fetchEarningsSettings,
  fetchEarningsImportStatus,
  updateEarningsSettings,
  importEarnings,
} from '../core/api/research.js';
import './earnings-calendar.css';

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

export default function EarningsCalendarPage() {
  const [sectorFilter, setSectorFilter] = useState('all');
  const [expandedSym, setExpandedSym] = useState(null);
  const [selectedMonth, setSelectedMonth] = useState(3); // default 3 months
  const [settingsDraft, setSettingsDraft] = useState(null);
  const [settingsMsg, setSettingsMsg] = useState(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['earnings-calendar', selectedMonth],
    queryFn: () => fetchEarningsCalendar({ months: selectedMonth }),
    staleTime: 15 * 60 * 1000, // 15 min — earnings calendar doesn't change rapidly
  });

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
      setSettingsMsg(`Save failed: ${e?.message || e}`);
    }
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
      setSettingsMsg(`Import failed to start: ${e?.message || e}`);
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

  const grouped = useMemo(() => {
    const filtered = sectorFilter === 'all' ? events : events.filter((e) => e.sector === sectorFilter);
    const groups = {};
    filtered.forEach((e) => {
      const wk = getWeekLabel(e.reportDate);
      if (!groups[wk]) groups[wk] = [];
      groups[wk].push(e);
    });
    return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]));
  }, [events, sectorFilter]);

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
          <p>Failed to load earnings data.</p>
          <p className="ec-error-detail">{error?.message || 'Unknown error'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="ec-page">
      <header className="ec-header">
        <h1>Earnings Calendar</h1>
        <p className="ec-subtitle">
          {data?.count ?? 0} upcoming earnings reports from {data?.source === 'nasdaq' ? 'Nasdaq (fallback)' : 'Finnhub'}.
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
            <button type="button" className="ec-btn" onClick={doImport}>Import now</button>
            <span className="ec-settings-msg">{settingsMsg ?? ''}</span>
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

      <div className="ec-filters">
        <div className="ec-field">
          <label>Horizon</label>
          <div className="ec-chip-tabs">
            {[1, 2, 3].map((m) => (
              <button key={m} type="button" className={`ec-chip ${selectedMonth === m ? 'ec-chip-active' : ''}`} onClick={() => setSelectedMonth(m)}>
                {m} month{m > 1 ? 's' : ''}
              </button>
            ))}
          </div>
        </div>
        <div className="ec-field">
          <label>Sector</label>
          <div className="ec-chip-tabs">
            {sectors.map((s) => (
              <button key={s} type="button" className={`ec-chip ${sectorFilter === s ? 'ec-chip-active' : ''}`} onClick={() => setSectorFilter(s)}>
                {s === 'all' ? 'All Sectors' : s}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Empty State ── */}
      {grouped.length === 0 && (
        <div className="ec-empty">
          <p>No upcoming earnings found{data?.count > 0 ? ' for this filter' : ''}.</p>
          <p className="ec-empty-hint">Try a longer horizon or remove the sector filter.</p>
        </div>
      )}

      {grouped.map(([week, reports]) => (
        <section key={week} className="ec-week">
          <h2 className="ec-week-label">{week} <span className="ec-count">{reports.length} reports</span></h2>
          <div className="ec-table-wrap">
            <table className="ec-table">
              <thead>
                <tr>
                  <th>Symbol</th><th>Company</th><th>Date</th><th>Time</th>
                  <th className="ec-right">EPS Est</th><th className="ec-right">Rev Est</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r, idx) => {
                  const isExpanded = expandedSym === r.symbol;
                  return (
                    <tr key={r.symbol + '-' + idx} className={`ec-row ${isExpanded ? 'ec-row-expanded' : ''}`} onClick={() => setExpandedSym(isExpanded ? null : r.symbol)}>
                      <td className="ec-sym">{r.symbol}</td>
                      <td>{r.name || r.companyName || r.symbol}</td>
                      <td>{r.reportDate}</td>
                      <td><span className={`ec-time-badge ${r.timeOfDay === 'After Close' ? 'ec-time-pm' : r.timeOfDay === 'Before Open' ? 'ec-time-am' : 'ec-time-na'}`}>{r.timeOfDay || 'Unknown'}</span></td>
                      <td className="ec-right ec-mono">{r.epsEstimate != null ? `$${r.epsEstimate}` : '—'}</td>
                      <td className="ec-right ec-mono">{formatRev(r.revenueEstimate)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
