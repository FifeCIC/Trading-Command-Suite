/**
 * ViewStrategyPage.jsx — THE PER-BOT TRUTH VIEW (issue #864).
 * ===========================================================
 *
 * WHAT THIS REPLACED
 * ------------------
 * This file was 124 lines of `// Mock strategy data` — invented win rates, invented directives,
 * invented signals. It was also reachable by nothing: no route, no nav entry, no view-meta entry,
 * and it read `useParams().id` while the router supplies `{ area, view }`. So `id` was always
 * `undefined` and the mock fallback (`'forex-mr'`) always rendered. Fiction, and not even reachable
 * fiction. It also imported `./view-strategy.css`, which does not exist in the repo — the build
 * passed only because nothing imported the page, so Vite never resolved the import.
 *
 * THE POINT OF THIS PAGE
 * ----------------------
 * A bot is a row of ~32 columns interpreted by straight-line `if` chains. Measured 2026-09-17:
 * **8 of 29 behavioural columns were enforced NOWHERE** on the live path, 5 more were enforced ONLY
 * on the retired `execute()` path, and the create form still offered all of them. Nothing failed
 * when configuration and engine diverged, so the form made promises the engine did not keep.
 *
 * > The question is never "does this field exist". It is **"can this field change a trade?"**
 *
 * So this page renders EVERY DECLARED RULE with its effective VALUE *and* its ENFORCEMENT STATUS,
 * and the layout is DERIVED FROM `GET /api/trading/strategies/bot-rules` rather than hand-written.
 * That derivation is load-bearing: a new `trading_strategy` column cannot reach this page without
 * its declaration, because the declaration IS the layout. `nest/scripts/validate-bot-rules.cjs`
 * fails the backend build if a behavioural column has no declaration, so the two ends are joined.
 *
 * ⚠️ A NEW ENFORCEMENT LEVEL MUST NOT RENDER AS IF LIVE. `ENFORCEMENT` below covers the four levels
 * the backend declares. An unrecognised level falls through to the `NOT APPLIED` treatment with a
 * warning, rather than rendering a blank chip — the failure mode this whole page exists to prevent
 * is a rule that *looks* applied.
 *
 * ⚠️ "NOT CONFIGURED" AND "CONFIGURED BUT NOT ENFORCED" ARE DIFFERENT FACTS (AC6). A null field is
 * unset; a field holding `false` or `0` is SET. Only `null | undefined | ''` count as unconfigured
 * — a truthiness check would misreport `useRaritySizing: false` as "not configured" when it is in
 * fact configured and nothing reads it.
 *
 * MODES — ONE VIEW, TWO OF THEM (#985 §2, owner direction 2026-09-23)
 * ---------------------------------------------------------------
 * > *"for viewing the settings only and not the full information, it could even be on the same
 * > view, but with a url parameter that displays a simplified version for focusing on the
 * > configuration of the bot."*
 *
 * So this is NOT two pages. `?view=settings` renders the configuration; the default renders the
 * full audit. The parameter is OPT-IN because the full view is the SAFE default: a bookmark or an
 * inbound link from anywhere else must keep showing the enforcement verdicts, and silently dropping
 * them for a reader who did not ask would hide the exact defect this page exists to expose.
 *
 * ⚠️ WHAT SETTINGS MODE HIDES IS PROSE AND TALLY, NEVER A VERDICT. The per-row chip still states
 * whether each setting applies, and `rule.summary` still explains what the setting does. What goes
 * is the audit furniture — the enforcement tally, the per-row explanations, the lifecycle
 * completeness picture, the realised record and the undeclared-column check. A reader tuning a bot
 * must still be able to see that a field they just set is ignored; that is the one fact this page
 * cannot afford to make harder to find.
 *
 * DATA
 * ----
 *   GET /api/trading/strategies/:id            — the bot's values (the row)
 *   GET /api/trading/strategies/bot-rules      — the declarations (the truth about the values)
 *   GET /api/trading/strategies/:id/protocols  — subscriptions; `role` lives HERE, not on the bot
 */

import { useMemo, useRef, useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiGet, apiPost } from '../core/api/client';
// The app's ONE reveal-on-scroll mechanism (Theme Lab -> Scroll Animations). `.lad-reveal` is
// `opacity: 0` in `ladder.css`, and this hook is the only thing that adds `lad-reveal--show`, so a
// `.lad-reveal` element WITHOUT the hook stays invisible. Reusing the hook rather than writing a
// second IntersectionObserver is deliberate - a second implementation drifts.
import { useScrollReveal } from '../hooks/useScrollReveal';
// The lifecycle vocabulary and the dormancy rule. These were defined in THIS file until the
// lifecycle diagram became a second consumer; they now live in one place so the list and the
// picture cannot disagree about which stage a column belongs to, or which values are ignored.
import {
  STAGE_LABEL,
  buildBotStagePath,
  botStageClaims,
  evaluateBotStageClaims,
  groupRulesByStage,
  isConfigured,
  isDormant,
} from '../core/bot-stage-path';
import { annotateSource, summarise } from '../core/diagram-claims';
// ⚠️ #870 — the enforcement words/hints live in `core/bot-rule-enforcement.jsx`. They were HERE,
// and the create form needs the same four meanings; a second copy would drift, and the whole point
// of the exercise is that a field's enforcement has ONE home.
import { ENFORCEMENT, UNDECLARED } from '../core/bot-rule-enforcement';
import { useThemedMermaid, readStatusColors, renderMermaidSvg } from '../core/mermaid-theme';
// Shared formatters — the app's ONE P&L sign/class pair and the number/currency/date helpers.
// ⚠️ `formatPct` takes ALREADY-PERCENT values (it toFixed()s and appends '%', it does NOT ×100),
// and it always signs positives — right for a delta, wrong for a rate. `winRate` is a FRACTION
// (0.625), so a rate is rendered as `formatNumber(winRate * 100) + '%'` on purpose.
import { pnlClass, pnlSign } from '../core/signal-utils.js';
import { formatCurrency, formatDateTime, formatNumber } from '../core/format-utils.js';
// ⚠️ A failure is rendered through the notice REGISTRY, never as `error.message`. The raw form was
// caught by the notices ratchet (`scripts/validate-notices.cjs`) and it was right to catch it: raw
// wording discards the status, the code and the remedy, which is how a broker's bare sentence once
// reached a user (#824). `TCS-SYS-002` carries the status and the action; the wording is preserved
// inside the notice as its cause.
import { noticeFromError } from '../core/notices/from-error.js';
import NoticeBlock from '../components/NoticeBlock';
import styles from './view-strategy.module.css';
import './strategy-decision-path.css';

// ⚠️ Mermaid is configured by `core/mermaid-theme`, NOT here — `mermaid.initialize()` sets a
// GLOBAL singleton, so a second call on another page silently overrides this one.

const TRADING = '/api/trading/strategies';
// The realised record (#894). NOT under TRADING's prefix — it is a portfolio-scope endpoint.
const BOT_PERF = '/api/trading/bot-performance';

/**
 * ⚠️ #870 — the four enforcement levels MOVED to `core/bot-rule-enforcement.jsx`, which the create
 * form also imports. Do not re-declare them here.
 */

// STAGE_ORDER / STAGE_LABEL moved to `core/bot-stage-path.js` — the lifecycle diagram needs the
// same order, and two copies would drift.

/**
 * Format a stored value.
 *
 * ⚠️ `false` and `0` are CONFIGURED. Testing truthiness here would report a deliberate `false` as
 * "not configured", which is the opposite of the fact — and AC6 exists precisely because those two
 * states need telling apart.
 */
function formatValue(v) {
  if (v === null || v === undefined || v === '') return { text: 'not configured', unset: true };
  if (v === true) return { text: 'on', strong: true };
  if (v === false) return { text: 'off', strong: true };
  if (Array.isArray(v)) return { text: v.length ? v.join(', ') : '(empty list)' };
  if (typeof v === 'object') return { text: '[object]' };
  return { text: String(v) };
}

// `isConfigured` and `isDormant` moved to `core/bot-stage-path.js` — the lifecycle diagram applies
// the same rule, and a second copy would let the list and the picture disagree about which values
// are being ignored. The reasoning behind both exclusions (`identity` labels, booleans set false)
// travelled with the function.

/** Columns on the row that are structure and bookkeeping, not behaviour. */
const NON_RULE_FIELDS = new Set(['id', 'createdAt', 'updatedAt', 'evaluations']);

