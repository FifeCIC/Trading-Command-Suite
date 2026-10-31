import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../../core/api/client';
import NoticeBlock from '../NoticeBlock';
import { noticeFromError } from '../../core/notices/from-error.js';
import '../../pages/backtest-lab.css';

/**
 * BacktestSettingsInventory — EVERY knob an operator could change, and whether a RUN honours it (#1136).
 *
 * ⚠️ THE POINT IS THE `applied` COLUMN, NOT THE LIST. A list of settings already exists in several
 * places; what has never existed is a statement of which of them a backtest actually reads. Measured
 * 2026-10-22 in `backtest.service.ts`: a bot contributes `symbol`, `timeframe`, `protocolId`, `slPct`
 * and `tpPct` — and **none** of `minComposite`, `maxPositions`, `cooldownMinutes`, `maxHoldHours`,
 * `maxPyramidTiers`, the exhaustion pair, the three trailing-stop fields, `sessionTags`,
 * `sessionWindow` or `exitBeforeUtc`. No settings-registry key is read either.
 *
 * That matters here more than anywhere else in the app: this is the page where a difference between
 * two runs is read as a result, and "I changed the entry threshold" is exactly the change that would
 * show nothing.
 *
 * ⚠️ THE CLAIMS COME FROM THE API, NOT FROM THIS FILE. `GET /api/backtest/settings-inventory` builds
 * them from `settings-inventory.ts`, whose declared maps are driven by `settings-inventory.spec.ts`
 * against the real `mergeBotConfig()` and against the service source. A JSX file cannot be checked;
 * that module can.
 *
 * Read-only by design. Editing from here is #1133, and it is gated on deciding the four inert
 * per-protocol override fields first.
 */

const STATE_META = {
  honoured: { label: 'honoured', cls: 'inv-badge--on', help: 'A backtest run reads it.' },
  'reported-only': { label: 'reported', cls: 'inv-badge--part', help: 'Echoed into the result so a run can say what it measured. It decides nothing.' },
  ignored: { label: 'ignored', cls: 'inv-badge--off', help: 'It exists and does nothing inside a run.' },
};

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'honoured', label: 'Honoured' },
  { key: 'reported-only', label: 'Reported' },
  { key: 'ignored', label: 'Ignored' },
];

