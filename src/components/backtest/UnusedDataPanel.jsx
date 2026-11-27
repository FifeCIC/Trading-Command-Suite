/**
 * UnusedDataPanel — WHAT THE RUN ALREADY KNOWS AND THIS PAGE DOES NOT SHOW (#1340).
 *
 * ── WHY ──────────────────────────────────────────────────────────────────────────────────────────
 * Owner requirement, 2026-11-23: list what the protocols and bots already record and the backtesting
 * page does not use, so the choice of what to surface can be made from the data.
 *
 * Reading an issue body is not how that decision gets made. A table of the actual fields, with the
 * actual VALUE this run produced, is: `fillGap.measured: 0` is something a reader can weigh, where
 * "fillGap is unused" is not.
 *
 * ── ⚠️ IT NEVER INVENTS A VALUE ──────────────────────────────────────────────────────────────────
 * The list of fields is a declaration (see `src/core/backtest-unused-fields.js`), but every value is
 * read from the run in front of it. A field the run no longer returns renders **"not returned by this
 * run"** — so the table drifts visibly instead of quietly going stale.
 */
import { useMemo, useState } from 'react';
import {
  inventoryRows,
  formatValue,
  pickListFor,
  inventoryFindings,
  INVENTORY_CONCERNS,
} from '../../core/backtest-unused-fields.js';

