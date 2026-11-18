/**
 * market-movers.settings.ts — the filter policy for the market-wide movers feed (#1283).
 *
 * ⚠️ SPLIT OUT OF `settings-registry.ts` deliberately (2026-11-16). That file is a DECLARATION
 * register and had reached 1,384 lines; these five settings pushed it past the owner's 1,500-line
 * warning threshold (`scripts/audit-code-health.cjs`). The fix is the SHAPE, not a re-baseline —
 * re-freezing a size audit to accommodate growth is how a budget becomes a decoration (register
 * row 184).
 *
 * ⚠️ WHY THESE ARE SETTINGS AND NOT CONSTANTS IN THE SERVICE.
 * They decide WHICH SYMBOLS THE APP WILL CONSIDER TRADING. Measured 2026-11-16, 12 of 20 top gainers
 * and 11 of 20 top losers on the raw feed were warrants/rights priced $0.007–$0.83 with volume in the
 * low thousands. What counts as worth looking at is a judgement, not a fact, so it must be movable
 * from the UI without a redeploy — and each value is echoed in the API response under
 * `filtersApplied` so any list can be explained after the fact.
 *
 * `SETTINGS` spreads this array, so `SETTINGS_BY_KEY`, the resolver and the seeder all see these
 * exactly as if they were declared inline. There is ONE owner of the setting schema; this file only
 * contributes rows to it.
 */
import type { SettingDefinition } from './settings-registry';

