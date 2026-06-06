# Trading and Analysis Data-Flow Contract

Status: Sprint 1 contract slice, 2026-05-01

This document records data-flow decisions for Trading and Analysis read-only/admin surfaces as they are reviewed for release readiness.

## Contract

Request -> read stored data or user input -> queue refresh if stale and provider-backed -> render state from storage or explicit user input.

No Trading or Analysis view should call external APIs during page rendering. Provider-backed views must use stored rows/options/transients and queue refresh work through the existing import queue.

## Data-Flow Decisions

| View | Data purpose | Source of truth | Primary provider | Fallback provider | Unsuitable providers | Freshness SLA | Queue trigger threshold | UI data mode |
|---|---|---|---|---|---|---|---|---|
| Trading > Calculators | User-entered trading arithmetic | User-entered form inputs in the browser | Not applicable | Not applicable | All external providers are unsuitable for this pure calculator surface | Not applicable | None; no queued refresh required | Live for the active calculator; Coming Soon for unfinished calculator panels |
| Trading > Trading Strategies > Create Trading Strategy | Dev-only rule-threshold strategy design (decision trigger configuration) | `TradePress_Scoring_Directives_Registry` for available indicator definitions; strategy-level rule settings from the builder form | Not applicable during design | Not applicable | External market-data providers and broker APIs are unsuitable in the builder render path | Not applicable for design state | None from the view; future save/test execution must use dedicated trading strategy handlers and data freshness gates | Dev-only Demo |
| Trading > Trading Strategies > My Custom Strategies | Dev-only review of stored trading-rule drafts | Transitional storage currently reads `tradepress_scoring_strategies` and related scoring tables until dedicated trading-strategy persistence is split out | Not applicable for list rendering | Not applicable | External market-data providers and broker APIs are unsuitable in the list render path | Stored draft/reference context | None from the view; testing/execution must be separate and queued/gated | Dev-only Demo or Empty |
| Trading > Trading Strategies > Built-in Strategies | Static planning reference list | Static array in `admin/page/trading/trading-tabs.php` | Not applicable | Not applicable | External providers are unsuitable; rows are not live trading strategies | Not applicable | None | Dev-only Demo |
| Trading > SEES Demo | Dev-only scoring/demo review | Bundled test symbol metadata generated through Developer Mode AJAX only | Not selected | Not applicable | External market-data providers and broker APIs are unsuitable in the demo render/AJAX path | Not applicable for demo state | None; future release-facing SEES output must read stored scoring results | Dev-only Demo |
| Trading > SEES Diagnostics | Bounded strategy trace workspace | Normal mode reads local Symbols CPT records, stored daily options when present, and latest `tradepress_symbol_scores` rows when present; scoring traces use stored score components when available; Developer Mode keeps bundled diagnostic symbols | Not selected | Not applicable | External market-data providers and broker APIs are unsuitable in the diagnostics render/AJAX path | Stored daily/score context when present; diagnostic fallback otherwise | None from diagnostics; remaining live-data work must be populated by import/scoring runs outside this view | Cached, Empty, stored-score, or diagnostic fallback with source counts |
| Front-end SEES Daily Snapshot shortcode | Bounded public snapshot for built-in release symbol set | Daily transient rebuilt from stored daily options, latest `tradepress_symbol_scores` rows when present, and existing queue rows for status only; deterministic fallback is labelled when storage is empty | Not selected | Not applicable | External market-data providers and broker APIs are unsuitable in the shortcode render path | Daily cache; rows report Cached, Stale, Queued, or Empty; stored score age shown from latest score row | Manual refresh clears/rebuilds the transient from storage only; it reports existing queued imports but does not call providers or create queue items yet | Cached, Stale, Queued, Empty, or fallback-only |
| Analysis > Recently Analysed Symbols | Dev-only audit/list of previously scored symbols | `tradepress_symbol_scores` | Not applicable for list rendering | Not applicable | External market-data providers are unsuitable in the list render path | Stored score/reference context | None from the view | Cached or Empty |
| Analysis > Support & Resistance | Dev-only placeholder for future support/resistance analysis | No stored OHLC source connected to the view yet | Not selected | Not selected | Direct provider/analyzer execution during render is unsuitable | Not applicable until stored OHLC data is connected | None from the view; future analysis must read stored candles and queue calculation/import work | Dev-only Demo |
| Analysis > Volatility Analysis | Dev-only placeholder for future volatility analysis | No stored volatility/OHLC source connected to the view yet | Not selected | Not selected | Direct provider/analyzer execution during render is unsuitable | Not applicable until stored OHLC or volatility data is connected | None from the view; future analysis must read stored candles and queue calculation/import work | Dev-only Demo |

