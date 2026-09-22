/**
 * AbStrategiesPage — the A/B hub: EVERY eligible strategy pair, and each pair in detail.
 * =============================================================================
 * THREE MODES, chosen by the URL. Owner's framing, 2026-09-22: *"the view is designed to list all
 * pairs of A/B strategies... It is not a comparison for one pair"* — the LIST is the default, and
 * viewing a specific pair is the drill-down:
 *
 *   /trading/ab-strategies                     → THE LIST, grouped by symbol: every pair of two
 *                                                strategies that trade the same symbol, closest
 *                                                matches first, plus the official tests (#929).
 *   /trading/ab-strategies?pair=<keyA>,<keyB>  → ONE pair value by value: A left, B right, a `≠`
 *                                                on every field that differs.
 *   /trading/ab-strategies?test=<id>           → an OFFICIAL test: control vs variant snapshots,
 *                                                the recorded change, and the measured configs.
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
 * inactive control with no routing subscription (#874). The list ranks groups with two live
 * strategies first, and pairs by how FEW fields differ — the closest thing to a single-variable
 * change.
 *
 * ⚠️ LINKS ARE THE CONTROLS. No pickers: a pair opens from the list via `?pair=` (the list always
 * writes the full `strategyKey`; incoming links may use an 8+ character PREFIX — the UI only ever
 * shows the first 8 characters, so links should not need more). There is deliberately NO "last
 * pair" persistence: the index is the default view, so a stale pair must not hijack it.
 *
 * ⚠️ LIST | TABLE (owner, 2026-09-22). The index renders as the grouped LIST or as a TABLE of one
 * pair = two rows (A shaded `--bg-elev-2`, B plain) carrying each side's REALISED P&L from #894's
 * bot-performance attribution, orderable by the profit difference (B − A) — *"to determine the
 * best B out of ALL B's"* — and the same numbers a dashboard widget can later read. A profit cell
 * is `—` when there is no attributed record, NEVER 0; a failed fetch is a THIRD state (notice +
 * still `—`), and a pair whose sides are not both attributed has no Δ and sorts last in both
 * directions — cannot-judge must never read as worst.
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
import { Fragment, useMemo } from 'react';
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
import { usePersistentChoice } from '../hooks/usePersistentState';
import { pnlClass, pnlSign } from '../core/signal-utils.js';
import NoticeBlock from '../components/NoticeBlock';
import '../core/forms.css'; // canonical Form System (.ff-seg) — the List | Table toggle
import styles from './ab-strategies.module.css';

const API = '/api/scoring/strategies/derived';
/** #894 — realised per-bot performance; its `strategyKeys` bridge attaches P&L to a strategy. */
const API_BOT_PERF = '/api/trading/bot-performance';
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
 * pairDiffs — the labels of every field that differs between two strategies, in the order the
 * detail columns present them. Drives the list row's `≠ n` count and its tooltip, so the index
 * says HOW MUCH a pair differs before you open it.
 */
function pairDiffs(a, b) {
  const diffs = [];
  if (listKey(a.protocolIds) !== listKey(b.protocolIds)) diffs.push('protocol');
  if (listKey(a.protocolRoles) !== listKey(b.protocolRoles)) diffs.push('role');
  if (listKey(a.brokers) !== listKey(b.brokers)) diffs.push('broker');
  if (listKey(a.symbols) !== listKey(b.symbols)) diffs.push('market');
  const ta = a.treatment ?? {};
  const tb = b.treatment ?? {};
  for (const [label, key] of TREATMENT_FIELDS) {
    if (listKey([ta[key] ?? null]) !== listKey([tb[key] ?? null])) diffs.push(label);
  }
  return diffs;
}

/**
 * buildPairs — EVERY A/B-eligible pair: all combinations of two strategies trading the same symbol
 * (the symbol is the constant; the playbook is what may differ). Ordered for scanning:
 *   groups — most live strategies first (a real A/B needs both sides alive), then by symbol;
 *   pairs  — fewest differences first (the closest thing to a single-variable change), then by key.
 */
