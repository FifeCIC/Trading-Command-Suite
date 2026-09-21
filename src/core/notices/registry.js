/**
 * Notice registry — ONE catalogue for every message the app shows a human.
 * ========================================================================
 * Created 2026-09-15 (issue #824 was the trigger: a broker rejection arrived as the bare string
 * "Unsupported filling mode", with no symbol, no code and nothing to act on — and nothing in the
 * codebase could tell you where it came from).
 *
 * WHY THIS EXISTS
 * ---------------
 * Before this file the app had ~65 `throw new *Exception('prose')` sites across 52 files, ~77
 * inline `'error':` sites in the MT5 bridge and ~20 frontend files rendering error text. Every
 * message was a *string literal at the call site*:
 *
 *   - **Nothing to join on.** A log line, a UI card and a GitHub issue could not be correlated,
 *     because the only identifier was the wording.
 *   - **Rewording broke the link.** Fix a typo in a message and every prior reference to it died.
 *   - **Translation was impossible in practice.** Text was scattered across the codebase.
 *   - **No remedy.** Most messages said what went wrong and never what to do about it.
 *   - **Unsearchable.** "Unsupported filling mode" is the *broker's* wording; grepping this repo
 *     for it returns nothing.
 *
 * The fix is the one every mature system uses (Windows HRESULT, PostgreSQL SQLSTATE, MetaTrader
 * retcodes, Stripe error codes, RFC 7807 `problem+json`): **separate the stable CODE from the
 * human TEXT.**
 *
 *   the code identifies the condition  →  it never changes
 *   the text explains it               →  it can be reworded, translated, or rewritten
 *
 * ⚠️ NOTICE, NOT ERROR. This registry deliberately covers **every** severity — warnings, info and
 * success as well as errors — because they have the same problems and the same solution, and
 * because one catalogue is what makes translation tractable: all wording for a locale lives in one
 * place instead of in 130 call sites.
 *
 * HOW TO USE IT
 * -------------
 *   1. Add an entry here (metadata + English wording).
 *   2. At the call site, emit the CODE plus the DATA — never prose:
 *
 *        throw new TcsNotice('TCS-TRADE-001', { symbol, mode, broker, allowed });
 *        notice('TCS-TRADE-001', { symbol: 'XAGUSD', mode: 'FOK', broker: 'PepperstoneUK-Demo' })
 *
 *   3. Render with `notice()` — it returns title/message/cause/action already substituted.
 *
 * ⚠️ The server never sends wording. It sends `{ code, params }` and the client renders from this
 * registry. That is what makes translation possible, and it is why the NestJS side needs no shared
 * build with `src/` (the two roots share no code path — see shared-core.instructions.md).
 *
 * Enforced by `scripts/validate-notices.cjs` (runs in the backend `prebuild`): unknown codes,
 * malformed codes, undeclared placeholders and unused declarations all fail the build.
 */

// ─── Taxonomy ────────────────────────────────────────────────────────────

/**
 * Severity — how loudly this should present.
 *
 * `critical` and `error` are not the same thing: `critical` means **a human must intervene now**
 * (a safety gate tripped, the broker is unreachable); `error` means an operation failed and the
 * user should be told. `success` exists so confirmations are not hand-written prose either.
 */
export const SEVERITIES = ['critical', 'error', 'warning', 'info', 'success'];

/**
 * Areas — the prefix inside every code. Keep this list short; an area should map to a subsystem a
 * person could name, not to a file.
 */
export const AREAS = {
  TRADE: 'Trading and execution',
  SCORE: 'Scoring and signals',
  SIG: 'Signals workbench',
  DATA: 'Data, import and integrity',
  RISK: 'Risk and safety gates',
  INTEG: 'Broker and provider integrations',
  UI: 'Interface',
  SYS: 'System and platform',
};

/** Code shape: TCS-<AREA>-<3 digits>. Stable, greppable, sortable, prefix-searchable. */
export const CODE_PATTERN = /^TCS-([A-Z]{2,6})-(\d{3})$/;

// ─── The catalogue ───────────────────────────────────────────────────────

