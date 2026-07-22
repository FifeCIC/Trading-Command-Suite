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

// Resolve log directory relative to the project root (nest/)
const LOG_DIR = (() => {
  // Try the project root first (nest/logs)
  const projectRoot = path.resolve(__dirname, '..', '..', '..', 'logs');
  // Fallback: use process-relative path
  if (!fs.existsSync(projectRoot)) {
    try { fs.mkdirSync(projectRoot, { recursive: true }); } catch {}
  }
  return projectRoot;
})();

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
    this.logger.log(`Log directory: ${LOG_DIR} (exists: ${fs.existsSync(LOG_DIR)})`);
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

  /** Flush queued writes to disk */
  private async flushQueue() {
    if (this.flushing || this.writeQueue.length === 0) return;
    this.flushing = true;
    const batch = this.writeQueue.splice(0);
    try {
      const filePath = path.join(LOG_DIR, LOG_FILE());
      fs.appendFileSync(filePath, batch.join(''));
    } catch (err) {
      this.logger.warn(`Log write failed (${LOG_DIR}/${LOG_FILE()}): ${(err as Error).message}`);
      this.writeQueue.unshift(...batch);
    }
    this.flushing = false;
  }
}
