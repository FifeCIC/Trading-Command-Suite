import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import './news-intel.css';

const FALLBACK_NEWS = [
  { id: 1, title: 'Fed Holds Rates Steady, Signals Possible Cut in September', source: 'Reuters', time: '2h ago', sentiment: 'positive', symbols: ['SPY', 'QQQ', 'IWM'], impact: 'high', snippet: 'The Federal Reserve maintained its benchmark rate at 5.25-5.50% for the sixth consecutive meeting, but revised its dot plot to signal two rate cuts before year-end.' },
  { id: 2, title: 'NVIDIA Surpasses $3T Market Cap on AI Chip Demand', source: 'Bloomberg', time: '4h ago', sentiment: 'positive', symbols: ['NVDA', 'AMD', 'SMH'], impact: 'high', snippet: 'NVIDIA reached a $3 trillion market cap, driven by insatiable demand for its H200 and upcoming Blackwell AI accelerators.' },
  { id: 3, title: 'Apple Unveils iPhone 18 with On-Device AI Capabilities', source: 'CNBC', time: '6h ago', sentiment: 'positive', symbols: ['AAPL', 'QCOM'], impact: 'medium', snippet: 'Apple announced the iPhone 18 featuring a dedicated neural engine capable of running large language models entirely on-device.' },
  { id: 4, title: 'Oil Prices Slide Below $70 on OPEC+ Output Increase', source: 'MarketWatch', time: '8h ago', sentiment: 'negative', symbols: ['USO', 'XLE', 'CVX'], impact: 'high', snippet: 'Crude oil fell below $70/barrel after OPEC+ announced a surprise 500,000 bpd production increase starting next month.' },
  { id: 5, title: 'Tesla Q2 Deliveries Beat Estimates by 12%', source: 'Yahoo Finance', time: '10h ago', sentiment: 'positive', symbols: ['TSLA', 'RIVN'], impact: 'high', snippet: 'Tesla reported Q2 vehicle deliveries of 485,000 units, surpassing analyst expectations of 432,000, driven by strong Model Y demand.' },
  { id: 6, title: 'UK Inflation Falls to 2.1%, Lowest Since 2021', source: 'Financial Times', time: '12h ago', sentiment: 'positive', symbols: ['EWU', 'FXB'], impact: 'medium', snippet: 'UK CPI dropped to 2.1% year-over-year, approaching the Bank of England\'s 2% target and raising expectations of a summer rate cut.' },
  { id: 7, title: 'Microsoft-Activision Deal Gets Final EU Approval', source: 'WSJ', time: '14h ago', sentiment: 'positive', symbols: ['MSFT', 'ATVI'], impact: 'medium', snippet: 'The European Commission granted unconditional approval for Microsoft\'s acquisition of Activision Blizzard.' },
  { id: 8, title: 'JPMorgan Warns of Commercial Real Estate Stress', source: 'Bloomberg', time: '16h ago', sentiment: 'negative', symbols: ['JPM', 'XLF', 'VNQ'], impact: 'medium', snippet: 'JPMorgan Chase increased its loan loss reserves by $1.2B, citing growing stress in commercial real estate.' },
  { id: 9, title: 'Bitcoin Surges Past $75K After ETF Inflow Record', source: 'CoinDesk', time: '18h ago', sentiment: 'positive', symbols: ['BTC', 'MSTR', 'COIN'], impact: 'high', snippet: 'Bitcoin crossed $75,000 after spot Bitcoin ETFs recorded their largest single-day inflow of $1.8 billion.' },
  { id: 10, title: 'AMD Launches MI400 to Challenge NVIDIA in AI Training', source: 'The Verge', time: '20h ago', sentiment: 'positive', symbols: ['AMD', 'NVDA'], impact: 'high', snippet: 'AMD unveiled its MI400 series AI accelerators, claiming 2x performance over the MI300.' },
  { id: 11, title: 'European Central Bank Cuts Rates by 25bps', source: 'Reuters', time: '22h ago', sentiment: 'positive', symbols: ['EZU', 'FXE'], impact: 'high', snippet: 'The ECB reduced its key rate from 4.50% to 4.25%, citing progress on inflation.' },
  { id: 12, title: 'Gold Hits All-Time High Above $2,500/oz', source: 'Kitco', time: '1d ago', sentiment: 'neutral', symbols: ['GLD', 'GDX', 'NEM'], impact: 'medium', snippet: 'Gold futures surpassed $2,500 per ounce for the first time, driven by central bank buying.' },
];

const SOURCES = ['all', 'Reuters', 'Bloomberg', 'CNBC', 'MarketWatch', 'Yahoo Finance', 'WSJ', 'Financial Times', 'CoinDesk', 'The Verge', 'Kitco'];