## View State Rules

## Historical Analysis Import Contract

`TradePress_Data_Import_Process::fetch_historical_data()` is a background-queue path for stored daily candles and technical indicators used by advanced directives. It must not be called from page render paths.

Source of truth:

- `tradepress_historical_data_{symbol}`
- `tradepress_historical_last_update_{symbol}`
- `tradepress_historical_data_source_{symbol}`
- `tradepress_technical_indicators_{symbol}`
- `tradepress_technical_last_update_{symbol}`
- `tradepress_technical_indicators_source_{symbol}`

Freshness SLA: 24 hours for the stored historical/technical option set.

Provider suitability contract:

- Provider service switch must be enabled, and the provider must not be in the rate-limit cooling window.
- Capability matrix must report support for `candles`, `rsi`, `macd`, and `sma`.
- Runtime provider instance must expose `get_candles()`, `get_rsi()`, `get_macd()`, and `get_moving_average()`.
- Providers that advertise the capabilities but use a different method shape, such as `get_bars()`, `get_sma()`, or `get_technical_indicators()`, are not eligible for this importer until an adapter normalises them to the same method/result contract.

Current eligible provider: Finnhub. Other providers remain potential candidates only after a normalised historical/indicator adapter is added or their API classes expose this exact contract.

## SEES Diagnostics Trace Payload Contract

SEES Diagnostics is a Developer Mode-only trace workspace. It explains how a selected stored strategy would be evaluated for a bundled diagnostic symbol. It is not a live market-data or trade-execution path.

The trace payload returned by `tradepress_ajax_fetch_sees_diagnostic_trace()` is the canonical contract for Sprint 2 UI rendering and Sprint 3 verification.

The `Diagnostic test symbol` selector in the controls panel is a temporary diagnostics input. It chooses one bundled test symbol so the trace panel can explain a single evaluation. It is not the production source of SEES symbols. Production SEES symbol inputs should come from watchlists, strategy scope, scans, or stored scoring runs.

Controls that exist only for Developer Mode diagnostics should display a red tools/spanner marker beside their labels. The marker means "diagnostic input", not "production requirement".

Features that render demo, synthetic, fixture, or transitional simulation data should display an amber warning marker beside the feature heading and a phase panel before the affected feature. The marker means "this feature is not using its final live-data source." The panel must identify the current source of truth, state whether any part is real stored configuration, and name the next live-data step.

Current SEES Diagnostics feature phase markers:

- Symbol Cards: bounded mixed data. Normal mode reads local Symbols CPT rows, stored daily data when available, and latest stored score rows when available. Missing market data or scores remain labelled diagnostic fallback. Developer Mode keeps bundled symbols and simulated values for larger fixture testing.
- Algorithm Visual Trace: mixed diagnostic simulation. Strategy records/components/scope are real local storage, but step inputs and scores are deterministic simulations. Live-data step: render stored scoring/trading execution traces after provider imports and scoring runs exist.

### Payload Fields

