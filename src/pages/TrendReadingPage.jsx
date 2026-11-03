/**
 * TrendReadingPage — the trend READING experiment (#1190). ROUTE: `/development/trend-reading`.
 *
 * ============================================================================================
 * WHY THIS EXISTS
 * ============================================================================================
 *
 * Owner, 2026-11-03: *"explain to me how other bots and AI trading agents or algorithms determine
 * trend, just like a trader might draw a predicted trend on a chart — is this app doing that and is
 * it even possible?"* … *"yes use the research you just explained to me and do this as an
 * experimental feature."*
 *
 * The app's scoring returns `score / maxScore` per directive. A reader has no way to see what that
 * number was looking at. This page shows the two things a trader actually looks at — a fitted line
 * and the level where the idea is wrong — so a 0–100 composite can be judged against a picture.
 *
 * ============================================================================================
 * WHAT THIS PAGE IS CAREFUL TO SAY
 * ============================================================================================
 *
 * A trendline's predictive content is small; its INVALIDATION level is the half that protects a
 * position. So the invalidation is given a row of its own rather than being buried in a tooltip,
 * and the projection is labelled an extension of the fit, drawn dashed, and gated on R².
 *
 * ⚠️ Three states are kept apart everywhere on this page, because collapsing them is the defect
 * this repo pays for most often:
 *   · no reading yet        → nothing is claimed
 *   · the request failed    → a NoticeBlock, never an empty chart
 *   · not enough bars       → the server's own message naming the count it found and needs
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import NoticeBlock from '../components/NoticeBlock';
import { noticeFromError } from '../core/notices/from-error.js';
import './trend-reading.css';

const TIMEFRAMES = ['15m', '1h', '4h', '1d'];

/**
 * The chart. Inline SVG on purpose: it draws EXACTLY the series the API returned, with no second
 * fetch and no time-scale adapter to disagree with the numbers beside it. For an experiment the
 * property that matters is "the picture and the table cannot say different things".
 */
