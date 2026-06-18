import { Injectable, Logger } from '@nestjs/common';

export type IsaTradeSide = 'buy' | 'sell';

interface Trading212Cash {
  blocked?: number;
  free?: number;
  invested?: number;
  pieCash?: number;
  ppl?: number;
  result?: number;
  total?: number;
}

interface Trading212Position {
  averagePrice?: number;
  currentPrice?: number;
  fxPpl?: number;
  initialFillDate?: string;
  ppl?: number;
  quantity?: number;
  ticker?: string;
}

interface IsaWarningRequest {
  symbol: string;
  side: IsaTradeSide;
  amountGbp?: number;
  exchange?: string;
}

const ISA_ALLOWANCE_LIMIT_GBP = 20_000;
const DEFAULT_BASE_URL = 'https://live.trading212.com/api/v0';

@Injectable()
export class IsaService {
  private readonly logger = new Logger(IsaService.name);
  private readonly apiKey = process.env.TRADING212_ISA_API_KEY || '';
  private readonly baseUrl = process.env.TRADING212_ISA_BASE_URL || DEFAULT_BASE_URL;

  async getDashboard() {
    const [account, positions] = await Promise.all([
      this.fetchAccountCash(),
      this.fetchPositions(),
    ]);

    const allowanceUsed = this.readAllowanceUsed();
    const foreignPositions = positions.filter((position) =>
      this.isForeignListed(position.ticker || ''),
    );
    const fxPpl = positions.reduce((sum, position) => sum + (position.fxPpl || 0), 0);
    const invested = account?.invested ?? positions.reduce((sum, position) => {
      return sum + (position.currentPrice || 0) * (position.quantity || 0);
    }, 0);

    return {
      status: this.apiKey ? 'connected' : 'not_configured',
      accountType: 'stocks_isa',
      currency: 'GBP',
      summary: {
        totalValueGbp: account?.total ?? null,
        cashGbp: account?.free ?? null,
        investedGbp: invested || null,
        resultGbp: account?.result ?? null,
        positionCount: positions.length,
      },
      allowance: {
        taxYear: this.currentUkTaxYear(),
        limitGbp: ISA_ALLOWANCE_LIMIT_GBP,
        usedGbp: allowanceUsed,
        remainingGbp: Math.max(ISA_ALLOWANCE_LIMIT_GBP - allowanceUsed, 0),
        source: process.env.TRADING212_ISA_ALLOWANCE_USED_GBP ? 'env' : 'not_configured',
      },
      fxImpact: {
        status: 'pending_fx_data',
        foreignPositionCount: foreignPositions.length,
        observedFxPplGbp: fxPpl || null,
        message: 'Real FX comparison against 20-day averages requires Q289 FX data infrastructure.',
      },
      tradingWindow: {
        status: 'baseline_only',
        bestTimeToTradeToday: '13:00-17:00 GMT',
        rationale: 'London/New York overlap is the baseline high-liquidity window until historical FX pattern analysis is available.',
      },
      warnings: this.buildDashboardWarnings(allowanceUsed, foreignPositions.length),
      positions: positions.map((position) => ({
        symbol: this.stripTicker(position.ticker || ''),
        ticker: position.ticker || '',
        quantity: position.quantity ?? null,
        currentPriceGbp: position.currentPrice ?? null,
        valueGbp: position.currentPrice != null && position.quantity != null
          ? position.currentPrice * position.quantity
          : null,
        pnlGbp: position.ppl ?? null,
        fxPplGbp: position.fxPpl ?? null,
        foreignListed: this.isForeignListed(position.ticker || ''),
      })),
    };
  }

  async getFxWarning(request: IsaWarningRequest) {
    const symbol = request.symbol.trim().toUpperCase();
    const foreignListing = this.getForeignListing(symbol, request.exchange);

    if (!symbol) {
      return this.neutralWarning('Symbol is required before an ISA FX warning can be assessed.');
    }

    if (!foreignListing) {
      return this.neutralWarning(`${symbol} is not recognised as a foreign-listed ISA instrument from the available listing metadata.`);
    }

    return {
      status: 'pending_fx_data',
      blocking: false,
      side: request.side,
      symbol,
      pair: foreignListing.pair,
      severity: 'info',
      title: 'ISA FX timing check unavailable',
      message: `This ${request.side} is advisory-only. ${foreignListing.label} FX timing needs the Q289 FX rate endpoint before current rates can be compared with the 20-day average.`,
      amountGbp: Number.isFinite(request.amountGbp) ? request.amountGbp : null,
      action: 'Proceed if the trade thesis is still valid; re-check FX timing once real FX data is connected.',
    };
  }

