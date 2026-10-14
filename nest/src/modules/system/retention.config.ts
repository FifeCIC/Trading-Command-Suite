/**
 * retention.config.ts — THE single owner of "which date column, and how long" per table.
 *
 * ⚠️ WHY THIS FILE EXISTS (2026-09-16)
 *
 * The same two facts were declared in THREE places, and nothing checked that they agreed:
 *
 *   1. `data-retention.service.ts` — `TABLE_CONFIG` (dateCol + defaultDays)
 *   2. `backtest-archive.service.ts` — `ARCHIVABLE_TABLES`, whose own comment said
 *      *"Keep in sync with data-retention TABLE_CONFIG"* — an admission that nothing did
 *   3. `system-health.service.ts` — `RETENTION_DAYS` + an inline `dateCols` map, commented
 *      *"mirrored from DataRetentionService for cross-reference"*
 *
 * A comment telling a future reader to keep two lists in step is a wish, not a mechanism. The
 * concrete cost of the drift is the reason for this file: changing one table's date column had to
 * be done in three places, and missing one would silently break archiving or the health panel
 * while the build stayed green.
 *
 * ⚠️ AND WHY `directiveoutcome` NOW PRUNES ON `createdAt`, NOT `predictedAt`
 *
 * This is a DEFECT FIX, not a preference. `directiveoutcome` was the ONLY table keyed on a
 * **claimed** value rather than an intrinsic write-time fact — every other entry below uses
 * `timestamp` / `createdAt` / `snappedAt` / `takenAt`, which record when the row was STORED.
 *
 * That produced two opposite failures from one mistake:
 *
 *   - **Evidence destroyed.** `predictedAt` was written from the evaluated bar's OPEN time (#827),
 *     so a symbol whose feed had stopped produced a row stamped weeks in the past — which the next
 *     retention run deleted IMMEDIATELY. Investigating that defect was made harder by the system
 *     erasing its own symptom: the issue could only ever see "33 rows in a 3-hour window" because
 *     the evidence never survived longer than that. **A retention policy must not be able to delete
 *     the record of a bug faster than a human can look at it.**
 *   - **Unbounded growth.** The mirror case: a row whose `predictedAt` was stamped in the FUTURE
 *     would be exempt from pruning forever. A size bound keyed on a computed value is not a size bound.
 *
 * Pruning on `createdAt` bounds the table by how much is STORED, which is what retention is for.
 * It is also now effectively equivalent in normal operation, because #827 made `predictedAt` track
 * the decision clock (verified live: 30/30 recent rows, 0.0 min lag). The difference only shows up
 * when a row is mis-stamped — and in that case the row SHOULD be kept, because it is the evidence.
 *
 * ⚠️ `predictedAt` remains a valid ARCHIVE column (see `ARCHIVE_DATE_COLUMNS` below) — it is
 * meaningful for slicing archived data by prediction date. It is simply not the right key for a
 * retention bound.
 */

export interface RetentionTableConfig {
  /** The column the retention bound is applied to. MUST be an intrinsic write-time column. */
  dateCol: string;
  /** Default retention window in days. */
  defaultDays: number;
  /** Environment variable that overrides `defaultDays`. */
  envKey: string;
  /** Human-readable name for logs and the health panel. */
  label: string;
}

/**
 * Per-table retention. `dateCol` MUST be a column that records when the row was written —
 * `timestamp`, `createdAt`, `snappedAt`, `takenAt`, `evaluatedAt` — never a value the application
 * derives and could get wrong. See the header for the two ways that goes wrong.
 */
