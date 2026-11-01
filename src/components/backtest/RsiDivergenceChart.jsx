/**
 * RsiDivergenceChart — price + RSI with the pivots and the divergence pairs drawn.
 *
 * ── WHY TWO PANES, AND WHY THE PAIRS ARE DRAWN AS LINES ──────────────────────────────────────────
 * A divergence is a RELATIONSHIP between two bars, in two series at once: price made a lower low while
 * RSI made a higher low. A marker alone says "something fired here" and leaves the reader to reconstruct
 * the claim — which is exactly the complaint that started this work (*"I don't understand what the
 * 'bracket' and 'cuts the bar from' actually means … I can't right now [trust it]"*). So each pair is
 * drawn as a line across the two pivots in BOTH panes: the price line must visibly slope one way while
 * the RSI line slopes the other. If those two lines do not disagree, there is nothing to see and the
 * chart should not be claiming a divergence.
 *
 * ── THE COLOUR RULE ──────────────────────────────────────────────────────────────────────────────
 *   regular bullish  green, solid      price lower low   / RSI higher low    → reversal up
 *   hidden  bullish  teal,  dashed     price higher low  / RSI lower low     → continuation up
 *   regular bearish  red,   solid      price higher high / RSI lower high    → reversal down
 *   hidden  bearish  amber, dashed     price lower high  / RSI higher high   → continuation down
 *
 * ⚠️ SOLID = REVERSAL, DASHED = CONTINUATION, and the legend says so. The four kinds are not four
 * strengths of one thing — a hidden divergence argues the OPPOSITE trade to a regular one at the same
 * bar, so a chart that drew them alike would be worse than one that drew none.
 */
import { useEffect, useRef } from 'react';
import { createChart, CandlestickSeries, LineSeries } from 'lightweight-charts';

const KIND_STYLE = {
  'regular-bullish': { color: '#22c55e', dashed: false, label: 'Bull', pane: 1, marker: 'belowBar' },
  'hidden-bullish': { color: '#14b8a6', dashed: true, label: 'H Bull', pane: 1, marker: 'belowBar' },
  'regular-bearish': { color: '#ef4444', dashed: false, label: 'Bear', pane: 1, marker: 'aboveBar' },
  'hidden-bearish': { color: '#f59e0b', dashed: true, label: 'H Bear', pane: 1, marker: 'aboveBar' },
};

/** A cap, because each pair is its own `LineSeries` and a chart is not a render benchmark. */
const MAX_DRAWN_PAIRS = 60;

const toSeconds = (iso) => Math.floor(new Date(iso).getTime() / 1000);