function buildPairs(strategies) {
  const groups = new Map();
  for (const s of strategies) {
    const g = listKey(s.symbols);
    groups.set(g, [...(groups.get(g) ?? []), s]);
  }
  const ranked = [...groups.values()]
    .filter((g) => g.length > 1)
    .sort((x, y) => {
      const liveX = x.filter((s) => s.active).length;
      const liveY = y.filter((s) => s.active).length;
      if (liveX !== liveY) return liveY - liveX;
      return (x[0].symbols ?? []).join(',').localeCompare((y[0].symbols ?? []).join(','));
    });
  return ranked.map((group) => {
    const rows = [];
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        const [a, b] = [group[i], group[j]].sort((x, y) => x.strategyKey.localeCompare(y.strategyKey));
        rows.push({ a, b, diffs: pairDiffs(a, b) });
      }
    }
    rows.sort((x, y) => (x.diffs.length - y.diffs.length) || x.a.strategyKey.localeCompare(y.a.strategyKey));
    return { symbol: (group[0].symbols ?? []).join(', '), count: group.length, pairs: rows };
  });
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
 * PairSide — one side of a LIST row: identity, protocol + timeframe, state. Small on purpose: the
 * index's job is to show WHICH pairs exist; the detail view shows everything.
 */
function PairSide({ side, strategy, name }) {
  return (
    <div className={`${styles.pairSide} ${side === 'a' ? styles.sideA : styles.sideB}`}>
      <div className={styles.pairTop}>
        <span className={styles.letter} aria-hidden="true">{side.toUpperCase()}</span>
        <span className={styles.pairName}>{name}</span>
        <code className={styles.key} title={`strategyKey ${strategy.strategyKey}`}>
          {strategy.strategyKey.slice(0, 8)}
        </code>
        <span className={`${styles.status} ${strategy.active ? styles.statusOn : styles.statusOff}`}>
          {strategy.active ? 'active' : 'inactive'}
        </span>
      </div>
      <span className={styles.pairMeta}>
        {strategy.protocolIds.join(' + ')}
        <TypeTag kind="proto" />
        {' · '}
        {(strategy.treatment ?? {}).timeframe ?? '—'}
      </span>
    </div>
  );
}

/**
 * PairTable — the index as a TABLE: one pair = TWO rows (A shaded, B plain) carrying each side's
 * realised record, orderable by the profit difference (B − A). Owner, 2026-09-22: *"a table... all
 * A and B rows together — two rows, slightly different shading"* + *"order by profit difference
 * between the A's and the B's in order to determine the best B out of ALL B's"*.
 *
 * ⚠️ WHAT THE P&L COLUMNS ARE — AND ARE NOT. They are REALISED closes attributed to the strategy's
 * bot by the SERVER (#894's `strategyKeys` bridge; records the server could not attribute to
 * exactly one strategy are excluded, never guessed at). Every figure carries its own honesty:
 *   - `—` NEVER means zero. "No attributed record" and "the fetch failed" are different states,
 *     told apart by the tooltip (philosophy §7); the note under the table states the rule.
 *   - Δ exists only when BOTH sides have a record. A half-comparable pair has no Δ and sorts LAST
 *     — cannot-judge must never read as "worst".
 *   - `n` sits beside every figure because it stops +$41.66 on ONE close reading like an edge —
 *     every current record is `noise` by #894's own floor of 30 samples.
 */
