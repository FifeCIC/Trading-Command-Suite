/**
 * MetaStackPipeline — reusable META.Stack pipeline content (Focused + Technical).
 * ==============================================================================
 * Extracted from MetaStackDisplayPage (2026-08-19) so it can be embedded in the
 * META.Stack Cockpit too. Renders the 6-stage pipeline (Symbols → Strategy →
 * Signals → Risk Rules → Execution → Results) as two card rows:
 *
 *   - Focused View: high-level "what" for the selected META.Stack
 *   - Technical Detail: the "how" (ids, config, live scores)
 *
 * Props:
 *   title       — card header title (default "MetaStack Display")
 *   subtitle    — header subtitle
 *   showHeader  — set false when embedding inside a page that has its own header
 *                 (keeps the META.Stack selector visible)
 *
 * Route: embedded in /development/meta-stack-cockpit (was the standalone /lab/metastack-display)
 * Data:  GET /api/scoring/metastacks/ratings, GET /api/scoring/protocols,
 *        GET /api/watchlists, GET /api/speed/scan
 */
import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { apiGet } from '../core/api/client';
import { translateMetaStack } from '../core/translators/focused-translator';
import LoadingSkeleton from '../components/LoadingSkeleton';
import '../pages/metastack-display.css';

var PIPELINE_STAGES = [
  { id: 'watchlist', label: 'Symbols', icon: '★' },
  { id: 'protocol', label: 'Strategy', icon: '◆' },
  { id: 'scoring', label: 'Signals', icon: '◉' },
  { id: 'parameters', label: 'Risk Rules', icon: '⚙' },
  { id: 'broker', label: 'Execution', icon: '🔌' },
  { id: 'performance', label: 'Results', icon: '◈' },
];

