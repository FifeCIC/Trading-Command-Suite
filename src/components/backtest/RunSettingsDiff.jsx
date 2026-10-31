import InfoNote from '../InfoNote';

/**
 * RunSettingsDiff — WHICH SETTINGS CHANGED between the compared runs.
 *
 * Owner direction, 2026-10-31: *"enhance [Compare] so that the compare shows the settings that are
 * different, to identify what made the difference in profit loss."*
 *
 * ⚠️ WHY THIS IS NOT JUST MORE COLUMNS. The metrics table already puts every result side by side, and
 * it could not answer the question. Measured on the four VIX runs the owner was looking at: identical
 * protocol, symbol, timeframe, trade count, win rate and profit factor, and P&Ls from +76,617 to
 * +141,219. The rows differed in `spread` (0.01% vs 0.93%) and `slippage` — a £64,600 swing on the
 * SAME trades — and nothing on the page mentioned costs at all. "Which run won" and "what did I
 * change" are different questions, and only the first had a table.
 *
 * ⚠️ A SHARED GAP IS NOT A SHARED SETTING. Two runs that both failed to record a `botBaseSize` agree
 * on nothing; the value is unknown for both. `unrecorded` travels with the row so the rendering can
 * say "not recorded" rather than an empty cell, which reads as "same" or, worse, as "zero".
 */
export default function RunSettingsDiff({ differences, runs }) {
  const changed = Array.isArray(differences?.changed) ? differences.changed : [];
  const same = Array.isArray(differences?.same) ? differences.same : [];
  const runList = Array.isArray(runs) ? runs : [];

  if (runList.length < 2) return null;

  const labelOf = (r, i) => `Run ${String(r?.id ?? i).slice(0, 8)}`;

  return (
    <div className="btr-diff">
      <h4 className="btr-diff-head">What differs</h4>

      {changed.length === 0 ? (
        <InfoNote tone="warning" label="No setting differs">
          Every stored setting is the same on all {runList.length} runs — same scope, same sizing, same
          costs, same source. If the results still differ, the difference is not in a setting: it is in
          the bars each run scored, or in the sample being too small to separate them. Read the verdict
          above as a refusal, not as a result.
        </InfoNote>
      ) : (
        <div className="bt-table-wrap">
          <table className="bt-table bt-diff-table">
            <caption className="sr-only">
              Settings that differ between the selected runs. Only the changed settings are listed;
              everything not shown was identical.
            </caption>
            <thead>
              <tr>
                <th scope="col">Setting</th>
                {runList.map((r, i) => (
                  <th key={r?.id ?? i} scope="col">{labelOf(r, i)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {changed.map((row) => (
                <tr key={row.field}>
                  <th scope="row">{row.label}</th>
                  {row.values.map((v, i) => (
                    <td key={i} className={`bt-num${v == null ? ' btr-diff-missing' : ''}`}>
                      {v == null ? 'not recorded' : v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {same.length > 0 && (
        <p className="btr-diff-same">
          <strong>Same on every run:</strong>{' '}
          {same
            .map((s) => (s.unrecorded ? `${s.label} (not recorded)` : `${s.label} ${s.value}`))
            .join(' · ')}
        </p>
      )}
    </div>
  );
}
