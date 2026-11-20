/**
 * MoversSelectionComparison — "is this run better than the previous run of the SAME test?" (#1328).
 *
 * ── WHY THIS IS A COMPONENT AND NOT MORE JSX IN THE PAGE ────────────────────────────────────────
 * The page already renders a form, a run summary, three tables and a depth panel. The comparison adds
 * three more things — a delta inside two tiles, a statement when a comparison is REFUSED, and a
 * collapsible history — and all three answer one question, so they live together.
 *
 * ── THE ONE RULE ────────────────────────────────────────────────────────────────────────────────
 * ⚠️ A REFUSED COMPARISON IS NEVER RENDERED AS A DASH OR A ZERO. `comparable: false` carries
 * `blockedBy` and a sentence `reason`; that sentence is shown, clamped, with `WhyPopover` for the
 * whole of it. "No previous run" (the normal first state) and "not comparable — engine changed" (a
 * refusal to measure) are different claims and get different tags AND different tones here, so they
 * are told apart without relying on colour.
 *
 * ⚠️ DIRECTION IS NEVER COLOUR-ONLY. Every delta carries the sign (+/−/none), an arrow glyph and a
 * visually-hidden word ("up"/"down"/"no change"), so it survives greyscale and a screen reader.
 *
 * ⚠️ THE HISTORY LIST HAS FIVE STATES, NOT TWO. Loading, failed, an unreadable reply, empty and
 * loaded are distinct: a failed fetch must never render the empty sentence, because "no earlier
 * test" is a claim about the store and a network fault is not evidence for it.
 */
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../../core/api/client';
import NoticeBlock from '../NoticeBlock.jsx';
import WhyPopover from '../WhyPopover.jsx';
import { noticeFromError } from '../../core/notices/from-error.js';
// Scoped styles for this component's own `mvp-delta-*`, `mvp-cmp-*` and `mvp-history-*` classes. The
// tone classes (`mvp-pos` / `mvp-neg`) and the table base (`mvp-table`) are the page's/`core/tables.css`'
// existing ones — a second dialect for the same page would be the duplication this repo already paid for.
import './movers-selection-comparison.css';

/** The typographic minus, so a negative delta is not read as a hyphen. */
const MINUS = '\u2212';

/**
 * Combine the successful runs in the results pane into ONE comparison statement.
 *
 * ── WHY THE TILES SHOW `comparable` ONLY WHEN THEY ALL ARE ──────────────────────────────────────
 * The tiles sum every day the reader ran. A delta is only a delta for the SAME set of days, so when
 * the pane runs five days the comparison must be the five days' own previous runs, summed the same
 * way the tiles are. If ONE day has nothing comparable, summing the other four would overstate the
 * change — so the whole comparison is refused and says how many days blocked it.
 *
 * ⚠️ NOTHING IS RE-DERIVED FROM TRADES HERE. `winRate` for a set is computed the same way the tiles'
 * own `totals` is (wins / trades), over the SERVER's stored totals — the standing rule against a
 * second implementation of the totals (`src/core/backtest-compare.js`) is about re-scoring trades, not
 * about reading the sign and size of two stored numbers.
 *
 * Pure and exported: the states below are reachable from a test without a browser.
 */
export function buildComparisonView(okRuns, totals) {
  if (!Array.isArray(okRuns) || okRuns.length === 0) return null;
  // A server that predates the contract sends no `comparison`. Showing nothing is honest; inventing
  // "no change" is the defect this component exists to prevent.
  if (okRuns.some((r) => !r.comparison)) return null;

  const comparisons = okRuns.map((r) => r.comparison);
  const last = comparisons[comparisons.length - 1];

  const view = {
    runCount: okRuns.length,
    profileKey: last.profileKey,
    profileLabel: last.profileLabel,
    semanticsVersion: last.semanticsVersion,
    delta: null,
    configChanges: [],
    blockedGroups: [],
  };

  if (okRuns.length === 1) {
    const c = last;
    return {
      ...view,
      delta: c.comparable ? c.delta : null,
      configChanges: c.configChanges ?? [],
      blockedGroups: c.comparable
        ? []
        : [{ blockedBy: c.blockedBy, reason: c.reason, count: 1 }],
    };
  }

  const blocked = comparisons.filter((c) => !c.comparable);
  if (blocked.length) {
    const groups = [];
    for (const c of blocked) {
      const found = groups.find((g) => g.blockedBy === c.blockedBy);
      if (found) found.count += 1;
      else groups.push({ blockedBy: c.blockedBy, reason: c.reason, count: 1 });
    }
    return { ...view, blockedGroups: groups, configChanges: mergeConfigChanges(comparisons) };
  }

  const previous = comparisons.reduce(
    (acc, c) => {
      const t = c.previous?.totals;
      if (!t) return acc;
      return {
        trades: acc.trades + Number(t.trades ?? 0),
        wins: acc.wins + Number(t.wins ?? 0),
        netPnl: acc.netPnl + Number(t.netPnl ?? 0),
      };
    },
    { trades: 0, wins: 0, netPnl: 0 },
  );
  const previousWinRate = previous.trades ? (previous.wins / previous.trades) * 100 : null;

  return {
    ...view,
    delta: {
      trades: totals.trades - previous.trades,
      wins: totals.wins - previous.wins,
      winRate:
        totals.winRate != null && previousWinRate != null
          ? Math.round((totals.winRate - previousWinRate) * 100) / 100
          : null,
      netPnl: Math.round((totals.netPnl - previous.netPnl) * 100) / 100,
    },
    configChanges: mergeConfigChanges(comparisons),
  };
}

