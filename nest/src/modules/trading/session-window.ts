/**
 * ⚠️ AXIS: this is the BOT-POLICY axis — "when may THIS BOT act?" (a strategy choice, declared
 * per bot in `trading_strategy.sessionWindow`). It is NOT the venue axis
 * (`calendar/market-calendar.service.ts`) and NOT the FX-session axis
 * (`calendar/market-sessions.service.ts`). A bot's window is a policy the owner sets; the other two
 * are facts about the market. See #851.
 *
 * ⚠️ "SINGLE SOURCE OF TRUTH" below means *within this axis*.
 *
 * session-window.ts — Canonical market-session definitions + pure evaluator.
 * ========================================================================
 * SINGLE SOURCE OF TRUTH for "which market session is it right now".
 *
 * Two consumers, one definition (shared-core rule — never duplicate):
 *   1. MarketContextService  — scoring context / display (`getContext()`)
 *   2. automation-loop.service `processSignalQueues()` — the SESSION GATE
 *
 * Why this file exists
 * --------------------
 * Bots were named "London EURGBP Session", "Tokyo USDJPY Session",
 * "Sydney AUDUSD Session" — but nothing enforced those names. The loop ran
 * 24/7 and a bot traded whenever its threshold was met, regardless of which
 * market was actually open. The name was a label, not a rule.
 *
 * The session gate turns the label into a rule: a bot declares which
 * session(s) it is allowed to act in, and the loop skips it outside them.
 *
 * Design notes
 * ------------
 * - Times are defined in **ET (America/New_York)** to match the existing
 *   MarketContextService definitions, which were already in ET.
 * - ⚠️ DST is now resolved for real (2026-09-15), via `minutesInZone()` from
 *   `common/utils/session-time`. It was previously APPROXIMATED BY MONTH, which treated all of
 *   March and all of November as EDT and put every session boundary an hour out for ~36 days a
 *   year. The old note read "replace with a real tz library only as a deliberate change, since
 *   it shifts every session boundary" — this IS that change, and it was made in both copies of
 *   the rule at once so they cannot disagree.
 * - Pure functions only: no DI, no Prisma, no clock. Callers pass `at`.
 * - Session windows may wrap past midnight (Asian opens 19:00, closes 04:00).
 */
import { minutesInZone } from '../../common/utils/session-time';

export type SessionTag = 'asian' | 'london' | 'us';

export interface SessionDef {
  tag: SessionTag;
  /** Display name as used by MarketContextService. */
  name: string;
  startH: number;
  startM: number;
  endH: number;
  endM: number;
  /** Human time range, ET. */
  timeRange: string;
  /** Short UK-time hint for the trading UI copy. */
  ukLabel: string;
}

/** Session definitions in ET (America/New_York). */
export const SESSION_DEFS: SessionDef[] = [
  { tag: 'asian', name: 'Asian', startH: 19, startM: 0, endH: 4, endM: 0, timeRange: '7pm–4am ET', ukLabel: '00:00–09:00 UK' },
  { tag: 'london', name: 'London', startH: 3, startM: 0, endH: 12, endM: 0, timeRange: '3am–12pm ET', ukLabel: '08:00–17:00 UK' },
  { tag: 'us', name: 'US', startH: 9, startM: 30, endH: 16, endM: 0, timeRange: '9:30am–4pm ET', ukLabel: '14:30–21:00 UK' },
];

const BY_TAG = new Map<SessionTag, SessionDef>(SESSION_DEFS.map((s) => [s.tag, s]));
const BY_NAME = new Map<string, SessionDef>(SESSION_DEFS.map((s) => [s.name.toLowerCase(), s]));

