/**
 * bot-slug — the ONE place a bot's identifier and display name get their required shape.
 *
 * ── DECISION (2026-11-05, owner direction) ─────────────────────────────────────────────────────
 * WHAT:      `trading_strategy.slug` exists, ends `-bot`, and `trading_strategy.name` ends `Bot`.
 * WHY:       *"Bot names need to end with Bot and their slug has to have bot. This will help bots
 *            stand out from protocols."* Before this, only `protocol` and `sources` had a `slug`
 *            column, so a bot could be addressed only by UUID and its NAME was the only searchable
 *            thing — a name that also had to carry the strategy, the instrument and the timeframe.
 * INSTEAD OF: an `isBot` flag or a name-prefix convention. A flag is a second fact that can disagree
 *            with the name; a slug is the fact itself, and it is what a search or a URL can use.
 * REVERSE BY: dropping the column and these two helpers; nothing reads the slug for trading.
 * REGISTER:  docs/SETTLED-DECISIONS.md (row added 2026-11-05)
 * GUARD:     `bot-slug.spec.ts` — both directions: a name without "Bot" gains it, a slug never ends
 *            `-bot-bot`, and two bots with the same core name get distinct slugs.
 */

/** `"Gold Scalp M5"` → `"Gold Scalp M5 Bot"`. A name that already ends "Bot" is left alone. */
export function normaliseBotName(name: string): string {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) return 'Unnamed Bot';
  return /bot$/i.test(trimmed) ? trimmed : `${trimmed} Bot`;
}

/**
 * `"Gold Scalp M5 Bot"` → `"gold-scalp-m5-bot"`.
 *
 * ⚠️ THE `-bot` SUFFIX IS STRIPPED BEFORE IT IS ADDED, so a name that already carries "Bot" cannot
 * produce `gold-scalp-m5-bot-bot`. That double suffix is the exact shape a naive `slugify(name)` gives
 * and it is what made three protocol slugs read badly in the 2026-11-05 rename proposal.
 */
export function botSlug(name: string): string {
  const base = normaliseBotName(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    // ⚠️ `(?:-?bot)+$` — ONE OR MORE trailing `bot` tokens, not just one. A name containing a
    // parenthetical such as `A (Bot)` normalises to `a-bot`, and stripping a single `-bot` left
    // `a-bot` behind, producing `a-bot-bot`. Caught by `bot-slug.spec.ts`, not by review.
    .replace(/(?:-?bot)+$/, '');
  return `${base || 'unnamed'}-bot`;
}