const fmtValue = (value) => {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (Array.isArray(value)) return value.length ? value.join(', ') : '(empty)';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

/**
 * ⚠️ group SELECTS ONE GROUP, AND THAT IS HOW THIS IS USED NOW (owner direction, 2026-10-30:
 * *"Strategy + Protocol + Directive Overrides + Global Settings should all be separate steps"*).
 * Rendering every group at once put five tables — 39 rows — under one heading at the bottom of the
 * Costs step, which is the stacking the owner objected to. Each group is now its own step, and the
 * step supplies the heading; this component renders only the table.
 *
 * ⚠️ THE 
un GROUP IS NOT RENDERED ANY MORE. It listed slPct / 	pPct / minComposite /
 * 	imeframe as an editable table — the same four fields the Costs form already has inputs for, one
 * above the other, in two different shapes. The form is the control; a read-only echo of it was
 * duplication dressed as an audit.
 */
/**
 * ⚠️ THE COUNTS BELONG TO THE TABLE ON SCREEN (found 2026-10-30, measuring the split). The API's
 * `counts` describe the WHOLE inventory — it read "56 listed" above a 22-row table, which is a number
 * that contradicts the thing beside it. Recomputed from the group actually being rendered.
 */
function countRows(groups) {
  const out = { total: 0, honoured: 0, reportedOnly: 0, ignored: 0 };
  for (const g of groups) {
    for (const r of g.rows) {
      out.total += 1;
      if (r.applied === 'honoured') out.honoured += 1;
      else if (r.applied === 'reported-only') out.reportedOnly += 1;
      else out.ignored += 1;
    }
  }
  return out;
}

export default function BacktestSettingsInventory({
  protocolId,
  botId,
  /** Which group to render: 'strategy' | 'protocol' | 'directive-override' | 'settings'. */
  group = null,
  /** Hide the filter chip bar — a single group of four rows does not need one. */
  showFilters = false,
}) {
  const [filter, setFilter] = useState('all');

  const inventoryQuery = useQuery({
    // Keyed on the SUBJECT so switching protocol/bot re-reads rather than showing the previous
    // subject's values under a new heading — the silent-mismatch class this repo keeps re-finding.
    queryKey: ['bt-settings-inventory', protocolId, botId],
    queryFn: () => apiGet(
      `/api/backtest/settings-inventory?protocolId=${encodeURIComponent(protocolId || '')}`
      + `&botId=${encodeURIComponent(botId || '')}`,
    ),
    staleTime: 30_000,
  });

  const data = inventoryQuery.data;

  /**
   * ⚠️ THE `run` GROUP IS FILTERED OUT HERE, not at the call site, so no caller can render it by
   * mistake — it duplicated the Costs form's own four inputs.
   * ⚠️ An unknown `group` returns NO groups rather than every group. Falling back to "all" would make
   * a typo in a step's group name render four tables inside a step titled for one, with nothing to
   * report it.
   */
  const visibleGroups = useMemo(
    () => (data?.groups ?? [])
      .filter((g) => g.id !== 'run')
      .filter((g) => (group ? g.id === group : true))
      .map((g) => ({
        ...g,
        rows: filter === 'all' ? g.rows : g.rows.filter((r) => r.applied === filter),
      })),
    [data, filter, group],
  );

  /** Counts for what is ON SCREEN — see the note on countRows. */
  const counts = useMemo(() => countRows(visibleGroups), [visibleGroups]);

  /**
   * ⚠️ NO PANEL, NO HEADING, NO OVERRIDE NOTE (2026-10-30). The step supplies the heading and the
   * sentence that frames it; this renders the table and nothing else. Two nested boxes with two
   * headings for one table is where the "mixed styling" started.
   */
  return (
    <div className="bt-inventory">
      {counts && (
        <div className="bt-inventory-counts" aria-live="polite">
          <span className="inv-count">{counts.total} listed</span>
          <span className="inv-count inv-count--on">{counts.honoured} honoured</span>
          <span className="inv-count inv-count--part">{counts.reportedOnly} reported</span>
          <span className="inv-count inv-count--off">{counts.ignored} ignored</span>
        </div>
      )}

      {showFilters && (
        <div className="pb-toolbar bt-inventory-filters">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`tp-chip${filter === f.key ? ' tp-chip--active' : ''}`}
              onClick={() => setFilter(f.key)}
              aria-pressed={filter === f.key}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {inventoryQuery.isError && (
        <>
          <p className="pb-none">
            The inventory could not be read, so this step is telling you nothing — not that there is
            nothing to tell.
          </p>
          <NoticeBlock notice={noticeFromError(inventoryQuery.error)} compact />
        </>
      )}
      {visibleGroups.map((group) => (
        <div key={group.id} className="bt-inventory-group">
          <h4>
            {group.label}
            <span className="inv-group-n">{group.rows.length}</span>
          </h4>
          <p className="pb-none">{group.note}</p>
          {group.rows.length === 0 ? (
            <p className="pb-none">Nothing listed in this group.</p>
          ) : (
            <div className="pb-table-wrap">
              <table className="bt-table">
                <caption className="sr-only">
                  {group.label}: each setting, its current value, and whether a backtest run honours it.
                </caption>
                <thead>
                  <tr>
                    <th scope="col" title="The identifier a future editor would write to.">Setting</th>
                    <th scope="col" title="The value as stored. A dash means it has never been set — which is not the same as zero.">Value</th>
                    <th scope="col" title="honoured = a run reads it. reported = echoed only. ignored = it does nothing inside a run.">In a run</th>
                    <th scope="col" title="Where the value lives and which consumer decides the verdict.">Why</th>
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((row) => {
                    const meta = STATE_META[row.applied] ?? STATE_META.ignored;
                    return (
                      <tr
                        key={`${group.id}:${row.key}`}
                        className={row.applied === 'ignored' ? 'inv-row--off' : undefined}
                      >
                        <td>
                          <span className="inv-label">{row.label}</span>
                          <code className="inv-key">{row.key}</code>
                        </td>
                        <td className="pb-mono inv-value">
                          {fmtValue(row.value)}
                        </td>
                        <td>
                          <span className={`inv-badge ${meta.cls}`} title={meta.help}>{meta.label}</span>
                        </td>
                        <td className="pb-reason">{row.why}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}

      {!inventoryQuery.isLoading && !inventoryQuery.isError && counts?.total === 0 && (
        <p className="pb-none">The inventory returned nothing. That is a finding, not an empty list.</p>
      )}
    </div>
  );
}
