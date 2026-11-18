/**
 * MarketMoversPanel — the MARKET-WIDE winners/losers discovery feed (#1283).
 * ==========================================================================
 *
 * `lists` selects which of the feed's lists to render, so ONE panel serves four surfaces instead of
 * four near-copies (owner direction, 2026-11-18: the two side-split strategies and the Most Active
 * research page each show exactly one of these lists):
 *
 *   <MarketMoversPanel />                                  → all three + the exclusion audit (this page)
 *   <MarketMoversPanel lists={['winners']} />               → Day's Top Winners (long strategy)
 *   <MarketMoversPanel lists={['losers']} />                → Day's Top Losers (short strategy)
 *   <MarketMoversPanel lists={['mostActive']} />            → Most Active (research)
 *
 * ⚠️ THE PROVENANCE STRIP AND THE STALE BANNER ARE NOT OPTIONAL PER LIST, and they are NOT part of
 * `lists`. A "top winners" table with no provider stamp and no staleness warning is exactly the
 * defect this feed was built to avoid: a three-day-old list read as today's opportunity. Whatever
 * subset a caller renders, it renders with its age attached.
 *
 * ⚠️ `showExcluded` defaults to whether the exclusion audit is relevant to the chosen lists — the
 * audit explains rows MISSING from the feed, which only matters when the reader can see the feed.
 *
 * WHY THE UNIVERSE IS UNBOUNDED: the point of a movers strategy is discovery — a symbol cannot be a
 * mover if we only ever look at the ones we already hold. "What is moving anywhere" and "what is TCS
 * doing with the symbols we hold" are two different questions with two different data sources, and
 * merging them behind a flag is how they get confused later.
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
import { useSort, SortableTh } from '../core/use-sort';
import NoticeBlock from './NoticeBlock';
import './market-movers-panel.css';

const fmtPct = (v) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${Number(v).toFixed(2)}%`);
const fmtPrice = (v) => (v == null ? '—' : Number(v).toFixed(v < 1 ? 4 : 2));
const fmtVol = (v) => (v == null ? '—' : Number(v) >= 1e6 ? `${(Number(v) / 1e6).toFixed(1)}M` : Number(v).toLocaleString());
const fmtAge = (m) => {
  if (m == null) return 'unknown';
  if (m < 60) return `${m} min`;
  if (m < 2880) return `${(m / 60).toFixed(1)} h`;
  return `${(m / 1440).toFixed(1)} days`;
};

/**
 * The three feed lists, in render order. `key` is the field on the API response.
 *
 * ⚠️ `defaultSort` IS NOT COSMETIC (added 2026-11-18 after the owner reported the table "isn't wired
 * to today's top winners"). The feed arrives ORDERED BY ITS PROVIDER'S SCREENER, NOT by the percentage
 * column — measured: 16.10, 10.31, 8.57, **12.38**, 8.20. Left unsorted, a reader sees a "top gainers"
 * table whose numbers do not descend and reasonably concludes the data is wrong. Each list therefore
 * opens on the column that IS its subject: gainers by change descending, losers by change ascending
 * (biggest fall first), most-active by volume descending.
 */
const LIST_DEFS = [
  { key: 'winners', title: '🏆 Top gainers', accent: 'mm-up', defaultSort: ['changePct', 'desc'] },
  { key: 'losers', title: '🕳️ Top losers', accent: 'mm-down', defaultSort: ['changePct', 'asc'] },
  { key: 'mostActive', title: '🔊 Most active', accent: '', defaultSort: ['volume', 'desc'] },
];

