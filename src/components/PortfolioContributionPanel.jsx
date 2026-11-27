/**
 * PortfolioContributionPanel — what made (or lost) the money, by instrument, with metals isolated.
 *
 * ── WHY THIS PANEL EXISTS (owner, 2026-11-27) ────────────────────────────────────────────────────
 * *"The outcomes are skewed by gold … all it takes is some luck with gold and the entire accounts look
 * healthier."* Measured the same day: 30 days net **−417.53**, of which gold was **−0.75**; the most
 * recent week **+142.53** net but **−113.86 excluding gold**. So one instrument decided the sign of the
 * account, and the app showed a single blended headline in which "the system is turning around" and
 * "gold had a week" are indistinguishable — two findings that demand opposite decisions.
 *
 * ── THE RULES THIS RENDERS TO ─────────────────────────────────────────────────────────────────
 * ⚠️ **THE TOTAL IS NEVER REPLACED BY THE SPLIT.** All three figures are shown, always, in one line —
 * `All · Metals · Ex-metals` — because a headline that has been quietly filtered is the "derived number
 * hides the data it came from" defect. The ex-metal figure is the finding; the total is what it must be
 * read against.
 *
 * ⚠️ **"NOTHING THERE" IS NOT "ZERO".** `metals` and `exMetals` arrive as `null` when that side closed
 * no trades, and render as an em dash. A `0` there would claim a break-even that never happened.
 *
 * ⚠️ **GROSS WIN AND LOSS SIT BESIDE NET.** Gold's measured month was +649.17 / −649.92 for −0.75 net:
 * a coin flip at size that a net figure alone renders as "nothing happened". The churn is the story.
 */
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import { formatAmount } from '../core/format-utils.js';
import { feedUnavailable } from '../core/api/feed-state.js';
import LoadingSkeleton from './LoadingSkeleton.jsx';
import EmptyState from './EmptyState.jsx';
import NoticeBlock from './NoticeBlock.jsx';
import { noticeFromError } from '../core/notices/from-error.js';
import './portfolio-contribution.css';

const WINDOWS = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
];

const pct = (v) => (v == null ? '—' : `${Number(v).toFixed(1)}%`);
const money = (v) => (v == null ? '—' : formatAmount(v));
const tone = (v) => (v == null ? '' : v > 0 ? 'pc-pos' : v < 0 ? 'pc-neg' : '');

export default function PortfolioContributionPanel({ days = 30, onDaysChange }) {
  const query = useQuery({
    queryKey: ['portfolio-contribution', days],
    queryFn: () => apiGet(`/api/portfolio/contribution?days=${days}`),
    staleTime: 60_000,
  });

  const heading = (
    <header className="pc-head">
      <h2 className="pc-title">What made the money</h2>
      <div className="ff-seg" role="group" aria-label="Contribution window">
        {WINDOWS.map((w) => (
          <button
            key={w.days}
            type="button"
            className="ff-seg-btn"
            aria-pressed={w.days === days}
            onClick={() => onDaysChange?.(w.days)}
          >
            {w.label}
          </button>
        ))}
      </div>
    </header>
  );

  if (query.isLoading) {
    return (
      <section className="pc-panel">
        {heading}
        <LoadingSkeleton variant="table" rows={3} cols={5} />
      </section>
    );
  }

  /**
   * ⚠️ A FAILED LOAD IS NOT AN EMPTY ONE (#782 / INV-NO-EMPTY-SWALLOW). If the request failed, saying
   * "no closed trades" would be a statement about the account made by a broken request.
   */
  if (query.isError || feedUnavailable(query)) {
    return (
      <section className="pc-panel">
        {heading}
        <NoticeBlock
          notice={noticeFromError(query.error, 'TCS-SYS-007', {
            operation: 'load the per-instrument P&L contribution',
          })}
        />
      </section>
    );
  }

  const data = query.data;
  if (!data || !data.byInstrument?.length) {
    return (
      <section className="pc-panel">
        {heading}
        <EmptyState
          icon="🧾"
          title="No closed trades in this window"
          description={`Nothing has closed in the last ${days} days, so there is no per-instrument result to attribute.`}
        />
      </section>
    );
  }

  const { total, metals, exMetals } = data;

  return (
    <section className="pc-panel">
      {heading}

      {/*
        ⚠️ THREE FIGURES IN ONE LINE, IN THIS ORDER. A reader who only reads the first number must not be
        able to mistake it for a claim about the system — metals sit immediately beside it.
      */}
      <div className="pc-split">
        <div className="pc-split-item">
          <span className="pc-split-label">All closed</span>
          <strong className={`pc-split-value ${tone(total.net)}`}>{money(total.net)}</strong>
          <span className="pc-split-meta">{total.trades} trade(s)</span>
        </div>
        <div className="pc-split-item">
          <span className="pc-split-label">Metals</span>
          <strong className={`pc-split-value ${tone(metals?.net)}`}>{money(metals?.net ?? null)}</strong>
          <span className="pc-split-meta">
            {metals ? `${metals.trades} trade(s) · ${data.metalsSource.symbols.join(', ')}` : 'nothing closed'}
          </span>
        </div>
        <div className="pc-split-item pc-split-item--key">
          <span className="pc-split-label">Ex-metals</span>
          <strong className={`pc-split-value ${tone(exMetals?.net)}`}>{money(exMetals?.net ?? null)}</strong>
          <span className="pc-split-meta">
            {exMetals ? `${exMetals.trades} trade(s)` : 'nothing closed'}
          </span>
        </div>
      </div>

      <p className="pc-caption">
        The ex-metals figure is the one that says whether anything outside precious metals is working.
        Metals are read from <code>symbol.tags</code>
        {data.otherCommodities.length > 0 && <> (not counted as metal: {data.otherCommodities.join(', ')})</>}.
      </p>

      {/*
        ⚠️ GROSS WIN/LOSS BESIDE NET, because a churn and a flat line are not the same fact. Gold's
        measured month was +649.17 / −649.92 → −0.75: rendered as net alone, that reads as "nothing
        happened", which is the opposite of what a coin flip at size means.
      */}
      <div className="pc-scroll">
        <table className="pc-table">
          <thead>
            <tr>
              <th scope="col">Instrument</th>
              <th scope="col" className="pc-num">Trades</th>
              <th scope="col" className="pc-num">Win %</th>
              <th scope="col" className="pc-num">Gross win</th>
              <th scope="col" className="pc-num">Gross loss</th>
              <th scope="col" className="pc-num">Net</th>
            </tr>
          </thead>
          <tbody>
            {data.byInstrument.map((r) => (
              <tr key={r.symbol} className={r.isMetal ? 'pc-row--metal' : ''}>
                <td>
                  <strong>{r.symbol}</strong>
                  {r.isMetal && <span className="pc-tag">metal</span>}
                </td>
                <td className="pc-num">{r.trades}</td>
                <td className="pc-num">{pct(r.winRate)}</td>
                <td className="pc-num pc-pos">{money(r.grossWin)}</td>
                <td className="pc-num pc-neg">−{money(r.grossLoss)}</td>
                <td className={`pc-num ${tone(r.net)}`}>{money(r.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