export const RETENTION_TABLES: Record<string, RetentionTableConfig> = {
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // CLASS 1 — ACTIVITY AND TRADING HISTORY: SHORT.
  //
  // Owner, 2026-10-04: *"When I said 60 days I meant general trading history and app activity —
  // not strictly meaning everything or including bars for backtesting."*
  //
  // These tables describe WHAT THE APP DID. Nothing downstream reads them as input, so their depth
  // buys nothing but diagnostics, and a recent window is enough to answer "what happened?" about
  // anything still worth asking. ⚠️ **These are the tables to bound tightly.**
  //
  // THE OTHER CLASS IS AT THE BOTTOM OF THIS OBJECT — read it before changing a number here, because
  // the two have OPPOSITE reasons and a single "retention policy" number cannot serve both.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ⚠️ `createdAt`, NOT `predictedAt`. See the header — this is the fix, not an oversight.
  directiveoutcome:    { dateCol: 'createdAt',    defaultDays: 3,   envKey: 'DATA_RETENTION_DIRECTIVE_DAYS', label: 'Directive Outcomes' },
  score:               { dateCol: 'timestamp',    defaultDays: 30,  envKey: 'DATA_RETENTION_SCORE_DAYS',     label: 'Scores' },
  score_snapshot:      { dateCol: 'snappedAt',    defaultDays: 90,  envKey: 'DATA_RETENTION_SNAPSHOT_DAYS',  label: 'Score Snapshots' },
  strategy_evaluation: { dateCol: 'evaluatedAt',  defaultDays: 90,  envKey: 'DATA_RETENTION_EVAL_DAYS',      label: 'Strategy Evaluations' },
  decision_log:        { dateCol: 'timestamp',    defaultDays: 90,  envKey: 'DATA_RETENTION_DECISION_DAYS',  label: 'Decision Log' },
  automation_event:    { dateCol: 'timestamp',    defaultDays: 60,  envKey: 'DATA_RETENTION_EVENT_DAYS',     label: 'Automation Events' },
  portfolio_snapshot:  { dateCol: 'takenAt',      defaultDays: 365, envKey: 'DATA_RETENTION_PORTFOLIO_DAYS', label: 'Portfolio Snapshots' },
  order:               { dateCol: 'createdAt',    defaultDays: 365, envKey: 'DATA_RETENTION_ORDER_DAYS',     label: 'Orders' },
  bridge_event:        { dateCol: 'createdAt',    defaultDays: 90,  envKey: 'DATA_RETENTION_BRIDGE_DAYS',    label: 'Bridge Events' },

  // ── DECISION (2026-10-03, owner) — 30 days, and it was the ONLY large table with no bound ──────
  // WHAT:  `apiactivitylog` gets a 30-day window.
  // WHY:   MEASURED 2026-10-03: **1,332,329 rows / 249 MB** — the largest table in the database and
  //        the only one of the top ten with no declared window (the next undeclared was 18 MB, 14×
  //        smaller). It is pure telemetry: endpoint, method, status, duration. Nothing reads its
  //        history.
  // OWNER'S REASONING: *"nothing is reading 90 days and might not for a long time… 30 days by
  //        default is suitable."* The 7/30/90 fork was put to them and 30 was chosen.
  // ⚠️  THIS IS THE DEFAULT, NOT A CEILING. `DATA_RETENTION_APIACTIVITY_DAYS` overrides it, which is
  //        the existing opt-in mechanism for a longer window.
  // REVERSE BY: change `defaultDays`, or set the env key. One line either way.
  // REGISTER:  docs/SETTLED-DECISIONS.md row 62.
  // NOT BUILT — the owner also raised framing long-term storage as an OPT-IN FEATURE the user
  //        switches on for analysis (*"the user has to initiate long term data storage"*). Not done
  //        here: a default bound and an opt-in feature are different sizes of change, and only the
  //        first was decided. Recorded on **#1070** with the related finding below.
  // ⚠️ #1070 — READ BEFORE TIGHTENING THIS NUMBER. Measured 2026-10-03, PER TIMEFRAME:
  //        the 60-day bound IS enforced for every intraday series (1m/5m/15m/1h/4h all trim at
  //        exactly 60 days). ONLY `1d` reaches deeper — 296 days — and it does so by ACCIDENT:
  //        the refresh upserts 200 bars per timeframe each cycle, so ~290 days of daily bars are
  //        re-written continuously, over-supplying what the prune removes. The daily depth is a
  //        SIDE-EFFECT OF THE FETCH WINDOW, not a retention policy. `btc-halving-cycle`, in the
  //        ACTIVE `btc-speed-v1`, declares 365 daily bars; we hold 206. If the fetch limit ever
  //        drops below the deepest declaration, the series thins SILENTLY. A per-timeframe window
  //        is the shape that would make this deliberate. ⚠️ An earlier version of this note said
  //        the bound was "not applied" — that came from reading the GLOBAL `MIN(timestamp)` (296d,
  //        set by `1d`) and inferring there was no prune. The per-timeframe view refutes it.
  apiactivitylog:      { dateCol: 'timestamp',    defaultDays: 30,  envKey: 'DATA_RETENTION_APIACTIVITY_DAYS', label: 'API Activity Log' },

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // CLASS 2 — EVIDENCE FOR BACKTESTING: LONG.
  //
  // Owner, 2026-10-04: *"I understand the benefit of storing a year or even more of bar data and
  // potentially key news headlines, articles etc. For the purpose of backtesting relevant
  // directives that read that."*
  //
  // ⚠️ **THE REASON IS OPPOSITE TO CLASS 1.** These tables are not a record of what the app did —
  // they are **INPUTS A DIRECTIVE READS**. A directive declares how much history it needs
  // (`minBars`, e.g. `btc-halving-cycle: { '1d': 365 }`), and if retention is shallower than the
  // deepest declaration the directive is **STARVED SILENTLY** — a short bar array is a legitimate
  // state (a new symbol has no history), so nothing errors and the composite simply loses that
  // directive's vote.
  //
  // **THE RULE: a window here must not be tighter than the deepest `minBars` of any directive that
  // can run against it.** Depth is a functional requirement, not a storage preference.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ⚠️ RAISED 60 → 365 on 2026-10-04. The 60-day figure was MINE, not the owner's: they had been
  //    asking about *"general trading history and app activity"*, and bars were never in scope.
  //    The binding declaration is `btc-halving-cycle` at **365 daily bars**, in the ACTIVE
  //    `btc-speed-v1` — so 60 could never have satisfied it. See #1070.
  marketbar:           { dateCol: 'timestamp',    defaultDays: 365, envKey: 'DATA_RETENTION_BARS_DAYS',      label: 'Market Bars' },

  // ══ NEWS — DELIBERATELY UNBOUNDED, and that IS the owner's ask. Read before adding a bound. ══
  //
  // Owner, 2026-10-04: *"I understand the benefit of storing a year or even more of bar data and
  // potentially key news headlines, articles etc. For the purpose of backtesting relevant
  // directives that read that."*
  //
  // **"Storing" is the requirement — not "pruning at N days".** Directives read headlines and
  // sentiment (`news-momentum`, `earnings-momentum`, `crypto-fear-greed`), and a backtest cannot
  // retrieve what was pruned because the source only serves recent items. No bound keeps them,
  // which is what was asked for.
  //
  // ⚠️ BOTH news tables were ATTEMPTED and each was correctly rejected, for two DIFFERENT reasons —
  //    recorded because the reasons outlast the attempt:
  //
  //    `newsarticle` — its only write-time column is `importedAt`, which is not in the validator's
  //      intrinsic list. MEASURED 2026-10-04: of the **6** columns named `importedAt` in this
  //      database, **3 are DB-populated** (`DEFAULT_GENERATED utc_timestamp(3)`) and **3 are NOT** —
  //      `watchlist` plus two backups, where the value is app-written and nullable. Adding the bare
  //      NAME would therefore also license a bound on `watchlist.importedAt`, which is precisely
  //      the defect the guard exists to prevent. **A name whitelist cannot express a per-column
  //      fact, so the guard was NOT widened.**
  //      (`publishedAt` was tried first and rejected: it is when the ARTICLE was published, not when
  //      WE stored it, so a two-year-old article fetched today would be deleted on arrival.)
  //
  //    `news_item` — HAS `createdAt` (`NOT NULL DEFAULT_GENERATED`), so the column is right. It
  //      failed the SECOND rule: `createdAt` is not the leading column of any index, and the prune
  //      and health panel both need one. Adding an index to a 12,190-row table to satisfy a bound
  //      nobody asked to be tight is not worth a schema change on this database.
  //
  // TO BOUND THEM LATER, one of: rename `newsarticle.importedAt` → `createdAt` (aligning it with
  //    every other bounded table) and add an index on `news_item.createdAt`; or extend the validator
  //    to assert intrinsic-ness against the LIVE column rather than a name list.
  //
  // ⚠️ THIS MEANS THEY GROW SILENTLY — the state `apiactivitylog` was in at 1.3M rows / 249 MB.
  //    Measured 2026-10-03 they were small (`newsarticle` 20,034 rows / 14 MB, `news_item` 12,190 /
  //    6 MB), so this is a note with a number, not an emergency. Recorded on #1070.
};