  private async fetchAccountCash(): Promise<Trading212Cash | null> {
    if (!this.apiKey) return null;

    try {
      const res = await fetch(`${this.baseUrl}/equity/account/cash`, {
        headers: { Authorization: this.apiKey },
      });
      if (!res.ok) {
        this.logger.warn(`Trading212 ISA account fetch failed: HTTP ${res.status}`);
        return null;
      }
      return await res.json();
    } catch (err) {
      this.logger.error(`Trading212 ISA account fetch failed: ${(err as Error).message}`);
      return null;
    }
  }

  private async fetchPositions(): Promise<Trading212Position[]> {
    if (!this.apiKey) return [];

    try {
      const res = await fetch(`${this.baseUrl}/equity/portfolio`, {
        headers: { Authorization: this.apiKey },
      });
      if (!res.ok) {
        this.logger.warn(`Trading212 ISA positions fetch failed: HTTP ${res.status}`);
        return [];
      }
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    } catch (err) {
      this.logger.error(`Trading212 ISA positions fetch failed: ${(err as Error).message}`);
      return [];
    }
  }

  private buildDashboardWarnings(allowanceUsed: number, foreignPositionCount: number) {
    const warnings: Array<{ type: string; severity: string; message: string }> = [];
    const remaining = Math.max(ISA_ALLOWANCE_LIMIT_GBP - allowanceUsed, 0);

    if (!this.apiKey) {
      warnings.push({
        type: 'isa_connection',
        severity: 'info',
        message: 'Set TRADING212_ISA_API_KEY to enable the Stocks ISA dashboard from real Trading212 data.',
      });
    }

    warnings.push({
      type: 'allowance',
      severity: remaining <= 1_000 ? 'warning' : 'info',
      message: `Stocks ISA allowance remaining for ${this.currentUkTaxYear()}: £${remaining.toLocaleString('en-GB')}.`,
    });

    if (foreignPositionCount > 0) {
      warnings.push({
        type: 'fx_data',
        severity: 'info',
        message: `${foreignPositionCount} ISA position(s) are foreign-listed. FX timing warnings are advisory until Q289 is implemented.`,
      });
    }

    return warnings;
  }

  private readAllowanceUsed(): number {
    const raw = Number(process.env.TRADING212_ISA_ALLOWANCE_USED_GBP || 0);
    if (!Number.isFinite(raw) || raw < 0) return 0;
    return Math.min(raw, ISA_ALLOWANCE_LIMIT_GBP);
  }

  private currentUkTaxYear(): string {
    const now = new Date();
    const year = now.getUTCFullYear();
    const taxYearStart = Date.UTC(year, 3, 6);
    const startYear = now.getTime() >= taxYearStart ? year : year - 1;
    return `${startYear}/${String(startYear + 1).slice(-2)}`;
  }

  private stripTicker(ticker: string): string {
    return ticker.split('_')[0] || ticker;
  }

  private isForeignListed(ticker: string): boolean {
    return Boolean(this.getForeignListing(ticker));
  }

  private getForeignListing(symbolOrTicker: string, exchange?: string) {
    const value = symbolOrTicker.toUpperCase();
    const venue = (exchange || '').toUpperCase();

    if (venue.includes('LSE') || venue.includes('LONDON') || venue === 'XLON') {
      return null;
    }

    if (venue.includes('NASDAQ') || venue.includes('NYSE') || venue === 'US') {
      return { pair: 'USDGBP', label: 'USD/GBP' };
    }

    if (value.includes('_US_') || value.endsWith('_US_EQ')) {
      return { pair: 'USDGBP', label: 'USD/GBP' };
    }

    if (value.includes('_EU_') || value.includes('_DE_') || value.includes('_FR_')) {
      return { pair: 'EURGBP', label: 'EUR/GBP' };
    }
    return null;
  }

  private neutralWarning(message: string) {
    return {
      status: 'neutral',
      blocking: false,
      severity: 'none',
      title: 'No ISA FX warning',
      message,
      action: 'No FX timing action required.',
    };
  }
}