/**
 * Vocabulary aliases → canonical tag. Exists because the bot *names* and the
 * historic seed field used city words ("Tokyo", "Sydney", "Zurich") rather than
 * session words. Accepting them means the column is writable by a human
 * without knowing the canonical tags, and the old vocabulary keeps working.
 * 'always' / '24-7' map to null = no tag = UNGATED (they mean "any time").
 *
 * ⚠️ THE CITY WORDS ARE THE HAZARD, NOT THE FEATURE (#759)
 * ------------------------------------------------------
 * A city alias means two different things depending on who wrote it:
 *
 *   "we trade this during the Tokyo SESSION"       → a trading clock   (intended)
 *   "this pair is DRIVEN by Tokyo news"            → news flow, NOT a clock
 *
 * The second reading is what the seeded bots used. "Sydney AUDUSD Session",
 * "Tokyo USDJPY Session" and "Wellington NZDUSD Session" name the city whose
 * data drives the pair — AUD news is Sydney, JPY news is Tokyo, NZD news is
 * Wellington. Reading those as clocks gated all three to 19:00–04:00 ET, so
 * they were shut through the entire London and US sessions while the app looked
 * idle rather than gated. AUDUSD scored 100% STRONG_BUY with zero blockers and
 * still produced no order.
 *
 * The aliases stay (removing them would silently UN-gate those bots, which is
 * the opposite of a fix). Instead the gate reports when a city alias is what
 * decided the outcome — see `cityAliasUsed` and CITY_ALIASES below — so the
 * ambiguity is visible instead of inferred.
 */
const ALIASES: Record<string, SessionTag | null> = {
  asia: 'asian', asian: 'asian', tokyo: 'asian', sydney: 'asian', wellington: 'asian',
  london: 'london', europe: 'london', european: 'london', zurich: 'london',
  frankfurt: 'london', paris: 'london',
  us: 'us', usa: 'us', newyork: 'us', ny: 'us', america: 'us',
  always: null, any: null, '24/7': null, '24h': null, none: null,
  // ── DECLARED all-hours (#982) ──
  // The EXPLICIT positive choice, distinguishable from an unfilled slot. `NULL` stopped meaning
  // "opt-in" and now reads as UNFILLED (see sessionSlotKind below); these words are how a bot says
  // "I may act at any hour" on purpose. Same gate semantics as the legacy null-aliases above
  // (no tag ⇒ ungated) — the difference is VISIBILITY, not behaviour.
  'all-hours': null, bypass: null,
};

/**
 * Which CITY word (if any) appears in a bot NAME (#759).
 *
 * ⚠️ THE HAZARD IS THE NAME, NOT THE WINDOW VALUE
 * ----------------------------------------------
 * The stored `sessionWindow` column holds the CANONICAL tags
 * ('asian' | 'london' | 'us') — verified against the live table, where
 * "Sydney AUDUSD Session" carries the literal `asian`. So parsing the window
 * value cannot detect the ambiguity: by the time it is a column value, the
 * decision has already been made and looks deliberate.
 *
 * The ambiguity lives in the NAME. Those three bots are named after the CITY
 * whose news drives the pair — AUD news is Sydney, JPY news is Tokyo, NZD news
 * is Wellington — but their window says `asian`, which is a TRADING CLOCK
 * (19:00–04:00 ET). Read as a clock, the window shuts them through London and
 * the entire US session, and the name "Sydney … Session" makes that look
 * intentional to anyone auditing the list.
 *
 * The question this answers is therefore: "does the NAME and the WINDOW agree
 * about what kind of thing this is?" A city name with a session tag is
 * consistent with BOTH readings, so it is reported as ambiguous rather than
 * assumed correct. A name carrying a session word that disagrees with the tag
 * ("London … Session" with window `us`) is a plain contradiction and is
 * reported as such. This function only classifies — it never changes a gate.
 */
export type NameWindowAgreement = 'consistent' | 'ambiguous' | 'contradictory';

export interface NameWindowAudit {
  agreement: NameWindowAgreement;
  /** The city word found in the name, if any. */
  cityWord: string | null;
  /** The session word found in the name, if any. */
  sessionWord: SessionTag | null;
  /** The tag(s) the window actually declares. */
  windowTags: SessionTag[];
  /** One-line explanation for logs/UI. */
  note: string;
}