| Field | Required | Meaning |
|---|---|---|
| `trace_mode` | Yes | Either `scoring` or `trading`. `scoring` traces stored scoring directives. `trading` is transitional and traces stored strategy components until dedicated trading strategy persistence exists. |
| `symbol`, `name`, `industry` | Yes | Diagnostic symbol context. Current symbol cards use bundled test metadata only. |
| `strategy_id`, `strategy_name`, `strategy_type`, `strategy_status`, `strategy_storage` | Yes | Selected stored strategy metadata. `strategy_storage` is currently `tradepress_scoring_strategies`. |
| `evaluation_source`, `score_source`, `trace_input_source` | Yes | Truth labels for the trace. Current live values are `diagnostic-simulation` and `stored-strategy-components-with-simulated-inputs` until stored scoring execution traces exist. Stop states that do not evaluate components use `not-evaluated`. |
| `component_count` | Yes | Count of strategy components included in the trace after loading stored strategy directives. |
| `passed_count` | Yes | Count of trace steps where the component evaluation passed. |
| `component_warning_count` | Yes | Count of trace steps carrying a `warning` because the component is missing, disabled, or unavailable. |
| `score` | Yes | Raw weighted total for the selected strategy trace. It is not globally normalised to `0..100`. |
| `max_possible_score` | Yes | Sum of each trace step's `max_weighted_score`. This is the selected strategy's reachable maximum for the current component stack. |
| `score_percent_of_max` | Yes | Derived display value: `(score / max_possible_score) * 100`, or `0` when `max_possible_score` is `0`. |
| `minimum_threshold` | Yes | Suggested trading threshold stored with the selected scoring strategy. In scoring-mode diagnostics it is advisory metadata, not a hard scoring requirement. Trading Strategy execution decides whether to enforce a threshold. |
| `threshold_distance` | Yes | Canonical threshold distance: `score - minimum_threshold`. Positive and zero values mean the suggested threshold is met. Negative values mean the score is short of the suggested trading target. |
| `distance_to_threshold` | Compatibility | Backwards-compatible alias for `threshold_distance` while existing UI code migrates. New code should read `threshold_distance`. |
| `strategy_scope` | Yes | Selected scoring strategy applicability metadata: watchlist IDs, resolved symbols, mode preference, and summary. |
| `scope_validation` | Yes | Diagnostic result for the selected symbol against `strategy_scope`. Scoring/SEES ranking should treat out-of-scope states as advisory unless a trading context explicitly enforces them. |
| `decision` | Yes | Human-readable outcome string for the diagnostics panel. |
| `decision_state` | Yes | Machine-readable top-level state: `continued` or `stopped`. |
| `decision_branch_details` | Yes | Ordered list of branch/gate results that explain warnings, stops, and continuation. |
| `next_function` | Yes | Next intended system function or the stop-return target. It is explanatory in diagnostics and must not execute trades. |
| `process` | Yes | Ordered checkpoint list showing the high-level trace pipeline and whether each checkpoint passed. |
| `steps` | Yes | Ordered component-level trace records. Empty when no strategy or no components can be evaluated. |
| `generatedAt` | Yes | WordPress-local timestamp for the generated trace. |

### Branch Details

Each item in `decision_branch_details` must include:

| Field | Meaning |
|---|---|
| `gate` | Stable gate key such as `strategy-selection`, `component-health`, `symbol-scope`, `score-threshold`, or `indicator-threshold`. |
| `status` | One of `passed`, `failed`, or `warning`. |
| `reason` | Short user-readable reason for the branch result. |
| `code_path` | Function or logical branch that produced the result. |

Branch status semantics:

- `passed`: the gate allowed evaluation to continue.
- `failed`: the gate blocked the trace and should produce `decision_state: stopped`. In scoring mode, below-suggested-threshold and out-of-scope findings should normally be warnings, not failures.
- `warning`: the trace found degraded or incomplete component state. A warning does not automatically stop the trace unless a later required gate fails, but the warning count must remain visible.

Top-level `decision_state` is intentionally narrower than branch `status`:

- `continued`: the selected branch would proceed to the next scoring/trading decision function.
- `stopped`: the selected branch returned a stop decision to the diagnostics panel.

### Component Warning Semantics

Warnings are component-health findings, not hidden failures. A trace step must set `warning` when a stored strategy component cannot be evaluated as a healthy active component, including:

