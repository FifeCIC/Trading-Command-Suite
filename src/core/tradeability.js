/**
 * tradeability.js — "can any bot actually act on this signal?" (#911).
 *
 * THE DEFECT THIS ANSWERS
 * -----------------------
 * Two thresholds decide one signal and they are on the same scale, but nothing put them side by
 * side. Measured 2026-09-19:
 *
 *   classifier (protocol-gating.service.ts):  HOLD < 6%  |  BUY 6–13%  |  STRONG_BUY >= 13%
 *   bot gate (trading_strategy.minComposite): 24 of 26 active bots act only at 9–10%
 *
 * ⇒ **6%–10% is labelled BUY and refused by almost every bot.** The observed card read
 * `77 / 1025 (8%)` and `signal: BUY`; 77 is inside that dead band. The arithmetic was right, the
 * classifier was right, the bot gates were right — and the card said **BUY**, with nothing on the
 * screen explaining that no subscribed bot's bar was met.
 *
 * So this is NOT a maths change. It computes no new threshold and moves no value: it reconciles two
 * numbers that already exist, using the bars the API already returns
 * (`GET /api/scoring/gated/thresholds` → `bots[]`). Changing `ENTRY_THRESHOLD` or every
 * `minComposite` is the OTHER branch of #911 and needs an A/B (#maths-change-requires-ab).
 *
 * ⚠️ FOUR STATES, AND THE DIFFERENCE MATTERS
 * ------------------------------------------
 *   `unknown`       — the card has no signal percentage. We CANNOT judge. Must never render as
 *                     "refused", and must never render as nothing.
 *   `unsubscribed`  — no ACTIVE bot subscribes to this protocol. The card can be a perfectly good
 *                     BUY that nothing is listening to — `btc-scalp-v1` rendered a BUY card with
 *                     `linkedStrategies: []`. That is a finding, not an absence of information.
 *   `clear`         — at least one active bot's bar is met.
 *   `refused`       — active bots exist and none clears. Report the SHORTFALL, so the reader can see
 *                     how far away it is rather than only that it failed.
 *
 * Pure and dependency-free so `node --test` covers it (see tradeability.test.js) rather than leaving
 * the rule inside JSX where it cannot be asserted.
 */

/** Strip a trailing `-v1` version suffix — the Ladder's existing family-matching rule. */
function familyKey(id) {
  return String(id || '').toLowerCase().replace(/-v\d+$/, '');
}

/**
 * Is a bot's declared protocol the same as the card's, or the same family?
 *
 * ⚠️ NOT a bare `===`. The ladder keys cards by the protocol id from
 * `/api/scoring/gated/protocols` (`xau-speed-v1`) while bots are seeded against the TIMEFRAME
 * variant that produced the run (`xau-speed-m5`) — the same `-v1` reconciliation `LadderPage`
 * already documents for its score maps. An exact match always wins; this only widens it.
 */
export function sameProtocolFamily(a, b) {
  const x = String(a || '').toLowerCase();
  const y = String(b || '').toLowerCase();
  if (!x || !y) return false;
  if (x === y) return true;
  return x.startsWith(`${familyKey(y)}-`) || y.startsWith(`${familyKey(x)}-`);
}

/** Round to one decimal without `-0`. */
function r1(n) {
  const v = Math.round(n * 10) / 10;
  return Object.is(v, -0) ? 0 : v;
}

/**
 * Reconcile one card's signal percentage against the bars of the bots that subscribe to its
 * protocol.
 *
 * @param {number|null|undefined} signalPct  the card's live reading, in % of configured capacity
 * @param {Array<object>} bots               `bots[]` from `GET /api/scoring/gated/thresholds`
 * @param {string} protocolId                the card's protocol
 * @returns {{ state: 'unknown'|'unsubscribed'|'clear'|'refused', reason: string,
 *             subscribed: Array<object>, clearing: number, blocked: number,
 *             bestBarPct: number|null, shortfall: number|null, signalPct: number|null }}
 */
export function botTradeability(signalPct, bots, protocolId) {
  const all = Array.isArray(bots) ? bots : [];

  // `active === false` cannot trade, so it is not a subscriber for this question. The API's own
  // summary uses the same split (`activeClearing` / `active`).
  const subscribed = all
    .filter((b) => b && b.active !== false)
    .filter((b) => sameProtocolFamily(b.protocolId, protocolId))
    .map((b) => ({
      name: b.name ?? '(unnamed bot)',
      protocolId: b.protocolId ?? null,
      barPct: typeof b.barPct === 'number' ? b.barPct : null,
      samples: typeof b.samples === 'number' ? b.samples : null,
    }))
    .sort((a, b) => (a.barPct ?? Infinity) - (b.barPct ?? Infinity));

  const rated = subscribed.filter((b) => b.barPct != null);
  const bestBarPct = rated.length ? rated[0].barPct : null;

  const base = { subscribed, signalPct: typeof signalPct === 'number' ? signalPct : null };

  /**
   * ⚠️ ORDER MATTERS. `unknown` is checked FIRST: with no reading there is nothing to compare, and
   * reporting "refused" for an unscored card would be a confident answer to a question we cannot
   * answer. Reporting `unsubscribed` first would likewise hide "we cannot judge" behind a
   * subscription fact that is true either way.
   */
  if (base.signalPct == null) {
    return {
      ...base,
      state: 'unknown',
      reason: 'No signal reading on this card, so whether a bot’s bar is met cannot be judged.',
      clearing: 0,
      blocked: 0,
      bestBarPct,
      shortfall: null,
    };
  }

  if (subscribed.length === 0) {
    return {
      ...base,
      state: 'unsubscribed',
      reason: 'No ACTIVE bot subscribes to this protocol, so nothing can act on this signal whatever its strength.',
      clearing: 0,
      blocked: 0,
      bestBarPct: null,
      shortfall: null,
    };
  }

  const withVerdict = subscribed.map((b) => ({
    ...b,
    clears: b.barPct == null ? null : base.signalPct >= b.barPct,
    shortfall: b.barPct == null ? null : r1(b.barPct - base.signalPct),
  }));

  const clearing = withVerdict.filter((b) => b.clears === true).length;
  const blocked = withVerdict.filter((b) => b.clears === false).length;

  if (clearing > 0) {
    return {
      ...base,
      subscribed: withVerdict,
      state: 'clear',
      reason: `${clearing} of ${subscribed.length} subscribed bot(s) have a bar this reading meets.`,
      clearing,
      blocked,
      bestBarPct,
      shortfall: null,
    };
  }

  // Every subscribed bot has a bar and none is met — name the closest one.
  const shortfall = bestBarPct == null ? null : r1(bestBarPct - base.signalPct);
  return {
    ...base,
    subscribed: withVerdict,
    state: 'refused',
    reason:
      shortfall == null
        ? 'No subscribed bot declares a bar, so none can be compared.'
        : `REFUSED by every subscribed bot — the lowest bar is ${bestBarPct}% and this reading is ${base.signalPct}%, a shortfall of ${shortfall} points.`,
    clearing: 0,
    blocked,
    bestBarPct,
    shortfall,
  };
}