/** City words that name a NEWS FLOW rather than a trading clock. */
const CITY_WORDS = new Set(['sydney', 'tokyo', 'wellington', 'zurich', 'frankfurt', 'paris', 'newyork']);

/**
 * Classify whether a bot's NAME agrees with its sessionWindow VALUE.
 *
 * Deliberately pure and name-only: the caller decides what to do with an
 * 'ambiguous' verdict. Silently rewriting the window would be a trading
 * behaviour change dressed as a bug fix, and the operator is the only one who
 * can answer "did you mean the clock or the news flow?".
 */
export function auditNameVsWindow(name: unknown, raw: unknown): NameWindowAudit {
  const windowTags = parseSessionWindow(raw);
  const lower = String(name ?? '').toLowerCase();

  const cityWord = [...CITY_WORDS].find((c) => lower.includes(c)) ?? null;

  // A session word in the NAME. Reuse the alias table so 'europe'/'asia' count.
  let sessionWord: SessionTag | null = null;
  for (const [word, tag] of Object.entries(ALIASES)) {
    if (!tag) continue;
    if (CITY_WORDS.has(word)) continue;         // city words are not session words
    if (new RegExp(`\\b${word}\\b`).test(lower)) { sessionWord = tag; break; }
  }

  if (windowTags.length === 0) {
    return {
      agreement: 'consistent',
      cityWord,
      sessionWord,
      windowTags,
      note: cityWord
        ? `name references ${cityWord} but the bot is UNGATED — no clock is enforced`
        : 'ungated — no clock is enforced',
    };
  }

  if (sessionWord && !windowTags.includes(sessionWord)) {
    return {
      agreement: 'contradictory',
      cityWord,
      sessionWord,
      windowTags,
      note: `name says "${sessionWord}" but the window declares ${windowTags.join('/')} — the name and the rule disagree`,
    };
  }

  if (cityWord) {
    return {
      agreement: 'ambiguous',
      cityWord,
      sessionWord,
      windowTags,
      note: `name references the city "${cityWord}" and the window declares the ${windowTags.join('/')} clock — read as the clock this gates the bot outside ${windowTags.join('/')} hours; if the name meant "driven by ${cityWord} news" the window is enforcing the wrong thing`,
    };
  }

  return {
    agreement: 'consistent',
    cityWord,
    sessionWord,
    windowTags,
    note: `window declares ${windowTags.join('/')}`,
  };
}

/**
 * Convert a UTC instant to minutes-since-midnight in ET.
 *
 * ⚠️ DST-CORRECT as of 2026-09-15. This previously approximated DST by MONTH
 * (`month >= 2 && month <= 10`) — which treats ALL of March and ALL of November as EDT.
 * Real US DST 2026 runs **8 Mar → 1 Nov**, so the ET clock was **an hour out for ~36 days a
 * year**, moving every session boundary. It now delegates to `minutesInZone()`, the owner,
 * which resolves the zone's actual offset at the actual instant via `Intl`.
 *
 * ⚠️ WHY THIS AND `market-context.service.ts` MUST CHANGE TOGETHER — the previous comment here
 * read: *"identical to the historic MarketContextService behaviour, so session boundaries do
 * not move as a side effect of this file."* That was TRUE and DELIBERATE: the duplicate existed
 * to avoid moving boundaries while doing something unrelated. The consequence is that fixing
 * one alone would make the two implementations DISAGREE, which is worse than both being
 * consistently wrong. They are now both correct, and both read from one owner.
 */
export function toEtMinutes(at: Date): number {
  return minutesInZone(at, 'America/New_York');
}

/** True when `at` falls inside the named session's window (wraps midnight). */
export function isSessionOpen(tag: SessionTag, at: Date = new Date()): boolean {
  const def = BY_TAG.get(tag);
  if (!def) return false;
  const start = def.startH * 60 + def.startM;
  let end = def.endH * 60 + def.endM;
  if (end <= start) end += 24 * 60; // wraps past midnight
  let now = toEtMinutes(at);
  // Same normalisation the context service applies: an early-morning `now`
  // belongs to the window that began the previous evening.
  if (now < start && end > 24 * 60) now += 24 * 60;
  return now >= start && now < end;
}