function List({ title, rows, accent, defaultSort }) {
  /**
   * Sorting uses the SHARED rule (`core/use-sort`) — the same one every other table in the app uses.
   *
   * ⚠️ `initialKey` is deliberately `null`: the feed arrives RANKED, and a movers list re-sorted on
   * load would throw that ranking away without saying so. No column is active until the reader clicks
   * one, and clicking the active column reverses it.
   */
  const [defKey, defDir] = defaultSort ?? [null, 'desc'];
  const sort = useSort(rows, defKey, defDir);

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
              <SortableTh col="ticker" label="Symbol" api={sort} buttonClassName="th-sort" firstDir="asc" />
              <SortableTh col="price" label="Price" api={sort} buttonClassName="th-sort" className="num" />
              <SortableTh col="changePct" label="Change" api={sort} buttonClassName="th-sort" className="num" />
              <SortableTh col="volume" label="Volume" api={sort} buttonClassName="th-sort" className="num" />
            </tr>
          </thead>
          <tbody>
            {sort.sorted.map((r) => (
              <tr key={`${title}-${r.ticker}`}>
                <td className="mm-sym">{r.ticker}</td>
                {/* ⚠️ `num` ON THE CELL AS WELL AS THE HEADER — the bug the owner reported as "columns
                    aren't under their headers". `th.num` right-aligns the heading (from tables.css)
                    while `td.mm-num` only set font and colour, so every numeric column had a
                    right-aligned header over left-aligned values. A column's alignment is ONE fact and
                    must be declared on both ends. */}
                <td className="num mm-num">{fmtPrice(r.price)}</td>
                <td className={`num mm-num ${r.changePct >= 0 ? 'mm-up' : 'mm-down'}`}>{fmtPct(r.changePct)}</td>
                <td className="num mm-num">{fmtVol(r.volume)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export default function MarketMoversPanel({ lists = null }) {
  const [showExcluded, setShowExcluded] = useState(false);

  const q = useQuery({
    queryKey: ['market-movers'],
    /**
     * ⚠️ `force=true` AND A 60s POLL (2026-11-18), because the requirement is minute-to-minute updates
     * so that symbols starting to make big movements can be traded. That is the whole point of the
     * movers strategies.
     *
     * Measured before this change, on a page left open: `staleTime: 60_000` with **no**
     * `refetchInterval` meant the page NEVER polled — it refetched only on mount or window focus, so
     * the list was frozen for as long as you looked at it. And the API holds a **5-minute** cache
     * (`MarketMoversService.CACHE_TTL_MS`), so even a poll would have returned the same payload.
     * Together those two made a "live" view that was up to five minutes stale by construction.
     *
     * `force=true` is an existing parameter on the route (`@Query('force')`), so this needs no backend
     * change — the cache is bypassed by the caller that needs fresh data rather than shortened for
     * every caller.
     *
     * ⚠️ THIS CANNOT BEAT THE PROVIDER. The response reports `exchangeDataDelayedBy` (measured: 20
     * minutes) and the page prints it. A minute-by-minute poll of a 20-minute-delayed feed gives a
     * smoother view of the same delay — it does not give minute-by-minute prices. True intraday
     * velocity needs bars, which is #1301.
     *
     * Background tabs do not poll (React Query pauses `refetchInterval` when the document is hidden),
     * so leaving the page open overnight is not 1,440 provider calls.
     */
    queryFn: () => apiGet('/api/market-data/market-movers?force=true'),
    staleTime: 0,
    refetchInterval: 60_000,
    retry: false,
  });

  const d = q.data;

  // ⚠️ DECLARED BEFORE THE EARLY RETURNS — a hook after `if (q.isLoading) return …` would be a
  // conditional hook. Sorting the exclusion list is worth having (sorting by REASON groups 37 dropped
  // rows into their causes), and the list arrives in feed order, so no column is active initially.
  const excludedSort = useSort(d?.excluded ?? [], null, 'asc');

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
        {/* ⚠️ THE EXCHANGE DELAY IS A SEPARATE FACT FROM STALENESS and must be read separately:
            `stale` asks "is this feed alive?", `delayed` asks "how old is each quote even when it is?".
            A feed can be seconds old and still carry 15-20 minute-old prices. */}
        <div>
          <strong>Exchange delay:</strong>{' '}
          {d.delayedByMinutes == null
            ? <span className="mm-dim">not declared</span>
            : (
              <span className={d.delayed ? 'mm-bad' : 'mm-ok'}>
                {d.delayedByMinutes} min{d.delayed ? ' — DELAYED' : ''}
              </span>
            )}
        </div>
      </div>

      {d.stale && (
        <div className="mm-banner">
          🛑 <strong>This list is {fmtAge(d.ageMinutes)} old and cannot be used to enter anything.</strong>{' '}
          It is a record of a session that has already closed. Read it as <em>&quot;what moved last
          session&quot;</em> — an overnight watchlist — never as <em>&quot;what is moving now&quot;</em>.
        </div>
      )}

      {!d.stale && d.delayed && (
        <div className="mm-banner mm-banner--delay">
          ⏱ <strong>Live, but {d.delayedByMinutes} minutes behind the exchange.</strong>{' '}
          Fine for finding candidates and for a daily view; <em>not</em> fine for an entry that depends
          on where the price is in the next minute. The strategy&apos;s velocity factors must be measured
          from this app&apos;s own bars, not from these rows.
        </div>
      )}

      <div className="mm-counts">
        <span><strong>{d.counts.raw}</strong> raw rows</span>
        <span>→</span>
        <span><strong>{d.counts.kept}</strong> kept</span>
        <span>→</span>
        <span className="mm-bad"><strong>{d.counts.excluded}</strong> excluded</span>
        {/* ⚠️ WHAT DISCOVERY DID, AND WHAT IT DELIBERATELY DID NOT DO. "recorded" and "activated" are
            different verbs and the second one never happens here. */}
        {d.persisted && (
          <span className="mm-persisted">
            · {d.persisted.created} new symbol{d.persisted.created === 1 ? '' : 's'} recorded
            {' '}<strong>(none activated)</strong>
          </span>
        )}
      </div>

      <div className="mm-filters">
        Applied: {Object.entries(d.filtersApplied).map(([k, v]) => (
          <code key={k} className="mm-chip">{k}={String(v)}</code>
        ))}
      </div>

      <div className="mm-lists">
        {LIST_DEFS.filter((l) => !lists || lists.includes(l.key)).map((l) => (
          <List
            key={l.key}
            title={l.title}
            rows={d[l.key] ?? []}
            accent={l.accent}
            defaultSort={l.defaultSort}
          />
        ))}
      </div>

      <div className="mm-excluded">
        <button type="button" onClick={() => setShowExcluded((s) => !s)}>
          {showExcluded ? '▾ Hide' : '▸ Show'} the {d.counts.excluded} excluded rows
        </button>
        {showExcluded && (
          <table className="mm-table mm-table--excl">
            <thead>
              <tr>
                <SortableTh col="ticker" label="Symbol" api={excludedSort} buttonClassName="th-sort" firstDir="asc" />
                <SortableTh col="reason" label="Why it was excluded" api={excludedSort} buttonClassName="th-sort" firstDir="asc" />
                <SortableTh col="detail" label="Detail" api={excludedSort} buttonClassName="th-sort" firstDir="asc" />
              </tr>
            </thead>
            <tbody>
              {excludedSort.sorted.map((e, i) => (
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
