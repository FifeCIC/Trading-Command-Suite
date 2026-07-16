/**
 * BridgeEventService — Logs broker bridge connectivity events to the database.
 * Provides an audit trail of MT5/T212 bridge state changes (connect, disconnect, error, reconnect).
 *
 * #378 Bridge reliability — log bridge events
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

export interface BridgeEventLog {
  eventType: string;       // connected | disconnected | error | reconnected
  account?: string;
  server?: string;
  balance?: number;
  errorMessage?: string;
}

@Injectable()
export class BridgeEventService {
  private readonly logger = new Logger(BridgeEventService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(event: BridgeEventLog): Promise<void> {
    try {
      await (this.prisma as any).bridgeEvent.create({
        data: {
          eventType: event.eventType,
          account: event.account,
          server: event.server,
          balance: event.balance,
          errorMessage: event.errorMessage?.substring(0, 1000),
        },
      });
      this.logger.debug(`Bridge event logged: ${event.eventType}`);
    } catch (err: unknown) {
      const error = err as Error;
      this.logger.warn(`Failed to log bridge event: ${error.message}`);
    }
  }

  /** Get recent bridge events for the notification disc / status page */
  async getRecent(limit = 50): Promise<any[]> {
    try {
      return await (this.prisma as any).bridgeEvent.findMany({
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
    } catch {
      return [];
    }
  }
}