/**
 * Entry shape:
 *
 *   severity   one of SEVERITIES                                            (required)
 *   area       a key of AREAS — must equal the code's middle segment        (required)
 *   title      short label: a badge, a column, a tooltip head               (required)
 *   message    the sentence actually shown to a human                       (required)
 *   cause      WHY it happened — shown in a detail view/tooltip             (optional)
 *   action     WHAT TO DO — the part almost every message used to omit      (optional)
 *   params     every {placeholder} used above, declared once                (required, may be empty)
 *   external   the third-party code we are relaying, if any                 (optional)
 *   refs       GitHub issues / handoffs that explain it                     (optional)
 *
 * ⚠️ `message`/`cause`/`action` are TEMPLATES. Passing data from the call site (rather than the
 * caller assembling a sentence) is what lets a translator work on this file alone, and what stops
 * a caller from inventing a subtly different wording for the same condition.
 */
export const NOTICES = {
  // ── Trading / execution ────────────────────────────────────────────────
  'TCS-TRADE-001': {
    severity: 'error',
    area: 'TRADE',
    title: 'Order rejected — unsupported filling mode',
    message: 'The broker rejected {symbol} (filling={mode}).',
    cause:
      'The order asked for a filling mode this instrument does not allow. MT5 defaults to FOK when ' +
      'the mode is not set, and {broker} does not accept FOK for {symbol}.',
    action: 'The bridge now selects a supported mode from symbol_info().filling_mode. Modes the broker allows: {allowed}.',
    external: { system: 'MetaTrader 5', code: 10030, name: 'TRADE_RETCODE_INVALID_FILL' },
    params: ['symbol', 'mode', 'broker', 'allowed'],
    refs: ['#824'],
  },
  'TCS-TRADE-002': {
    severity: 'warning',
    area: 'TRADE',
    title: 'Order not sent — market closed',
    message: 'The market for {symbol} is closed, so the trade was blocked.',
    cause: '{reason}',
    action: 'Wait for the session to open, or trade a symbol whose market is open. The signal is not lost — it stays on the board.',
    params: ['symbol', 'reason'],
    refs: [],
  },
  'TCS-TRADE-003': {
    severity: 'error',
    area: 'TRADE',
    title: 'Not enough margin at the broker',
    message: 'The broker refused {symbol}: {required} margin required, {free} free.',
    cause: 'Open positions and pending orders already consume the free margin.',
    action: 'Reduce the size, close a position, or use a larger account.',
    params: ['symbol', 'required', 'free'],
    refs: [],
  },
  'TCS-TRADE-004': {
    severity: 'error',
    area: 'TRADE',
    title: 'Symbol not tradeable',
    message: '{symbol} cannot be traded on this account right now.',
    cause: 'The broker reports the symbol as close-only or disabled (trade mode {tradeMode}).',
    action: 'Check the symbol is enabled in Market Watch and that the account permits this instrument type.',
    params: ['symbol', 'tradeMode'],
    refs: [],
  },
  'TCS-TRADE-005': {
    severity: 'error',
    area: 'TRADE',
    title: 'Order was not placed',
    message: 'The order for {symbol} was not placed.',
    cause: '{detail}',
    action: 'Broker refusals carry a retcode — the bridge reports the symbol, the filling mode it tried and the modes the broker does allow. Nothing was sent to the market.',
    params: ['symbol', 'detail'],
    refs: ['#824'],
  },
  'TCS-TRADE-006': {
    severity: 'warning',
    area: 'TRADE',
    title: 'A plan already exists',
    message: 'A draft plan for {symbol} already exists, so none was created.',
    cause: 'Signals hand over to Trading as one draft plan per signal.',
    action: 'Open Trading Plans to review the existing draft rather than creating a second one.',
    params: ['symbol'],
    refs: ['#702'],
  },
  'TCS-TRADE-007': {
    severity: 'error',
    area: 'TRADE',
    title: 'Plan was not created',
    message: 'The draft plan for {symbol} could not be created.',
    cause: '{detail}',
    action: 'Retry, or queue it from the Trading area instead.',
    params: ['symbol', 'detail'],
    refs: ['#702'],
  },
  'TCS-TRADE-008': {
    severity: 'success',
    area: 'TRADE',
    title: 'Order placed',
    message: 'Order placed for {symbol} — ticket {orderId}.',
    action: 'Click the order to open it in the Positions Monitor.',
    params: ['symbol', 'orderId'],
    refs: [],
  },
  'TCS-TRADE-009': {
    severity: 'success',
    area: 'TRADE',
    title: 'Draft plan created',
    message: '{symbol} was queued as a draft plan.',
    action: 'Open it in Trading Plans to add size, stops and a threshold.',
    params: ['symbol'],
    refs: ['#702'],
  },
  'TCS-TRADE-010': {
    severity: 'error',
    area: 'TRADE',
    title: 'No price available',
    message: 'No quote for {symbol}, so the order could not be priced.',
    cause: 'The bridge could not read a tick for this symbol — it is usually not selected in Market Watch, or the market data feed is down.',
    action: 'Open the symbol in Market Watch (or check the feed), then retry. No order was sent.',
    params: ['symbol'],
    refs: [],
  },
  'TCS-TRADE-011': {
    severity: 'error',
    area: 'TRADE',
    title: 'Size below the symbol minimum',
    message: '{volume} lots is below the {symbol} minimum of {minimum}.',
    cause: 'Each symbol declares a minimum tradable volume; the broker rejects anything smaller.',
    action: 'Increase the size to at least {minimum}, or pick a symbol whose minimum your size can meet.',
    params: ['symbol', 'volume', 'minimum'],
    refs: [],
  },
  'TCS-TRADE-012': {
    severity: 'error',
    area: 'TRADE',
    title: 'Size above the symbol maximum',
    message: '{volume} lots is above the {symbol} maximum of {maximum}.',
    cause: 'The broker caps volume per order for this symbol.',
    action: 'Reduce the size to {maximum} or less, or split the position across orders.',
    params: ['symbol', 'volume', 'maximum'],
    refs: [],
  },
  'TCS-TRADE-013': {
    severity: 'error',
    area: 'TRADE',
    title: 'Spread too wide to trade',
    message: 'The spread on {symbol} is {spread}% — too wide to place this order.',
    cause: 'A spread above 5% of price means the quote is unreliable (thin liquidity, rollover, or a market open). Entering here would start the trade at a large loss.',
    action: 'Wait for liquidity to return. No order was sent.',
    params: ['symbol', 'spread'],
    refs: [],
  },
  'TCS-TRADE-014': {
    severity: 'error',
    area: 'TRADE',
    title: 'Position not found',
    message: 'No open position with ticket {ticket} on this account.',
    cause: 'It may already be closed, or it belongs to a different account slot.',
    action: 'Refresh the Positions Monitor. If it still appears there, the two brokers are out of step — check which account the position is on.',
    params: ['ticket'],
    refs: [],
  },
  'TCS-TRADE-015': {
    severity: 'warning',
    area: 'TRADE',
    title: 'Duplicate order suppressed',
    message: 'This order was already sent — reusing ticket {ticket} instead of placing a second one.',
    cause: 'The bridge keeps a short idempotency window keyed by clientOrderId, so a retry after a timeout cannot double the position.',
    action: 'Nothing to fix. If you intended a second trade, change the size or wait for the window to pass.',
    params: ['ticket'],
    refs: [],
  },
  'TCS-TRADE-016': {
    severity: 'error',
    area: 'TRADE',
    title: 'Blocked by the bridge size cap',
    message: '{volume} lots exceeds the bridge\u2019s own maximum position size of {maximum}.',
    cause: 'This is a safety cap in the bridge, not a broker limit — it applies before any order is sent.',
    // ⚠️ CORRECTED 2026-09-19 (#901). The #849 move (2026-09-17) took the caps out of `.env` for
    // the API-side check ONLY. The PYTHON BRIDGE still reads `MT5_MAX_POSITION_SIZE` from
    // `nest/.env` at IMPORT and enforces its own copy — and the bridge's copy is restart-bound.
    // The previous wording told the user the setting "applies live, with no restart", which is
    // true of the app setting and IRRELEVANT to a refusal the bridge produced. Measured: an
    // operator raised a cap, watched nothing change, and concluded the setting was ignored.
    action: 'Reduce the size, or raise the BRIDGE\u2019s copy of the cap: MT5_MAX_POSITION_SIZE in nest/.env, then RESTART the MT5 bridges. The app setting (risk.maxPositionSize) is enforced live by the backend, but it cannot move the bridge\u2019s own cap (#901).',
    params: ['volume', 'maximum'],
    refs: [],
  },
  'TCS-TRADE-017': {
    severity: 'error',
    area: 'TRADE',
    title: 'Blocked by the bridge position count',
    message: 'Already holding {open} position(s) — the bridge cap is {maximum}.',
    cause: 'This is a safety cap in the bridge, not a broker limit.',
    // ⚠️ CORRECTED 2026-09-19 (#901) — see the note on TCS-TRADE-016 above. This refusal comes
    // from the BRIDGE's env-read copy (`MT5_MAX_OPEN_POSITIONS`, read once at import), NOT from
    // `risk.maxOpenPositions`. The old action named the app setting and promised no restart — so
    // a user raised risk.maxOpenPositions to 100 and the bridge still refused at 5. Both values
    // and the restart are named here now; the health page's Risk Cap Alignment check reports a
    // divergence before it can bite.
    action: 'Close a position, or raise the BRIDGE\u2019s copy of the cap: MT5_MAX_OPEN_POSITIONS in nest/.env, then RESTART the MT5 bridges. The app setting (risk.maxOpenPositions) is enforced live by the backend, but it cannot move the bridge\u2019s own cap — the lower of the two binds (#901).',
    params: ['open', 'maximum'],
    refs: [],
  },

  // ── Integrations ─────────────────────────────────────────
  'TCS-INTEG-001': {
    severity: 'critical',
    area: 'INTEG',
    title: 'MT5 bridge not connected',
    message: 'The MT5 bridge could not reach the terminal, so the request was not sent.',
    cause: '{detail}',
    action: 'Confirm the MT5 terminal is running and logged in, then check the bridge is listening (ports 5000/5001) and /health reports connected. Nothing was sent to the market.',
    params: ['detail'],
    refs: [],
  },
  'TCS-INTEG-002': {
    severity: 'critical',
    area: 'INTEG',
    title: 'MT5 circuit breaker open',
    message: 'Requests to MT5 are paused after repeated failures, so the order was not sent.',
    cause: '{detail}',
    action: 'The breaker closes itself after the cooldown. If it keeps tripping, the terminal or bridge is genuinely down — fix that first rather than retrying.',
    params: ['detail'],
    refs: [],
  },

  // ── Data integrity ─────────────────────────────────────────────────────
  'TCS-DATA-001': {
    severity: 'error',
    area: 'DATA',
    title: 'Text encoding corrupted (mojibake)',
    message: '{count} character sequence(s) in {file} are corrupted.',
    cause:
      'UTF-8 text was read or written as CP1252 or CP850, so multi-byte characters were stored as ' +
      'several wrong ones. The usual culprit is a SQL seed applied without --default-character-set=utf8mb4.',
    action: 'Run `node scripts/fix-mojibake.cjs {file}` (dry run first), then fix whatever consumed the file.',
    params: ['count', 'file'],
    refs: ['#815'],
  },

  // ── Feed freshness (starved symbols) ───────────────────────────────────
  //
  // SCOPE NOTE — why these exist at all. #827 stopped stale symbols being scored, and logged a
  // warning when it did. The *log* was enough for an agent reading a terminal and NOT enough for a
  // person looking at the app: a symbol whose bars have stopped simply stops appearing on the
  // ladder, which is indistinguishable from "no signal right now". These codes give that condition
  // a surface. `BarRefreshStatus.starvedSymbols` already computed the data (see
  // bar-refresh.service.ts) — it had no renderer.
  //
  // ⚠️ These describe TWO DIFFERENT CONDITIONS that must never be collapsed into one message:
  //   TCS-DATA-002  the symbol has NEVER produced a bar   (a routing/setup fault)
  //   TCS-DATA-003  the symbol produced bars and STOPPED  (a feed that has gone quiet)
  // Both are served with `newestBar: null` vs a timestamp. A UI that shows "stale" for both
  // sends someone hunting a provider outage when the real fault is a symbol that was never routed.
  'TCS-DATA-002': {
    severity: 'warning',
    area: 'DATA',
    title: 'No bars at all',
    message: '{symbol} has no bars on any timeframe.',
    cause:
      'The symbol is being scored, but nothing has ever been ingested for it. Its absence from the ' +
      'ladder therefore looks like "no signal today" rather than "no data at all".',
    action:
      'Check that the symbol is routed to a live provider feed. Until bars exist it cannot produce ' +
      'a prediction, however healthy the protocol is.',
    params: ['symbol'],
    refs: ['#827', '#841'],
  },
  'TCS-DATA-003': {
    severity: 'warning',
    area: 'DATA',
    title: 'Feed stopped',
    message: '{symbol} last produced a bar {hours} hours ago.',
    cause:
      'Bars stopped arriving while the symbol stayed on the scoring watchlist, so it silently drops ' +
      'off the ladder. Nightly session breaks and weekends are normal; a gap beyond the cadence ' +
      'tolerance is not.',
    action:
      'Check the provider for {symbol}. Scoring is suppressed until its bars are fresh again, so no ' +
      'signal is being lost while it is quiet.',
    params: ['symbol', 'hours'],
    refs: ['#827', '#841'],
  },
  'TCS-DATA-004': {
    severity: 'error',
    area: 'DATA',
    title: 'Feed freshness unknown',
    message: 'Could not check which symbols have stopped producing bars.',
    cause: '{detail}',
    action:
      'This is NOT an all-clear — the feed may have stalled. An empty list and a failed query must ' +
      'never look the same, which is exactly why {ref} is surfaced rather than swallowed.',
    params: ['detail', 'ref'],
    refs: ['#841'],
  },
  'TCS-DATA-005': {
    severity: 'warning',
    area: 'DATA',
    title: 'Symbols have stopped producing bars',
    message:
      '{count} scored symbol(s) are not producing fresh bars — {noData} with no data at all and ' +
      '{stopped} that stopped part-way.',
    cause:
      'A stale symbol returns no score, which is indistinguishable from "no signal right now". The ' +
      'count is the only thing that makes the difference visible.',
    action: 'Work through the rows below — a "no bars at all" row is a routing fault, a "feed stopped" row is a provider fault.',
    params: ['count', 'noData', 'stopped'],
    refs: ['#827', '#841'],
  },
  'TCS-DATA-006': {
    severity: 'success',
    area: 'DATA',
    title: 'All feeds fresh',
    message: 'All {count} scored symbol(s) have bars inside their cadence tolerance.',
    params: ['count'],
    refs: ['#841'],
  },

  // ── Scoring ────────────────────────────────────────────────────────────
  'TCS-SCORE-001': {
    severity: 'info',
    area: 'SCORE',
    title: 'Not enough data to judge edge',
    message: 'Only {trades} closed trade(s) over {days} day(s) — too few to call this an edge.',
    cause: 'Below about 30 trades a single outlier moves the average more than any property of the strategy.',
    action: 'Keep collecting, or read the ratio as a tail observation rather than a diagnosed problem.',
    params: ['trades', 'days'],
    refs: ['#805'],
  },

  // ── Risk / safety ──────────────────────────────────────────────────────
  'TCS-RISK-001': {
    severity: 'warning',
    area: 'RISK',
    title: 'Trade blocked by a safety gate',
    message: 'The trade was blocked: {reason}',
    cause: 'A pre-trade safety gate rejected the order before it reached the broker.',
    action: 'Clear the blocker named above, or adjust the strategy so it does not trip this gate.',
    params: ['reason'],
    refs: [],
  },
  'TCS-RISK-002': {
    severity: 'warning',
    area: 'RISK',
    title: 'Directives disagree',
    message: '{description}',
    cause: 'The protocol\u2019s directives conflict: type {type}, severity {severity}.',
    action: 'Expect lower conviction while directives conflict — the aggregate is averaging opposing views.',
    params: ['description', 'type', 'severity'],
    refs: [],
  },
  'TCS-RISK-003': {
    severity: 'warning',
    area: 'RISK',
    title: 'Risk gate warning',
    message: '{warning}',
    cause: 'The risk gate raised this warning. Warnings modify the composite; they do not veto it.',
    action: 'Review it before sizing. A warning that repeats across signals is worth investigating at the gate, not on the card.',
    params: ['warning'],
    refs: [],
  },

  // ── System ─────────────────────────────────────────────────────────────
  'TCS-SYS-001': {
    severity: 'error',
    area: 'SYS',
    title: 'Unknown notice code',
    message: 'Notice code {code} is not registered, so it cannot be explained.',
    cause: 'A caller emitted a code that is missing from src/core/notices/registry.js.',
    action: 'Register the code, or correct the caller. The code is shown deliberately — an unknown code is never blanked.',
    params: ['code'],
    refs: [],
  },
  'TCS-SYS-002': {
    severity: 'error',
    area: 'SYS',
    title: 'Request failed',
    message: 'The request to the API failed (HTTP {status}).',
    cause: '{detail}',
    action: 'Check the API is running, then retry. The status identifies the class: 400 request rejected, 404 not found, 409 conflict, 5xx server fault.',
    params: ['status', 'detail'],
    refs: [],
  },
  'TCS-SYS-003': {
    severity: 'error',
    area: 'SYS',
    title: 'Request timed out',
    message: 'The API did not answer within {seconds}s, so the request was abandoned.',
    cause:
      'The CLIENT gave up. Its timeout is set just below the server\u2019s 30s deadline, so a slow query ' +
      'usually surfaces here rather than hanging the page. If the server gave up first the code is ' +
      'TCS-SYS-005 instead — the difference tells you which side was still waiting.',
    action: 'Retry. If it keeps timing out, the backend is busy or the query is slow — check the API logs.',
    params: ['seconds'],
    refs: [],
  },
  'TCS-SYS-004': {
    severity: 'error',
    area: 'SYS',
    title: 'Request rejected before it ran',
    message: 'The request was rejected before it reached the endpoint: {count} field(s) are not valid.',
    cause: 'Fields rejected: {fields}',
    action:
      'Correct the named field(s) and send the request again. Field paths use dot notation for nested ' +
      'objects, so `body.volume` means the `volume` property of the request body.',
    params: ['count', 'fields'],
    refs: ['#826'],
  },
  'TCS-SYS-005': {
    severity: 'error',
    area: 'SYS',
    title: 'API request exceeded its deadline',
    message: 'The API abandoned this request after {seconds}s without producing an answer.',
    cause:
      'The SERVER gave up. The endpoint did not return inside its own deadline (TimeoutInterceptor). ' +
      'A slow query, an unresponsive provider, or a missing await is the usual cause.',
    action: 'Retry once. If it repeats, the API log names the route that timed out, against this same code.',
    params: ['seconds'],
    refs: ['#826'],
  },
  'TCS-SYS-006': {
    severity: 'error',
    area: 'SYS',
    title: 'Unexpected server error',
    message: 'The API hit an unexpected error while handling this request (HTTP {status}).',
    cause: '{detail}',
    action:
      'This is a bug, not a condition you can clear. Report the code shown above with what you were ' +
      'doing — the API log holds the stack against the same code.',
    params: ['status', 'detail'],
    refs: ['#826'],
  },

  // ── Signals workbench ────────────────────────
  'TCS-SYS-007': {
    severity: 'error',
    area: 'SYS',
    title: 'Action failed',
    message: 'The request to {operation} failed.',
    cause: '{detail}',
    action:
      'Retry. If it keeps failing, the API log names the route against this same code. Nothing was ' +
      'changed by the attempt.',
    params: ['operation', 'detail'],
    refs: ['#826'],
  },
  'TCS-SYS-008': {
    severity: 'error',
    area: 'SYS',
    title: 'Verification probe failed',
    message: 'The claim could not be verified — the probe did not complete.',
    cause: '{detail}',
    action:
      'Check the API is running, then re-run the check. An unprobed claim is reported as UNVERIFIED, ' +
      'never as passing.',
    params: ['detail'],
    refs: ['#938'],
  },
  'TCS-SIG-001': {
    severity: 'error',
    area: 'SIG',
    title: 'Signals list unavailable',
    message: 'The ranked signals could not be loaded.',
    cause: '{detail}',
    action: 'Retry. If it persists, confirm the API is running and that /api/signals/best responds.',
    params: ['detail'],
    refs: ['#684'],
  },
  'TCS-SIG-002': {
    severity: 'error',
    area: 'SIG',
    title: 'Signal not dismissed',
    message: 'The signal could not be hidden.',
    cause: '{detail}',
    action: 'Retry, or use the Show dismissed toggle to confirm nothing was hidden.',
    params: ['detail'],
    refs: [],
  },
  'TCS-SIG-003': {
    severity: 'success',
    area: 'SIG',
    title: 'Signal dismissed',
    message: 'Hidden for the next {hours}h.',
    action: 'Use Show dismissed to bring it back early.',
    params: ['hours'],
    refs: [],
  },
};

