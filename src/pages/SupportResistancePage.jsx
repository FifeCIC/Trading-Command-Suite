import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createChart, CandlestickSeries, LineSeries } from 'lightweight-charts';
import { apiGet } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import './support-resistance.css';
import PageInfoPopover from '../components/PageInfoPopover';

const TIMEFRAMES = [
  { id: 'S5', label: 'S5 Intraday', desc: '15–20 min S&R' },
  { id: 'M5', label: 'M5 Session', desc: 'Hours span' },
  { id: 'H1', label: 'H1 Daily', desc: 'Days span' },
  { id: 'D1', label: 'D1 Weekly', desc: 'Weeks/months' },
];

const DEFAULT_SYMBOLS = ['SPY', 'QQQ', 'AAPL', 'NVDA', 'TSLA', 'MSFT', 'XAUUSD', 'EURUSD', 'BTCUSD'];

function SrChart({ levels, bars }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      height: 400,
      layout: {
        background: { color: 'transparent' },
        textColor: 'var(--ink-soft, #94a3b8)',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(148,163,184,0.08)' },
        horzLines: { color: 'rgba(148,163,184,0.08)' },
      },
      crosshair: { mode: 0 },
      timeScale: { borderColor: 'rgba(148,163,184,0.12)' },
      rightPriceScale: { borderColor: 'rgba(148,163,184,0.12)' },
    });

    chartRef.current = chart;

    if (bars && bars.length > 0) {
      const candleSeries = chart.addSeries(CandlestickSeries, {
        upColor: '#22c55e',
        downColor: '#ef4444',
        borderUpColor: '#22c55e',
        borderDownColor: '#ef4444',
        wickUpColor: '#22c55e',
        wickDownColor: '#ef4444',
      });
      candleSeries.setData(bars);

      // Add S/R horizontal lines as price lines on the candle series
      if (levels?.pivot) {
        // R3, R2, R1 as resistance lines
        const resistLines = [
          { price: levels.r3, label: 'R3', color: '#ef4444' },
          { price: levels.r2, label: 'R2', color: '#ef4444' },
          { price: levels.r1, label: 'R1', color: '#ef4444' },
        ];
        for (const rl of resistLines) {
          if (rl.price) {
            candleSeries.createPriceLine({
              price: rl.price,
              color: rl.color,
              lineWidth: 1,
              lineStyle: 2,
              axisLabelVisible: true,
              title: rl.label,
            });
          }
        }

        // Pivot
        candleSeries.createPriceLine({
          price: levels.pivot,
          color: '#f59e0b',
          lineWidth: 2,
          lineStyle: 0,
          axisLabelVisible: true,
          title: 'P',
        });

        // S1, S2, S3 as support lines
        const supportLines = [
          { price: levels.s1, label: 'S1', color: '#22c55e' },
          { price: levels.s2, label: 'S2', color: '#22c55e' },
          { price: levels.s3, label: 'S3', color: '#22c55e' },
        ];
        for (const sl of supportLines) {
          if (sl.price) {
            candleSeries.createPriceLine({
              price: sl.price,
              color: sl.color,
              lineWidth: 1,
              lineStyle: 2,
              axisLabelVisible: true,
              title: sl.label,
            });
          }
        }
      }

      // MAs as line series
      if (levels?.ma20 != null) {
        const ma20Series = chart.addSeries(LineSeries, {
          color: '#3b82f6',
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        const ma20Data = bars.map((b) => ({ time: b.time, value: levels.ma20 }));
        ma20Series.setData(ma20Data);
      }

      if (levels?.ma50 != null) {
        const ma50Series = chart.addSeries(LineSeries, {
          color: '#f59e0b',
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        const ma50Data = bars.map((b) => ({ time: b.time, value: levels.ma50 }));
        ma50Series.setData(ma50Data);
      }

      chart.timeScale().fitContent();
    }

    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [bars, levels]);

  return <div ref={containerRef} className="sr-chart-container" />;
}

export default function SupportResistancePage() {
  const [symbol, setSymbol] = useState('SPY');
  const [timeframe, setTimeframe] = useState('H1');
  const [symbols, setSymbols] = useState(DEFAULT_SYMBOLS);

  // Fetch watchlist symbols for the selector
  useEffect(() => {
    apiGet('/api/watchlists').then((data) => {
      const lists = Array.isArray(data?.watchlists) ? data.watchlists : [];
      const defaultList = lists.find((l) => l.isDefault) || lists[0];
      const wlSymbols = Array.isArray(defaultList?.symbols)
        ? defaultList.symbols.map((s) => (typeof s === 'string' ? s : s.ticker).toUpperCase())
        : [];
      if (wlSymbols.length > 0) setSymbols(wlSymbols);
    }).catch(() => {});
  }, []);

  const { data: levels, isLoading, isError } = useQuery({
    queryKey: ['indicators', symbol, timeframe, 'support-resistance'],
    queryFn: () => apiGet(`/api/indicators/${symbol}/support-resistance?tf=${timeframe}`),
    refetchInterval: 60_000,
  });

  const activeTF = TIMEFRAMES.find((t) => t.id === timeframe);

  const levelLines = levels?.pivot ? [
    { price: levels.r3, label: 'R3', cls: 'sr-resist' },
    { price: levels.r2, label: 'R2', cls: 'sr-resist' },
    { price: levels.r1, label: 'R1', cls: 'sr-resist' },
    { price: levels.pivot, label: 'Pivot', cls: 'sr-pivot' },
    { price: levels.s1, label: 'S1', cls: 'sr-support' },
    { price: levels.s2, label: 'S2', cls: 'sr-support' },
    { price: levels.s3, label: 'S3', cls: 'sr-support' },
  ] : [];

  return (
    <div className="sr-page">
      <header className="sr-header">
        <h1>Support & Resistance
          <PageInfoPopover>
            Pivot points, round number levels, and moving average support/resistance across timeframes.
          </PageInfoPopover>
        </h1>
      </header>

      {/* Symbol selector */}
      <div className="sr-controls">
        <div className="sr-field">
          <label>Symbol</label>
          <select value={symbol} onChange={(e) => setSymbol(e.target.value)}>
            {symbols.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div className="sr-field">
          <label>Timeframe</label>
          <div className="sr-tf-tabs">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf.id}
                type="button"
                className={`sr-tf-tab ${timeframe === tf.id ? 'sr-tf-active' : ''}`}
                onClick={() => setTimeframe(tf.id)}
                title={tf.desc}
              >
                {tf.id}
              </button>
            ))}
          </div>
        </div>
      </div>

      {isLoading && <LoadingSkeleton variant="card" count={2} />}

      {isError && (
        <div className="sr-section">
          <p className="error">Could not load support & resistance data. Is the NestJS API running?</p>
        </div>
      )}

      {!isLoading && !isError && !levels?.pivot && (
        <div className="sr-section">
          <p className="sr-subtitle">No OHLCV data available for {symbol} on {timeframe} timeframe. Try another symbol or timeframe, or import market data first.</p>
        </div>
      )}

      {!isLoading && !isError && levels?.pivot && (
      <>
      {/* Candle chart with S/R lines */}
      <section className="sr-section">
        <h2>
          {symbol} — {activeTF?.label} {levels.currentPrice != null && <span className="sr-price-chip">{levels.currentPrice}</span>}
          <span className="sr-badge">{activeTF?.desc}</span>
        </h2>
        <SrChart levels={levels} bars={levels.bars} />
      </section>

      {/* Level detail cards */}
      <section className="sr-section">
        <h2>Levels</h2>
        <div className="sr-levels-grid">
          {levelLines.map((ll) => (
            <div key={ll.label} className={`sr-level-card ${ll.cls}`}>
              <span className="sr-level-label">{ll.label}</span>
              <span className="sr-level-price">{ll.price}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Round number levels + MAs */}
      <section className="sr-section">
        <h2>Additional Levels</h2>
        <div className="sr-extras">
          <div className="sr-extra-block">
            <h3>Round Numbers</h3>
            <div className="sr-round-list">
              {levels.roundLevels?.length > 0 ? levels.roundLevels.map((r) => (
                <span key={r} className="sr-round-chip">{r}</span>
              )) : <span className="sr-round-chip">No round levels available</span>}
            </div>
          </div>
          <div className="sr-extra-block">
            <h3>Moving Averages</h3>
            <div className="sr-ma-list">
              <div className="sr-ma-item">
                <span className="sr-ma-label">MA 20</span>
                <span className="sr-ma-val">{levels.ma20 != null ? levels.ma20 : '—'}</span>
              </div>
              <div className="sr-ma-item">
                <span className="sr-ma-label">MA 50</span>
                <span className="sr-ma-val">{levels.ma50 != null ? levels.ma50 : '—'}</span>
              </div>
            </div>
          </div>
        </div>
      </section>
      </>
      )}
    </div>
  );
}
