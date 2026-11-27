/**
 * depth-chart.js — the data a bar chart needs, derived from the depth panel's own bars and trades.
 *
 * ── WHY THE DERIVATION IS A MODULE AND NOT SIX LINES IN THE COMPONENT (note m) ─────────────────────
 * Nearly everything that can go wrong with this chart goes wrong SILENTLY. A timestamp in the wrong
 * unit draws an axis in 1970. An unsorted series throws inside the library and renders an empty frame.
 * A trade whose entry instant is not a bar — and 8 of 63 were measured that way — draws NO marker, and
 * a missing marker looks exactly like a bar where nothing happened. None of those announce themselves,
 * so they are decided here and asserted by tests.
 *
 * ⚠️ NOTHING IS INVENTED. The engine records a bar's CLOSE, not its OHLC, so this is a line, not candles:
 * a candle drawn from a close would have to fabricate four numbers. It records a trade's entry, exit and
 * (for most trades) the stop and target it carried — never the PATH a trailing stop took, so the stop is
 * drawn as the level it ended at, for the life of its trade, and never as a moving line.
 */


/** Bars are ISO strings; lightweight-charts wants UNIX seconds. ⚠️ NOT milliseconds. */
export function barSeconds(iso) {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * @param {Array<{time:string, price?:number|null, score?:number|null, state?:string}>} bars
 * @param {Array<{entryDate:string, exitDate:string, entryPrice:number, exitPrice:number,
 *   direction:string, pnl:number, exitReason:string, kept?:boolean,
 *   stopLoss?:number|null, takeProfit?:number|null}>} trades
 * @param {{pinTime?:string|null}} [opts] the bar the reader has pinned; its live trade's levels are drawn.
 * @returns {{
 *   price: Array<{time:number, value:number}>,
 *   score: Array<{time:number, value:number}>,
 *   markers: Array<{time:number, position:string, shape:string, color:string, text:string}>,
 *   levels: Array<{price:number, color:string, title:string, lineStyle:number}>,
 *   bars: number, priced: number, unplaced: number, firstTime:number|null, lastTime:number|null,
 * }}
 *   `bars` is every bar the payload held and `priced` the ones with a readable close, so a short line is
 *   visible as missing data rather than as a quiet session. `unplaced` is trades that could not be put
 *   on the axis at all.
 */
export function buildDepthChart(bars, trades, { pinTime = null } = {}) {
  const axis = [];

  for (const b of Array.isArray(bars) ? bars : []) {
    const t = barSeconds(b?.time);
    if (t === null) continue;
    if (!axis.includes(t)) axis.push(t);
  }
  // ⚠️ The library throws on unordered or duplicated times, and the throw lands in the page's error
  // boundary — the whole panel disappears and the run looks empty. Sorted + deduped here, once.
  axis.sort((a, b) => a - b);

  const price = [];
  const score = [];
  const seen = new Set();
  for (const b of Array.isArray(bars) ? bars : []) {
    const t = barSeconds(b?.time);
    if (t === null || seen.has(t)) continue;
    seen.add(t);
    const p = num(b?.price);
    if (p !== null) price.push({ time: t, value: p });
    const s = num(b?.score);
    if (s !== null) score.push({ time: t, value: s });
  }
  price.sort((a, b) => a.time - b.time);
  score.sort((a, b) => a.time - b.time);

  /**
   * ⚠️ A TRADE'S INSTANT IS NOT ALWAYS A BAR'S INSTANT. The engine stamps an entry at the minute it
   * decided, and the score series holds one bar per five minutes; a trade therefore lands on the bar at
   * or before it. Snapping FORWARD would draw the marker after the decision that produced it.
   */
  const snap = (iso) => {
    const t = barSeconds(iso);
    if (t === null || !axis.length) return null;
    let best = null;
    for (const a of axis) {
      if (a <= t) best = a;
      else break;
    }
    // Before the first bar: the earliest bar is the only truthful place for it.
    return best ?? axis[0];
  };

  const markers = [];
  const spans = [];
  let unplaced = 0;

  for (const tr of Array.isArray(trades) ? trades : []) {
    const at = snap(tr?.entryDate);
    const out = snap(tr?.exitDate);
    if (at === null) {
      unplaced += 1;
      continue;
    }
    const long = tr?.direction !== 'SHORT';
    const refused = tr?.kept === false;
    markers.push({
      time: at,
      position: long ? 'belowBar' : 'aboveBar',
      shape: long ? 'arrowUp' : 'arrowDown',
      /**
       * ⚠️ A REFUSED TRADE IS DRAWN IN THE MUTED COLOUR, NOT HIDDEN. `kept: false` means the SELECTION
       * did not count it — the engine still opened and closed it, so removing it from the chart would
       * under-report what the engine did, which is the opposite of what this panel is for.
       */
      color: refused ? '#6b7280' : long ? '#22c55e' : '#ef4444',
      /**
       * ⚠️ NO TEXT ON AN ENTRY (measured 2026-11-27). A session produced 63 executions, so 63 entry
       * arrows plus 63 exit squares on one 5-minute axis — and every entry carried `LONG 0.60`, which
       * drew as a solid band of overlapping words across the whole chart. The arrow's SHAPE (up/down)
       * and COLOUR (green/red, grey when refused) already carry direction and verdict, and the
       * executions table beside the chart carries every price. A label repeated 63 times is not
       * information, it is texture.
       */
      text: '',
    });
    if (out !== null) {
      const pnl = num(tr?.pnl) ?? 0;
      markers.push({
        time: out,
        position: long ? 'aboveBar' : 'belowBar',
        shape: 'square',
        color: pnl >= 0 ? '#22c55e' : '#ef4444',
        /**
         * Exits DO keep a label: there are far fewer distinct moments than entries, and the reason
         * (`SL`, `TP`, `TIME`, `EOD`) is the one thing a reader cannot infer from colour — it says WHY
         * the trade ended, which is the question this chart exists to answer at a glance.
         */
        text: `${tr?.exitReason || 'EXIT'}`,
      });
    }
    spans.push({ at, out: out ?? at, trade: tr });
  }

  markers.sort((a, b) => a.time - b.time);

  /**
   * Levels are drawn for the ONE trade alive at the pinned bar, never for every trade: 63 trades would
   * be 126 horizontal lines, and a chart covered in lines is a table with worse labels.
   */
  const levels = [];
  const pin = barSeconds(pinTime);
  if (pin !== null) {
    const live = spans.filter((s) => s.at <= pin && pin <= s.out);
    for (const s of live) {
      const stop = num(s.trade?.stopLoss);
      const target = num(s.trade?.takeProfit);
      if (stop !== null) levels.push({ price: stop, color: '#ef4444', title: 'stop', lineStyle: 2 });
      if (target !== null) levels.push({ price: target, color: '#22c55e', title: 'target', lineStyle: 2 });
      // Only the first live trade: a second set of lines on one scale is unreadable, and two positions
      // alive at once is rare enough to state in the note rather than to draw.
      break;
    }
  }

  return {
    price,
    score,
    markers,
    levels,
    bars: Array.isArray(bars) ? bars.length : 0,
    priced: price.length,
    unplaced,
    firstTime: axis[0] ?? null,
    lastTime: axis[axis.length - 1] ?? null,
  };
}
