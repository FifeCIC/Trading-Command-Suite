/**
 * XTrend Speed Trading Symbols
 * Compiled from xtrendspeed.com market pages — Forex, Commodities, Indices, Shares.
 * Used by Speed Trading and plugin core data.
 */
export const XTREND_SPEED_SYMBOLS = [
  // ── Forex — Major (page 1) ──
  'EURUSD', 'GBPUSD', 'USDJPY', 'USDCAD', 'USDCHF', 'AUDUSD', 'NZDUSD',
  // ── Forex — Major Crosses ──
  'AUDJPY', 'AUDNZD', 'AUDCAD', 'AUDCHF',
  'CADJPY', 'CADCHF',
  'CHFJPY',
  'EURAUD', 'EURCAD', 'EURCHF', 'EURGBP', 'EURJPY', 'EURNZD',
  'GBPAUD', 'GBPCAD', 'GBPCHF', 'GBPJPY', 'GBPNZD',
  'NZDCAD', 'NZDCHF', 'NZDJPY',
  // ── Forex — Minor ──
  'USDSGD', 'USDHKD', 'USDNOK', 'USDSEK', 'USDDKK', 'USDZAR', 'USDTRY', 'USDMXN',
  'USDPLN', 'USDHUF', 'USDCZK', 'USDILS', 'USDRUB', 'USDCNH', 'USDINR',
  'EURNOK', 'EURSEK', 'EURTRY', 'EURZAR', 'EURHUF', 'EURPLN',
  'GBPNOK', 'GBPSEK', 'GBPTRY', 'GBPZAR',
  // ── Forex — Exotic ──
  'USDTHB', 'USDSAR', 'USDAED', 'USDCLP', 'USDCOP', 'USDIDR', 'USDPHP',
  'EURCZK', 'EURDKK', 'EURRON',
  'GBPDKK', 'GBPCZK',
  // ── Forex — Index ──
  'USDX',
  // ── Commodities — Metals ──
  'XAUUSD', 'XAGUSD', 'XPDUSD', 'XPTUSD', 'XAUAUD', 'XAGAUD',
  'XAUGBP', 'XAGGBP', 'XAUJPY',
  'COPPER', 'NICKEL',
  // ── Commodities — Energy ──
  'USOIL', 'UKOIL', 'NATGAS',
  // ── Commodities — Softs ──
  'CORN', 'WHEAT', 'SOYBEAN', 'COFFEE', 'SUGAR', 'COCOA', 'COTTON',
  // ── Indices — Americas ──
  'DJI30', 'SPX500', 'TECH100', 'US30', 'US100', 'US500',
  'VIX', 'RUSSELL2000',
  // ── Indices — Europe ──
  'GER40', 'UK100', 'FRA40', 'EURO50', 'ITA40', 'ESP35', 'SUI20', 'NED25',
  // ── Indices — Asia-Pacific ──
  'J225', 'AUS200', 'HSI', 'CHINA50', 'SING30', 'IND50',
  // ── Shares — US Tech ──
  'AAPL', 'MSFT', 'GOOG', 'AMZN', 'META', 'NVDA', 'TSLA', 'NFLX',
  'AMD', 'INTC', 'CRM', 'ADBE', 'ORCL', 'IBM', 'CSCO', 'QCOM',
  'AVGO', 'TXN', 'MU', 'AMAT',
  // ── Shares — US Consumer/Retail ──
  'WMT', 'COST', 'HD', 'MCD', 'NKE', 'SBUX', 'DIS', 'PYPL',
  'ABNB', 'UBER', 'LYFT', 'SNAP', 'PINS',
  // ── Shares — US Finance ──
  'JPM', 'BAC', 'WFC', 'GS', 'MS', 'C', 'V', 'MA', 'AXP',
  // ── Shares — US Industrial/Energy/Health ──
  'BA', 'CAT', 'GE', 'XOM', 'CVX', 'COP', 'JNJ', 'PFE', 'UNH', 'ABBV',
  // ── Shares — US Meme/Volatile ──
  'GME', 'AMC', 'BBBY', 'PLTR', 'SOFI', 'RIVN', 'LCID', 'COIN',
  'MARA', 'RIOT', 'MSTR', 'HOOD', 'RKLB', 'ASTS',
  // ── Shares — EU ──
  'SAP.DE', 'ALV.DE', 'BAYN.DE', 'DTE.DE', 'VOW3.DE', 'RWE.DE',
  'HSBA.L', 'BARC.L', 'BP.L', 'SHEL.L', 'GLEN.L', 'RIO.L', 'VOD.L',
  'AIR.PA', 'BNP.PA', 'SAN.PA', 'OR.PA',
  // ── Shares — HK ──
  '0700.HK', '9988.HK', '0941.HK', '2318.HK', '1299.HK', '0005.HK',
  // ── ETFs ──
  'SPY', 'QQQ', 'IWM', 'DIA', 'GLD', 'SLV', 'USO', 'UNG', 'EEM', 'EFA',
  // ── Crypto ──
  'BTCUSD', 'ETHUSD', 'SOLUSD', 'XRPUSD', 'DOGEUSD', 'ADAUSD', 'DOTUSD',
];

