/**
 * hot-stock-readiness.js — which `hotStock*` bot settings actually have a reader.
 * ==============================================================================
 *
 * ⚠️ WHY THIS IS NOT INLINE IN THE PAGE. 2026-11-18: `/development/movers-treatment` carried a
 * hand-written paragraph claiming *"two of the four hotStock* settings now have a reader"*. It happened
 * to be true, but a hand-written count is a claim that goes stale silently the day a fifth setting is
 * added or a reader is removed — and nothing would have noticed.
 *
 * The canonical statement of "does this column have a reader" already exists: `BOT_RULES` in
 * `nest/src/modules/trading/bot-rules.ts`, served at `GET /api/trading/strategies/bot-rules`, where
 * `enforcement: 'none'` means no reader. This module reads that, and nothing else.
 *
 * ⚠️ IT LIVES IN `src/core/` BECAUSE THAT IS WHAT MAKES IT TESTABLE. The repo has no React test
 * harness (no `@testing-library/react`), so a component's decisions can only be checked by eye. A pure
 * function plus `node --test` is the convention this codebase already uses for exactly this reason —
 * see `src/core/backtest/period-sets.js`.
 */

/**
 * @param {unknown} rules the payload of `GET /api/trading/strategies/bot-rules`
 * @returns {{read: object[], all: object[]}|null} `null` means CANNOT JUDGE, never `0 of 0`.
 */
export function hotStockReadiness(rules) {
  // ⚠️ A failed or absent request is CANNOT JUDGE. Returning `{read: [], all: []}` here would render
  // "0/0 settings have a reader", which reads as a confident claim that nothing reads them — the
  // "plausible output, no error" shape this repo keeps paying for.
  const all = Array.isArray(rules?.all) ? rules.all : null;
  if (!all) return null;

  const mine = all.filter((r) => typeof r?.field === 'string' && r.field.startsWith('hotStock'));
  // No matching settings at all is a payload we do not understand — not a finding of zero.
  if (mine.length === 0) return null;

  return { read: mine.filter((r) => r.enforcement !== 'none'), all: mine };
}

export default hotStockReadiness;
