/**
 * AbStrategiesPage — two STRATEGIES, side by side, for A/B analysis.
 * =====================================================================
 * A copy of the `Strategies` page (DerivedStrategiesPage, /trading/strategies-derived) SCOPED to
 * a PAIR: side A on the left, side B on the right, each rendering that strategy's whole
 * configuration — protocol + role + market + broker + execution policy — with every value that
 * DIFFERS between the two sides marked. Owner's framing, 2026-09-22: *"the A/B view for entire
 * strategies... technically that is the most important for expert analysis later."*
 *
 * WHAT THIS PAGE IS NOT: a summary list. The Strategies page stays the place to read ONE strategy;
 * this page answers one question — "what exactly is different between these two configurations?" —
 * so the diff is the product, not a nicety.
 *
 * ⚠️ THE PAIR IS DATA, NOT A CONTROL (same rule as the A/B Ladder). No pickers live here: the pair
 * arrives via `?pair=<keyA>,<keyB>` (full `strategyKey` or an 8+ character PREFIX — the UI only
 * ever shows the first 8 characters, so links should not need more), else the persisted last pair,
 * else a seed. The seed deliberately prefers two strategies that SHARE a protocol — the
 * `forex-session-v1` family resolves 14 treatments of one protocol, and comparing two of those is
 * exactly what this page exists for.
 *
 * ⚠️ DIFFERENCE MARKING IS THE POINT. Treatment values and the protocol / role / broker / symbol
 * sets that differ between A and B carry a `≠` marker whose title spells out BOTH sides. The marker
 * is a GLYPH, never colour alone (ui-standards), so it survives colour-blind rendering.
 *
 * ⚠️ NULL IS A VALUE. `maxHoldHours: null` means "no time-stop exists" (#773) and
 * `sessionWindow: null` means "ungated" — rendered as words, never as a blank or a dash (same rule
 * as the source page). A blank would make "unlimited" indistinguishable from "failed to load",
 * the exact collapse database-seed-discipline and the source page both warn about.
 *
 * ⚠️ IDENTIFIERS WEAR THEIR TYPE (owner, same review): "strings like this not being clear as a
 * protocol or a bot or a strategy" — hence the `(proto)` / `(bot)` / `(strategy)` suffixes from
 * `TypeTag`. The same treatment was applied to the source page in the same change.
 *
 * Data: GET /api/scoring/strategies/derived (#876) + GET /api/scoring/strategy-registry (#875).
 * ⚠️ Names live ONLY in the registry overlay — the derived payload reports `name: null` on every
 * row (measured 2026-09-22), so a page that skipped the registry would show no names at all.
 */
import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { apiGet } from '../core/api/client';
import { noticeFromError } from '../core/notices/from-error.js';
import LoadingSkeleton from '../components/LoadingSkeleton';
import EmptyState from '../components/EmptyState';
import PageInfoPopover from '../components/PageInfoPopover';
import TypeTag from '../components/TypeTag';
import { StrategyBots, StrategyWarnings, DriftNote } from '../components/StrategyBits';
import { useStrategyRegistry } from '../hooks/useStrategyRegistry';
import { usePersistentState } from '../hooks/usePersistentState';
import styles from './ab-strategies.module.css';

const API = '/api/scoring/strategies/derived';

/**
 * The treatment fields, in the source page's order first, then the four it omits — this page is
 * for expert analysis, so the FULL policy is shown (the derived payload carries all 14).
 * `[label, key, nullText]` — nullText states the MEANING of null, never a blank.
 */
const TREATMENT_FIELDS = [
  ['timeframe', 'timeframe', '—'],
  ['min comp', 'minComposite', '—'],
  ['size', 'baseSize', '—'],
  ['SL %', 'slPct', '—'],
  ['TP %', 'tpPct', '—'],
  ['max hold', 'maxHoldHours', 'no limit'],
  ['session', 'sessionWindow', 'ungated'],
  ['cooldown', 'cooldownMinutes', '—'],
  ['pyramid', 'maxPyramidTiers', '—'],
  ['mode', 'mode', '—'],
  ['max pos', 'maxPositions', 'no cap'],
  ['max daily loss', 'maxDailyLoss', 'none'],
  ['rarity sizing', 'useRaritySizing', '—'],
  ['max size', 'maxSize', 'no cap'],
];

/** fmtTreatment — nulls become their meaning; arrays stored as JSON strings render as lists. */
function fmtTreatment(value, nullText) {
  if (value === null || value === undefined || value === '') return { text: nullText, isNull: true };
  if (typeof value === 'boolean') return { text: value ? 'yes' : 'no', isNull: false };
  if (typeof value === 'string' && value.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return { text: parsed.join(', '), isNull: false };
    } catch { /* not JSON — show the raw string */ }
  }
  return { text: String(value), isNull: false };
}

/** Sets compare order-insensitively — a re-ordered symbol list is not a difference. */
const listKey = (arr) => [...(arr ?? [])].map(String).sort().join('|');

/** `≠` — the difference marker. Glyph + tooltip; never colour alone. */
function Neq({ title }) {
  return <span className={styles.neq} title={title} aria-label={title}>≠</span>;
}