- The component exists in strategy storage but is inactive.
- The directive/indicator definition is unavailable in the current registry.
- The registry definition is disabled.

When a step has a warning:

- `component_available` and `component_active` must identify the underlying state.
- `weighted_score` must not contribute positive score for blocked components.
- `component_warning_count` must increment.
- `decision_branch_details` must include a `component-health` item with `status: warning`.

### Step Records

Each entry in `steps` should identify the real stored strategy component rather than a placeholder label. Required step fields are:

| Field | Meaning |
|---|---|
| `id`, `label`, `description` | Component identity shown in the trace. |
| `component_type` | `directive` in scoring mode or `indicator` in trading mode. |
| `component_source` | Storage source for the component, currently `tradepress_strategy_directives`. |
| `component_available`, `component_active` | Boolean component-health flags. |
| `code_path` | Registry/directive path or transitional trading strategy indicator path. |
| `input_value`, `score`, `weight`, `weighted_score`, `max_weighted_score`, `threshold` | Numeric evaluation values. |
| `passed` | Boolean component pass result. |
| `formula_text` | Human-readable score calculation summary. |
| `warning` | Empty or a component-health warning string. |
| `next_action` | Short explanation of whether the component continues or is blocked. |

### Mode Rules

- `scoring` mode uses the selected scoring strategy's stored components, suggested trading threshold, and watchlist-based symbol scope. High score, low qualified score, and below-suggested-threshold branches are expressed through `score-threshold` branch details. Below-threshold is advisory and must not stop scoring or SEES ranking.
- `trading` mode currently uses transitional stored scoring strategy components until dedicated trading strategy tables exist. The immediate branch uses component pass count, with `indicator-threshold` branch details. Trading mode may hard-stop on symbol scope when the scoring strategy metadata recommends enforcement and the Trading Strategy context elects to enforce it.
- Neither mode may call external providers or execute trade actions from the diagnostics render/AJAX path.

## Dual-Algorithm Boundary

TradePress keeps two algorithm families with different responsibilities:

1. **Scoring Directives algorithm (optimization/ranking):** Produces weighted, strategy-aware scores to rank opportunity quality. It is continuous and can demand near-optimal conditions before a high score appears. Suggested thresholds and watchlist-based symbol scope are advisory metadata in this layer.
2. **Trading Strategy algorithm (rule-threshold trigger):** Evaluates whether enough configured rules are currently within acceptable bounds (for example `3 of 5` or `60%`) and may require multi-period confirmation before triggering. It owns hard threshold enforcement, symbol-scope enforcement, watchlist mutation warnings, open-position safety checks, and automated-trading stop/start decisions.

Design constraints for current core scope:

- Trading Strategy must not be positioned as a duplicate scoring engine.
- Strategy-level precision controls (for example trend-of-change gating and wait-for-better-entry logic) are optional complexity and should be designed now but can remain non-blocking for core release behavior.
- If score is used by Trading Strategy, it is an input signal, not a replacement for explicit rule-threshold configuration.

- `Live`: calculator output is produced immediately from user-entered inputs.
- `Coming Soon`: calculator panel is present but not implemented.
- Runtime health is `not_applicable` for pure calculators because no provider, queue, or stored market data dependency is involved.

## Validation Notes

