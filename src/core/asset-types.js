/**
 * Asset Type Lookup — Single source of truth for symbol → asset type.
 * =====================================================================
 * TEMPORARY hardcoded map. The authoritative source is the `symbols.asset_type`
 * column in the database. Once GET /api/symbols returns asset_type, this file
 * should be replaced with an API call.
 *
 * DO NOT copy this function into individual pages. Import from here.
 *
 * @see src/pages/StrategyCreatePage.jsx
 * @see src/pages/StrategyCreatePage.jsx
 */

/** Canonical symbol lists per asset type — matches DB asset_type enum */
const ASSET_TYPE_MAP = {
  forex: ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCAD', 'AUDUSD', 'NZDUSD', 'USDCHF'],
  commodity: ['XAUUSD', 'XAGUSD', 'USOIL', 'UKOIL', 'XTIUSD', 'XBRUSD'],
  crypto: ['BTCUSD', 'ETHUSD', 'XRPUSD', 'LTCUSD'],
  index: ['SPX500', 'TECH100', 'DJI30', 'US500', 'NAS100', 'GER40', 'UK100', 'US100', 'US30'],
};

/**
 * Get the asset type for a symbol.
 * Falls back to 'stock' for unrecognized symbols.
 * TODO: Replace with GET /api/symbols lookup when endpoint supports asset_type.
 */
export function getAssetType(symbol) {
  const s = (symbol || '').toUpperCase();
  for (const [type, symbols] of Object.entries(ASSET_TYPE_MAP)) {
    if (symbols.includes(s)) return type;
  }
  return 'stock';
}
