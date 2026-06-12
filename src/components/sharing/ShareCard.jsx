export default function ShareCard({ strategyName = 'Strategy', symbol = 'AAPL', score = 72, signal = 'buy', date }) {
  const displayDate = date || new Date().toLocaleDateString();
  const shareUrl = `/api/export/strategy/${symbol}/share`;

  return (
    <div className="share-card">
      <div className="share-card-symbol">{symbol}</div>
      <div className="share-card-score">{score}</div>
      <div className={`share-card-signal share-sig-${(signal || 'hold').toLowerCase()}`}>
        {signal?.toUpperCase() || 'HOLD'}
      </div>
      <div className="share-card-meta">{strategyName} · {displayDate}</div>
      <a href={shareUrl} target="_blank" rel="noopener noreferrer" className="share-card-link">
        Open Share Card ↗
      </a>
    </div>
  );
}
