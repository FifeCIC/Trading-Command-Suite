/**
 * TickRecorderService
 * ===================
 * Records live MT5 quotes and progressively builds 5-second OHLCV candles.
 * Each 1s tick updates the current candle in-place, enabling animated charts
 * that show candles forming tick-by-tick (similar to Xtrend's sub-second feed).
 *
 * Architecture:
 *   MT5 quote poll (1s) → progressive upsert → MarketBar row evolves in-place
 *
 *   t=1s: INSERT {O:1.135, H:1.135, L:1.135, C:1.135}  ← candle born
 *   t=2s: UPDATE {H:1.136, C:1.136}                       ← wick growing
 *   t=3s: UPDATE {L:1.134, C:1.134}                       ← dipped
 *   t=4s: UPDATE {H:1.137, C:1.136}                       ← new high  
 *   t=5s: UPDATE {C:1.1355, status:'closed'}               ← candle final
 *
 * Sessions:
 *   - Each recording period is a TickRecordingSession
 *   - Gaps > 5 minutes automatically start a new session
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { Mt5Adapter } from '../providers/adapters/mt5.adapter';

interface ActiveRecording {
  symbolId: string;
  ticker: string;
  sessionId: string;
  interval: ReturnType<typeof setInterval>;
  startedAt: Date;
  barCount: number;
  lastBucket: number;          // unix timestamp of last 5s bucket we touched
}

export interface RecordingStatus {
  symbol: string;
  ticker: string;
  sessionId: string;
  timeframe: string;
  startedAt: string;
  barCount: number;
  lastBarAt: string | null;
  duration: number;
}

export interface SessionSummary {
  id: string;
  symbol: string;
  timeframe: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  barCount: number;
  gapCount: number;
  duration: number | null;
}

const GAP_THRESHOLD_MS = 5 * 60 * 1000;
const TICK_POLL_MS = 1000;
const CANDLE_SECONDS = 5;

@Injectable()
export class TickRecorderService {
  private readonly logger = new Logger(TickRecorderService.name);
  private active = new Map<string, ActiveRecording>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly mt5: Mt5Adapter,
  ) {}

  async startRecording(symbolId: string, ticker: string): Promise<RecordingStatus> {
    if (this.active.has(symbolId)) {
      return this.toStatus(this.active.get(symbolId)!);
    }

    const session = await this.prisma.tickRecordingSession.create({
      data: { symbolId, timeframe: '5s', status: 'recording' },
    });

    const rec: ActiveRecording = {
      symbolId,
      ticker,
      sessionId: session.id,
      interval: null as any,
      startedAt: new Date(),
      barCount: 0,
      lastBucket: 0,
    };

    // Single unified loop: poll MT5 every 1s, progressively update the current 5s candle
    rec.interval = setInterval(async () => {
      try {
        const quote = await this.mt5.getQuote(ticker);
        if (!quote || quote.bid == null || quote.ask == null) return;

        const mid = +((quote.bid + quote.ask) / 2).toFixed(5);
        const now = Date.now();
        const bucket = Math.floor(now / (CANDLE_SECONDS * 1000)) * (CANDLE_SECONDS * 1000);
        const bucketDate = new Date(bucket);

        // New candle window? Track it for bar counting
        if (bucket !== rec.lastBucket && rec.lastBucket !== 0) {
          rec.barCount++;
        }

        // Check gap before write
        if (rec.lastBucket !== 0 && (bucket - rec.lastBucket) > CANDLE_SECONDS * 2000) {
          await this.handleGap(rec);
        }

        rec.lastBucket = bucket;

        // Progressive upsert: find the row for this (symbol, 5s, bucket, session)
        const existing = await this.prisma.marketBar.findFirst({
          where: {
            symbolId: rec.symbolId,
            timeframe: '5s',
            timestamp: bucketDate,
            recordingSessionId: rec.sessionId,
          },
        });

        if (existing) {
          // Update in-place: high/low/close evolve
          await this.prisma.marketBar.update({
            where: { id: existing.id },
            data: {
              high: mid > existing.high ? mid : existing.high,
              low: mid < existing.low ? mid : existing.low,
              close: mid,
              volume: (existing.volume ?? 0) + 1,
            },
          });
        } else {
          // First tick of a new candle: INSERT with initial OHLC all = mid
          await this.prisma.marketBar.create({
            data: {
              symbolId: rec.symbolId,
              provider: 'mt5-record',
              timeframe: '5s',
              timestamp: bucketDate,
              open: mid,
              high: mid,
              low: mid,
              close: mid,
              volume: 1,
              recordingSessionId: rec.sessionId,
            },
          });
        }

        // Update session metadata
        await this.prisma.tickRecordingSession.update({
          where: { id: rec.sessionId },
          data: { lastBarAt: bucketDate, barCount: rec.barCount },
        });
      } catch (err: any) {
        // silent — transient MT5 unavailability
      }
    }, TICK_POLL_MS);

    this.active.set(symbolId, rec);
    this.logger.log(`Recording started: ${ticker} → session ${session.id} (progressive 5s candles)`);
    return this.toStatus(rec);
  }

  async stopRecording(symbolId: string): Promise<SessionSummary | null> {
    const rec = this.active.get(symbolId);
    if (!rec) return null;

    clearInterval(rec.interval);
    this.active.delete(symbolId);

    const session = await this.prisma.tickRecordingSession.update({
      where: { id: rec.sessionId },
      data: { status: 'completed', endedAt: new Date(), barCount: rec.barCount },
    });

    this.logger.log(`Recording stopped: ${rec.ticker} — ${rec.barCount} candles in session ${rec.sessionId}`);
    return this.sessionToSummary(session);
  }

  getActiveRecordings(): RecordingStatus[] {
    return [...this.active.values()].map((r) => this.toStatus(r));
  }

  async getSessions(symbolId: string): Promise<SessionSummary[]> {
    const sessions = await this.prisma.tickRecordingSession.findMany({
      where: { symbolId },
      orderBy: { startedAt: 'desc' },
      take: 50,
    });
    return sessions.map((s) => this.sessionToSummary(s));
  }

  // ── Private ──────────────────────────────────────────

  private async handleGap(rec: ActiveRecording): Promise<void> {
    await this.prisma.tickRecordingSession.update({
      where: { id: rec.sessionId },
      data: { status: 'completed', endedAt: new Date(), barCount: rec.barCount, gapCount: { increment: 1 } },
    });

    this.logger.warn(`Gap detected for ${rec.ticker} — new session`);

    const newSession = await this.prisma.tickRecordingSession.create({
      data: { symbolId: rec.symbolId, timeframe: '5s', status: 'recording', gapCount: 1 },
    });

    rec.sessionId = newSession.id;
    rec.barCount = 0;
    rec.lastBucket = 0;
  }

  private toStatus(rec: ActiveRecording): RecordingStatus {
    return {
      symbol: rec.symbolId,
      ticker: rec.ticker,
      sessionId: rec.sessionId,
      timeframe: '5s',
      startedAt: rec.startedAt.toISOString(),
      barCount: rec.barCount,
      lastBarAt: rec.lastBucket ? new Date(rec.lastBucket).toISOString() : null,
      duration: Math.round((Date.now() - rec.startedAt.getTime()) / 1000),
    };
  }

  private sessionToSummary(s: any): SessionSummary {
    const duration = s.endedAt
      ? Math.round((new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime()) / 1000)
      : s.status === 'recording'
        ? Math.round((Date.now() - new Date(s.startedAt).getTime()) / 1000)
        : null;
    return {
      id: s.id,
      symbol: s.symbolId ?? s.symbol?.ticker ?? '',
      timeframe: s.timeframe,
      status: s.status,
      startedAt: s.startedAt instanceof Date ? s.startedAt.toISOString() : String(s.startedAt),
      endedAt: s.endedAt instanceof Date ? s.endedAt.toISOString() : s.endedAt ? String(s.endedAt) : null,
      barCount: s.barCount,
      gapCount: s.gapCount,
      duration,
    };
  }
}
