import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron, CronExpression, Interval } from '@nestjs/schedule';
import * as fs from 'fs';
import * as path from 'path';
import { SettingsResolverService } from '../../common/settings/settings-resolver.service';
import { SETTINGS_BY_KEY } from '../../common/settings/settings-registry';
import {
  collapseRepeat,
  fileAgeDays,
  logFingerprint,
  parseFingerprint,
  selectPrunable,
  type LogFileInfo,
  type RepeatState,
} from './log-policy';

export type LogCategory = 'mt5' | 'provider' | 'scoring' | 'user-action' | 'system' | 'trading' | 'api';
export interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug' | 'trade' | 'order';
  source: string;
  message: string;
  category?: LogCategory;
}

/**
 * Resolve the log directory — `nest/logs/`, NOT `dist/logs/`.
 *
 * ⚠️ This used to be `path.resolve(__dirname, '..', '..', '..', 'logs')`. At runtime the
 * compiled module lives at `dist/src/modules/system/`, so three levels up is `dist/`, and
 * logs were written to **`dist/logs/`** — a directory the BUILD OWNs. `npm run build` runs
 * `rimraf dist` in its prebuild step, so every rebuild deleted the log directory and the
 * running app then failed on every flush:
 *
 *     WARN [SystemLogService] Log write failed (…\nest\dist\logs\tcs-….log):
 *     ENOENT: no such file or directory
 *
 * The symptom was easy to miss because it is a warning, not an error, and the in-memory
 * log buffer (`getRecent`) kept working — so the API still *looked* healthy while nothing
 * was reaching disk. Logs silently stopped persisting after each build.
 *
 * Resolution order, most explicit first:
 *   1. `TCS_LOG_DIR` — an absolute override, for tests and for relocating logs.
 *   2. The project root's `logs/` directory, found by walking up from `__dirname` until a
 *      directory containing `package.json` is found. That is the `nest/` root whether the
 *      code is running from `src/` (ts-node/jest) or `dist/src/` (compiled), so the path
 *      does not depend on the build layout.
 *   3. `process.cwd()/logs` — last resort if no package.json is found.
 *
 * The directory is created on resolution AND re-created before each write, because a
 * long-running process can outlive an external cleanup.
 */
function resolveLogDir(): string {
  const override = process.env.TCS_LOG_DIR;
  if (override && override.trim()) return path.resolve(override.trim());

  // Walk up to the package root (nest/), which is the directory holding package.json.
  let dir = __dirname;
  for (let i = 0; i < 8; i += 1) {
    const parent = path.dirname(dir);
    if (parent === dir) break; // hit the filesystem root
    dir = parent;
    if (fs.existsSync(path.join(dir, 'package.json'))) return path.join(dir, 'logs');
  }

  return path.resolve(process.cwd(), 'logs');
}

const LOG_DIR = resolveLogDir();

/**
 * Where a pruned file GOES, one cycle before it is removed.
 *
 * ⚠️ WHY THIS EXISTS (#1023 acceptance criterion 3). The criterion asks that the prune be
 * *reversible-by-copy* — "archive before delete, or move rather than remove". A bare `unlink` at 30
 * days satisfies nobody: retention.config.ts already records a run that destroyed the evidence of
 * the defect being investigated, and "the window was long enough" is a claim about how fast a human
 * looks rather than about what the system can undo.
 *
 * So a file outside the window is **moved here**, not removed. The NEXT run removes it from here on
 * the same rule. Net effect: one extra cron cycle of grace (up to ~24h), the live directory is
 * bounded exactly as before, and an accidental deletion noticed the same day is recoverable with a
 * `move` rather than a restore.
 *
 * ⚠️ The archive is a SUBDIRECTORY on purpose: `getLogFiles()` and `listDatedLogFiles()` both use a
 * non-recursive `readdirSync`, so archived files cannot be mistaken for live ones, cannot be served
 * as "today's log", and cannot re-enter the live selection.
 */
const ARCHIVE_DIR = path.join(LOG_DIR, 'archive');

const LOG_FILE = () => {
  const d = new Date();
  return `tcs-${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}.log`;
};

/** The settings-backed behaviour of the writer, resolved once and cached. */
export interface LogPolicy {
  retentionDays: number;
  pruneEnabled: boolean;
  collapseRepeats: boolean;
  repeatWindowMinutes: number;
}

