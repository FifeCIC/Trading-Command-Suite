import { Link } from 'react-router-dom';
import './lab-landing.css';

const LAB_SECTIONS = [
  {
    id: 'feature-lab',
    label: 'Feature Lab',
    icon: '🔬',
    description: 'Visual demonstrations of trading automation concepts — trailing stops, partial take-profit, auto risk sizing.',
    route: '/builder/feature-lab',
    status: 'new',
  },
  {
    id: 'theme-lab',
    label: 'Theme Lab',
    icon: '🎨',
    description: 'Experimental CSS and animation features. Container queries, scroll-driven animations, Popover API, Motion One.',
    route: '/builder/theme-lab',
    subViews: [
      { id: 'theme-lab-motion', label: 'Motion', desc: 'Micro-interaction animations' },
      { id: 'theme-lab-transitions', label: 'View Transitions', desc: 'Page crossfade API' },
      { id: 'theme-lab-container', label: 'Container Queries', desc: 'Component-level responsiveness' },
      { id: 'theme-lab-scroll', label: 'Scroll Animations', desc: 'Scroll-driven effects' },
      { id: 'theme-lab-popover', label: 'Popover API', desc: 'Native popover behaviour' },
    ],
    status: 'active',
  },
  {
    id: 'component-lab',
    label: 'Component Lab',
    icon: '🧩',
    description: 'Reusable UI component showcase and testing.',
    route: '/builder/component-lab',
    status: 'active',
  },
  {
    id: 'algorithm-lab',
    label: 'Algorithm Lab',
    icon: '📐',
    description: 'Directive scoring logs, algorithm debugging, and calculation trace viewer.',
    route: '/builder/algorithm-lab',
    status: 'active',
  },
  {
    id: 'backtest',
    label: 'Backtest Engine',
    icon: '⬡',
    description: 'Historical strategy validation and performance analysis.',
    route: '/builder/backtest',
    status: 'active',
  },
  {
    id: 'candle-patterns',
    label: 'Candle Pattern Training',
    icon: '🕯️',
    description: 'Interactive candle pattern detection, recognition training, and pattern guide.',
    route: '/builder/candle-patterns',
    subViews: [
      { id: 'candle-patterns-guide', label: 'Pattern Guide', desc: 'Reference library of patterns' },
    ],
    status: 'active',
  },
  {
    id: 'order-testing',
    label: 'Order Testing',
    icon: '🧪',
    description: 'Test order execution flows without real money.',
    route: '/builder/order-testing',
    status: 'active',
  },
  {
    id: 'performance-lab',
    label: 'Protocol Performance',
    icon: '📊',
    description: 'Strategy protocol performance metrics and comparison.',
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
                  <Link key={sv.id} to={`/builder/${sv.id}`} className="ll-sub-link" title={sv.desc}>
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
