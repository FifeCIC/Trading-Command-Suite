/**
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
 * - DST is approximated by month (Mar–Nov = EDT/UTC-4) — this reproduces the
 *   pre-existing behaviour exactly. Replace with a real tz library only as a
 *   deliberate change, since it shifts every session boundary.
 * - Pure functions only: no DI, no Prisma, no clock. Callers pass `at`.
 * - Session windows may wrap past midnight (Asian opens 19:00, closes 04:00).
 */

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
 */
const ALIASES: Record<string, SessionTag | null> = {
  asia: 'asian', asian: 'asian', tokyo: 'asian', sydney: 'asian', wellington: 'asian',
  london: 'london', europe: 'london', european: 'london', zurich: 'london',
  frankfurt: 'london', paris: 'london',
  us: 'us', usa: 'us', newyork: 'us', ny: 'us', america: 'us',
  always: null, any: null, '24/7': null, '24h': null, none: null,
};

/**
 * Convert a UTC instant to minutes-since-midnight in ET.
 * DST approximated by month — identical to the historic MarketContextService
 * behaviour, so session boundaries do not move as a side effect of this file.
 */
export function toEtMinutes(at: Date): number {
  const month = at.getUTCMonth(); // 0 = Jan
  const isDst = month >= 2 && month <= 10; // Mar–Nov approximate DST
  let etHour = at.getUTCHours() - (isDst ? 4 : 5);
  if (etHour < 0) etHour += 24;
  // Preserve minute precision (the historic helper returned whole hours only).
  return etHour * 60 + at.getUTCMinutes();
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
