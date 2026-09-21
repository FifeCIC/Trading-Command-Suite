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

const SIGNAL_COLORS = { BUY: '#22c55e', SELL: '#ef4444', HOLD: '#94a3b8' };

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
  const changeRaw = overview?.changePercent ?? overview?.change ?? priceObj?.changePct ?? null;
  const change = typeof changeRaw === 'number' ? changeRaw : null;
  const symMeta = overview?.symbol;
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
              {price.toFixed(symbol.length === 6 && !symbol.includes('-') ? 5 : 2)}
            </span>
          )}
          {change != null && (
            <span className={`sym-change ${change >= 0 ? 'sym-up' : 'sym-down'}`}>
              {change >= 0 ? '↑' : '↓'} {Math.abs(change).toFixed(2)}%
            </span>
          )}
          {symMeta?.exchange && <span className="sym-chip">{symMeta.exchange}</span>}
          {symMeta?.type && <span className="sym-chip">{symMeta.type}</span>}
        </div>
      </motion.header>

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
                <span className="sym-score-val" style={{ color: SIGNAL_COLORS[primaryEnv.signal] || '#94a3b8' }}>
                  {primaryEnv.composite.toFixed(0)}
                </span>
                <span
                  className="sym-score-signal"
                  style={{ background: (SIGNAL_COLORS[primaryEnv.signal] || '#94a3b8') + '22', color: SIGNAL_COLORS[primaryEnv.signal] }}
                >{primaryEnv.signal}</span>
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
                  <span className="sym-group-score" style={{ color: g.score > 65 ? '#22c55e' : g.score < 35 ? '#ef4444' : '#94a3b8' }}>{g.score}</span>
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
            {botOutcomes.map((o) => {
              const r = o.realised;
              const payoffGap =
                o.declared.declaredPayoff !== null && r.realisedPayoff !== null
                  ? Number((r.realisedPayoff - o.declared.declaredPayoff).toFixed(2))
                  : null;
              return (
                <div key={o.attribution} className="sym-outcome">
                  <div className="sym-outcome-head">
                    <strong>{o.botName || o.attribution}</strong>
                    <span className="sym-source">{o.protocolId || o.attribution}</span>
                    {!o.matchedBot && (
                      <span className="sym-outcome-warn" title="scoringStrategyId holds a protocol slug, not a bot id — attribution is unresolved for this row">
                        ⚠ attribution unresolved
                      </span>
                    )}
                  </div>

                  <div className="sym-outcome-grid">
                    <span className="sym-outcome-k">Config</span>
                    <span>{[o.brokerId, o.timeframe].filter(Boolean).join(' · ') || '—'}</span>

                    <span className="sym-outcome-k">Intended</span>
                    <span>
                      {o.declared.slPct !== null && o.declared.tpPct !== null
                        ? `SL ${o.declared.slPct}% / TP ${o.declared.tpPct}% → payoff ${o.declared.declaredPayoff}`
                        : <em>not declared</em>}
                    </span>

                    <span className="sym-outcome-k">Realised</span>
                    <span>
                      {r.avgWin !== null && r.avgLoss !== null ? (
                        <>
                          win {r.avgWin.toFixed(2)} / loss {r.avgLoss.toFixed(2)} → payoff{' '}
                          <strong style={{ color: payoffGap !== null && payoffGap < 0 ? 'var(--color-loss)' : 'var(--color-profit)' }}>
                            {r.realisedPayoff}
                          </strong>
                          {payoffGap !== null && (
                            <em className="sym-outcome-gap"> ({payoffGap > 0 ? '+' : ''}{payoffGap} vs intended)</em>
                          )}
                        </>
                      ) : (
                        /* ⚠️ A missing side is a FINDING, not a zero. "No losses yet" and
                           "payoff 0" are different statements and must not render alike. */
                        <em>
                          {r.trades === 0
                            ? 'no trades on this symbol'
                            : r.avgLoss === null
                              ? `${r.trades} trade${r.trades === 1 ? '' : 's'}, no losses yet → payoff not measurable`
                              : `${r.trades} trade${r.trades === 1 ? '' : 's'}, no wins yet → payoff not measurable`}
                        </em>
                      )}
                    </span>

                    <span className="sym-outcome-k">Record</span>
                    <span>
                      {r.trades} trade{r.trades === 1 ? '' : 's'} · {r.wins} win{r.wins === 1 ? '' : 's'}
                      {r.winRate !== null && <> · {r.winRate}% (n={r.trades})</>} · P&L {r.totalPnl >= 0 ? '+' : ''}{r.totalPnl.toFixed(2)}
                    </span>

                    <span className="sym-outcome-k">Exits</span>
                    <span>
                      {Object.keys(o.closeReasons).length === 0
                        ? <em>no close reasons recorded</em>
                        : Object.entries(o.closeReasons).map(([why, n]) => (
                            <span key={why} className="sym-outcome-reason">{why} ×{n}</span>
                          ))}
                    </span>

                    <span className="sym-outcome-k">Bar</span>
                    <span>
                      minComposite {o.minComposite ?? '—'}
                      {/* Never omit the comparison silently — an absent ceiling must LOOK absent. */}
                      <em className="sym-outcome-gap"> · protocol ceiling not available yet (#905)</em>
                    </span>
                  </div>
                </div>
              );
            })}
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
