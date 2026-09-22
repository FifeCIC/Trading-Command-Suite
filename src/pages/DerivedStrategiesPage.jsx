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
 * This page lists **strategies**, which are a different thing: a distinct combination —
 * protocol + role + market + broker + execution policy. It renders one strategy per bot
 * (27 on 2026-09-19, one unreachable), never merged across markets.
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
 * ⚠️ A STRATEGY IS A BOT CONFIGURATION — protocol + role + market + broker + execution policy.
 * Any difference at all makes a different strategy: *"The smallest change results in a different
 * strategy because we cannot dismiss the power any single setting/behaviour could have on the stock
 * market."* So there is ONE strategy per bot here, and a different market is a different strategy.
 *
 * ⚠️ AN EARLIER VERSION OF THIS PAGE SAID "symbols are scope, not identity" AND SHOWED 18. That was
 * wrong. The corrected measured count is **26 strategies from 26 bots** (25 reachable), with the
 * `forex-session-v1` family resolving to **14**, one per market. If this page ever shows a strategy
 * spanning multiple markets, the identity has regressed.
 *
 * ⚠️ DUPLICATES ARE A DEFECT, NOT A MERGE. Two byte-identical bots are *not* one strategy — the
 * owner's rule is that such bots "should never" exist and "should be avoided". They are surfaced
 * loudly here rather than folded into one tidy row, because folding would hide the fault.
 *
 * #875 UPDATE (2026-09-20): the REGISTRY half now exists. Every materialised combination gets a
 * stable id automatically (source 'auto') and the owner can name it; a part edit shows as DRIFT
 * against the accepted definition until re-accepted. The derived view below stays pure — names
 * live in `/api/scoring/strategy-registry`, never in the content key.
 */

import { useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiPatch } from '../core/api/client';
import { noticeFromError } from '../core/notices/from-error.js';
import NoticeBlock from '../components/NoticeBlock';
import TypeTag from '../components/TypeTag';
import { StrategyBots, StrategyWarnings, DriftNote } from '../components/StrategyBits';
import { useStrategyRegistry } from '../hooks/useStrategyRegistry';
import LoadingSkeleton from '../components/LoadingSkeleton';
import EmptyState from '../components/EmptyState';
import { useScrollReveal } from '../hooks/useScrollReveal';
import styles from './derived-strategies.module.css';

const API = '/api/scoring/strategies/derived';
/** #875 — the registry half: stable ids, names, drift. NEVER under /strategies/ (route collision). */
const API_REGISTRY = '/api/scoring/strategy-registry';

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

