/**
 * movers-dataset.ts — WHAT DAY A MOVERS DATASET DESCRIBES, and which leg it belongs to.
 *
 * ── WHY THIS IS A PURE MODULE AND NOT A FEW LINES INSIDE THE SERVICE ────────────────────────────
 * Measured 2026-11-19 on the first version of the selection page: `movers-losers-2026-11-10` is the
 * top-10 LOSERS **of 2026-11-10**, holding bars from 11-03 to 11-11 (five prior sessions for
 * directive warm-up). The page ranked all ten symbols on **every day in that window**, so it reported
 * 11-04, 11-05, 11-06, 11-09 and 11-10. On the four days before the answer day those ten symbols were
 * not movers at all, so the ranking was top-3-of-ten ordinary names with moves of ±3% — and the
 * candidate list itself was chosen using knowledge of how 11-10 ended. Two separate look-aheads, both
 * invisible in the output.
 *
 * ⇒ **A movers dataset describes exactly ONE day.** The warm-up sessions exist so the directives have
 * history, not so the strategy can be measured on them. `parseMoversDatasetName()` is the one place
 * that rule is expressed, so the seed, the API and the page cannot disagree about it.
 *
 * Convention this enforces: `movers-{winners|losers}-YYYY-MM-DD`.
 * A name that does not carry a day is **excluded from the movers page with a reason**, never guessed
 * from the window's `toDate` — `dev-window-v1` covers 42 days, and picking one of them would be an
 * invention that reads as a fact.
 *
 * ⚠️ SUPPLY IS THE NEXT CONSTRAINT, AND IT IS NOT SOLVED HERE. Measured 2026-11-19: two day lists
 * exist (one per side), so a win rate has a sample of ONE session. A repeatable builder for a date
 * range is #1322, and the candidate-membership hindsight in those lists is #1321.
 */

export type MoversSide = 'winners' | 'losers';

/**
 * ── DECISION (2026-11-19, primary) ──
 * WHAT:       A movers dataset defines exactly ONE measurable day — the date in its own name — and a
 *             leg/list side mismatch is REFUSED rather than resolved.
 * WHY:        The first selection page ranked all ten symbols of `movers-losers-2026-11-10` on every
 *             session in its window, so four of the five reported days were warm-up sessions where
 *             those names were not movers (moves of ±3%, "top 3 of ten"). The candidate list had also
 *             been chosen using knowledge of how the answer day ended. Both look-aheads are invisible
 *             in the output: every number looked like a result.
 * INSTEAD OF: Inferring the day from the window's `toDate` or from "the last day with bars". Both pick
 *             a plausible day for a dataset whose own name says nothing, which is an invention
 *             presented as a fact.
 * REVERSE BY: Reverting `selection-run.service.ts` to rank `buildDayRanks()`'s whole output, and
 *             deleting the `selectAnswerDay()` call. Nothing is stored or migrated.
 * REGISTER:  docs/SETTLED-DECISIONS.md row 231
 * GUARD:     nest/src/modules/backtest/movers-dataset.spec.ts · selection-ranking.spec.ts
 */

export interface MoversDatasetDecl {
  /** The dataset group name exactly as stored in `backtest_period.name`. */
  name: string;
  /** `YYYY-MM-DD` — the ONE session this list is a screen of. */
  answerDate: string;
  /** Which end of that day's movers the list holds. */
  side: MoversSide;
}

/**
 * ⚠️ NOT A DISCRIMINATED UNION ON A BOOLEAN. This repo compiles with `strictNullChecks: false`, under
 * which a `boolean` literal widens and `if (!result.ok)` narrows NOTHING — measured 2026-11-19 when
 * `decl.reason` failed to typecheck on the `ok: true` member. One nullable `value` plus a `reason`
 * narrows correctly and reads the same at every call site.
 */
export interface ParseMoversResult {
  /** The declaration, or `null` when the name is not a movers day (see `reason`). */
  value: MoversDatasetDecl | null;
  /** Why `value` is null. Always set when `value` is null — never a silent absence. */
  reason: string | null;
}

const NAME_PATTERN = /^movers-(winners|losers)-(\d{4})-(\d{2})-(\d{2})$/;

