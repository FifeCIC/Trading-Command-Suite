import { useState, useEffect } from 'react';
import { apiGet } from '../core/api/client';
import './startup-checklist.css';

/**
 * Startup Checklist — surfaces pending dev actions when the app loads.
 * Shows: API status, pending migrations, seed scripts, prompt queue status.
 * Dismissible — reappears on next page load.
 */

const STORAGE_KEY = 'tcs-startup-checklist-dismissed';

// ── Known pending actions (hardcoded — updated manually as work completes) ──

const PENDING_ACTIONS = [
  {
    id: 'prisma-migration',
    label: 'Run Prisma migration',
    detail: 'Q287 added NewsArticle + NewsImportRun models. Migration needs running.',
    command: '$env:DATABASE_URL = "mysql://root:@localhost:3306/tradingcommandsuite"; npx --prefix c:\\wamp64\\www\\trading-command-suite\\nest prisma migrate dev --name add-news-article --schema c:\\wamp64\\www\\trading-command-suite\\nest\\prisma\\schema.prisma',
    type: 'warning',
    area: 'database',
  },
  {
    id: 'seed-strategies',
    label: 'Seed strategy templates',
    detail: 'Q289 added 9 pre-built strategy templates. Run seed:strategies to populate the DB.',
    command: 'npm --prefix c:\\wamp64\\www\\trading-command-suite\\nest run seed:strategies',
    type: 'info',
    area: 'database',
  },
  {
    id: 'seed-faq',
    label: 'Seed FAQ entries',
    detail: 'FAQ seed data available. Run seed:faq to populate.',
    command: 'npm --prefix c:\\wamp64\\www\\trading-command-suite\\nest run seed:faq',
    type: 'info',
    area: 'database',
  },
];

export default function StartupChecklist() {
  const [apiOnline, setApiOnline] = useState(null);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    } catch {
      return [];
    }
  });
  const [collapsed, setCollapsed] = useState(false);
  const [copiedId, setCopiedId] = useState(null);

  useEffect(() => {
    apiGet('/api/health')
      .then((data) => setApiOnline(data?.status !== 'down'))
      .catch(() => setApiOnline(false));
  }, []);

  // Filter out dismissed + auto-hide actions that don't apply
  const visible = PENDING_ACTIONS.filter((a) => !dismissed.includes(a.id));

  // If API is offline, add a prominent "Start NestJS" action
  const hasApiAction = apiOnline === false;
  const allActions = hasApiAction
    ? [
        {
          id: 'start-nestjs',
          label: '⚠️ Start NestJS API server',
          detail: 'API is unreachable. The backend must be running for data to load.',
          command:
            'npm --prefix c:\\wamp64\\www\\trading-command-suite\\nest run start:dev',
          type: 'error',
          area: 'server',
        },
        ...visible,
      ]
    : visible;

  if (allActions.length === 0 && apiOnline !== false) return null;

  const dismiss = (id) => {
    const next = [...dismissed, id];
    setDismissed(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  };

  const copyCommand = async (cmd) => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopiedId(cmd);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // fallback — select text
    }
  };

  const warningCount = allActions.filter((a) => a.type === 'warning' || a.type === 'error').length;

  return (
    <div className="checklist-banner">
      <div className="checklist-header" onClick={() => setCollapsed(!collapsed)}>
        <span className="checklist-icon">📋</span>
        <span className="checklist-title">
          Startup Checklist
          {warningCount > 0 && (
            <span className="checklist-badge checklist-badge-warn">{warningCount}</span>
          )}
        </span>
        <span className="checklist-count">{allActions.length} action{allActions.length !== 1 ? 's' : ''}</span>
        <span className="checklist-chevron">{collapsed ? '▸' : '▾'}</span>
      </div>

      {!collapsed && (
        <div className="checklist-body">
          {allActions.map((action) => (
            <div key={action.id} className={`checklist-item checklist-item--${action.type}`}>
              <div className="checklist-item-left">
                <span className={`checklist-dot checklist-dot--${action.type}`} />
                <div>
                  <div className="checklist-item-label">{action.label}</div>
                  <div className="checklist-item-detail">{action.detail}</div>
                </div>
              </div>
              <div className="checklist-item-actions">
                <button
                  className="checklist-btn-copy"
                  onClick={() => copyCommand(action.command)}
                  title="Copy command to clipboard"
                >
                  {copiedId === action.command ? '✓ Copied' : '📋 Copy'}
                </button>
                <button
                  className="checklist-btn-dismiss"
                  onClick={() => dismiss(action.id)}
                  title="Dismiss this reminder"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
