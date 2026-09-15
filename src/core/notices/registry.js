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
    cause: 'Trading is only permitted while the exchange session is open.',
    action: 'Wait for the session to open, or trade a symbol whose market is open. The signal is not lost — it stays on the board.',
    params: ['symbol'],
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