/** Tags of every session currently open. */
export function getActiveSessions(at: Date = new Date()): SessionTag[] {
  return SESSION_DEFS.filter((s) => isSessionOpen(s.tag, at)).map((s) => s.tag);
}

/**
 * Normalise a persisted `trading_strategy.sessionWindow` value into tags.
 * Accepts a JSON array, a comma-separated string, or a single tag.
 * Unknown tags are dropped (never throws — a corrupt value means "no gate").
 */
export function parseSessionWindow(raw: unknown): SessionTag[] {
  if (raw === null || raw === undefined || raw === '') return [];
  let parts: unknown[] = [];
  if (Array.isArray(raw)) {
    parts = raw;
  } else if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        parts = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        return [];
      }
    } else {
      parts = trimmed.split(',');
    }
  } else {
    return [];
  }
  const out: SessionTag[] = [];
  for (const p of parts) {
    const key = String(p ?? '').trim().toLowerCase();
    if (!key) continue;
    // Alias first (hasOwnProperty so an explicit null alias, e.g. 'always',
    // is honoured as "no tag" rather than falling through to a name lookup).
    let tag: SessionTag | undefined;
    if (Object.prototype.hasOwnProperty.call(ALIASES, key)) {
      tag = ALIASES[key] ?? undefined;
    } else {
      tag = BY_TAG.has(key as SessionTag) ? (key as SessionTag) : BY_NAME.get(key)?.tag;
    }
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out;
}

export interface SessionGateResult {
  /** False → the bot must not act right now. */
  ok: boolean;
  /** Declared sessions (empty = ungated bot). */
  allowed: SessionTag[];
  /** Sessions currently open. */
  active: SessionTag[];
  /** Set when `ok === false` — a ready-to-log reason. */
  reason?: string;
}

/**
 * THE SESSION GATE.
 *
 * An ungated bot (no declared window) always passes — the gate is opt-in, so
 * adding it never changes the behaviour of a strategy that has not opted in.
 *
 * ⚠️ Scope: this function answers ONE question — "is `at` inside the declared
 * window". It deliberately does NOT judge whether the window was a good idea.
 * Whether a name and a window mean the same thing is a separate, non-clock
 * question answered by `auditNameVsWindow()`, and keeping the two apart is what
 * stops this gate from quietly rewriting a bot's trading hours (#759).
 */
export function checkSessionWindow(raw: unknown, at: Date = new Date()): SessionGateResult {
  const allowed = parseSessionWindow(raw);
  if (allowed.length === 0) return { ok: true, allowed, active: [] };

  const activeNow = allowed.filter((t) => isSessionOpen(t, at));
  if (activeNow.length > 0) return { ok: true, allowed, active: activeNow };

  const all = getActiveSessions(at);
  const openNames = all.length
    ? all.map((t) => BY_TAG.get(t)?.name ?? t).join('/')
    : 'none';
  const allowedNames = allowed.map((t) => BY_TAG.get(t)?.name ?? t).join('/');
  return {
    ok: false,
    allowed,
    active: all,
    reason: `outside ${allowedNames} session (open: ${openNames})`,
  };
}

