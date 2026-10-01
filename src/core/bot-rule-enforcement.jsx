/**
 * bot-rule-enforcement.jsx — THE shared home for "what does this field actually do?" (#870).
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * `ViewStrategyPage` reports a bot's enforcement AFTER the bot exists. The CREATE form offers the
 * same fields BEFORE it exists — and it offered every one of them with no indication that some do
 * nothing at all. Measured 2026-09-17 in `nest/src/modules/trading/bot-rules.ts`: **8 of 29
 * behavioural columns were enforced nowhere on the live path**, and the form offered all of them.
 *
 * The sharpest case was the whole `hotStock*` block — a labelled section, a checkbox and a
 * reveal-on-tick sub-form — where a user ticks the box, fills in the allocation, and **nothing
 * whatsoever happens**. `maxPositions` was the dangerous one rather than the useless one: the live
 * cap is the GLOBAL `risk.maxOpenPositions` setting, so a per-bot 1 does not cap anything.
 *
 * ⚠️ THE STATUS IS READ, NEVER RESTATED. `GET /api/trading/strategies/bot-rules` is the single
 * source; `bot-rules.ts` is guarded by `nest/scripts/validate-bot-rules.cjs`, which fails the build
 * when a behavioural `trading_strategy` column has no declaration. A second copy of the labels or
 * the hints in the create form would drift from the truth view — which is the defect this module
 * exists to prevent, and the reason both surfaces now import from here.
 *
 * ⚠️ AN UNDECLARED FIELD IS LOUD. If a screen asks for the status of a field the registry does not
 * know, `BotRuleStatus` renders a visible `UNDECLARED` marker rather than nothing. Silence there
 * would be indistinguishable from "fine", which is the failure signature this codebase keeps
 * re-finding (`development-philosophy` §7).
 */

import { useQuery } from '@tanstack/react-query';
import { apiGet } from './api/client';

const TRADING = '/api/trading/strategies';

/**
 * The four enforcement levels, in the badge's own words.
 *
 * ⚠️ The WORD is the meaning. The chip only tints it, because the semantic colour tokens are tuned
 * for a black background and would fail WCAG AA as text on a light panel. Keeping the meaning in
 * text also means the badge survives greyscale and colour-blind rendering.
 *
 * Moved here verbatim from `ViewStrategyPage` (#870) so the create form and the truth view cannot
 * disagree about what "EXECUTE ONLY" means.
 */
export const ENFORCEMENT = {
  live: {
    word: 'LIVE',
    chip: 'chipLive',
    hint: 'Can block or shape a trade on the live queue path.',
  },
  'legacy-only': {
    word: 'EXECUTE ONLY',
    chip: 'chipLegacy',
    hint:
      'Applies when you press Execute. The AUTOMATION LOOP DOES NOT APPLY IT, so this field ' +
      'cannot stop a live trade.',
  },
  'display-only': {
    word: 'DISPLAY ONLY',
    chip: 'chipDisplay',
    hint: 'Read and returned, but cannot affect a trade.',
  },
  none: {
    word: 'NOT APPLIED',
    chip: 'chipNone',
    hint: 'No reader anywhere. Persisted and offered in the create form, and enforced nowhere.',
  },
};

/** The enforcement of a field the registry does not declare. Deliberately alarming, and not a key. */
export const UNDECLARED = {
  word: 'UNDECLARED',
  chip: 'chipUndeclared',
  hint:
    'This field is not declared in bot-rules.ts. Either it is new and undecided, or the name here ' +
    'is wrong — in both cases its enforcement is UNKNOWN, which is not the same as "fine".',
};

/**
 * Every declared rule, keyed by field name. One fetch per page, shared by react-query's cache.
 *
 * @returns {{ byField: Record<string, object>, counts: object|null, note: string|null, isLoading: boolean, error: unknown }}
 */
export function useBotRules() {
  const query = useQuery({
    queryKey: ['bot-rules'],
    queryFn: () => apiGet(`${TRADING}/bot-rules`),
    staleTime: 5 * 60 * 1000,
  });

  const all = query.data?.all ?? [];
  const byField = {};
  for (const rule of all) byField[rule.field] = rule;

  return {
    byField,
    counts: query.data?.counts ?? null,
    note: query.data?.note ?? null,
    isLoading: query.isLoading,
    error: query.error ?? null,
  };
}

/** The metadata for one field: its declaration, or `UNDECLARED`. */
export function enforcementOf(byField, field) {
  const rule = byField?.[field];
  const meta = ENFORCEMENT[rule?.enforcement] ?? UNDECLARED;
  return { rule: rule ?? null, meta, word: meta.word, hint: meta.hint };
}

/**
 * A compact, non-blocking status marker for ONE field on a form.
 *
 * ⚠️ It renders for EVERY field, including `live` ones. A marker that only appears when something
 * is wrong teaches the reader that absence means "fine" — and then a bug that stops the marker
 * rendering reads as a clean bill of health. `live` gets a quiet `LIVE` chip instead.
 *
 * `title` carries the declaration's own `summary` (and its caveat, when it has one), so the reason
 * is one hover away without the form growing a paragraph per field.
 */
export function BotRuleStatus({ field, byField, className = '' }) {
  const { rule, meta } = enforcementOf(byField, field);
  const tooltip = [meta.hint, rule?.summary, rule?.caveat].filter(Boolean).join(' — ');

  return (
    <span
      className={`brs-chip ${className}`.trim()}
      data-enforcement={rule?.enforcement ?? 'undeclared'}
      title={tooltip}
      role="note"
      aria-label={`${field}: ${meta.word}. ${meta.hint}`}
    >
      {meta.word}
    </span>
  );
}

/** A one-line explanation of the markers, for the top of a form that uses them. */
export function EnforcementLegend({ counts }) {
  const parts = Object.entries(ENFORCEMENT).map(([key, m]) => `${counts?.[key] ?? 0} ${m.word}`);
  return (
    <p className="brs-legend">
      Enforcement is declared once in <code>bot-rules.ts</code> and shown beside every field, because
      several can be configured and applied nowhere. Declared across all bots:{' '}
      <strong>{parts.join(' · ')}</strong>.
    </p>
  );
}