// ─── Locale seam ─────────────────────────────────────────────────────────
//
// English wording lives inline in NOTICES so there is one file to read today. A translation is
// added WITHOUT touching the call sites or the metadata: register a map of code -> wording.
//
//   registerLocale('fr', { 'TCS-TRADE-001': { title: '…', message: '…', cause: '…', action: '…' } });
//   setNoticeLocale('fr');
//
// ⚠️ A locale only overrides the fields it provides; anything missing falls back to English rather
// than rendering an empty box. Codes stay identical across languages — that is the whole point:
// support, logs, tests and GitHub issues refer to the code, never the sentence.

const locales = new Map();
let currentLocale = 'en';

export function registerLocale(locale, messages) {
  if (!locale || typeof messages !== 'object' || messages === null) {
    throw new TypeError('registerLocale(locale, messages) needs a locale name and a message map');
  }
  locales.set(locale, messages);
}

export function setNoticeLocale(locale) {
  currentLocale = locale || 'en';
}

export function getNoticeLocale() {
  return currentLocale;
}

function wordingFor(code, def) {
  const override = locales.get(currentLocale)?.[code];
  if (!override) return def;
  return { ...def, ...override };
}

// ─── Rendering ───────────────────────────────────────────────────────────

/**
 * Substitute `{placeholder}` from `params`.
 *
 * ⚠️ An unresolved placeholder is LEFT VISIBLE (`{symbol}`), never blanked. A message that reads
 * "The broker rejected ." hides the fact that a field was missing; one that reads "rejected
 * {symbol}" reports its own defect. Same principle as the unknown-code path below.
 */
