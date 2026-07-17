/**
 * TopMoversPage — Biggest gainers & losers across all tracked symbols.
 *
 * Route: /lab/top-movers
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import './top-movers.css';

const LOOKBACK_OPTIONS = [
  { value: '1m', label: '1 min' },
  { value: '5m', label: '5 min' },
  { value: '15m', label: '15 min' },
  { value: '1h', label: '1 hour' },
  { value: '1d', label: '1 day' },
];

export default function TopMoversPage() {
  const [lookback, setLookback] = useState('15m');
  const [limit] = useState(20);

  const moversQuery = useQuery({
    queryKey: ['top-movers', lookback, limit],
    queryFn: () => apiGet(`/api/market-data/top-movers?lookback=${lookback}&limit=${limit}`).catch(() => null),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const data = moversQuery.data || {};
  const gainers = data.gainers || [];
  const losers = data.losers || [];
  const matchedSymbols = data.matchedSymbols || 0;
  const totalSymbols = data.totalSymbols || 0;

  return (
    <div className="tm-page">
      <header className="tm-header">
        <h1>🚀 Top Movers</h1>
        <p className="tm-subtitle">
          {matchedSymbols} of {totalSymbols} active symbols with price data · Auto-refresh 30s
        </p>
      </header>

      {/* ── Lookback Selector ── */}
      <div className="tm-controls">
        <span className="tm-control-label">Lookback:</span>
        <div className="tm-lookback-bar">
          {LOOKBACK_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={`tm-lookback-btn ${lookback === opt.value ? 'active' : ''}`}
              onClick={() => setLookback(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Gainers / Losers Grid ── */}
      <div className="tm-grid">
        {/* Gainers */}
        <section className="tm-section tm-gainers">
          <h2>📈 Biggest Gainers</h2>
          {moversQuery.isLoading ? (
            <p className="tm-loading">Loading...</p>
          ) : gainers.length === 0 ? (
            <p className="tm-empty">No gainers found for this lookback period.</p>
          ) : (
            <div className="tm-table-wrap">
              <table className="tm-table">
                <thead>
                  <tr>
                    <th>Ticker</th>
                    <th>Name</th>
                    <th>Change</th>
                    <th>Price</th>
                    <th>Prev</th>
                  </tr>
                </thead>
                <tbody>
                  {gainers.map((m) => (
                    <tr key={m.symbolId}>
                      <td>
                        <a href={`/research/symbol/${m.ticker}`} className="tm-ticker-link">
                          {m.ticker}
                        </a>
                        {m.volumeSpike && <span className="tm-badge tm-badge-volume">⚡ Vol</span>}
                      </td>
                      <td className="tm-name-cell">{m.name !== m.ticker ? m.name : '—'}</td>
                      <td>
                        <span className="tm-change tm-change-up">+{m.changePct}%</span>
                      </td>
                      <td className="tm-price">{m.latestPrice}</td>
                      <td className="tm-price-prev">{m.previousPrice}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Losers */}
        <section className="tm-section tm-losers">
          <h2>📉 Biggest Losers</h2>
          {moversQuery.isLoading ? (
            <p className="tm-loading">Loading...</p>
          ) : losers.length === 0 ? (
            <p className="tm-empty">No losers found for this lookback period.</p>
          ) : (
            <div className="tm-table-wrap">
              <table className="tm-table">
                <thead>
                  <tr>
                    <th>Ticker</th>
                    <th>Name</th>
                    <th>Change</th>
                    <th>Price</th>
                    <th>Prev</th>
                  </tr>
                </thead>
                <tbody>
                  {losers.map((m) => (
                    <tr key={m.symbolId}>
                      <td>
                        <a href={`/research/symbol/${m.ticker}`} className="tm-ticker-link">
                          {m.ticker}
                        </a>
                        {m.volumeSpike && <span className="tm-badge tm-badge-volume">⚡ Vol</span>}
                      </td>
                      <td className="tm-name-cell">{m.name !== m.ticker ? m.name : '—'}</td>
                      <td>
                        <span className="tm-change tm-change-down">{m.changePct}%</span>
                      </td>
                      <td className="tm-price">{m.latestPrice}</td>
                      <td className="tm-price-prev">{m.previousPrice}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
