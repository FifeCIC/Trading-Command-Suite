/**
 * MT5 Comment Sanitizer — single source of truth for safe order comments.
 * ===========================================================================
 * MT5's order `comment` field is short (broker-dependent, ~27 chars) and
 * ASCII-only. Non-ASCII characters (—, %, |, emoji, etc.) or overlength
 * comments cause the order to be REJECTED with:
 *
 *     (-2, 'Invalid "comment" argument')
 *
 * Evidence: scripts/mt5-bridge/bridge.log — hundreds of order_failed entries
 * (most recently NZDUSD buy 2026-08-12 23:22) caused by unsanitised comments
 * reaching mt5.order_send().
 *
 * RULES:
 *   - ASCII letters, digits, spaces, and hyphens only
 *   - Collapse repeated whitespace
 *   - Truncate to maxLen (default 27 — safe MT5 limit)
 *
 * NOTE: do NOT use '|' or '%' in comments — they are stripped here, and the
 * closePosition() parser (split('|')[0]) must not depend on them.
 */

export function sanitizeMt5Comment(comment: string | null | undefined, maxLen = 27): string {
  return (comment ?? 'TCS auto')
    .replace(/[^a-zA-Z0-9 -]/g, ' ') // ASCII only — strip |, %, —, emoji, etc.
    .replace(/\s+/g, ' ')             // collapse whitespace
    .trim()
    .substring(0, maxLen);
}