export default function MetaStackPipeline({ title = 'MetaStack Display', subtitle = 'META.Stack — Modular Expert Trading Architecture', showHeader = true }) {
  var [selectedStackId, setSelectedStackId] = useState(null);

  var stacksQuery = useQuery({
    queryKey: ['metastack-ratings'],
    queryFn: function () { return apiGet('/api/scoring/metastacks/ratings'); },
    refetchInterval: 30000,
  });
  var stacks = stacksQuery.data ? (stacksQuery.data.metaStacks || []) : [];

  useEffect(function () {
    if (stacks.length > 0 && !selectedStackId) {
      var production = stacks.find(function (s) {
        return s.metaStackName && s.metaStackName.indexOf('TEST') === -1 && s.protocolId !== 'built-in-default';
      });
      setSelectedStackId(production ? production.scoringStrategyId : stacks[0].scoringStrategyId);
    }
  }, [stacks, selectedStackId]);

  var selectedStack = stacks.find(function (s) { return s.scoringStrategyId === selectedStackId; }) || null;

  var protocolsQuery = useQuery({
    queryKey: ['protocols-list'],
    queryFn: function () { return apiGet('/api/scoring/protocols'); },
    enabled: !!selectedStack,
  });
  var protocols = protocolsQuery.data ? (protocolsQuery.data.protocols || []) : [];

  var watchlistsQuery = useQuery({
    queryKey: ['watchlists-list'],
    queryFn: function () { return apiGet('/api/watchlists').catch(function () { return []; }); },
    staleTime: 120000,
  });
  var watchlists = Array.isArray(watchlistsQuery.data) ? watchlistsQuery.data : [];

  var liveMaps = useMemo(function () {
    var protoMap = {};
    protocols.forEach(function (p) { protoMap[p.id] = { title: p.name || p.title, desc: p.description || p.desc }; });
    var wlMap = {};
    watchlists.forEach(function (w) { wlMap[w.id] = { title: w.label || w.name || w.title, desc: w.description || w.desc }; });
    return { protocols: protoMap, watchlists: wlMap };
  }, [protocols, watchlists]);

  /**
   * Live per-symbol scores for the Signals stage.
   *
   * ⚠️ 2026-09-17 — this called `apiGet('/api/speed/scan?limit=8')` and ALWAYS 404'd.
   * `/api/speed/scan` is `@Post('scan')` ONLY (speed-scan.controller.ts) — there is no
   * GET route, so `apiGet` could never succeed. The consequence was invisible in the
   * worst way: `rawScores` was permanently `[]`, so the Signals stage silently rendered
   * "Awaiting live data" forever, and the 15s poll flooded logs/api-err.log. No error
   * surfaced to the user because `.data` of a failed query is `undefined`, and
   * `undefined || []` is indistinguishable from "no signals right now".
   *
   * Repointed to `/api/signals/best` — a PRE-COMPUTED read, which is the right choice
   * over POSTing to /api/speed/scan: that endpoint's own docblock declares itself the
   * heaviest in the app (4× bar fetches per symbol across ~23 symbols) and says it is
   * "NOT for dashboard overviews". Polling it every 15s from an always-open cockpit
   * would be a real cost for data that is already materialised.
   *
   * Contract: `translateMetaStack(stack, protocols, scores, liveMaps)` does
   * `scores.slice(0, 6).map(s => ({ symbol: s.symbol, composite: s.composite, signal: s.signal }))`
   * — so it needs a flat ARRAY of `{symbol, composite, signal}`. `/api/signals/best`
   * returns those three fields on each item of `envelopes`, so `.envelopes` is a
   * drop-in. Nothing else is consumed, so no mapping layer is needed.
   */
  var scoresQuery = useQuery({
    queryKey: ['signals-best', selectedStack ? selectedStack.watchlistName : ''],
    queryFn: function () {
      return apiGet('/api/signals/best').then(function (d) {
        return (d && Array.isArray(d.envelopes)) ? d.envelopes : [];
      });
    },
    refetchInterval: 15000,
    enabled: !!selectedStack,
  });
  var rawScores = Array.isArray(scoresQuery.data) ? scoresQuery.data : [];

  var focused = selectedStack ? translateMetaStack(selectedStack, protocols, rawScores, liveMaps) : null;

  return (
    <div className="msd-page">
      <header className="msd-header">
        {showHeader && (
          <div>
            <h2>{title}</h2>
            <p className="msd-subtitle">{subtitle}</p>
          </div>
        )}
        <div className="msd-header-right">
          {stacksQuery.isLoading ? (
            <span className="msd-loading-text">Loading</span>
          ) : (
            <select
              className="msd-stack-select"
              value={selectedStackId || ''}
              onChange={function (e) { setSelectedStackId(e.target.value); }}
            >
              {stacks.map(function (s) {
                return (
                  <option key={s.scoringStrategyId} value={s.scoringStrategyId}>
                    {s.metaStackName}
                  </option>
                );
              })}
            </select>
          )}
        </div>
      </header>

      {stacksQuery.isLoading && <LoadingSkeleton variant="text" lines={4} />}

      {selectedStack && focused && (
        <div className="msd-scroll">
          <div className="msd-row-label">Focused View</div>
          <div className="msd-row msd-row-focused">
            {PIPELINE_STAGES.map(function (stage, i) {
              var isLast = i === PIPELINE_STAGES.length - 1;
              return (
                <div key={'f-' + stage.id} className="msd-stage-group">
                  <motion.div
                    className="msd-card msd-card-focused"
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05 }}
                  >
                    <div className="msd-card-head">
                      <span className="msd-card-icon">{stage.icon}</span>
                      <span className="msd-card-title">{stage.label}</span>
                    </div>
                    <div className="msd-card-body">{renderFocusedStage(stage.id, focused)}</div>
                  </motion.div>
                  {!isLast && <div className="msd-connector">→</div>}
                </div>
              );
            })}
          </div>

          <div className="msd-row-label msd-row-label-tech">Technical Detail</div>
          <div className="msd-row msd-row-technical">
            {PIPELINE_STAGES.map(function (stage, i) {
              var isLast = i === PIPELINE_STAGES.length - 1;
              return (
                <div key={'t-' + stage.id} className="msd-stage-group">
                  <motion.div
                    className="msd-card msd-card-technical"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.04 }}
                  >
                    <div className="msd-card-head msd-card-head-tech">
                      <span className="msd-card-title">{stage.label}</span>
                    </div>
                    <div className="msd-card-body">{renderTechnicalStage(stage.id, selectedStack, protocols, rawScores)}</div>
                  </motion.div>
                  {!isLast && <div className="msd-connector msd-connector-tech">→</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Focused row content ─────────────────────────────── */

function renderFocusedStage(stageId, f) {
  switch (stageId) {
    case 'watchlist':
      return (
        <div className="msd-focused-body">
          <div className="msd-f-hero">{f.watchlistName}</div>
          <p className="msd-f-desc">{f.watchlistDesc}</p>
          <div className="msd-f-slug">{f.watchlistSlug}</div>
        </div>
      );
    case 'protocol':
      return (
        <div className="msd-focused-body">
          <div className="msd-f-hero">{f.protocolName}</div>
          <p className="msd-f-desc">{f.protocolDesc}</p>
          <div className="msd-f-slug">{f.protocolSlug}</div>
        </div>
      );
    case 'scoring':
      return (
        <div className="msd-focused-body">
          {f.hasScores ? (
            f.scores.map(function (item) {
              var s = item.focused;
              return (
                <div key={item.symbol} className={'msd-signal msd-signal-' + s.strength}>
                  <span className="msd-signal-sym">{item.symbol}</span>
                  <span className="msd-signal-label">{s.signal}</span>
                </div>
              );
            })
          ) : (
            <div className="msd-empty">Awaiting live data</div>
          )}
        </div>
      );
    case 'parameters':
      return (
        <div className="msd-focused-body">
          <div className="msd-param"><span className="msd-param-label">Trade size</span><span className="msd-param-val">{f.baseSize} lots</span></div>
          <div className="msd-param"><span className="msd-param-label">Stop loss</span><span className="msd-param-val">{f.slDescription}</span></div>
          <div className="msd-param"><span className="msd-param-label">Take profit</span><span className="msd-param-val">{f.tpDescription}</span></div>
          <div className="msd-param"><span className="msd-param-label">Requires</span><span className="msd-param-val">{f.tradeThreshold} signals agree</span></div>
        </div>
      );
    case 'broker':
      return (
        <div className="msd-focused-body">
          <div className="msd-f-hero">{f.brokerName}</div>
          <p className="msd-f-desc">{f.brokerDesc}</p>
          <div className="msd-f-slug">{f.brokerSlug}</div>
        </div>
      );
    case 'performance':
      return (
        <div className="msd-focused-body">
          {f.hasTrades ? (
            <div className="msd-perf">
              <div className="msd-perf-rating" style={{ color: f.bandColor }}>
                <span className="msd-perf-stars">{f.bandIcon}</span>
                <span className="msd-perf-label">{f.bandLabel}</span>
              </div>
              <div className="msd-perf-stats">
                <div className="msd-perf-stat"><span className="msd-perf-num">{f.totalTrades}</span><span className="msd-perf-unit">trades</span></div>
                <div className="msd-perf-stat"><span className="msd-perf-num">{f.winRate || '—'}</span><span className="msd-perf-unit">win rate</span></div>
              </div>
            </div>
          ) : (
            <div className="msd-empty"><span className="msd-empty-icon">○</span><span>No trades yet</span></div>
          )}
        </div>
      );
    default:
      return null;
  }
}

/* ── Technical row content ───────────────────────────── */

function renderTechnicalStage(stageId, stack, protocols, scores) {
  switch (stageId) {
    case 'watchlist':
      return (
        <div className="msd-tech-list">
          <div className="msd-tech-item"><span>Watchlist</span><span className="msd-tech-mono">{stack.watchlistName}</span></div>
          <div className="msd-tech-item"><span>Source</span><span>Database</span></div>
        </div>
      );
    case 'protocol':
      return (
        <div className="msd-tech-list">
          <div className="msd-tech-item"><span>Protocol ID</span><span className="msd-tech-mono">{stack.protocolId}</span></div>
          <div className="msd-tech-item"><span>Type</span><span>{stack.protocolId === 'built-in-default' ? 'Default' : 'Technical Core'}</span></div>
          {protocols.length > 0 && (
            <div className="msd-tech-item"><span>Directives</span><span className="msd-tech-mono">{protocols[0].directiveCount || '—'}</span></div>
          )}
        </div>
      );
    case 'scoring': {
      var hasScores = Array.isArray(scores) && scores.length > 0;
      return (
        <div className="msd-tech-list">
          {hasScores ? (
            scores.slice(0, 6).map(function (s) {
              return (
                <div key={s.symbol} className="msd-tech-item">
                  <span>{s.symbol}</span>
                  <span className="msd-tech-mono">{s.composite != null ? s.composite : '—'}{s.signal ? ' ' + s.signal.toUpperCase() : ''}</span>
                </div>
              );
            })
          ) : (
            <div className="msd-tech-item"><span>Scores</span><span>—</span></div>
          )}
        </div>
      );
    }
    case 'parameters':
      return (
        <div className="msd-tech-list">
          <div className="msd-tech-item"><span>Size</span><span className="msd-tech-mono">{stack.baseSize || '0.01'} lots</span></div>
          <div className="msd-tech-item"><span>SL</span><span>{stack.slPct != null ? stack.slPct + '%' : 'ATR'}</span></div>
          <div className="msd-tech-item"><span>TP</span><span>{stack.tpPct != null ? stack.tpPct + '%' : 'ATR'}</span></div>
          <div className="msd-tech-item"><span>Threshold</span><span className="msd-tech-mono">{stack.tradeThreshold || 3}</span></div>
        </div>
      );
    case 'broker':
      return (
        <div className="msd-tech-list">
          <div className="msd-tech-item"><span>Broker</span><span className="msd-tech-mono">{stack.brokerId}</span></div>
          <div className="msd-tech-item"><span>Mode</span><span>{stack.mode || 'auto'}</span></div>
          <div className="msd-tech-item"><span>Bridge</span><span className="msd-tech-mono">localhost:5000</span></div>
        </div>
      );
    case 'performance': {
      var hasTrades = stack.totalTrades > 0;
      return (
        <div className="msd-tech-list">
          <div className="msd-tech-item"><span>Rating</span><span className="msd-tech-mono">{stack.band || 'Untested'}{stack.rating > 0 ? ' ' + stack.rating.toFixed(1) : ''}</span></div>
          <div className="msd-tech-item"><span>Trades</span><span className="msd-tech-mono">{stack.totalTrades || 0}</span></div>
          <div className="msd-tech-item"><span>Win Rate</span><span className="msd-tech-mono">{stack.winRate > 0 ? (stack.winRate * 100).toFixed(0) + '%' : '—'}</span></div>
          <div className="msd-tech-item"><span>P&amp;L</span><span className="msd-tech-mono">{stack.totalPnl !== 0 ? 'GBP ' + stack.totalPnl.toFixed(2) : '—'}</span></div>
        </div>
      );
    }
    default:
      return null;
  }
}
