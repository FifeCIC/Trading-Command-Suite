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

/**
 * What a fetch ATTEMPT produced. The three outcomes are deliberately distinct because a key that is
 * PRESENT is not a key that WORKS, and collapsing them let a 401 render as a healthy empty account.
 *
 * Measured 2026-11-12: `TRADING212_ISA_API_KEY` was set, Trading212 answered **HTTP 401** on both
 * `/equity/account/cash` and `/equity/portfolio`, and the dashboard still reported
 * `status: 'connected'` with every summary field `null` and `positionCount: 0`. Read as a user, that
 * says "your ISA is connected and holds nothing" — a claim about their money — when the truth was
 * "we could not ask". Those are different facts and only one of them is evidence.
 *
 * ⚠️ Declared as a SINGLE shape with optional fields, NOT a discriminated union on `ok`. This repo
 * runs `strictNullChecks: false` (nest/tsconfig.json), where `ok: true` / `ok: false` collapse to
 * `boolean` and `if (outcome.ok)` does NOT narrow — the first two versions of this change failed to
 * compile for exactly that reason, and a union that cannot be narrowed is worse than a bag of
 * optionals that can.
 */
interface FetchOutcome<T> {
  ok: boolean;
  data?: T;
  reason?: FetchFailureReason;
  detail?: string;
}

type FetchFailureReason = 'not_configured' | 'unauthorised' | 'error';

/** The failure (or null) from a fetch outcome — one place that reads the optional fields. */
function failureOf<T>(outcome: FetchOutcome<T>): { reason: FetchFailureReason; detail: string } | null {
  if (outcome.ok) return null;
  return { reason: outcome.reason || 'error', detail: outcome.detail || 'no detail recorded' };
}

@Injectable()
export class IsaService {
  private readonly logger = new Logger(IsaService.name);
  private readonly apiKey = process.env.TRADING212_ISA_API_KEY || '';
  private readonly apiSecret = process.env.TRADING212_ISA_API_SECRET || '';
  private readonly baseUrl = process.env.TRADING212_ISA_BASE_URL || DEFAULT_BASE_URL;

  /**
   * authHeaders() — HTTP BASIC (key:secret), because that is what Trading212 accepts.
   *
   * ⚠️ MEASURED 2026-11-12 against the live API with the configured ISA key:
   *     key-only                 → HTTP 401
   *     Basic base64(key:secret) → HTTP 200
   *
   * The service sent the key alone, so BOTH fetches were rejected on every call while the dashboard
   * reported `connected`. A rejected credential is invisible from the outside when the only symptom
   * is a null field — which is why `status` is now derived from the fetch outcome, not the key.
   */
  private authHeaders(): Record<string, string> {
    if (this.apiSecret) {
      const token = Buffer.from(`${this.apiKey}:${this.apiSecret}`).toString('base64');
      return { Authorization: `Basic ${token}` };
    }
    return { Authorization: this.apiKey };
  }

