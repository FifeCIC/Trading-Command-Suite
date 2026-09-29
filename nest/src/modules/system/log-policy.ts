/**
 * log-policy.ts — the two rules that decide what is WRITTEN and what is DELETED. (#1023)
 * =====================================================================================
 *
 * Kept PURE and separate from `log.service.ts` on purpose: both rules are destructive in one
 * direction (one drops lines, the other deletes files), so both need to be provable without a
 * filesystem, a database, or a running API. Everything here is a function of its arguments.
 *
 * ── The problem being solved, measured 2026-09-29 ────────────────────────────────────────────
 *
 *   • `nest/logs/` held 62 files / 21.8 MB, `logs/` another 191 / 12.6 MB — nothing pruned any
 *     of it.
 *   • `tcs-2026-09-24.log` was **5,835,074 bytes** against neighbours of 173-572 KB, because the
 *     bridge was down and the adapter wrote **4,800 identical** `GET /symbols FAILED` lines plus
 *     1,738 for one symbol's quotes.
 *
 * The warning was correct and worth having ONCE. Its value is not additive past the second
 * occurrence, and the cost was that the day's log became unnavigable — which is how a log stops
 * being read at all.
 *
 * ── The rule this file is built around ───────────────────────────────────────────────────────
 *
 * ⚠️ A RETENTION POLICY MUST NOT BE ABLE TO DELETE THE EVIDENCE. `retention.config.ts` learned this
 * for database rows: a retention run removed the evidence of the defect being investigated, and
 * nothing warned. So `selectPrunable()` REFUSES to name today's file whatever the window says, and
 * refuses a window below one day — a misconfigured number must not become a deletion spree.
 */

/** One log file as `readdirSync` describes it. */
export interface LogFileInfo {
  name: string;
  size: number;
}

export interface PruneSelection {
  /** Files the prune would remove, newest first, with their sizes. */
  remove: LogFileInfo[];
  /** Files kept, with the reason each was kept. */
  keep: Array<{ name: string; reason: string }>;
  /** Total bytes the removal would free. */
  bytesRemoved: number;
}

/**
 * Which log files a prune may remove.
 *
 * ⚠️ `todayFile` is not a comparison — it is a REFUSAL. However old the window is, however stale
 * the clock, the file currently being appended to is never a candidate:
 *
 *   • On Windows an open file cannot be deleted, so attempting it throws — but only for the process
 *     that holds it, and the failure would be reported as a prune error rather than as a rule.
 *   • The one file a reader is most likely to want is the one being written NOW.
 *
 * ⚠️ `retentionDays < 1` returns an EMPTY selection rather than "everything older than an hour".
 * A bad number must be inert, not destructive — the caller sees `0 to remove` and can ask why.
 */
export function selectPrunable(
  files: LogFileInfo[],
  todayFile: string,
  retentionDays: number,
  nowMs: number,
): PruneSelection {
  const remove: LogFileInfo[] = [];
  const keep: Array<{ name: string; reason: string }> = [];

  const usableWindow = Number.isFinite(retentionDays) && retentionDays >= 1;
  const cutoffMs = nowMs - retentionDays * 86_400_000;

  for (const f of files) {
    if (f.name === todayFile) {
      keep.push({ name: f.name, reason: 'the file being written now' });
      continue;
    }
    if (!usableWindow) {
      keep.push({ name: f.name, reason: `retention window ${retentionDays}d is not usable — nothing pruned` });
      continue;
    }
    // `tcs-YYYY-MM-DD.log` — the date in the NAME, not the mtime. A file copied or restored has a
    // fresh mtime but the same day, and pruning on mtime would then keep a 6-month-old file forever.
    const age = fileAgeDays(f.name, nowMs);
    if (age === null) {
      keep.push({ name: f.name, reason: 'name is not a dated tcs-<YYYY-MM-DD>.log — never auto-pruned' });
      continue;
    }
    if (age > retentionDays) remove.push(f);
    else keep.push({ name: f.name, reason: `${age}d old, inside the ${retentionDays}d window` });
  }

  remove.sort((a, b) => b.name.localeCompare(a.name));
  return {
    remove,
    keep,
    bytesRemoved: remove.reduce((n, f) => n + (Number(f.size) || 0), 0),
  };
}

/**
 * Whole days between the date in `tcs-<YYYY-MM-DD>.log` and `nowMs`, or `null` if the name does not
 * carry a date.
 *
 * ⚠️ Returns `null` rather than 0 or Infinity for an unparseable name: `null` means "no opinion,
 * do not act", and both of the alternatives would be acted on — 0 keeps the file forever by
 * accident, Infinity deletes it by accident.
 */