/** `true` when `YYYY-MM-DD` names a real calendar day. 2026-02-30 is not one. */
function isRealDate(y: number, m: number, d: number): boolean {
  const probe = new Date(Date.UTC(y, m - 1, d));
  return (
    probe.getUTCFullYear() === y &&
    probe.getUTCMonth() === m - 1 &&
    probe.getUTCDate() === d
  );
}

/**
 * Read a `backtest_period.name` as a movers dataset declaration.
 *
 * Returns `{ ok: false, reason }` — never `null` — because the callers REPORT why a dataset is not
 * offered on this page, and an absent result with no sentence is the silent-drop shape this repo
 * keeps paying for.
 */
export function parseMoversDatasetName(rawName: string): ParseMoversResult {
  const name = String(rawName ?? '').trim();
  if (!name) return { value: null, reason: 'the dataset has no name' };

  const m = NAME_PATTERN.exec(name);
  if (!m) {
    return {
      value: null,
      reason:
        `'${name}' does not name a movers day. Expected ` +
        '`movers-{winners|losers}-YYYY-MM-DD` — without the day there is no way to know which ' +
        "session this list is a screen of, and the run would rank symbols on days they were never movers.",
    };
  }

  const [, side, ys, ms, ds] = m;
  const y = Number(ys);
  const mo = Number(ms);
  const d = Number(ds);
  if (!isRealDate(y, mo, d)) {
    return {
      value: null,
      reason: `'${name}' carries ${ys}-${ms}-${ds}, which is not a real date`,
    };
  }

  return {
    value: { name, answerDate: `${ys}-${ms}-${ds}`, side: side as MoversSide },
    reason: null,
  };
}

export type SideSource = 'explicit' | 'protocol' | 'dataset-name' | 'unknown';

export interface SideResolution {
  /** The side to rank for. `null` only when nothing could decide it. */
  side: MoversSide | null;
  source: SideSource;
  /** Set when the protocol and the dataset disagree — the caller must REFUSE, not pick one. */
  conflict?: string;
}

/** The side each protocol direction trades. A movers leg longs gainers and shorts losers. */
function sideFromDirection(direction: string | null | undefined): MoversSide | null {
  const declared = String(direction ?? '').trim().toUpperCase();
  if (declared === 'LONG_ONLY' || declared === 'LONG') return 'winners';
  if (declared === 'SHORT_ONLY' || declared === 'SHORT') return 'losers';
  return null;
}

/**
 * Decide which side this run ranks for, in precedence order: explicit request, then the protocol's
 * own declared direction, then the dataset name.
 *
 * ⚠️ A CONFLICT IS REFUSED, NOT RESOLVED. Ranking a winners list while the SHORT leg is selected
 * measures "short the day's gainers", which is a different strategy from the one whose protocol id
 * the run is filed under. Silently preferring either side produces a plausible number attributed to
 * the wrong protocol, and nothing in the result would say so.
 */
export function resolveMoversSide(input: {
  explicit?: MoversSide | null;
  protocolDirection?: string | null;
  datasetSide: MoversSide;
}): SideResolution {
  const fromProtocol = sideFromDirection(input.protocolDirection);

  if (input.explicit) {
    // An explicit request wins — but it still has to agree with the list it is ranking.
    if (input.explicit !== input.datasetSide) {
      return {
        side: null,
        source: 'explicit',
        conflict:
          `The request asks for the '${input.explicit}' side but the dataset is a '${input.datasetSide}' list. ` +
          'Ranking one end of the market while trading the other is a different strategy.',
      };
    }
    return { side: input.explicit, source: 'explicit' };
  }

  if (fromProtocol) {
    if (fromProtocol !== input.datasetSide) {
      return {
        side: null,
        source: 'protocol',
        conflict:
          `The protocol trades the ${fromProtocol} side, but '${input.datasetSide}' is the dataset's list. ` +
          `Offer a '${fromProtocol}' day instead, or run the protocol that matches this list.`,
      };
    }
    return { side: fromProtocol, source: 'protocol' };
  }

  // No protocol direction readable — the dataset's own name is the last source, and the caller is
  // told it was inferred (`sideSource: 'dataset-name'`) rather than being left to assume.
  return { side: input.datasetSide, source: 'dataset-name' };
}