  async getDashboard() {
    const [accountOutcome, positionsOutcome] = await Promise.all([
      this.fetchAccountCash(),
      this.fetchPositions(),
    ]);

    const account = accountOutcome.ok ? (accountOutcome.data ?? null) : null;
    const positions = positionsOutcome.ok ? (positionsOutcome.data ?? []) : [];

    // ⚠️ The status is derived from the FETCHES, not from whether a key exists. A present key that
    // T212 rejects is `unauthorised`, not `connected` — see FetchOutcome above.
    const failure = failureOf(accountOutcome) ?? failureOf(positionsOutcome);
    const status = this.apiKey && !failure ? 'connected' : (failure ? failure.reason : 'not_configured');

    const allowanceUsed = this.readAllowanceUsed();
    const foreignPositions = positions.filter((position) =>
      this.isForeignListed(position.ticker || ''),
    );
    const fxPpl = positions.reduce((sum, position) => sum + (position.fxPpl || 0), 0);
    const invested = account?.invested ?? positions.reduce((sum, position) => {
      return sum + (position.currentPrice || 0) * (position.quantity || 0);
    }, 0);

    return {
      status,
      accountType: 'stocks_isa',
      currency: 'GBP',
      /**
       * ⚠️ `readable` says whether these numbers came from Trading212. When it is false the summary
       * fields are null BECAUSE NOTHING WAS READ, and a consumer must render "unavailable", never
       * "£0" and never "connected".
       */
      readable: status === 'connected',
      summary: {
        totalValueGbp: account?.total ?? null,
        cashGbp: account?.free ?? null,
        investedGbp: invested || null,
        resultGbp: account?.result ?? null,
        positionCount: status === 'connected' ? positions.length : null,
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
      warnings: this.buildDashboardWarnings(allowanceUsed, foreignPositions.length, failure),
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

  private async fetchAccountCash(): Promise<FetchOutcome<Trading212Cash>> {
    if (!this.apiKey) return { ok: false, reason: 'not_configured', detail: 'TRADING212_ISA_API_KEY is not set' };

    try {
      const res = await fetch(`${this.baseUrl}/equity/account/cash`, { headers: this.authHeaders() });
      if (!res.ok) {
        const detail = `HTTP ${res.status}`;
        this.logger.warn(`Trading212 ISA account fetch failed: ${detail}`);
        return { ok: false, reason: this.isAuthFailure(res.status) ? 'unauthorised' : 'error', detail };
      }
      return { ok: true, data: await res.json() };
    } catch (err) {
      const detail = (err as Error).message;
      this.logger.error(`Trading212 ISA account fetch failed: ${detail}`);
      return { ok: false, reason: 'error', detail };
    }
  }

  private async fetchPositions(): Promise<FetchOutcome<Trading212Position[]>> {
    if (!this.apiKey) return { ok: false, reason: 'not_configured', detail: 'TRADING212_ISA_API_KEY is not set' };

    try {
      const res = await fetch(`${this.baseUrl}/equity/portfolio`, { headers: this.authHeaders() });
      if (!res.ok) {
        const detail = `HTTP ${res.status}`;
        this.logger.warn(`Trading212 ISA positions fetch failed: ${detail}`);
        return { ok: false, reason: this.isAuthFailure(res.status) ? 'unauthorised' : 'error', detail };
      }
      const data = await res.json();
      return { ok: true, data: Array.isArray(data) ? data : [] };
    } catch (err) {
      const detail = (err as Error).message;
      this.logger.error(`Trading212 ISA positions fetch failed: ${detail}`);
      return { ok: false, reason: 'error', detail };
    }
  }

  /** 401/403 mean the credential is wrong or expired — a different fix from a 5xx or a timeout. */
  private isAuthFailure(status: number): boolean {
    return status === 401 || status === 403;
  }

  private buildDashboardWarnings(
    allowanceUsed: number,
    foreignPositionCount: number,
    failure?: { reason: 'not_configured' | 'unauthorised' | 'error'; detail: string } | null,
  ) {
    const warnings: Array<{ type: string; severity: string; message: string }> = [];
    const remaining = Math.max(ISA_ALLOWANCE_LIMIT_GBP - allowanceUsed, 0);

    if (!this.apiKey) {
      warnings.push({
        type: 'isa_connection',
        severity: 'info',
        message: 'Set TRADING212_ISA_API_KEY to enable the Stocks ISA dashboard from real Trading212 data.',
      });
    } else if (failure?.reason === 'unauthorised') {
      // ⚠️ The measured state on 2026-11-12: key present, Trading212 answered 401, and the dashboard
      // said "connected". The message must name the ACTION (a new key), not the mechanism (a 401).
      warnings.push({
        type: 'isa_connection',
        severity: 'error',
        message: `The Stocks ISA API key was REJECTED by Trading212 (${failure.detail}). ` +
          'Holdings and values are unavailable — not empty. Generate a new key in Trading212 and set ' +
          'TRADING212_ISA_API_KEY, then restart the API (the key is read at import).',
      });
    } else if (failure) {
      warnings.push({
        type: 'isa_connection',
        severity: 'error',
        message: `The Stocks ISA could not be read (${failure.detail}). Holdings and values are ` +
          'unavailable — not empty.',
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
