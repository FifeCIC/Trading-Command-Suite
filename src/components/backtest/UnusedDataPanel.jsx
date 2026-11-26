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
import { useMemo } from 'react';
import { inventoryRows, formatValue } from '../../core/backtest-unused-fields.js';

export default function UnusedDataPanel({ runs, bare = false }) {
  const rows = useMemo(() => {
    const okRuns = Array.isArray(runs) ? runs.filter(Boolean) : [];
    if (!okRuns.length) return [];
    // The LAST run: it is the one the tiles above describe, so a value here agrees with a number there.
    return inventoryRows(okRuns[okRuns.length - 1]);
  }, [runs]);

  if (!rows.length) return null;

  const present = rows.filter((r) => r.present).length;

  const heading = (
    <p className={bare ? 'mvp-inv-head' : 'mvp-panel-title'}>
      Recorded, not shown
      <span className="mvp-muted"> · {present} of {rows.length} present in this run</span>
    </p>
  );

  const table = (
    <>
      {/*
        ⚠️ THE CAPTION SAYS WHAT THE LIST IS. An inventory of fields the page does not use is only
        honest if the reader knows it was assembled by reading the source, not by the payload — the
        payload cannot know what the page reads.
        ⚠️ A `<p>` above the frame, not a `<caption>` inside it (theme, 2026-11-26).
      */}
      <p className="mvp-caption">
        Fields this run returns that the tables above do not use. Chosen by reading the page's own
        source; every value below comes from the run in front of you, and a field the run did not
        return says so rather than showing a blank.
      </p>
      <div className="mvp-scroll">
      <table className="mvp-table">
        <thead>
          <tr>
            <th scope="col">Field</th>
            <th scope="col">This run</th>
            <th scope="col">What it would tell you</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
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
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
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
      {table}
    </section>
  );
}
