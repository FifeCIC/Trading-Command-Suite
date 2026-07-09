/**
 * QuoteGateway — WebSocket gateway for live quote streaming.
 *
 * Streams MT5 bid/ask ticks to connected clients via Socket.io.
 * Replaces HTTP polling for the Charts Lab and any real-time quote consumers.
 *
 * Events:
 *   Client → Server:  'subscribe:quote'  { symbol: string }
 *   Client → Server:  'unsubscribe:quote' { symbol: string }
 *   Server → Client:  'quote:tick'       { symbol, bid, ask, mid, spread, timestamp }
 */

import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, OnModuleInit } from '@nestjs/common';
import { Mt5Adapter } from '../providers/adapters/mt5.adapter';

interface QuoteTick {
  symbol: string;
  bid: number;
  ask: number;
  mid: number;
  spread: number;
  timestamp: string;
}

@WebSocketGateway({
  namespace: '/quotes',
  cors: { origin: '*', methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling'],
})
export class QuoteGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(QuoteGateway.name);

  /** Map symbol → Set<socketId> for active subscriptions */
  private subscriptions = new Map<string, Set<string>>();
  private pollingTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly mt5: Mt5Adapter) {}

  onModuleInit() {
    // Poll MT5 every 250ms and emit to subscribers
    this.pollingTimer = setInterval(() => this.pollAndEmit(), 250);
    this.logger.log('QuoteGateway initialized — polling MT5 every 250ms');
  }

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    // Remove all subscriptions for this client
    for (const [symbol, sockets] of this.subscriptions.entries()) {
      sockets.delete(client.id);
      if (sockets.size === 0) this.subscriptions.delete(symbol);
    }
    this.logger.log(`Client disconnected: ${client.id} (${client.conn.transport.name})`);
  }

  @SubscribeMessage('subscribe:quote')
  handleSubscribe(client: Socket, payload: { symbol: string }) {
    const symbol = payload.symbol?.toUpperCase();
    if (!symbol) return { error: 'symbol required' };

    if (!this.subscriptions.has(symbol)) {
      this.subscriptions.set(symbol, new Set());
    }
    this.subscriptions.get(symbol)!.add(client.id);

    // Join the Socket.io room for targeted emits
    client.join(`quote:${symbol}`);

    this.logger.log(`${client.id} subscribed to ${symbol} (total subs: ${this.subscriptions.get(symbol)!.size})`);
    return { subscribed: symbol };
  }

  @SubscribeMessage('unsubscribe:quote')
  handleUnsubscribe(client: Socket, payload: { symbol: string }) {
    const symbol = payload.symbol?.toUpperCase();
    if (!symbol) return { error: 'symbol required' };

    const sockets = this.subscriptions.get(symbol);
    if (sockets) {
      sockets.delete(client.id);
      if (sockets.size === 0) this.subscriptions.delete(symbol);
    }

    client.leave(`quote:${symbol}`);
    return { unsubscribed: symbol };
  }

  private async pollAndEmit() {
    if (this.subscriptions.size === 0) return;

    for (const [symbol] of this.subscriptions) {
      try {
        const quote = await this.mt5.getQuote(symbol);
        if (!quote || quote.bid == null || quote.ask == null) continue;

        const bid = quote.bid;
        const ask = quote.ask;
        const tick: QuoteTick = {
          symbol,
          bid,
          ask,
          mid: +((bid + ask) / 2).toFixed(5),
          spread: +(ask - bid).toFixed(5),
          timestamp: new Date().toISOString(),
        };

        this.server.to(`quote:${symbol}`).emit('quote:tick', tick);
      } catch {
        // Silently skip failed symbols — MT5 may not have this instrument
      }
    }
  }

  /** Called on app shutdown — clean up timer */
  onModuleDestroy() {
    if (this.pollingTimer) clearInterval(this.pollingTimer);
  }
}
