/**
 * Watchlist Symbols Seed
 * ======================
 * Master symbol list stored in the repo (not MySQL).
 * These are the stocks the trader is actively watching.
 *
 * Sources:
 *   - Trading212 wishlists (manually curated)
 *   - Trading212 positions (auto-imported from portfolio)
 *   - Manual additions
 *
 * To add symbols:
 *   1. Edit the WATCHLIST_SYMBOLS array below
 *   2. Run: npm run build  (auto-registers in Symbol table on next app start)
 *
 * To import from Trading212 positions:
 *   1. Ensure TRADING212_LIVE_API_KEY is set in nest/.env
 *   2. Visit /trading/speed-trading and see auto-imported symbols
 *   3. Copy tickers from the symbol selector into this file
 *
 * Format: { ticker, name?, exchange?, type? }
 */

const WATCHLIST_SYMBOLS = [
  // ── US Tech ───────────────────────────────────────────
  { ticker: 'NVDA', name: 'NVIDIA Corp', exchange: 'NASDAQ', type: 'stock' },
  { ticker: 'AAPL', name: 'Apple Inc', exchange: 'NASDAQ', type: 'stock' },
  { ticker: 'MSFT', name: 'Microsoft Corp', exchange: 'NASDAQ', type: 'stock' },
  { ticker: 'GOOG', name: 'Alphabet Inc', exchange: 'NASDAQ', type: 'stock' },
  { ticker: 'AMZN', name: 'Amazon.com', exchange: 'NASDAQ', type: 'stock' },
  { ticker: 'META', name: 'Meta Platforms', exchange: 'NASDAQ', type: 'stock' },
  { ticker: 'TSLA', name: 'Tesla Inc', exchange: 'NASDAQ', type: 'stock' },
  { ticker: 'AMD', name: 'Advanced Micro Devices', exchange: 'NASDAQ', type: 'stock' },
  { ticker: 'INTC', name: 'Intel Corp', exchange: 'NASDAQ', type: 'stock' },
  { ticker: 'AVGO', name: 'Broadcom Inc', exchange: 'NASDAQ', type: 'stock' },

  // ── US Finance ────────────────────────────────────────
  { ticker: 'JPM', name: 'JPMorgan Chase', exchange: 'NYSE', type: 'stock' },
  { ticker: 'BAC', name: 'Bank of America', exchange: 'NYSE', type: 'stock' },
  { ticker: 'V', name: 'Visa Inc', exchange: 'NYSE', type: 'stock' },
  { ticker: 'MA', name: 'Mastercard', exchange: 'NYSE', type: 'stock' },

  // ── US Meme / Volatile ───────────────────────────────
  { ticker: 'GME', name: 'GameStop Corp', exchange: 'NYSE', type: 'stock' },
  { ticker: 'AMC', name: 'AMC Entertainment', exchange: 'NYSE', type: 'stock' },
  { ticker: 'PLTR', name: 'Palantir Technologies', exchange: 'NYSE', type: 'stock' },
  { ticker: 'MSTR', name: 'MicroStrategy', exchange: 'NASDAQ', type: 'stock' },
  { ticker: 'COIN', name: 'Coinbase Global', exchange: 'NASDAQ', type: 'stock' },
  { ticker: 'HOOD', name: 'Robinhood Markets', exchange: 'NASDAQ', type: 'stock' },
  { ticker: 'RKLB', name: 'Rocket Lab USA', exchange: 'NASDAQ', type: 'stock' },

  // ── EU / UK Stocks ───────────────────────────────────
  { ticker: '8XP', name: 'XPeng Inc', exchange: 'Trading212', type: 'stock' },
  { ticker: 'GAW', name: 'Games Workshop Group', exchange: 'LSE', type: 'stock' },

  // ── ETFs ──────────────────────────────────────────────
  { ticker: 'SPY', name: 'SPDR S&P 500 ETF', exchange: 'NYSE', type: 'etf' },
  { ticker: 'QQQ', name: 'Invesco QQQ Trust', exchange: 'NASDAQ', type: 'etf' },
  { ticker: 'IWM', name: 'iShares Russell 2000', exchange: 'NYSE', type: 'etf' },
  { ticker: 'GLD', name: 'SPDR Gold Trust', exchange: 'NYSE', type: 'etf' },
  { ticker: 'SLV', name: 'iShares Silver Trust', exchange: 'NYSE', type: 'etf' },

  // ── Crypto ────────────────────────────────────────────
  { ticker: 'BTC-USD', name: 'Bitcoin / USD', exchange: 'Yahoo', type: 'crypto' },
  { ticker: 'ETH-USD', name: 'Ethereum / USD', exchange: 'Yahoo', type: 'crypto' },
  { ticker: 'SOL-USD', name: 'Solana / USD', exchange: 'Yahoo', type: 'crypto' },
  { ticker: 'DOGE-USD', name: 'Dogecoin / USD', exchange: 'Yahoo', type: 'crypto' },

  // ── Trading212 Portfolio (auto-populated) ─────────────
  // These come from your live/demo portfolio. Add more below.
];

export default WATCHLIST_SYMBOLS;

/** Extract just the ticker strings from the watchlist. */
export function getWatchlistTickers() {
  return WATCHLIST_SYMBOLS.map((s) => s.ticker);
}
