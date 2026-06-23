import { useEffect, useRef, useState, useCallback } from 'react';
import { createChart, CandlestickSeries } from 'lightweight-charts';
import './CandlePatternChart.css';

const PATTERN_COLORS = {
  bullish: 'rgba(34, 197, 94, 0.85)',
  bearish: 'rgba(239, 68, 68, 0.85)',
  neutral: 'rgba(148, 163, 184, 0.85)',
};

const PATTERN_ICONS = {
  'doji-pattern': '⚊',
  'engulfing-pattern': '⇕',
  'hammer-pattern': '🔨',
  'three-soldiers-pattern': '☰',
  'mt5-engulfing': '⇕',
  'mt5-harami': '⊂',
  'mt5-star-doji': '★',
  'mt5-hammer': '🔨',
  default: '◆',
};

export default function CandlePatternChart({ bars, patterns, onPatternClick, highlightPatterns = true }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const candleSeriesRef = useRef(null);
  const markerSeriesRef = useRef(null);
  const [hoveredPattern, setHoveredPattern] = useState(null);

  // Build pattern lookup by candle index
  const patternByIndex = {};
  if (patterns) {
    patterns.forEach(p => {
      patternByIndex[p.candleIndex] = p;
    });
  }

  const handlePatternClick = useCallback((pattern) => {
    if (onPatternClick) onPatternClick(pattern);
  }, [onPatternClick]);

  useEffect(() => {
    if (!containerRef.current || !bars || bars.length === 0) return;

    // Clean up previous chart
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 500,
      layout: {
        background: { color: '#0f172a' },
        textColor: '#94a3b8',
      },
      grid: {
        vertLines: { color: 'rgba(51, 65, 85, 0.3)' },
        horzLines: { color: 'rgba(51, 65, 85, 0.3)' },
      },
      crosshair: {
        mode: 0,
      },
      timeScale: {
        borderColor: 'rgba(51, 65, 85, 0.5)',
        timeVisible: true,
      },
      rightPriceScale: {
        borderColor: 'rgba(51, 65, 85, 0.5)',
      },
    });

    // Candlestick series
    const candleData = bars.map(bar => ({
      time: Math.floor(bar.timestamp / 1000),
      open: Number(bar.open),
      high: Number(bar.high),
      low: Number(bar.low),
      close: Number(bar.close),
    }));

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    });
    candleSeries.setData(candleData);
    candleSeriesRef.current = candleSeries;

    // Pattern markers
    if (patterns && patterns.length > 0) {
      const markers = patterns.map(p => {
        const bar = bars[p.candleIndex];
        if (!bar) return null;
        const color = PATTERN_COLORS[p.direction] || PATTERN_COLORS.neutral;
        const icon = PATTERN_ICONS[p.patternId] || PATTERN_ICONS.default;
        return {
          time: Math.floor(bar.timestamp / 1000),
          position: p.direction === 'bearish' ? 'aboveBar' : 'belowBar',
          color,
          shape: 'circle',
          text: icon + ' ' + p.patternName.substring(0, 4),
          size: 2,
          id: p.patternId + '-' + p.candleIndex,
        };
      }).filter(Boolean);

      if (markers.length > 0) {
        // lightweight-charts v4: markers go directly on the candlestick series
        candleSeriesRef.current.setMarkers(markers);
      }
    }

    // Handle marker clicks via chart subscription
    chart.subscribeClick((param) => {
      if (param.hoveredObjectId) {
        const parts = param.hoveredObjectId.split('-');
        const candleIdx = parseInt(parts[parts.length - 1], 10);
        const pat = patternByIndex[candleIdx];
        if (pat) handlePatternClick(pat);
      }
    });

    chartRef.current = chart;

    // Resize handler
    const handleResize = () => {
      if (chartRef.current && containerRef.current) {
        chartRef.current.applyOptions({
          width: containerRef.current.clientWidth,
        });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, [bars, patterns]);

  // Highlighted candle indices
  const highlightedIndices = new Set(
    highlightPatterns && patterns ? patterns.map(p => p.candleIndex) : []
  );

  return (
    <div className="candle-pattern-chart">
      <div ref={containerRef} className="chart-container" />
      {patterns && patterns.length > 0 && (
        <div className="pattern-legend">
          <span className="legend-title">Patterns detected: {patterns.length}</span>
          <div className="legend-items">
            {[...new Set(patterns.map(p => p.patternId))].slice(0, 6).map(id => {
              const p = patterns.find(pp => pp.patternId === id);
              return (
                <span key={id} className="legend-item" style={{ color: p ? PATTERN_COLORS[p.direction] : '#94a3b8' }}>
                  {PATTERN_ICONS[id] || PATTERN_ICONS.default} {p?.patternName || id}
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