/** Table → retention window, derived. Used by the health panel. */
export const RETENTION_DAYS: Record<string, number> = Object.fromEntries(
  Object.entries(RETENTION_TABLES).map(([t, c]) => [t, c.defaultDays]),
);

/**
 * resolveRetentionDays() — the ONE place an env override is applied to a retention window.
 *
 * ⚠️ WHY THIS IS A FUNCTION AND NOT `RETENTION_DAYS[table]`. `RETENTION_DAYS` is the derived
 * **default**; the EFFECTIVE window is `DATA_RETENTION_*` if set. A caller that reports
 * `RETENTION_DAYS[table]` therefore states a window that may not be the one in force — which is
 * exactly the defect #1117 describes: a number whose basis is invisible and can be wrong.
 *
 * ⚠️ THE PARSING IS PRESERVED BYTE-EQUIVALENT to the expression it replaces
 * (`parseInt(process.env[envKey] || String(defaultDays), 10)`) — including the quirk that an env
 * value of `'0'` resolves to **0 days**, which prunes everything older than now. Do not "fix" that
 * here: it is existing behaviour, and changing it silently would alter what the next prune deletes.
 *
 * ADR-014 — one implementation per concept. `data-retention.service.ts` had this inline; a second
 * copy in a controller would drift, and only one of them would get the next fix.
 */
