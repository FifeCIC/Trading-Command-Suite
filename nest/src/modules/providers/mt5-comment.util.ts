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

/**
 * extractStrategyFromComment() — the ONE parser for a strategy name out of an MT5 comment (#884).
 * ================================================================================================
 * Comments are written as `TCS <Strategy Name> <Score>`. Earlier positions carry the legacy
 * `TCS <Strategy> | <Score>%` form (the sanitizer now strips `|`, but old positions keep it).
 *
 * ⚠️ BOTH ERAS MUST YIELD THE SAME SHAPE. The result is a GROUPING KEY — the Strategy
 * Comparison page (trade-history.controller.ts) groups closed trades by it, and the live-
 * positions section keys open trades by it. Measured before this helper existed (2026-09-19):
 * the primary branch parsed `"TCS Gold Swing 1H 119"` → `"Gold Swing 1H 119"` (score left
 * attached) while the legacy branch returned `"TCS Gold Swing 1H"` (prefix left attached) —
 * each variant renders as a SEPARATE strategy on the comparison page.
 *
 * Returns `undefined` when nothing usable remains (empty comment, score-only). An untagged
 * position must stay untagged — never an empty-string strategy.
 */
export function extractStrategyFromComment(comment: string | null | undefined): string | undefined {
  const raw = (comment ?? '').trim();
  if (!raw) return undefined;
  const head = raw.includes('|') ? raw.split('|')[0] : raw;
  const name = head
    .replace(/^TCS\s+/i, '')                        // pipeline prefix — not part of the name
    .replace(/(?:^|\s)\d{1,3}\s*%?\s*$/, '')        // trailing score, e.g. "Gold Swing 1H 119"
    .trim();
  return name || undefined;
}
