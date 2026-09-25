/**
 * Symbol Page — ticker-based single-symbol focused view.
 * Route: /trading/symbol/:ticker
 *
 * Pulls together everything known about a symbol in one place:
 * price, scoring envelope, directive drilldown, protocol cross-scores,
 * earnings events, recent news, risk assessment.
 */

import { useParams, Link } from 'react-router-dom';
import { useQuery, useQueries } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { apiGet } from '../core/api/client';
import { noticeFromError } from '../core/notices/from-error.js';
import NoticeBlock from '../components/NoticeBlock';
import StarToggle from '../components/StarToggle';
import { stripWarningGlyph } from '../core/signal-utils';
import LoadingSkeleton from '../components/LoadingSkeleton';
import ApiOfflineBanner from '../components/ApiOfflineBanner';
import './symbol-page.css';

/**
 * Signal → CSS class. Determines colour from the THEME, not from JSX.
 *
 * ⚠️ This replaced a hardcoded hex map (`{ BUY: '#22c55e', SELL: '#ef4444', … }`) applied through
 * inline `style={{ color: … }}`. Two problems with that: inline hex bypasses the theme entirely
 * (so it cannot follow light/dark), and it bypasses colour-blind mode, which works by overriding
 * the `--color-profit` / `--color-loss` tokens.
 *
 * ⚠️ Uses `includes`, NOT `startsWith`. `'STRONG_SELL'.startsWith('SELL') === false`, so a
 * startsWith test silently mis-classifies every STRONG_* signal — that exact bug shipped once
 * already (see the 2026-09-17 note in the handoff store). `includes` catches STRONG_BUY/STRONG_SELL
 * and is checked against the `NO_DATA` / `PAUSED` sentinels first so they never read as a signal.
 */
const signalClass = (signal) => {
  const s = String(signal || '').toUpperCase();
  if (!s || s === 'NO_DATA' || s === 'PAUSED' || s === 'UNKNOWN') return 'sym-sig--none';
  if (s.includes('BUY')) return 'sym-sig--buy';
  if (s.includes('SELL')) return 'sym-sig--sell';
  return 'sym-sig--hold';
};

/**
 * Maps a close reason to a tone class.
 * ⚠️ Reasons that do not match stay `neutral` — they are NOT defaulted to "stop". The server's
 * own strings are `broker:sl` / `broker:terminal`; a fifth reason appearing later must read as
 * unclassified rather than be silently counted as a stop-out.
 */
const exitTone = (why) => {
  const w = String(why || '').toLowerCase();
  if (w.includes('sl') || w.includes('stop')) return 'stop';
  if (w.includes('tp') || w.includes('target') || w.includes('limit')) return 'target';
  return 'neutral';
};

/** One figure in the stat row. Tone is a CSS class — never an inline colour. */
function StatTile({ label, value, sub, tone = '', title }) {
  return (
    <div className={`sym-tile ${tone}`} title={title}>
      <span className="sym-tile-label">{label}</span>
      <span className="sym-tile-value">{value}</span>
      {sub ? <span className="sym-tile-sub">{sub}</span> : null}
    </div>
  );
}

/**
 * A labelled proportional bar.
 * `pct === null` renders as an explicit "no reading" marker rather than a zero-length bar — a
 * zero-length bar is indistinguishable from a genuine 0 and would understate the symbol.
 */
function BarRow({ label, pct, display, tone = '', stagger = 0 }) {
  const hasReading = typeof pct === 'number' && Number.isFinite(pct);
  return (
    <div className="sym-bar">
      <span className="sym-bar-label" title={label}>{label}</span>
      <span className="sym-bar-track" role="img" aria-label={`${label}: ${display}`}>
        {hasReading ? (
          <span
            className={`sym-bar-fill ${tone}`}
            style={{
              width: `${Math.max(0, Math.min(100, pct))}%`,
              animationDelay: `${Math.min(stagger, 12) * 0.04}s`,
            }}
          />
        ) : (
          <span className="sym-bar-nodata">no reading</span>
        )}
      </span>
      <span className="sym-bar-value">{display}</span>
    </div>
  );
}

/**
 * Diverging P&L bars: gains grow right from the centre line, losses left.
 * ⚠️ A bot with no trades gets an explicit "no trades" label, not a zero-length bar — the two
 * mean different things ("did not trade" vs "traded and broke even").
 */
