import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import './macro-monitor.css';

const FALLBACK_INDICATORS = [
  {
    id: 'fed-rate', name: 'Fed Funds Rate', category: 'Interest Rates', unit: '%',
    current: 5.50, previous: 5.25, impact: 'high',
    source: 'Federal Reserve', nextRelease: '2026-06-18',
    trend: [5.25, 5.50, 5.50, 5.50, 5.50, 5.50, 5.50, 5.50, 5.50, 5.50, 5.50, 5.50],
  },
  {
    id: 'us-cpi', name: 'US CPI (YoY)', category: 'Inflation', unit: '%',
    current: 3.2, previous: 3.4, impact: 'high',
    source: 'BLS', nextRelease: '2026-07-12',
    trend: [6.5, 6.0, 5.0, 4.9, 4.0, 3.7, 3.2, 3.5, 3.4, 3.8, 3.4, 3.2],
  },
  {
    id: 'us-gdp', name: 'US GDP Growth', category: 'GDP', unit: '%',
    current: 3.1, previous: 2.8, impact: 'high',
    source: 'BEA', nextRelease: '2026-07-25',
    trend: [3.2, 2.6, 2.1, 2.9, 3.2, 2.7, 2.4, 3.0, 3.3, 2.8, 2.8, 3.1],
  },
  {
    id: 'nfp', name: 'Non-Farm Payrolls', category: 'Employment', unit: 'K',
    current: 272, previous: 165, impact: 'high',
    source: 'BLS', nextRelease: '2026-07-05',
    trend: [315, 236, 175, 310, 180, 228, 256, 190, 290, 210, 165, 272],
  },
  {
    id: 'unemp', name: 'Unemployment Rate', category: 'Employment', unit: '%',
    current: 3.8, previous: 3.9, impact: 'high',
    source: 'BLS', nextRelease: '2026-07-05',
    trend: [3.5, 3.6, 3.7, 3.8, 3.9, 3.9, 3.7, 3.8, 3.9, 3.9, 3.9, 3.8],
  },
  {
    id: 'us-pmi-mfg', name: 'ISM Manufacturing PMI', category: 'PMI', unit: '',
    current: 50.3, previous: 49.1, impact: 'medium',
    source: 'ISM', nextRelease: '2026-07-01',
    trend: [48.4, 47.8, 49.2, 46.9, 50.1, 47.6, 48.8, 49.5, 48.2, 50.3, 49.1, 50.3],
  },
  {
    id: 'us-pmi-svc', name: 'ISM Services PMI', category: 'PMI', unit: '',
    current: 53.8, previous: 52.1, impact: 'medium',
    source: 'ISM', nextRelease: '2026-07-03',
    trend: [54.5, 53.0, 52.5, 51.8, 53.2, 54.0, 52.8, 53.9, 55.1, 52.4, 52.1, 53.8],
  },
  {
    id: 'ecb-rate', name: 'ECB Refinancing Rate', category: 'Interest Rates', unit: '%',
    current: 4.25, previous: 4.50, impact: 'high',
    source: 'ECB', nextRelease: '2026-07-18',
    trend: [3.75, 4.00, 4.25, 4.50, 4.50, 4.50, 4.75, 4.50, 4.50, 4.50, 4.50, 4.25],
  },
  {
    id: 'pce', name: 'Core PCE (YoY)', category: 'Inflation', unit: '%',
    current: 2.8, previous: 2.9, impact: 'high',
    source: 'BEA', nextRelease: '2026-06-28',
    trend: [4.2, 3.9, 3.7, 3.4, 3.2, 3.1, 2.9, 3.0, 2.8, 3.0, 2.9, 2.8],
  },
  {
    id: 'retail', name: 'Retail Sales (MoM)', category: 'GDP', unit: '%',
    current: 0.6, previous: -0.2, impact: 'medium',
    source: 'Census Bureau', nextRelease: '2026-07-16',
    trend: [0.7, -0.3, 0.4, 0.5, -0.1, 0.8, -0.5, 0.3, 0.9, -0.4, -0.2, 0.6],
  },
];

function daysUntil(dateStr) {
  const now = new Date('2026-06-17');
  const target = new Date(dateStr);
  return Math.ceil((target - now) / (1000 * 60 * 60 * 24));
}