/**
 * Read a declared default straight from the registry.
 *
 * ⚠️ NOT a local literal. `settings-registry.ts` states that its `defaultValue` is "the ONLY copy —
 * the seed imports it rather than re-declaring it", and a second copy here would drift from the one
 * the settings UI shows. It also makes a MISSING declaration a loud failure at boot rather than a
 * silent fallback to a number nobody can see.
 */
function declaredDefault<T>(key: string): T {
  const def = SETTINGS_BY_KEY.get(key);
  if (!def) throw new Error(`[SystemLogService] setting "${key}" is not declared in settings-registry.ts`);
  return def.defaultValue as T;
}

/** The policy before any settings read has happened — the declared defaults, exactly. */
export function declaredLogPolicy(): LogPolicy {
  return {
    retentionDays: declaredDefault<number>('logging.retentionDays'),
    pruneEnabled: declaredDefault<boolean>('logging.pruneEnabled'),
    collapseRepeats: declaredDefault<boolean>('logging.collapseRepeats'),
    repeatWindowMinutes: declaredDefault<number>('logging.repeatWindowMinutes'),
  };
}

/**
 * Shorten a message for a summary line.
 *
 * ⚠️ A summary must not itself be long enough to be the storm. One of the measured offenders was a
 * 404 body echoed per symbol; repeating that verbatim inside "suppressed N of …" would reintroduce
 * the volume the collapse just removed.
 */
