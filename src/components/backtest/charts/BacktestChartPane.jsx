import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../../core/api/client';
import BacktestChart from './BacktestChart';

const SYMBOLS = ['NVDA', 'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'EURUSD', 'BTCUSD', 'ETHUSD'];
const TIMEFRAMES = ['1d', '1h', '15m'];

/**
 * BacktestChartPane — wrapper with controls that fetches chart data
 * and renders the BacktestChart.
 */
export default function BacktestChartPane({ initialSymbol = 'NVDA', initialTimeframe = '1d' }) {
  const [symbol, setSymbol] = useState(initialSymbol);
  const [timeframe, setTimeframe] = useState(initialTimeframe);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const chartQuery = useQuery({
    queryKey: ['backtest-chart', symbol, timeframe],
    queryFn: () => apiGet(`/api/backtest/chart-data?symbol=${symbol}&timeframe=${timeframe}`),
    enabled: Boolean(symbol),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const toggleFullscreen = () => {
    setIsFullscreen((prev) => !prev);
  };

  // Keyboard shortcut: Escape to exit fullscreen
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && isFullscreen) setIsFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isFullscreen]);

  return (
    <div className={`bt-chart-pane ${isFullscreen ? 'bt-chart-fullscreen' : ''}`}>
      {/* Controls bar */}
      <div className="bt-chart-controls">
        <div className="bt-chart-controls-left">
          <label className="bt-ctrl-label">
            Symbol
            <select value={symbol} onChange={(e) => setSymbol(e.target.value)}>
              {SYMBOLS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>

          <div className="bt-timeframe-btns">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                className={`bt-tf-btn ${timeframe === tf ? 'bt-tf-active' : ''}`}
                onClick={() => setTimeframe(tf)}
              >
                {tf.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <div className="bt-chart-controls-right">
          <button className="bt-fs-btn" onClick={toggleFullscreen} title="Toggle fullscreen">
            {isFullscreen ? '⊠ Exit Fullscreen' : '⊞ Fullscreen'}
          </button>
        </div>
      </div>

      {/* Main chart */}
      <BacktestChart
        data={chartQuery.data}
        symbol={symbol}
        loading={chartQuery.isLoading}
      />
    </div>
  );
}