- `admin/page/trading/view/calculators.php` renders forms and static state only.
- `assets/js/tradepress-calculators.js` calculates the Averaging Down result client-side from form inputs.
- No external API provider, queue trigger, or stored market-data read exists in the Trading > Calculators render path.
- `admin/page/trading/view/create_strategy.php` renders a rule-threshold strategy builder from registry/static directive definitions only; it does not execute scoring loops or trading actions.
- `admin/page/trading/view/trading-strategies.php` reads transitional stored drafts from scoring strategy tables and presents them as dev-only trading-rule strategy records until dedicated persistence is separated.
- `admin/page/trading/trading-tabs.php::tradepress_display_builtin_strategies()` renders static planning definitions only.
- `assets/js/trading-create-strategy.js` and `assets/js/trading-strategies.js` remain client-side design helpers; they do not execute provider calls or trading actions.
- `admin/page/trading/view/sees-demo.php` is labelled Dev-only Demo and does not use provider data.
- `admin/page/trading/trading-tabs.php` now requires Developer Mode for SEES demo and diagnostic AJAX handlers, not only `manage_options`.
- `admin/page/trading/view/sees-diagnostics.php` is labelled as a bounded diagnostics workspace and reports its transitional storage boundary.
- Normal-mode SEES Diagnostics cards now prefer latest rows from `tradepress_symbol_scores` when available and expose stored-score versus simulated/not-evaluated counts in the source summary. Scoring traces also use stored score row components when available, with `evaluation_source=stored-score-row`, `score_source=stored-score`, and `trace_input_source=tradepress_symbol_scores.components`; otherwise they remain explicitly labelled as diagnostic simulations. The trace header also reports latest completed run evidence from `tradepress_algorithm_runs`, so stored score rows are not treated as the only proof path. In normal mode, when no completed scoring run record exists, trace requests return an explicit not-evaluated response instead of simulated pipeline steps. Developer Mode fixture runs remain simulated.
- Front-end SEES snapshot shortcodes rebuild from storage only: stored daily options, latest `tradepress_symbol_scores` rows, existing `tradepress_queue` rows for status, and a deterministic fallback for empty storage. Manual refresh clears the snapshot cache but does not call providers or create queue items yet.
- `TradePress_Scoring_Process` now resolves the current `symbols` CPT and ticker meta fallbacks before calling `TradePress_Scoring_Algorithm::calculate_symbol_score()`. The process reads stored price options first, then derives price/change/volume from `tradepress_historical_data_{symbol}` daily bars when direct price data is absent. The algorithm method reads stored price/technical option data passed by the process and writes score history through the existing `tradepress_symbol_scores` path. It does not call providers directly.
- The Wizard scoring step links Developer Mode users to Scoring Directives > Algorithm because that page exposes the explicit stored-scores-only process control. Normal users remain directed to Automation > Data Import until scoring execution is release-ready outside Developer Mode. Missing `process_type` AJAX requests default to stored-score generation, and the Automation Dashboard scoring card queues stored scores only; signals/rankings require an explicit Developer Mode process selection.
- `tradepress_get_stored_score_evidence()` is the shared storage-only helper for score-table availability, row count, latest symbol/score/component count, and whether SEES scoring traces can read stored components. The Wizard, Scoring Directives > Algorithm, and Automation process-status AJAX read this contract without provider calls.
- `tradepress_get_algorithm_run_evidence()` is the shared storage-only helper for `tradepress_algorithm_runs` availability, latest run summary, latest completed run summary, and whether a completed scoring run exists to verify SEES score evidence. The Wizard and SEES Diagnostics trace header read this contract without provider calls.
- Wizard SEES readiness now treats run evidence and score-row evidence as separate gates: a dedicated completed-run step (`tradepress_algorithm_runs`) and a separate stored-score step (`tradepress_symbol_scores`).
- `tradepress_get_scoring_input_evidence()` is the shared storage-only helper for scoring preflight checks. It reads published Symbols plus stored `tradepress_price_data_{symbol}` and `tradepress_historical_data_{symbol}` options to report how many symbols are scoreable before a scores-only run is started. The Wizard and Scoring Directives > Algorithm use this contract without provider calls.
- Automation > Data Import also displays the scoring input evidence so the "run data import first" recovery path shows whether price/historical storage is ready for scoring after queue processing. When Symbols exist but no scoring input is available, the panel can queue the existing Price Data import action through the background queue; it still does not call providers from the render path. The price importer now resolves current `symbols` CPT records through the same ticker fallback chain as scoring readiness before fetching price or historical data, and successful quote imports write the `tradepress_price_data_{symbol}` option shape consumed by stored-score generation. Scoring readiness requires a positive stored price or usable historical close data; malformed/zero price options do not unlock scoring.
- Automation > Data Import and the Wizard both expose `fetch_prices` queue state separately from stored scoring-input readiness. A pending/processing Price Data item is shown as queued work, not as stored-data readiness, and duplicate queue buttons are hidden while the item is active.
- Scores-only process starts are blocked when scoring input evidence reports zero scoreable Symbols. The guard applies to both the Automation Dashboard scoring component and Scoring Directives > Algorithm process button, returning the same storage-only evidence payload for UI refresh.
- `assets/js/sees-diagnostics.js` displays selected strategy metadata, component counts, decision state, and next function from the AJAX trace response.
- `assets/js/sees-diagnostics.js` now reads `threshold_distance` as the canonical score-to-suggested-threshold distance, keeps `distance_to_threshold` as fallback compatibility, labels branch statuses, distinguishes component warnings from hard failures, and supports copying the trace payload for verification evidence.
- Create Scoring Strategies now exposes `Suggested Trading Threshold` after the directive stack and saves it as `min_score_threshold`; this value is the source of `minimum_threshold` in SEES Diagnostics scoring-mode traces.
- Create and Manage Scoring Strategies expose watchlist-based symbol scope metadata. SEES Diagnostics includes `strategy_scope` and `scope_validation`; scoring-mode out-of-scope findings warn but continue ranking.
- Manual continued-path evidence captured: strategy `SEES UI Testing`, 4 components, score `79.36 / 100.00`, threshold distance `+29.36`, decision continued to `tradepress_rank_scoring_strategy_result()`.
- Historical stopped-path evidence that used scoring threshold as a hard gate is superseded. Current scoring-mode behavior treats below-suggested-threshold as `score-threshold` warning and keeps `decision_state: continued`; hard threshold stops belong to Trading Strategy execution.
- WP-CLI warning-path evidence captured: strategy `SEES UI Testing`, temporary inactive `cci` component, 4 components, passed `3`, warnings `1`, score `60.40 / 100.00`, threshold distance `+10.40`, `component-health` warning followed by `score-threshold` passed. `cci` restored to active after capture.
- `admin/page/analysis/view/recent-symbols.php` reads `tradepress_symbol_scores` only and renders Cached or Empty state.
- `admin/page/analysis/view/support-resistance.php` no longer instantiates `TradePress_Financial_API_Service` or `SupportResistanceLevels` during render; it validates explicit user input and reports that stored OHLC-backed analysis is not connected yet.
- `admin/page/analysis/view/volatility-analysis.php` renders a dev-only placeholder/status panel only; no provider or analyzer is called during render.

