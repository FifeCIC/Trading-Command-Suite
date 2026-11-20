/**
 * selection-profile.ts — WHAT MAKES TWO SELECTION RUNS "THE SAME TEST", AND WHETHER THEIR NUMBERS MAY
 * BE SUBTRACTED.
 *
 * ── WHY A KEY AND NOT JUST "THE LAST RUN" ───────────────────────────────────────────────────────
 * A movers test is not one run: it is a GROUP of per-symbol engine runs, chosen by a rank at a clock
 * time from a dataset that is a screen of ONE session. Wednesday-long and Thursday-short are different
 * tests that must not be compared with each other, and neither must be compared with a run that used a
 * different dataset, rank time or top-N. The factors that make them the same test are the KEY:
 *
 *     datasetName · answerDate · side · directionMode · protocolId · botId · topN · cutoffUtc
 *
 * ⚠️ **THE CONFIG IS DELIBERATELY NOT IN THE KEY.** Stop loss, take profit, entry bar, max hold and
 * the money target are the things an operator CHANGES between runs — that change is the reason to run
 * again, so putting it in the key would hide the one comparison worth having. It is reported beside
 * the delta as `configChanges`, which is also what makes a delta explainable rather than mysterious.
 *
 * ⚠️ **SEMANTICS ARE A SEPARATE, BLOCKING CHECK.** Two runs of the same test computed by different
 * engine rules cannot be subtracted — see `execution-semantics.ts`. That refusal is the whole point:
 * the alternative is a confident percentage that measures the engine's history rather than the
 * strategy's.
 *
 * Pure: no clock, no Prisma, no Nest. Every state below is reachable from a spec.
 *
 * ── DECISION (2026-11-20, primary) ────────────────────────────────────────────────────────────────
 * WHAT:      a movers test is stored as a GROUP with a profile key, and a delta is shown only when the
 *            two runs share an `EXECUTION_SEMANTICS` version; a config difference is reported BESIDE
 *            the delta as `configChanges`, never used to hide the pair.
 * WHY:       the owner asked for the tiles to show the change against the previous test of the same day
 *            and direction. Storing the group is what makes "the previous test" a fact rather than the
 *            last row in a table, and gating on semantics is what stops a delta measuring the engine:
 *            measured 2026-11-20, one engine rule moved the same window from −1,538.47 / 44 trades to
 *            +767.64 / 29. A number there would be arithmetic about our own refactor.
 * INSTEAD OF: comparing with the newest run of the protocol, or with whatever `runs/compare` was handed.
 * REVERSE BY: dropping the `comparison` block from the run response and deleting `backtest_selection`;
 *            no other behaviour depends on either.
 * REGISTER:  docs/SETTLED-DECISIONS.md row 243
 * GUARD:     selection-profile.spec.ts (18 cases — all four states, including the canary that a
 *            different semantics version returns NO delta) and execution-semantics.spec.ts.
 */
import { createHash } from 'crypto';
import { EXECUTION_SEMANTICS, changesBetween, sameSemantics } from '../../common/trading/execution-semantics';

export interface SelectionProfile {
  datasetName: string;
  /** `YYYY-MM-DD` — the ONE session the dataset is a screen of. */
  answerDate: string;
  /** `winners` | `losers` — which end of the day's movers the list holds. */
  side: string;
  /** `long` | `short` — the direction the protocol trades. */
  directionMode: string;
  protocolId: string;
  botId: string | null;
  topN: number;
  /** `HH:MM` UTC. */
  cutoffUtc: string;
}

/** The numbers a tile shows, and the only ones a delta is computed over. */
export interface SelectionTotals {
  trades: number;
  wins: number;
  winRate: number;
  netPnl: number;
}

/** One applied trade-management value, as the result reports it. */
export interface AppliedConfigValue {
  id: string;
  value: number | string | null;
  applied: boolean;
}

export interface StoredSelection {
  id: string;
  createdAt: string;
  engineVersion: string;
  semanticsVersion: number;
  totals: SelectionTotals;
  config: readonly AppliedConfigValue[];
}

export type NotComparable = 'no-previous' | 'semantics-changed';

export interface Comparison {
  profileKey: string;
  profileLabel: string;
  /** This run's semantics version, so a stored row can be read against it later. */
  semanticsVersion: number;
  previous: (StoredSelection & { semanticsVersion: number }) | null;
  comparable: boolean;
  /** `null` when comparable. Never a silent state: a blocked comparison always says which. */
  blockedBy: NotComparable | null;
  /** Why not — a sentence a reader can act on, naming the versions or the absence. */
  reason: string | null;
  /** `current − previous` per tile. `null` unless comparable. */
  delta: SelectionTotals | null;
  /** Fields whose applied value differs between the two runs — usually the CAUSE of the delta. */
  configChanges: Array<{ id: string; from: number | string | null; to: number | string | null }>;
}