/**
 * The lifecycle diagram for one bot — every stage a trade passes through, and what this bot has
 * declared at each.
 *
 * ⚠️ WHY THIS EXISTS NEXT TO A LIST THAT SAYS THE SAME THING.
 * The grouped list below is accurate and nobody reads it in order. A bot with `sizing` and `risk`
 * declared but nothing at `routing` or `entry` looks perfectly configured in a list of rules — the
 * gap is only visible as an ABSENCE, and absences are what prose hides best. The picture draws all
 * seven stages whether or not each has rules, so a missing one looks missing.
 *
 * Every claim here is resolved from ONE OF TWO SOURCES, and the difference is deliberate:
 *   - "this stage has a rule the engine can act on" — from the DECLARATIONS alone, so it stays
 *     readable even when the bot row itself failed to load.
 *   - "nothing here is set and ignored" — needs the bot's VALUES, so it is `ok: null` (unverified)
 *     without them. Nothing is measured, so nothing is asserted; red is reserved for a real
 *     disagreement.
 * ⚠️ NO ERROR PROP, DELIBERATELY. The page EARLY-RETURNS on `rulesQuery.isError` (and on an empty
 * rules list) before this component is reached, so a `rulesError` prop here was dead code that
 * could never fire — and it was the one thing pushing a raw `.message` into the render, which the
 * notices ratchet (`scripts/validate-notices.cjs`) correctly refused. Do not add it back; if the
 * page ever stops early-returning, give the failure a CODE rather than passing a message through.
 */
