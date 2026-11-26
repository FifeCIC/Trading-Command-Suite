/**
 * MoversDepthChart — ONE session's price with its decisions on it (note m).
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────────────────────────────
 * The owner's note was *"a price chart with markers — score, entry, stop moves, exit — on the bar axis.
 * The one change that turns reading into looking."* Everything above this chart is a table: a bar's
 * price in one column, its score in another, its state in a third, and the executions in a fourth. A
 * reader reconstructs the session in their head. The chart shows it and lets the tables keep the detail.
 *
 * ── WHAT IS DRAWN, AND WHAT DELIBERATELY IS NOT ────────────────────────────────────────────────────
 * DRAWN  · the bar CLOSE as a line — the engine records one price per bar, so candles would invent four
 *        · an arrow at each entry (up for a long, down for a short) and a square at each exit, each
 *          carrying the price and the exit reason
 *        · the same composite score the tables print, as a histogram under the price on its own scale
 *        · the stop and target of the trade ALIVE at the pinned bar — only that one, or the chart
 *          becomes 126 horizontal lines
 * ⚠️ NOT DRAWN — the PATH of a trailing stop. The engine stores the level a trade ended with, not each
 * move. A moving line would be a drawing of something never measured.
 *
 * ⚠️ lightweight-charts v5 (installed 5.2.0). v4 helpers are gone: `addSeries(LineSeries, …)` not
 * `addLineSeries(…)`, and `createSeriesMarkers(series, markers)` not `series.setMarkers(…)`. The v4 form
 * did not throw — it silently drew no markers at all (#1134), which is the failure this chart exists to
 * avoid repeating. `scripts/validate-chart-api.cjs` fails the build on the v4 calls.
 */
import { useEffect, useMemo, useRef } from 'react';
import {
  createChart,
  AreaSeries,
  HistogramSeries,
  createSeriesMarkers,
  ColorType,
} from 'lightweight-charts';
import { buildDepthChart } from '../../features/movers-strategy/depth-chart.js';

const HEIGHT = 300;

/** The colour each level is drawn in, so the module stays free of presentation (it returns the kind). */
const LEVEL_COLOR = { stop: '#ef4444', target: '#22c55e' };

export default function MoversDepthChart({ bars, trades, pinTime, symbol }) {
  const boxRef = useRef(null);
  const chartRef = useRef(null);
  const markersRef = useRef(null);

  /** Built ONCE and read twice — by the effect that draws it and by the note that describes it. */
  const shape = useMemo(() => buildDepthChart(bars, trades, { pinTime }), [bars, trades, pinTime]);

  useEffect(() => {
    if (!boxRef.current) return undefined;

    const chart = createChart(boxRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#8b93a7',
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.05)' },
        horzLines: { color: 'rgba(255,255,255,0.05)' },
      },
      rightPriceScale: { borderColor: 'rgba(255,255,255,0.12)', scaleMargins: { top: 0.08, bottom: 0.34 } },
      timeScale: { borderColor: 'rgba(255,255,255,0.12)', timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 },
      width: boxRef.current.clientWidth,
      height: HEIGHT,
    });
    chartRef.current = chart;

    const price = chart.addSeries(AreaSeries, {
      lineColor: '#60a5fa',
      topColor: 'rgba(96,165,250,0.28)',
      bottomColor: 'rgba(96,165,250,0.02)',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    price.setData(shape.price);

    /**
     * The score histogram shares the time axis and takes the bottom third of the pane. Its own scale
     * (`score`) is separate from price on purpose: composite scores run 0–100 and prices run 1.4–600, so
     * one shared scale would flatten whichever drawn second into the axis.
     */
    const score = chart.addSeries(HistogramSeries, {
      priceScaleId: 'score',
      priceLineVisible: false,
      lastValueVisible: false,
      base: 0,
    });
    chart.priceScale('score').applyOptions({ scaleMargins: { top: 0.72, bottom: 0 } });
    score.setData(shape.score.map((d) => ({ time: d.time, value: d.value, color: 'rgba(167,139,250,0.45)' })));

    for (const lv of shape.levels) {
      price.createPriceLine({
        price: lv.price,
        color: LEVEL_COLOR[lv.title] ?? '#8b93a7',
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: lv.title,
      });
    }

    // ⚠️ v5: markers are an OBJECT created against the series, not a method on it.
    markersRef.current = createSeriesMarkers(price, shape.markers);

    const onResize = () => {
      if (boxRef.current) chart.applyOptions({ width: boxRef.current.clientWidth });
    };
    window.addEventListener('resize', onResize);
    chart.timeScale().fitContent();

    return () => {
      window.removeEventListener('resize', onResize);
      markersRef.current = null;
      chart.remove();
      chartRef.current = null;
    };
  }, [bars, trades, pinTime, shape]);

  return (
    <section id="mvp-sec-chart" aria-label={`Price and decisions for ${symbol}`}>
      <h3 className="mvp-depth-title">
        Price &amp; decisions
        <span className="mvp-muted"> ({shape.priced} bar(s) of {shape.bars} priced, {shape.markers.length} marker(s))</span>
      </h3>
      <div className="mvp-chart" ref={boxRef} />
      <p className="mvp-note">
        One point per bar — the close the engine recorded, so this is a line and not candles.
        <strong> Arrows</strong> are entries (up long, down short, grey when the selection refused the
        trade) and <strong>squares</strong> are exits, labelled with the reason and price. The histogram
        is the same composite score the table prints, on its own scale.
        {shape.levels.length > 0
          ? ' The dashed lines are the stop and target of the trade alive at the bar you picked — one horizontal level each, because the engine records where a bracket ended, not each move of a trailing stop.'
          : ' Pick a bar in the table below to draw the stop and target the trade was walking against.'}
        {shape.unplaced > 0 && (
          <>
            {' '}
            <strong>{shape.unplaced} trade(s) could not be placed</strong> — their instants do not fall on
            any bar this run recorded, so they are counted here rather than left off the chart silently.
          </>
        )}
      </p>
    </section>
  );
}
