/**
 * ResultBySymbolStep — which instruments carried the total.
 *
 * ── THE ONE THING THIS TABLE HAS TO GET RIGHT ───────────────────────────────────────────────────
 * A symbol picked on three days is ONE row with `days: 3`, never three rows. The aggregation happens
 * in the page (`symbolRows`), and this component only renders it — a second roll-up here would let the
 * header figure and the table disagree, which is the silent shape this repo keeps paying for.
 *
 * ⚠️ A symbol with no closed trade has `winRate: null` and shows `—`, not `0%`. "No trade" and "all
 * losing" are different findings.
 */
import { SortableTh } from '../../core/use-sort';
import { formatAmount } from '../../core/format-utils.js';
import { buildPnlBars } from './pnl-bars.js';

export default function ResultBySymbolStep({ sort }) {
  const rows = sort?.sorted ?? [];

  if (rows.length === 0) {
    return <p className="mvp-note">No symbol was traded in any day that finished.</p>;
  }

  /**
   * Audit note 'g' (2026-11-26). Same rule as step 4, one module — a symbol's bar is its |P/L| against
   * the biggest symbol in the table, so concentration is shown rather than inferred.
   *
   * ⚠️ A symbol whose run FAILED is skipped, not drawn at zero. Until now the roll-up in the page threw
   * `s.error` away, so such a row looked like "picked, traded nothing, $0".
   */
  const bars = buildPnlBars(rows, {
    getId: (r) => r.symbol,
    skip: (r) => r.errors > 0,
  });

  return (
    <div className="mvp-scroll">
      <table className="mvp-table">
        <caption className="mvp-caption">
          The bar length is this symbol&rsquo;s P/L against the biggest one in the table
          ({formatAmount(bars.maxAbs)}), so a handful of instruments carrying the total is visible rather
          than inferred. The figure beside it is the value.
        </caption>
        <thead>
          <tr>
            <SortableTh col="symbol" label="Symbol" api={sort} buttonClassName="th-sort" firstDir="asc" />
            <SortableTh col="days" label="Days picked" api={sort} className="mvp-num" buttonClassName="th-sort" />
            <SortableTh col="trades" label="Trades" api={sort} className="mvp-num" buttonClassName="th-sort" />
            <SortableTh col="winRate" label="Win %" api={sort} className="mvp-num" buttonClassName="th-sort" />
            <SortableTh col="netPnl" label="Net P/L" api={sort} className="mvp-num" buttonClassName="th-sort" />
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.symbol} className={s.errors > 0 ? 'mvp-row--bad' : ''}>
              <td>
                <strong>{s.symbol}</strong>
                {s.errors > 0 && <span className="mvp-sym-error"> could not run</span>}
              </td>
              <td className="mvp-num">{s.days}</td>
              <td className="mvp-num">{s.trades}</td>
              <td className="mvp-num">{s.winRate == null ? '—' : `${s.winRate.toFixed(1)}%`}</td>
              <td className={`mvp-num ${s.netPnl > 0 ? 'mvp-pos' : s.netPnl < 0 ? 'mvp-neg' : ''}`}>
                {s.errors > 0 ? '—' : formatAmount(s.netPnl)}
                {!(s.errors > 0) && bars.fracById[s.symbol] !== undefined && (
                  <span className="mvp-pnlbar" aria-hidden="true">
                    <span
                      className={`mvp-pnlbar-fill ${s.netPnl < 0 ? 'is-neg' : 'is-pos'}`}
                      style={{ width: `${Math.round(bars.fracById[s.symbol] * 100)}%` }}
                    />
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
