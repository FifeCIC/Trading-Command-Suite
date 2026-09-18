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
 * DATA
 * ----
 *   GET /api/trading/strategies/:id            — the bot's values (the row)
 *   GET /api/trading/strategies/bot-rules      — the declarations (the truth about the values)
 *   GET /api/trading/strategies/:id/protocols  — subscriptions; `role` lives HERE, not on the bot
 */

import { useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
// The app's ONE reveal-on-scroll mechanism (Theme Lab -> Scroll Animations). `.lad-reveal` is
// `opacity: 0` in `ladder.css`, and this hook is the only thing that adds `lad-reveal--show`, so a
// `.lad-reveal` element WITHOUT the hook stays invisible. Reusing the hook rather than writing a
// second IntersectionObserver is deliberate - a second implementation drifts.
import { useScrollReveal } from '../hooks/useScrollReveal';
import styles from './view-strategy.module.css';

const TRADING = '/api/trading/strategies';

/**
 * The four enforcement levels, in the badge's own words.
 *
 * ⚠️ The WORD is the meaning. The chip only tints it, because the semantic colour tokens are tuned
 * for a black background and would fail WCAG AA as text on a light panel. Keeping the meaning in
 * text also means the badge survives greyscale and colour-blind rendering.
 */
const ENFORCEMENT = {
  live: {
    word: 'LIVE',
    chip: 'chipLive',
    hint: 'Can block or shape a trade on the live queue path.',
  },
  'legacy-only': {
    word: 'EXECUTE ONLY',
    chip: 'chipLegacy',
    hint:
      'Applies when you press Execute. The AUTOMATION LOOP DOES NOT APPLY IT, so this field ' +
      'cannot stop a live trade.',
  },
  'display-only': {
    word: 'DISPLAY ONLY',
    chip: 'chipDisplay',
    hint: 'Read and returned, but cannot affect a trade.',
  },
  none: {
    word: 'NOT APPLIED',
    chip: 'chipNone',
    hint: 'No reader anywhere. Persisted and offered in the create form, and enforced nowhere.',
  },
};

/** Stages in the order a trade passes through them, so the page reads as the lifecycle. */
const STAGE_ORDER = ['identity', 'scope', 'routing', 'entry', 'sizing', 'risk', 'exit'];
const STAGE_LABEL = {
  identity: 'Identity',
  scope: 'Scope',
  routing: 'Routing',
  entry: 'Entry',
  sizing: 'Sizing',
  risk: 'Risk',
  exit: 'Exit',
};

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

/** A value counts as configured when it is set to something, `false` and `0` included. */
const isConfigured = (v) => v !== null && v !== undefined && v !== '';

/**
 * Does this rule hold a value that expresses an INTENTION the engine is ignoring?
 *
 * This drives the headline count only. Every rule row still reports configured-vs-unset honestly
 * (AC6); this is the narrower question "which of these did somebody set up believing it would
 * work?", because a headline that lists `name` next to `maxPositions` trains the reader to skim it.
 *
 * Measured on the VIX bot 2026-09-18, which is why both exclusions exist:
 *
 *   `name` / `version`  — declared `display-only`, and genuinely do nothing to a trade. But they are
 *                         LABELS. `name` is the MT5 order comment body and `version` tags A/B
 *                         snapshots. Nothing about them is dormant or surprising, so flagging them
 *                         is noise. `stage: 'identity'` already marks them — the declaration knows.
 *
 *   `hotStockEnabled: false` — a boolean set to `false` says "off". An unread field that is off is
 *                         behaving exactly as configured, so nothing is being silently ignored.
 *                         `true` on the same field IS the dangerous case: a feature switched on
 *                         with no reader. So booleans count only when true.
 *
 * ⚠️ This does NOT second-guess the declaration. `enforcement` is the single source of truth for
 * whether a rule applies — the only judgement here is presentation weighting.
 */
function isDormant(rule, raw) {
  if (rule.enforcement === 'live') return false;
  if (rule.stage === 'identity') return false; // labels, not rules
  if (!isConfigured(raw)) return false;
  if (raw === false) return false; // "off" — consistent with being unread
  return true;
}

/** Columns on the row that are structure and bookkeeping, not behaviour. */
const NON_RULE_FIELDS = new Set(['id', 'createdAt', 'updatedAt', 'evaluations']);

export default function ViewStrategyPage() {
  const { strategyId } = useParams();
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

  const bot = botQuery.data || null;
  const rules = useMemo(
    () => (Array.isArray(rulesQuery.data?.all) ? rulesQuery.data.all : []),
    [rulesQuery.data],
  );
  const counts = rulesQuery.data?.counts || null;
  const subs = Array.isArray(subsQuery.data) ? subsQuery.data : [];

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

  const groups = useMemo(() => {
    const byStage = new Map();
    for (const rule of rules) {
      const stage = STAGE_ORDER.includes(rule.stage) ? rule.stage : 'other';
      if (!byStage.has(stage)) byStage.set(stage, []);
      byStage.get(stage).push(rule);
    }
    return [...byStage.entries()].sort((a, b) => {
      const ia = STAGE_ORDER.indexOf(a[0]);
      const ib = STAGE_ORDER.indexOf(b[0]);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
  }, [rules]);

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
        <button type="button" className={styles.back} onClick={() => navigate('/trading/strategy-monitor')}>
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
      </header>

      {/* The headline. Read before a single rule — this is the number that decides whether the
          bot's configuration can be trusted. */}
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

          <ul className={styles.subList}>
            {stageRules.map((rule) => {
              // ⚠️ An unrecognised level must NOT render as if it applies.
              const meta = ENFORCEMENT[rule.enforcement] || {
                word: String(rule.enforcement || 'UNKNOWN').toUpperCase(),
                chip: 'chipNone',
                hint: 'Unrecognised enforcement level — treat as NOT applied.',
              };
              const raw = bot[rule.field];
              const value = formatValue(raw);
              const configured = isConfigured(raw);
              const isNotLive = rule.enforcement !== 'live';

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

                  <p className={styles.summaryText}>{rule.summary}</p>

                  {/* The enforcement hint is ALWAYS shown for a non-live rule — never only on
                      hover. A tooltip is invisible to a reader who does not go looking, and the
                      whole defect is a rule that reads as applied. */}
                  {isNotLive && <p className={styles.caveat}>{meta.hint}</p>}

                  {rule.caveat && <p className={styles.caveat}>{rule.caveat}</p>}

                  {/* AC6 — the two states named explicitly, beside the value. */}
                  {configured && isNotLive && (
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

      {/* Columns on the row that no declaration covers. Should be empty — the backend build fails
          if a behavioural column is undeclared. Shown when it is NOT empty, because that is a real
          finding: a column that reached the database with no declared enforcement status. */}
      {(() => {
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
