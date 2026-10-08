/**
 * quote-check-demo.cjs — #1085 live evidence: the COMPILED check, a REAL live quote, three allowances.
 * Run: node logs/quote-check-demo.cjs
 */
const { checkQuoteFreshness } = require('C:/wamp64/www/trading-command-suite/nest/dist/src/common/trading/quote-freshness.js');

(async () => {
  const res = await fetch('http://localhost:5001/quote?symbol=VIX');
  const d = await res.json();
  const quote = { symbol: d.symbol, tickTime: d.tickTime ? new Date(d.tickTime) : (d.tickTime === null ? null : undefined) };
  console.log('RAW bridge payload :', JSON.stringify(d));
  console.log('parsed tickTime    :', quote.tickTime instanceof Date ? quote.tickTime.toISOString() : quote.tickTime);
  console.log('allowance 300 (default) :', JSON.stringify(checkQuoteFreshness(quote, 300)));
  console.log('allowance 1   (probe)   :', JSON.stringify(checkQuoteFreshness(quote, 1)));
  console.log('allowance 0   (disabled):', JSON.stringify(checkQuoteFreshness(quote, 0)).slice(0, 90));
  // A FROZEN quote — the case that used to size silently: same payload, tick time two hours ago.
  const frozen = { symbol: d.symbol, tickTime: new Date(Date.now() - 2 * 3600 * 1000) };
  console.log('frozen (2h old)         :', JSON.stringify(checkQuoteFreshness(frozen, 300)));
})();