export default function NewsIntelPage() {
  const [symbolFilter, setSymbolFilter] = useState('all');
  const [sentimentFilter, setSentimentFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [expandedId, setExpandedId] = useState(null);

  const { data: feedData, isLoading, isError } = useQuery({
    queryKey: ['news', 'feed', symbolFilter !== 'all' ? symbolFilter : ''],
    queryFn: () => {
      const params = new URLSearchParams();
      if (symbolFilter !== 'all') params.set('symbol', symbolFilter);
      return apiGet(`/api/news/feed?${params.toString()}`);
    },
    refetchInterval: 120_000,
  });

  const articles = feedData?.articles?.length > 0 ? feedData.articles : (isError ? FALLBACK_NEWS : []);
  const isLive = feedData?.live === true;
  const SOURCES = useMemo(() => {
    const s = new Set(articles.map((a) => a.source));
    return ['all', ...Array.from(s)];
  }, [articles]);

  const allSymbols = useMemo(() => ['all', ...new Set(articles.flatMap((a) => a.symbols || []))].sort(), [articles]);

  const filtered = articles.filter((n) => {
    if (symbolFilter !== 'all' && !(n.symbols || []).includes(symbolFilter)) return false;
    if (sentimentFilter !== 'all' && n.sentiment !== sentimentFilter) return false;
    if (sourceFilter !== 'all' && n.source !== sourceFilter) return false;
    return true;
  });

  return (
    <div className="ni-page">
      <header className="ni-header">
        <h1>News Intel</h1>
        <p className="ni-subtitle">
          Financial news feed with sentiment analysis and symbol tracking.
          {isLive ? ' Live from Finnhub.' : isError ? ' API offline — using reference data.' : ' Connecting...'}
        </p>
      </header>

      {isLoading && <LoadingSkeleton variant="card" count={3} />}

      {!isLoading && (
      <>
      <div className="ni-filters">
        <div className="ni-field">
          <label>Symbol</label>
          <select value={symbolFilter} onChange={(e) => setSymbolFilter(e.target.value)}>
            {allSymbols.map((s) => <option key={s} value={s}>{s === 'all' ? 'All Symbols' : s}</option>)}
          </select>
        </div>
        <div className="ni-field">
          <label>Sentiment</label>
          <div className="ni-chip-tabs">
            {['all', 'positive', 'negative', 'neutral'].map((s) => (
              <button key={s} type="button" className={`ni-chip ${sentimentFilter === s ? 'ni-chip-active' : ''}`} onClick={() => setSentimentFilter(s)}>
                {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <div className="ni-field">
          <label>Source</label>
          <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
            {SOURCES.map((s) => <option key={s} value={s}>{s === 'all' ? 'All Sources' : s}</option>)}
          </select>
        </div>
      </div>

      <div className="ni-summary">
        <span className="ni-summary-label">Feed Sentiment:</span>
        <span className="ni-summary-val ni-sent-pos">▲ {filtered.filter((n) => n.sentiment === 'positive').length} Positive</span>
        <span className="ni-summary-val ni-sent-neg">▼ {filtered.filter((n) => n.sentiment === 'negative').length} Negative</span>
        <span className="ni-summary-val ni-sent-neu">● {filtered.filter((n) => n.sentiment === 'neutral').length} Neutral</span>
        <span className="ni-summary-total">{filtered.length} articles</span>
      </div>

      <div className="ni-feed">
        {filtered.map((article) => {
          const isExpanded = expandedId === article.id;
          const sentCls = `ni-sent-${article.sentiment}`;
          const impactCls = `ni-impact-${article.impact}`;
          return (
            <article key={article.id} className={`ni-article ${isExpanded ? 'ni-expanded' : ''}`} onClick={() => setExpandedId(isExpanded ? null : article.id)}>
              <div className="ni-article-header">
                <div className="ni-article-meta">
                  <span className={`ni-sentiment-dot ${sentCls}`} />
                  <span className="ni-source">{article.source}</span>
                  <span className="ni-time">{article.time}</span>
                  <span className={`ni-impact-badge ${impactCls}`}>{article.impact}</span>
                </div>
                <div className="ni-symbol-tags">
                  {article.symbols.map((sym) => (
                    <span key={sym} className={`ni-sym-tag ${symbolFilter === sym ? 'ni-sym-active' : ''}`}>{sym}</span>
                  ))}
                </div>
              </div>
              <h3 className="ni-headline">{article.title}</h3>
              {isExpanded && (
                <div className="ni-expanded-body" onClick={(e) => e.stopPropagation()}>
                  <p className="ni-snippet">{article.snippet}</p>
                  <div className="ni-expanded-meta">
                    <span>Sentiment: <strong className={sentCls}>{article.sentiment.toUpperCase()}</strong></span>
                    <span>Impact: <strong className={impactCls}>{article.impact.toUpperCase()}</strong></span>
                    <span>Mentioned: {article.symbols.join(', ')}</span>
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>
      </>
      )}
    </div>
  );
}
