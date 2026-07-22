import { Link } from 'react-router-dom';
import './lab-landing.css';

const LAB_SECTIONS = [
  {
    id: 'lab',
    label: 'Lab Sandbox',
    icon: '🔬',
    description: 'Free-form experimentation area — UI theming, component prototypes, and design explorations. Nothing is production-bound.',
    route: '/lab/lab',
    status: 'new',
  },
  {
    id: 'feature-lab',
    label: 'Feature Lab',
    icon: '🔬',
    description: 'Visual demonstrations of trading automation concepts — trailing stops, partial take-profit, auto risk sizing.',
    route: '/lab/feature-lab',
    status: 'new',
  },
  {
    id: 'theme-lab',
    label: 'Theme Lab',
    icon: '🎨',
    description: 'Experimental CSS and animation features. Motion Lab, Transitions Lab, Scroll Animations, and more.',
    route: '/lab/theme-lab',
    subViews: [
      { id: 'theme-lab-motion', label: 'Motion Lab', desc: 'Micro-interaction animations' },
      { id: 'theme-lab-transitions', label: 'Transitions Lab', desc: 'Page crossfade API' },
      { id: 'theme-lab-scroll', label: 'Scroll Animations', desc: 'Scroll-driven effects' },
    ],
    status: 'active',
  },
  {
    id: 'component-lab',
    label: 'Component Lab',
    icon: '🧩',
    description: 'Reusable UI component showcase and testing.',
    route: '/lab/component-lab',
    status: 'active',
  },
  {
    id: 'backtest',
    label: 'Backtest Engine',
    icon: '⬡',
    description: 'Historical strategy validation and performance analysis. Located in Development area.',
    route: '/builder/backtest',
    status: 'active',
  },
  {
    id: 'candle-patterns',
    label: 'Candle Pattern Training',
    icon: '🕯️',
    description: 'Interactive candle pattern detection, recognition training, and pattern guide. Located in Training area.',
    route: '/training/candle-patterns',
    subViews: [
      { id: 'candle-patterns-guide', label: 'Pattern Guide', desc: 'Reference library of patterns' },
    ],
    status: 'active',
  },
  {
    id: 'order-testing',
    label: 'Order Testing',
    icon: '🧪',
    description: 'Test order execution flows without real money. Located in Training area.',
    route: '/training/order-testing',
    status: 'active',
  },
  {
    id: 'performance-lab',
    label: 'Protocol Performance',
    icon: '📊',
    description: 'Strategy protocol performance metrics and comparison. Located in Development area.',
    route: '/builder/performance-lab',
    status: 'active',
  },
];

export default function LabLandingPage() {
  return (
    <div className="ll-page">
      <header className="ll-header">
        <h1>Lab</h1>
        <p className="ll-subtitle">
          Exploration, experimentation, and demonstration area. Everything here is sandboxed —
          changes do not affect live trading.
        </p>
      </header>

      <div className="ll-grid">
        {LAB_SECTIONS.map((section) => (
          <div key={section.id} className={`ll-card ${section.status === 'new' ? 'll-card-new' : ''}`}>
            <div className="ll-card-header">
              <span className="ll-card-icon">{section.icon}</span>
              <h3>{section.label}</h3>
              {section.status === 'new' && <span className="ll-badge-new">NEW</span>}
            </div>
            <p className="ll-card-desc">{section.description}</p>
            <Link to={section.route} className="ll-card-link">
              Open →
            </Link>
            {section.subViews && section.subViews.length > 0 && (
              <div className="ll-sub-views">
                {section.subViews.map((sv) => (
                  <Link key={sv.id} to={`/lab/${sv.id}`} className="ll-sub-link" title={sv.desc}>
                    {sv.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