/** Human-readable window for logs/UI. Empty string when ungated. */
export function describeSessionWindow(raw: unknown): string {
  const tags = parseSessionWindow(raw);
  if (tags.length === 0) return 'any session';
  return tags.map((t) => BY_TAG.get(t)?.name ?? t).join(' / ');
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// THE PER-BOT STATE RECORD (#981) — "what is this bot's session state RIGHT NOW?"
// ══════════════════════════════════════════════════════════════════════════════════════════════
//
// ⚠️ WHY THIS EXISTS — THE AUDIT THAT COULD NEVER FIRE
// ---------------------------------------------------
// `auditNameVsWindow()` was written to catch a bot whose NAME implies a session window its CONFIG
// does not declare. It was called from ONE place: inside `logSessionSkip()`, which only runs when
// `checkSessionWindow()` returns a SKIP. Measured 2026-09-23 — and this is the defect #981 names:
//
//     sessionWindow: NULL  →  ungated (documented opt-in)  →  checkSessionWindow returns ok
//                          →  no skip logged               →  audit NEVER runs
//
// So the check written to catch an unfilled slot was structurally unable to observe one. Three bots
// sat with `sessionWindow = NULL` while their names implied `asian`/`london` — "Sydney AUDJPY
// Session" opened a position 14-17 minutes before the US cash open, carrying a 298-minute-old
// signal, and nothing on any surface said why.
//
// THE FIX IS A SEPARATE, PER-TICK EVALUATION over EVERY active bot — gated, ungated, or open —
// recorded on the loop's per-bot state and exposed via `GET /api/automation/status`. The gate
// itself is untouched: this function only CLASSIFIES, it never changes a bot's trading hours
// (the same boundary `auditNameVsWindow()` draws for itself).
//
// ⚠️ `gated: false` is NOT the same as "the audit found nothing". Three distinct readings are kept
// apart on purpose, because collapsing them is how a NULL slot hid for weeks:
//   • `gated: false`, `reason: 'ungated — no session window declared'`  → the slot is EMPTY
//   • `gated: false`, `reason: 'within window (...)'`                   → declared, and open now
//   • `gated: true`,  `reason: 'outside ...'`                           → declared, and shut now

export interface BotWindowState {
  strategyId: string;
  name: string;
  symbol: string;
  reason: string;
  allowed: SessionTag[];
  active: SessionTag[];
  nameWindowAgreement: NameWindowAgreement;
  nameWindowNote: string;
  /** True when the session gate is holding this bot shut at `at`. */
  gated: boolean;
  /** Machine-readable slot state — see `sessionSlotKind()` (#982). */
  slotKind: SessionSlotKind;
  /** False ONLY for `slotKind: 'unfilled'` — a deliberate declaration of any kind is `true`. */
  declared: boolean;
  /** ISO timestamp the state was computed — so a stale record is visible as stale. */
  at: string;
}

/**
 * The four readings of a stored `sessionWindow` value (#982).
 *
 * ── DECISION (2026-10-08, primary) ──
 * WHAT:      `NULL` stops meaning "deliberately all-hours (opt-in)" and becomes `unfilled`.
 *            `'all-hours'` (synonym `'bypass'`) is the DECLARED bypass value. The gate itself is
 *            UNCHANGED: every no-tag form still passes (ungated) — this separates two states that
 *            were previously indistinguishable, it does not move a trading boundary.
 * WHY:       #982 — NULL carried both "I chose any hour" and "nobody filled this in", with no error
 *            either way. Measured 2026-10-06: four city-named TWIN bots disagree inside one
 *            protocol (USDJPY gated `asian` vs EURJPY NULL; …), and nothing could say which NULL
 *            was intent and which was an omission.
 * INSTEAD OF: Editing trading hours — inferring windows for the NULL twins would have changed
 *            gating on a guess about what a NAME meant (#759 forbids exactly that).
 * REVERSE BY: Reverting the seed entries to `null` and dropping `'all-hours'`/`'bypass'` from
 *            ALIASES; the gate behaviour is identical in both directions.
 * REGISTER:  docs/SETTLED-DECISIONS.md, row 70
 * GUARD:     nest/src/modules/trading/strategy-seed-session-declared.spec.ts (in prebuild)
 */
export type SessionSlotKind = 'tags' | 'all-hours' | 'unfilled' | 'unreadable';

/** The canonical DECLARED all-hours value — what the seed and UI write (#982). */
export const ALL_HOURS_VALUE = 'all-hours';

/**
 * Classify a stored `sessionWindow` value (#982).
 *
 * ⚠️ `unreadable` is a FOURTH state on purpose. An unknown word used to be silently dropped and the
 * bot read as ungated — the same shape as any other undeclared read. A value nobody can parse is
 * not a declaration, and saying so is cheaper than discovering it as a trading surprise.
 */
export function sessionSlotKind(raw: unknown): SessionSlotKind {
  if (raw === null || raw === undefined) return 'unfilled';
  const s = String(raw).trim();
  if (s === '') return 'unfilled';
  if (parseSessionWindow(raw).length > 0) return 'tags';
  if (s === '[]') return 'unfilled'; // an empty array is a non-declaration, same as NULL
  const word = s.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(ALIASES, word) && ALIASES[word] === null) {
    return 'all-hours';
  }
  return 'unreadable';
}

