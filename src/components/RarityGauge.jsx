/**
 * RarityGauge — percentile-based opportunity classification.
 *
 * Shows WHERE a composite score falls in historical context:
 * - Percentile bar with band color
 * - Rarity band label + emoji
 * - Description of what this band means
 * - Position sizing hint (sizeMultiplier)
 * - Sample size (transparency: how many historical scores inform this)
 */
import { useState } from 'react';
import './rarity-gauge.css';

const BAND_COLORS = {
  'standard':    { bg: '#22c55e20', bar: '#22c55e', text: '#22c55e' },
  'strong':      { bg: '#3b82f620', bar: '#3b82f6', text: '#3b82f6' },
  'exceptional': { bg: '#8b5cf620', bar: '#8b5cf6', text: '#8b5cf6' },
  'cyclical':    { bg: '#f59e0b20', bar: '#f59e0b', text: '#f59e0b' },
  'black-swan':  { bg: '#ef444420', bar: '#ef4444', text: '#ef4444' },
};

export default function RarityGauge({ rarity, compact = false }) {
  const [expanded, setExpanded] = useState(false);

  if (!rarity || rarity.sampleSize < 30) {
    return (
      <div className="rg-placeholder" title="Need 30+ historical scores for rarity. Scoring more symbols will build this.">
        <span className="rg-placeholder-icon">⏳</span>
        <span className="rg-placeholder-text">
          {rarity ? `${rarity.sampleSize}/30 samples` : 'No data'}
        </span>
      </div>
    );
  }

  const { percentile, band, label, color, emoji, description, sizeMultiplier, sampleSize } = rarity;
  const bandColors = BAND_COLORS[band] ?? BAND_COLORS.standard;

  if (compact) {
    return (
      <div className="rg-compact" style={{ '--rg-bar': bandColors.bar }} title={`${percentile}th percentile · ${sampleSize} samples · ${description}`}>
        <span className="rg-compact-emoji">{emoji}</span>
        <span className="rg-compact-label">{label}</span>
        <span className="rg-compact-pct">{percentile}%</span>
      </div>
    );
  }

  return (
    <div className="rg-card" style={{ borderColor: bandColors.bar, background: bandColors.bg }}>
      {/* Header */}
      <div className="rg-header">
        <span className="rg-emoji">{emoji}</span>
        <span className="rg-label" style={{ color: bandColors.text }}>{label}</span>
        <span className="rg-percentile">{percentile}<small>th</small></span>
      </div>

      {/* Percentile bar */}
      <div className="rg-bar-track">
        <div className="rg-bar-fill" style={{ width: `${percentile}%`, background: bandColors.bar }} />
        <div className="rg-bar-marker" style={{ left: `${percentile}%` }} title="Current score" />
        {/* Threshold markers */}
        <div className="rg-threshold" style={{ left: '70%' }} title="Strong threshold (70th)"><span>70</span></div>
        <div className="rg-threshold" style={{ left: '85%' }} title="Exceptional threshold (85th)"><span>85</span></div>
        <div className="rg-threshold" style={{ left: '95%' }} title="Cyclical threshold (95th)"><span>95</span></div>
      </div>

      {/* Description */}
      <p className="rg-desc">{description}</p>

      {/* Footer: size + samples */}
      <div className="rg-footer">
        <span className="rg-size" style={{ color: bandColors.text }}>
          Size: <strong>{sizeMultiplier}×</strong> base
        </span>
        <button className="rg-info-btn" onClick={() => setExpanded(!expanded)}>
          {expanded ? '▾ How?' : '▸ How?'}
        </button>
      </div>

      {/* Expandable: how it works */}
      {expanded && (
        <div className="rg-explainer">
          <p>This score is higher than <strong>{percentile}%</strong> of all scores for this protocol over the past year ({sampleSize.toLocaleString()} samples).</p>
          <div className="rg-bands-table">
            <div className="rg-band-row"><span className="rg-band-dot" style={{ background: '#22c55e' }} /> Standard: <strong>0–69%</strong> — base size</div>
            <div className="rg-band-row"><span className="rg-band-dot" style={{ background: '#3b82f6' }} /> Strong: <strong>70–84%</strong> — 1.5× size</div>
            <div className="rg-band-row"><span className="rg-band-dot" style={{ background: '#8b5cf6' }} /> Exceptional: <strong>85–94%</strong> — 2× size</div>
            <div className="rg-band-row"><span className="rg-band-dot" style={{ background: '#f59e0b' }} /> Cyclical: <strong>95–98%</strong> — 2.5× size</div>
            <div className="rg-band-row"><span className="rg-band-dot" style={{ background: '#ef4444' }} /> Black Swan: <strong>99%+</strong> — verify data</div>
          </div>
        </div>
      )}
    </div>
  );
}
