/**
 * DerivedStrategiesPage — STRATEGIES, derived from the unique META.Stack combinations.
 * ===============================================================================
 * Data: GET /api/scoring/strategies/derived  (StrategyDerivationService, #876)
 * Design: docs/trading-bot-model.md §1c (the counting rule) and §1d (the identity)
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PAGE IS FOR — and what makes it different from `Trading Bots`
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * `Trading Bots` lists `trading_strategy` ROWS: the execution policy, one card per bot. That is
 * 26 cards.
 *
 * This page lists **strategies**, which are a different thing: a distinct
 * `(protocol, treatment)` combination. It renders **18** from the same 26 bots.
 *
 * The difference is the owner's rule, and it is not cosmetic:
 *
 *     "A strategy is about different treatment of a symbol."  — §1c
 *
 * BEFORE: `GET /api/scoring/metastacks/ratings` iterated `scoring_strategy` ROWS, so the 13 bots
 * sharing `auto-forex-session-v1` produced ONE blended rating covering SIX different treatments
 * (six ungated, three `london`-gated, two `asian`-gated, NZDJPY at 10x size, USDCAD on 5s, USDJPY
 * on 1h). If one treatment lost money and the rest won, the blended average hid it and there was no
 * way to tell which treatment worked.
 *
 * ⚠️ SYMBOLS ARE SCOPE, NOT IDENTITY. One strategy here can serve six FX pairs. If this page ever
 * starts showing one card per symbol it has regressed to row-counting, which is the bug it exists to
 * remove. The FX family is the test: it must show **6** cards, not 13 and not 1.
 *
 * NEXT: #875 pins a name onto a `strategyKey` and records the part IDs, so a named strategy
 * survives an edit to one of its parts. Until then every strategy here is unnamed and derived
 * fresh on each read — which is why editing a bot's config REPLACES a key rather than mutating one.
 */

import { useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import EmptyState from '../components/EmptyState';
import { useScrollReveal } from '../hooks/useScrollReveal';
import styles from './derived-strategies.module.css';

const API = '/api/scoring/strategies/derived';

/** Show this many symbols before collapsing the rest into "+N more". */
const MAX_SYMBOLS = 8;

/**
 * field() — one labelled treatment value.
 *
 * ⚠️ `null` renders as its meaning ("no limit" / "ungated"), NEVER as a blank or a dash. A NULL here
 * is a real declared value, not missing data — `maxHoldHours` NULL means no time-stop exists (#773),
 * and `sessionWindow` NULL means the bot may act at any hour. Rendering those as empty would make
 * "unlimited" indistinguishable from "we failed to load it", which is the collapse this project has
 * been bitten by before.
 */
function field(label, value, nullText) {
  const isNull = value === null || value === undefined || value === '';
  return (
    <div className={styles.field} key={label}>
      <span className={styles.fieldLabel}>{label}</span>
      <span className={`${styles.fieldValue} ${isNull ? styles.fieldValueNull : ''}`}>
        {isNull ? nullText : value}
      </span>
    </div>
  );
}

function SymbolChips({ symbols }) {
  const shown = symbols.slice(0, MAX_SYMBOLS);
  const rest = symbols.length - shown.length;
  return (
    <div className={styles.symbols}>
      {shown.map((s) => (
        <span className={styles.symbol} key={s}>{s}</span>
      ))}
      {rest > 0 && (
        <span className={styles.symbolMore} title={symbols.slice(MAX_SYMBOLS).join(', ')}>
          +{rest} more
        </span>
      )}
    </div>
  );
}

function StrategyCard({ strategy }) {
  const t = strategy.treatment ?? {};
  const unreachable = strategy.unreachableBotNames ?? [];

  return (
    <li
      className={[
        styles.card,
        strategy.active ? styles.cardActive : '',
        unreachable.length ? styles.cardUnreachable : '',
      ].filter(Boolean).join(' ')}
    >
      <div className={styles.cardHead}>
        {/* The stable identity — "the ID along with the IDs of each part" (#876/#875). */}
        <code className={styles.key} title="SHA-256 over protocol + role + treatment. Scope is excluded.">
          {strategy.strategyKey}
        </code>
        <span className={styles.protocol}>{strategy.protocolIds.join(' + ')}</span>
        {strategy.protocolRoles.map((r) => (
          <span className={styles.role} key={r}>{r}</span>
        ))}
        <span className={styles.scope}>
          {strategy.symbolCount === 1 ? '1 symbol' : `${strategy.symbolCount} symbols`}
          {' · '}
          {strategy.botCount === 1 ? '1 bot' : `${strategy.botCount} bots`}
        </span>
      </div>

      <div className={styles.treatment}>
        {field('timeframe', t.timeframe, '—')}
        {field('min comp', t.minComposite, '—')}
        {field('size', t.baseSize, '—')}
        {field('SL %', t.slPct, '—')}
        {field('TP %', t.tpPct, '—')}
        {field('max hold', t.maxHoldHours, 'no limit')}
        {field('session', t.sessionWindow, 'ungated')}
        {field('cooldown', t.cooldownMinutes, '—')}
        {field('pyramid', t.maxPyramidTiers, '—')}
        {field('mode', t.mode, '—')}
      </div>

      <SymbolChips symbols={strategy.symbols} />

      <div className={styles.bots}>
        {strategy.botNames.join(' · ')}
      </div>

      {unreachable.length > 0 && (
        <span className={styles.warn}>
          <strong>⚠️ Can never trade.</strong>{' '}
          {unreachable.length === 1 ? 'This bot has' : 'These bots have'} no{' '}
          <code>strategy_protocol</code> subscription, so signal routing skips{' '}
          {unreachable.length === 1 ? 'it' : 'them'} silently: {unreachable.join(', ')}. (#874)
        </span>
      )}
    </li>
  );
}

export default function DerivedStrategiesPage() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['strategies', 'derived'],
    queryFn: () => apiGet(API),
    // Deliberately NOT `Infinity`. A derived strategy changes when a part changes, so a cached
    // list would hide exactly the drift this surface exists to show.
    staleTime: 30_000,
  });

  const strategies = useMemo(() => data?.strategies ?? [], [data]);

  // ⚠️ The ref must exist on EVERY render branch, and the effect must depend on the data as well
  // as the ref. Both are load-bearing — see the #864 handoff: with the ref only on the loaded
  // branch, the effect ran while `revealRef.current` was still null, the observer was never
  // attached, and every group stayed at `opacity: 0` permanently.
  const revealRef = useRef(null);
  useScrollReveal(revealRef, [strategies]);

  if (isLoading) {
    return (
      <div className={styles.page} ref={revealRef}>
        <LoadingSkeleton variant="card" count={5} />
      </div>
    );
  }

  // An error and an empty list are DIFFERENT states and must never render the same. "No strategies"
  // is information; "the request failed" is the absence of information.
  if (isError) {
    return (
      <div className={styles.page} ref={revealRef}>
        <div className={styles.error}>
          Could not load derived strategies.
          <span className={styles.errorHint}>
            {error?.message ?? 'The request failed.'} — the derivation ran on the server, so nothing
            has been changed or deleted. Retry, or check that the API is reachable.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page} ref={revealRef}>
      <div className={styles.header}>
        <h1 className={styles.title}>Strategies</h1>
        <p className={styles.definition}>
          A strategy is a distinct <code>(protocol × treatment)</code> — a different way of treating
          a symbol. Symbols and watchlists are <strong>scope</strong>, not identity: one strategy here
          can serve many pairs. These are derived live from the META.Stack pipeline, not stored.
        </p>
      </div>

      <div className={styles.stats}>
        <div className={styles.stat}>
          <span className={styles.statValue}>{data?.totalStrategies ?? 0}</span>
          <span className={styles.statLabel}>strategies</span>
        </div>
        <div className={`${styles.stat} ${styles.statMuted}`}>
          <span className={styles.statValue}>{data?.totalBots ?? 0}</span>
          <span className={styles.statLabel}>bots</span>
        </div>
        <div className={`${styles.stat} ${styles.statMuted}`}>
          <span className={styles.statValue}>{data?.totalPairs ?? 0}</span>
          <span className={styles.statLabel} title="The naive (protocol, bot) pair count — the number that looks like the answer but is not.">
            pairs
          </span>
        </div>
      </div>

      {strategies.length === 0 ? (
        <EmptyState
          icon="🧩"
          title="No strategies"
          description="No bot is linked to a protocol, so no strategy exists yet. Create a bot or add a protocol subscription."
        />
      ) : (
        <ul className={styles.list}>
          {strategies.map((s) => (
            <StrategyCard strategy={s} key={s.strategyKey} />
          ))}
        </ul>
      )}
    </div>
  );
}