## Config-Path Contract (Trading Platforms tabs)

The Trading Platforms page exposes API management, provider comparisons, and enable/disable switches for configured broker and market-data APIs. Confirmed by source inspection (AGENT-2 Option B audit, 2026-05-01):

| View | Data purpose | Source of truth | Provider call in render path | Queue trigger | Freshness SLA | UI data mode |
|---|---|---|---|---|---|---|
| Trading Platforms > Overview | Landing page for platform integrations | Static/stored provider directory listing via `TradePress_API_Directory::get_all_providers()` | None | None | Not applicable | Config/Live |
| Trading Platforms > API Management | Stored API key and endpoint configuration per provider | WordPress options via `get_option()` per provider slug | None — credentials are read from storage; no API test call during render | None | Not applicable; configuration surface | Config/Live |
| Trading Platforms > API Switches | Enable/disable per-provider service flags | WordPress options (service enable/disable switches) | None | None | Not applicable | Config/Live |
| Trading Platforms > Provider Comparisons | Static comparison grid of supported providers and capability tiers | Static/hardcoded comparison data in the comparisons view or provider directory | None | None | Not applicable | Config/Live (static) |

**Rules:**
- Trading Platforms tabs must not call external provider APIs in their render path.
- Live credential testing (if implemented) must use an explicit AJAX action, never page render.
- All provider API calls must go through the background queue processor.