function TrendChart({ data }) {
  const W = 900;
  const H = 340;
  const PAD = { top: 16, right: 74, bottom: 22, left: 8 };

  const geo = useMemo(() => {
    if (!data?.series?.length || !data?.fitted?.length) return null;
    const closes = data.series.map((b) => b.c);
    const fits = data.fitted.map((f) => f.v);
    const uppers = data.band.map((b) => b.upper);
    const lowers = data.band.map((b) => b.lower);
    const proj = data.read.projection;

    const all = [...closes, ...fits, ...uppers, ...lowers, proj.value, proj.upper, proj.lower];
    const lo = Math.min(...all);
    const hi = Math.max(...all);
    const span = hi - lo || 1;

    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;
    // The projection gets its own slice of the x axis, so the extrapolation is visibly OUTSIDE the
    // fitted region rather than laid over it.
    const totalPoints = data.series.length + proj.horizonBars;
    const x = (i) => PAD.left + (i / Math.max(1, totalPoints - 1)) * innerW;
    const y = (v) => PAD.top + innerH - ((v - lo) / span) * innerH;

    const closePath = data.series.map((b, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(b.c).toFixed(1)}`).join(' ');
    const fitStart = data.read.regression.startIndex;
    const fitPath = data.fitted
      .map((f, i) => `${i === 0 ? 'M' : 'L'}${x(fitStart + i).toFixed(1)},${y(f.v).toFixed(1)}`)
      .join(' ');
    const bandPath = [
      ...data.band.map((b, i) => `${i === 0 ? 'M' : 'L'}${x(fitStart + i).toFixed(1)},${y(b.upper).toFixed(1)}`),
      ...[...data.band].reverse().map((b, i) => `L${x(fitStart + data.band.length - 1 - i).toFixed(1)},${y(b.lower).toFixed(1)}`),
      'Z',
    ].join(' ');
    const lastIdx = data.series.length - 1;
    const projEndIdx = totalPoints - 1;
    const projPath = `M${x(lastIdx).toFixed(1)},${y(data.read.regression.endValue).toFixed(1)} L${x(projEndIdx).toFixed(1)},${y(proj.value).toFixed(1)}`;

    return { lo, hi, span, x, y, closePath, fitPath, bandPath, projPath, lastIdx, projEndIdx, innerW };
  }, [data]);

  if (!geo) return null;

  const { read, series } = data;
  const lastClose = series[series.length - 1].c;
  const invalidation = read.invalidation.chosen;
  const broken = read.invalidation.alreadyBroken;
  const px = geo.x(geo.lastIdx);
  const py = geo.y(lastClose);
  return (
    <svg className="tr-chart" viewBox={`0 0 ${W} ${H}`} role="img"
      aria-label={`${data.symbol} ${data.timeframe}: close price with fitted trend line, channel and invalidation level`}>
      {/* Horizontal grid: four lines, unlabelled on the chart — the axis values are in the table. */}
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <line key={f} x1={PAD.left} x2={W - PAD.right}
          y1={PAD.top + (H - PAD.top - PAD.bottom) * f}
          y2={PAD.top + (H - PAD.top - PAD.bottom) * f}
          className="tr-grid" />
      ))}

      {/* The channel, drawn UNDER everything so the closes stay readable. */}
      <path d={geo.bandPath} className="tr-band" />
      <path d={geo.closePath} className="tr-close" />
      <path d={geo.fitPath} className="tr-fit" />
      {/* Dashed, and past a divider: unmistakably an extension, never a continuation. */}
      <line x1={geo.x(geo.lastIdx)} x2={geo.x(geo.lastIdx)} y1={PAD.top} y2={H - PAD.bottom} className="tr-now" />
      <path d={geo.projPath} className="tr-proj" />

      {/* Invalidation — the whole point of the reading, so it gets its own labelled line.
          ⚠️ The word must match the DIRECTION: an uptrend is invalidated BELOW, a downtrend ABOVE.
          Saying "invalid below" on a downtrend would point the reader at the wrong side of price,
          which is the one error on this page that could actually be acted on.
          ⚠️ When NOTHING is on the correct side, no line is drawn at all — the structure has
          already been passed, and a level above an uptrend would be a stop the market is beyond. */}
      {invalidation != null && (
        <>
          <line x1={PAD.left} x2={W - PAD.right} y1={geo.y(invalidation)} y2={geo.y(invalidation)} className="tr-invalidation" />
          <text x={PAD.left + 4} y={geo.y(invalidation) - 5} className="tr-invalidation-label">
            {read.verdict === 'trending-down' ? 'invalid ABOVE' : 'invalid BELOW'} {invalidation}
          </text>
        </>
      )}
      {broken && (
        <text x={PAD.left + 4} y={PAD.top + 12} className="tr-broken-label">
          structure already broken — no level on the correct side
        </text>
      )}

      {/* Pivots: the structural anchors a human would have clicked on. */}
      {[read.pivots.recentHigh, read.pivots.recentLow].filter(Boolean).map((p) => (
        <circle key={`${p.kind}-${p.index}`} cx={geo.x(p.index)} cy={geo.y(p.price)} r={3}
          className={p.kind === 'high' ? 'tr-pivot-high' : 'tr-pivot-low'}>
          <title>{`${p.kind} pivot at ${p.price} (${p.timestamp}) — confirmed, cannot move`}</title>
        </circle>
      ))}

      <circle cx={px} cy={py} r={4} className="tr-now-dot" />
      <text x={px + 7} y={py + 4} className="tr-price-label">{lastClose}</text>

      <text x={W - PAD.right + 6} y={PAD.top + 10} className="tr-axis">{geo.hi}</text>
      <text x={W - PAD.right + 6} y={H - PAD.bottom} className="tr-axis">{geo.lo}</text>
      <text x={geo.x(geo.projEndIdx) - 6} y={H - 6} className="tr-axis" textAnchor="end">
        +{read.projection.horizonBars} bars (extrapolation)
      </text>
    </svg>
  );
}

const VERDICT_LABEL = {
  'trending-up': 'Trending up',
  'trending-down': 'Trending down',
  ranging: 'Ranging',
  indeterminate: 'Indeterminate',
};

export default function TrendReadingPage() {
  const [symbol, setSymbol] = useState('XAUUSD');
  const [input, setInput] = useState('XAUUSD');
  const [timeframe, setTimeframe] = useState('1h');
  const [bars, setBars] = useState(200);

  const readable = useQuery({
    queryKey: ['trend-readable', timeframe],
    queryFn: () => apiGet(`/api/trend/readable?timeframe=${encodeURIComponent(timeframe)}`),
    staleTime: 60_000,
  });

  const read = useQuery({
    queryKey: ['trend-read', symbol, timeframe, bars],
    queryFn: () => apiGet(`/api/trend/read?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}&bars=${bars}`),
    enabled: !!symbol,
    retry: false,
  });

  const d = read.data;
  const r = d?.read;

  return (
    <div className="tr-page">
      <header className="tr-head">
        <div>
          <h2>Trend Reading <span className="tr-tag">experiment</span></h2>
          <p className="tr-sub">
            What the trend is doing, where a human would draw the line, and the price at which that
            idea is <strong>wrong</strong>.
          </p>
        </div>
      </header>

      <div className="tr-controls">
        <form
          className="tr-symbol-form"
          onSubmit={(e) => { e.preventDefault(); setSymbol(input.toUpperCase().trim()); }}
        >
          <label className="tr-field">
            <span>Symbol</span>
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="XAUUSD" spellCheck={false} />
          </label>
          <button type="submit">Read</button>
        </form>

        <label className="tr-field">
          <span>Cadence</span>
          <select value={timeframe} onChange={(e) => setTimeframe(e.target.value)}>
            {TIMEFRAMES.map((tf) => <option key={tf} value={tf}>{tf}</option>)}
          </select>
        </label>

        <label className="tr-field">
          <span>Bars</span>
          <select value={bars} onChange={(e) => setBars(Number(e.target.value))}>
            {[60, 120, 200, 400, 800].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>

        {readable.data?.symbols?.length > 0 && (
          <div className="tr-readable">
            <span>Has enough {timeframe} bars:</span>
            {readable.data.symbols.slice(0, 12).map((s) => (
              <button key={s} type="button" className={`tr-chip ${s === symbol ? 'tr-chip-on' : ''}`}
                onClick={() => { setInput(s); setSymbol(s); }}>
                {s}
              </button>
            ))}
            {readable.data.symbols.length > 12 && (
              <span className="tr-more">+{readable.data.symbols.length - 12}</span>
            )}
          </div>
        )}
      </div>

      {read.isLoading && <div className="tr-loading">Reading {symbol} {timeframe}…</div>}

      {/* A failed request is a NoticeBlock. It is NOT an empty chart: those two must never look
          the same, because an empty chart reads as "no trend" rather than "no answer". */}
      {read.error && (
        <NoticeBlock notice={noticeFromError(read.error, 'TCS-SYS-007', { operation: `read the trend for ${symbol} ${timeframe}` })} />
      )}

      {r && (
        <>
          <div className={`tr-verdict tr-verdict--${r.verdict}`}>
            <div className="tr-verdict-main">
              <span className="tr-verdict-word">{VERDICT_LABEL[r.verdict] ?? r.verdict}</span>
              <span className="tr-verdict-meta">
                {d.symbol} · {d.timeframe} · {r.sample.used} bars · confidence {r.confidence}/100
              </span>
            </div>
            <p className="tr-verdict-why">
              {r.familiesAgree
                ? `Both families agree: the fitted line explains ${(r.regression.r2 * 100).toFixed(0)}% of the variance, and ADX reads ${r.adx.value}.`
                : `⚠️ The two families DISAGREE — the line explains ${(r.regression.r2 * 100).toFixed(0)}% of the variance while ADX reads ${r.adx.value}. Treat this as one opinion, not two.`}
            </p>
          </div>

          <div className="tr-chart-wrap">
            <TrendChart data={d} />
            <div className="tr-legend">
              <span><i className="tr-key tr-key-close" /> close</span>
              <span><i className="tr-key tr-key-fit" /> fitted line</span>
              <span><i className="tr-key tr-key-band" /> ±2σ channel</span>
              <span><i className="tr-key tr-key-proj" /> projection (extrapolation)</span>
              <span><i className="tr-key tr-key-inv" /> invalidation</span>
            </div>
          </div>

          <div className="tr-grid2">
            <section className="tr-panel">
              <h3>The line</h3>
              <table className="tr-table">
                <tbody>
                  <tr><th>Slope</th><td>{r.regression.slopePctPerBar}% per bar</td></tr>
                  <tr><th>R² (how line-like)</th><td>{r.regression.r2} <span className="tr-hint">1 = a perfect line, 0 = noise</span></td></tr>
                  <tr><th>Close vs line</th><td>{r.channel.positionPct}% up the channel <span className="tr-hint">0 = lower edge, 100 = upper</span></td></tr>
                  <tr><th>Channel width</th><td>{r.channel.widthPct}% of price</td></tr>
                  <tr><th>Range position</th><td>{r.donchianPositionPct}% of the last 20 bars</td></tr>
                </tbody>
              </table>
            </section>

            <section className="tr-panel">
              <h3>Directional movement</h3>
              <table className="tr-table">
                <tbody>
                  <tr><th>ADX</th><td>{r.adx.value} <span className="tr-hint">≥{r.thresholds.adxTrending} trend · &lt;{r.thresholds.adxRanging} range</span></td></tr>
                  <tr><th>+DI / −DI</th><td>{r.adx.plusDi} / {r.adx.minusDi}</td></tr>
                  <tr><th>Recent swing high</th><td>{r.pivots.recentHigh ? r.pivots.recentHigh.price : '—'}</td></tr>
                  <tr><th>Recent swing low</th><td>{r.pivots.recentLow ? r.pivots.recentLow.price : '—'}</td></tr>
                </tbody>
              </table>
            </section>

            <section className="tr-panel tr-panel--key">
              <h3>Where this is wrong</h3>
              <table className="tr-table">
                <tbody>
                  {r.invalidation.chosen != null ? (
                    <tr className="tr-invalidation-row">
                      <th>{r.verdict === 'trending-down' ? 'Invalid above' : 'Invalid below'}</th>
                      <td><strong>{r.invalidation.chosen}</strong>
                        <span className="tr-hint"> chosen because it is reached first ({r.invalidation.chosenBasis})</span>
                      </td>
                    </tr>
                  ) : r.invalidation.alreadyBroken ? (
                    // ⚠️ NOT an empty cell. The fit still leans one way while price has already gone
                    // through its own structure — that contradiction is the most important thing on
                    // the page, so it gets a sentence rather than a dash.
                    <tr className="tr-invalidation-row">
                      <th>Invalidation</th>
                      <td><strong>Already broken</strong>
                        <span className="tr-hint"> the fit still leans {r.verdict === 'trending-down' ? 'down' : 'up'} but price has passed every level that would have been one</span>
                      </td>
                    </tr>
                  ) : r.invalidation.notApplicable ? (
                    <tr><th>Invalidation</th><td>— <span className="tr-hint">a {r.verdict} reading has edges, not an invalidation</span></td></tr>
                  ) : (
                    <tr><th>Invalidation</th><td>— <span className="tr-hint">no candidate level in this window</span></td></tr>
                  )}
                  <tr><th>Regression edge</th><td>{r.invalidation.regressionEdge ?? '—'}</td></tr>
                  <tr><th>Swing level</th><td>{r.invalidation.swingLevel ?? '—'}</td></tr>
                </tbody>
              </table>
              <p className="tr-note">
                Both candidates are shown because they fail at different moments; the tighter one is
                chosen because a reversal reaches it first. Which one won is named rather than implied.
              </p>
            </section>

            <section className="tr-panel">
              <h3>The fit, extended</h3>
              <table className="tr-table">
                <tbody>
                  <tr><th>Projected ({r.projection.horizonBars} bars)</th><td>{r.projection.value}</td></tr>
                  <tr><th>Band</th><td>{r.projection.lower} … {r.projection.upper}</td></tr>
                  <tr><th>Strength</th><td>{r.projection.strength}</td></tr>
                </tbody>
              </table>
              <p className="tr-note tr-warn">
                An <strong>extension of the fit</strong>, not a forecast. At R² below {r.thresholds.r2Ranging}
                the line is describing noise, and extending noise is arithmetic without meaning.
              </p>
            </section>
          </div>

          <section className="tr-panel tr-panel--about">
            <h3>What this does and does not do</h3>
            <div className="tr-about-grid">
              <div>
                <h4>Computed</h4>
                <ul>
                  <li><strong>Trend state</strong> — is it trending, which way, how strongly (R² and ADX, reported separately because they disagree).</li>
                  <li><strong>A trend line</strong> — least-squares through the closes, with a ±2σ channel.</li>
                  <li><strong>Confirmed pivots</strong> — a swing that cannot repaint, at the cost of {3} bars of lag.</li>
                  <li><strong>Invalidation</strong> — where the reading stops being true.</li>
                </ul>
              </div>
              <div>
                <h4>Not computed, deliberately</h4>
                <ul>
                  <li><strong>A forecast.</strong> Where price goes is not in these numbers; the projection is the line carried forward and nothing more.</li>
                  <li><strong>Anything that feeds a score.</strong> Nothing in scoring, gating, sizing or execution reads this page's data. That is what keeps it free to be wrong while it is being judged.</li>
                </ul>
              </div>
            </div>
            <p className="tr-note">{d.note}</p>
          </section>
        </>
      )}
    </div>
  );
}