export default function RsiDivergenceChart({ preview, height = 520 }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);

  const bars = preview?.bars ?? [];
  const rsi = preview?.rsi ?? [];
  const divergences = preview?.divergences ?? [];

  useEffect(() => {
    if (!containerRef.current || bars.length === 0) return;

    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height,
      layout: { background: { color: '#0f172a' }, textColor: '#94a3b8' },
      grid: {
        vertLines: { color: 'rgba(51, 65, 85, 0.3)' },
        horzLines: { color: 'rgba(51, 65, 85, 0.3)' },
      },
      crosshair: { mode: 0 },
      timeScale: { borderColor: 'rgba(51, 65, 85, 0.5)', timeVisible: true },
      rightPriceScale: { borderColor: 'rgba(51, 65, 85, 0.5)' },
    });

    // ── pane 0: price ──
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
      priceLineVisible: false,
    });
    candles.setData(bars.map((b) => ({
      time: toSeconds(b.time),
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
    })));

    // ── pane 1: RSI ──
    const rsiSeries = chart.addSeries(LineSeries, {
      color: '#a78bfa',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
      title: 'RSI',
    }, 1);
    rsiSeries.setData(
      bars
        .map((b, i) => ({ time: toSeconds(b.time), value: rsi[i] }))
        // ⚠️ A null is a bar before the RSI series starts. lightweight-charts treats a `null` value as a
        // break in the line; passing `0` instead would draw the series down to the floor and read as
        // "RSI was oversold" during the warm-up, which never happened.
        .filter((p) => p.value != null && Number.isFinite(p.value)),
    );

    // The 30/70 band, drawn as price lines so the reader can see WHERE the pivot sat.
    for (const [value, colour] of [[70, 'rgba(239,68,68,0.45)'], [50, 'rgba(148,163,184,0.35)'], [30, 'rgba(34,197,94,0.45)']]) {
      rsiSeries.createPriceLine({ price: value, color: colour, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '' });
    }

    // ── the pairs, as two lines each: one in each pane ──
    const drawn = divergences.slice(0, MAX_DRAWN_PAIRS);
    for (const d of drawn) {
      const style = KIND_STYLE[d.kind] ?? KIND_STYLE['regular-bullish'];
      const fromBar = bars[d.fromIndex];
      const toBar = bars[d.toIndex];
      if (!fromBar || !toBar) continue;

      // RSI pane: the indicator leg. This is the half that must DISAGREE with price.
      const indLine = chart.addSeries(LineSeries, {
        color: style.color,
        lineWidth: 2,
        lineStyle: style.dashed ? 2 : 0,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      }, 1);
      indLine.setData([
        { time: toSeconds(fromBar.time), value: d.fromRsi },
        { time: toSeconds(toBar.time), value: d.toRsi },
      ]);

      // Price pane: the price leg, drawn on the pivot prices.
      const priceLine = chart.addSeries(LineSeries, {
        color: style.color,
        lineWidth: 1,
        lineStyle: style.dashed ? 2 : 0,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      }, 0);
      priceLine.setData([
        { time: toSeconds(fromBar.time), value: d.fromPrice },
        { time: toSeconds(toBar.time), value: d.toPrice },
      ]);
    }

    // ── one marker per confirmed pair, on the RSI pane, carrying the KIND and the strength ──
    if (drawn.length > 0 && typeof rsiSeries.setMarkers === 'function') {
      rsiSeries.setMarkers(drawn.map((d) => {
        const style = KIND_STYLE[d.kind] ?? KIND_STYLE['regular-bullish'];
        return {
          time: toSeconds(bars[d.toIndex].time),
          position: style.marker,
          color: style.color,
          shape: style.marker === 'belowBar' ? 'arrowUp' : 'arrowDown',
          text: `${style.label} ${d.strength}%`,
          size: 1.4,
        };
      }));
    }

    chart.timeScale().fitContent();
    chartRef.current = chart;

    const onResize = () => {
      if (chartRef.current && containerRef.current) {
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
    /*
      ⚠️ `preview` IS THE DEPENDENCY, NOT A KEY DERIVED FROM IT. Every settings change produces a new
      response object, so the effect tears down and redraws — which is the whole requirement ("when a
      setting is changed the chart refreshes"). Depending on `bars`/`rsi`/`divergences` separately would
      miss a change that only moved the MARKERS (a toggle) because those arrays are rebuilt server-side
      on every call anyway, and it would also re-run on unrelated parent renders.
    */
  }, [preview, height]);

  if (bars.length === 0) {
    return <p className="pb-none">No bars in this window — nothing can be drawn.</p>;
  }

  return (
    <div className="bt-div-chart">
      <div ref={containerRef} className="bt-div-chart-canvas" />
      <p className="ff-hint bt-div-legend">
        <span className="bt-div-key" style={{ color: '#22c55e' }}>━ Bull</span> regular, solid = reversal{' '}
        <span className="bt-div-key" style={{ color: '#14b8a6' }}>┅ H Bull</span> hidden, dashed = continuation{' '}
        <span className="bt-div-key" style={{ color: '#ef4444' }}>━ Bear</span>{' '}
        <span className="bt-div-key" style={{ color: '#f59e0b' }}>┅ H Bear</span>
        {' '}— each pair is drawn in BOTH panes, and the claim is only visible where the price leg and the
        RSI leg slope in opposite directions.
        {divergences.length > MAX_DRAWN_PAIRS && (
          <> Showing the first {MAX_DRAWN_PAIRS} of {divergences.length} pairs — all of them are in the table.</>
        )}
      </p>
    </div>
  );
}
