import { Injectable, Logger } from '@nestjs/common';

export interface SessionInfo {
  startTime: Date;
  trades: number;
  wins: number;
  losses: number;
  totalPnl: number;
  active: boolean;
}

@Injectable()
export class SessionTrackerService {
  private readonly logger = new Logger(SessionTrackerService.name);
  private sessions: SessionInfo[] = [];
  private current: SessionInfo | null = null;

  start(): SessionInfo {
    this.current = { startTime: new Date(), trades: 0, wins: 0, losses: 0, totalPnl: 0, active: true };
    this.sessions.push(this.current);
    return this.current;
  }

  getCurrent(): SessionInfo | null { return this.current; }

  recordTrade(profit: number): void {
    if (!this.current) this.start();
    this.current!.trades++;
    this.current!.totalPnl += profit;
    if (profit > 0) this.current!.wins++;
    else if (profit < 0) this.current!.losses++;
  }

  end(): SessionInfo | null {
    if (!this.current) return null;
    this.current.active = false;
    const s = this.current;
    this.current = null;
    return s;
  }

  getSessionDuration(): number {
    if (!this.current) return 0;
    return (Date.now() - this.current.startTime.getTime()) / 1000;
  }

  getWinRate(): number {
    if (!this.current || this.current.trades === 0) return 0;
    return this.current.wins / this.current.trades;
  }

  getStats() {
    if (!this.current) return { active: false, duration: 0, trades: 0, winRate: 0, pnl: 0, warning: false };
    const duration = this.getSessionDuration();
    const durationMin = Math.floor(duration / 60);
    const warning = durationMin > 15; // Warning after 15 minutes
    return {
      active: true,
      duration: durationMin,
      trades: this.current.trades,
      winRate: this.getWinRate(),
      pnl: this.current.totalPnl,
      warning,
      warningMsg: warning ? `⚠️ Session: ${durationMin} min. Historical win rate drops 40% after 15 min.` : null,
    };
  }

  getHistory(): SessionInfo[] { return this.sessions.slice(-20); }
}