/**
 * resolveKey — accept the full `strategyKey` or a UNIQUE prefix (>= 8 chars recommended, fewer
 * accepted if unambiguous). Returns null for anything unknown or ambiguous, so a stale link is
 * ignored rather than guessed at.
 */
function resolveKey(input, strategies) {
  const t = String(input ?? '').trim().toLowerCase();
  if (!t) return null;
  const exact = strategies.find((s) => s.strategyKey.toLowerCase() === t);
  if (exact) return exact.strategyKey;
  const prefixed = strategies.filter((s) => s.strategyKey.toLowerCase().startsWith(t));
  return prefixed.length === 1 ? prefixed[0].strategyKey : null;
}

/** One side's column: identity, the strategy's parts, then the full treatment with diffs marked. */
function SideColumn({ side, strategy, reg, drift, peer }) {
  const t = strategy.treatment ?? {};
  const pt = peer.treatment ?? {};
  const sideLabel = side.toUpperCase();

  const partDiff = (mine, theirs) => peer && listKey(mine) !== listKey(theirs);
  const partTitle = (label, mine, theirs) => (side === 'a'
    ? `${label} differs — A: ${(mine ?? []).join(', ') || '—'} · B: ${(theirs ?? []).join(', ') || '—'}`
    : `${label} differs — A: ${(theirs ?? []).join(', ') || '—'} · B: ${(mine ?? []).join(', ') || '—'}`);

  return (
    <article className={`${styles.col} ${side === 'a' ? styles.colA : styles.colB}`}>
      <header className={styles.colHead}>
        <span className={styles.letter} aria-hidden="true">{sideLabel}</span>
        <div className={styles.ident}>
          <span className={styles.name}>
            {reg?.name || 'Unnamed'}
            <TypeTag kind="strategy" />
          </span>
          <span className={styles.source} title={reg?.source === 'auto'
            ? 'Auto-registered: this combination materialised (a live bot) and got a stable id.'
            : reg
              ? 'Registered by the owner.'
              : 'Not registered — no stable id yet.'}
          >
            {reg ? (reg.source === 'auto' ? 'auto id' : 'registered') : 'not registered'}
          </span>
          <code className={styles.key} title={`strategyKey — SHA over protocol + role + market + broker + treatment. ${strategy.strategyKey}`}>
            {strategy.strategyKey.slice(0, 8)}
          </code>
        </div>
        <span className={`${styles.status} ${strategy.active ? styles.statusOn : styles.statusOff}`}>
          {strategy.active ? 'active' : 'inactive'}
        </span>
      </header>

      <DriftNote drift={drift} />

      <div className={styles.parts}>
        <div className={styles.partRow}>
          <span className={styles.partLabel}>
            protocol
            {partDiff(strategy.protocolIds, peer.protocolIds) && (
              <Neq title={partTitle('protocol', strategy.protocolIds, peer.protocolIds)} />
            )}
          </span>
          <span className={styles.partBody}>
            {strategy.protocolIds.join(' + ')}
            <TypeTag kind="proto" />
          </span>
        </div>
        <div className={styles.partRow}>
          <span className={styles.partLabel}>
            role
            {partDiff(strategy.protocolRoles, peer.protocolRoles) && (
              <Neq title={partTitle('role', strategy.protocolRoles, peer.protocolRoles)} />
            )}
          </span>
          <span className={styles.partBody}>
            {strategy.protocolRoles.map((r) => (
              <span className={styles.chip} key={r}>{r}</span>
            ))}
          </span>
        </div>
        <div className={styles.partRow}>
          <span className={styles.partLabel}>
            broker
            {partDiff(strategy.brokers, peer.brokers) && (
              <Neq title={partTitle('broker', strategy.brokers, peer.brokers)} />
            )}
          </span>
          <span className={styles.partBody}>
            {strategy.brokers.map((b) => (
              <span className={styles.chip} key={b}>{b}</span>
            ))}
          </span>
        </div>
        <div className={styles.partRow}>
          <span className={styles.partLabel}>
            market
            {partDiff(strategy.symbols, peer.symbols) && (
              <Neq title={partTitle('market', strategy.symbols, peer.symbols)} />
            )}
          </span>
          <span className={styles.partBody}>
            {strategy.symbols.map((s) => (
              <span className={`${styles.chip} ${styles.chipMono}`} key={s}>{s}</span>
            ))}
          </span>
        </div>
      </div>

      <div className={styles.treatmentHead}>execution policy</div>
      <div className={styles.treatment}>
        {TREATMENT_FIELDS.map(([label, key, nullText]) => {
          const mine = fmtTreatment(t[key], nullText);
          const theirs = fmtTreatment(pt[key], nullText);
          const differs = peer && listKey([t[key] ?? null]) !== listKey([pt[key] ?? null]);
          const title = side === 'a'
            ? `${label} differs — A: ${mine.text} · B: ${theirs.text}`
            : `${label} differs — A: ${theirs.text} · B: ${mine.text}`;
          return (
            <div className={styles.field} key={key}>
              <span className={styles.fieldLabel}>{label}</span>
              <span className={`${styles.fieldValue} ${mine.isNull ? styles.fieldValueNull : ''}`}>
                {differs && <Neq title={title} />}
                {mine.text}
              </span>
            </div>
          );
        })}
      </div>

      <StrategyBots names={strategy.botNames} />

      <StrategyWarnings botNames={strategy.botNames} unreachableBotNames={strategy.unreachableBotNames} />
    </article>
  );
}