function PairTable({ pairs, labelFor, sortDir, onToggleSort, perf, perfFailed }) {
  const recTitle = (rec) => {
    if (perfFailed) {
      return 'Bot performance could not be loaded — this cell cannot be judged, which is not the same as zero.';
    }
    if (!rec) return 'No realised trades are attributed to this strategy yet — nothing to read, not a zero (#894).';
    const parts = rec.entries.map((e) => (
      `${e.name}: ${pnlSign(e.pnl)} over ${e.samples} closed trade(s) in ${e.days} day(s) · reliability ${e.reliability}`
    ));
    return parts.join(' · ')
      + (rec.entries.length > 1 ? ` · sum of ${rec.entries.length} bot record(s)` : '');
  };

  const deltaTitle = (p) => {
    if (perfFailed) return 'Bot performance could not be loaded — the difference cannot be judged.';
    if (p.delta != null) return `B − A: ${pnlSign(p.bRec.pnl)} − ${pnlSign(p.aRec.pnl)} = ${pnlSign(p.delta)}`;
    const missing = [!p.aRec ? 'A' : null, !p.bRec ? 'B' : null].filter(Boolean).join(' and ');
    return `Not comparable yet — side ${missing} has no realised trades attributed, so there is no difference to read.`;
  };

  const sideRow = (side, pair, strategy, rec, deltaNode) => (
    <tr className={side === 'a' ? styles.rowA : styles.rowB}>
      <th scope="row" className={styles.symCell}>{pair.symbol}</th>
      <td className={side === 'a' ? styles.sideA : styles.sideB}>
        <span className={styles.sideLetter}>{side.toUpperCase()}</span>
      </td>
      <td>
        <span className={styles.stratName}>{labelFor(strategy.strategyKey)}</span>{' '}
        <code className={styles.stratKey} title={strategy.strategyKey}>
          {strategy.strategyKey.slice(0, 8)}
        </code>
      </td>
      <td className={styles.cellDim}>
        {strategy.protocolIds.join(' + ')} · {(strategy.treatment ?? {}).timeframe ?? '—'}
      </td>
      <td className={styles.numCol} title={recTitle(rec)}>{rec ? rec.samples : '—'}</td>
      <td className={styles.numCol} title={recTitle(rec)}>
        {rec
          ? <span className={pnlClass(rec.pnl)}>{pnlSign(rec.pnl)}</span>
          : <span className="pl-muted">—</span>}
      </td>
      {deltaNode}
    </tr>
  );

  return (
    <>
      {perfFailed && (
        <div className={styles.tableAlert}>
          <NoticeBlock
            compact
            notice={noticeFromError(perf.error, 'TCS-SYS-007', { operation: 'load realised bot performance' })}
          />
        </div>
      )}
      <div className={styles.tableWrap}>
        <table className={styles.abTable}>
          <thead>
            <tr>
              <th scope="col">Symbol</th>
              <th scope="col">Side</th>
              <th scope="col">Strategy</th>
              <th scope="col">Protocol · TF</th>
              <th scope="col" className={styles.numCol}>n</th>
              <th scope="col" className={styles.numCol}>P&amp;L</th>
              <th
                scope="col"
                className={styles.numCol}
                aria-sort={sortDir === 'desc' ? 'descending' : 'ascending'}
              >
                <button
                  type="button"
                  className={styles.sortBtn}
                  onClick={onToggleSort}
                  title="Order the pairs by realised profit difference (B − A) — to find the B that beats its A by most"
                >
                  Δ (B−A) {sortDir === 'desc' ? '▾' : '▴'}
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {pairs.map((p) => (
              <Fragment key={`${p.a.strategyKey}-${p.b.strategyKey}`}>
                {sideRow('a', p, p.a, p.aRec, (
                  <td
                    rowSpan={2}
                    className={`${styles.numCol} ${styles.deltaCell}`}
                    title={deltaTitle(p)}
                  >
                    {p.delta != null
                      ? <span className={pnlClass(p.delta)}>{pnlSign(p.delta)}</span>
                      : <span className="pl-muted">—</span>}
                  </td>
                ))}
                {sideRow('b', p, p.b, p.bRec, null)}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.tableNote}>
        Realised P&amp;L per strategy, attributed by scoringStrategyId (#894), in account currency.{' '}
        {perf.isLoading ? 'Loading realised P&L…' : perf.data?.populationNote}{' '}
        A dash is “no realised trades attributed” — never a zero.
      </p>
    </>
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

  /** labelFor — best available human name for a strategyKey (registry name, else its first bot). */
  const labelFor = (key) => registry.byKey.get(key)?.name
    ?? strategies.find((s) => s.strategyKey === key)?.botNames?.[0]
    ?? key.slice(0, 8);

  // EVERY eligible pair, for the index. `?pair=` is a drill-down INTO this set, never a substitute
  // for it — owner, 2026-09-22: "the view is designed to list all pairs... not a comparison for
  // one pair".
  const pairGroups = useMemo(() => buildPairs(strategies), [strategies]);
  const totalPairs = pairGroups.reduce((n, g) => n + g.pairs.length, 0);

  const [searchParams] = useSearchParams();
  const pairParam = searchParams.get('pair') || '';

  // The requested pair, resolved once. Unknown / ambiguous keys resolve to null and the render
  // falls back to the index WITH a notice. A resolved pair on DIFFERENT symbols is its own case:
  // it is a symbol comparison, not an A/B, so it is refused OUT LOUD rather than rendered.
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

  // ── View mode + realised performance. `list` is the index; `table` is the busy-mode view the
  // owner asked for (2026-09-22): a pair's two rows together (A shaded, B plain), each side's
  // realised P&L beside it, orderable by the profit difference (B − A) to rank the Bs.
  // The preference persists; the P&L fetch only runs while the table is open.
  const [view, setView] = usePersistentChoice('abstrategies:view', 'list', ['list', 'table']);
  const [deltaSort, setDeltaSort] = usePersistentChoice('abstrategies:sort', 'desc', ['desc', 'asc']);
  const perfQuery = useQuery({
    queryKey: ['bot-performance'],
    queryFn: () => apiGet(API_BOT_PERF),
    staleTime: 60_000,
    enabled: view === 'table',
  });
  // ⚠️ "cannot judge" (fetch failed) and "no trades" (no attributed record) are DIFFERENT states
  // — both render `—`, told apart by their tooltip; neither ever renders as 0.
  const perfFailed = view === 'table' && perfQuery.isError;
  // strategyKey → the bot records the SERVER attributed to it. Rows it could not attribute to
  // exactly one strategy (strategyIdentity unknown/none/many) carry no keys and are never guessed
  // at — #894: an attribution that cannot be justified would be worse than none.
  const perfByKey = useMemo(() => {
    const map = new Map();
    for (const row of perfQuery.data?.bots ?? []) {
      for (const key of row.strategyKeys ?? []) {
        map.set(key, [...(map.get(key) ?? []), {
          name: row.botName,
          pnl: row.realised.totalPnl,
          samples: row.realised.samples,
          days: row.window.days,
          reliability: row.realised.reliability,
        }]);
      }
    }
    return map;
  }, [perfQuery.data]);

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

  // Detail mode resolves both sides straight from the URL pair; a refused or unresolvable link
  // never reaches this (it renders its own state, or falls back to the index).
  const strategyA = strategies.find((s) => s.strategyKey === urlPair?.a) ?? null;
  const strategyB = strategies.find((s) => s.strategyKey === urlPair?.b) ?? null;

  // ── Table view rows: each pair with each side's realised record, plus B − A ──
  // `rec` is null when the strategy has no attributed record — rendered `—` WITH its reason,
  // never 0. `delta` is null unless BOTH sides have one: a half-comparable pair is not a number.
  const tablePairs = useMemo(() => {
    const rec = (key) => {
      const entries = perfByKey.get(key);
      if (!entries) return null;
      return {
        entries,
        pnl: entries.reduce((s, e) => s + e.pnl, 0),
        samples: entries.reduce((s, e) => s + e.samples, 0),
      };
    };
    return pairGroups.flatMap((g) => g.pairs.map((p) => {
      const aRec = rec(p.a.strategyKey);
      const bRec = rec(p.b.strategyKey);
      return {
        ...p,
        symbol: g.symbol,
        aRec,
        bRec,
        delta: aRec && bRec ? bRec.pnl - aRec.pnl : null,
      };
    }));
  }, [pairGroups, perfByKey]);

  const sortedPairs = useMemo(() => {
    const arr = [...tablePairs];
    arr.sort((x, y) => {
      // Pairs that cannot be compared sort LAST in both directions — "cannot judge" must never
      // masquerade as "worst" (#894, and the two-scales discipline in shared-core).
      if (x.delta == null && y.delta == null) return x.symbol.localeCompare(y.symbol);
      if (x.delta == null) return 1;
      if (y.delta == null) return -1;
      if (x.delta !== y.delta) return deltaSort === 'desc' ? y.delta - x.delta : x.delta - y.delta;
      return x.symbol.localeCompare(y.symbol);
    });
    return arr;
  }, [tablePairs, deltaSort]);

  // ── The index (default view): every eligible pair + the official tests. ──
  const listMode = (
    <>
      {pairParam && (
        <p className={styles.listNotice}>
          That pair link does not resolve to two current strategies — showing every pair instead.
        </p>
      )}
      {totalPairs === 0 ? (
        <EmptyState
          icon="🆚"
          title="No A/B pairs yet"
          description="No two strategies trade the same symbol, and an A/B pair holds the symbol constant — so there is nothing to pair yet. Copy a strategy and change something other than the symbol to create one."
        />
      ) : (
        <>
          <section className={styles.listSection}>
            <div className={styles.listHeadRow}>
              <h2 className={styles.listTitle}>Strategy pairs</h2>
              <div className="ff-seg" role="group" aria-label="Strategy pairs view">
                <button
                  type="button"
                  className={`ff-seg-btn ${view === 'list' ? 'ff-seg-btn--active' : ''}`}
                  aria-pressed={view === 'list'}
                  onClick={() => setView('list')}
                >
                  List
                </button>
                <button
                  type="button"
                  className={`ff-seg-btn ${view === 'table' ? 'ff-seg-btn--active' : ''}`}
                  aria-pressed={view === 'table'}
                  onClick={() => setView('table')}
                >
                  Table
                </button>
              </div>
            </div>
            <p className={styles.listMeta}>
              {totalPairs} eligible {totalPairs === 1 ? 'pair' : 'pairs'} · every pair trades ONE
              symbol — the playbook is what may differ · {view === 'table'
                ? 'ordered by realised profit difference (B − A) — click Δ to flip'
                : 'closest matches first'}
            </p>
            {view === 'table' ? (
              <PairTable
                pairs={sortedPairs}
                labelFor={labelFor}
                sortDir={deltaSort}
                onToggleSort={() => setDeltaSort(deltaSort === 'desc' ? 'asc' : 'desc')}
                perf={perfQuery}
                perfFailed={perfFailed}
              />
            ) : (
              <>
            {pairGroups.map((g) => (
              <div className={styles.pairGroup} key={g.symbol}>
                <div className={styles.groupHead}>
                  <span className={styles.groupSymbol}>{g.symbol}</span>
                  <span className={styles.groupCount}>
                    {g.count} strategies · {g.pairs.length} {g.pairs.length === 1 ? 'pair' : 'pairs'}
                  </span>
                </div>
                {g.pairs.map((p) => (
                  <article className={styles.pairRow} key={`${p.a.strategyKey}-${p.b.strategyKey}`}>
                    <PairSide side="a" strategy={p.a} name={labelFor(p.a.strategyKey)} />
                    <PairSide side="b" strategy={p.b} name={labelFor(p.b.strategyKey)} />
                    <div className={styles.pairTail}>
                      <span className={styles.diffChip} title={`differs in: ${p.diffs.join(', ')}`}>
                        ≠ {p.diffs.length}
                      </span>
                      <Link
                        className={styles.officialLink}
                        to={`/trading/ab-strategies?pair=${p.a.strategyKey},${p.b.strategyKey}`}
                      >
                        View →
                      </Link>
                    </div>
                  </article>
                ))}
              </div>
            ))}
              </>
            )}
          </section>

          <section className={styles.listSection}>
            <h2 className={styles.listTitle}>Official tests</h2>
            {testsQuery.isLoading ? (
              <p className={styles.listMeta}>Loading tests…</p>
            ) : tests.length === 0 ? (
              <p className={styles.listMeta}>
                {testsQuery.isError
                  ? 'Official tests could not be loaded.'
                  : 'No official tests recorded yet.'}
              </p>
            ) : (
              tests.map((t) => (
                <div className={styles.testRow} key={t.id}>
                  <span className={styles.testName}>{t.name}</span>
                  <span className={`${styles.status} ${t.status === 'running' ? styles.statusOn : ''}`}>
                    {t.status}
                  </span>
                  <span className={styles.testMeta}>
                    {t.startAt ? `started ${new Date(t.startAt).toLocaleString()}` : 'not started'}
                    {t.startAt && !t.endAt
                      ? ` · ${fmtDuration(Date.now() - new Date(t.startAt).getTime())} in`
                      : ''}
                    {t.endAt ? ` · ended ${new Date(t.endAt).toLocaleString()}` : ''}
                  </span>
                  <span className={styles.testMeta}>
                    {(t.symbols ?? []).map((s) => (
                      <span className={`${styles.chip} ${styles.chipMono}`} key={s}>{s}</span>
                    ))}
                  </span>
                  <Link className={styles.officialLink} to={`/trading/ab-strategies?test=${t.id}`}>
                    view →
                  </Link>
                </div>
              ))
            )}
          </section>
        </>
      )}
    </>
  );

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
            Every A/B-eligible strategy pair — two strategies that trade the SAME symbol (the
            symbol is the constant; the playbook is what may differ) — grouped by symbol, closest
            matches first. A List | Table toggle switches the index to a table: two rows per pair
            (A shaded, B plain) with each side&apos;s REALISED P&L beside it, orderable by the
            profit difference (B − A). Open a pair to compare it value by value: A left, B right,
            and a “≠” on every field that differs, with both sides spelled out in its tooltip. The
            pair is set by the URL (?pair=keyA,keyB — the first 8 characters of each strategyKey
            are enough); a link pairing two different symbols is refused rather than shown,
            because a symbol comparison is not an A/B. An OFFICIAL test opens with
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
      ) : urlPair && !urlPair.sameSymbol ? (
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
          <p className={styles.refusedBody}>
            {pairGroups.length > 0
              ? `A/B-eligible symbols right now: ${pairGroups.map((g) => g.symbol).join(', ')}. `
              : 'No symbol currently carries two strategies. '}
            <Link className={styles.officialLink} to="/trading/ab-strategies">See all A/B pairs →</Link>
          </p>
        </div>
      ) : urlPair && strategyA && strategyB ? (
        <>
          <Link className={styles.backLink} to="/trading/ab-strategies">← All A/B pairs</Link>
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
        </>
      ) : (
        listMode
      )}
    </div>
  );
}
