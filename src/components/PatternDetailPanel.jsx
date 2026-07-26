import './pattern-detail-panel.css';

const DIRECTION_EMOJI = { bullish: '🟢', bearish: '🔴', neutral: '⚪' };
const DIRECTION_LABEL = { bullish: 'Bullish', bearish: 'Bearish', neutral: 'Neutral' };

export default function PatternDetailPanel({ pattern, onClose }) {
  if (!pattern) return null;

  return (
    <div className="pattern-detail-panel">
      <div className="panel-header">
        <h3>{DIRECTION_EMOJI[pattern.direction]} {pattern.patternName}</h3>
        <button className="close-btn" onClick={onClose}>×</button>
      </div>

      <div className="panel-body">
        <div className="detail-row">
          <span className="label">Direction</span>
          <span className={`value direction-${pattern.direction}`}>
            {DIRECTION_LABEL[pattern.direction]}
          </span>
        </div>

        <div className="detail-row">
          <span className="label">Score</span>
          <span className="value">{pattern.score}/100</span>
        </div>

        <div className="detail-row">
          <span className="label">Confidence</span>
          <div className="confidence-bar">
            <div
              className="confidence-fill"
              style={{ width: `${(pattern.confidence * 100).toFixed(0)}%` }}
            />
            <span>{(pattern.confidence * 100).toFixed(0)}%</span>
          </div>
        </div>

        <div className="detail-row">
          <span className="label">Candle Index</span>
          <span className="value">#{pattern.candleIndex} of {pattern.candleCount} candle{pattern.candleCount > 1 ? 's' : ''}</span>
        </div>

        <div className="detail-row">
          <span className="label">Time</span>
          <span className="value">{new Date(pattern.timestamp).toLocaleString()}</span>
        </div>

        <div className="description-section">
          <h4>About This Pattern</h4>
          <p>{pattern.description}</p>
        </div>

        <div className="accuracy-section">
          <h4>Historical Accuracy</h4>
          <p className="accuracy-note">📊 Accuracy tracking coming with Q215. Check back soon for real stats.</p>
        </div>
      </div>
    </div>
  );
}
