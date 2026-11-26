/**
 * table-usage.data.ts — WHAT EACH TABLE IS FOR, declared once.
 *
 * ── Why this file exists ──────────────────────────────────────────────────────────────────────────
 * Measured 2026-11-25: the database held **~135 tables**, of which **four** carried almost all the
 * data. Nothing anywhere said which of them a bot reads while a position is open and which are
 * write-only records kept for diagnosis — so the only way to answer "is our history data sitting in
 * the hot path?" was to read the services. That question is asked every time someone tunes
 * retention, and answering it by reading the pipeline each time is how the same investigation is
 * repeated.
 *
 * ── WHAT THIS IS AND IS NOT ───────────────────────────────────────────────────────────────────────
 * ✅ It IS the *intent*: what a table is for, roughly how often it is written, and who reads it.
 * ❌ It is NOT measured at runtime. `readBy` and `writtenPer` are a **hand reading of the call sites**,
 *    verified by caller search on the date in the header. They can drift, exactly like any hand-kept
 *    map — so treat a value here as a claim. `'unknown'` is a legal value and means "not established",
 *    which is never rendered as "nothing reads it".
 * ❌ It is NOT a retention bound. Windows live in `retention.config.ts` and nowhere else.
 *
 * ── How to keep it honest ────────────────────────────────────────────────────────────────────────
 * `GET /api/database/table-stats` joins this against the LIVE table list. A table declared here that
 * the database does not have renders as **declared-but-missing**, and a real table with no entry
 * renders as **undeclared** — both visible, neither silent. So a rename shows up as a gap rather than
 * as a confident description of a table nobody declared.
 *
 * To re-verify one entry:
 *   rg "prisma\.<modelName>\." nest/src        # who touches it, from where
 *   rg "\.<modelName>\." nest/src --stats      # how many call sites
 *
 * ⚠️ A model name is not a table name. `MarketBar` is `marketbar`; `ScoreSnapshot` is `score_snapshot`.
 * The key below is the SQL name (lowercase), because that is what the API and phpMyAdmin use.
 */

/** What kind of data this is. The distinction that matters: is it STATE or is it a RECORD? */
export type TableClass =
  /** Current operational state a bot needs while running. Small by nature; never pruned on age. */
  | 'present'
  /** Read as INPUT (bars, news, earnings). Depth is a functional requirement — pruning starves a reader. */
  | 'input'
  /** A record of what happened, read on demand. Bounded by time; nothing downstream consumes it. */
  | 'history'
  /** Step-by-step audit trail written by a loop. Bounded tightly; read only when diagnosing. */
  | 'trace'
  /** Slow-changing definitions: protocols, directives, symbols, config. */
  | 'reference';

/** Where a read happens. `hot-path` = repeated by the scoring/trading loop while it runs. */
export type TableReadBy = 'hot-path' | 'cron' | 'ui' | 'unknown';

export interface TableUsage {
  /** One line: what this table is for. */
  purpose: string;
  class: TableClass;
  /** Rough write cadence in words — `per tick`, `per score run`, `on close`, `on import`, `manual`. */
  writtenPer: string;
  readBy: TableReadBy;
}

/**
 * The declarations. Deliberately not exhaustive: declaring 135 tables by hand would be a second,
 * rotting copy of `schema.prisma`. These are the tables whose role is non-obvious or whose size
 * matters — everything else reports as `undeclared`, which is a to-do list rather than a lie.
 *
 * ⚠️ Figures in the comments are MEASURED (2026-11-25, `COUNT(*)`) and are here to explain why the
 * entry exists, not to be quoted as current. The page reads the live count.
 */