export function renderTemplate(template, params = {}) {
  if (template == null) return '';
  return String(template).replace(/\{(\w+)\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(params, key) && params[key] != null && params[key] !== ''
      ? String(params[key])
      : match,
  );
}

/**
 * Look up a code and return a fully rendered notice.
 *
 * `notice('TCS-TRADE-001', { symbol: 'XAGUSD', mode: 'FOK' })` →
 *   { code, severity, area, title, message, cause, action, external, refs, params, known: true }
 *
 * An unregistered code does NOT throw and does NOT return null: it returns `known: false` with the
 * code in the text, so a missing registration is visible in the UI instead of showing nothing.
 */
export function notice(code, params = {}) {
  const def = NOTICES[code];

  if (!def) {
    const fallback = NOTICES['TCS-SYS-001'];
    return {
      code,
      known: false,
      severity: fallback.severity,
      area: fallback.area,
      title: renderTemplate(fallback.title, { code }),
      message: renderTemplate(fallback.message, { code }),
      cause: renderTemplate(fallback.cause, { code }),
      action: renderTemplate(fallback.action, { code }),
      external: null,
      refs: [],
      params,
    };
  }

  const w = wordingFor(code, def);
  return {
    code,
    known: true,
    severity: def.severity,
    area: def.area,
    title: renderTemplate(w.title, params),
    message: renderTemplate(w.message, params),
    cause: renderTemplate(w.cause, params),
    action: renderTemplate(w.action, params),
    external: def.external || null,
    refs: def.refs || [],
    params,
  };
}

/** One-line form, for logs, journals and card badges. */
export function noticeLine(code, params = {}) {
  const n = notice(code, params);
  return `[${n.code}] ${n.title}: ${n.message}`;
}

/** Every registered code, for tooling (docs generation, pickers, the validator). */
export function listNotices() {
  return Object.entries(NOTICES).map(([code, def]) => ({ code, ...def }));
}

/** Does this string look like a notice code? Used by the validator to scan call sites. */
export function isNoticeCode(value) {
  return typeof value === 'string' && CODE_PATTERN.test(value);
}
