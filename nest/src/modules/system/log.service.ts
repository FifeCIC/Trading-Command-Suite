import { Injectable } from '@nestjs/common';

export interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  source: string;
  message: string;
}

@Injectable()
export class SystemLogService {
  private readonly logs: LogEntry[] = [];
  private readonly maxLogs = 200;

  log(source: string, level: LogEntry['level'], message: string) {
    this.logs.push({ timestamp: new Date().toISOString(), level, source, message });
    if (this.logs.length > this.maxLogs) this.logs.shift();
  }

  info(source: string, message: string) { this.log(source, 'info', message); }
  warn(source: string, message: string) { this.log(source, 'warn', message); }
  error(source: string, message: string) { this.log(source, 'error', message); }

  getRecent(limit = 50): LogEntry[] {
    return this.logs.slice(-limit).reverse();
  }
}
