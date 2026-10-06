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
import { apiGet, apiPost, apiPatch, apiDelete } from '../core/api/client';
import { noticeFromError } from '../core/notices/from-error.js';
// ⚠️ A SUCCESS is a notice too. A hard-coded "Copied!" string would have no code, no docs link
// and no locale entry — the notices gate (`scripts/validate-notices.cjs`) fails the build on a
// raw message render, and rightly: wording may change, a code must not.
import { notice } from '../core/notices/registry.js';
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

function StrategyCard({ strategy, reg, drift, editing, draft, saving, onEditStart, onDraftChange, onCancel, onSave, onReaccept, onDuplicate, onDelete, busy, copiedFromName, copiedToNames }) {
  const t = strategy.treatment ?? {};
  const unreachable = strategy.unreachableBotNames ?? [];
  // A group with more than one bot name is a DUPLICATION FAULT, never a merged strategy.
  const duplicates = strategy.botNames.length > 1 ? strategy.botNames : [];
  // Actions address ONE bot. A duplicate group (>1 bot on one key) has no single subject, so it
  // must be resolved first rather than guessing which bot the operator meant.
  const botId = strategy.botIds.length === 1 ? strategy.botIds[0] : null;
  // Two-step delete: the first click only arms the confirm. Nothing is removed until the second
  // click names the bot explicitly — a destructive action should cost two deliberate clicks.
  const [confirmDelete, setConfirmDelete] = useState(false);
  /**
   * Accordion state — owner, Page Walkthrough: *"Reduce the initial size of the containers and turn
   * them into accordions."* (2026-10-01, applied 2026-10-06).
   *
   * ⚠️ WHAT DELIBERATELY STAYS VISIBLE WHEN COLLAPSED, and why it is not simply "everything below the
   * header":
   *   • the REGISTERED NAME — the human handle for the strategy. Collapsing it would leave a card
   *     identifiable only by a SHA-256 key.
   *   • the DRIFT NOTE and the unreachable/duplicate marker — these are FAULTS. A card with a problem
   *     must not look identical to a healthy one just because it is collapsed; that is the "plausible
   *     output, no error" shape this codebase keeps having to undo.
   * Everything that is REFERENCE rather than identity — treatment fields, symbol chips, bot lists and
   * the action row — is what collapses.
   */
  const [expanded, setExpanded] = useState(false);

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
      <div
        className={styles.cardHead}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        style={{ cursor: 'pointer' }}
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setExpanded((v) => !v);
          }
        }}
      >
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
        {/* ⚠️ FAULTS STAY VISIBLE WHEN COLLAPSED. Without this a collapsed broken card and a collapsed
            healthy one are indistinguishable — see the note on `expanded` above. */}
        {(unreachable.length > 0 || duplicates.length > 0) && (
          <span
            title={`${unreachable.length ? `${unreachable.length} unreachable bot(s)` : ''}${unreachable.length && duplicates.length ? ' · ' : ''}${duplicates.length ? `${duplicates.length} duplicate(s)` : ''}`}
          >
            ⚠️
          </span>
        )}
        <span aria-hidden="true" style={{ marginLeft: 'auto', opacity: 0.6 }}>
          {expanded ? '▾' : '▸'}
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

      {expanded && (
        <>
      {/* A/B LINEAGE (2026-09-22). Both directions are shown because the pair is a symmetric
          fact: the COPY says who it came from, the SOURCE says what was copied from it. The
          link is read from TradingStrategy.duplicatedFromId (bot level) and
          Protocol.derivedFrom (protocol level) — never inferred from names. */}
      {(copiedFromName || (copiedToNames?.length ?? 0) > 0) && (
        <div className={styles.lineage}>
          {copiedFromName && (
            <span
              className={styles.lineageTag}
              title="This bot was copied from its pair partner (a new protocol, a new bot — nothing is shared)."
            >
              B of a pair — copy of <strong>{copiedFromName}</strong>
            </span>
          )}
          {(copiedToNames?.length ?? 0) > 0 && (
            <span
              className={styles.lineageTag}
              title="A copy of this strategy exists: its own protocol and bot, so editing either side cannot change the other."
            >
              A of a pair — copied to <strong>{copiedToNames.join(', ')}</strong>
            </span>
          )}
        </div>
      )}

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

      {/* ACTIONS. Duplicate copies the BOT and the PROTOCOL (a complete, independent
          configuration that starts INACTIVE); delete refuses while the bot is active. Both
          address a single bot, so a duplicate group shows them disabled with the reason. */}
      <div className={styles.cardActions}>
        <button
          className={styles.actionBtn}
          disabled={!botId || busy}
          title={botId
            ? 'Copy this bot AND its protocol as the B of a new A/B pair. The copy starts inactive, so activating it is a deliberate step.'
            : 'This key holds more than one bot (a duplication fault) — actions address one bot, so resolve the duplicate first.'}
          onClick={() => onDuplicate(strategy)}
        >
          {busy ? 'Working…' : 'Duplicate as B'}
        </button>
        {confirmDelete ? (
          <>
            <button
              className={styles.actionBtnDanger}
              disabled={busy}
              title="Removes the bot, its subscriptions, its protocol copy and any watchlist it owns. Trades and logs are kept."
              onClick={() => {
                setConfirmDelete(false);
                onDelete(strategy);
              }}
            >
              Confirm delete — {strategy.botNames[0]}
            </button>
            <button className={styles.actionBtn} disabled={busy} onClick={() => setConfirmDelete(false)}>
              Cancel
            </button>
          </>
        ) : (
          <button
            className={styles.actionBtnGhost}
            disabled={!botId || busy}
            title={botId
              ? 'Delete this bot. Refused while it is active — deactivate first.'
              : 'This key holds more than one bot (a duplication fault) — actions address one bot, so resolve the duplicate first.'}
            onClick={() => setConfirmDelete(true)}
          >
            Delete…
          </button>
        )}
      </div>
        </>
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

  /**
   * A/B lineage (2026-09-22) — resolve `copiedFromBotIds` BOTH ways from the SAME list, so a
   * pair renders consistently on the two cards that form it.
   *
   * ⚠️ RESOLVED, NOT ASSUMED: a pointer whose source is gone (deleted, or filtered out) resolves
   * to null rather than to a blank or a raw id. An orphan lineage claim would be worse than none
   * — the delete flow clears pointers on the surviving side, and this is what a cleared one looks
   * like on screen. The name shown IS the source strategy's current bot name, which is why the
   * pair stays legible after a rename.
   */
  const lineage = useMemo(() => {
    const byBotId = new Map();
    for (const s of strategies) for (const id of s.botIds) byBotId.set(id, s);

    const map = new Map();
    for (const s of strategies) {
      const from = (s.copiedFromBotIds ?? []).map((id) => byBotId.get(id)).filter(Boolean);
      map.set(s.strategyKey, {
        copiedFromName: from[0]?.botNames?.[0] ?? null,
        copiedToNames: [],
      });
    }
    // Reverse direction — "who was copied from me".
    for (const s of strategies) {
      for (const id of s.copiedFromBotIds ?? []) {
        const source = byBotId.get(id);
        const entry = source ? map.get(source.strategyKey) : null;
        if (entry) entry.copiedToNames.push(s.botNames[0]);
      }
    }
    return map;
  }, [strategies]);

  // #875 — the registry half (shared hook: the A/B Strategies page reads the same overlay, so the
  // two surfaces cannot disagree about a name or a drift status). A failure must NOT blank the
  // derived list — the hook swallows it into an empty overlay and cards simply show "Not registered".
  const registry = useStrategyRegistry();

  const queryClient = useQueryClient();
  const [editingKey, setEditingKey] = useState(null);
  const [draft, setDraft] = useState('');
  const [savingKey, setSavingKey] = useState(null);
  // ⚠️ SEPARATE from `savingKey`: a rename and a duplicate can be in flight on two different
  // cards, and sharing one flag would freeze the wrong card's buttons.
  const [busyKey, setBusyKey] = useState(null);
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

  /**
   * duplicate() — create the B of a new A/B pair.
   *
   * ONE call, because the SERVER owns the record set: it copies the protocol (groups, entries,
   * symbol wiring, watchlist), creates the bot, subscribes it and links both lineage fields. A
   * client-side sequence of requests could half-succeed and leave a copy with no protocol — the
   * exact partial state the endpoint's own cleanup exists to prevent. See
   * `POST /api/trading/strategies/:id/duplicate`.
   */
  const handleDuplicate = async (strategy) => {
    const botId = strategy.botIds.length === 1 ? strategy.botIds[0] : null;
    if (!botId) return;
    setBusyKey(strategy.strategyKey);
    setActionNotice(null);
    try {
      const res = await apiPost(`/api/trading/strategies/${botId}/duplicate`);
      setActionNotice(notice('TCS-TRADE-019', { name: res?.name ?? strategy.botNames[0] }));
      invalidate();
    } catch (e) {
      setActionNotice(noticeFromError(e, 'TCS-SYS-007', { operation: 'duplicate this strategy' }));
    } finally {
      setBusyKey(null);
    }
  };

  /**
   * delete() — remove a bot, guarded server-side.
   *
   * ⚠️ An ACTIVE bot comes back as HTTP 409 with code TCS-TRADE-018, which `noticeFromError`
   * renders from the server-supplied code (its first branch). That is the intended path: the
   * refusal carries its own wording and its own remedy, so this handler must not pre-empt it with
   * a client-side active check that could drift from the server's.
   */
  const handleDelete = async (strategy) => {
    const botId = strategy.botIds.length === 1 ? strategy.botIds[0] : null;
    if (!botId) return;
    setBusyKey(strategy.strategyKey);
    setActionNotice(null);
    try {
      const res = await apiDelete(`/api/trading/strategies/${botId}`);
      setActionNotice(notice('TCS-TRADE-020', {
        name: strategy.botNames[0],
        detail: res?.detail ?? '',
      }));
      invalidate();
    } catch (e) {
      setActionNotice(noticeFromError(e, 'TCS-SYS-007', { operation: 'delete this strategy' }));
    } finally {
      setBusyKey(null);
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
              onDuplicate={handleDuplicate}
              onDelete={handleDelete}
              busy={busyKey === s.strategyKey}
              copiedFromName={lineage.get(s.strategyKey)?.copiedFromName ?? null}
              copiedToNames={lineage.get(s.strategyKey)?.copiedToNames ?? []}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
