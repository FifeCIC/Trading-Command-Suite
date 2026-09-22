/**
 * StrategyBits — the fragments the TWO strategy surfaces both render.
 * ====================================================================
 * Extracted 2026-09-22 when the A/B Strategies page was built: its drift note, warning boxes and
 * bots line were copied from `DerivedStrategiesPage`, and `validate-duplication.cjs` flagged the
 * pair. The repo's rule is extract, not copy — a second copy drifts and only one gets the next
 * fix (the bots line is a worked example: the `(bot)` TypeTag landed in one copy first).
 *
 * Styling lives in `strategy-common.module.css` (single owner); both pages import these
 * components, and the source page's page-level classes compose the same CSS.
 */
import TypeTag from './TypeTag';
import common from './strategy-common.module.css';

/**
 * StrategyBots — the bots behind a strategy, with the `(bot)` type suffix.
 * A strategy is ONE bot per the owner's model, but duplicate configurations surface as several
 * names here, which is exactly why the suffix matters.
 */
export function StrategyBots({ names }) {
  return (
    <div className={common.bots}>
      {(names ?? []).join(' · ')}
      <TypeTag kind="bot" />
    </div>
  );
}

/**
 * StrategyWarnings — the two config-level faults, with the SOURCE page's exact rules:
 *   - duplicates: MORE THAN ONE bot on an identical configuration (a single bot is not a
 *     duplicate of anything) — the owner's rule is that these should never exist.
 *   - unreachable: bots with no `strategy_protocol` subscription, skipped silently by routing (#874).
 * Returns null when neither applies, so callers do not branch.
 */
export function StrategyWarnings({ botNames, unreachableBotNames }) {
  const dupNames = (botNames ?? []).length > 1 ? botNames : [];
  const unreachable = unreachableBotNames ?? [];
  if (dupNames.length === 0 && unreachable.length === 0) return null;

  return (
    <>
      {dupNames.length > 0 && (
        <span className={common.warn}>
          <strong>⚠️ Duplicate bots.</strong>{' '}
          {dupNames.length} bots are identical on protocol, role, market, broker and treatment:{' '}
          {dupNames.join(' == ')}. These should not both exist — one should be removed. (#876)
        </span>
      )}

      {unreachable.length > 0 && (
        <span className={common.warn}>
          <strong>⚠️ Can never trade.</strong>{' '}
          {unreachable.length === 1 ? 'This bot has' : 'These bots have'} no{' '}
          <code>strategy_protocol</code> subscription, so signal routing skips{' '}
          {unreachable.length === 1 ? 'it' : 'them'} silently: {unreachable.join(', ')}. (#874)
        </span>
      )}
    </>
  );
}

/**
 * DriftNote — this configuration differs from the registered definition (#875). The name survives
 * (it is pinned to the stable id, not the key).
 *
 * `onReaccept` is OPTIONAL: the Strategies list offers the repair (it owns the mutation); the
 * A/B Strategies page is analysis-only and renders the note read-only. One component, one look.
 */
export function DriftNote({ drift, onReaccept = null, saving = false }) {
  if (!drift) return null;
  return (
    <div className={common.drift}>
      <strong>Drift vs “{drift.name || drift.id.slice(0, 8)}”.</strong>{' '}
      This configuration differs from the accepted definition.
      {drift.changed?.length > 0 && (
        <ul className={common.driftList}>
          {drift.changed.map((c) => (
            <li key={c.field}>
              <code>{c.field}</code>: {c.from} → {c.to}
            </li>
          ))}
        </ul>
      )}
      {onReaccept && (
        <button className={common.regBtn} onClick={onReaccept} disabled={saving}>
          Re-accept this configuration
        </button>
      )}
    </div>
  );
}
