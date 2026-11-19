/**
 * BacktestPeriodsPanel — capture a WINDOW, name it, and reuse it (#986).
 * ======================================================================
 *
 * Pipeline position:
 *   capture  POST /api/backtest/periods/import  → create + fetch bars, idempotently
 *   measure  POST /api/backtest/run { periodId } → the engine loads ONLY that window
 *   replay   POST /api/replay/run   { periodId } → #819 walks the same window
 *
 * ⚠️ WHY THIS IS A PANEL AND NOT A NEW PAGE. The engine and the replay both hang off the backtest
 * page already, and `shared-core.instructions.md` / #965 item 5 both say a fourth surface for the
 * same job is churn. The project's requirement is that a window is CAPTURED and REUSED — that is a
 * control on the page that runs it, not a destination of its own.
 *
 * ⚠️ THE PROJECT'S OWN WORDS DEFINE THE FEATURE: *"the 300% surge of Greenland Mining when Trump
 * signed a deal, over just 2 days. I will use the manual tool to capture that period and store it
 * for many tests."* So the NAME and the NOTE are the point — a list of date ranges is unreadable,
 * and a window nobody can identify is one that gets measured twice by accident.
 *
 * ⚠️ THE OUTCOME IS THREE-VALUED AND NEVER COLLAPSED. `imported` / `no-bars` /
 * `provider-unavailable` are different claims (see TCS-DATA-007/008/009), and this renders each as
 * its own notice. Rendering a zero-bar capture as a quiet success would report "the market did
 * nothing" when the real finding may be "we never looked".
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiPatch, apiDelete } from '../../core/api/client';
import NoticeBlock from '../NoticeBlock';
import { notice } from '../../core/notices/registry';
import { noticeFromError } from '../../core/notices/from-error.js';
import { groupPeriods, setHealth } from '../../core/backtest/period-sets.js';
import './backtest-panel-base.css';
import './backtest-periods-panel.css';

const TIMEFRAMES = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'];

/** An ISO date input value (`YYYY-MM-DD`) → a full instant, in UTC. */
function toInstant(dateOnly, endOfDay = false) {
  if (!dateOnly) return '';
  return `${dateOnly}T${endOfDay ? '23:59:59' : '00:00:00'}.000Z`;
}

/** `2026-03-11T00:00:00.000Z` → `2026-03-11 00:00` (UTC), for a table that stays readable. */
function shortStamp(iso) {
  if (!iso) return '—';
  return iso.slice(0, 16).replace('T', ' ');
}

/**
 * The notice for an import outcome. ⚠️ `no-bars` and `provider-unavailable` deliberately do NOT
 * map to the success code — that mapping is the defect the three codes exist to prevent.
 */
function importNotice(result) {
  if (!result) return null;
  const { outcome, symbol, timeframe, requestedFrom, requestedTo, fetched, inserted, alreadyPresent, provider } = result;
  const params = {
    symbol, timeframe,
    from: shortStamp(requestedFrom),
    to: shortStamp(requestedTo),
    fetched, inserted, alreadyPresent,
    provider: provider ?? '—',
  };
  if (outcome === 'imported') return notice('TCS-DATA-007', params);
  if (outcome === 'no-bars') return notice('TCS-DATA-008', params);
  return notice('TCS-DATA-009', params);
}

