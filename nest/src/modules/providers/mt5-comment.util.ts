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

  // Legacy documented form `TCS:<protocol>:<strategy>` (#949). The writer has never produced it in
  // production (0 of 76 measured comments, 2026-09-17) but the time-stop's separate parser honoured
  // it — so the canonical parser must too, or retiring that parser changes behaviour.
  const legacy = /^TCS:\s*([^:]+):([^\s|]+)/.exec(raw);
  if (legacy) {
    const legacyName = legacy[2].trim();
    return legacyName && !/^manual\b/i.test(legacyName) ? legacyName : undefined;
  }

  const head = raw.includes('|') ? raw.split('|')[0] : raw;
  const name = head
    .replace(/^TCS\s+/i, '')                        // pipeline prefix — not part of the name
    .replace(/(?:^|\s)\d{1,3}\s*%?\s*$/, '')        // trailing score, e.g. "Gold Swing 1H 119"
    .trim();

  // ⚠️ TWO THINGS THAT LOOK LIKE A STRATEGY AND ARE NOT (#949):
  //   1. An origin stamp on a closing deal, e.g. `TCS:time-stop` (#916) — an ACTOR, not a strategy.
  //      Anything still carrying a colon after the branches above is one of these.
  //   2. `TCS manual <protocol>` — a human trade (4 such rows measured). Scoped to OUR comment
  //      convention: a foreign comment that merely contains the word is passed through as before,
  //      because it is not ours to reinterpret.
  if (!name || name.includes(':')) return undefined;
  if (/^TCS\s+/i.test(raw) && /^manual\b/i.test(name)) return undefined;
  return name;
}

/**
 * classifyMt5Comment() — strategy / manual / none, for consumers that must tell them apart (#949).
 * ==================================================================================================
 * The time-stop asks a different question from the comparison page: not "what name is on this
 * comment?" but "MAY A BOT'S RULE BE APPLIED TO IT?". A human trade must never be closed on the
 * strength of a bot's configured hold limit, so `manual` is its own answer, not an empty strategy.
 *
 * ⚠️ WHY THIS LIVES HERE. `position-time-stop.service.ts` used to own a second parser
 * (`parseCommentTarget`) with its own regexes. Two parsers for one format is the defect that
 * produced #884 — the writers and readers of a comment must not be able to disagree. Measured
 * 2026-09-17, that second parser matched ZERO of the 76 real comments because it waited for
 * `TCS:<protocol>:<strategy>`, a form nothing has ever produced (59 of 76 were `TCS <name>`).
 */
export function classifyMt5Comment(
  comment: string | null | undefined,
): { kind: 'strategy' | 'manual' | 'none'; name?: string } {
  const raw = (comment ?? '').trim();
  if (!raw) return { kind: 'none' };

  const legacy = /^TCS:\s*([^:]+):([^\s|]+)/.exec(raw);
  if (legacy) {
    const legacyName = legacy[2].trim();
    if (/^manual\b/i.test(legacyName)) return { kind: 'manual' };
    return legacyName ? { kind: 'strategy', name: legacyName } : { kind: 'none' };
  }

  const real = /^TCS\s+(.+)$/i.exec(raw);
  if (!real) return { kind: 'none' };

  const name = extractStrategyFromComment(raw);
  if (!name) {
    // `TCS manual …` yields no NAME, but it is still a manual trade — and that distinction
    // decides whether a bot's hold limit may be applied to the position.
    return /^TCS\s+manual\b/i.test(raw) ? { kind: 'manual' } : { kind: 'none' };
  }
  return { kind: 'strategy', name };
}

/**
 * resolveStrategyForClose() — the precedence a CLOSING row must use (#949).
 * ==================================================================================================
 * 1. The value already on the row — never overwrite a tag the open path wrote.
 * 2. The row's own `brokerComment` — written by us at open (`TCS <name> <score>`).
 * 3. The closing deal's comment — usually an origin stamp, which correctly yields nothing.
 */
export function resolveStrategyForClose(
  existing: string | null | undefined,
  rowComment: string | null | undefined,
  dealComment?: string | null,
): string | undefined {
  return existing || extractStrategyFromComment(rowComment) || extractStrategyFromComment(dealComment) || undefined;
}
