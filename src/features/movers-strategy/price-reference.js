/**
 * price-reference.js — turn a percentage in the trade configuration into a price distance.
 *
 * ── THE SUM THE READER WAS DOING ────────────────────────────────────────────────────────────────
 * `slPct 5` is only meaningful against a price: at a 1.50 entry it is 0.075, and the trade tables on
 * this page print prices. A reader comparing "stop 5%" with "In 1.5023 / Out 1.4802" has to do that
 * multiplication before they can say whether the stop was hit. This module does it — once, in one
 * place, so the figure cannot be computed two ways.
 *
 * ⚠️ THE HARD PART IS THE REFERENCE PRICE, AND IT CANNOT BE INVENTED. A single run can hold EURUSD at
 * 1.05 and BTC at 60,000; a percentage median across those two prices is arithmetic on incompatible
 * units and would produce a "distance" that describes no instrument at all. So the reference is
 * deliberately ONE symbol's median entry — the symbol this run traded most — and the result says which
 * symbol it is and how many symbols it does NOT describe. Yesterday's error in this area was a
 * per-protocol figure reported against a per-symbol population; a blended price would be the same
 * mistake in a new place.
 */

/** Median of a numeric list, or null when the list is empty. Never returns 0 for "nothing". */
function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length / 2;
  return sorted.length % 2
    ? sorted[Math.floor(mid)]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** A usable entry price is a positive finite number. Zero and null are absences, not prices. */
function usable(price) {
  return typeof price === 'number' && Number.isFinite(price) && price > 0;
}

/**
 * ⚠️ `detail.trades` CARRIES TRADES THE SELECTION REFUSED. The run's `totals.trades` counts only the
 * ones it permitted, and the depth list holds every trade the engine produced so the timeline can show
 * what was dropped and why (`selectionReason`). Both are correct for their own purpose — but as a price
 * reference the refused rows are a different population, and including them made this module report
 * "median of 102 entry prices" beside a run that reported 89 trades. A reader checking those two
 * numbers finds a discrepancy that has no cause on screen.
 *
 * `kept === false` is the recorded refusal. `undefined` (an older payload with no marker) is NOT a
 * refusal — dropping it would silently move the median for runs recorded before the field existed.
 */
function permitted(trade) {
  return trade?.kept !== false;
}

/**
 * @param {Array<{symbol?:string, entryPrice?:number|null, kept?:boolean}>} trades
 * @returns {{symbol:string, price:number, count:number, symbols:number}|null}
 *   `null` when no trade carries a readable entry price — "cannot judge", never a zero price.
 */
export function buildPriceReference(trades) {
  const bySymbol = new Map();
  for (const t of trades ?? []) {
    if (!permitted(t) || !usable(t.entryPrice)) continue;
    const symbol = t.symbol || 'unattributed';
    const list = bySymbol.get(symbol) ?? [];
    list.push(t.entryPrice);
    bySymbol.set(symbol, list);
  }
  if (!bySymbol.size) return null;

  // Most-traded symbol wins; a tie breaks alphabetically so the figure is stable between renders.
  const [symbol, prices] = [...bySymbol.entries()]
    .sort((a, b) => (b[1].length - a[1].length) || a[0].localeCompare(b[0]))[0];

  return {
    symbol,
    price: median(prices),
    count: prices.length,
    symbols: bySymbol.size,
  };
}

/**
 * A percentage of a price. `null` in, `null` out — an unreadable percentage is not a distance of zero,
 * and this page has been bitten by `Number(null) === 0` flattening a real absence into a figure.
 */
export function priceDistance(pct, price) {
  if (typeof pct !== 'number' || !Number.isFinite(pct)) return null;
  if (!usable(price)) return null;
  return (price * pct) / 100;
}

/**
 * Three significant figures, because that is what the price itself carries: 5% of 1.50 is `0.075`,
 * not `0.07500000000000001`, and 5% of 60,000 is `3000`. Trailing zeros are dropped so a distance
 * reads as a number rather than as a column of padding.
 */
export function formatDistance(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return String(Number(value.toPrecision(3)));
}