export default function BacktestPeriodsPanel({ onRunPeriod }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [symbol, setSymbol] = useState('');
  const [timeframe, setTimeframe] = useState('1d');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [selected, setSelected] = useState('');
  const [lastImport, setLastImport] = useState(null);
  const [open, setOpen] = useState(false);
  /**
   * Library state. `expanded` holds set keys so several sets can be open at once — a library where
   * opening one closes another is a slideshow, not a library.
   */
  const [expanded, setExpanded] = useState(() => new Set());
  const [editingKey, setEditingKey] = useState(null);
  const [draftName, setDraftName] = useState('');
  const [draftNote, setDraftNote] = useState('');
  const [confirmDeleteKey, setConfirmDeleteKey] = useState(null);

  const listQuery = useQuery({
    queryKey: ['bt-periods'],
    queryFn: () => apiGet('/api/backtest/periods').catch(() => null),
  });
  const periods = Array.isArray(listQuery.data) ? listQuery.data : [];

  const captureMutation = useMutation({
    mutationFn: () =>
      apiPost('/api/backtest/periods/import', {
        name,
        note: note || null,
        symbol,
        timeframe,
        from: toInstant(from),
        to: toInstant(to, true),
        // A stock or index the app has never seen is the measured gap this feature closes, so the
        // capture tool registers the symbol by default — and the response says whether it did.
        registerSymbol: true,
      }),
    onSuccess: (data) => {
      setLastImport(data.import);
      qc.invalidateQueries({ queryKey: ['bt-periods'] });
      if (data.period?.id) setSelected(data.period.id);
    },
  });

  const reimportMutation = useMutation({
    mutationFn: (id) => apiPost(`/api/backtest/periods/${id}/import`, {}),
    onSuccess: (data) => {
      setLastImport(data);
      qc.invalidateQueries({ queryKey: ['bt-periods'] });
    },
  });

  /**
   * Rename / re-note a whole SET.
   *
   * ⚠️ A SET IS ONE PIECE OF REASONING, SO ITS NOTE IS WRITTEN TO EVERY MEMBER. `backtest_period` is
   * one row per symbol, so editing a single row would leave the set with nine old notes and one new
   * one — and the library would then have to guess which is "the" reason. `noteVariants` in the
   * grouping is what surfaces that drift if it ever happens some other way.
   */
  const editSetMutation = useMutation({
    mutationFn: async ({ set, nextName, nextNote }) => {
      const ids = set.periods.map((p) => p.id);
      for (const id of ids) {
        await apiPatch(`/api/backtest/periods/${id}`, {
          name: nextName,
          note: nextNote || null,
        });
      }
      return { count: ids.length };
    },
    onSuccess: () => {
      setEditingKey(null);
      qc.invalidateQueries({ queryKey: ['bt-periods'] });
    },
  });

  /**
   * Delete a whole SET.
   *
   * ⚠️ THE SERVER REFUSES while a backtest run still references a member (`cascade` is opt-in), and
   * that refusal is the CORRECT behaviour — deleting the label a run was measured against would make
   * the run's period unnameable. So this does not pass `cascade`: the error is shown, and the requirement
   * decides. The bars themselves are retained either way; they belong to the symbol, not the label.
   */
  const deleteSetMutation = useMutation({
    mutationFn: async (set) => {
      for (const p of set.periods) {
        await apiDelete(`/api/backtest/periods/${p.id}`);
      }
      return { count: set.periods.length };
    },
    onSuccess: () => {
      setConfirmDeleteKey(null);
      qc.invalidateQueries({ queryKey: ['bt-periods'] });
    },
  });

  const selectedPeriod = periods.find((p) => p.id === selected) ?? null;
  const captured = captureMutation.data;
  const importResult = lastImport;
  const importing = captureMutation.isPending || reimportMutation.isPending;

  const sets = groupPeriods(periods);
  const toggleSet = (key) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const startEdit = (set) => {
    setEditingKey(set.key);
    setDraftName(set.name);
    setDraftNote(set.note ?? '');
    setConfirmDeleteKey(null);
  };

  const HEALTH_LABEL = {
    ready: 'ready to measure',
    studied: 'already measured',
    partial: 'partly captured',
    empty: 'no bars',
  };

  return (
    <section className="bt-panel btp" aria-labelledby="btp-heading">
      <header className="btp-head">
        <h3 id="btp-heading">Backtest periods — captured windows</h3>
        <button
          type="button"
          className="bt-panel-btn btp-toggle"
          aria-expanded={open}
          aria-controls="btp-body"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? 'Hide' : 'Capture a period'}
        </button>
      </header>

      <p className="btp-sub">
        A period is a named, noted date range you capture once and reuse. Define the window, name it
        for its story, and run any protocol or bot against it.
      </p>

      <div id="btp-body" hidden={!open}>
        <div className="btp-form">
          <label>
            Name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Greenland Mining surge"
              maxLength={120}
            />
          </label>
          <label>
            Symbol
            <input
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              placeholder="NVDA"
            />
          </label>
          <label>
            Timeframe
            <select value={timeframe} onChange={(e) => setTimeframe(e.target.value)}>
              {TIMEFRAMES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </label>
          <label>
            From (UTC)
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            To (UTC)
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <label className="btp-note-field">
            Note
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Trump signs the deal — 2 days"
            />
          </label>
        </div>

        <div className="btp-actions">
          <button
            type="button"
            className="bt-panel-btn"
            onClick={() => captureMutation.mutate()}
            disabled={!name.trim() || !symbol.trim() || !from || !to || importing}
          >
            {captureMutation.isPending ? 'Capturing…' : 'Capture period'}
          </button>
          <span className="btp-hint">
            Fetches bars for the window into MarketBar. Re-running an import adds nothing — it is
            idempotent, and the counts below prove it.
          </span>
        </div>

        {captureMutation.isError && <NoticeBlock notice={noticeFromError(captureMutation.error)} compact />}
      </div>

      {/* ── The import result. Three outcomes, each rendered as what it is. ─────────────────── */}
      {importResult && (
        <div className="btp-import">
          <NoticeBlock notice={importNotice(importResult)} compact />

          {importResult.periodId && (
            <div className="btp-counts" role="group" aria-label="Import row counts">
              <span><b>{importResult.fetched}</b> fetched</span>
              <span><b>{importResult.inserted}</b> inserted</span>
              <span><b>{importResult.alreadyPresent}</b> already present</span>
              <span>
                rows {importResult.barsBefore} → <b>{importResult.barsAfter}</b>
              </span>
            </div>
          )}

          {/* ⚠️ The coverage line is what makes TRUNCATION visible. A provider that caps intraday
              history returns the servable part with NO error, so a 2-day capture that became a
              1-day capture still looks like a result unless the actual span is shown next to the
              requested one. */}
          {importResult.coveredFrom && (
            <p className="btp-coverage">
              Requested {shortStamp(importResult.requestedFrom)} → {shortStamp(importResult.requestedTo)},
              covered <b>{shortStamp(importResult.coveredFrom)}</b> → <b>{shortStamp(importResult.coveredTo)}</b>
            </p>
          )}

          {importResult.findings?.length > 0 && (
            <ul className="btp-findings">
              {importResult.findings.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          )}

          {/* Providers that could not answer. `no-bars` and `provider-unavailable` are different
              claims, and the difference lives in this list. */}
          {importResult.attempted?.length > 0 && importResult.outcome !== 'imported' && (
            <ul className="btp-attempted">
              {importResult.attempted.map((a, i) => (
                <li key={i}><code>{a.provider}</code> — {a.reason}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ── The list to pick from ───────────────────────────────────────────────────────────── */}
      {listQuery.isError && <NoticeBlock notice={noticeFromError(listQuery.error)} compact />}

      {listQuery.isSuccess && periods.length === 0 && (
        <p className="btp-empty">
          No periods captured yet. Use <b>Capture a period</b> above — the window you capture is
          stored and re-usable, so the same period can be measured by many protocols later.
        </p>
      )}

      {periods.length > 0 && (
        <p className="btp-library-note">
          <b>{sets.length}</b> {sets.length === 1 ? 'set' : 'sets'} · <b>{periods.length}</b> stored
          {periods.length === 1 ? ' period' : ' periods'}. Nothing in this library is seeded — every
          row was captured here, by hand, on purpose.
        </p>
      )}

      {sets.map((set) => {
        const health = setHealth(set);
        const isOpen = expanded.has(set.key);
        const isEditing = editingKey === set.key;
        const isConfirmingDelete = confirmDeleteKey === set.key;
        return (
          <div key={set.key} className={`btp-set btp-set--${health}`}>
            <div className="btp-set-head">
              <button
                type="button"
                className="btp-set-toggle"
                aria-expanded={isOpen}
                onClick={() => toggleSet(set.key)}
              >
                <span aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
                <span className="btp-set-name">{set.name}</span>
              </button>
              <span className={`btp-health btp-health--${health}`}>{HEALTH_LABEL[health]}</span>

              <span className="btp-set-facts">
                <b>{set.symbols}</b> {set.symbols === 1 ? 'symbol' : 'symbols'} · {set.timeframe} ·{' '}
                {shortStamp(set.from)} → {shortStamp(set.to)} · <b>{set.totalBars.toLocaleString()}</b> bars
                {set.totalRuns > 0 ? ` · ${set.totalRuns} run${set.totalRuns === 1 ? '' : 's'}` : ' · never measured'}
              </span>

              <span className="btp-set-actions">
                <button type="button" className="bt-panel-btn bt-panel-btn-sm" onClick={() => startEdit(set)}>
                  {isEditing ? 'Editing…' : 'Edit name & note'}
                </button>
                {isConfirmingDelete ? (
                  <>
                    <button
                      type="button"
                      className="bt-panel-btn bt-panel-btn-sm btp-danger"
                      onClick={() => deleteSetMutation.mutate(set)}
                      disabled={deleteSetMutation.isPending}
                    >
                      {deleteSetMutation.isPending ? 'Deleting…' : `Confirm — delete ${set.symbols}`}
                    </button>
                    <button
                      type="button"
                      className="bt-panel-btn bt-panel-btn-sm"
                      onClick={() => setConfirmDeleteKey(null)}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="bt-panel-btn bt-panel-btn-sm"
                    onClick={() => {
                      setConfirmDeleteKey(set.key);
                      setEditingKey(null);
                    }}
                  >
                    Delete
                  </button>
                )}
              </span>
            </div>

            {/* ── the reason it was stored ─────────────────────────────────────────────────── */}
            {set.note && (
              <p className="btp-set-note">
                {set.note}
                {set.noteVariants > 1 && (
                  <span className="btp-note-drift">
                    {' '}⚠️ its {set.symbols} rows carry {set.noteVariants} different notes — editing
                    the set below will make them agree.
                  </span>
                )}
              </p>
            )}
            {!set.note && (
              <p className="btp-set-note btp-set-note--empty">
                No note — nothing records WHY this window was kept. Use <b>Edit name &amp; note</b> to
                write it down; a window nobody can identify gets measured twice by accident.
              </p>
            )}

            {set.neverImported > 0 && (
              <p className="btp-set-warn">
                ⚠️ {set.neverImported} of {set.symbols} rows have never been imported — this set is
                INCOMPLETE, and a backtest over it covers fewer symbols than its name says.
              </p>
            )}
            {set.emptyWindows > 0 && (
              <p className="btp-set-warn">
                ⚠️ {set.emptyWindows} of {set.symbols} rows imported and found NO bars. That is a
                finding about the window, not a quiet success.
              </p>
            )}

            {isEditing && (
              <div className="btp-edit">
                <label>
                  Name
                  <input
                    type="text"
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    maxLength={120}
                  />
                </label>
                <label className="btp-note-field">
                  Why this set exists
                  <textarea
                    value={draftNote}
                    onChange={(e) => setDraftNote(e.target.value)}
                    rows={3}
                    placeholder="The biggest mover in the window, the catalyst, what you expect to learn…"
                  />
                </label>
                <div className="btp-edit-actions">
                  <button
                    type="button"
                    className="bt-panel-btn"
                    onClick={() => editSetMutation.mutate({ set, nextName: draftName.trim(), nextNote: draftNote })}
                    disabled={!draftName.trim() || editSetMutation.isPending}
                  >
                    {editSetMutation.isPending ? 'Saving…' : `Save to all ${set.symbols} rows`}
                  </button>
                  <button type="button" className="bt-panel-btn" onClick={() => setEditingKey(null)}>
                    Cancel
                  </button>
                  <span className="btp-hint">
                    A set is one reason, so the note is written to every row in it. Renaming the set
                    renames all {set.symbols}.
                  </span>
                </div>
                {editSetMutation.isError && (
                  <NoticeBlock notice={noticeFromError(editSetMutation.error, 'TCS-SYS-007', { operation: 'rename or re-note this set' })} compact />
                )}
              </div>
            )}

            {deleteSetMutation.isError && confirmDeleteKey === null && (
              <NoticeBlock
                notice={noticeFromError(deleteSetMutation.error, 'TCS-SYS-007', { operation: 'delete this set' })}
                compact
              />
            )}

            {/* ── the members. One row per symbol, which is what the ENGINE needs. ──────────── */}
            {isOpen && (
              <table className="bt-table btp-list">
                <thead>
                  <tr>
                    <th scope="col"><span className="sr-only">Select</span></th>
                    <th scope="col">Symbol</th>
                    <th scope="col">Bars</th>
                    <th scope="col">Runs</th>
                    <th scope="col"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {set.periods.map((p) => (
                    <tr key={p.id} className={p.id === selected ? 'btp-row-selected' : ''}>
                      <td>
                        <input
                          type="radio"
                          name="btp-period"
                          checked={p.id === selected}
                          onChange={() => setSelected(p.id)}
                          aria-label={`Select period ${p.name} for ${p.symbol} ${p.timeframe}`}
                        />
                      </td>
                      <td>{p.symbol}</td>
                      <td>
                        {/* ⚠️ `null` and `0` are different facts and are rendered differently:
                            null = never imported, 0 = imported and the window is empty. */}
                        {p.barCount === null
                          ? <span className="btp-none" title="No import has run for this period yet">not imported</span>
                          : p.barCount === 0
                          ? <span className="btp-zero" title="An import ran and found no bars">0 — empty</span>
                          : p.barCount.toLocaleString()}
                      </td>
                      <td>{p.runs}</td>
                      <td>
                        <button
                          type="button"
                          className="bt-panel-btn bt-panel-btn-sm"
                          onClick={() => reimportMutation.mutate(p.id)}
                          disabled={reimportMutation.isPending}
                        >
                          Re-import
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })}

      {selectedPeriod && onRunPeriod && (
        <div className="btp-run">
          <button type="button" className="bt-panel-btn" onClick={() => onRunPeriod(selectedPeriod)}>
            Run backtest on “{selectedPeriod.name}”
          </button>
          <span className="btp-hint">
            Loads only this window. The run records which period it measured, so a period comparison
            can never be read as a protocol comparison.
          </span>
        </div>
      )}

      {reimportMutation.isError && <NoticeBlock notice={noticeFromError(reimportMutation.error)} compact />}

      {/* ⚠️ `symbolRegistered` is surfaced rather than implicit. A symbol created here is a
          DATABASE-ONLY row with no seeder — it survives until the database is rebuilt, and the
          caller is entitled to know that happened rather than discovering it later. */}
      {captured?.symbolRegistered && (
        <p className="btp-registered">
          ⚠ Symbol <b>{captured.symbol}</b> was registered by this capture. It exists in the database
          only — there is no seeder for a ticker entered by hand, so a database rebuild would not
          recreate it.
        </p>
      )}
    </section>
  );
}
