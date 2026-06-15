import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

interface T212Position {
  ticker: string;
  quantity: number;
  averagePrice: number;
  currentPrice: number;
  ppl: number;
  fxPpl: number;
  initialFillDate: string;
  frontend: string;
}

export interface T212Account {
  total: number;
  free: number;
  invested: number;
  ppl: number;
  result: number;
  blocked: number;
}

@Injectable()
export class Trading212ImportService {
  private readonly logger = new Logger(Trading212ImportService.name);

  constructor(private readonly prisma: PrismaService) {}

  private getAuthHeader(): string {
    const key = process.env.TRADING212_API_KEY || '';
    const secret = process.env.TRADING212_API_SECRET || '';
    if (key && secret) {
      return 'Basic ' + Buffer.from(`${key}:${secret}`).toString('base64');
    }
    return key; // Fallback to key-only auth
  }

  async validateConnection(): Promise<{ valid: boolean; account?: T212Account; error?: string }> {
    const apiKey = process.env.TRADING212_API_KEY;
    if (!apiKey) {
      return { valid: false, error: 'TRADING212_API_KEY not set in .env' };
    }

    try {
      const auth = this.getAuthHeader();
      const res = await fetch('https://live.trading212.com/api/v0/equity/account/cash', {
        headers: { Authorization: auth },
      });

      if (!res.ok) {
        const text = await res.text();
        return { valid: false, error: `HTTP ${res.status}: ${text.substring(0, 200)}` };
      }

      const account: T212Account = await res.json();
      return { valid: true, account };
    } catch (err) {
      return { valid: false, error: (err as Error).message };
    }
  }

  async importPortfolio(): Promise<{
    success: boolean;
    positionsImported: number;
    symbolsCreated: number;
    account?: T212Account;
    positions?: Array<{ ticker: string; quantity: number; ppl: number; currentPrice: number }>;
    error?: string;
  }> {
    const apiKey = process.env.TRADING212_API_KEY;
    if (!apiKey) return { success: false, positionsImported: 0, symbolsCreated: 0, error: 'No API key' };

    try {
      const auth = this.getAuthHeader();
      // Fetch account
      const accountRes = await fetch('https://live.trading212.com/api/v0/equity/account/cash', {
        headers: { Authorization: auth },
      });
      const account: T212Account = accountRes.ok ? await accountRes.json() : null;

      // Fetch positions
      const posRes = await fetch('https://live.trading212.com/api/v0/equity/portfolio', {
        headers: { Authorization: auth },
      });

      if (!posRes.ok) {
        return { success: false, positionsImported: 0, symbolsCreated: 0, account, error: `Positions HTTP ${posRes.status}` };
      }

      const positions: T212Position[] = await posRes.json();
      this.logger.log(`Trading212: fetched ${positions.length} positions, account balance: ${account?.total}`);

      let symbolsCreated = 0;
      const imported: Array<{ ticker: string; quantity: number; ppl: number; currentPrice: number }> = [];

      for (const pos of positions) {
        // Clean ticker: strip Trading212 suffixes like _US_EQ, _EQ
        const cleanTicker = pos.ticker.replace(/_US_EQ$/, '').replace(/_EQ$/, '');

        // Ensure symbol exists in our DB
        try {
          const existing = await this.prisma.symbol.findUnique({ where: { ticker: cleanTicker } });
          if (!existing && this.prisma.isAvailable) {
            await this.prisma.symbol.create({
              data: {
                ticker: cleanTicker,
                name: cleanTicker,
                exchange: 'Trading212',
                type: 'stock',
              },
            });
            symbolsCreated++;
          }
        } catch { /* DB may not be available */ }

        imported.push({
          ticker: pos.ticker,
          quantity: pos.quantity,
          ppl: pos.ppl,
          currentPrice: pos.currentPrice,
        });
      }

      // Store account snapshot
      if (account) {
        this.logger.log(`Trading212: imported ${imported.length} positions, account value: $${account.total}`);
      }

      return {
        success: true,
        positionsImported: imported.length,
        symbolsCreated,
        account,
        positions: imported,
      };
    } catch (err) {
      return { success: false, positionsImported: 0, symbolsCreated: 0, error: (err as Error).message };
    }
  }
}