function truncateForSummary(message: string, max = 120): string {
  const oneLine = message.replace(/\s+/g, ' ').trim();
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`;
}

/** Bytes as a human unit, for the retention report and the prune record. */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

@Injectable()
export class SystemLogService {
  private readonly logger = new Logger(SystemLogService.name);
  private readonly logs: LogEntry[] = [];
  private readonly maxLogs = 500;
  private writeQueue: string[] = [];
  private flushing = false;

  // Category enable/disable switches
  categories: Record<LogCategory, boolean> = {
    mt5: true, provider: true, scoring: true, 'user-action': true, system: true, trading: true, api: true,
  };

  constructor(
    /**
     * ⚠️ OPTIONAL on purpose, and the writer NEVER depends on it succeeding.
     *
     * A logger that cannot log when the database is down is a logger that fails exactly when it is
     * needed. `SETTINGS` rows live in `global_setting`, so every read below is wrapped, and a
     * failure falls back to the declared defaults. `@Optional()` also keeps this constructible in a
     * unit test with no Nest container.
     */
    @Optional() private readonly settingsResolver?: SettingsResolverService,
  ) {
    try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch {}
    // Log the resolved path, not just that logging started — when logs go missing the first
    // question is always "where is it writing?", and this answers it without a debug session.
    this.logger.log(`Log directory: ${LOG_DIR} (exists: ${fs.existsSync(LOG_DIR)})`);
    this.log('SystemLogService', 'info', `Log directory resolved to ${LOG_DIR}`, 'system');
  }

  // ── Policy (settings) — cached, refreshed in the background, fail-open ───────────────────

  private policy: LogPolicy = declaredLogPolicy();
  private policyLoadedAt = 0;
  private policyRefreshing = false;

  /** The current policy, for callers that want to show it (the retention endpoint does). */
  getPolicy(): LogPolicy {
    this.refreshPolicyIfStale();
    return this.policy;
  }

  /**
   * Refresh the settings cache in the background if it is stale.
   *
   * ⚠️ SYNCHRONOUS AND FIRE-AND-FORGET. `log()` is called from everywhere and must not await a
   * database read — a slow settings query would become a slow log call, on the hot path, during the
   * incident that is filling the log. So the cached value is used immediately and replaced when the
   * read lands.
   */
  private refreshPolicyIfStale(): void {
    if (this.policyRefreshing || !this.settingsResolver) return;
    if (Date.now() - this.policyLoadedAt < 30_000) return;
    this.policyRefreshing = true;
    void (async () => {
      try {
        const r = this.settingsResolver!;
        const [retentionDays, pruneEnabled, collapseRepeats, repeatWindowMinutes] = await Promise.all([
          r.get<number>('logging.retentionDays'),
          r.get<boolean>('logging.pruneEnabled'),
          r.get<boolean>('logging.collapseRepeats'),
          r.get<number>('logging.repeatWindowMinutes'),
        ]);
        this.policy = {
          retentionDays: Number(retentionDays),
          pruneEnabled: Boolean(pruneEnabled),
          collapseRepeats: Boolean(collapseRepeats),
          repeatWindowMinutes: Number(repeatWindowMinutes),
        };
        this.policyLoadedAt = Date.now();
      } catch {
        // Fail OPEN, and do not log the failure through this service — that would recurse.
        // The declared defaults are already in place, so behaviour is unchanged; only a settings
        // change is deferred, and the next attempt is 30s away.
        this.policyLoadedAt = Date.now();
      } finally {
        this.policyRefreshing = false;
      }
    })();
  }

  // ── Repeat collapsing (#1023) ─────────────────────────────────────────────────────────────

  /** fingerprint -> what has been seen in the current window. */
  private readonly repeatSeen = new Map<string, RepeatState>();
  /** Occurrences suppressed since boot. Surfaced so the volume is measurable, not just reduced. */
  private suppressedTotal = 0;

  /** Write a log entry */
  log(source: string, level: LogEntry['level'], message: string, category?: LogCategory) {
    // Check category switch
    if (category && this.categories[category] === false) return;

    const entry: LogEntry = { timestamp: new Date().toISOString(), level, source, message, category };

    // ⚠️ THE IN-MEMORY RING BUFFER IS NEVER COLLAPSED. It is bounded at `maxLogs`, so a storm cannot
    // grow it, and it is the live view a person reads while watching. Collapsing it would hide the
    // storm from the very surface most likely to be open during one. The FILE is collapsed because
    // the file is the unbounded thing.
    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) this.logs.shift();

    this.refreshPolicyIfStale();
    const now = Date.now();
    const fingerprint = logFingerprint(level, source, message);
    const decision = collapseRepeat(
      fingerprint,
      this.repeatSeen.get(fingerprint),
      now,
      this.policy.repeatWindowMinutes * 60_000,
      this.policy.collapseRepeats,
    );
    this.repeatSeen.set(fingerprint, decision.next);

    // A window just closed with duplicates in it — say so BEFORE the line that ended it, so the
    // count reads next to the message it belongs to.
    if (decision.summariseSuppressed > 0) {
      this.suppressedTotal += decision.summariseSuppressed;
      this.writeQueue.push(
        this.formatLine(
          new Date(now).toISOString(),
          'warn',
          source,
          `${level.toUpperCase()}: "${truncateForSummary(message)}" repeated ${decision.summariseSuppressed} more time(s) in the last ${this.policy.repeatWindowMinutes} min — suppressed. Set logging.collapseRepeats=false to see every occurrence.`,
          category,
        ),
      );
    }

    if (!decision.emit) {
      // Counted, not written. `summariseSuppressed` on the NEXT window carries it.
      this.flushQueue();
      return;
    }

    this.writeQueue.push(this.formatLine(entry.timestamp, level, source, message, category));
    this.flushQueue();
  }

  /** One line in the on-disk format. Single owner of that format. */
  private formatLine(
    timestamp: string,
    level: LogEntry['level'],
    source: string,
    message: string,
    category?: LogCategory,
  ): string {
    const catTag = category ? `[${category}] ` : '';
    return `[${timestamp}] [${level.toUpperCase().padEnd(7)}] ${catTag}[${source.padEnd(20)}] ${message}\n`;
  }

  /**
   * Emit the summary for every window that has closed with duplicates still unreported.
   *
   * ⚠️ WITHOUT THIS THE LAST COUNT IS LOST. `collapseRepeat` reports a window's suppressed count
   * when the NEXT occurrence arrives — so if the fault stops, the final "suppressed 4,800" never
   * appears and the log shows one warning and then silence, which reads as "it resolved" when it
   * did not.
   */
  @Interval(60_000)
  flushRepeatSummaries(): void {
    const windowMs = this.policy.repeatWindowMinutes * 60_000;
    const now = Date.now();
    for (const [fingerprint, state] of this.repeatSeen) {
      if (state.count > 1 && now - state.sinceMs >= windowMs) {
        const parsed = parseFingerprint(fingerprint);
        // ⚠️ UNREACHABLE BY CONSTRUCTION — every key here is made by `logFingerprint`. If one ever
        // fails to parse, the count is still added to the running total but NO line is written,
        // because writing one would have to invent a source for it. An invented attribution in a log
        // is worse than a missing line: it sends the next reader to the wrong file.
        if (!parsed) {
          this.suppressedTotal += state.count - 1;
          this.repeatSeen.delete(fingerprint);
          continue;
        }
        const [level, source] = parsed;
        this.suppressedTotal += state.count - 1;
        this.writeQueue.push(
          this.formatLine(
            new Date(now).toISOString(),
            'warn',
            source,
            `${level.toUpperCase()} repeated ${state.count} time(s) and then stopped — ${state.count - 1} suppressed after the first.`,
          ),
        );
        this.repeatSeen.delete(fingerprint);
      } else if (state.count === 1 && now - state.lastMs > 10 * windowMs) {
        // Ordinary bookkeeping: a fingerprint seen once, long ago, is not worth remembering forever.
        this.repeatSeen.delete(fingerprint);
      }
    }
    this.flushQueue();
  }

  /** Total occurrences suppressed since boot, and how many fingerprints are being tracked. */
  getCollapseStats() {
    return {
      enabled: this.policy.collapseRepeats,
      windowMinutes: this.policy.repeatWindowMinutes,
      suppressedSinceBoot: this.suppressedTotal,
      trackedFingerprints: this.repeatSeen.size,
    };
  }

  // ── Retention (#1023) ─────────────────────────────────────────────────────────────────────

  /**
   * What a prune WOULD do, without doing it.
   *
   * ⚠️ Every prune has a dry run, and the report names each file. `retention.config.ts` records why
   * this matters for database rows — a retention run destroyed the evidence of the defect being
   * investigated, and nothing warned first.
   */
  getRetentionReport(nowMs = Date.now()) {
    this.refreshPolicyIfStale();
    const files = this.listDatedLogFiles();
    const selection = selectPrunable(files, LOG_FILE(), this.policy.retentionDays, nowMs);

    // The archive is judged by the SAME rule against the SAME window, which is what gives a moved
    // file exactly one extra cycle before removal.
    const held = this.listArchivedLogFiles();
    const heldSelection = selectPrunable(held, '', this.policy.retentionDays, nowMs);

    return {
      directory: LOG_DIR,
      archive: ARCHIVE_DIR,
      retentionDays: this.policy.retentionDays,
      pruneEnabled: this.policy.pruneEnabled,
      totalFiles: files.length,
      totalBytes: files.reduce((n, f) => n + f.size, 0),
      /** What the next prune MOVES into the archive. Nothing is deleted in this step. */
      wouldRemove: selection.remove,
      bytesWouldFree: selection.bytesRemoved,
      kept: selection.keep,
      /** The archive: moved here last cycle, removed this cycle. */
      archiveHeld: held,
      archiveHeldBytes: held.reduce((n, f) => n + f.size, 0),
      archiveWouldRemove: heldSelection.remove,
      /** The grace, stated rather than implied. */
      note:
        'A file outside the window is MOVED to `archive/` first and deleted on the NEXT run, so a ' +
        'removal noticed within one cycle is recoverable with a move. `wouldRemove` is the move.',
    };
  }

  /**
   * Move files outside the retention window into `archive/`, then delete last cycle's arrivals.
   *
   * ⚠️ TWO STEPS, AND THE ORDER MATTERS. Moving first means nothing is ever removed on the run that
   * decided to remove it — the file has to survive one whole cycle in the archive before it can go.
   * That is what makes the deletion reversible rather than final at the moment of decision.
   *
   * ⚠️ NEVER TOUCHES TODAY'S FILE — `selectPrunable` refuses it whatever the window says.
   * ⚠️ NEVER THROWS. It runs on a schedule in a long-lived process; a failure is reported as a
   * result, not as an exception that kills the cron tick.
   */
  pruneOldLogs(opts?: { dryRun?: boolean; nowMs?: number }) {
    this.refreshPolicyIfStale();
    const dryRun = opts?.dryRun === true;
    const nowMs = opts?.nowMs ?? Date.now();
    const report = this.getRetentionReport(nowMs);

    if (!this.policy.pruneEnabled) {
      return {
        ...report,
        dryRun,
        archived: [],
        purged: [],
        pruned: [],
        bytesFreed: 0,
        skipped: 'logging.pruneEnabled is OFF — nothing moved, nothing removed',
      };
    }

    const archived: Array<{ name: string; size: number }> = [];
    const purged: Array<{ name: string; size: number }> = [];
    const failed: Array<{ name: string; error: string }> = [];

    if (!dryRun) {
      try {
        fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
      } catch (err) {
        failed.push({ name: '(archive directory)', error: (err as Error).message });
      }

      // Step 1 — MOVE. A name collision means a file with that date is already archived (a second
      // run in the same cycle), so the live copy is the newer fact and is left alone for the next run.
      for (const f of report.wouldRemove) {
        try {
          const dest = path.join(ARCHIVE_DIR, f.name);
          if (fs.existsSync(dest)) {
            failed.push({ name: f.name, error: 'already present in archive — left in place, not overwritten' });
            continue;
          }
          fs.renameSync(path.join(LOG_DIR, f.name), dest);
          archived.push({ name: f.name, size: f.size });
        } catch (err) {
          failed.push({ name: f.name, error: (err as Error).message });
        }
      }

      // Step 2 — PURGE what was ALREADY in the archive when this run started.
      //
      // ⚠️ `report.archiveWouldRemove`, NOT a fresh listing. Measured 2026-09-29: the first version
      // re-listed the archive after moving and applied the window to the result, so a file moved in
      // step 1 was judged again in step 2 — still outside the window, because the window is absolute
      // rather than measured from the move — and was removed **in the same run it was archived**. The
      // grace was a fiction: `archived` and `purged` both named the same file, and the live directory
      // was no more reversible than a plain `unlink`.
      //
      // The listing taken BEFORE the move is what makes "one cycle" true: anything moved this run
      // cannot appear in it, so it is guaranteed to survive until the next run.
      for (const f of report.archiveWouldRemove) {
        try {
          fs.unlinkSync(path.join(ARCHIVE_DIR, f.name));
          purged.push({ name: f.name, size: f.size });
        } catch (err) {
          failed.push({ name: f.name, error: (err as Error).message });
        }
      }
    } else {
      // A preview must show BOTH halves, or "nothing to remove" would be read as "nothing happens".
      archived.push(...report.wouldRemove);
      purged.push(...report.archiveWouldRemove);
    }

    // ⚠️ The MOVEMENT AND THE REMOVAL ARE BOTH LOGGED. A log that records everything except its own
    // pruning leaves "why is the 12th missing?" unanswerable. These lines go to the surviving file,
    // and they are also what makes the archive self-explaining a week later.
    if (!dryRun && (archived.length > 0 || purged.length > 0)) {
      const bytes = purged.reduce((n, f) => n + f.size, 0);
      this.writeQueue.push(
        this.formatLine(
          new Date().toISOString(),
          'info',
          'SystemLogService',
          `Log retention (window ${this.policy.retentionDays}d): ` +
            `${archived.length} file(s) moved to archive/` +
            (archived.length ? ` (${archived.map((f) => f.name).join(', ')})` : '') +
            `; ${purged.length} removed from archive/` +
            (purged.length ? ` (${purged.map((f) => f.name).join(', ')}), ${formatBytes(bytes)} freed` : '') +
            `. A moved file survives one cycle before removal — recover it from nest/logs/archive/.`,
        ),
      );
      this.flushQueue();
    }

    return {
      ...report,
      dryRun,
      archived,
      purged,
      /** Kept for callers written against the first shape — the two halves together. */
      pruned: [...archived, ...purged],
      bytesFreed: purged.reduce((n, f) => n + f.size, 0),
      failed,
    };
  }

  /** The daily prune. 03:15 — after `DataRetentionService`'s 03:00 database pass, deliberately not with it. */
  @Cron('15 3 * * *')
  scheduledLogPrune(): void {
    try {
      const r = this.pruneOldLogs();
      if (r.archived.length > 0 || r.purged.length > 0) {
        this.logger.log(
          `Log retention: ${r.archived.length} moved to archive/, ${r.purged.length} removed, ` +
            `${formatBytes(r.bytesFreed)} freed`,
        );
      }
    } catch (err) {
      this.logger.warn(`Log retention failed: ${(err as Error).message}`);
    }
  }

  /** `tcs-<date>.log` files with sizes. Separated so the policy stays filesystem-free. */
  private listDatedLogFiles(): LogFileInfo[] {
    return this.listDatedFilesIn(LOG_DIR);
  }

  /** The archive: same shape, same rule, a directory deeper. */
  private listArchivedLogFiles(): LogFileInfo[] {
    return this.listDatedFilesIn(ARCHIVE_DIR);
  }

  private listDatedFilesIn(dir: string): LogFileInfo[] {
    try {
      return fs.readdirSync(dir)
        .filter((f) => f.startsWith('tcs-') && f.endsWith('.log') && fileAgeDays(f, Date.now()) !== null)
        .map((f) => ({ name: f, size: fs.statSync(path.join(dir, f)).size }));
    } catch {
      return [];
    }
  }

  // Convenience methods with category support
  info(source: string, message: string, cat?: LogCategory) { this.log(source, 'info', message, cat); }
  warn(source: string, message: string, cat?: LogCategory) { this.log(source, 'warn', message, cat); }
  error(source: string, message: string, cat?: LogCategory) { this.log(source, 'error', message, cat); }
  debug(source: string, message: string, cat?: LogCategory) { this.log(source, 'debug', message, cat); }
  trade(source: string, message: string, cat?: LogCategory) { this.log(source, 'trade', message, cat); }
  order(source: string, message: string, cat?: LogCategory) { this.log(source, 'order', message, cat); }

  getRecent(limit = 50): LogEntry[] {
    return this.logs.slice(-limit).reverse();
  }

  getRecentByCategory(category: LogCategory, limit = 50): LogEntry[] {
    return this.logs.filter(l => l.category === category).slice(-limit).reverse();
  }

  getRecentByLevel(level: LogEntry['level'], limit = 50): LogEntry[] {
    return this.logs.filter(l => l.level === level).slice(-limit).reverse();
  }

  /** Get log file status */
  getLogFileStatus() {
    const filePath = path.join(LOG_DIR, LOG_FILE());
    return {
      directory: LOG_DIR,
      todayFile: LOG_FILE(),
      exists: fs.existsSync(filePath),
      sizeBytes: fs.existsSync(filePath) ? fs.statSync(filePath).size : 0,
      queueLength: this.writeQueue.length,
      totalInMemory: this.logs.length,
    };
  }

  /** Get all log files in the directory */
  getLogFiles() {
    try {
      return fs.readdirSync(LOG_DIR)
        .filter(f => f.startsWith('tcs-') && f.endsWith('.log'))
        .sort()
        .reverse()
        .map(f => ({
          name: f,
          size: fs.statSync(path.join(LOG_DIR, f)).size,
          path: path.join(LOG_DIR, f),
        }));
    } catch { return []; }
  }

  /** Read today's log file */
  readLogFile(lines = 200): string {
    try {
      const filePath = path.join(LOG_DIR, LOG_FILE());
      if (!fs.existsSync(filePath)) return '';
      const content = fs.readFileSync(filePath, 'utf-8');
      const allLines = content.split('\n').filter(Boolean);
      return allLines.slice(-lines).join('\n');
    } catch { return ''; }
  }

  /**
   * Flush queued writes to disk.
   *
   * Re-creates the log directory on each attempt. A long-running process can outlive an
   * external cleanup (a `rimraf dist`, a backup tool, a manual tidy), and the retry path
   * below would otherwise spin forever failing on a directory that no longer exists —
   * re-queuing the same batch each time. Cheap to check, and it makes the writer self-heal
   * instead of silently degrading to memory-only.
   */
  private async flushQueue() {
    if (this.flushing || this.writeQueue.length === 0) return;
    this.flushing = true;
    const batch = this.writeQueue.splice(0);
    try {
      if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
      const filePath = path.join(LOG_DIR, LOG_FILE());
      fs.appendFileSync(filePath, batch.join(''));
      this.writeFailures = 0;
    } catch (err) {
      this.writeFailures += 1;
      // Report the first failure and then every 100th, so a persistent fault is visible
      // without flooding the console it is failing to write to.
      if (this.writeFailures === 1 || this.writeFailures % 100 === 0) {
        this.logger.warn(
          `Log write failed (${LOG_DIR}/${LOG_FILE()}) [${this.writeFailures} consecutive]: ${(err as Error).message}`,
        );
      }
      this.writeQueue.unshift(...batch);
    }
    this.flushing = false;
  }

  /** Consecutive failed flushes since the last success. Surfaces a broken writer. */
  private writeFailures = 0;

  /** Health of the log writer — distinguishes "nothing to log" from "cannot log". */
  getWriterHealth() {
    return {
      directory: LOG_DIR,
      directoryExists: fs.existsSync(LOG_DIR),
      consecutiveWriteFailures: this.writeFailures,
      queuedLines: this.writeQueue.length,
    };
  }
}