/** A stable, order-independent key for "which test is this". */
export function profileKey(p: SelectionProfile): string {
  const parts = [
    p.datasetName,
    p.answerDate,
    p.side,
    p.directionMode,
    p.protocolId,
    p.botId ?? 'no-bot',
    `top${p.topN}`,
    p.cutoffUtc,
  ];
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

/** `Wed 11 Nov · long · top 1 · 14:30 — movers-winners-2026-11-11`. Shown so a delta names its pair. */
export function profileLabel(p: SelectionProfile): string {
  const [y, m, d] = p.answerDate.split('-').map(Number);
  const day = Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)
    ? new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', {
        weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
      })
    : p.answerDate;
  return `${day} · ${p.directionMode} · top ${p.topN} · ${p.cutoffUtc} — ${p.datasetName}`;
}

const deltaOf = (current: SelectionTotals, previous: SelectionTotals): SelectionTotals => ({
  trades: current.trades - previous.trades,
  wins: current.wins - previous.wins,
  winRate: round2(current.winRate - previous.winRate),
  netPnl: round2(current.netPnl - previous.netPnl),
});

/** Kept to 2dp so a tile does not print `-0.30000000000000426`. */
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Which applied values changed between two runs, ignoring fields neither run applies. */
export function configChanges(
  current: readonly AppliedConfigValue[],
  previous: readonly AppliedConfigValue[],
): Array<{ id: string; from: number | string | null; to: number | string | null }> {
  const before = new Map(previous.map((f) => [f.id, f]));
  const changes: Array<{ id: string; from: number | string | null; to: number | string | null }> = [];
  for (const field of current) {
    const was = before.get(field.id);
    if (!was) continue;
    // A row that neither run applies cannot explain a delta — reporting it as a "change" would send
    // the reader after a knob that did nothing on either side.
    if (!field.applied && !was.applied) continue;
    if (String(was.value ?? '') !== String(field.value ?? '')) {
      changes.push({ id: field.id, from: was.value, to: field.value });
    }
  }
  return changes;
}

/**
 * Compare this run with the previous run of the SAME profile.
 *
 * ⚠️ THE ORDER OF THE CHECKS IS THE CONTRACT: no previous → `no-previous`; different semantics →
 * `semantics-changed`; only then a delta. A comparison that checked semantics last would return a
 * number for a pair it should have refused.
 */
export function compareSelections(
  current: { totals: SelectionTotals; config: readonly AppliedConfigValue[]; semanticsVersion?: number },
  previous: StoredSelection | null,
  profile: SelectionProfile,
): Comparison {
  const key = profileKey(profile);
  const label = profileLabel(profile);
  const semanticsVersion = current.semanticsVersion ?? EXECUTION_SEMANTICS;

  if (!previous) {
    return {
      profileKey: key,
      profileLabel: label,
      semanticsVersion,
      previous: null,
      comparable: false,
      blockedBy: 'no-previous',
      reason: 'No earlier run of this same test — same day, direction, dataset, bot, top-N and rank time — is stored yet. This run is the baseline.',
      delta: null,
      configChanges: [],
    };
  }

  if (!sameSemantics(previous.semanticsVersion, semanticsVersion)) {
    const between = changesBetween(previous.semanticsVersion, semanticsVersion);
    const what = between.length
      ? between.map((c) => c.what).join(' ')
      : 'the engine\'s execution rules changed between these runs (the change predates the semantics log)';
    return {
      profileKey: key,
      profileLabel: label,
      semanticsVersion,
      previous,
      comparable: false,
      blockedBy: 'semantics-changed',
      reason:
        `Not comparable: the earlier run (${previous.createdAt.slice(0, 10)}, engine ${previous.engineVersion}) ` +
        `was computed under execution semantics ${previous.semanticsVersion} and this one under ${semanticsVersion}. ${what} ` +
        'A difference between them would measure the engine, not the strategy — re-run the earlier test to compare.',
      delta: null,
      configChanges: configChanges(current.config, previous.config),
    };
  }

  return {
    profileKey: key,
    profileLabel: label,
    semanticsVersion,
    previous,
    comparable: true,
    blockedBy: null,
    reason: null,
    delta: deltaOf(current.totals, previous.totals),
    configChanges: configChanges(current.config, previous.config),
  };
}
