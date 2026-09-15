/**
 * NoticeBlock — renders ONE registry notice (#826).
 * ================================================
 * The single renderer for a notice object, so every surface shows the same things in the same order
 * and a change here changes all of them ("establish output once", shared-core.instructions.md).
 *
 * ⚠️ It renders `cause` and `action` VISIBLY, not in a tooltip. Explanations were previously hung on
 * `title=` attributes, which is hover-only — unusable by keyboard, touch and screen-reader users, and
 * exactly why #824's "Unsupported filling mode" gave a user nothing to act on.
 *
 * Accessibility (accessibility-policy.instructions.md):
 *   - `role="alert"` for critical/error, `role="status"` for warning/info/success, so assistive tech
 *     announces a failure when it appears.
 *   - Colour is never the only signal: the code and the "Why"/"Fix" labels carry the meaning.
 *   - All colours come from CSS variables; no hex literals.
 *
 * Props:
 *   notice  a rendered notice from `notice()` / `noticeFromError()` (null renders nothing)
 *   compact tighter padding, for inline use inside a card
 */

import './notice-block.css';

export default function NoticeBlock({ notice, compact = false }) {
  if (!notice) return null;

  const isFailure = notice.severity === 'critical' || notice.severity === 'error';
  const refs = (notice.refs || []).join(' ');
  const codeTitle = [
    'Stable notice code — quote this when reporting the problem.',
    refs ? `Related: ${refs}` : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={`notice-block notice-block--${notice.severity}${compact ? ' notice-block--compact' : ''}`}
      role={isFailure ? 'alert' : 'status'}
    >
      <div className="notice-head">
        <span className="notice-title">{notice.title}</span>
        <code className="notice-code" title={codeTitle}>
          {notice.code}
        </code>
      </div>

      <p className="notice-message">{notice.message}</p>

      {notice.cause && (
        <p className="notice-detail">
          <span className="notice-label">Why</span>
          {notice.cause}
        </p>
      )}

      {notice.action && (
        <p className="notice-detail">
          <span className="notice-label">Fix</span>
          {notice.action}
        </p>
      )}

      {notice.external && (
        <p className="notice-external">
          {notice.external.system}
          {notice.external.code != null ? ` ${notice.external.code}` : ''}
          {notice.external.name ? ` · ${notice.external.name}` : ''}
        </p>
      )}
    </div>
  );
}
