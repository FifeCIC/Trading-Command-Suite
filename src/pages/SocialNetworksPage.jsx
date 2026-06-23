import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import './social-networks.css';

function generateSentimentData() {
  const symbols = ['NVDA', 'TSLA', 'AAPL', 'MSFT', 'AMD', 'BTCUSD', 'MSTR', 'PLTR', 'GME', 'AMC'];
  return symbols.map((s) => ({
    symbol: s,
    sentiment: Math.round((Math.random() - 0.3) * 100),
    mentions: Math.floor(Math.random() * 5000 + 200),
    change: Math.round((Math.random() - 0.5) * 40),
    source: ['Reddit', 'Twitter', 'StockTwits'][Math.floor(Math.random() * 3)],
  }));
}

export default function SocialNetworksPage() {
  const [filter, setFilter] = useState('all');
  const data = useMemo(() => generateSentimentData(), []);
  const filtered = filter === 'all' ? data : data.filter((d) => (filter === 'bullish' ? d.sentiment > 0 : d.sentiment < 0));

  return (
    <div className="sn-page">
      <header className="sn-header">
        <h1>Social Networks</h1>
        <p className="sn-subtitle">Social sentiment aggregation. Phase 1: Finnhub news sentiment proxy. Phase 2: Reddit/Twitter APIs.</p>
      </header>
      <div className="sn-filters">
        <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>All</button>
        <button className={filter === 'bullish' ? 'active' : ''} onClick={() => setFilter('bullish')}>Bullish</button>
        <button className={filter === 'bearish' ? 'active' : ''} onClick={() => setFilter('bearish')}>Bearish</button>
      </div>
      <div className="sn-grid">
        <AnimatePresence mode="popLayout">
          {filtered.map((d, i) => (
            <motion.div key={d.symbol} layout initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
              transition={{ delay: i * 0.03 }} className={`sn-card ${d.sentiment > 0 ? 'bullish' : 'bearish'}`}>
              <div className="sn-card-header">
                <strong>{d.symbol}</strong>
                <span className="sn-source">{d.source}</span>
              </div>
              <div className="sn-score-wrap">
                <motion.span className="sn-score" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', delay: 0.2 }}
                  style={{ color: d.sentiment > 0 ? '#22c55e' : '#ef4444' }}>{d.sentiment > 0 ? '+' : ''}{d.sentiment}</motion.span>
              </div>
              <div className="sn-card-footer">
                <span>{d.mentions.toLocaleString()} mentions</span>
                <span className={d.change >= 0 ? 'up' : 'down'}>{d.change >= 0 ? '↑' : '↓'} {Math.abs(d.change)}%</span>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