export default function UnusedDataPanel({ runs, bare = false }) {
  /**
   * `'all'` by DEFAULT, deliberately: a picker that opens on one question would hide the other two
   * without the reader asking it to. The count beside every chip is what makes the choice visible.
   */
  const [concern, setConcern] = useState('all');

  const rows = useMemo(() => {
    const okRuns = Array.isArray(runs) ? runs.filter(Boolean) : [];
    if (!okRuns.length) return [];
    // The LAST run: it is the one the tiles above describe, so a value here agrees with a number there.
    return inventoryRows(okRuns[okRuns.length - 1]);
  }, [runs]);

  const findings = useMemo(() => inventoryFindings(), []);

  if (!rows.length) return null;

  const present = rows.filter((r) => r.present).length;
  const picked = pickListFor(rows, concern);

  const heading = (
    <p className={bare ? 'mvp-inv-head' : 'mvp-panel-title'}>
      Recorded, not shown
      <span className="mvp-muted"> · {present} of {rows.length} present in this run</span>
    </p>
  );

  /**
   * ── THE PICKER IS THE MECHANISM (note n, 2026-11-26) ──────────────────────────────────────────────
   * Owner's note: *"a pick-list per reader, so choosing what to surface is a mechanism not a
   * conversation."* Each chip is a question a reader actually arrives with; the fields that answer it
   * are declared against it, so adding a field later puts it in front of the right reader without
   * anyone being asked.
   *
   * ⚠️ A chip's count comes from the same `pickListFor()` the table uses — never from a second count.
   * Two counts of one population is how a chip ends up offering 3 rows over a table showing 2.
   */
  const picker = (
    <div className="mvp-chips mvp-inv-picker" role="group" aria-label="Which question are you asking?">
      <button
        type="button"
        className={`mvp-chip${concern === 'all' ? ' mvp-chip--on' : ''}`}
        aria-pressed={concern === 'all'}
        onClick={() => setConcern('all')}
      >
        <span className="mvp-chip-day">Everything</span>
        <span className="mvp-chip-meta">{rows.length}</span>
      </button>
      {INVENTORY_CONCERNS.map((c) => {
        const n = pickListFor(rows, c.id).rows.length;
        /**
         * ⚠️ A QUESTION WITH NO FIELD IS STILL OFFERED, DISABLED AND LABELLED. Silently omitting it
         * would make the empty declaration invisible — which is the failure `inventoryFindings()`
         * exists to catch, and the one a greyed-out chip with `0` states in one second.
         *
         * ⚠️ AND THE REASON IS IN THE TEXT, NOT ONLY IN A `title`. A disabled control leaves the tab
         * order, and a `title` tooltip is unavailable on touch and unreliable for screen readers — so a
         * count of `0` would be the only explanation offered, which reads as "the run had nothing to say
         * about that". `aria-label` carries the whole sentence instead.
         */
        return (
          <button
            key={c.id}
            type="button"
            className={`mvp-chip${concern === c.id ? ' mvp-chip--on' : ''}`}
            aria-pressed={concern === c.id}
            disabled={n === 0}
            title={c.why}
            aria-label={n === 0 ? `${c.question} — no field declared for this question yet` : undefined}
            onClick={() => setConcern(c.id)}
          >
            <span className="mvp-chip-day">{c.question}</span>
            <span className="mvp-chip-meta">{n === 0 ? 'no field declared' : n}</span>
          </button>
        );
      })}
    </div>
  );

  const table = (
    <>
      {/**
        * ⚠️ NOTHING FILTERED IS EVER SILENT. When a question is chosen, one line says how many fields it
        * left out and what the question is FOR. A filtered table that looks like the whole inventory is
        * the same defect as a blank cell reading as zero.
        */}
      {picked.concern ? (
        <p className="mvp-caption">
          <strong>{picked.rows.length} of {rows.length}</strong> field(s) answer “{picked.concern.question}”
          {' '}— {picked.hidden} left out. {picked.concern.why}
        </p>
      ) : (
        <p className="mvp-caption">
          Fields this run returns that the tables above do not use, chosen by reading the page&apos;s own
          source. Every value below comes from the run in front of you, and a field the run did not
          return says so rather than showing a blank.
        </p>
      )}
      <div className="mvp-scroll">
      <table className="mvp-table">
        <thead>
          <tr>
            <th scope="col">Field</th>
            <th scope="col">This run</th>
            <th scope="col">What it would tell you</th>
            {/* Only when showing everything: filtering to one question would repeat that label per row. */}
            {!picked.concern && <th scope="col">Answers</th>}
          </tr>
        </thead>
        <tbody>
          {picked.rows.map((r) => {
            const shown = formatValue(r.value);
            return (
              <tr key={r.path} className={r.present ? '' : 'mvp-config-row--ignored'}>
                <th scope="row" className="mvp-nowrap">
                  <code>{r.path}</code>
                  <span className="mvp-inv-label">{r.label}</span>
                </th>
                <td className={r.present ? '' : 'mvp-muted'}>
                  {r.present ? (shown ?? '(present)') : 'not returned by this run'}
                </td>
                <td className="mvp-inv-tells">{r.tells}</td>
                {!picked.concern && (
                  <td className="mvp-inv-answers">
                    {r.answers.map((a) => (
                      <span key={a} className="mvp-inv-answer">
                        {INVENTORY_CONCERNS.find((c) => c.id === a)?.question ?? a}
                      </span>
                    ))}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
      {/**
        * A declaration that drifted is a FINDING, and it is printed rather than left to the test suite —
        * the reader deciding what to surface is the person the drift affects.
        */}
      {(findings.unassigned.length > 0 || findings.empty.length > 0 || findings.unknown.length > 0) && (
        <p className="mvp-note mvp-note--warn">
          <strong>This list has drifted from its declaration.</strong>{' '}
          {findings.unassigned.length > 0 && (
            <>No question declared for: {findings.unassigned.join(', ')}. </>
          )}
          {findings.empty.length > 0 && (
            <>No field declared for: {findings.empty.join(', ')}. </>
          )}
          {findings.unknown.length > 0 && (
            <>Unknown question id: {findings.unknown.join(', ')}. </>
          )}
          A field with no question is never offered to a reader, so it is listed here instead of quietly
          disappearing.
        </p>
      )}
    </>
  );

  /**
   * ⚠️ `bare` EXISTS BECAUSE OF THE ACCORDION (#1342). Inside a step the accordion already draws the
   * border and names the section, so a second panel frame would read as a box inside a box. The heading
   * is kept because the "6 of 7 present" figure is information, not chrome.
   */
  if (bare) {
    return (
      <>
        {heading}
        {picker}
        {table}
      </>
    );
  }

  return (
    <section className="mvp-panel" aria-label="Recorded but not shown on this page">
      <h2 className="mvp-panel-title">
        Recorded, not shown
        <span className="mvp-muted"> · {present} of {rows.length} present in this run</span>
      </h2>
      {picker}
      {table}
    </section>
  );
}
