/**
 * PortfolioAccountsBreakdown — every account the app knows about, and what it contributes.
 *
 * ── WHERE THIS CAME FROM (2026-11-28) ───────────────────────────────────────────────────────────
 * The **Broker Breakdown** block on `PortfolioPage.jsx` (`/trading/portfolio-overview`), which was in
 * no menu. That block fetched `/api/portfolio/holdings?source=all` and printed equity / balance /
 * position count per broker. The merged page already loads `/api/portfolio/accounts`, which returns
 * the same accounts with `value`, `positions`, `currency`, `enabled` and `connected` — so this reads
 * THAT, and the second fetch disappears with the page. The old grid also derived a per-broker
 * position count by filtering the positions array on a broker NAME; the account row carries its own
 * `positions` count, which cannot drift from the table beneath it.
 *
 * ── THE TWO THINGS IT REFUSES TO IMPLY ──────────────────────────────────────────────────────────
 * 1. **A disabled account is still shown.** It is excluded from the grand total, and hiding it would
 *    make "why is the total smaller than my account" unanswerable. The row says `off`.
 * 2. **Values in different currencies are NOT added into a total here.** `grandTotal` comes from the
 *    API and is a raw sum; when more than one currency is present that is stated in words above the
 *    table rather than left for the reader to notice. MT5 reports account equity, Trading212 reports
 *    holding value — different bases, printed side by side with their own currency column.
 */
import { formatAmount } from '../core/format-utils.js';
import './portfolio-accounts-breakdown.css';

export default function PortfolioAccountsBreakdown({ categories = [], grandTotal = null }) {
  const rows = [];
  for (const c of categories) {
    for (const a of c.accounts || []) rows.push({ ...a, categoryLabel: c.label, categoryEnabled: c.enabled });
  }
  if (!rows.length) return null;

  const currencies = [...new Set(rows.filter((r) => r.value != null && r.currency).map((r) => r.currency))];
  const offValue = rows.filter((r) => r.enabled === false && Number.isFinite(r.value)).length;

  return (
    <div className="pab">
      {currencies.length > 1 && (
        <p className="pab-caveat" role="note">
          ⚠️ {currencies.length} currencies are present ({currencies.join(', ')}). The total is a raw
          sum, not FX-converted — compare within a currency, not across them.
        </p>
      )}
      {offValue > 0 && (
        <p className="pab-caveat" role="note">
          {offValue} account{offValue === 1 ? ' is' : 's are'} switched off and excluded from the
          total. Their value is still shown with a strike-through.
        </p>
      )}

      <table className="pab-table">
        <thead>
          <tr>
            <th scope="col">Account</th>
            <th scope="col">Broker</th>
            <th scope="col" className="pab-num">Positions</th>
            <th scope="col" className="pab-num">Value</th>
            <th scope="col">Ccy</th>
            <th scope="col">State</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={r.enabled === false ? 'pab-row--off' : undefined}>
              <th scope="row">
                {r.label}
                {r.categoryLabel && r.categoryLabel !== r.label && (
                  <span className="pab-cat">{r.categoryLabel}</span>
                )}
              </th>
              <td>{r.broker || '—'}</td>
              <td className="pab-num">{r.positions ?? '—'}</td>
              <td className="pab-num">{r.value != null ? formatAmount(r.value) : '—'}</td>
              <td className="pab-ccy">{r.currency || '—'}</td>
              <td>
                <span className={`pab-chip ${r.enabled === false ? 'pab-chip--off' : 'pab-chip--on'}`}>
                  {r.enabled === false ? 'off' : 'on'}
                </span>
                {/* `connected` is the third state: an account can be ON but unreachable. Printing
                    only on/off would report a broken connection as a healthy account. */}
                {r.connected === false && <span className="pab-chip pab-chip--warn">not connected</span>}
              </td>
            </tr>
          ))}
        </tbody>
        {grandTotal != null && (
          <tfoot>
            <tr>
              <th scope="row" colSpan={3}>Total across enabled accounts</th>
              <td className="pab-num pab-total">{formatAmount(grandTotal)}</td>
              <td className="pab-ccy">{currencies.length === 1 ? currencies[0] : 'mixed'}</td>
              <td />
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
