import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

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

const LOG_FILE = () => {
  const d = new Date();
  return `tcs-${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}.log`;
};

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

  constructor() {
    try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch {}
    // Log the resolved path, not just that logging started — when logs go missing the first
    // question is always "where is it writing?", and this answers it without a debug session.
    this.logger.log(`Log directory: ${LOG_DIR} (exists: ${fs.existsSync(LOG_DIR)})`);
    this.log('SystemLogService', 'info', `Log directory resolved to ${LOG_DIR}`, 'system');
  }

  /** Write a log entry */
  log(source: string, level: LogEntry['level'], message: string, category?: LogCategory) {
    // Check category switch
    if (category && this.categories[category] === false) return;

    const entry: LogEntry = { timestamp: new Date().toISOString(), level, source, message, category };
    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) this.logs.shift();

    // Queue for file write
    const catTag = category ? `[${category}] ` : '';
    const line = `[${entry.timestamp}] [${entry.level.toUpperCase().padEnd(7)}] ${catTag}[${source.padEnd(20)}] ${message}\n`;
    this.writeQueue.push(line);
    this.flushQueue();
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
