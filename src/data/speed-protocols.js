/**
 * Speed Trading Protocols
 * =======================
 * Maps each speed trading protocol to its target symbol(s),
 * trading style, and risk gate range.
 *
 * ‼️ The master symbol list is now DB-driven:
 *    Symbols tagged "speed-trading" in the DB → GET /api/symbols?tag=speed-trading
 *    This file defines protocol logic (style, risk gates) only.
 *    SPEED_PROTOCOL_SYMBOLS is a static fallback when the API is unavailable.
 */

export const SPEED_PROTOCOLS = [
  { id: 'btc-scalp-v1',     symbols: ['BTCUSD'],              style: 'Tick Scalp',  riskMin: 0.50, riskMax: 1.30 },
  { id: 'xau-speed-v1',     symbols: ['XAUUSD'],              style: 'Tick Scalp',  riskMin: 0.40, riskMax: 1.30 },
  { id: 'oil-speed-v1',     symbols: ['USOIL'],               style: 'Tick Scalp',  riskMin: 0.45, riskMax: 1.30 },
  { id: 'spy-speed-v1',     symbols: ['SPX500', 'SPY'],       style: 'Tick Scalp',  riskMin: 0.50, riskMax: 1.25 },
  { id: 'spy-day-v1',       symbols: ['SPX500', 'SPY'],       style: 'Day Trade',   riskMin: 0.55, riskMax: 1.20 },
  { id: 'qqq-speed-v1',     symbols: ['TECH100', 'QQQ'],      style: 'Tick Scalp',  riskMin: 0.45, riskMax: 1.30 },
  { id: 'qqq-day-v1',       symbols: ['TECH100', 'QQQ'],      style: 'Day Trade',   riskMin: 0.45, riskMax: 1.30 },
  { id: 'dow-speed-v1',     symbols: ['US30', 'DJI30'],       style: 'Tick Scalp',  riskMin: 0.55, riskMax: 1.20 },
  { id: 'ftse-speed-v1',    symbols: ['UK100'],                style: 'Tick Scalp',  riskMin: 0.50, riskMax: 1.20 },
  { id: 'tsla-speed-v1',    symbols: ['TSLA'],                 style: 'Tick Scalp',  riskMin: 0.40, riskMax: 1.35 },
  { id: 'doge-speed-v1',    symbols: ['DOGEUSD'],              style: 'Tick Scalp',  riskMin: 0.35, riskMax: 1.40 },
  { id: 'china-speed-v1',   symbols: ['CHINA50'],              style: 'Tick Scalp',  riskMin: 0.35, riskMax: 1.30 },
  { id: 'cad-sniper-v1',    symbols: ['USDCAD','EURCAD','GBPCAD','AUDCAD','NZDCAD'], style: 'Trend/Scalp', riskMin: 0.40, riskMax: 1.25 },
  { id: 'forex-session-v1', symbols: ['EURUSD','GBPUSD','USDJPY','AUDUSD','USDCAD','USDCHF','NZDUSD'], style: 'Session', riskMin: 0.30, riskMax: 1.20 },
  { id: 'vix-spike-v1',     symbols: ['VIX'],                  style: 'Mean Rev',    riskMin: 0.30, riskMax: 1.20 },
  { id: 'btc-speed-v1',     symbols: ['BTCUSD'],               style: 'Monitor',     riskMin: 0.30, riskMax: 1.20 },
  { id: 'default',          symbols: ['*'],                    style: 'Swing',       riskMin: 0.30, riskMax: 1.20 },
];

/** All unique symbols covered by speed protocols (excluding '*' catch-all). */
export const SPEED_PROTOCOL_SYMBOLS = [
  ...new Set(SPEED_PROTOCOLS.flatMap((p) => p.symbols).filter((s) => s !== '*')),
].sort();

/** Look up protocol(s) for a given symbol. */
export function getProtocolsForSymbol(symbol) {
  const upper = symbol.toUpperCase();
  return SPEED_PROTOCOLS.filter((p) =>
    p.symbols.includes('*') || p.symbols.map((s) => s.toUpperCase()).includes(upper),
  );
}