/**
 * Serialise a seed/API value for `trading_strategy.sessionWindow` (#982).
 * ONE owner for the storage format: `'all-hours'` stores bare; tag arrays store as JSON; anything
 * else stores NULL — and NULL is now visible as `unfilled`, never as an implied choice.
 */
export function serialiseSessionWindow(raw: SessionTag[] | typeof ALL_HOURS_VALUE | null | undefined): string | null {
  if (raw === ALL_HOURS_VALUE) return ALL_HOURS_VALUE;
  if (Array.isArray(raw) && raw.length > 0) return JSON.stringify(raw);
  return null;
}

/**
 * Compute one active bot's session state for the status surface (#981).
 * Pure: no DI, no Prisma, no clock — the caller passes `at`.
 */
export function botWindowState(
  strategy: { id?: unknown; name?: unknown; symbol?: unknown; sessionWindow?: unknown },
  at: Date = new Date(),
): BotWindowState {
  const strategyId = String(strategy?.id ?? '');
  const name = String(strategy?.name ?? strategyId);
  const symbol = String(strategy?.symbol ?? '');
  const sess = checkSessionWindow(strategy?.sessionWindow, at);
  const audit = auditNameVsWindow(strategy?.name, strategy?.sessionWindow);
  const gated = !sess.ok;
  const slotKind = sessionSlotKind(strategy?.sessionWindow);
  const reason = gated
    ? sess.reason ?? 'session closed'
    : slotKind === 'unfilled'
      ? `undecided — the session slot was never filled (NULL): declare a window or '${ALL_HOURS_VALUE}'`
      : slotKind === 'all-hours'
        ? 'all-hours (declared bypass) — no clock is enforced'
        : slotKind === 'unreadable'
          ? `unreadable session window ${JSON.stringify(String(strategy?.sessionWindow))} — treated as ungated; fix the value`
          : `within window (${sess.active.join('/')})`;
  return {
    strategyId,
    name,
    symbol,
    reason,
    allowed: sess.allowed,
    active: sess.active,
    nameWindowAgreement: audit.agreement,
    nameWindowNote: audit.note,
    gated,
    slotKind,
    declared: slotKind !== 'unfilled',
    at: at.toISOString(),
  };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// THE EXIT-SIDE BOUNDARY (#928) — "when must this bot STOP holding?"
// ══════════════════════════════════════════════════════════════════════════════════════════════
//
// `checkSessionWindow` above is ENTRY-ONLY (`bot-rules.ts`: `stage: 'entry'`). Measured consequence:
// bots gated to `asian` still held positions at 12:40 UTC — hours outside their session. **A bot
// could be told when it may OPEN but not when it must HOLD.**
//
// ⚠️ MEASURED BEFORE BUILDING, AND THE MEASUREMENT DID NOT SUPPORT IT. `replay-exit-counterfactual`
// `--close-before 13:30` over 228 real closed trades: the rule improved the mean by **+0.045pp**
// while **cutting 23 winners and turning 11 green trades red**; 13:00 measured BETTER (+0.071) and
// 20:00 was NEGATIVE (−0.013). So this is built as an **OPT-IN POLICY** — a control an operator may
// choose — and NOT as a fix for a measured effect. `NULL` is the default and means "no boundary",
// so **no existing bot changes behaviour**.
//
// ⚠️ SAME AXIS AS `sessionWindow`. This is the BOT-POLICY axis ("what may THIS BOT do"), not the
// venue axis or the FX-session axis. See the file header and #851.

/** The parsed form of `exitBeforeUtc`, keeping "absent" and "unreadable" DISTINCT. */
export type ExitBoundaryParse =
  | { kind: 'none' }
  | { kind: 'invalid'; raw: unknown }
  | { kind: 'at'; minutes: number };

/**
 * Parse `exitBeforeUtc` — `'HH:MM'` in **UTC** — into minutes past UTC midnight.
 *
 * ⚠️ An unreadable value is `invalid`, NEVER `none`. Folding a typo into "no boundary" would
 * silently discard an operator's declared rule — the failure this repo keeps re-finding (a
 * declaration that is not validated by being well-formed). The caller decides what to do about it;
 * `checkExitBoundary` chooses "do NOT close" plus a loud reason, because a typo must never close a
 * live position, and must never be invisible either.
 */
export function parseExitBoundary(raw: unknown): ExitBoundaryParse {
  if (raw == null) return { kind: 'none' };
  const s = String(raw).trim();
  if (s === '') return { kind: 'none' };
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return { kind: 'invalid', raw };
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return { kind: 'invalid', raw };
  return { kind: 'at', minutes: h * 60 + min };
}

export interface ExitBoundaryResult {
  /** True → a boundary is declared AND it is now past, so the position must not be held. */
  due: boolean;
  /** The declared boundary in minutes past UTC midnight, or null. */
  boundaryMin: number | null;
  /** `none` = no rule declared · `before` = declared, not yet · `reached` = past it · `invalid`. */
  status: 'none' | 'before' | 'reached' | 'invalid';
  /** Set when `due === true`, or when the declaration could not be read. */
  reason?: string;
}

/** `13:30` from 810. Kept local so the reason text cannot drift from the parse. */
function fmtUtcMinutes(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

/**
 * THE EXIT BOUNDARY GATE — "past the declared UTC time, do not hold".
 *
 * ⚠️ A bot with no boundary always declines to act — the gate is opt-in, so adding it never changes
 * the behaviour of a strategy that has not opted in. That is the same contract `checkSessionWindow`
 * makes for entry.
 *
 * ⚠️ WHY "PAST" AND NOT "AT THE CROSSING". This is a live rule, evaluated on every position tick, so
 * it must be idempotent and stateless: once the clock is past the boundary the answer stays `due`
 * until the position closes. A crossing-edge rule would need the position's entry time and would
 * stop being due after a restart — a rule that silently changes its mind.
 */
export function checkExitBoundary(raw: unknown, at: Date = new Date()): ExitBoundaryResult {
  const parsed = parseExitBoundary(raw);
  if (parsed.kind === 'none') return { due: false, boundaryMin: null, status: 'none' };
  if (parsed.kind === 'invalid') {
    return {
      due: false,
      boundaryMin: null,
      status: 'invalid',
      reason:
        `exitBeforeUtc ${JSON.stringify(parsed.raw)} is not HH:MM in UTC — the boundary could not be ` +
        'read, so NO exit is triggered by it. Fix the value; a typo must not close a position.',
    };
  }

  const nowMin = at.getUTCHours() * 60 + at.getUTCMinutes();
  if (nowMin < parsed.minutes) {
    return { due: false, boundaryMin: parsed.minutes, status: 'before' };
  }
  return {
    due: true,
    boundaryMin: parsed.minutes,
    status: 'reached',
    reason: `past the declared exit boundary ${fmtUtcMinutes(parsed.minutes)} UTC`,
  };
}

/** Human-readable boundary for logs/UI. */
export function describeExitBoundary(raw: unknown): string {
  const parsed = parseExitBoundary(raw);
  if (parsed.kind === 'none') return 'holds through any time';
  if (parsed.kind === 'invalid') return `UNREADABLE (${JSON.stringify(parsed.raw)}) — no boundary applied`;
  return `flat by ${fmtUtcMinutes(parsed.minutes)} UTC`;
}

