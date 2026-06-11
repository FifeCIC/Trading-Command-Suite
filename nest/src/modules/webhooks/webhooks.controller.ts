import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

interface MarketDataPayload {
  symbol: string;
  timeframe: string;
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Post('market-data')
  @HttpCode(HttpStatus.CREATED)
  async receiveMarketData(@Body() payload: MarketDataPayload[]) {
    const entries = Array.isArray(payload) ? payload : [payload];
    this.logger.log(`Received ${entries.length} market data entries`);

    let stored = 0;
    for (const entry of entries) {
      // Find or create symbol
      let symbol = await this.prisma.symbol.findUnique({
        where: { ticker: entry.symbol },
      });

      if (!symbol) {
        symbol = await this.prisma.symbol.create({
          data: {
            ticker: entry.symbol,
            name: entry.symbol,
            exchange: 'WEBHOOK',
            type: 'stock',
          },
        });
      }

      // Store market bar
      await this.prisma.marketBar.create({
        data: {
          symbolId: symbol.id,
          timeframe: entry.timeframe,
          timestamp: new Date(entry.timestamp),
          open: entry.open,
          high: entry.high,
          low: entry.low,
          close: entry.close,
          volume: entry.volume,
          provider: 'WEBHOOK',
        },
      });
      stored++;
    }

    return { stored, total: entries.length };
  }
}