export const SYMBOL_CATEGORIES = {
  forex: { label: 'Forex', icon: '💱' },
  commodities: { label: 'Commodities', icon: '🛢️' },
  indices: { label: 'Indices', icon: '📊' },
  shares: { label: 'Shares', icon: '🏢' },
  etfs: { label: 'ETFs', icon: '📦' },
  crypto: { label: 'Crypto', icon: '₿' },
};

/** Assign category based on symbol name */
export function getSymbolCategory(symbol) {
  const s = symbol.toUpperCase();
  if (['EURUSD','GBPUSD','USDJPY','USDCAD','USDCHF','AUDUSD','NZDUSD','USDX',
    'AUDJPY','AUDNZD','AUDCAD','AUDCHF','CADJPY','CADCHF','CHFJPY',
    'EURAUD','EURCAD','EURCHF','EURGBP','EURJPY','EURNZD',
    'GBPAUD','GBPCAD','GBPCHF','GBPJPY','GBPNZD',
    'NZDCAD','NZDCHF','NZDJPY',
    'USDSGD','USDHKD','USDNOK','USDSEK','USDDKK','USDZAR','USDTRY','USDMXN',
    'USDPLN','USDHUF','USDCZK','USDILS','USDRUB','USDCNH','USDINR',
    'EURNOK','EURSEK','EURTRY','EURZAR','EURHUF','EURPLN',
    'GBPNOK','GBPSEK','GBPTRY','GBPZAR',
    'USDTHB','USDSAR','USDAED','USDCLP','USDCOP','USDIDR','USDPHP',
    'EURCZK','EURDKK','EURRON','GBPDKK','GBPCZK'].includes(s)) return 'forex';
  if (['XAUUSD','XAGUSD','XPDUSD','XPTUSD','XAUAUD','XAGAUD',
    'XAUGBP','XAGGBP','XAUJPY','COPPER','NICKEL',
    'USOIL','UKOIL','NATGAS','CORN','WHEAT','SOYBEAN',
    'COFFEE','SUGAR','COCOA','COTTON'].includes(s)) return 'commodities';
  if (['DJI30','SPX500','TECH100','US30','US100','US500',
    'VIX','RUSSELL2000','GER40','UK100','FRA40','EURO50',
    'ITA40','ESP35','SUI20','NED25',
    'J225','AUS200','HSI','CHINA50','SING30','IND50'].includes(s)) return 'indices';
  if (['SPY','QQQ','IWM','DIA','GLD','SLV','USO','UNG','EEM','EFA'].includes(s)) return 'etfs';
  if (['BTCUSD','ETHUSD','SOLUSD','XRPUSD','DOGEUSD','ADAUSD','DOTUSD'].includes(s)) return 'crypto';
  return 'shares';
}
