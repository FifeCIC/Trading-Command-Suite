import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

export interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug' | 'trade' | 'order';
  source: string;
  message: string;
}

const LOG_DIR = path.resolve(__dirname, '..', '..', '..', 'logs');
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

  constructor() {
    // Ensure log directory exists
    try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch {}
  }

  /** Write a log entry — in-memory ring buffer + append to daily file */
  log(source: string, level: LogEntry['level'], message: string) {
    const entry: LogEntry = { timestamp: new Date().toISOString(), level, source, message };
    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) this.logs.shift();

    // Queue for file write (non-blocking)
    const line = `[${entry.timestamp}] [${entry.level.toUpperCase().padEnd(7)}] [${source.padEnd(25)}] ${message}\n`;
    this.writeQueue.push(line);
    this.flushQueue();
  }

  info(source: string, message: string) { this.log(source, 'info', message); }
  warn(source: string, message: string) { this.log(source, 'warn', message); }
  error(source: string, message: string) { this.log(source, 'error', message); }
  debug(source: string, message: string) { this.log(source, 'debug', message); }

  /** Log a trading action — uses 'trade' level for filtering */
  trade(source: string, message: string) { this.log(source, 'trade', message); }

  /** Log an order lifecycle event */
  order(source: string, message: string) { this.log(source, 'order', message); }

  getRecent(limit = 50): LogEntry[] {
    return this.logs.slice(-limit).reverse();
  }

  getRecentByLevel(level: LogEntry['level'], limit = 50): LogEntry[] {
    return this.logs.filter(l => l.level === level).slice(-limit).reverse();
  }

  /** Read today's log file (last N lines) */
  readLogFile(lines = 200): string {
    try {
      const filePath = path.join(LOG_DIR, LOG_FILE());
      if (!fs.existsSync(filePath)) return '';
      const content = fs.readFileSync(filePath, 'utf-8');
      const allLines = content.split('\n').filter(Boolean);
      return allLines.slice(-lines).join('\n');
    } catch {
      return '';
    }
  }

  /** Flush queued writes to disk (batched, non-blocking) */
  private async flushQueue() {
    if (this.flushing || this.writeQueue.length === 0) return;
    this.flushing = true;
    const batch = this.writeQueue.splice(0);
    try {
      const filePath = path.join(LOG_DIR, LOG_FILE());
      fs.appendFileSync(filePath, batch.join(''));
    } catch (err) {
      this.logger.warn(`Failed to write log file: ${(err as Error).message}`);
      // Re-queue on failure to avoid data loss
      this.writeQueue.unshift(...batch);
    }
    this.flushing = false;
  }
}
