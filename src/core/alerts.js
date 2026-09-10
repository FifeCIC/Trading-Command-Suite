/**
 * Alert shape helpers
 * ===================
 * GET /api/alerts/active returns rows from the `alert` table, written by
 * AlertsService.addAlert(type, title, detail, severity, ticker?, link?).
 *
 * ⚠️ TWO SHAPES EXIST. AlertTriggerService.fireAlert() passed its arguments
 * shifted by one position (`severity, 'trading', title, message`), so every
 * alert fired before that fix was stored as:
 *
 *   legacy/shifted   type=<level>      title=<category>  detail=<title>  severity=<message>
 *   correct          type=<category>   title=<title>     detail=<message> severity=<level>
 *
 * Both still arrive from the API until the pruned/rotated legacy rows age out,
 * so read alerts through normaliseAlert() rather than touching the raw columns.
 * Readers that trust `title`/`severity` directly show "trading" as every
 * headline and mis-colour severity — which is what the widget board hit.
 */
/** Severity ordering as stored by the API. */
const ALERT_LEVELS = ['critical', 'high', 'warning', 'medium', 'info', 'low'];

/** Categories the Alert Center understands (its TYPE_FALLBACKS keys). */
const ALERT_CATEGORIES = ['signal', 'drawdown', 'daily', 'backtest', 'system', 'trading'];

const LEVEL_SET = new Set(ALERT_LEVELS);
const CATEGORY_SET = new Set(ALERT_CATEGORIES);

/** Sort weight — critical first. */
export const ALERT_LEVEL_WEIGHT = {
  critical: 5,
  high: 4,
  warning: 3,
  medium: 2,
  info: 1,
  low: 0,
};

/**
 * normaliseAlert(raw) → stable shape regardless of which column layout the row
 * was stored with: { level, category, title, message, ...raw }.
 */
export function normaliseAlert(raw = {}) {
  const severityIsLevel = LEVEL_SET.has(raw.severity);
  const typeIsLevel = LEVEL_SET.has(raw.type);

  const level = severityIsLevel ? raw.severity : (typeIsLevel ? raw.type : 'info');
  const category = typeIsLevel
    ? (CATEGORY_SET.has(raw.title) ? raw.title : 'system')
    : (raw.type || 'system');
  const title = CATEGORY_SET.has(raw.title)
    ? (raw.detail || raw.title)
    : (raw.title || raw.detail || raw.type || 'Alert');
  const message = severityIsLevel ? (raw.detail || '') : (raw.severity || raw.detail || '');

  return { ...raw, level, category, title, message };
}