export function fileAgeDays(name: string, nowMs: number): number | null {
  const m = /^tcs-(\d{4})-(\d{2})-(\d{2})\.log$/.exec(name);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const stamp = Date.UTC(year, month - 1, day);
  if (Number.isNaN(stamp)) return null;
  return Math.floor((nowMs - stamp) / 86_400_000);
}

/** What was seen of one message so far. */
export interface RepeatState {
  /** Occurrences inside the current window, including the one that was written. */
  count: number;
  /** When the window opened (ms). */
  sinceMs: number;
  /** When this message was last seen, written or suppressed (ms). */
  lastMs: number;
}

export interface CollapseDecision {
  /** Whether the caller should WRITE this occurrence. */
  emit: boolean;
  /** How many occurrences to report as suppressed when the window closes (0 while it is open). */
  summariseSuppressed: number;
  /** The state the caller must store for this fingerprint. */
  next: RepeatState;
}

/**
 * Decide whether an occurrence should be written, given what has already been seen.
 *
 * Deliberately NOT "have I seen this before?" — that would suppress a fault that recurs once an hour
 * for a week, which is a real signal. The window expires, and the expiry emits a summary naming how
 * many were suppressed, so the volume is bounded while the FACT of the repetition survives.
 *
 * ⚠️ `count` includes the first (written) occurrence, so a window that closes with `count: 4801`
 * means "written once, 4,800 suppressed" — the honest pairing. Reporting the suppressed count alone
 * would make a single occurrence look like a storm.
 */
export function collapseRepeat(
  fingerprint: string,
  seen: RepeatState | undefined,
  nowMs: number,
  windowMs: number,
  enabled: boolean,
): CollapseDecision {
  if (!enabled || !Number.isFinite(windowMs) || windowMs <= 0) {
    return { emit: true, summariseSuppressed: 0, next: { count: 1, sinceMs: nowMs, lastMs: nowMs } };
  }

  if (!seen) {
    return { emit: true, summariseSuppressed: 0, next: { count: 1, sinceMs: nowMs, lastMs: nowMs } };
  }

  const windowOpen = nowMs - seen.sinceMs < windowMs;
  if (windowOpen) {
    // Inside the window: suppress, and remember that we saw it.
    return {
      emit: false,
      summariseSuppressed: 0,
      next: { count: seen.count + 1, sinceMs: seen.sinceMs, lastMs: nowMs },
    };
  }

  // The window has closed. Write this occurrence, and report the previous window's suppressed count
  // so nothing disappears silently.
  return {
    emit: true,
    summariseSuppressed: seen.count - 1,
    next: { count: 1, sinceMs: nowMs, lastMs: nowMs },
  };
}

/**
 * The stable identity of a message for collapse purposes.
 *
 * ⚠️ `level` and `source` are part of it, not just the text: the same sentence from `MT5Adapter` and
 * from `ScoringService` is two facts, and collapsing them together would hide one. Timestamps are
 * deliberately excluded — they are what differs between two otherwise identical lines.
 *
 * ⚠️ JSON-ENCODED, NOT NUL-SEPARATED — and the reason is a test that failed. The first version was
 * `` `${level}\u0000${source}\u0000${message}` `` with a comment claiming the NUL made collisions
 * impossible. **That claim was false**, and `log-policy.spec.ts` caught it: `('a', 'b\u0000c')` and
 * `('a\u0000b', 'c')` both render `error\u0000a\u0000b\u0000c`. A separator only disambiguates if it
 * cannot occur in the fields, and nothing enforced that.
 *
 * The collision is harmless (it would merge two messages' suppression counts, losing no line from the
 * ring buffer) — but a comment stating a property the code does not have is worse than no comment,
 * and `JSON.stringify` removes the class for the cost of a few bytes.
 *
 * The inverse is `parseFingerprint()`, which is what the summary path uses instead of splitting.
 */
export function logFingerprint(level: string, source: string, message: string): string {
  return JSON.stringify([level, source, message]);
}

/**
 * Recover `[level, source, message]` from a fingerprint.
 *
 * ⚠️ Returns `null` rather than throwing. This runs inside an interval tick: a malformed key must
 * not kill the flush that reports every other pending storm.
 */
export function parseFingerprint(fingerprint: string): [string, string, string] | null {
  try {
    const parsed = JSON.parse(fingerprint);
    if (!Array.isArray(parsed) || parsed.length !== 3) return null;
    return [String(parsed[0]), String(parsed[1]), String(parsed[2])];
  } catch {
    return null;
  }
}
