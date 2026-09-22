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
 * ⚠️ THE SYMBOL IS THE CONSTANT (owner, 2026-09-22): *"A/B testing of strategies is not meant to be
 * different symbols... The symbol is the one thing that isn't to change when we copy a strategy for
 * A/B testing."* A pair must therefore trade the SAME market: what varies between a strategy and
 * its copy is the playbook (protocol / timeframe / execution policy), never the symbol. Two
 * strategies on DIFFERENT symbols are independent — framing them as "A vs B" would claim a copy
 * lineage that does not exist — so a cross-symbol link is REFUSED with the reason, never silently
 * swapped for another pair and never rendered as one. Measured 2026-09-22 on the DERIVED payload
 * (the set this page reads): 27 strategies, and exactly two symbols carry more than one — XAUUSD,
 * four live Gold strategies (m5 / m15 / 1h / 4h), and EURUSD, whose only second strategy is an
 * inactive control with no routing subscription (#874). The seed prefers a same-symbol pair where
 * BOTH sides are active.
 *
 * ⚠️ THE PAIR IS DATA, NOT A CONTROL (same rule as the A/B Ladder). No pickers live here: the pair
 * arrives via `?pair=<keyA>,<keyB>` (full `strategyKey` or an 8+ character PREFIX — the UI only
 * ever shows the first 8 characters, so links should not need more), else the persisted last pair,
 * else a same-symbol seed.
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
import { Link, useSearchParams } from 'react-router-dom';
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
/** #929 — the official A/B test runner (see ab-test.controller.ts) + snapshot configs. */
const API_TESTS = '/api/automation/ab-tests';
const API_SNAPSHOTS = `${API_TESTS}/snapshots`;
const API_METASTACKS = '/api/scoring/metastacks';

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

/** sameSymbolSet — the A/B invariant: both sides trade the same market(s). */
function sameSymbolSet(a, b) {
  if (!a?.symbols?.length || !b?.symbols?.length) return false;
  return listKey(a.symbols) === listKey(b.symbols);
}

/**
 * pickSeedPair — the default pair. The invariant is the symbol; given that, the seed prefers a
 * group with two ACTIVE strategies — a pair you could actually run — before falling back to the
 * first same-symbol group, then to null when no symbol carries two strategies at all.
 * Measured 2026-09-22: XAUUSD has four live Gold strategies, so it seeds; EURUSD's only second
 * strategy is an inactive control that can never trade (#874).
 */
function pickSeedPair(strategies) {
  const groups = new Map();
  for (const s of strategies) {
    const g = listKey(s.symbols);
    groups.set(g, [...(groups.get(g) ?? []), s]);
  }
  const multi = [...groups.values()].filter((g) => g.length > 1);
  const group = multi.find((g) => g.filter((s) => s.active).length > 1) ?? multi[0];
  if (!group) return null;
  const pool = group.filter((s) => s.active).length > 1 ? group.filter((s) => s.active) : group;
  const sorted = [...pool].sort((x, y) => x.strategyKey.localeCompare(y.strategyKey));
  return { a: sorted[0].strategyKey, b: sorted[1].strategyKey };
}

/** fmtDuration — "3d 4h" / "5h 12m" / "8m". The running age of a test, for the data-period question. */
function fmtDuration(ms) {
  if (ms == null || ms < 0) return '—';
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/**
 * fmtCfg — one snapshot-config value for display.
 * ⚠️ `null` is a VALUE in these configs (an explicitly unset field), never a blank: it renders
 * as `—` WITH a title saying so, so "unset" cannot be misread as "failed to load".
 */
function fmtCfg(v) {
  if (v === undefined) return { text: '—', title: 'absent from this snapshot' };
  if (v === null) return { text: '—', title: 'null — explicitly unset in this snapshot' };
  if (typeof v === 'string') return { text: v, title: null };
  if (typeof v === 'boolean' || typeof v === 'number') return { text: String(v), title: null };
  return { text: JSON.stringify(v), title: null };
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
            {/* market cannot differ for an ACCEPTED pair (same-symbol invariant, 2026-09-22) —
                the ≠ is kept as a guard so a later pairing-rule change cannot silently hide one. */}
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

/**
 * TestSide — one side of an OFFICIAL A/B test (#929): a MetaStack snapshot and its config, and,
 * for the variant, the RECORDED change — "what was changed in B".
 *
 * ⚠️ DECLARATION VS MEASUREMENT. The change log is the AUTHOR's declaration (named keys + their
 * note, which is the hypothesis). The two snapshot exports are the MEASUREMENT (the configs as
 * they actually are, right now). Both are rendered, and a measured difference the log does not
 * name is flagged — an unrecorded change is exactly the silent divergence this repo keeps
 * paying for, so it is stated rather than smoothed over.
 */
function TestSide({ side, label, snap, change, cfg, actualDiffs, recordedKeys }) {
  const isVariant = side === 'b';
  const unrecorded = isVariant && actualDiffs
    ? actualDiffs.filter((d) => !recordedKeys.includes(d.key))
    : [];

  return (
    <article className={`${styles.col} ${side === 'a' ? styles.colA : styles.colB}`}>
      <header className={styles.colHead}>
        <span className={styles.letter} aria-hidden="true">{side.toUpperCase()}</span>
        <div className={styles.ident}>
          <span className={styles.name}>{cfg?.name || 'Unnamed'}</span>
          {snap ? (
            <>
              <span className={styles.source}>
                {label} · version {snap.version}{snap.createdBy ? ` · ${snap.createdBy}` : ''}
              </span>
              <code className={styles.key} title={`Snapshot id ${snap.id} · scoring strategy ${snap.scoringStrategyId}`}>
                {String(snap.id).slice(0, 8)}
              </code>
            </>
          ) : (
            <span className={styles.source}>snapshot not found for this side</span>
          )}
        </div>
      </header>

      {isVariant && (
        <div className={styles.changeBlock}>
          <span className={styles.changeTitle}>What changed in B</span>
          {change ? (
            <>
              {change.details?.note && <p className={styles.changeNote}>“{change.details.note}”</p>}
              <ul className={styles.changeList}>
                {(change.details?.changedKeys ?? []).map((k) => {
                  const measured = actualDiffs?.find((d) => d.key === k);
                  return (
                    <li key={k}>
                      <code>{k}</code>
                      {measured
                        ? <> — {measured.from} → <strong>{measured.to}</strong></>
                        : ' — recorded, but the exports could not be compared'}
                    </li>
                  );
                })}
              </ul>
              <span className={styles.changeMeta}>
                {change.summary} · {new Date(change.createdAt).toLocaleString()}
              </span>
            </>
          ) : (
            <p className={styles.changeNote}>No change recorded for this snapshot.</p>
          )}
          {unrecorded.length > 0 && (
            <p className={styles.changeWarn}>
              ⚠️ {unrecorded.length} difference{unrecorded.length === 1 ? '' : 's'} not named in the
              change log: {unrecorded.map((d) => d.key).join(', ')}.
            </p>
          )}
        </div>
      )}

      {cfg ? (
        <>
          <div className={styles.treatmentHead}>snapshot config</div>
          <div className={styles.treatment}>
            {Object.keys(cfg).sort().map((k) => {
              const value = fmtCfg(cfg[k]);
              const diff = actualDiffs?.find((d) => d.key === k);
              return (
                <div className={styles.field} key={k}>
                  <span className={styles.fieldLabel}>{k}</span>
                  <span className={styles.fieldValue}>
                    {diff && <Neq title={`${k} differs — A: ${diff.from} · B: ${diff.to}`} />}
                    <span title={value.title ?? undefined}>{value.text}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <span className={styles.source}>config not loaded yet</span>
      )}
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

  // The seed is also the "open this pair instead" pointer when a cross-symbol link is refused.
  const seed = useMemo(() => pickSeedPair(strategies), [strategies]);

  /** labelFor — best available human name for a strategyKey (registry name, else its first bot). */
  const labelFor = (key) => registry.byKey.get(key)?.name
    ?? strategies.find((s) => s.strategyKey === key)?.botNames?.[0]
    ?? key.slice(0, 8);

  // ── The pair: URL → persisted → same-symbol seed (same resolution order as the A/B Ladder) ──
  const [pair, setPair] = usePersistentState('abstrategies:pair', { a: null, b: null, seeded: false });

  const [searchParams] = useSearchParams();
  const pairParam = searchParams.get('pair') || '';

  // The URL pair, resolved once. Unknown / ambiguous keys stay ignored in SILENCE (a stale link
  // must not blank the view) — but a pair that resolves onto DIFFERENT symbols is a third case:
  // it is a symbol comparison, not an A/B, so it is kept here and refused OUT LOUD in the render.
  const urlPair = useMemo(() => {
    if (!pairParam || strategies.length === 0) return null;
    const [rawA, rawB] = pairParam.split(',').map((s) => s.trim());
    const a = resolveKey(rawA, strategies);
    const b = resolveKey(rawB, strategies);
    if (!a || !b || a === b) return null;
    const sa = strategies.find((s) => s.strategyKey === a);
    const sb = strategies.find((s) => s.strategyKey === b);
    return {
      a,
      b,
      sameSymbol: sameSymbolSet(sa, sb),
      symbolsA: sa.symbols ?? [],
      symbolsB: sb.symbols ?? [],
    };
  }, [pairParam, strategies]);

  useEffect(() => {
    // Only a same-symbol pair is adopted as THE pair; a cross-symbol link never becomes one.
    if (!urlPair?.sameSymbol) return;
    if (pair.a === urlPair.a && pair.b === urlPair.b) return;
    setPair({ a: urlPair.a, b: urlPair.b, seeded: true });
  }, [urlPair, pair.a, pair.b, setPair]);

  useEffect(() => {
    if (strategies.length < 2) return;
    const byKey = new Map(strategies.map((s) => [s.strategyKey, s]));
    let a = byKey.get(pair.a) ?? null;
    let b = byKey.get(pair.b) ?? null;
    // Reconcile against THE ONE INVARIANT: a valid pair trades the same symbol. This also replaces
    // a pair persisted before the rule existed — the old seed paired by shared protocol, so
    // AUDJPY vs AUDUSD (a symbol comparison) could be stored as "the pair".
    if (!(a && b && sameSymbolSet(a, b))) {
      a = seed ? byKey.get(seed.a) ?? null : null;
      b = seed ? byKey.get(seed.b) ?? null : null;
    }
    const keyA = a?.strategyKey ?? null;
    const keyB = b?.strategyKey ?? null;
    if (keyA !== pair.a || keyB !== pair.b || pair.seeded !== true) {
      setPair({ a: keyA, b: keyB, seeded: true });
    }
  }, [strategies, seed, pair, setPair]);

  // ── Official A/B test mode (?test=<id>, #929). Read-only; every endpoint already exists. ──
  const testIdParam = searchParams.get('test') || '';
  const testsQuery = useQuery({
    queryKey: ['ab-tests'],
    queryFn: () => apiGet(API_TESTS),
    staleTime: 30_000,
  });
  const tests = testsQuery.data ?? [];
  // Exact id, or a unique prefix (same courtesy as ?pair=).
  const test = testIdParam
    ? (tests.find((t) => t.id === testIdParam)
      ?? (tests.filter((t) => t.id.startsWith(testIdParam)).length === 1
        ? tests.find((t) => t.id.startsWith(testIdParam))
        : null))
    : null;
  const runningTest = tests.find((t) => t.status === 'running') ?? null;

  const snapshotsQuery = useQuery({
    queryKey: ['ab-test-snapshots'],
    queryFn: () => apiGet(API_SNAPSHOTS),
    staleTime: 30_000,
    enabled: !!test,
  });
  const snapshots = snapshotsQuery.data ?? [];
  const controlSnap = test ? snapshots.find((s) => s.id === test.controlStackId) ?? null : null;
  const variantSnap = test ? snapshots.find((s) => s.id === test.variantStackId) ?? null : null;

  // The AUTHORED "what changed in B" — #929 writes a named change-log entry for the variant
  // (summary + changedKeys + the author's note, which is the hypothesis under test).
  const versionsQuery = useQuery({
    queryKey: ['metastack-versions', variantSnap?.scoringStrategyId],
    queryFn: () => apiGet(`${API_METASTACKS}/${variantSnap.scoringStrategyId}/versions`),
    staleTime: 30_000,
    enabled: !!variantSnap,
  });
  const variantChange = variantSnap
    ? (versionsQuery.data?.changeLogs ?? []).find((l) => l.toVersion === variantSnap.version) ?? null
    : null;
  const recordedKeys = variantChange?.details?.changedKeys ?? [];

  // The MEASUREMENT — both snapshot exports, diffed key by key. Declaration vs reality: the log
  // says what was INTENDED, these two say what IS. Disagreement is reported, not smoothed over.
  const ctlExportQuery = useQuery({
    queryKey: ['snapshot-export', controlSnap?.scoringStrategyId, controlSnap?.id],
    queryFn: () => apiGet(`${API_METASTACKS}/${controlSnap.scoringStrategyId}/export/${controlSnap.id}`),
    staleTime: 300_000,
    enabled: !!controlSnap,
  });
  const varExportQuery = useQuery({
    queryKey: ['snapshot-export', variantSnap?.scoringStrategyId, variantSnap?.id],
    queryFn: () => apiGet(`${API_METASTACKS}/${variantSnap.scoringStrategyId}/export/${variantSnap.id}`),
    staleTime: 300_000,
    enabled: !!variantSnap,
  });
  const ctlCfg = ctlExportQuery.data?.snapshot ?? null;
  const varCfg = varExportQuery.data?.snapshot ?? null;

  const actualDiffs = useMemo(() => {
    if (!ctlCfg || !varCfg) return null;
    const keys = [...new Set([...Object.keys(ctlCfg), ...Object.keys(varCfg)])].sort();
    return keys
      .filter((k) => JSON.stringify(ctlCfg[k] ?? null) !== JSON.stringify(varCfg[k] ?? null))
      .map((k) => ({ key: k, from: fmtCfg(ctlCfg[k]).text, to: fmtCfg(varCfg[k]).text }));
  }, [ctlCfg, varCfg]);

  // Which pair renders: a VALID url pair wins immediately (the columns must never flash the
  // persisted pair first); a refused cross-symbol link is handled by its own branch below.
  const strategyA = strategies.find((s) => s.strategyKey === (urlPair?.sameSymbol ? urlPair.a : pair.a)) ?? null;
  const strategyB = strategies.find((s) => s.strategyKey === (urlPair?.sameSymbol ? urlPair.b : pair.b)) ?? null;

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
            sides spelled out in its tooltip. A pair must trade ONE symbol — the symbol is the
            constant in an A/B (what changes between a strategy and its copy is the playbook, not
            the market) — so a link pairing two different symbols is refused rather than shown. The
            pair comes from the URL (?pair=keyA,keyB — the first 8 characters of each strategyKey
            are enough) or the last pair viewed; it is set by whatever owns A/B pairing, not on
            this page. An OFFICIAL test opens with
            ?test=&lt;id&gt;: it shows when the test started, how long it has run, and what was
            changed in B — both as the change log recorded it (with the author&apos;s note) and as
            the two snapshot configs actually differ.
          </PageInfoPopover>
        </h1>
      </header>

      {testIdParam ? (
        !test ? (
          <EmptyState
            icon="🧪"
            title="No such A/B test"
            description={testsQuery.isLoading
              ? 'Loading tests…'
              : `No test matches “${testIdParam}”. Drop ?test= for strategy pairs, or pass a full id.`}
          />
        ) : (
          <>
            <div className={styles.testHead}>
              <span className={styles.testName}>{test.name}</span>
              <span className={`${styles.status} ${test.status === 'running' ? styles.statusOn : ''}`}>
                {test.status}
              </span>
              <span className={styles.testMeta}>
                {test.startAt ? `started ${new Date(test.startAt).toLocaleString()}` : 'not started'}
                {test.startAt && !test.endAt
                  ? ` · running ${fmtDuration(Date.now() - new Date(test.startAt).getTime())}`
                  : ''}
                {test.endAt ? ` · ended ${new Date(test.endAt).toLocaleString()}` : ''}
              </span>
              <span className={styles.testMeta}>
                {(test.symbols ?? []).map((s) => (
                  <span className={`${styles.chip} ${styles.chipMono}`} key={s}>{s}</span>
                ))}
              </span>
            </div>
            <div className={styles.columns}>
              <TestSide
                side="a"
                label="control"
                snap={controlSnap}
                cfg={ctlCfg}
                actualDiffs={actualDiffs}
                recordedKeys={recordedKeys}
              />
              <TestSide
                side="b"
                label="variant"
                snap={variantSnap}
                change={variantChange}
                cfg={varCfg}
                actualDiffs={actualDiffs}
                recordedKeys={recordedKeys}
              />
            </div>
          </>
        )
      ) : (
        <>
          {runningTest && (
            <div className={styles.official}>
              <span aria-hidden="true">◉</span>{' '}
              Official A/B test running: <strong>{runningTest.name}</strong>
              {runningTest.startAt
                ? ` · started ${new Date(runningTest.startAt).toLocaleDateString()} · ${fmtDuration(Date.now() - new Date(runningTest.startAt).getTime())} in`
                : ''}
              {' · '}
              <Link className={styles.officialLink} to={`/trading/ab-strategies?test=${runningTest.id}`}>
                view what changed in B →
              </Link>
            </div>
          )}
          {urlPair && !urlPair.sameSymbol ? (
            <div className={styles.refused}>
              <strong className={styles.refusedTitle}>
                Not an A/B pair — A trades {urlPair.symbolsA.join(', ')} · B trades {urlPair.symbolsB.join(', ')}.
              </strong>
              <p className={styles.refusedBody}>
                An A/B pair holds the symbol constant: what changes between a strategy and its copy
                is the playbook (protocol, timeframe, execution policy), never the market. Two
                strategies on different symbols are independent — reading them as “A vs B” would
                claim a copy link that does not exist.
              </p>
              {seed && (
                <p className={styles.refusedBody}>
                  Open the {strategies.find((s) => s.strategyKey === seed.a)?.symbols.join(', ')} A/B pair:{' '}
                  <Link className={styles.officialLink} to={`/trading/ab-strategies?pair=${seed.a},${seed.b}`}>
                    {labelFor(seed.a)} vs {labelFor(seed.b)} →
                  </Link>
                </p>
              )}
            </div>
          ) : !strategyA || !strategyB ? (
        <EmptyState
          icon="🆚"
          title="No pair to show"
          description={seed
            ? 'This page compares two derived strategies. A link such as ?pair=<keyA>,<keyB> — the first 8 characters of each strategyKey — selects a pair directly.'
            : 'No two strategies trade the same symbol, and an A/B pair holds the symbol constant — so there is nothing to pair yet. Copy a strategy and change something other than the symbol to create one.'}
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
        </>
      )}
    </div>
  );
}