export function resolveRetentionDays(table: string): number {
  const config = RETENTION_TABLES[table];
  if (!config) return 0;
  return Number.parseInt(process.env[config.envKey] || String(config.defaultDays), 10);
}

/** Table → retention date column, derived. */
export const TABLE_DATE_COLUMN: Record<string, string> = Object.fromEntries(
  Object.entries(RETENTION_TABLES).map(([t, c]) => [t, c.dateCol]),
);

/**
 * Columns the ARCHIVE endpoint accepts per table.
 *
 * ⚠️ READS ARE NOT WRITES. Archiving may slice by any meaningful column, so `predictedAt` is still
 * allowed for `directiveoutcome` — it is a legitimate way to ask "archive predictions made in July".
 * Only the DELETION bound needs an intrinsic column. Keeping the two concerns separate is the point;
 * conflating them is how `predictedAt` ended up governing retention in the first place.
 *
 * ⚠️ THIS IS A SQL-INJECTION WHITELIST. `table` and `dateCol` arrive as HTTP query params and are
 * interpolated into raw SQL, so these sets are the only thing standing between a query string and a
 * `DELETE`. Never loosen them to accept anything not listed here, and note this file is now the ONE
 * place to change them — `data-retention` no longer keeps a parallel list to fall out of step with.
 */
export const ARCHIVE_DATE_COLUMNS: Record<string, string[]> = {
  ...Object.fromEntries(Object.entries(TABLE_DATE_COLUMN).map(([t, c]) => [t, [c]])),
  // Additive: the retention key, plus prediction date for slicing.
  directiveoutcome: ['createdAt', 'predictedAt'],
};
