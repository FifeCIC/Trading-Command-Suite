/**
 * Notice — Reusable theme-consistent notice/alert banner.
 *
 * Usage:
 *   <Notice level="warning" icon="⚠️">
 *     This is a warning message with <strong>bold text</strong>.
 *   </Notice>
 *
 * Levels: success | warning | critical | info
 *
 * ⚠️ IT NOW CARRIES A ROLE (2026-11-27). It had none, so a `critical` notice rendered here was
 * completely silent to assistive technology — the same defect `NoticeBlock` already avoids by mapping
 * severity to `role="alert"` / `role="status"`. A banner a screen reader never announces is not a
 * banner; it is a coloured rectangle. The mapping is deliberately identical to `NoticeBlock`'s so the
 * two cannot teach a reader different conventions.
 *
 * ⚠️ THIS IS THE PLAIN BANNER, NOT THE REGISTRY RENDERER. Anything reporting a FAILURE belongs in
 * `NoticeBlock` with a `notice()` code (#826); `Notice` is for contextual prose a page writes itself,
 * and `validate-notices.cjs` still governs the error path.
 *
 * ── DECISION (2026-11-19, primary) ──
 * WHAT:      `Notice` announces `critical` as `role="alert"` and every other level as `role="status"`,
 *            matching `NoticeBlock` exactly.
 * WHY:       It rendered no role at all, so a critical banner on the three pages that use it was silent to
 *            assistive technology while the sibling component had done this correctly since #826.
 * INSTEAD OF: Merging `Notice` into `NoticeBlock`. That component is the registry renderer for failures
 *            carrying a stable code; this one is contextual prose, and collapsing them would force a
 *            code onto text that has none.
 * REVERSE BY: Delete both `role` lines and the `Notice.test.jsx` role cases.
 * REGISTER:  docs/SETTLED-DECISIONS.md row 313
 * GUARD:     src/components/Notice.test.jsx (canaried: deleting the role makes the spec exit 1)
 */
export default function Notice({ level = 'info', icon, children, className = '' }) {
  const defaultIcons = {
    success: '✅',
    warning: '⚠️',
    critical: '❌',
    info: 'ℹ️',
  };

  // Critical is an interruption ("this is wrong now"); everything else is an announcement.
  const role = level === 'critical' ? 'alert' : 'status';

  return (
    <div className={`app-notice app-notice--${level} ${className}`} role={role}>
      <span className="app-notice-icon">{icon || defaultIcons[level] || 'ℹ️'}</span>
      <div className="app-notice-body">{children}</div>
    </div>
  );
}