/** The same field changing by the same amount on every day is ONE note, not five. */
function mergeConfigChanges(comparisons) {
  const seen = new Set();
  const out = [];
  for (const c of comparisons) {
    for (const change of c.configChanges ?? []) {
      const key = `${change.id}|${change.from}|${change.to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(change);
    }
  }
  return out;
}

const deltaText = (value, money) => {
  const n = Number(value);
  const places = money ? 2 : 1;
  const abs = Math.abs(n).toLocaleString(undefined, {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  });
  return `${n > 0 ? '+' : n < 0 ? MINUS : ''}${abs}`;
};

/**
 * The delta line that sits in a `StatCard`'s `sub` slot.
 *
 * `money` selects 2dp and `unit="pp"` renders percentage points; both keep the arrow, the sign and
 * the visually-hidden direction word, so the meaning does not depend on the good/bad colour.
 */
export function SelectionDelta({ value, money = false, unit = '', vsLabel = 'vs previous test' }) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;

  const direction = n > 0 ? 'up' : n < 0 ? 'down' : 'flat';
  const arrow = direction === 'up' ? '\u25B2' : direction === 'down' ? '\u25BC' : '\u2192';
  const tone = direction === 'up' ? 'mvp-pos' : direction === 'down' ? 'mvp-neg' : 'mvp-delta-flat';

  return (
    <span className={`mvp-delta ${tone}`}>
      <span className="mvp-delta-arrow" aria-hidden="true">{arrow}</span>
      <span className="sr-only">{direction === 'flat' ? 'no change ' : `${direction} `}</span>
      <span className="mvp-delta-value">
        {deltaText(n, money)}
        {unit && <span className="mvp-delta-unit">{unit}</span>}
      </span>
      <span className="mvp-delta-vs">{vsLabel}</span>
    </span>
  );
}

const NOTE_META = {
  'no-previous': { tag: 'No previous run', tone: 'first' },
  'semantics-changed': { tag: 'Not comparable \u2014 engine changed', tone: 'blocked' },
};

const configValue = (v) => (v === null || v === undefined || v === '' ? 'not set' : String(v));

/** A config id the page already labels keeps its label; an unknown id is shown as itself, never blank. */
const fieldLabel = (id, labels) => labels?.get?.(id) ?? id;

/**
 * The statement under the tiles: why a pair is not compared, and which settings changed.
 *
 * Both are readable states rather than quiet gaps. The `reason` is clamped to two lines and the full
 * sentence is in a `WhyPopover`, which is keyboard reachable — a `title` attribute would not be.
 */
export function SelectionComparisonNotes({ view, labelById }) {
  if (!view) return null;
  const groups = view.blockedGroups ?? [];
  const changes = view.configChanges ?? [];
  if (!groups.length && !changes.length) return null;

  return (
    <div className="mvp-cmp">
      {groups.map((group) => {
        const meta = NOTE_META[group.blockedBy] ?? { tag: 'Not compared', tone: 'blocked' };
        const reason = group.reason || 'The server did not give a reason, so this pair is not compared.';
        const long = reason.length > 110;
        return (
          <p key={group.blockedBy} className={`mvp-cmp-note mvp-cmp-note--${meta.tone}`}>
            <span className="mvp-cmp-tag">{meta.tag}</span>
            <span className="mvp-cmp-text">
              {view.runCount > 1 && (
                <strong>
                  {group.count} of {view.runCount} days:{' '}
                </strong>
              )}
              {reason}
            </span>
            {long && (
              <WhyPopover title="The full reason this pair is not compared">{reason}</WhyPopover>
            )}
          </p>
        );
      })}

      {changes.length > 0 && (
        <p className="mvp-cmp-config">
          <span className="mvp-cmp-config-label">config changed:</span>{' '}
          {changes.map((change, i) => (
            <span key={`${change.id}:${i}`} className="mvp-cmp-change">
              {i > 0 && <span className="mvp-cmp-sep" aria-hidden="true"> {'\u00B7'} </span>}
              {fieldLabel(change.id, labelById)} {configValue(change.from)}
              <span className="mvp-cmp-arrow" aria-hidden="true"> {'\u2192'} </span>
              <span className="sr-only"> to </span>
              {configValue(change.to)}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

const WHEN = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'UTC',
});

const whenLabel = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '\u2014' : WHEN.format(d);
};

const money = (n) =>
  n == null || Number.isNaN(Number(n))
    ? '\u2014'
    : Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * "Previous tests on this profile" — the stored runs of the SAME test, newest first.
 *
 * ⚠️ The current run(s) are filtered out: the store keeps the run just made, and the question is what
 * came BEFORE it. `excludeKey` is part of the query key so a new run refetches the list.
 *
 * ⚠️ A row under different execution semantics is marked `not compared`. The marker is TEXT (plus a
 * tone), because "this number is not subtracted from mine" cannot be carried by a colour.
 */
export function SelectionHistory({
  profileKey,
  profileLabel,
  semanticsVersion,
  currentRunIds = [],
}) {
  const excludeKey = [...currentRunIds].sort().join(',');
  const query = useQuery({
    queryKey: ['movers-selection-history', profileKey, excludeKey],
    queryFn: () =>
      apiGet(`/api/backtest/selection-history?profileKey=${encodeURIComponent(profileKey)}&limit=20`),
    enabled: Boolean(profileKey),
    retry: 1,
  });

  const excluded = new Set(currentRunIds);
  const payloadOk = Array.isArray(query.data?.selections);
  const rows = payloadOk ? query.data.selections.filter((row) => !excluded.has(row.id)) : null;
  const mismatched = rows ? rows.filter((row) => row.semanticsVersion !== semanticsVersion).length : 0;

  return (
    <details className="mvp-panel mvp-history">
      <summary className="mvp-history-summary">
        <span className="mvp-history-title">Previous tests on this profile</span>
        {profileLabel && <span className="mvp-history-profile">{profileLabel}</span>}
        {rows && rows.length > 0 && (
          <span className="mvp-history-count">
            {rows.length} {rows.length === 1 ? 'run' : 'runs'}
          </span>
        )}
      </summary>

      <div className="mvp-history-body">
        {/* Four distinct states. A failed fetch is NEVER the "no earlier test" sentence. */}
        {query.isLoading ? (
          <p className="mvp-note">Loading earlier tests…</p>
        ) : query.isError ? (
          <NoticeBlock
            notice={noticeFromError(query.error, 'TCS-SYS-002', {
              operation: 'load the previous tests of this profile',
            })}
            compact
          />
        ) : !payloadOk ? (
          // A 200 with no `selections` list is not "no earlier test" — it is a reply this page cannot
          // read, and saying "none" would turn a contract break into a fact about the store.
          <p className="mvp-note">
            The server replied without a selections list, so the earlier tests cannot be shown.
          </p>
        ) : rows.length === 0 ? (
          <p className="mvp-note">
            No earlier test of this profile is stored yet — this run is the first.
          </p>
        ) : (
          <>
            <div className="mvp-history-scroll">
              <table className="mvp-table">
                <caption className="sr-only">
                  Earlier runs of this exact test, newest first. Times are UTC. A run marked not
                  compared was computed under different engine execution semantics and its numbers
                  are not subtracted from this run.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">Direction</th>
                    <th scope="col" className="mvp-num">Top</th>
                    <th scope="col" className="mvp-num">Trades</th>
                    <th scope="col" className="mvp-num">Win rate</th>
                    <th scope="col" className="mvp-num">P/L</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const notCompared = row.semanticsVersion !== semanticsVersion;
                    const netPnl = Number(row.totals?.netPnl ?? 0);
                    return (
                      <tr key={row.id}>
                        <td className="mvp-nowrap">
                          <time dateTime={row.createdAt} title={row.createdAt}>
                            {whenLabel(row.createdAt)}
                          </time>
                          {notCompared && <span className="mvp-history-tag">not compared</span>}
                        </td>
                        <td className="mvp-nowrap">{row.directionMode ?? '\u2014'}</td>
                        <td className="mvp-num">{row.topN ?? '\u2014'}</td>
                        <td className="mvp-num">{row.totals?.trades ?? '\u2014'}</td>
                        <td className="mvp-num">
                          {row.totals?.winRate == null
                            ? '\u2014'
                            : `${Number(row.totals.winRate).toFixed(1)}%`}
                        </td>
                        <td className={`mvp-num ${netPnl > 0 ? 'mvp-pos' : netPnl < 0 ? 'mvp-neg' : ''}`}>
                          {money(row.totals?.netPnl)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {mismatched > 0 && (
              <p className="mvp-note">
                {mismatched === 1
                  ? '1 earlier run is marked not compared'
                  : `${mismatched} earlier runs are marked not compared`}{' '}
                because the engine’s execution semantics changed, so their numbers are not
                subtracted from this run.
              </p>
            )}
          </>
        )}
      </div>
    </details>
  );
}
