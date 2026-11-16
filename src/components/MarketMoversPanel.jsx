/**
 * MarketMoversPanel — the MARKET-WIDE winners/losers discovery feed (#1283).
 * ==========================================================================
 *
 * Owner, 2026-11-16: *"we would ideally use a ready made source of top movers: top winners and top
 * losers. It doesn't make sense to only process our registered symbols for the strategy I want the
 * app to support. That doesn't mean it's not a good idea to have a page that shows us the top movers
 * out of the symbols that are registered — those are two separate purposes/features."*
 *
 * ⚠️ THIS IS THE DISCOVERY SIDE, AND IT IS DELIBERATELY A DIFFERENT PANEL FROM THE TREATMENT TABLE.
 *
 *   Registered symbols (the other tab) — "what is TCS doing with the symbols we already hold?"
 *   Market-wide (this panel)            — "what is moving anywhere, that we are not looking at?"
 *
 * They share a page because the CONTRAST is the insight: a symbol can be the biggest mover in the
 * market and appear nowhere at all in our own universe. Merging the two tables would lose exactly
 * that.
 *
 * ── 🛑 TWO THINGS THIS PANEL MUST NEVER SOFTEN ──
 *
 * **1. `stale` IS A REFUSAL, NOT A HINT.** Measured 2026-11-16 at 12:17 ET (market open): the
 * provider returned `last_updated: 2026-11-13 16:15:59 ET` — the PREVIOUS FRIDAY'S CLOSE, three days
 * old. A movers list that old is a record of what already happened, and it is presented as such:
 * the age is stated in the header in hours, and a stale feed gets a banner that says the list cannot
 * be used to enter anything today.
 *
 * **2. EXCLUSIONS ARE SHOWN, NOT SWALLOWED.** Measured on the same response: 60 raw rows → 23 kept →
 * **37 excluded**, the majority being warrants and rights at $0.007–$0.83. A filter that silently
 * drops 62% of its input is indistinguishable from a feed that only had 23 rows. Every exclusion is
 * listed with its reason so a FALSE exclusion is visible rather than invisible.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import { noticeFromError } from '../core/notices/from-error';
import NoticeBlock from './NoticeBlock';

const fmtPct = (v) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${Number(v).toFixed(2)}%`);
const fmtPrice = (v) => (v == null ? '—' : Number(v).toFixed(v < 1 ? 4 : 2));
const fmtVol = (v) => (v == null ? '—' : Number(v) >= 1e6 ? `${(Number(v) / 1e6).toFixed(1)}M` : Number(v).toLocaleString());
const fmtAge = (m) => {
  if (m == null) return 'unknown';
  if (m < 60) return `${m} min`;
  if (m < 2880) return `${(m / 60).toFixed(1)} h`;
  return `${(m / 1440).toFixed(1)} days`;
};

function List({ title, rows, accent }) {
  return (
    <section className="mm-list">
      <h3 className={accent}>{title}</h3>
      {rows.length === 0 ? (
        <p className="mm-note">
          Nothing survived the filters here. That is a statement about the FILTER, not about the
          market — open the exclusion list below to see what was removed and why.
        </p>
      ) : (
        <table className="mm-table">
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Price</th>
              <th>Change</th>
              <th>Volume</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${title}-${r.ticker}`}>
                <td className="mm-sym">{r.ticker}</td>
                <td className="mm-num">{fmtPrice(r.price)}</td>
                <td className={`mm-num ${r.changePct >= 0 ? 'mm-up' : 'mm-down'}`}>{fmtPct(r.changePct)}</td>
                <td className="mm-num">{fmtVol(r.volume)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export default function MarketMoversPanel() {
  const [showExcluded, setShowExcluded] = useState(false);

  const q = useQuery({
    queryKey: ['market-movers'],
    queryFn: () => apiGet('/api/market-data/market-movers'),
    staleTime: 60_000,
    retry: false,
  });

  const d = q.data;

  // ⚠️ Three outcomes, never two: loading / FAILED / data. A failed fetch must not render as
  // "no movers today", which is the false-empty this whole feature exists to avoid.
  //
  // ⚠️ AND THE FAILURE GOES THROUGH THE NOTICE REGISTRY, not a hand-written string. A raw error
  // render fails `validate-notices.cjs`, and `scripts/notice-ui-surfaces.json` is an allowance that
  // may only go DOWN — adding this component to it would be a regression dressed as a fix.
  if (q.isLoading) return <p className="mm-note">Reading the market-wide feed…</p>;
  if (q.isError) {
    return (
      <div>
        <NoticeBlock
          notice={noticeFromError(q.error, 'TCS-SYS-007', {
            operation: 'read the market-wide movers feed',
          })}
        />
        <p className="mm-note">
          ⚠️ This is <strong>unknown</strong>, not &quot;nothing is moving&quot;. The provider feed
          or the API is unreachable.
        </p>
      </div>
    );
  }
  if (!d) {
    return <p className="mm-note mm-note--warn">⚠️ No response body — the feed state is <strong>unknown</strong>.</p>;
  }

  return (
    <div className="mm-panel">
      <div className="mm-head">
        <div>
          <strong>Source:</strong> <code>{d.source}</code>
        </div>
        <div>
          <strong>Provider stamp:</strong> {d.lastUpdated ?? '(none)'}{' '}
          <span className={d.stale ? 'mm-bad' : 'mm-ok'}>
            ({fmtAge(d.ageMinutes)} old{d.stale ? ' — STALE' : ''})
          </span>
        </div>
      </div>

      {d.stale && (
        <div className="mm-banner">
          🛑 <strong>This list is {fmtAge(d.ageMinutes)} old and cannot be used to enter anything.</strong>{' '}
          It is a record of a session that has already closed. Read it as <em>&quot;what moved last
          session&quot;</em> — an overnight watchlist — never as <em>&quot;what is moving now&quot;</em>.
        </div>
      )}

      <div className="mm-counts">
        <span><strong>{d.counts.raw}</strong> raw rows</span>
        <span>→</span>
        <span><strong>{d.counts.kept}</strong> kept</span>
        <span>→</span>
        <span className="mm-bad"><strong>{d.counts.excluded}</strong> excluded</span>
      </div>

      <div className="mm-filters">
        Applied: {Object.entries(d.filtersApplied).map(([k, v]) => (
          <code key={k} className="mm-chip">{k}={String(v)}</code>
        ))}
      </div>

      <div className="mm-lists">
        <List title="🏆 Top gainers" rows={d.winners} accent="mm-up" />
        <List title="🕳️ Top losers" rows={d.losers} accent="mm-down" />
        <List title="🔊 Most active" rows={d.mostActive} accent="" />
      </div>

      <div className="mm-excluded">
        <button type="button" onClick={() => setShowExcluded((s) => !s)}>
          {showExcluded ? '▾ Hide' : '▸ Show'} the {d.counts.excluded} excluded rows
        </button>
        {showExcluded && (
          <table className="mm-table mm-table--excl">
            <thead>
              <tr><th>Symbol</th><th>Why it was excluded</th><th>Detail</th></tr>
            </thead>
            <tbody>
              {d.excluded.map((e, i) => (
                <tr key={`${e.ticker}-${i}`}>
                  <td className="mm-sym">{e.ticker}</td>
                  <td>{e.reason}</td>
                  <td className="mm-dim">{e.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="mm-note">
        ⚠️ Every threshold above is a <strong>setting</strong> you can change
        (<code>movers.*</code>) — they are not constants in code, because what counts as worth
        looking at is a judgement rather than a fact.
      </p>
    </div>
  );
}