export const TABLE_USAGE: Record<string, TableUsage> = {
  // ── PRESENT — the operational state, and the only thing a running bot truly needs ──────────────
  // Measured 2026-11-25: this whole class is under 6,000 rows. It is not, and will not soon be, a
  // performance problem — which is the answer to "is the trading loop reading history?".
  position: {
    purpose: 'Open positions. Reconciled against the broker every tick; drives the stop guardian.',
    class: 'present',
    writtenPer: 'per position sync',
    readBy: 'hot-path',
  },
  order: {
    purpose: 'Every bridge order attempt (success and failure) — the execution record.',
    class: 'present',
    writtenPer: 'per execution attempt',
    readBy: 'ui',
  },
  trade: {
    purpose: 'Closed trades. Source for P&L, strategy comparison and the decision trail.',
    class: 'present',
    writtenPer: 'on close',
    readBy: 'ui',
  },
  strategy_signal_queue: {
    purpose: 'Signals waiting to be dispatched to a bot. Drained by the automation loop.',
    class: 'present',
    writtenPer: 'per routed signal',
    readBy: 'hot-path',
  },

  // ── INPUT — depth is a FUNCTIONAL requirement, not a storage preference ─────────────────────────
  marketbar: {
    purpose: 'OHLCV bars. Every directive reads these; the 365-day window is set by the deepest minBars.',
    class: 'input',
    writtenPer: 'per bar refresh / import',
    readBy: 'hot-path',
  },
  newsarticle: {
    purpose: 'News stories for the sentiment directives. Deliberately unbounded — see retention.config.',
    class: 'input',
    writtenPer: 'on import',
    readBy: 'unknown',
  },
  news_item: {
    purpose: 'Headline-level news items used by the momentum directives.',
    class: 'input',
    writtenPer: 'on import',
    readBy: 'unknown',
  },
  earnings_event: {
    purpose: 'Earnings calendar. Read by the earnings directives and the calendar page.',
    class: 'input',
    writtenPer: 'on import',
    readBy: 'unknown',
  },

  // ── HISTORY — a record of what happened, read on demand ────────────────────────────────────────
  score: {
    purpose: 'One row per (symbol, protocol) scoring run, carrying the full per-directive breakdown JSON. Wide by design.',
    class: 'history',
    writtenPer: 'per score run',
    readBy: 'ui',
  },
  score_snapshot: {
    purpose: 'The long score history. Source of the rarity percentiles that drive position sizing bands.',
    class: 'history',
    writtenPer: 'per score run',
    readBy: 'hot-path',
  },
  macrosnapshot: {
    purpose: 'DXY / EURUSD regime per scoring run. Written so a regime change can be explained after the fact.',
    class: 'history',
    writtenPer: 'per score run',
    readBy: 'hot-path',
  },
  backtestrun: {
    purpose: 'A backtest run header.',
    class: 'history',
    writtenPer: 'per backtest',
    readBy: 'ui',
  },
  backtesttrade: {
    purpose: 'Trades produced by a backtest run. Pruned with its run, not by age.',
    class: 'history',
    writtenPer: 'per backtested trade',
    readBy: 'ui',
  },

  // ── TRACE — the step-by-step record, written by loops and read when diagnosing ─────────────────
  decision_log: {
    purpose: 'One row per decision per tick, with the reason text. The audit trail under a trade.',
    class: 'trace',
    writtenPer: 'per tick',
    readBy: 'ui',
  },
  automation_event: {
    purpose: 'Every step of the automation tick (tick_start, bars_fetched, scored, gated …).',
    class: 'trace',
    writtenPer: 'per tick step',
    readBy: 'ui',
  },
  directiveoutcome: {
    purpose: 'Each directive prediction plus whether it was right. Feeds edge statistics.',
    class: 'trace',
    writtenPer: 'per directive per score run',
    readBy: 'cron',
  },
  bridge_event: {
    purpose: 'MT5/T212 bridge state transitions (connected, disconnected, error).',
    class: 'trace',
    writtenPer: 'on state change',
    readBy: 'ui',
  },
  apiactivitylog: {
    purpose: 'One row per HTTP request: endpoint, status, duration. Pure telemetry.',
    class: 'trace',
    writtenPer: 'per request',
    readBy: 'ui',
  },
  signal_outcome_log: {
    purpose: 'Why a signal was blocked, conflicted or warned — write-on-change.',
    class: 'trace',
    writtenPer: 'on change',
    readBy: 'ui',
  },
  signal_outcome_meta: {
    purpose: 'Typed blockers/conflicts per signal entry, keyed for aggregation.',
    class: 'trace',
    writtenPer: 'on change',
    readBy: 'ui',
  },

  // ── REFERENCE — slow-changing definitions ──────────────────────────────────────────────────────
  trading_strategy: {
    purpose: 'The bots: symbol, protocol subscriptions, sizing, mode. Read afresh every tick.',
    class: 'reference',
    writtenPer: 'manual',
    readBy: 'hot-path',
  },
  strategy_protocol: {
    purpose: 'Which protocols a bot subscribes to. The queue routes by this, not by the bot row.',
    class: 'reference',
    writtenPer: 'manual',
    readBy: 'hot-path',
  },
  symbol: {
    purpose: 'Registered instruments. Looked up by ticker on every symbol scored.',
    class: 'reference',
    writtenPer: 'on onboarding',
    readBy: 'hot-path',
  },
  protocol: {
    purpose: 'Scoring protocols (the rules that produce a composite).',
    class: 'reference',
    writtenPer: 'on seed / manual',
    readBy: 'hot-path',
  },
  directive: {
    purpose: 'Directive definitions and weights.',
    class: 'reference',
    writtenPer: 'on seed / manual',
    readBy: 'hot-path',
  },
};

/** Tables the page highlights: a large table read by the loop is the one worth checking indexes on. */
export const HOT_PATH_TABLES = new Set(
  Object.entries(TABLE_USAGE)
    .filter(([, u]) => u.readBy === 'hot-path')
    .map(([t]) => t),
);