function PnlBars({ rows, maxAbs }) {
  if (!rows.length) return <p className="sym-muted">No per-bot outcomes recorded for this symbol yet.</p>;
  return (
    <div className="sym-diverge">
      {rows.map((b, i) => {
        const pct = maxAbs > 0 ? Math.min(100, (Math.abs(b.pnl) / maxAbs) * 100) : 0;
        const positive = b.pnl >= 0;
        return (
          <div className="sym-diverge-row" key={`${b.label}-${i}`}>
            <span className="sym-diverge-label" title={b.label}>
              {b.label}
              {!b.attributed && b.label !== 'unattributed' && (
                <em className="sym-diverge-warn"> · unattributed</em>
              )}
            </span>
            <span
              className="sym-diverge-track"
              role="img"
              aria-label={`${b.label}: ${b.trades} trades, net P&L ${b.pnl.toFixed(2)}`}
            >
              <span className="sym-diverge-axis" aria-hidden="true" />
              {b.trades > 0 && (
                <span
                  className={`sym-diverge-fill ${positive ? 'is-pos' : 'is-neg'}`}
                  style={{ width: `${pct / 2}%`, animationDelay: `${Math.min(i, 12) * 0.04}s` }}
                />
              )}
            </span>
            <span className={`sym-diverge-value ${positive ? 'is-pos' : 'is-neg'}`}>
              {b.pnl >= 0 ? '+' : ''}{b.pnl.toFixed(2)}
            </span>
            <span className="sym-diverge-meta">{b.trades === 0 ? 'no trades' : `${b.wins}/${b.trades}`}</span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Exit-reason breakdown: one stacked bar plus a legend.
 * ⚠️ Reason strings are shown as the server stores them (`broker:sl`). Prettifying them in the UI
 * would make the display disagree with the value #476's ledger records, which is how a reader ends
 * up unable to reconcile the two.
 */
function ExitStack({ rows, total }) {
  if (!rows.length || !total) {
    return <p className="sym-muted">No close reasons recorded for this symbol — nothing has closed yet, or the reason was not captured.</p>;
  }
  return (
    <div className="sym-exits">
      <div
        className="sym-exits-bar"
        role="img"
        aria-label={`Exit reasons: ${rows.map(([w, n]) => `${w} ${n}`).join(', ')}`}
      >
        {rows.map(([why, n], i) => (
          <span
            key={why}
            className={`sym-exits-seg sym-exit-${exitTone(why)}`}
            style={{ width: `${(n / total) * 100}%`, animationDelay: `${Math.min(i, 8) * 0.04}s` }}
          />
        ))}
      </div>
      <div className="sym-exits-legend">
        {rows.map(([why, n]) => (
          <span key={why} className="sym-exits-key">
            <i className={`sym-exits-dot sym-exit-${exitTone(why)}`} aria-hidden="true" />
            {why} <strong>{n}</strong> <em>· {Math.round((n / total) * 100)}%</em>
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * BotOutcomeCard — one bot's INTENDED vs REALISED record on one symbol (#921).
 *
 * BEFORE this was six key/value text rows, so the reader had to hold "payoff 2" and "payoff 0.264"
 * in their head and subtract them. The comparison IS the content, so the two payoffs are now
 * paired bars on a SHARED scale, directly above/below each other, with the gap stated once.
 *
 * ⚠️ Three states are kept DISTINCT and must never collapse into each other:
 *   • `no trades`        — the bot never opened on this symbol
 *   • `not measurable`   — trades exist but only wins OR only losses, so a payoff cannot be formed
 *   • measurable         — both sides exist; a payoff and a gap can be stated
 * Rendering the middle case as "payoff 0" would assert break-even where nothing is known.
 *
 * ⚠️ The headline P&L is lifted into the header deliberately. It was previously the last clause of
 * the "Record" row — the single number that says whether this bot made or lost money here was the
 * hardest one to find.
 */
function BotOutcomeCard({ o }) {
  const r = o.realised ?? {};
  const declared = o.declared ?? {};
  const hasDeclared = declared.declaredPayoff !== null && declared.declaredPayoff !== undefined;
  const hasRealised = r.realisedPayoff !== null && r.realisedPayoff !== undefined;
  const gap = hasDeclared && hasRealised
    ? Number((r.realisedPayoff - declared.declaredPayoff).toFixed(2))
    : null;

  // ONE scale for both bars — that is the whole point of pairing them. Two independently-scaled
  // bars would each look full and the comparison would be lost.
  const scale = Math.max(hasDeclared ? declared.declaredPayoff : 0, hasRealised ? r.realisedPayoff : 0, 0.01);
  const pct = (v) => Math.max(0, Math.min(100, (v / scale) * 100));

  const measurable = r.avgWin !== null && r.avgLoss !== null && r.avgWin !== undefined && r.avgLoss !== undefined;
  const trades = r.trades ?? 0;
  const wins = r.wins ?? 0;
  const losses = trades - wins;
  const winPct = trades > 0 ? (wins / trades) * 100 : 0;
  const exitEntries = Object.entries(o.closeReasons || {});

  return (
    <div className="sym-outcome">
      <div className="sym-outcome-head">
        <strong>{o.botName || o.attribution}</strong>
        <span className="sym-source">{o.protocolId || o.attribution}</span>
        {!o.matchedBot && (
          <span className="sym-outcome-warn" title="scoringStrategyId holds a protocol slug, not a bot id — attribution is unresolved for this row">
            ⚠ attribution unresolved
          </span>
        )}
        <span className={`sym-outcome-pnl ${trades === 0 ? 'is-none' : r.totalPnl >= 0 ? 'is-pos' : 'is-neg'}`}>
          {trades === 0 ? 'no trades' : `${r.totalPnl >= 0 ? '+' : ''}${r.totalPnl.toFixed(2)}`}
        </span>
      </div>

      <div className="sym-outcome-config">
        {[o.brokerId, o.timeframe].filter(Boolean).map((v) => (
          <span key={v} className="sym-outcome-chip">{v}</span>
        ))}
        {o.minComposite != null && <span className="sym-outcome-chip">min {o.minComposite}</span>}
      </div>

      {/* Intended vs Realised — paired, shared scale, gap stated once. */}
      <div className="sym-outcome-payoff">
        <span className="sym-outcome-payoff-k">Intended</span>
        {hasDeclared ? (
          <>
            <span className="sym-outcome-track" role="img" aria-label={`Intended payoff ${declared.declaredPayoff}`}>
              <span className="sym-outcome-fill is-intended" style={{ width: `${pct(declared.declaredPayoff)}%` }} />
            </span>
            <span className="sym-outcome-payoff-v">
              {declared.declaredPayoff}
              {declared.slPct != null && declared.tpPct != null && (
                <em> SL {declared.slPct}% / TP {declared.tpPct}%</em>
              )}
            </span>
          </>
        ) : (
          <span className="sym-outcome-absent">not declared</span>
        )}

        <span className="sym-outcome-payoff-k">Realised</span>
        {measurable ? (
          <>
            <span className="sym-outcome-track" role="img" aria-label={`Realised payoff ${r.realisedPayoff}`}>
              <span
                className={`sym-outcome-fill ${gap !== null && gap < 0 ? 'is-short' : 'is-met'}`}
                style={{ width: `${pct(r.realisedPayoff)}%` }}
              />
            </span>
            <span className="sym-outcome-payoff-v">
              {r.realisedPayoff}
              <em> win {r.avgWin.toFixed(2)} / loss {r.avgLoss.toFixed(2)}</em>
            </span>
          </>
        ) : (
          <span className="sym-outcome-absent">
            {trades === 0
              ? 'no trades on this symbol'
              : r.avgLoss === null
                ? `${trades} trade${trades === 1 ? '' : 's'}, no losses yet — payoff not measurable`
                : `${trades} trade${trades === 1 ? '' : 's'}, no wins yet — payoff not measurable`}
          </span>
        )}
      </div>

      {gap !== null && (
        <p className={`sym-outcome-gap-badge ${gap < 0 ? 'is-neg' : 'is-pos'}`}>
          {gap < 0 ? '▼' : '▲'} {gap > 0 ? '+' : ''}{gap} vs intended
          {gap < 0 && ' — realised reward per unit risk is below what the bot was configured for'}
        </p>
      )}

      {/* Win/loss as a proportion. A rate without its denominator is not a rate, so `n` is shown. */}
      {trades > 0 && (
        <div className="sym-outcome-record">
          <span className="sym-outcome-wl" role="img" aria-label={`${wins} wins, ${losses} losses`}>
            <span className="sym-outcome-w" style={{ width: `${winPct}%` }} />
            <span className="sym-outcome-l" style={{ width: `${100 - winPct}%` }} />
          </span>
          <span className="sym-outcome-record-txt">
            <strong>{wins}W</strong> / <strong>{losses}L</strong>
            {r.winRate !== null && r.winRate !== undefined && <> · {r.winRate}% <em>(n={trades})</em></>}
          </span>
        </div>
      )}

      <div className="sym-outcome-exits">
        <span className="sym-outcome-k">Exits</span>
        {exitEntries.length === 0 ? (
          <em className="sym-outcome-absent">no close reasons recorded</em>
        ) : (
          exitEntries.map(([why, n]) => (
            <span key={why} className={`sym-outcome-reason sym-reason-${exitTone(why)}`}>{why} ×{n}</span>
          ))
        )}
      </div>

      {/* An absent ceiling must LOOK absent — never omitted silently. */}
      <p className="sym-outcome-foot">
        Bar set at minComposite {o.minComposite ?? '—'} · protocol ceiling not available yet (#905)
      </p>
    </div>
  );
}

/**
 * SymbolPage — one symbol, every protocol that actually scores it.
 *
 * ⚠️ WHY THIS PAGE ASKS `/focus` AND NOT `/symbols/:ticker/protocols` (measured 2026-09-21)
 * ---------------------------------------------------------------------------------------
 * `GET /api/symbols/:ticker/protocols` answers `{"protocols":[],"count":0}` for EVERY symbol.
 * `symbols.service.ts getProtocols()` filters on `config.symbols` | `config.symbolFocus`, and no
 * row of the `strategy` table populates either — measured: 29 rows, `symbols=null` on all of them,
 * config shapes `{}` and `{weights, entryThreshold, watchThreshold, defenseThreshold}`. So the
 * filter `[].includes(ticker)` is always false and the endpoint cannot ever return a protocol.
 * That is a dead endpoint, not an empty result, and the two rendered identically (#926).
 *
 * `GET /api/symbols/:ticker/focus` returns the protocols that are genuinely live for the symbol,
 * derived from bot subscriptions: 4 for XAUUSD, 1 for USDCAD, verified against the running API.
 *
 * ⚠️ AND THE SYMBOL MAY HAVE SEVERAL PROTOCOLS — IT USUALLY DOES.
 * `/api/signals/envelope/:symbol` REFUSES to run unscoped (400 TCS-SYS-002, "Pass a protocol"),
 * so a single score was never available and is not a meaningful question. XAUUSD scores under
 * FIVE protocols at once (xau-speed-v1, -1h, -4h, -m5, -m15); picking one would attribute a real
 * number to a protocol the user did not ask about. So: one score per protocol, each LABELLED with
 * the protocol it came from (#921, #925, #926).
 */
export default function SymbolPage() {
  const { ticker } = useParams();
  const symbol = (ticker || '').toUpperCase();

  // ── Data queries (all ticker-based, fetched in parallel) ──
  const focusQuery = useQuery({
    queryKey: ['symbol-focus', symbol],
    queryFn: () => apiGet(`/api/symbols/${symbol}/focus`),
    enabled: !!symbol,
    staleTime: 60_000,
    retry: 1,
  });

  const overviewQuery = useQuery({
    queryKey: ['symbol-overview-ticker', symbol],
    queryFn: () => apiGet(`/api/symbols/${symbol}/overview`),
    enabled: !!symbol,
    staleTime: 30_000,
    retry: 1,
  });

  // Protocol ids this symbol is actually scored under. `/focus` returns `protocols` as an OBJECT
  // keyed by protocol id, so the keys are the ids — no separate lookup needed.
  const protocolIds = Object.keys(focusQuery.data?.protocols || {});

  // ONE ENVELOPE PER PROTOCOL. This is the part that was missing: the old code requested the
  // envelope with no protocol and got 400, so the Score card was permanently empty while the
  // backend was happily scoring the symbol under five protocols.
  const envelopeQueries = useQueries({
    queries: protocolIds.map((protocolId) => ({
      queryKey: ['symbol-envelope', symbol, protocolId],
      queryFn: () => apiGet(`/api/signals/envelope/${symbol}?protocol=${encodeURIComponent(protocolId)}`),
      enabled: !!symbol && !!protocolId,
      staleTime: 30_000,
      retry: 1,
    })),
  });

  const earningsQuery = useQuery({
    queryKey: ['symbol-earnings', symbol],
    queryFn: () => apiGet(`/api/earnings/symbol/${symbol}`),
    enabled: !!symbol,
    staleTime: 120_000,
    retry: 1,
  });

  const newsQuery = useQuery({
    queryKey: ['symbol-news-feed', symbol],
    queryFn: () => apiGet(`/api/news/feed?symbol=${symbol}&limit=5`),
    enabled: !!symbol,
    staleTime: 120_000,
    retry: 1,
  });

  const focus = focusQuery.data;
  const overview = overviewQuery.data;
  const earnings = earningsQuery.data;
  const newsArticles = newsQuery.data?.articles || [];
  // Per-bot outcomes for THIS symbol (#921). Already phantom-filtered server-side — see the
  // ⚠️ note on the predicate in symbols.service.ts getFocus().
  const botOutcomes = focus?.botOutcomes || [];

  // Paired with their protocol id so every rendered score can name its own source.
  const protocolScores = protocolIds.map((protocolId, i) => ({
    protocolId,
    meta: focus?.protocols?.[protocolId] || {},
    query: envelopeQueries[i],
    env: envelopeQueries[i]?.data || null,
  }));
  const scoredProtocols = protocolScores.filter((p) => p.env);

  // ── Stat row + chart inputs ─────────────────────────────────────────────
  // ⚠️ Every number below comes from data this page ALREADY fetched and previously never
  // rendered: `botOutcomes`, `tradingStrategies`, `overview.positions` and `overview.freshness`.
  // No additional request is made — the page was simply discarding most of what it received.
  //
  // ⚠️ Unattributed outcome rows are KEPT and labelled, never dropped. They are real trades
  // (measured on XAUUSD: 3 of 5 rows carry no bot name), and silently dropping them would shrink
  // every total on this page while still looking authoritative.
  const outcomeRows = (botOutcomes || []).map((o) => o.realised || {});
  const aggTrades = outcomeRows.reduce((n, r) => n + (r.trades || 0), 0);
  const aggWins = outcomeRows.reduce((n, r) => n + (r.wins || 0), 0);
  const aggLosses = aggTrades - aggWins;
  const aggPnl = outcomeRows.reduce((n, r) => n + (r.totalPnl || 0), 0);
  const aggWinRate = aggTrades > 0 ? Math.round((aggWins / aggTrades) * 1000) / 10 : null;

  // Exit reasons pooled across bots — the only window into WHY trades closed.
  const exitTotals = {};
  for (const o of botOutcomes || []) {
    for (const [why, n] of Object.entries(o.closeReasons || {})) {
      exitTotals[why] = (exitTotals[why] || 0) + n;
    }
  }
  const exitRows = Object.entries(exitTotals).sort((a, b) => b[1] - a[1]);
  const exitTotal = exitRows.reduce((n, [, c]) => n + c, 0);

  const perBot = (botOutcomes || []).map((o) => ({
    label: o.botName || o.protocolId || 'unattributed',
    attributed: !!o.matchedBot,
    pnl: o.realised?.totalPnl ?? 0,
    trades: o.realised?.trades ?? 0,
    wins: o.realised?.wins ?? 0,
  }));
  const botsWithTrades = perBot.filter((b) => b.trades > 0);
  const bestBot = botsWithTrades.length ? botsWithTrades.reduce((a, b) => (b.pnl > a.pnl ? b : a)) : null;
  const worstBot = botsWithTrades.length ? botsWithTrades.reduce((a, b) => (b.pnl < a.pnl ? b : a)) : null;

  // Only readings with a real composite count as "scored" — a NO_DATA envelope must not be
  // averaged in as a zero, which would drag the strongest-reading stat toward nothing.
  const liveScores = protocolScores.filter(
    (p) => typeof p.env?.composite === 'number' && String(p.env.signal).toUpperCase() !== 'NO_DATA',
  );
  const bestScore = liveScores.length
    ? liveScores.reduce((a, b) => (b.env.composite > a.env.composite ? b : a))
    : null;

  // Directive evidence for the highlighted protocol, flattened across its groups and sorted.
  // ⚠️ Bars `normalized`, NOT `score`. `normalized` is 0-100 (measured 2026-09-21:
  // bollinger-band-squeeze 100, gold-round-numbers 60, volume-confirmation 38, volatility-tools 32,
  // rsi-oversold 22). `score` is out of a PER-DIRECTIVE `maxScore` that varies (90, 25, 100, 90,
  // 140), so barring it directly would make a 90/140 directive look stronger than a 25/25 one.
  const evidenceRows = (scoredProtocols[0]?.env?.groups || [])
    .flatMap((g) => (g.topDirectives || []).map((d) => ({ ...d, groupName: g.groupName, isRisk: g.isRisk })))
    .filter((d) => typeof d.normalized === 'number')
    .sort((a, b) => b.normalized - a.normalized);
  const evidenceTone = (n) => (n >= 65 ? 'is-strong' : n < 35 ? 'is-weak' : '');

  const openPositions = Array.isArray(overview?.positions) ? overview.positions : [];
  const openPnl = openPositions.reduce((n, p) => n + (typeof p.pnl === 'number' ? p.pnl : 0), 0);
  const tradingStrategies = focus?.tradingStrategies || [];
  const freshness = overview?.freshness || null;
  const excludedRows = focus?.outcomeCoverage?.excludedPhantomRows ?? null;

  // Chart geometry — plain values, no d3, no chart library (SVG <100 nodes, per ui-standards).
  const maxAbsPnl = perBot.length ? Math.max(...perBot.map((b) => Math.abs(b.pnl)), 1) : 1;
  const stale = freshness?.status && freshness.status !== 'fresh';

  // ⚠️ Resolve the gate on `overview` and `focus`, NOT on an envelope. The envelope is per-protocol
  // and can legitimately fail for one protocol while another succeeds, so gating the whole page on
  // it (as this page used to) turned a single refusal into an apparently empty page.
  const isLoading = overviewQuery.isLoading || focusQuery.isLoading;
  const hasError = overviewQuery.isError && focusQuery.isError;
  const notFound = !isLoading && !hasError && !overview?.price && !focus;

  if (isLoading) {
    return (
      <div className="sym-page">
        <LoadingSkeleton variant="card" count={4} />
      </div>
    );
  }

  if (hasError) return <ApiOfflineBanner />;

  if (notFound) {
    return (
      <div className="sym-page">
        <div className="sym-empty">
          <h2>Symbol not found</h2>
          <p>No data available for <strong>{symbol}</strong>. The symbol may not exist in the database or the backend may be unavailable.</p>
          <Link to="/research/symbols-browser" className="sym-back-link">Browse Symbols</Link>
        </div>
      </div>
    );
  }

  // `overview.price` is an object ({ last, change, changePct, … }) from
  // /api/symbols/:ticker/overview. Normalise before formatting.
  const priceObj = overview?.price;
  const price = typeof priceObj === 'number' ? priceObj
    : (priceObj && typeof priceObj === 'object' && typeof priceObj.last === 'number') ? priceObj.last
    : (typeof overview?.latestPrice === 'number' ? overview.latestPrice : null);
  // ⚠️ `changePct` IS PRESENT BUT NEVER POPULATED — measured 2026-09-21 across XAUUSD, SPY,
  // EURUSD, GBPCAD and USTEC: every one returned `change: 0, changePct: 0` while `last` held a
  // real price (AAPL returned no price at all). Rendering that as "↑ 0.00%" asserts the symbol
  // closed FLAT, which the data never said — it says the change was not computed. Absence must not
  // become a number (development-philosophy §7). So the move renders only when a non-zero figure
  // exists; otherwise the header says the provider did not report one.
  const changeRaw = overview?.changePercent ?? overview?.change ?? priceObj?.changePct ?? null;
  const change = typeof changeRaw === 'number' && Number.isFinite(changeRaw) ? changeRaw : null;
  const hasRealChange = change !== null && change !== 0;
  const symMeta = overview?.symbol;

  // Price precision from the symbol's OWN type, not a length heuristic.
  // ⚠️ The previous rule was `symbol.length === 6 && !symbol.includes('-') ? 5 : 2`, which gave
  // XAUUSD **five** decimals — rendered as `4345.20000` (observed in the browser 2026-09-21).
  // `/api/symbols/:ticker/overview` returns `symbol.type` ("commodity" for XAUUSD), so use it.
  const symType = String(symMeta?.type || '').toLowerCase();
  const priceDp = symType === 'forex'
    ? (symbol.endsWith('JPY') ? 3 : 5)   // JPY crosses quote to 3dp
    : 2;                                  // commodity / stock / index / crypto
  const companyName = symMeta?.name ?? overview?.companyName ?? focus?.name ?? symbol;
  const symId = overview?.symbolId ?? symMeta?.id ?? '';

  // The score card's three DISTINCT states — deliberately not collapsed (#926).
  const primaryEnv = scoredProtocols[0]?.env ?? null;
  const firstEnvelopeError = protocolScores.find((p) => p.query?.isError)?.query?.error ?? null;

  return (
    <div className="sym-page">
      {/* ── Header ── */}
      <motion.header className="sym-header" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
        <div className="sym-title-row">
          <StarToggle itemType="symbol" itemId={symId || symbol} size={22} />
          <div>
            <h1>{symbol}</h1>
            {companyName && companyName !== symbol && <p className="sym-company">{companyName}</p>}
          </div>
        </div>
        <div className="sym-header-right">
          {price != null && (
            <span className="sym-price">
              {price.toFixed(priceDp)}
            </span>
          )}
          {hasRealChange ? (
            <span className={`sym-change ${change >= 0 ? 'sym-up' : 'sym-down'}`}>
              {change >= 0 ? '↑' : '↓'} {Math.abs(change).toFixed(2)}%
            </span>
          ) : (
            /* Deliberately NOT "↑ 0.00%". See the note on `hasRealChange` above. */
            <span
              className="sym-change sym-change--absent"
              title="The price provider returned no change value for this symbol, so there is no move to report."
            >
              change not reported
            </span>
          )}
          {symMeta?.exchange && <span className="sym-chip">{symMeta.exchange}</span>}
          {symMeta?.type && <span className="sym-chip">{symMeta.type}</span>}
        </div>
      </motion.header>

      {/* ── Stat row ── totals, drawn from data this page already had ──
          ⚠️ Every tile states its SOURCE. `aggPnl` pools the per-bot outcomes below and `openPnl`
          is the live broker position; they are DIFFERENT measurements and are never summed into
          one "P&L" figure. */}
      <motion.section
        className="sym-stats"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.02 }}
        aria-label={`Key figures for ${symbol}`}
      >
      {/* ⚠️ §9.14 / D5=A — this tile is a raw COMPOSITE, i.e. a score. The free edition does not show
          score-derived numbers, and this page is on the plan's ``score history stripped'' list. The
          whole tile goes rather than being blanked: a tile reading “—” still reserves space and
          still tells a reader a number belongs there. Flag folds at build time (Vite define). */}
      {import.meta.env.VITE_EDITION !== 'free' && (
        <StatTile
          label="Best reading"
          value={bestScore ? `${bestScore.env.composite}` : '—'}
          sub={bestScore ? `of ${bestScore.env.maxPossible} · ${bestScore.protocolId}` : `${liveScores.length} of ${protocolIds.length} protocols live`}
          tone={bestScore ? signalClass(bestScore.env.signal) : 'sym-sig--none'}
          title="Highest raw composite among protocols returning a live reading. Composite is a SUM of directive scores, not a percentage — the percentage is shown in Protocol Strength below."
        />
      )}
        <StatTile
          label="Win rate"
          value={aggWinRate === null ? '—' : `${aggWinRate}%`}
          sub={aggTrades ? `${aggWins}W / ${aggLosses}L` : 'no closed trades'}
          tone={aggWinRate === null ? '' : aggWinRate >= 50 ? 'sym-tone-good' : 'sym-tone-bad'}
          title={`Closed trades for ${symbol} across every bot. Source: bot outcomes (excludes ${excludedRows ?? 0} phantom rows).`}
        />
        <StatTile
          label="Net P&L"
          value={aggTrades ? `${aggPnl >= 0 ? '+' : ''}${aggPnl.toFixed(2)}` : '—'}
          sub={aggTrades ? `${aggTrades} trade${aggTrades === 1 ? '' : 's'}` : 'no closed trades'}
          tone={aggTrades ? (aggPnl >= 0 ? 'sym-tone-good' : 'sym-tone-bad') : ''}
          title="Sum of realised P&L over closed trades attributed to this symbol."
        />
        <StatTile
          label="Open position"
          value={openPositions.length ? `${openPnl >= 0 ? '+' : ''}${openPnl.toFixed(2)}` : 'none'}
          sub={openPositions.length
            ? openPositions.map((p) => `${String(p.side || '').toUpperCase()} ${p.quantity}`).join(' · ')
            : 'flat on this symbol'}
          tone={openPositions.length ? (openPnl >= 0 ? 'sym-tone-good' : 'sym-tone-bad') : ''}
          title="Live broker exposure on this symbol. This is NOT part of the Net P&L tile — that one is realised, closed trades only."
        />
        <StatTile
          label="Bots"
          value={`${tradingStrategies.filter((b) => b.active).length}/${tradingStrategies.length}`}
          sub="active / total"
          title="Trading strategies (bots) targeting this symbol."
        />
        <StatTile
          label="Protocols"
          value={`${liveScores.length}/${protocolIds.length}`}
          sub="returned a reading"
          tone={protocolIds.length && liveScores.length === 0 ? 'sym-tone-warn' : ''}
          title="How many of the protocols covering this symbol returned a live score. A protocol can be subscribed and still return NO_DATA — those are counted as not live, never as zero."
        />
        <StatTile
          label="Data"
          value={freshness?.status ? freshness.status : '—'}
          sub={freshness?.lastBar ? `last bar ${new Date(freshness.lastBar).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : (freshness?.timeframe || 'unknown')}
          tone={freshness?.status === 'fresh' ? 'sym-tone-good' : stale ? 'sym-tone-warn' : ''}
          title="Bar freshness for this symbol, as reported by the API. Stale bars mean the score describes an older market."
        />
        <StatTile
          label="Excluded rows"
          value={excludedRows === null ? '—' : `${excludedRows}`}
          sub="phantom closes"
          tone={excludedRows ? 'sym-tone-warn' : ''}
          title={`Rows marked closed with no broker ticket and no exit price — bulk-write residue, not trades (#931). They are excluded from every figure above.`}
        />
      </motion.section>

      {/* The derivation, shown rather than left as a surprise: a winning record that loses money is
          the single most useful thing this data can say, and it is invisible in the tiles alone. */}
      {aggTrades > 0 && aggWinRate !== null && (
        <motion.p
          className="sym-stats-note"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.04 }}
        >
          <strong>{aggWins}W / {aggLosses}L</strong> ({aggWinRate}% win rate) over{' '}
          <strong>{aggTrades}</strong> closed trade{aggTrades === 1 ? '' : 's'}, net{' '}
          <strong className={aggPnl >= 0 ? 'sym-tone-good' : 'sym-tone-bad'}>
            {aggPnl >= 0 ? '+' : ''}{aggPnl.toFixed(2)}
          </strong>.
          {aggWinRate >= 50 && aggPnl < 0 && ' A winning record that still loses money — the average loss outweighs the average win.'}
          {aggWinRate < 50 && aggPnl >= 0 && ' A losing record that still makes money — the average win outweighs the average loss.'}
        </motion.p>
      )}

      <div className="sym-grid">
        {/* ── Score Card ──
            Three states, kept DISTINCT (#926). The old version rendered one message for all of
            them — "Score unavailable. Run a scan from the Scoring Workbench." — which was also
            FALSE: the scan had run, the backend was scoring the symbol under five protocols, and
            the page simply never asked with a protocol. Telling a user to run something they
            already ran is worse than saying nothing. */}
        <motion.section className="sym-card sym-card--score" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.05 }}>
          <h2>Score</h2>

          {scoredProtocols.length > 0 ? (
            <>
              <div className="sym-score-row">
                <span className={`sym-score-val ${signalClass(primaryEnv.signal)}`}>
                  {primaryEnv.composite.toFixed(0)}
                </span>
                <span className={`sym-score-signal ${signalClass(primaryEnv.signal)}`}>
                  {primaryEnv.signal}
                </span>
                {typeof primaryEnv.opportunityPct === 'number' && (
                  <span className="sym-score-opp" title="Opportunity — pre-gate directional strength against the protocol's configured capacity. Shown because the gated composite above can read 0 while this does not.">
                    opp {primaryEnv.opportunityPct.toFixed(0)}%
                  </span>
                )}
              </div>
              {/* ⚠️ The protocol is NAMED. A bare composite is not attributable when the symbol
                  scores under several protocols — which is the normal case here. */}
              <div className="sym-score-meta">
                <span className="sym-source">{scoredProtocols[0].protocolId}</span>
                <span>Confidence: {primaryEnv.confidence}%</span>
                {primaryEnv.rarity && <span style={{ color: primaryEnv.rarityColor }}>{primaryEnv.rarity}</span>}
              </div>
              {primaryEnv.preTradeReady ? (
                <span className="sym-ready">✓ Trade Ready</span>
              ) : (
                <div className="sym-blockers">
                  {(primaryEnv.preTradeBlockers || []).map((b, i) => <span key={i} className="sym-blocker">🚫 {b}</span>)}
                </div>
              )}
              {scoredProtocols.length > 1 && (
                <p className="sym-muted sym-multi-note">
                  Showing 1 of {scoredProtocols.length} protocols scoring this symbol — all of them are listed under Protocol Scores below.
                </p>
              )}
            </>
          ) : firstEnvelopeError ? (
            /* The failure has a CODE and the server's own wording. Render both, rather than a
               sentence the user cannot act on. */
            <NoticeBlock compact notice={noticeFromError(firstEnvelopeError, 'TCS-SYS-002', { symbol })} />
          ) : focusQuery.isError ? (
            <NoticeBlock compact notice={noticeFromError(focusQuery.error, 'TCS-SYS-002', { symbol })} />
          ) : isLoading ? (
            <p className="sym-muted">Loading scores…</p>
          ) : protocolIds.length === 0 ? (
            /* No protocol scores this symbol. That is INFORMATION, and it is different from a
               failure — say so, and say what would change it. */
            <p className="sym-muted">
              No protocol is currently scoring <strong>{symbol}</strong>. A protocol must have an
              active bot subscribed to it before it will score a symbol.
            </p>
          ) : (
            <p className="sym-muted">No score returned for {protocolIds.length} protocol(s) — the scoring run may still be in flight.</p>
          )}
        </motion.section>

        {/* ── Risk Gate ── */}
        <motion.section className="sym-card sym-card--risk" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.08 }}>
          <h2>Risk Gate</h2>
          {primaryEnv?.riskGate?.active ? (
            <>
              <div className="sym-risk-mult">
                Multiplier: <strong>×{primaryEnv.riskGate.multiplier.toFixed(2)}</strong>
                {primaryEnv.riskGate.triggered && <span className="sym-risk-hard">⚠ Hard Gate: {primaryEnv.riskGate.reason}</span>}
              </div>
              {primaryEnv.riskGate.chain.length > 0 && (
                <div className="sym-risk-chain">
                  {primaryEnv.riskGate.chain.map((s, i) => (
                    <span key={i} className="sym-risk-step" style={{ opacity: 1 - s.severity * 0.5 }}>
                      {s.rule}: ×{s.multiplier.toFixed(2)}
                    </span>
                  ))}
                </div>
              )}
              {primaryEnv.riskGate.warnings.length > 0 && (
                <div className="sym-risk-warnings">
                  {primaryEnv.riskGate.warnings.map((w, i) => <span key={i} className="sym-risk-warn">⚠ {stripWarningGlyph(w)}</span>)}
                </div>
              )}
            </>
          ) : (
            <p className="sym-muted">
              {scoredProtocols.length === 0
                ? 'No score to gate — see the Score card above for why.'
                : 'No risk rules triggered for this score.'}
            </p>
          )}
        </motion.section>

        {/* ── Earnings ── */}
        <motion.section className="sym-card sym-card--earnings" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.10 }}>
          <h2>Earnings</h2>
          {earningsQuery.isLoading ? (
            <p className="sym-muted">Loading...</p>
          ) : earnings?.date ? (
            <div className="sym-earning">
              <span className="sym-earn-date">{new Date(earnings.date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
              {earnings.time && <span className="sym-earn-time">{earnings.time}</span>}
              {earnings.epsEstimate != null && <span className="sym-earn-eps">EPS est: {earnings.epsEstimate}</span>}
              {earnings.revenueEstimate != null && <span className="sym-earn-rev">Rev est: {earnings.revenueEstimate}</span>}
            </div>
          ) : (
            <p className="sym-muted">No upcoming earnings data.</p>
          )}
        </motion.section>
      </div>

      {/* ── Charts ── inline SVG/CSS, no chart library (ui-standards: SVG <100 nodes) ── */}
      <div className="sym-charts">
        {/* Directive evidence — the one place on this page carrying real spread when the protocol
            composite reads NO_DATA. XAUUSD's xau-speed-1h groups all sit at exactly 50, but its
            directives range 22-100, so the detail is where the information is. */}
        {evidenceRows.length > 0 && (
          <motion.section className="sym-card" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.105 }}>
            <h2>Directive Evidence</h2>
            <p className="sym-muted sym-source-line">
              Strongest directives inside <strong>{scoredProtocols[0]?.protocolId}</strong>, as a share of each directive's own maximum.
            </p>
            <div className="sym-chart">
              {evidenceRows.map((d, i) => (
                <BarRow
                  key={`${d.groupName}-${d.id}`}
                  label={d.name || d.id}
                  pct={d.normalized}
                  display={`${d.normalized}`}
                  tone={evidenceTone(d.normalized)}
                  stagger={i}
                />
              ))}
            </div>
            <p className="sym-muted sym-multi-note">
              {evidenceRows.filter((d) => d.isRisk).length} of {evidenceRows.length} are risk-gate directives.
            </p>
          </motion.section>
        )}

        <motion.section className="sym-card" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.11 }}>
          <h2>Protocol Strength</h2>
          {/* ⚠️ The bar is `signalPct`, NOT `composite`.
              Measured 2026-09-21: gold-macro-v1 returns composite=99 with maxPossible=795, and the
              four xau-speed-* protocols return composite=0 with maxPossible=0. `composite` is a SUM
              of directive scores, so using it as a 0-100 bar width would have drawn 99 as a
              near-full bar when it is 12% of capacity — wrong by ~8x. `signalPct` is already the
              stable-denominator percentage (INV-STABLE-DENOMINATOR). */}
          <p className="sym-muted sym-source-line">
            Composite is a raw sum of directive scores; the bar is its share of capacity.
            A protocol with no live reading says so rather than showing 0.
          </p>
          <div className="sym-chart">
            {protocolScores.map(({ protocolId, meta, env: e, query }, i) => {
              const noReading = !e || String(e.signal).toUpperCase() === 'NO_DATA';
              return (
                <BarRow
                  key={protocolId}
                  label={meta.name || protocolId}
                  pct={noReading ? null : e.signalPct}
                  display={
                    !e
                      ? (query?.isError ? 'unavailable' : 'loading')
                      : noReading
                        ? '—'
                        : `${e.composite} / ${e.maxPossible} · ${Number(e.signalPct).toFixed(0)}%`
                  }
                  tone={noReading ? '' : signalClass(e.signal)}
                  stagger={i}
                />
              );
            })}
          </div>
        </motion.section>

        <motion.section className="sym-card" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.12 }}>
          <h2>Net P&L per Bot</h2>
          <p className="sym-muted sym-source-line">Realised, closed trades on {symbol}. Right = profit, left = loss, scaled to the largest move.</p>
          <PnlBars rows={perBot} maxAbs={maxAbsPnl} />
          {bestBot && worstBot && bestBot !== worstBot && (
            <p className="sym-muted sym-multi-note">
              Best <strong className="sym-tone-good">{bestBot.label}</strong> {bestBot.pnl >= 0 ? '+' : ''}{bestBot.pnl.toFixed(2)}
              {' · '}worst <strong className="sym-tone-bad">{worstBot.label}</strong> {worstBot.pnl >= 0 ? '+' : ''}{worstBot.pnl.toFixed(2)}
            </p>
          )}
        </motion.section>

        <motion.section className="sym-card" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.13 }}>
          <h2>How Trades Ended</h2>
          <p className="sym-muted sym-source-line">Pooled across every bot trading {symbol}.</p>
          <ExitStack rows={exitRows} total={exitTotal} />
        </motion.section>
      </div>

      {/* ── Directive Drilldown ── */}
      {primaryEnv?.groups?.length > 0 && (
        <motion.section className="sym-card" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.12 }}>
          <h2>Directive Drilldown</h2>
          <p className="sym-muted sym-source-line">For <strong>{scoredProtocols[0].protocolId}</strong></p>
          <div className="sym-groups">
            {primaryEnv.groups.map(g => (
              <div key={g.groupId} className={`sym-group ${g.isRisk ? 'sym-group-risk' : ''}`}>
                <div className="sym-group-head">
                  <span className="sym-group-name">{g.groupName}</span>
                  <span className={`sym-group-score ${g.score > 65 ? 'sym-tone-good' : g.score < 35 ? 'sym-tone-bad' : 'sym-tone-mid'}`}>{g.score}</span>
                  <span className="sym-group-wt">({g.weight}%)</span>
                </div>
                {g.topDirectives.map(d => (
                  <div key={d.id} className={`sym-dir sym-dir-${d.signalClass}`}>
                    <span className="sym-dir-name">{d.name}</span>
                    <span className="sym-dir-score">{d.normalized}</span>
                    <span className="sym-dir-reason">{d.reason}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
          {primaryEnv.conflicts?.length > 0 && (
            <div className="sym-conflicts">
              {primaryEnv.conflicts.map((c, i) => (
                <span key={i} className={`sym-conflict sym-conflict-${c.severity}`}>{c.description}</span>
              ))}
            </div>
          )}
        </motion.section>
      )}
      {/* ⚠️ An ABSENCE has to say WHICH absence it is. The old version simply rendered nothing, so
          a symbol with no score and a symbol with a failing score looked identical — the user got
          a shorter page and no reason (#926, development-philosophy section 7). */}
      {!primaryEnv?.groups?.length && scoredProtocols.length === 0 && protocolIds.length > 0 && (
        <motion.section className="sym-card" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.12 }}>
          <h2>Directive Drilldown</h2>
          <p className="sym-muted">
            No directive breakdown available — none of the {protocolIds.length} protocol(s) covering
            {' '}<strong>{symbol}</strong> returned a score. See the Score card for the reason.
          </p>
        </motion.section>
      )}

      {/* ── Protocol Scores — every protocol scoring this symbol, each labelled ── */}
      {protocolScores.length > 0 && (
        <motion.section className="sym-card" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.14 }}>
          <h2>Protocol Scores</h2>
          <div className="sym-protocols">
            {protocolScores.map(({ protocolId, meta, env: e, query }) => (
              <div key={protocolId} className="sym-proto">
                <div className="sym-proto-head">
                  <strong>{meta.name || protocolId}</strong>
                  {e ? (
                    <>
                      <span className={`sym-proto-score ${String(e.signal).toLowerCase()}`}>{e.composite.toFixed(0)}</span>
                      <span className={`sym-proto-sig ${String(e.signal).toLowerCase()}`}>{e.signal}</span>
                    </>
                  ) : query?.isError ? (
                    <span className="sym-proto-unavailable">unavailable</span>
                  ) : (
                    <span className="sym-proto-unavailable">loading…</span>
                  )}
                </div>
                <div className="sym-proto-meta">
                  <span className="sym-source">{protocolId}</span>
                  {meta.recommendedTimeframe || meta.tradingStyle ? (
                    <span>{meta.recommendedTimeframe || meta.tradingStyle}</span>
                  ) : null}
                  {meta.directionMode && <span>{meta.directionMode}</span>}
                </div>
              </div>
            ))}
          </div>
        </motion.section>
      )}

      {/* ── Per-Bot Outcomes (#921) — what each bot INTENDS vs what it DOES on this symbol ──
          The comparison this whole investigation kept arriving at, previously only obtainable by
          hand. Every rate carries its `n`.
          ⚠️ Trades shown EXCLUDE phantom closes — rows marked closed with no brokerTicket and no
          exitPrice (#931). The excluded count is stated below, because otherwise the numbers look
          like they simply do not add up. */}
      {botOutcomes.length > 0 && (
        <motion.section className="sym-card" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }}>
          <h2>Bot Outcomes on {symbol}</h2>
          <div className="sym-outcomes">
            {botOutcomes.map((o) => (
              <BotOutcomeCard key={o.attribution} o={o} />
            ))}
          </div>
          <p className="sym-muted sym-multi-note">
            Excludes <strong>{focus?.outcomeCoverage?.excludedPhantomRows ?? 0}</strong> row(s) marked closed
            with no broker ticket and no exit price — bulk-write residue, not trades (#931).
          </p>
        </motion.section>
      )}

      {/* ── News ── */}
      <motion.section className="sym-card" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.16 }}>
        <h2>Recent News</h2>
        {newsArticles.length > 0 ? (
          <div className="sym-news-list">
            {newsArticles.map((a, i) => (
              <a key={i} href={a.url || '#'} target="_blank" rel="noopener noreferrer" className="sym-news-item">
                <span className="sym-news-source">{a.source}</span>
                <span className="sym-news-title">{a.headline || a.title}</span>
                <span className="sym-news-time">{a.time ? new Date(a.time).toLocaleDateString() : ''}</span>
              </a>
            ))}
          </div>
        ) : (
          <p className="sym-muted">No recent news.</p>
        )}
      </motion.section>

      {/* ── Actions ── */}
      <motion.div className="sym-actions" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.18 }}>
        {symId && (
          <Link to={`/research/symbol/${symId}`} className="sym-action-btn sym-action-full">📊 Full Detail (Chart & Trade)</Link>
        )}
        <Link to={`/research/investigation?symbol=${symbol}`} className="sym-action-btn">🔍 Research</Link>
      </motion.div>
    </div>
  );
}