export default function AbStrategiesPage() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['strategies', 'derived'],
    queryFn: () => apiGet(API),
    staleTime: 30_000,
  });
  const strategies = useMemo(() => data?.strategies ?? [], [data]);

  // #875 overlay (shared hook — the Strategies list reads the same overlay, same cache key).
  // A failure there must not blank this page: names are an overlay, not the data.
  const registry = useStrategyRegistry();

  // ── The pair: URL → persisted → seed (same resolution order as the A/B Ladder) ──
  const [pair, setPair] = usePersistentState('abstrategies:pair', { a: null, b: null, seeded: false });

  const [searchParams] = useSearchParams();
  const pairParam = searchParams.get('pair') || '';
  useEffect(() => {
    if (!pairParam || strategies.length === 0) return;
    const [rawA, rawB] = pairParam.split(',').map((s) => s.trim());
    const a = resolveKey(rawA, strategies);
    const b = resolveKey(rawB, strategies);
    // Unknown or ambiguous keys are ignored in silence — a stale link must not blank the view.
    if (!a || !b || a === b) return;
    if (pair.a === a && pair.b === b) return;
    setPair({ a, b, seeded: true });
  }, [pairParam, strategies, pair.a, pair.b, setPair]);

  useEffect(() => {
    if (strategies.length < 2) return;
    const keys = new Set(strategies.map((s) => s.strategyKey));
    let a = keys.has(pair.a) ? pair.a : null;
    let b = keys.has(pair.b) ? pair.b : null;
    let seeded = pair.seeded;
    if (!seeded) {
      // Prefer two strategies that SHARE a protocol (e.g. the forex-session-v1 family) — the
      // comparison this page exists for — before falling back to the first two rows.
      const byProtocol = new Map();
      for (const s of strategies) {
        const g = s.protocolIds.join('+');
        byProtocol.set(g, [...(byProtocol.get(g) ?? []), s]);
      }
      const shared = [...byProtocol.values()].find((g) => g.length > 1);
      const [first, second] = shared ?? strategies;
      a = a ?? first.strategyKey;
      b = b ?? (second.strategyKey !== a
        ? second.strategyKey
        : strategies.find((s) => s.strategyKey !== a)?.strategyKey ?? null);
      seeded = true;
    }
    if (a && a === b) b = strategies.find((s) => s.strategyKey !== a)?.strategyKey ?? null;
    if (a !== pair.a || b !== pair.b || seeded !== pair.seeded) setPair({ a, b, seeded });
  }, [strategies, pair, setPair]);

  const strategyA = strategies.find((s) => s.strategyKey === pair.a) ?? null;
  const strategyB = strategies.find((s) => s.strategyKey === pair.b) ?? null;

  if (isLoading) {
    return (
      <div className={styles.page}>
        <LoadingSkeleton variant="card" count={2} />
      </div>
    );
  }

  if (isError) {
    const notice = noticeFromError(error, 'TCS-SYS-002', { operation: 'load the strategies to compare' });
    return (
      <div className={styles.page}>
        <div className={styles.error}>
          <strong>{notice.title}</strong> {notice.message}
          <span className={styles.errorHint}>
            {notice.action ? `${notice.action} ` : ''}The derivation runs on the server, so nothing
            has been changed or deleted.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>
          A/B Strategies
          <PageInfoPopover>
            Two strategies — a bot&apos;s whole configuration (protocol + role + market + broker +
            execution policy) — side by side. A “≠” marks every value that differs, with both
            sides spelled out in its tooltip. The pair comes from the URL (?pair=keyA,keyB — the
            first 8 characters of each strategyKey are enough) or the last pair viewed; it is set
            by whatever owns A/B pairing, not on this page.
          </PageInfoPopover>
        </h1>
      </header>

      {!strategyA || !strategyB ? (
        <EmptyState
          icon="🆚"
          title="No pair to show"
          description="This page compares two derived strategies. A link such as ?pair=<keyA>,<keyB> — the first 8 characters of each strategyKey — selects a pair directly."
        />
      ) : (
        <div className={styles.columns}>
          <SideColumn
            side="a"
            strategy={strategyA}
            reg={registry.byKey.get(strategyA.strategyKey) ?? null}
            drift={registry.driftByCurrentKey.get(strategyA.strategyKey) ?? null}
            peer={strategyB}
          />
          <SideColumn
            side="b"
            strategy={strategyB}
            reg={registry.byKey.get(strategyB.strategyKey) ?? null}
            drift={registry.driftByCurrentKey.get(strategyB.strategyKey) ?? null}
            peer={strategyA}
          />
        </div>
      )}
    </div>
  );
}
