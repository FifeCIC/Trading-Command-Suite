/**
 * ScoringLogService — unified JSON-lines logging system.
 *
 * Writes structured JSON entries to rotating log files in /logs/scoring/.
 * Categories: scoring_run | signal | trade | provider_health | error
 *
 * Also maintains an in-memory buffer for SSE streaming and recent queries.
 */

import { Injectable, Logger } from '@nestjs/common';
import { appendFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';

export type LogCategory = 'scoring_run' | 'signal' | 'trade' | 'provider_health' | 'error';

export interface LogEntry {
  timestamp: string;
  category: LogCategory;
  level: 'info' | 'warn' | 'error';
  message: string;
  data?: Record<string, any>;
}

const LOG_DIR = join(process.cwd(), 'logs', 'scoring');
const MAX_BUFFER = 500;        // In-memory buffer for SSE + recent queries
const MAX_LINES_PER_FILE = 50_000;

@Injectable()
export class ScoringLogService {
  private readonly logger = new Logger(ScoringLogService.name);
  private readonly buffer: LogEntry[] = [];

  constructor() {
    if (!existsSync(LOG_DIR)) {
      mkdirSync(LOG_DIR, { recursive: true });
    }
  }

  // ── Write ─────────────────────────────────────────────

  /** Log a scoring run result */
  logScoringRun(data: {
    symbolsScored: number;
    avgScore: number;
    topSymbol?: string;
    topScore?: number;
    durationMs: number;
    strategyId?: string;
  }): void {
    this.write('scoring_run', 'info', `${data.symbolsScored} symbols scored (avg ${data.avgScore.toFixed(1)})`, data);
  }

  /** Log a trading signal */
  logSignal(data: {
    symbol: string;
    composite: number;
    signal: string;
    confidence: number;
    rarity?: string;
  }): void {
    this.write('signal', 'info', `${data.symbol}: ${data.signal} @ ${data.composite} (${data.confidence}%)`, data);
  }

  /** Log a trade execution */
  logTrade(data: {
    symbol: string;
    side: string;
    quantity: number;
    price?: number;
    ticket?: string | number;
    success: boolean;
    error?: string;
  }): void {
    const level = data.success ? 'info' : 'error';
    const msg = data.success
      ? `${data.side} ${data.symbol} ×${data.quantity} — ticket ${data.ticket}`
      : `${data.side} ${data.symbol} FAILED: ${data.error}`;
    this.write('trade', level, msg, data);
  }

  /** Log provider health status */
  logProviderHealth(data: {
    providerId: string;
    status: 'healthy' | 'degraded' | 'failed';
    reason?: string;
  }): void {
    const level = data.status === 'failed' ? 'error' : data.status === 'degraded' ? 'warn' : 'info';
    this.write('provider_health', level, `${data.providerId}: ${data.status}`, data);
  }

  /** Log an error */
  logError(message: string, data?: Record<string, any>): void {
    this.write('error', 'error', message, data);
  }

  // ── Read ──────────────────────────────────────────────

  /** Get recent log entries from the in-memory buffer */
  getRecent(limit = 50, category?: LogCategory): LogEntry[] {
    let entries = [...this.buffer];
    if (category) {
      entries = entries.filter(e => e.category === category);
    }
    return entries.slice(-limit).reverse();
  }

  /** Get error heatmap data — error count by category and hour */
  getHeatmap(hours = 24): {
    buckets: Array<{ hour: string; category: string; count: number }>;
  } {
    const cutoff = Date.now() - hours * 3600_000;
    const recent = this.buffer.filter(e => e.level === 'error' && new Date(e.timestamp).getTime() > cutoff);

    const buckets = new Map<string, number>();
    for (const entry of recent) {
      const d = new Date(entry.timestamp);
      const hour = `${d.toISOString().slice(0, 13)}:00`;
      const key = `${hour}::${entry.category}`;
      buckets.set(key, (buckets.get(key) || 0) + 1);
    }

    return {
      buckets: Array.from(buckets.entries()).map(([key, count]) => {
        const [hour, category] = key.split('::');
        return { hour, category, count };
      }).sort((a, b) => a.hour.localeCompare(b.hour)),
    };
  }

  /** Get all buffered entries (for SSE streaming initialization) */
  getBuffer(): LogEntry[] {
    return [...this.buffer];
  }

  /** Get the current file path for today's log */
  getLogFilePath(): string {
    const today = new Date().toISOString().slice(0, 10);
    return join(LOG_DIR, `scoring-${today}.jsonl`);
  }

  // ── Private ───────────────────────────────────────────

  private write(
    category: LogCategory,
    level: 'info' | 'warn' | 'error',
    message: string,
    data?: Record<string, any>,
  ): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      category,
      level,
      message,
      data,
    };

    // In-memory buffer
    this.buffer.push(entry);
    if (this.buffer.length > MAX_BUFFER) {
      this.buffer.shift();
    }

    // File persistence
    try {
      const line = JSON.stringify(entry) + '\n';
      const filePath = this.getLogFilePath();
      appendFileSync(filePath, line, 'utf-8');
    } catch (err) {
      this.logger.warn(`Failed to write scoring log to file: ${(err as Error).message}`);
    }
  }
}