export default function MacroMonitorPage() {
  const [expandedId, setExpandedId] = useState(null);
  const [catFilter, setCatFilter] = useState('all');

  const { data: apiIndicators, isLoading, isError } = useQuery({
    queryKey: ['macro', 'indicators'],
    queryFn: () => apiGet('/api/macro/indicators'),
    refetchInterval: 300_000, // 5 min
  });

  const data = useMemo(() => {
    if (apiIndicators?.length > 0) {
      return apiIndicators.map((ind) => ({
        ...ind,
        trend: ind.series?.map((s) => s.value) || [],
      }));
    }
    // Fallback to hardcoded data when API unavailable
    return FALLBACK_INDICATORS;
  }, [apiIndicators]);

  const isLive = apiIndicators?.length > 0;

  const categories = ['all', ...new Set(data.map((i) => i.category))];
  const filtered = catFilter === 'all' ? data : data.filter((d) => d.category === catFilter);

  return (
    <div className="mm-page">
      <header className="mm-header">
        <h1>Macro Monitor</h1>
        <p className="mm-subtitle">
          Key macroeconomic indicators affecting all markets.
          {isLive ? ' Live from FRED + ECB.' : isError ? ' API offline — using reference data.' : ' Connecting...'}
        </p>
      </header>

      {isLoading && <LoadingSkeleton variant="card" count={3} />}

      {!isLoading && (
      <>
      {/* Category tabs */}
      <div className="mm-cat-tabs">
        {categories.map((cat) => (
          <button
            key={cat}
            type="button"
            className={`mm-cat-tab ${catFilter === cat ? 'mm-cat-active' : ''}`}
            onClick={() => setCatFilter(cat)}
          >
            {cat === 'all' ? 'All Indicators' : cat}
          </button>
        ))}
      </div>

      {/* Risk On/Off summary */}
      <section className="mm-section">
        <div className="mm-risk-bar">
          <div className="mm-risk-item">
            <span className="mm-risk-label">Risk Environment</span>
            <span className="mm-risk-value mm-risk-on">Risk On</span>
          </div>
          <div className="mm-risk-item">
            <span className="mm-risk-label">Fed Stance</span>
            <span className="mm-risk-value" style={{ color: '#f59e0b' }}>Hold</span>
          </div>
          <div className="mm-risk-item">
            <span className="mm-risk-label">Inflation Trend</span>
            <span className="mm-risk-value mm-risk-on">Easing</span>
          </div>
          <div className="mm-risk-item">
            <span className="mm-risk-label">Growth</span>
            <span className="mm-risk-value mm-risk-on">Above Trend</span>
          </div>
        </div>
      </section>

      {/* Indicator cards */}
      <section className="mm-section">
        <div className="mm-grid">
          {filtered.map((ind) => {
            const isExpanded = expandedId === ind.id;
            const changeDir = ind.change > 0 ? 'mm-up' : ind.change < 0 ? 'mm-down' : 'mm-flat';
            const impactCls = `mm-impact-${ind.impact}`;
            const minVal = Math.min(...ind.trend);
            const maxVal = Math.max(...ind.trend);
            const range = maxVal - minVal || 1;
            const toY = (v) => 100 - ((v - minVal) / range) * 100;
            const linePts = ind.trend.map((v, i) => `${(i / (ind.trend.length - 1)) * 100},${toY(v)}`).join(' ');

            return (
              <div
                key={ind.id}
                className={`mm-card ${isExpanded ? 'mm-expanded' : ''}`}
                onClick={() => setExpandedId(isExpanded ? null : ind.id)}
              >
                <div className="mm-card-header">
                  <div className="mm-card-title">
                    <span className="mm-ind-name">{ind.name}</span>
                    <span className="mm-ind-category">{ind.category}</span>
                  </div>
                  <span className={`mm-impact-badge ${impactCls}`}>{ind.impact}</span>
                </div>

                <div className="mm-values">
                  <span className="mm-current">{ind.currentValue ?? ind.current}{ind.unit && <small>{ind.unit}</small>}</span>
                  <span className={`mm-change ${(ind.change ?? 0) > 0 ? 'mm-up' : (ind.change ?? 0) < 0 ? 'mm-down' : 'mm-flat'}`}>
                    {(ind.change ?? 0) >= 0 ? '+' : ''}{(ind.change ?? 0).toFixed(1)}{ind.unit}
                  </span>
                </div>

                {/* Sparkline */}
                <svg viewBox="0 0 100 100" className="mm-sparkline" preserveAspectRatio="none">
                  <polyline
                    fill="none"
                    stroke="var(--accent, #0ea5a6)"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    points={linePts}
                  />
                </svg>

                <div className="mm-card-footer">
                  <span className="mm-source">Source: {ind.source}</span>
                  <span className="mm-next">
                    {ind.nextRelease ? `Next: ${ind.nextRelease}` : ''}
                  </span>
                </div>

                {isExpanded && (
                  <div className="mm-expanded-body" onClick={(e) => e.stopPropagation()}>
                    <div className="mm-expanded-chart">
                      <svg viewBox="0 0 100 100" className="mm-large-chart" preserveAspectRatio="none">
                        <defs>
                          <linearGradient id={`mmGrad-${ind.id}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="var(--accent, #0ea5a6)" stopOpacity="0.2" />
                            <stop offset="100%" stopColor="var(--accent, #0ea5a6)" stopOpacity="0" />
                          </linearGradient>
                        </defs>
                        <polygon fill={`url(#mmGrad-${ind.id})`} points={`0,100 ${linePts} 100,100`} />
                        <polyline fill="none" stroke="var(--accent, #0ea5a6)" strokeWidth="1.5" points={linePts} />
                        {/* Previous value reference line */}
                        <line x1="0" y1={toY(ind.previous)} x2="100" y2={toY(ind.previous)} stroke="rgba(255,255,255,0.12)" strokeWidth="0.4" strokeDasharray="2 3" />
                      </svg>
                    </div>
                    <div className="mm-expanded-meta">
                      <div className="mm-meta-row"><span>Previous</span><strong>{ind.previousValue ?? ind.previous}{ind.unit}</strong></div>
                      <div className="mm-meta-row"><span>Change</span><strong className={(ind.change ?? 0) >= 0 ? 'mm-up' : 'mm-down'}>{(ind.change ?? 0) >= 0 ? '+' : ''}{(ind.change ?? 0).toFixed(1)}{ind.unit}</strong></div>
                      <div className="mm-meta-row"><span>Source</span><strong>{ind.source}</strong></div>
                      <div className="mm-meta-row"><span>Market Impact</span><strong className={`mm-impact-${ind.impact || 'medium'}`}>{(ind.impact || 'medium').toUpperCase()}</strong></div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
      </>
      )}
    </div>
  );
}