export const MARKET_MOVERS_SETTINGS: SettingDefinition[] = [
// ── Market-wide movers (#1283, 2026-11-16) ─────────────────────────────────────────────────
// Owner directive: we would ideally use a ready made source of top movers: top winners and top losers.
// It doesn't make sense to only process our registered symbols for the strategy I want the app to
// support.
//
// ⚠️ WHY THESE ARE SETTINGS AND NOT CONSTANTS IN `market-movers.service.ts`.
// The filter thresholds decide WHICH SYMBOLS THE APP WILL CONSIDER TRADING. Measured 2026-11-16,
// 12 of 20 top gainers and 11 of 20 top losers on the raw feed were warrants/rights at $0.007–$0.83
// with volume in the low thousands. Those numbers are a judgement about what is worth looking at,
// not a fact about the market, so the owner must be able to move them from the UI — and each one
// is echoed back in the API response under `filtersApplied` so a list can always be explained.
{
  key: 'movers.minPrice',
  type: 'number',
  defaultValue: 1,
  class: 'runtime',
  owner: 'market-movers',
  label: 'Movers — minimum share price',
  description:
    'Rows below this price are excluded and reported as excluded (never silently dropped). ' +
    'The default of 1.00 removes sub-dollar penny stocks, which dominate the raw gainers feed and ' +
    'cannot be sized sensibly against a normal risk budget. Lower it to include them; the ' +
    'exclusion list in the response will name every row it costs.',
  userChangeable: true,
  min: 0,
  max: 10000,
},
{
  key: 'movers.minVolume',
  type: 'number',
  defaultValue: 100000,
  class: 'runtime',
  owner: 'market-movers',
  label: 'Movers — minimum daily volume (shares)',
  description:
    'Rows below this volume are excluded and reported. A big percentage move on 3,000 shares is ' +
    'not a liquid move — measured on the raw feed, individual warrants carried volumes as low as ' +
    '210. There is no point scoring a symbol that cannot be entered.',
  userChangeable: true,
  min: 0,
  max: 1000000000,
},
{
  key: 'movers.excludeWarrants',
  type: 'boolean',
  defaultValue: true,
  class: 'runtime',
  owner: 'market-movers',
  label: 'Movers — exclude warrants, rights and units',
  description:
    'Excludes tickers whose suffix marks them as a warrant (W/WS/WT), right (R) or unit (U), plus ' +
    'share-class forms (+). These are 55-60% of the raw feed and are not routable through the ' +
    'brokers configured here. ⚠️ The suffix is a HEURISTIC: the provider reports BZFDW as ' +
    '"BuzzFeed, Inc." with no mention of warrant, so a name-based filter would miss it. ' +
    'Exclusions are always listed with their reason so a false positive is visible.',
  userChangeable: true,
},
{
  key: 'movers.maxAgeMinutes',
  type: 'number',
  defaultValue: 60,
  class: 'runtime',
  owner: 'market-movers',
  label: 'Movers — maximum age of the feed (minutes)',
  description:
    'Measured 2026-11-16 at 12:00 ET: the provider returned a timestamp of the PREVIOUS FRIDAY, ' +
    'i.e. three days old. Past this age the response is marked stale:true and any caller that ' +
    'would trade on it must refuse. A movers list that old is not a movers list. An unreadable or ' +
    'missing timestamp is ALSO treated as stale, because absence of evidence is not freshness.',
  userChangeable: true,
  min: 1,
  max: 20160,
},
{
  key: 'movers.limit',
  type: 'number',
  defaultValue: 20,
  class: 'runtime',
  owner: 'market-movers',
  label: 'Movers — rows returned per list',
  description:
    'How many winners, losers and most-active rows are returned AFTER filtering. The provider ' +
    'supplies 20 per list before filtering, so a value above 20 cannot add rows that do not exist.',
  userChangeable: true,
  min: 1,
  max: 100,
},
// ── Provider and discovery (2026-11-18) ───────────────────────────────────────────────────────
{
  key: 'movers.provider',
  type: 'string',
  defaultValue: 'auto',
  class: 'runtime',
  owner: 'market-movers',
  label: 'Movers — provider',
  description:
    'auto (default) asks Yahoo first and falls back to FMP if Yahoo refuses. Pin "yahoo" or "fmp" ' +
    'to compare the two deliberately rather than by accident. Any other value is treated as ' +
    '"auto" — a typo must not leave the feed with no provider. ⚠️ The two are NOT equivalent: ' +
    'Yahoo supplies volume, opening price, average volume and the earnings timestamp in the same ' +
    'call, so the volume filter can run; FMP supplies none of them, so its rows are reported as ' +
    'unparseable and the response says filtersApplied.volumeFilterApplied=false. Measured ' +
    '2026-11-18: Alpha Vantage was removed as a source because its list was a full trading session ' +
    'behind and its top rows were warrants.',
  userChangeable: true,
},
{
  key: 'movers.maxDelayMinutes',
  type: 'number',
  defaultValue: 15,
  class: 'runtime',
  owner: 'market-movers',
  label: 'Movers — maximum exchange delay (minutes)',
  description:
    'Yahoo declares exchangeDataDelayedBy per quote — measured 2026-11-18 it reported 15 for ' +
    'NasdaqGS. That delay is separate from staleness: stale asks "is this feed alive?", delayed ' +
    'asks "how old is each quote even when it is alive?". Inconsequential for a daily view, ' +
    'decisive for an intraday momentum entry, so it is its own gate and the response carries ' +
    'delayedByMinutes beside delayed:true.',
  userChangeable: true,
  min: 0,
  max: 1440,
},
{
  key: 'movers.persistDiscovered',
  type: 'boolean',
  defaultValue: true,
  class: 'runtime',
  owner: 'market-movers',
  label: 'Movers — record discovered symbols (never activate them)',
  description:
    'When on, every ticker that SURVIVES the filters is inserted into `symbol` with active=0. ' +
    'Discovery never activates anything: the feed offers 95 gainers and 174 losers per fetch, so ' +
    'activating on sight would mean hundreds of monitored symbols a month. A symbol becomes active ' +
    'only when a person or a bot chooses it. Existing rows are left untouched, including ones ' +
    'already active. Turn this off to keep the movers feed read-only.',
  userChangeable: true,
},
];
