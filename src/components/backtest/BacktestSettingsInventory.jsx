import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../../core/api/client';
import NoticeBlock from '../NoticeBlock';
import { noticeFromError } from '../../core/notices/from-error.js';
import PageInfoPopover from '../PageInfoPopover';
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

export default function BacktestSettingsInventory({
  protocolId,
  botId,
  subject,
  overrides,
  onOverride,
  allowTimeframe = true,
}) {
  const [filter, setFilter] = useState('all');

  /**
   * ⚠️ WHICH ROWS ARE EDITABLE, AND WHY ONLY THESE (#1136).
   *
   * `slPct`, `tpPct` and `timeframe` are fields on `BacktestRunRequest` that `mergeBotConfig()` and
   * `run()` read from the REQUEST before the bot's own values — so editing them here changes the RUN
   * and writes nothing to the database. That is the whole safety property: "this bot, but with a
   * tighter stop" is one call, and the live bot is untouched.
   *
   * Everything else is deliberately read-only, for one of two reasons, and the row says which:
   *   · it is INERT inside a run (`applied: ignored`) — an input here would change nothing and would
   *     teach the operator that it did;
   *   · or it needs a WRITE to the protocol/bot, which is #1133 step 1 and is still gated on deciding
   *     the four inert per-protocol override fields.
   */
  const EDITABLE = useMemo(() => {
    // `minComposite` joined this set on 2026-10-22 (#1136) once the engine began applying it — before
    // that an input here would have changed nothing. It is the most valuable one: it is the field an
    // operator tunes to stop a bot taking weak trades, and it can now be re-tested without editing
    // the live bot.
    const set = new Set(['minComposite', 'slPct', 'tpPct']);
    if (allowTimeframe) set.add('timeframe');
    return set;
  }, [allowTimeframe]);

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
  const counts = data?.counts;

  const visibleGroups = useMemo(
    () => (data?.groups ?? []).map((g) => ({
      ...g,
      rows: filter === 'all' ? g.rows : g.rows.filter((r) => r.applied === filter),
    })).filter((g) => g.rows.length > 0 || filter === 'all'),
    [data, filter],
  );

  return (
    <section className="pb-panel bt-inventory">
      <header className="bt-inventory-head">
        <h3>
          Settings the run could be measuring
          <PageInfoPopover label="What this list is, and what it is not">
            <strong>Every knob you can set elsewhere, marked with whether a backtest reads it.</strong>
            <br />
            <br />
            <strong>honoured</strong> — a run reads it. <strong>reported</strong> — it is echoed into
            the result so a run can say which configuration it measured, but it decides nothing.{' '}
            <strong>ignored</strong> — it exists, and it does nothing inside a run.
            <br />
            <br />
            <strong>⚠️ The one that matters most:</strong> a strategy&rsquo;s{' '}
            <code>minComposite</code> — the entry bar you set on the bot — is <strong>not read by a
            backtest</strong>. A run signals against the PROTOCOL&rsquo;s threshold. Changing the
            bot&rsquo;s bar and re-running will produce the same trades, and that is not a result.
            <br />
            <br />
            Likewise <strong>none</strong> of the declared global settings (risk, automation, logging)
            is read by a run — they belong to the live loop, the scheduler and the log system.
            <br />
            <br />
            ⚠️ These verdicts are not typed into this page. They are served by
            <code> GET /api/backtest/settings-inventory</code> and kept honest by
            <code> settings-inventory.spec.ts</code>, which drives the real merge function and reads the
            service source — so a run that starts honouring a field turns the build red instead of this
            panel going quietly wrong.
            <br />
            <br />
            <strong>Nothing here is editable yet.</strong> Listing comes first; editing from the Lab is
            #1133, and it is gated on deciding the four per-protocol override fields that are currently
            inert.
          </PageInfoPopover>
        </h3>

        {counts && (
          <div className="bt-inventory-counts" aria-live="polite">
            <span className="inv-count">{counts.total} listed</span>
            <span className="inv-count inv-count--on">{counts.honoured} honoured</span>
            <span className="inv-count inv-count--part">{counts.reportedOnly} reported</span>
            <span className="inv-count inv-count--off">{counts.ignored} ignored</span>
          </div>
        )}
      </header>

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
        <span className="pb-count">
          {subject === 'strategy' && !botId ? 'no strategy selected' : ''}
          {subject === 'protocol' && !protocolId ? 'no protocol selected' : ''}
        </span>
      </div>

      {/* ⚠️ WHAT EDITING HERE DOES, stated before any input so it cannot be learned by surprise. */}
      <p className="pb-none bt-inventory-override-note">
        <strong>Editable values change THIS RUN only.</strong> They are sent with the next
        <code> Run backtest</code> and are recorded in that result&rsquo;s
        <code> drivenBy.overridden</code> — nothing is written to the strategy or the protocol. Leave an
        input blank to use the subject&rsquo;s own value.
      </p>

      {inventoryQuery.isError && (
        <>
          <p className="pb-none">
            The inventory could not be read, so this panel is telling you nothing — not that there is
            nothing to tell.
          </p>
          <NoticeBlock notice={noticeFromError(inventoryQuery.error)} compact />
        </>
      )}

      {data?.note && <p className="pb-none bt-inventory-note">{data.note}</p>}

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
                    const editable = EDITABLE.has(row.key);
                    const current = overrides?.[row.key] ?? '';
                    const dirty = editable && String(current).trim() !== '';
                    return (
                      <tr
                        key={`${group.id}:${row.key}`}
                        className={`${row.applied === 'ignored' ? 'inv-row--off' : ''}${dirty ? ' inv-row--dirty' : ''}`}
                      >
                        <td>
                          <span className="inv-label">{row.label}</span>
                          <code className="inv-key">{row.key}</code>
                        </td>
                        <td className="pb-mono inv-value">
                          {editable ? (
                            <span className="inv-input-wrap">
                              <input
                                className="ff-input inv-input"
                                type="number"
                                step={row.key === 'timeframe' ? 1 : 0.1}
                                min="0"
                                value={current}
                                placeholder={fmtValue(row.value)}
                                aria-label={`Override ${row.label} for this run`}
                                onChange={(e) => onOverride?.(row.key, e.target.value)}
                              />
                              {dirty && (
                                <button
                                  type="button"
                                  className="inv-reset"
                                  title={`Reset to the ${subject === 'strategy' ? 'bot' : 'subject'}'s own value`}
                                  onClick={() => onOverride?.(row.key, '')}
                                >
                                  reset
                                </button>
                              )}
                            </span>
                          ) : (
                            fmtValue(row.value)
                          )}
                        </td>
                        <td>
                          <span className={`inv-badge ${meta.cls}`} title={meta.help}>{meta.label}</span>
                          {dirty && <span className="inv-badge inv-badge--edit" title="This value is overridden for the next run only.">override</span>}
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
    </section>
  );
}
