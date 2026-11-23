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
import { fmtMoney } from './format.js';

export default function ResultBySymbolStep({ sort }) {
  const rows = sort?.sorted ?? [];

  if (rows.length === 0) {
    return <p className="mvp-note">No symbol was traded in any day that finished.</p>;
  }

  return (
    <div className="mvp-scroll">
      <table className="mvp-table">
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
            <tr key={s.symbol}>
              <td><strong>{s.symbol}</strong></td>
              <td className="mvp-num">{s.days}</td>
              <td className="mvp-num">{s.trades}</td>
              <td className="mvp-num">{s.winRate == null ? '—' : `${s.winRate.toFixed(1)}%`}</td>
              <td className={`mvp-num ${s.netPnl > 0 ? 'mvp-pos' : s.netPnl < 0 ? 'mvp-neg' : ''}`}>
                {fmtMoney(s.netPnl)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