function BotLifecyclePath({ bot, rules }) {
  const path = useMemo(() => buildBotStagePath(bot, rules), [bot, rules]);
  const rows = useMemo(
    () => evaluateBotStageClaims(botStageClaims(bot, path), { bot, rules }),
    [bot, path, rules],
  );
  const summary = useMemo(() => summarise(rows), [rows]);
  // A stage with nothing declared is an ABSENCE, not a failure, so it earns neither a red node nor
  // a red pill. It is still worth counting and stating: in this picture an undeclared stage is
  // drawn as a bare node precisely so the gap is visible, and this line says how many there are.
  //
  // ⚠️ `n.tally &&` IS LOAD-BEARING (#1092, measured 2026-10-08). The brake-layer nodes carry
  // `tally: null` BY DESIGN (`bot-stage-path.js`: "tally: null marks these as NOT stages"), and
  // `botStageClaims()` guards for exactly that (`if (!n.tally) continue`). This filter did not —
  // so `null.declared` crashed the ENTIRE per-bot view on every bot, silently from the reader's
  // point of view ("Something went wrong rendering this view"). Any new consumer of `path.nodes`
  // must apply the same guard.
  const stagesWithoutRules = useMemo(
    () => path.nodes.filter((n) => n.tally && n.tally.declared === 0).length,
    [path],
  );
  const hostRef = useRef(null);
  // The shared Mermaid config. `themeKey` changes on every theme switch, so the effect redraws
  // instead of leaving the previous pack's palette cached in the DOM.
  const { themeKey } = useThemedMermaid();
  const diagramId = `bl-${bot?.id ?? 'unloaded'}`;

  useEffect(() => {
    if (!hostRef.current) return undefined;
    let cancelled = false;
    // The source is annotated FIRST, so a stage whose claim failed is stroked in the picture.
    const src = annotateSource(diagramId, path.source, rows, readStatusColors());
    renderMermaidSvg(`${diagramId}-svg`, src)
      .then((svg) => {
        if (!cancelled && hostRef.current) hostRef.current.innerHTML = svg;
      })
      .catch(() => {
        if (!cancelled && hostRef.current) {
          hostRef.current.innerHTML =
            '<p class="sl-hint">The lifecycle diagram could not be rendered.</p>';
        }
      });
    return () => { cancelled = true; };
  }, [diagramId, path.source, rows, themeKey]);

  return (
    <section className={styles.group}>
      <h2 className={styles.groupHead}>
        Lifecycle — where this bot can act
        <span className={styles.groupCount}>{path.nodes.length} stages</span>
      </h2>

      <div className="sd-diagram" ref={hostRef} role="img"
        aria-label={`Trade lifecycle stages for ${bot?.name ?? 'this bot'}`} />

      <div className="sd-summary">
        <span className="sd-summary-count">
          {summary.checked} of {summary.total} checks answered
        </span>
        <span className="sd-pill sd-pill--ok">{summary.passed} hold</span>
        <span className="sd-pill sd-pill--bad">{summary.failed} broken</span>
        <span className="sd-pill sd-pill--unknown">{summary.unverified} not checked</span>
      </div>

      {stagesWithoutRules > 0 && (
        <p className="sd-note">
          {stagesWithoutRules} stage(s) declare no rules at all — shown as bare nodes above rather
          than omitted, so a gap in the lifecycle reads as a gap.
        </p>
      )}

      <table className="sd-claims">
        <thead>
          <tr><th>Stage</th><th>Check</th><th>Expects</th><th>This bot</th></tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={r.ok === false ? 'sd-row--bad' : r.ok === true ? 'sd-row--ok' : ''}>
              <td className="sd-cell-node">{r.node}</td>
              <td>{r.says}</td>
              <td className="sd-cell-expect">{r.expect}</td>
              <td className="sd-cell-actual">
                {r.actual == null ? <em>not checked</em> : String(r.actual)}
                {r.error && <div className="sd-cell-error">{r.error}</div>}
                {!r.error && r.note && <div className="sd-cell-note">{r.note}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/**
 * BotRecord() — the bot's REALISED record, from `GET /api/trading/bot-performance` (#894).
 * BEFORE: the configuration headline above says what this bot is ALLOWED to do.
 * THIS:   what it has ACTUALLY done — every figure carries its `n`, so a record is read with its
 *         sample size attached rather than as a bare average.
 * NEXT:   the rating policy turns this record into a risk unlock once a sample floor is met.
 *
 * ⚠️ `rating: null` WITH a non-empty `blockers` list is a VALID state, not an error. The policy
 * (30 samples / 14 days / expectancy distinguishable from its own error bars / a risk condition)
 * withholds a stamp until the data supports one — the blockers ARE the finding. Never render this
 * as a failure and never substitute an invented verdict.
 *
 * ⚠️ Three states that must never look alike:
 *   - the read FAILED        -> "could not be read" + the error, explicitly NOT a zero
 *   - no row for this botId  -> a real zero (nothing attributed)
 *   - row with n = 0         -> also a real zero, shown with its counts
 *
 * ⚠️ `realisedPct` / `maxDrawdownPct` are null BY DESIGN: `trading_strategy` has no
 * capital-allocation column, so a percentage has no denominator. They are rendered with the
 * reason, never as `0.0%` — an invented denominator is how a 1780% drawdown shipped on the data
 * layer (the service's own regression note).
 */
function BotRecord({ query, row }) {
  const r = row?.realised || null;

  return (
    <section className={styles.group}>
      <h2 className={styles.groupHead}>
        Realised record
        <span className={styles.groupCount}>
          {r
            ? `${formatNumber(r.samples)} closes${row.window ? ` · ${row.window.days} day(s)` : ''}`
            : 'priced, attributed closes'}
        </span>
      </h2>

      {query.isLoading && (
        <p className={styles.sectionNote}>Reading the bot’s close history…</p>
      )}

      {query.isError && (
        <div className={styles.errorBox}>
          {/* The registry's own message (status + identity) rather than the thrown wording. */}
          <p className={styles.summaryText}>
            {noticeFromError(query.error, 'TCS-SYS-002').message} The realised record could not be
            read. This is a READ failure, not an empty record — the numbers are unknown, not zero.
          </p>
        </div>
      )}

      {!query.isLoading && !query.isError && !r && (
        <p className={styles.sectionNote}>
          No closed trades are attributed to this bot yet — a real zero (n = 0), not a failed read.
          Only closes carrying a broker ticket AND an exit price are counted, so reconciled phantom
          rows can never inflate this record.
        </p>
      )}

      {r && (
        <>
          <div className={styles.summary}>
            <div className={styles.summaryCell}>
              <span className={styles.summaryValue}>{formatNumber(r.samples)}</span>
              <span className={styles.summaryLabel}>priced closes (n)</span>
            </div>
            <div className={styles.summaryCell}>
              <span className={`${styles.summaryValue} ${pnlClass(r.expectancy)}`}>
                {pnlSign(r.expectancy)}
              </span>
              <span className={styles.summaryLabel}>
                expectancy / trade
                {Number.isFinite(r.standardError) ? ` · SE ${r.standardError.toFixed(2)}` : ''}
              </span>
            </div>
            <div className={styles.summaryCell}>
              <span className={styles.summaryValue}>
                {r.payoff == null ? '—' : r.payoff.toFixed(2)}
              </span>
              <span className={styles.summaryLabel}>payoff · avg win ÷ |avg loss|</span>
            </div>
            <div className={styles.summaryCell}>
              <span className={styles.summaryValue}>
                {r.winRate == null ? '—' : `${formatNumber(r.winRate * 100)}%`}
              </span>
              <span className={styles.summaryLabel}>
                {`${r.wins}W · ${r.losses}L${r.breakEven ? ` · ${r.breakEven} scratch` : ''}`}
              </span>
            </div>
            <div className={styles.summaryCell}>
              <span className={`${styles.summaryValue} ${pnlClass(r.totalPnl)}`}>
                {pnlSign(r.totalPnl)}
              </span>
              <span className={styles.summaryLabel}>total realised</span>
            </div>
            {/* The BASE for the two percentages beside it (#894). "not set" is a STATE, not a
                zero: with no allowance the rating's required risk condition cannot be applied at
                all, which is why the panel names it rather than printing a figure. */}
            <div className={styles.summaryCell}>
              <span className={styles.summaryValue}>
                {row.declared?.allocationAmount == null
                  ? 'not set'
                  : formatCurrency(row.declared.allocationAmount)}
              </span>
              <span className={styles.summaryLabel}>capital allowance · base for %</span>
            </div>
            <div className={styles.summaryCell}>
              <span className={styles.summaryValue}>
                {formatCurrency(row.maxDrawdown, { abs: true })}
              </span>
              <span className={styles.summaryLabel}>max decline · absolute</span>
            </div>
            {/* ⚠️ Rendered ONLY when an allowance exists. A null here means "no base", and a
                `0%` would read as a clean risk record — the most dangerous misreading of a
                drawdown figure. The null case is explained in the notes below instead. */}
            {row.realisedPct != null && (
              <div className={styles.summaryCell}>
                <span className={`${styles.summaryValue} ${pnlClass(row.realisedPct)}`}>
                  {formatNumber(row.realisedPct)}%
                </span>
                <span className={styles.summaryLabel}>return · % of allowance</span>
              </div>
            )}
            {row.maxDrawdownPct != null && (
              <div className={styles.summaryCell}>
                <span className={styles.summaryValue}>
                  {formatNumber(row.maxDrawdownPct)}%
                </span>
                <span className={styles.summaryLabel}>decline · % of allowance</span>
              </div>
            )}
            <div className={styles.summaryCell}>
              <span
                className={`${styles.chip} ${r.reliability === 'noise' ? styles.chipNone : styles.chipLegacy}`}
              >
                {r.reliability}
              </span>
              <span className={styles.summaryLabel}>evidence grade at this n</span>
            </div>
          </div>

          <p className={styles.sectionNote}>
            {row.window
              ? `${formatDateTime(row.window.firstClose)} → ${formatDateTime(row.window.lastClose)} · ${row.window.days} day(s) · ${row.window.samplesPerDay}/day`
              : 'Window unknown.'}
            {row.attributionKind && row.attributionKind !== 'bot'
              ? ` · attributed as “${row.attributionKind}”`
              : ''}
            {row.strategyIdentity && row.strategyIdentity !== 'one'
              ? ` · attribution spans ${row.strategyKeys?.length ?? 'several'} variant(s)`
              : ''}
          </p>

          <p className={styles.sectionNote}>
            {row.rating
              ? `Rating: ${row.rating.isGold === false ? 'measured, not yet gold' : 'GOLD'}`
              : `Rating withheld — ${(row.blockers || []).length} unmet condition(s):`}
          </p>

          {!row.rating && (row.blockersDetail?.length || row.blockers?.length) ? (
            <ul className={styles.blockerList}>
              {(row.blockersDetail?.length ? row.blockersDetail : row.blockers).map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          ) : null}

          {(row.realisedPct == null || row.maxDrawdownPct == null) && (
            <p className={styles.sectionNote}>
              Return % and drawdown % are not shown: this bot has no capital allowance set, so a
              percentage has no denominator — <code>trading_strategy.allocationAmount</code> is the
              base, and the rating's required risk condition cannot be applied without it. Absolute
              figures are served instead. A percentage would be invented.
            </p>
          )}

          {(query.data?.caveats || []).map((c, i) => (
            <p key={i} className={styles.sectionNote}>
              {c}
            </p>
          ))}
          {query.data?.populationNote && (
            <p className={styles.sectionNote}>{query.data.populationNote}</p>
          )}
        </>
      )}
    </section>
  );
}

/**
 * RouteAccountPanel — which BROKER BRIDGE fills this bot's orders, and the way to re-select it.
 *
 * WHY IT EXISTS (owner, 2026-10-11): *"when we view a bot there is no way to re-select a broker"* —
 * asked while the Pepperstone demo the bot's symbol was routed to had expired. Two facts were true
 * at once, and neither was visible anywhere near the bot:
 *
 *   1. The bot carries `brokerId: 'mt5'` — a VENUE, not an account. The ACCOUNT is chosen by
 *      `symbol_route` (per SYMBOL, shared by every bot trading it), which is why this panel says so
 *      in its own words when more than one bot is affected.
 *   2. Nothing surfaced that the account was gone, on the page about the bot that uses it.
 *
 * The panel writes through `POST /api/providers/mt5/routes/:symbol/switch` — ONE transaction that
 * disables the current row and enables the target, so a half-applied route (which reads as "no
 * route" and silently falls back to the primary broker) cannot happen. The server refuses targets
 * whose own symbol list reports tradeMode=0 (#1002); the refusal is rendered as text rather than
 * left for the operator to discover at order time.
 */
function RouteAccountPanel({ bot }) {
  const routeQuery = useQuery({
    queryKey: ['mt5-route', bot.symbol],
    queryFn: () => apiGet(`/api/providers/mt5/routes/${encodeURIComponent(bot.symbol)}`),
  });
  const [target, setTarget] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState(null); // { ok, text }
  const [failure, setFailure] = useState(null); // notice

  const data = routeQuery.data;
  const route = data?.route;
  const brokers = data?.brokers || [];
  const current = brokers.find((b) => b.current);
  const down = current && (!current.reachable || !current.connected);
  const currentCantTrade = current?.canTrade === false;
  const shared = typeof data?.botsOnSymbol === 'number' && data.botsOnSymbol > 1;

  async function doSwitch() {
    setBusy(true); setOutcome(null); setFailure(null);
    try {
      const res = await apiPost(
        `/api/providers/mt5/routes/${encodeURIComponent(bot.symbol)}/switch`,
        { brokerId: Number(target) },
      );
      if (res?.ok) {
        setOutcome({
          ok: true,
          text:
            `Re-routed ${bot.symbol} to broker ${res.after?.brokerId}.` +
            (String(res.capability || '').startsWith('unverified')
              ? ` Capability unverified — this broker's symbol list has no entry for ${bot.symbol}.`
              : ''),
        });
        setTarget(''); setConfirming(false);
        routeQuery.refetch();
      } else {
        setOutcome({ ok: false, text: res?.error || 'The switch was refused.' });
      }
    } catch (err) {
      setFailure(noticeFromError(err, 'TCS-SYS-007', { operation: `re-route ${bot.symbol}` }));
    } finally { setBusy(false); }
  }

  const selectable = brokers.filter((b) => !b.current);

  // Server + account number, each only when really known — an unreachable bridge reports
  // `server: '?'` and a null account, and neither must be rendered as a fact.
  const currentBits = [];
  if (current?.server && current.server !== '?') currentBits.push(current.server);
  if (current?.account) currentBits.push(current.account);
  const currentLabel = currentBits.length ? ` (${currentBits.join(' · ')})` : '';

  return (
    <section className={`${styles.group} lad-reveal`}>
      <h2 className={styles.groupHead}>
        Account routing — which bridge fills this bot&apos;s orders
        <span className={styles.groupCount}><code>symbol_route</code></span>
      </h2>

      {routeQuery.isPending && <p className={styles.sectionNote}>Reading the route…</p>}
      {routeQuery.isError && (
        <p className={styles.sectionNote}>
          ⚠️ <strong>Could not read the route.</strong> A failed read is not &quot;no route&quot; —
          check the API is running and reload.
        </p>
      )}

      {data && (
        <>
          <div className={styles.routeRow}>
            <span className={styles.routePath}>
              <strong>{bot.symbol}</strong> → broker {route.brokerId}{currentLabel}
            </span>
            {current && (
              <span className={`${styles.chip} ${down ? styles.chipNone : styles.chipLive}`}>
                {down ? 'UNREACHABLE' : 'CONNECTED'}
              </span>
            )}
            {!route.explicit && (
              <span className={`${styles.chip} ${styles.chipDisplay}`}>DEFAULT (no row)</span>
            )}
          </div>

          {down && (
            <p className={styles.routeWarn}>
              ⚠️ Orders for <strong>{bot.symbol}</strong> refuse while this account is unavailable
              {shared ? ` — ${data.botsOnSymbol} active bots trade it.` : '.'}{' '}
              The alert <em>&quot;MT5 Bridge(s) Down&quot;</em> carries the same fact for every
              affected symbol.
            </p>
          )}
          {currentCantTrade && (
            <p className={styles.routeWarn}>
              ⚠️ The current broker&apos;s own symbol list reports <code>tradeMode=0</code> for{' '}
              {bot.symbol} — orders will be refused at dispatch (#1002). Re-select a broker below.
            </p>
          )}

          {shared && (
            <p className={styles.sectionNote}>
              <strong>Shared route.</strong> {data.botsOnSymbol} active bots trade {bot.symbol};
              routing is per symbol, not per bot, so a re-select moves all of them.
            </p>
          )}

          {selectable.length > 0 && (
            <div className={styles.routeControls}>
              <label className={styles.routeLabel} htmlFor="route-target">Re-select broker</label>
              <select
                id="route-target"
                className={styles.routeSelect}
                value={target}
                onChange={(e) => { setTarget(e.target.value); setConfirming(false); setOutcome(null); }}
              >
                <option value="">Choose…</option>
                {selectable.map((b) => (
                  <option key={b.brokerId} value={b.brokerId} disabled={b.canTrade === false}>
                    broker {b.brokerId} — {b.server && b.server !== '?' ? b.server : 'unknown server'}
                    {' · '}{b.reachable && b.connected ? 'connected' : 'unreachable'}
                    {b.canTrade === false ? ' · CANNOT trade this symbol' : b.canTrade === true ? ' · can trade' : ' · capability unknown'}
                  </option>
                ))}
              </select>
              {target !== '' && !confirming && (
                <button type="button" className={styles.routeBtn} onClick={() => setConfirming(true)}>
                  Re-route…
                </button>
              )}
            </div>
          )}

          {confirming && (
            <div className={styles.routeConfirm}>
              <p>
                Re-route <strong>{bot.symbol}</strong> to broker <strong>{target}</strong>?{' '}
                {shared
                  ? ` Orders for ${data.botsOnSymbol} active bots will move.`
                  : ' Orders for this symbol will move.'}{' '}
                The old row is disabled, not deleted — switch back at any time.
              </p>
              <div className={styles.routeControls}>
                <button type="button" className={styles.routeBtnPrimary} disabled={busy} onClick={doSwitch}>
                  {busy ? 'Re-routing…' : 'Confirm re-route'}
                </button>
                <button type="button" className={styles.routeBtn} disabled={busy} onClick={() => setConfirming(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {outcome && (
            <p className={outcome.ok ? styles.routeOk : styles.routeErr} role="status">{outcome.text}</p>
          )}
          {failure && <NoticeBlock notice={failure} />}
        </>
      )}
    </section>
  );
}

export default function ViewStrategyPage() {
  const { strategyId } = useParams();
  // ── One view, two modes (#985 §2) ─────────────────────────────────────────────────────────────
  // ⚠️ DECLARED HERE, WITH THE OTHER HOOKS — NOT DOWN BY THE RENDER. This component returns early
  // for the no-id / loading / error / not-found states, so a hook placed below those returns is
  // called CONDITIONALLY. eslint caught exactly that (`react-hooks/rules-of-hooks`), and React
  // would then have thrown "Rendered more hooks than during the previous render" on the loading →
  // loaded transition — i.e. on every successful load of this page.
  //
  // Default is `full`. The parameter is opt-in so an inbound link or a bookmark keeps the complete
  // record — see the MODES note in the file header for why that default is the safe one.
  const [searchParams] = useSearchParams();
  const settingsOnly = searchParams.get('view') === 'settings';
  const navigate = useNavigate();

  // The bot's values.
  const botQuery = useQuery({
    queryKey: ['bot', strategyId],
    queryFn: () => apiGet(`${TRADING}/${strategyId}`),
    enabled: Boolean(strategyId),
    refetchInterval: 30_000,
  });

  // The declarations. Shipped in backend code, so refetching buys nothing.
  const rulesQuery = useQuery({
    queryKey: ['bot-rules'],
    queryFn: () => apiGet(`${TRADING}/bot-rules`),
    staleTime: Infinity,
    refetchInterval: false,
  });

  // Subscriptions. `role` is here, NOT on the bot row.
  const subsQuery = useQuery({
    queryKey: ['bot-subs', strategyId],
    queryFn: () => apiGet(`${TRADING}/${strategyId}/protocols`),
    enabled: Boolean(strategyId),
    refetchInterval: 30_000,
  });

  // The realised record (#894). `['bot-performance']` is the SAME key the A/B page's table uses,
  // so both surfaces share ONE fetch. Slower refetch than the bot row: this is a portfolio-wide
  // aggregation that only changes when a trade closes.
  const perfQuery = useQuery({
    queryKey: ['bot-performance'],
    queryFn: () => apiGet(BOT_PERF),
    enabled: Boolean(strategyId),
    refetchInterval: 60_000,
  });

  // The EXIT-MANAGEMENT layer (#936). Deliberately a SEPARATE fetch from `bot-rules`, because it
  // is a different kind of thing: this behaviour is NOT a column on `trading_strategy`. One
  // `StopGuardianService` serves every position on every bot, so nothing here is set on this bot.
  //
  // ⚠️ No `staleTime: Infinity` here, unlike `bot-rules`. This payload has a LIVE half —
  // `guardedPositions` and `recentAdjustments` change every tick — so caching it would render a
  // stale "what the guardian is doing" beside a fresh "what the guardian is", which is the
  // disagreement this page exists to prevent.
  const guardianQuery = useQuery({
    queryKey: ['stop-guardian-status'],
    // ⚠️ `/api/...` IS REQUIRED (§988). This called `/automation/stop-guardian/status` without the
    // prefix, so it 404'd on every load — `VITE_API_BASE_URL` is the host WITHOUT `/api`, and this
    // page's other calls use the `TRADING` constant precisely for that. The failure was INVISIBLE:
    // a 404 produced no error notice here, so the section simply rendered as if the guardian had
    // nothing to say. Verified against the live API: with the prefix it returns 200 and 12 rules.
    queryFn: () => apiGet('/api/automation/stop-guardian/status'),
    refetchInterval: 30_000,
  });

  const bot = botQuery.data || null;
  const botName = bot?.name ?? null;
  const rules = useMemo(
    () => (Array.isArray(rulesQuery.data?.all) ? rulesQuery.data.all : []),
    [rulesQuery.data],
  );
  const counts = rulesQuery.data?.counts || null;
  const subs = Array.isArray(subsQuery.data) ? subsQuery.data : [];

  // ── #1051 criterion 7 — THE EXIT CHAIN, for THIS bot ────────────────────────────────────
  //
  // The guardian block below answers "what MECHANISMS manage this bot's stop". This answers the
  // other half: "what does the evidence say about the positions it is holding right now" — the
  // verdict of `ExitConsensusService` over the exit directives. Both were asked for, and they are
  // different questions: a mechanism can be declared and still return HOLD on every position.
  //
  // ⚠️ Filtered SERVER-side by bot NAME (`?bot=`). `assessment.bot` is the bot's name
  // (`bot?.name ?? null`), not its id, and pulling the whole pool onto one bot's page invites the
  // reader to attribute another bot's verdict to this one.
  //
  // ⚠️ ADVISORY ONLY. Nothing acts on `action` yet — see the endpoint's header and register row 45.
  // The panel says so, because a page that shows "EXIT" beside a live position reads as an
  // instruction unless it is told otherwise.
  const exitChainQuery = useQuery({
    queryKey: ['exit-consensus', botName],
    queryFn: () => apiGet(`/api/scoring/exit-consensus${botName ? `?bot=${encodeURIComponent(botName)}` : ''}`),
    enabled: Boolean(botName),
    refetchInterval: 30_000,
  });
  const exitChain = Array.isArray(exitChainQuery.data?.assessments) ? exitChainQuery.data.assessments : [];
  // ⚠️ `poolTotal` is the denominator. Without it an empty list cannot be told apart from a failed
  // broker read — `assessAll()` returns [] for both, and a blank panel reads as "nothing open".
  const exitPoolTotal = exitChainQuery.data?.poolTotal ?? null;
  // ⚠️ #1044-class defect — `poolTotal` alone is NOT enough. Measured 2026-10-01: `getPositions()`
  // threw (`... is not a function`), the catch swallowed it and `assessAll()` returned `[]`, so
  // BOTH count and poolTotal were 0 and the page said "No open positions" while **11 positions
  // were live**. A thrown error yields a real status; a SWALLOWED one does not. `readOk` is that
  // status, and `false` must render as a failure, never as an empty book.
  const exitReadOk = exitChainQuery.data?.readOk ?? null;
  const exitReadError = exitChainQuery.data?.readError ?? null;

  // ── The exit-management layer, split into its two halves ──────────────────────────────────
  // The DECLARATIONS (what the mechanism is) and the LIVE STATE (what it is doing) arrive in one
  // response on purpose: a list of stop edits with no statement of the rule that produced them is
  // the "value without its enforcement" defect, and they cannot drift if they share one payload.
  const guardianRules = Array.isArray(guardianQuery.data?.rules) ? guardianQuery.data.rules : [];
  const gState = guardianQuery.isError ? null : (guardianQuery.data || null);

  // ⚠️ Matched on `strategyId`, NEVER on symbol. Two bots can be subscribed to the same symbol, and
  // a symbol match would silently attribute another bot's position to this one — the same
  // attribution rule the realised record above follows.
  const guardedMine = Array.isArray(gState?.guardedPositions)
    ? gState.guardedPositions.filter((p) => p.strategyId === strategyId)
    : [];

  // The recorded stop edits for this bot's symbol. In-memory (last 50) rather than a query, so it
  // is labelled with its window on screen — a count with no window reads as a total.
  const adjustmentsMine = Array.isArray(gState?.recentAdjustments)
    ? gState.recentAdjustments.filter((a) => a.symbol === bot?.symbol)
    : [];

  // Match by `botId`, NEVER by name — a name match is a guess, and #894's own rule is that an
  // attribution which cannot be justified is worse than none. A missing row is a real zero
  // (nothing attributed), which is a DIFFERENT state from a failed read (see BotRecord).
  const perfRow = Array.isArray(perfQuery.data?.bots)
    ? perfQuery.data.bots.find((r) => r.botId === strategyId) || null
    : null;

  /**
   * The headline number: rules set to a value that expresses an intention the engine ignores.
   *
   * This is the finding the page exists to surface. A configured-but-unenforced rule is worse than
   * an unconfigured one, because the person who set it believes it is working.
   */
  const dormant = useMemo(
    () => (bot ? rules.filter((r) => isDormant(r, bot[r.field])) : []),
    [rules, bot],
  );

  /** Every configured non-live rule, including the labels and switched-off flags `dormant` filters
   *  out. Kept separate so the narrower headline never hides a fact — the rows show it either way. */
  const configuredNotLive = useMemo(
    () => (bot ? rules.filter((r) => isConfigured(bot[r.field]) && r.enforcement !== 'live') : []),
    [rules, bot],
  );

  // One grouping implementation, shared with the lifecycle diagram (`bot-stage-path.js`). This was
  // inlined here while the page was the only consumer; two copies would agree today and drift at
  // the next fix, and the diagram's node order depends on this being the same order.
  const groups = useMemo(
    () => groupRulesByStage(rules).map((g) => [g.stage, g.rules]),
    [rules],
  );

  // ── WHO READS EACH COLUMN — the ONE axis this page was missing (2026-09-28) ─────────────
  //
  // ⚠️ WHY THIS EXISTS. `bot-rules.ts` and `GUARDIAN_RULES` are two declarations of ONE subject,
  // and this page rendered them as two INDEPENDENT lists. The cost, measured on the owner's own
  // bot: Simulated TSL appeared as THREE loose rows under "Exit" *and* again as a mechanism under
  // "Exit management", while the exhaustion observer was attributed to the guardian by
  // `bot-rules.ts` and declared by `GUARDIAN_RULES` NOWHERE — so it showed in one list and was
  // missing from the other. Two lists, grouped on different axes (stage vs owner), so NEITHER was
  // complete and nothing compared them.
  //
  // The link is `fields` (the columns a mechanism reads, added to `GuardianRule` the same day) and
  // `nest/scripts/validate-rule-enforcement.cjs` keeps the two registries honest at build time, so
  // this render cannot drift back into disagreement.
  const mechanismByField = useMemo(() => {
    const m = new Map();
    for (const gr of guardianRules) for (const f of gr.fields || []) m.set(f, gr);
    return m;
  }, [guardianRules]);

  /** The mechanism that owns a column, plus whether this is the FIRST column of that mechanism —
   *  so the mechanism's detail and caveat are stated ONCE, beside its first column, instead of
   *  being repeated on every one of them. */
  const exitMechanismFor = useMemo(() => {
    const firstSeen = new Set();
    const out = new Map();
    for (const rule of rules) {
      const mech = mechanismByField.get(rule.field);
      if (!mech) continue;
      const isFirst = !firstSeen.has(mech.id);
      if (isFirst) firstSeen.add(mech.id);
      out.set(rule.field, { mech, isFirst });
    }
    return out;
  }, [rules, mechanismByField]);

  // ⚠️ The PER-BOT mechanisms are rendered WITH their columns above, so rendering them again here
  // would re-create the very duplication this change removes. This section keeps the GLOBAL half:
  // the one implementation that serves every bot and is set on none of them.
  const globalGuardianRules = useMemo(
    () => guardianRules.filter((gr) => gr.scope !== 'per-bot'),
    [guardianRules],
  );

  // ⚠️ Declared with the other hooks, ABOVE the early returns below - a hook after a conditional
  // return breaks the Rules of Hooks.
  //
  // ⚠️ THE DEP ARRAY IS LOAD-BEARING, and `[groups]` alone was WRONG. `groups` fills in as soon as
  // `bot-rules` resolves, which can happen while this component is still rendering the LOADING
  // branch - and that branch had no `ref`, so the effect ran, found `revealRef.current === null`,
  // and returned. When the bot query then resolved and the real page mounted, `groups` had not
  // changed, so the effect did NOT re-run and nothing was ever observed: 5 of 7 groups stayed at
  // `opacity: 0` permanently. `bot` changes null -> object exactly when the content mounts, so it
  // closes the race. Re-runs are cheap - the hook skips anything already flagged `dataset.revealed`.
  const revealRef = useRef(null);
  useScrollReveal(revealRef, [groups, bot]);

  if (!strategyId) {
    return (
      <main className={styles.page} ref={revealRef}>
        <p className={styles.empty}>No bot selected — this view needs a bot id in the URL.</p>
      </main>
    );
  }

  if (botQuery.isLoading || rulesQuery.isLoading) {
    return (
      <main className={styles.page} ref={revealRef}>
        <p className={styles.empty}>Loading bot…</p>
      </main>
    );
  }

  /**
   * ⚠️ STOP HERE IF THE DECLARATIONS ARE UNAVAILABLE.
   *
   * Without `bot-rules` this page cannot state which rules apply — and rendering the bot's values
   * without enforcement information is EXACTLY the defect being fixed: a convincing surface that
   * implies every field works. A check that cannot read its input must ERROR, never pass.
   */
  if (rulesQuery.isError || (rulesQuery.isSuccess && rules.length === 0)) {
    return (
      <main className={styles.page}>
        <div className={styles.errorBox}>
          <strong>Cannot show this bot&apos;s truth view.</strong>
          <p className={styles.summaryText}>
            The rule declarations at <code>GET {TRADING}/bot-rules</code> could not be read, so there
            is no way to say which of this bot&apos;s fields actually apply. Showing the values
            without them would imply every field works, which is the failure this view exists to
            prevent.
          </p>
        </div>
      </main>
    );
  }

  if (botQuery.isError || (botQuery.isSuccess && !bot)) {
    return (
      <main className={styles.page}>
        <div className={styles.errorBox}>
          {/* ⚠️ "NOT FOUND" AND "REQUEST FAILED" ARE DIFFERENT FACTS, and collapsing them is
              how this page lied. Found 2026-09-18 with the API stopped: because `bot-rules` is
              cached with `staleTime: Infinity`, that query stayed SUCCESSFUL while the bot query
              failed - so this branch ran and the page announced "Bot not found" for a bot that
              exists in the database. An operator reading that would go looking for a deleted bot.
              A failed request must say it failed, and must say the bot was NOT deleted. */}
          <strong>{botQuery.isError ? 'Could not load this bot' : 'Bot not found'}</strong>
          <p className={styles.summaryText}>
            {botQuery.isError ? (
              <>
                The request for <code>{strategyId}</code> did not complete, so this view cannot say
                whether the bot exists. <strong>Nothing has been deleted or disabled by this</strong> -
                check the API is running and reload.
              </>
            ) : (
              <>
                <code>{strategyId}</code> resolved to nothing. The request succeeded, so this bot
                genuinely does not exist.
              </>
            )}
          </p>
        </div>
      </main>
    );
  }

  const total = rules.length;
  const liveCount = counts?.live ?? rules.filter((r) => r.enforcement === 'live').length;
  const declaredNotLive = total - liveCount;

  return (
    <main className={styles.page} ref={revealRef}>
      <header className={styles.header}>
        {/* ⚠️ THE LABEL AND THE DESTINATION NOW AGREE, and the DESTINATION was the wrong half.
            This button read "Back to bots" while navigating to `/trading/strategy-monitor` — a
            reader who arrived from Trading Bots landed somewhere the button had not promised.
            Bot Detail is reached from `trading-bots` ("Truth view — all 29 rules + enforcement"),
            and `docs/trading-bot-model.md` §1b rule 3 names Trading Bots as the execution layer,
            so this is where "back to bots" belongs. */}
        <button type="button" className={styles.back} onClick={() => navigate('/trading/trading-bots')}>
          ← Back to bots
        </button>

        <div className={styles.titleRow}>
          <h1 className={styles.title}>{bot.name}</h1>
          <div className={styles.chips}>
            <span className={`${styles.chip} ${bot.active ? styles.chipLive : styles.chipNone}`}>
              {bot.active ? 'ACTIVE' : 'INACTIVE'}
            </span>
            <span className={`${styles.chip} ${styles.chipDisplay}`}>{bot.mode}</span>
          </div>
        </div>

        <p className={styles.identity}>
          {bot.symbol} · broker {bot.brokerId} · tf {bot.timeframe} · v{bot.version}
          {bot.description ? ` · ${bot.description}` : ''}
        </p>

        {/* The switch lives IN the view, and both sides are real links rather than a toggle, so
            the URL is always the truth of what is on screen and either mode can be shared.
            `aria-pressed` carries the state for a screen reader — the accent border alone would
            make the active mode a colour-only signal. */}
        <div className={styles.modeSwitch} role="group" aria-label="View mode">
          <button
            type="button"
            className={`${styles.modeBtn} ${settingsOnly ? '' : styles.modeBtnOn}`}
            aria-pressed={!settingsOnly}
            onClick={() => navigate(`/trading/strategy/${strategyId}`)}
          >
            Full — rules + enforcement
          </button>
          <button
            type="button"
            className={`${styles.modeBtn} ${settingsOnly ? styles.modeBtnOn : ''}`}
            aria-pressed={settingsOnly}
            onClick={() => navigate(`/trading/strategy/${strategyId}?view=settings`)}
          >
            Settings only
          </button>
        </div>

        {settingsOnly && (
          <p className={styles.identity}>
            Showing <strong>what this bot is configured to do</strong>. The full view adds the
            enforcement tally, the per-row reasoning, the lifecycle picture, the realised record
            and the undeclared-column check.
          </p>
        )}
      </header>

      {/* WHERE THE BOT'S ORDERS ACTUALLY GO — the account is chosen per SYMBOL (symbol_route),
          not per bot, and nothing on this page said which bridge fills them or how to move them
          (owner, 2026-10-11: "no way to re-select a broker"). Mt5-venue bots only; a bot on
          another venue does not travel through `symbol_route` at all. */}
      {bot.brokerId === 'mt5' && <RouteAccountPanel bot={bot} />}

      {/* The headline. Read before a single rule — this is the number that decides whether the
          bot's configuration can be trusted. AUDIT ONLY: settings mode keeps the per-row chip, so
          the fact survives without the tally. */}
      {!settingsOnly && (
      <section className={`${styles.summary} ${dormant.length === 0 ? styles.summaryClean : ''}`}>
        <div className={styles.summaryCell}>
          <span className={styles.summaryValue}>{liveCount}</span>
          <span className={styles.summaryLabel}>can affect a trade</span>
        </div>
        <div className={styles.summaryCell}>
          <span className={styles.summaryValue}>{declaredNotLive}</span>
          <span className={styles.summaryLabel}>declared, not live</span>
        </div>
        <div className={styles.summaryCell}>
          <span className={styles.summaryValue}>{dormant.length}</span>
          <span className={styles.summaryLabel}>SET HERE AND IGNORED</span>
        </div>
        <p className={styles.summaryNote}>
          {dormant.length > 0
            ? `${dormant.length} rule(s) hold a value the engine ignores: ${dormant
                .map((r) => `${r.field}=${formatValue(bot[r.field]).text}`)
                .join(', ')}.`
            : 'Every rule set on this bot is applied.'}
        </p>
        {configuredNotLive.length > dormant.length && (
          <p className={styles.summaryNote}>
            {configuredNotLive.length - dormant.length} more unenforced field(s) are set but not
            counted above, because they are identity labels (<code>name</code>, <code>version</code>)
            or a boolean left <code>false</code> — configured, and not ignored. They are marked on
            their own rows.
          </p>
        )}
      </section>
      )}

      {/* The REALISED record — what the bot has actually done, from its own closed trades.
          Sits between the configuration headline and the lifecycle picture so the two halves of
          "is this bot trustworthy" are adjacent: what it is ALLOWED to do, then what it DID.
          AUDIT ONLY: a record of PAST OUTCOMES is not configuration. */}
      {!settingsOnly && <BotRecord query={perfQuery} row={perfRow} />}

      {/* The lifecycle picture. Sits directly under the headline because it is the index to the
          grouped list below: a stage with nothing declared shows as a bare node here, and the
          reader can see WHICH stage is missing before scrolling to look for it.
          AUDIT ONLY: it reports which stages are MISSING, which is a completeness finding. */}
      {!settingsOnly && <BotLifecyclePath bot={bot} rules={rules} />}

      {/* Role — the direction permission. It lives on the SUBSCRIPTION, not on the bot row, which
          is why a per-bot page rendering only `trading_strategy` columns misses it entirely. It was
          unread by the routing query until 2026-09-17, so a short-only bot received long signals
          with no direction constraint at all. */}
      <section className={styles.group}>
        <h2 className={styles.groupHead}>
          Direction permission
          <span className={styles.groupCount}>
            <code>strategy_protocol.role</code>
          </span>
        </h2>
        {subs.length === 0 ? (
          <p className={styles.subEmpty}>
            No protocol subscription — this bot has no signal source and will never trade. Routing
            joins <code>strategy_protocol</code>, so a bot without a subscription is silently idle.
          </p>
        ) : (
          <div className={styles.subList}>
            {subs.map((sub) => (
              <div key={sub.id} className={styles.sub}>
                <span className={styles.subName}>{sub.protocolId}</span>
                <span className={`${styles.chip} ${sub.role === 'short' ? styles.chipNone : styles.chipLive}`}>
                  {String(sub.role || 'unset').toUpperCase()}
                </span>
                {!sub.role && (
                  <p className={styles.caveat}>
                    ⚠️ No role set, so direction falls back to the bot&apos;s <code>requireDirection</code>.
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
        <p className={styles.sectionNote}>
          <strong>Read-only here.</strong> There is no <code>PATCH</code> endpoint for a subscription —
          changing a role means remove + re-add, and a failure between those two calls leaves the bot
          with no signal source, which it would not report. Edit it on{' '}
          <a className={styles.link} href="/trading/strategy-monitor">Strategy Monitor</a>, where the
          add/remove path already lives.
        </p>
      </section>

      {/* Every declared rule, grouped by the stage of a trade's life it acts on. */}
      {groups.map(([stage, stageRules]) => (
        <section key={stage} className={`${styles.group} lad-reveal`}>
          <h2 className={styles.groupHead}>
            {STAGE_LABEL[stage] || stage}
            <span className={styles.groupCount}>{stageRules.length} rules</span>
          </h2>

          {/* ── THE MECHANISMS ACTING HERE — and the precedence that is NOT declared (2026-09-28) ──

              ⚠️ WHY THIS IS A TABLE AND NOT A DIAGRAM OF ARROWS. The owner asked for the steps an
              algorithm can take to be visible. Measured: they are NOT all visible, and the honest
              reason is that **no execution ORDER is declared anywhere**. `bot-rules.ts` orders rules
              by STAGE, `GUARDIAN_RULES` orders mechanisms by its own array, and neither is a runtime
              sequence — the guardian tightens, the time-stop closes on age, and the observers record,
              all independently. Drawing arrows would depict an ordering that does not exist, which is
              the same defect as a stage shown for a mechanism that was never built.

              ⚠️ ONE precedence IS real and enforced, and it is named below rather than drawn from
              the layout: `declared-distance-floor` (#927) — a tighten may never leave the stop closer
              to the price than the bot's own `slPct`. That is a genuine ordering between two owners,
              and it is the only one this surface can state as fact today.

              ⚠️ Mechanisms, not rules: this is the same `mechanismByField` link the rows below use,
              so a mechanism cannot appear here and not there. Derived, never hand-listed. */}
          {(() => {
            const mechs = [];
            const seen = new Set();
            for (const r of stageRules) {
              const o = exitMechanismFor.get(r.field);
              if (!o || seen.has(o.mech.id)) continue;
              seen.add(o.mech.id);
              mechs.push({ mech: o.mech, fields: (o.mech.fields || []).filter((f) => stageRules.some((x) => x.field === f)) });
            }
            if (!mechs.length) return null;
            return (
              <div className={styles.sectionNote}>
                <p>
                  <strong>{mechs.length} mechanism(s) act on this stage</strong> — listed by owner. The
                  engine runs these independently; <strong>no precedence between them is declared</strong>,
                  so this is a set, not a sequence. A declared order is a design decision that has not
                  been made (see #990).
                </p>
                <ul>
                  {mechs.map(({ mech, fields }) => (
                    <li key={mech.id}>
                      <code className={styles.fieldCode}>{mech.id}</code>{' '}
                      — <strong>{mech.label}</strong>
                      {' · '}
                      {mech.enforcement === 'live'
                        ? 'LIVE — the engine acts'
                        : mech.enforcement === 'display-only'
                          ? 'OBSERVES ONLY — records, acts on nothing'
                          : `NOT APPLIED (${mech.enforcement})`}
                      {' · '}
                      {mech.scope === 'per-bot' ? 'per-bot settings' : 'global — shared by every bot'}
                      {fields.length ? ` · reads ${fields.map((f) => `\`${f}\``).join(', ')}` : ''}
                    </li>
                  ))}
                </ul>
                <p>
                  ⚠️ <strong>The one ordering that IS enforced:</strong>{' '}
                  <code className={styles.fieldCode}>declared-distance-floor</code> (#927) — a tighten
                  may never leave the stop closer to price than this bot&apos;s own declared stop
                  distance. It was added after seven positions closed inside 28 minutes on stops
                  trailed to ~0.03% against a declared ~1%.
                </p>
              </div>
            );
          })()}

          <ul className={styles.subList}>
            {stageRules.map((rule) => {
              // ⚠️ An unrecognised level must NOT render as if it applies.
              const meta = ENFORCEMENT[rule.enforcement] || {
                ...UNDECLARED,
                word: String(rule.enforcement || 'UNKNOWN').toUpperCase(),
                hint: 'Unrecognised enforcement level — treat as NOT applied.',
              };
              const raw = bot[rule.field];
              const value = formatValue(raw);
              const configured = isConfigured(raw);
              const isNotLive = rule.enforcement !== 'live';
              const owner = exitMechanismFor.get(rule.field) || null;

              return (
                <li
                  key={rule.field}
                  className={`${styles.rule} ${rule.enforcement === 'none' ? styles.ruleDead : ''} ${
                    rule.enforcement === 'legacy-only' || rule.enforcement === 'display-only'
                      ? styles.ruleUnenforced
                      : ''
                  }`}
                >
                  <span className={styles.field}>
                    {rule.label}
                    <code className={styles.fieldCode}>{rule.field}</code>
                  </span>

                  <span
                    className={`${styles.value} ${value.unset ? styles.valueUnset : ''} ${
                      value.strong ? styles.valueTrue : ''
                    }`}
                  >
                    {value.text}
                  </span>

                  <span className={`${styles.chip} ${styles[meta.chip]}`}>{meta.word}</span>

                  {/* ⚠️ WHICH MECHANISM READS THIS COLUMN (2026-09-28). Stated on EVERY row, not
                      only the first, because "who acts on this" is a property of the row — and
                      stated OUTSIDE the settingsOnly guard, because it is structural rather than
                      explanatory. `scope` is the load-bearing word: `per-bot` means this bot's
                      own value; `global` means one implementation shared by every position. */}
                  {owner && (
                    <p className={styles.caveat}>
                      Read by the <strong>{owner.mech.label}</strong> mechanism
                      {owner.mech.scope === 'per-bot'
                        ? ' (per-bot — set on this bot)'
                        : ' (global — shared by every bot, set on none of them)'}
                      .
                    </p>
                  )}

                  <p className={styles.summaryText}>{rule.summary}</p>

                  {/* The enforcement hint is ALWAYS shown for a non-live rule — never only on
                      hover. A tooltip is invisible to a reader who does not go looking, and the
                      whole defect is a rule that reads as applied.
                      ⚠️ SUPPRESSED IN SETTINGS MODE, and the chip is NOT: the verdict stays on
                      screen, only the explanation goes. Removing the chip too would leave someone
                      tuning a bot believing every field they set is applied. */}
                  {/* The mechanism's own reasoning, stated ONCE, on the first of its columns. The
                      columns keep their independence; the mechanism is not repeated per row. */}
                  {!settingsOnly && owner && owner.isFirst && (
                    <p className={styles.caveat}>
                      <strong>{owner.mech.label}</strong> — {owner.mech.detail}
                    </p>
                  )}
                  {!settingsOnly && owner && owner.isFirst && owner.mech.caveat && (
                    <p className={styles.caveat}>{owner.mech.caveat}</p>
                  )}

                  {!settingsOnly && isNotLive && <p className={styles.caveat}>{meta.hint}</p>}

                  {!settingsOnly && rule.caveat && <p className={styles.caveat}>{rule.caveat}</p>}

                  {/* AC6 — the two states named explicitly, beside the value. */}
                  {!settingsOnly && configured && isNotLive && (
                    <p className={styles.caveat}>
                      ⚠️ This field IS set on this bot, and the automation loop does not apply it.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {/* ── EXIT MANAGEMENT (post-entry) — #936 ────────────────────────────────────────────
          ⚠️ WHY THIS SECTION IS HERE, BESIDE THE EXIT STAGE ABOVE.
          The Exit stage above lists every EXIT column this bot has. Those are set once, at entry
          (`slPct`, `tpPct`) or on a schedule (`maxHoldHours`); the mechanism that actually
          MANAGES the stop afterwards — and therefore the thing that locks in profit — is
          `StopGuardianService`, which is not a column on `trading_strategy` and so appeared
          NOWHERE on this page. Measured 2026-09-24: a reader could study this bot's entire exit
          configuration and still not know that a trailing tighten will move its stop, on what
          evidence, how far, or how often.

          ⚠️ CORRECTED 2026-09-28. This comment used to say the Exit stage "lists this bot's EXIT
          columns: `slPct`, `tpPct`, `maxHoldHours`" — THREE. It lists NINE, across three owners
          (`automation-loop`, `position-time-stop`, `stop-guardian`) plus one nothing owns. The
          three named are only the ones this section's author happened to look at, which is how a
          reader was told a partial set was the whole set.

          ⚠️ RENDERED AS GLOBAL, NOT AS THIS BOT'S SETTINGS, and that is the honest reading. There
          is no per-bot stop-management configuration in the schema for these. Showing them as if
          they were this bot's values would be the same "value without its enforcement" defect in
          reverse. The `per-bot` mechanisms are NOT repeated here — they are rendered beside the
          columns they read, in the Exit stage above, because one subject in two places is the
          duplication this page was fixed to remove. */}
      {!settingsOnly && (
        <section className={styles.group}>
          <h2 className={styles.groupHead}>
            Exit management — global mechanisms
            <span className={styles.groupCount}>
              <code>StopGuardianService</code>
            </span>
          </h2>

          {/* ── COVERAGE — WHAT PROTECTS AN OPEN POSITION WHEN THE APP IS NOT RUNNING ────────
              ⚠️ WHY THIS EXISTS (owner, 2026-09-30). Two facts, both learned on the −322.67
              position, neither of them visible anywhere on this page before now:

                1. EVERY mechanism named below runs INSIDE this process. With the PC off there
                   is no management of any open position at all — no trailing, no time-stop, no
                   guardian. The owner had not factored that in, and this page did not say it.
                2. The brakes that DO survive come from places this page never named — the
                   BRIDGE's own caps and the BROKER's SL/TP. One of those, the daily-loss cap,
                   releases at midnight (`mt5_bridge_v2.py:1680`, window
                   `datetime.now().replace(hour=0, …)`).

              ⚠️ A FACT ABOUT THE SYSTEM, NOT ABOUT THIS BOT. Nothing here is a column on
              `trading_strategy`, and that is exactly why it was missing: this page is built FROM
              the bot's own declarations, so the brakes that matter most when the bot cannot act
              are the ones the bot does not declare. A stage stroked red is NOT the same thing as
              an unprotected position, and before this block the page could not tell them apart. */}
          <div className={styles.coverageNotice}>
            <strong>What protects an open position if the app stops</strong>
            <ul className={styles.coverageList}>
              <li>
                <strong>Inside the app</strong> — guardian trailing, time-stop, exhaustion observer
                and the loop&apos;s risk gate. <em>All of these need the app running.</em> With the
                PC off, an open position is <strong>unmanaged</strong>.
              </li>
              <li>
                <strong>In the bridge</strong> — max open positions, max position size, daily-loss
                cap. Enforced outside every app mechanism. ⚠️ The daily-loss cap{' '}
                <strong>resets at midnight</strong>, so it is a brake that lets go.
              </li>
              <li>
                <strong>At the broker</strong> — the SL/TP on the order. The <strong>only</strong>{' '}
                brake that survives the app and the PC being off. ⚠️ It is fixed when the order was
                placed, so a further order adds size <strong>without moving it</strong> — which is
                how one position reached ten times its intended size.
              </li>
            </ul>
          </div>

          {/* ── #1051 criterion 7 — the exit CHAIN's live verdict for this bot ──────────────
              ⚠️ Three states, never two: a failed read, "this bot holds nothing open", and a
              verdict list. `assessAll()` returns [] for a broker-read failure AND for a bot with
              no positions, so the two are separated by `poolTotal` rather than by a blank panel. */}
          <h3 className={styles.groupHead}>What would close these positions — the exit chain</h3>
          {exitChainQuery.isError ? (
            <div className={styles.errorBox}>
              <strong>The exit verdict could not be read.</strong>
              <p className={styles.summaryText}>
                This is a FAILED READ, not &quot;nothing is at risk&quot;. The positions may still be
                open and unmanaged — reload when the API is reachable.
              </p>
            </div>
          ) : !botName ? (
            <p className={styles.sectionNote}>Reading this bot…</p>
          ) : exitReadOk === false ? (
            // ⚠️ This branch is the whole point of `readOk`. Without it this case fell through to
            // the `poolTotal === 0` branch below and rendered as "no open positions anywhere" —
            // a claim about the account, made when we could not see the account.
            <div className={styles.errorBox}>
              <strong>The broker read FAILED — this is not &quot;nothing is open&quot;.</strong>
              <p className={styles.summaryText}>
                {exitReadError || 'The exit assessment could not read broker positions.'} Any open
                positions are still open and unassessed. Reload once the bridge is reachable.
              </p>
            </div>
          ) : exitPoolTotal === 0 ? (
            <p className={styles.sectionNote}>
              No open broker positions exist on <strong>any</strong> bot, so there is nothing for the
              exit chain to assess. (Reported explicitly: an empty verdict list and a failed read
              otherwise look identical.)
            </p>
          ) : exitChain.length === 0 ? (
            <p className={styles.sectionNote}>
              This bot holds <strong>no open positions</strong>. {exitPoolTotal} open position(s)
              exist across other bots — they are deliberately not shown here, because their verdicts
              are not this bot&apos;s.
            </p>
          ) : (
            <>
              <p className={styles.sectionNote}>
                <strong>Advisory only.</strong> Nothing acts on these verdicts yet — no order is
                placed and no stop is moved by them. They are the combination of the exit directives&apos;
                own readings, shown so the chain is inspectable rather than inferred.
              </p>
              <ul className={styles.subList}>
                {exitChain.map((a) => (
                  <li key={`${a.brokerId ?? '?'}-${a.ticket}`} className={styles.rule}>
                    <span className={styles.field}>
                      <code>{a.symbol}</code> {String(a.side || '').toUpperCase()} · ticket {a.ticket}
                      {a.brokerId ? ` · broker ${a.brokerId}` : ''}
                    </span>
                    <div className={styles.summaryText}>
                      <strong>{a.conviction}</strong> → <strong>{a.action}</strong>
                      {' · '}P&amp;L {a.profitPct != null ? `${a.profitPct >= 0 ? '+' : ''}${a.profitPct.toFixed(2)}%` : '—'}
                      {/* ⚠️ `null` means the peak is UNKNOWN and must never render as 0%, which
                          would assert "still at the peak" — a claim about the market, not about
                          our data. */}
                      {' · '}give-back {a.giveBackPct != null ? `${a.giveBackPct.toFixed(2)}%` : 'unknown'}
                      {a.stopInProfit ? ' · stop is IN PROFIT' : ''}
                    </div>
                    {Array.isArray(a.reasons) && a.reasons.length > 0 && (
                      <div className={styles.summaryText}>
                        {a.reasons.slice(0, 3).map((rsn, i) => (
                          <div key={i} className={styles.sectionNote}>· {rsn}</div>
                        ))}
                      </div>
                    )}
                    {Array.isArray(a.verdicts) && a.verdicts.filter((v) => v.arguesExit).length > 0 && (
                      <div className={styles.summaryText}>
                        arguing exit:{' '}
                        {a.verdicts.filter((v) => v.arguesExit)
                          .map((v) => `${v.name} (${v.arguesExitVia ?? 'n/a'})`)
                          .join(', ')}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}

          {guardianQuery.isError ? (
            <div className={styles.errorBox}>
              <strong>The exit-management declarations could not be read.</strong>
              <p className={styles.summaryText}>
                Whatever manages this bot&apos;s stop after entry is unknown from here. This is NOT
                the same as &quot;nothing does&quot; — reload when the API is reachable. It is stated
                rather than hidden because a blank section would read as a bot with no exit
                management, which may be false.
              </p>
            </div>
          ) : guardianRules.length === 0 ? (
            <p className={styles.sectionNote}>Reading the guardian declarations…</p>
          ) : globalGuardianRules.length === 0 ? (
            <p className={styles.sectionNote}>
              No GLOBAL guardian mechanisms are declared. The guardian&apos;s per-bot mechanisms are
              listed above beside the columns they read.
            </p>
          ) : (
            <>
              <p className={styles.sectionNote}>
                <strong>These {globalGuardianRules.length} mechanisms serve every position on every
                bot.</strong> They are set on none of them — this bot&apos;s exit configuration does
                not include them, and there is no column to change. The guardian&apos;s{' '}
                <strong>per-bot</strong> mechanisms are listed above beside the columns they read,
                not repeated here.
              </p>

              <ul className={styles.subList}>
                {globalGuardianRules.map((gr) => {
                  const isLive = gr.enforcement === 'live';
                  return (
                    <li
                      key={gr.id}
                      className={`${styles.rule} ${isLive ? '' : styles.ruleDead}`}
                    >
                      <span className={styles.field}>
                        {gr.label}
                        <code className={styles.fieldCode}>{gr.id}</code>
                      </span>

                      <span className={`${styles.value} ${isLive ? styles.valueTrue : styles.valueUnset}`}>
                        {gr.value}
                      </span>

                      <span className={`${styles.chip} ${isLive ? styles.chipLive : styles.chipNone}`}>
                        {isLive ? 'LIVE' : 'NOT APPLIED'}
                      </span>

                      <p className={styles.summaryText}>{gr.detail}</p>

                      {/* ⚠️ A non-live entry MUST carry its caveat on screen, never in a tooltip: the
                          whole defect is a mechanism that reads as working. This is the row that names
                          the sim-TSL gap. */}
                      {gr.caveat && <p className={styles.caveat}>{gr.caveat}</p>}
                    </li>
                  );
                })}
              </ul>

              {/* ── The LIVE half: what the guardian is actually doing, right now ── */}
              <p className={styles.sectionNote}>
                {gState ? (
                  <>
                    Guardian is <strong>{gState.enabled ? 'RUNNING' : 'STOPPED'}</strong>
                    {gState.lastTickAt
                      ? `, last tick ${new Date(gState.lastTickAt).toLocaleTimeString()}`
                      : ', no tick yet'}
                    {`, ${gState.tickCount ?? 0} tick(s) this session.`}{' '}
                    {guardedMine.length > 0
                      ? `${guardedMine.length} position(s) on ${bot.symbol} are guarded.`
                      : `No open position on ${bot.symbol} is currently guarded — a real zero if the ` +
                        'guardian is running, not a failed read.'}
                  </>
                ) : (
                  'Reading the guardian\u2019s live state…'
                )}
              </p>

              {guardedMine.length > 0 && (
                <ul className={styles.subList}>
                  {guardedMine.map((p) => {
                    const above = p.stopConfidence >= 55;
                    return (
                      <li key={p.ticket} className={styles.rule}>
                        <span className={styles.field}>
                          #{p.ticket}
                          <code className={styles.fieldCode}>{p.side}</code>
                        </span>
                        <span className={styles.value}>
                          {p.currentSl ?? 'no stop'} → recommends {p.recommendedSl ?? 'hold'}
                        </span>
                        <span className={`${styles.chip} ${above ? styles.chipLive : styles.chipNone}`}>
                          consensus {p.stopConfidence}
                        </span>
                        <p className={styles.summaryText}>
                          {above
                            ? 'At or above the ≥ 55 consensus, so an edit to this stop may be sent.'
                            : 'Below the ≥ 55 consensus, so no edit is sent for this position.'}
                          {p.wickFilterPassed === false
                            ? ' The wick filter vetoed this tick — a fakeout was detected, so the position was skipped.'
                            : ''}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              )}

              {adjustmentsMine.length > 0 && (
                <p className={styles.sectionNote}>
                  <strong>{adjustmentsMine.length} stop edit(s)</strong> recorded for {bot.symbol} in
                  the guardian&apos;s most recent adjustments (a rolling in-memory window, not a
                  total — the durable audit trail is <code>stop_adjustment</code>). Latest:{' '}
                  {adjustmentsMine[0].oldSl ?? 'none'} → {adjustmentsMine[0].newSl} at{' '}
                  {new Date(adjustmentsMine[0].timestamp).toLocaleTimeString()}.
                </p>
              )}

              {gState?.lastBridgeRefusal && (
                <p className={styles.caveat}>
                  ⚠️ The last stop edit was <strong>refused by the broker</strong> at{' '}
                  {new Date(gState.lastBridgeRefusal.at).toLocaleTimeString()} —{' '}
                  {gState.lastBridgeRefusal.detail.slice(0, 160)}. A refusal is honest (a closed
                  market refuses every edit) but it means no stop was placed for that position.
                </p>
              )}
            </>
          )}
        </section>
      )}

      {/* Columns on the row that no declaration covers. Should be empty — the backend build fails
          if a behavioural column is undeclared. Shown when it is NOT empty, because that is a real
          finding: a column that reached the database with no declared enforcement status. */}
      {!settingsOnly && (() => {
        const declared = new Set(rules.map((r) => r.field));
        const undeclared = Object.keys(bot).filter((k) => !declared.has(k) && !NON_RULE_FIELDS.has(k));
        if (undeclared.length === 0) return null;
        return (
          <section className={styles.group}>
            <h2 className={styles.groupHead}>Undeclared columns</h2>
            <div className={styles.errorBox}>
              These fields exist on the bot but have no entry in the rule declarations, so their
              enforcement status is unknown and they are NOT rendered as rules:{' '}
              <code>{undeclared.join(', ')}</code>. The backend build is supposed to fail on this.
            </div>
          </section>
        );
      })()}
    </main>
  );
}
