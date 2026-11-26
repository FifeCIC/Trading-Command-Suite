/**
 * attribution-magic.ts — which magics can NAME a bot, and which cannot (#1018, #1349).
 *
 * ── WHY THIS IS ONE FILE AND NOT A LITERAL IN TWO ────────────────────────────────────────────────
 * `234000` was measured to be a magic that means the OPPOSITE of attribution: the MT5 bridge's own
 * `DEFAULT_MAGIC`, used whenever an order is sent without one. So a position carrying it is not "a
 * bot whose magic happens to be 234000" — it is **no bot attributed**. Before per-bot magics existed
 * every live position carried it, and magic is immutable, so those rows can never be attributed by
 * magic at all.
 *
 * ⚠️ THE VALUE WAS ALREADY IN THE REPO TWICE, as a private literal in `stop-guardian.service.ts` and
 * as prose in `trading-strategy.service.ts` ("234000 IS RESERVED AND MUST NEVER BE HANDED OUT"). A
 * third copy would have been the exact defect the shared-core rule names, so the constant lives here
 * and the guardian imports it. Nothing about the value changes; only how many places state it.
 *
 * ⚠️ NULL IS NOT "NO POSITIONS". A position row whose magic is null cannot be attributed to any bot,
 * which is a different answer from "this bot has no positions". Callers must keep the two apart: a
 * lock or a guardian that treats null as "nothing depends on this" fails OPEN, and this repo's most
 * expensive failures are the ones that fail open while reporting a plausible result.
 */

/** The bridge's `DEFAULT_MAGIC` — a magic that means "no bot attributed", never a bot's own. */
export const BRIDGE_DEFAULT_MAGIC = 234000;

/** Per-bot magics start here, matching the seed's convention (`seedDefaults()` allocates from it). */
export const FIRST_BOT_MAGIC = 234100;

/**
 * Can this magic NAME a bot? `false` for null/undefined (the broker reported none), for the bridge
 * default (234000 = "no bot"), and for anything that is not a finite positive integer.
 *
 * ⚠️ There is deliberately no `Number(m)` coercion of strings here. A magic arrives as a number from
 * every adapter, and `Number('234000')` would silently re-admit the bridge default if a caller ever
 * passed it as a string — the coercion is the hole, so the type is the guard.
 */
export function isAttributableMagic(magic: number | null | undefined): magic is number {
  if (magic === null || magic === undefined) return false;
  if (!Number.isInteger(magic) || magic <= 0) return false;
  return magic !== BRIDGE_DEFAULT_MAGIC;
}