function StrategyCard({ strategy, reg, drift, editing, draft, saving, onEditStart, onDraftChange, onCancel, onSave, onReaccept }) {
  const t = strategy.treatment ?? {};
  const unreachable = strategy.unreachableBotNames ?? [];
  // A group with more than one bot name is a DUPLICATION FAULT, never a merged strategy.
  const duplicates = strategy.botNames.length > 1 ? strategy.botNames : [];

  const nameEditor = (
    <>
      <input
        className={styles.regInput}
        value={draft}
        placeholder="Strategy name"
        onChange={(e) => onDraftChange(e.target.value)}
        autoFocus
      />
      <button className={styles.regBtn} onClick={onSave} disabled={saving}>
        {saving ? 'Saving…' : 'Save'}
      </button>
      <button className={styles.regBtn} onClick={onCancel}>Cancel</button>
    </>
  );

  return (
    <li
      className={[
        styles.card,
        strategy.active ? styles.cardActive : '',
        unreachable.length || duplicates.length ? styles.cardUnreachable : '',
      ].filter(Boolean).join(' ')}
    >
      <div className={styles.cardHead}>
        {/* The stable identity — the "ID along with the IDs of each part" (#876/#875). */}
        <code className={styles.key} title="SHA-256 over protocol + role + market + broker + treatment.">
          {strategy.strategyKey}
        </code>
        <span className={styles.protocol}>{strategy.protocolIds.join(' + ')}<TypeTag kind="proto" /></span>
        {strategy.protocolRoles.map((r) => (
          <span className={styles.role} key={r}>{r}</span>
        ))}
        {/* The market — part of the configuration, so it belongs in the header, not a footnote. */}
        <span className={styles.scope}>
          {strategy.symbols.map((s) => (
            <span className={styles.symbol} key={s}>{s}</span>
          ))}
        </span>
      </div>

      {/* #875 — the registered identity: a name + a stable id. NEVER the content key. */}
      {reg ? (
        <div className={styles.regBar}>
          <span className={styles.regName}>{reg.name || 'Unnamed'}<TypeTag kind="strategy" /></span>
          <span
            className={styles.regBadge}
            title={reg.source === 'auto'
              ? 'Auto-registered: this combination materialised (a live bot) and got a stable id.'
              : 'Registered by the owner.'}
          >
            {reg.source === 'auto' ? 'auto id' : 'registered'}
          </span>
          <code className={styles.regId} title={`Stable id (never changes): ${reg.id}`}>{reg.id.slice(0, 8)}</code>
          {editing ? nameEditor : (
            <button className={styles.regBtn} onClick={() => onEditStart(reg.name ?? '')}>Rename</button>
          )}
        </div>
      ) : unreachable.length > 0 && unreachable.length >= strategy.botNames.length ? (
        // #875 — the registry refuses to mint a name for a combination with no live bot
        // (a name for something that can never trade is noise). The card must not offer the
        // button and then 400: say why it cannot be named instead.
        <div className={styles.regBar}>
          <span
            className={styles.regId}
            title="Registration needs one ACTIVE bot on this exact combination. This one can never trade (see the warning below), so there is nothing to name yet."
          >
            Not registered — no reachable bot
          </span>
        </div>
      ) : (
        <div className={styles.regBar}>
          <span className={styles.regId}>Not registered</span>
          {editing ? nameEditor : (
            <button className={styles.regBtn} onClick={() => onEditStart('')}>Register / Name…</button>
          )}
        </div>
      )}

      {/* #875 — drift: this card IS the current configuration of a registered strategy whose parts
          changed. The name survives (it is pinned to the id, not the key); the owner re-accepts or
          edits the bot back. Shared component — the A/B Strategies page renders the same note
          READ-ONLY (it passes no onReaccept). */}
      <DriftNote drift={drift} onReaccept={onReaccept} saving={saving} />

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

      <StrategyBots names={strategy.botNames} />

      <StrategyWarnings botNames={strategy.botNames} unreachableBotNames={strategy.unreachableBotNames} />
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

  // #875 — the registry half (shared hook: the A/B Strategies page reads the same overlay, so the
  // two surfaces cannot disagree about a name or a drift status). A failure must NOT blank the
  // derived list — the hook swallows it into an empty overlay and cards simply show "Not registered".
  const registry = useStrategyRegistry();

  const queryClient = useQueryClient();
  const [editingKey, setEditingKey] = useState(null);
  const [draft, setDraft] = useState('');
  const [savingKey, setSavingKey] = useState(null);
  // #875 — a NOTICE, not a string: the notices gate (scripts/validate-notices.cjs) fails the build
  // on a raw error render, and a hard-coded message cannot carry cause/action.
  const [actionNotice, setActionNotice] = useState(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['strategies', 'derived'] });
    queryClient.invalidateQueries({ queryKey: ['strategies', 'registry'] });
  };

  /** Name (or re-name). A name pins to the STABLE id; renaming never mints a second strategy. */
  const handleSave = async (strategy, reg) => {
    const name = draft.trim();
    if (!name) return;
    setSavingKey(strategy.strategyKey);
    setActionNotice(null);
    try {
      if (reg) await apiPatch(`${API_REGISTRY}/${reg.id}`, { name });
      else await apiPost(API_REGISTRY, { strategyKey: strategy.strategyKey, name });
      setEditingKey(null);
      setDraft('');
      invalidate();
    } catch (e) {
      setActionNotice(noticeFromError(e, 'TCS-SYS-007', { operation: 'save the strategy name' }));
    } finally {
      setSavingKey(null);
    }
  };

  /** Drift resolution: accept this card's current configuration as the registered definition. */
  const handleReaccept = async (row) => {
    setSavingKey(row?.current?.strategyKey ?? row?.id ?? null);
    setActionNotice(null);
    try {
      await apiPost(`${API_REGISTRY}/${row.id}/reaccept`);
      invalidate();
    } catch (e) {
      setActionNotice(noticeFromError(e, 'TCS-SYS-007', { operation: 're-accept the strategy definition' }));
    } finally {
      setSavingKey(null);
    }
  };

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
  //
  // ⚠️ TCS-SYS-002 rather than a raw `error.message`. The notices gate (scripts/validate-notices.cjs)
  // fails the build on an undeclared raw error render, because an ad-hoc string has no stable
  // identity — wording may change, a code must not.
  if (isError) {
    const notice = noticeFromError(error, 'TCS-SYS-002', { operation: 'load derived strategies' });
    return (
      <div className={styles.page} ref={revealRef}>
        <div className={styles.error}>
          <strong>{notice.title}</strong> {notice.message}
          <span className={styles.errorHint}>
            {notice.action ? `${notice.action} ` : ''}The derivation runs on the server, so nothing has
            been changed or deleted.
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
          A strategy is a bot's whole configuration — <code>protocol</code> + <code>role</code> +{' '}
          <code>market</code> + <code>broker</code> + execution policy. <strong>Any difference is a
          different strategy</strong>, because no single setting can be dismissed. There is therefore
          one strategy per bot, and a different market is a different strategy. Derived live from the
          META.Stack pipeline, not stored.
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
        <div
          className={`${styles.stat} ${(data?.duplicateGroups ?? 0) > 0 ? styles.statAlert : ''}`}
        >
          <span className={styles.statValue}>{data?.duplicateGroups ?? 0}</span>
          <span
            className={styles.statLabel}
            title="Bots identical on protocol, role, market, broker and treatment. The owner's rule: these should never exist."
          >
            duplicates
          </span>
        </div>
        {registry.unmaterialised > 0 && (
          <div className={`${styles.stat} ${styles.statAlert}`}>
            <span className={styles.statValue}>{registry.unmaterialised}</span>
            <span
              className={styles.statLabel}
              title="Registered strategies whose bots no longer derive anything (deleted or unlinked). Their names are kept."
            >
              unmaterialised
            </span>
          </div>
        )}
      </div>

      {actionNotice && <NoticeBlock notice={actionNotice} compact />}

      {strategies.length === 0 ? (
        <EmptyState
          icon="🧩"
          title="No strategies"
          description="No bot is linked to a protocol, so no strategy exists yet. Create a bot or add a protocol subscription."
        />
      ) : (
        <ul className={styles.list}>
          {strategies.map((s) => (
            <StrategyCard
              key={s.strategyKey}
              strategy={s}
              reg={registry.byKey.get(s.strategyKey) ?? null}
              drift={registry.driftByCurrentKey.get(s.strategyKey) ?? null}
              editing={editingKey === s.strategyKey}
              draft={draft}
              saving={savingKey === s.strategyKey}
              onEditStart={(initial) => {
                setEditingKey(s.strategyKey);
                setDraft(initial);
              }}
              onDraftChange={setDraft}
              onCancel={() => {
                setEditingKey(null);
                setDraft('');
              }}
              onSave={() => handleSave(s, registry.byKey.get(s.strategyKey) ?? null)}
              onReaccept={() => handleReaccept(registry.driftByCurrentKey.get(s.strategyKey))}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
