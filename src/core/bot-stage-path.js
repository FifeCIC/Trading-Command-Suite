/**
 * bot-stage-path.js — the bot's TRADE LIFECYCLE, drawn from its own rule declarations.
 * ==============================================================================
 *
 * WHY THIS EXISTS
 * ---------------
 * `ViewStrategyPage` renders every declared rule with its value AND its enforcement status, because
 * a bot is a row of ~32 columns interpreted by straight-line `if` chains and **8 of 29 behavioural
 * columns were enforced nowhere** on the live path (measured 2026-09-17). The page answers
 * *"can this field change a trade?"* — one field at a time, as a list.
 *
 * A list cannot show the thing that matters most, though: **a STAGE of the trade's life that the
 * engine does not act on at all.** Seven stages are declared (`identity -> scope -> routing ->
 * entry -> sizing -> risk -> exit`); if `risk` has no live rule, then nothing in the running system
 * stops a trade at that point — and in a list that stage still renders as a tidy heading with rules
 * underneath it, each wearing its own chip. The absence is distributed across rows instead of being
 * visible as one fact.
 *
 * So this module projects the same declarations onto the lifecycle and emits one node per stage.
 * A stage with no live rule is stroked as a disagreement; a stage holding something set-and-ignored
 * is stroked as a disagreement. **Nothing here invents a claim about the bot that the page does not
 * already assert** — it is the same data, arranged so a missing stage is visible.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THESE FOUR DEFINITIONS LIVE HERE, NOT IN THE PAGE
 * ─────────────────────────────────────────────────────────────────────────
 * `STAGE_ORDER`, `STAGE_LABEL`, `isConfigured` and `isDormant` were defined in
 * `ViewStrategyPage.jsx` and nowhere else — correctly, while it had one consumer. This module is
 * the second. Copying them would have produced two `isDormant`s that agree today and drift at the
 * next fix, with only one of them getting updated — the most expensive kind of technical debt in
 * this repo's own words (`development-status.instructions.md`). The page now imports them back.
 *
 * ⚠️ `STAGE_ORDER` here is the BOT'S config vocabulary (which column belongs to which stage) and is
 * deliberately NOT the same list as `STAGES` in `strategy-diagram.js`, which matches a library
 * entry's directive *roles* (`signal`, `confirm`, `level`, `macro`, `session`). Two different
 * questions, two different vocabularies. Do not merge them.
 */

/**
 * Stages in the order a trade passes through them, so the picture reads as the lifecycle.
 * Source of truth for both the page's grouping and this diagram's node order.
 */
export const STAGE_ORDER = ['identity', 'scope', 'routing', 'entry', 'sizing', 'risk', 'exit'];

/**
 * The stages a TRADE passes through — `STAGE_ORDER` minus `identity`.
 *
 * ⚠️ `identity` is excluded from the PICTURE, and the reasoning is the one already written for
 * `isDormant` below: `name`, `description` and `version` are LABELS, not rules. All three are
 * declared `display-only` — correctly — so `identity` has zero live rules on every bot that will
 * ever exist.
 *
 * Drawing it as a lifecycle stage therefore strokes it RED for the life of the app, on a bot that
 * is behaving exactly as declared. Measured 2026-09-23 on the first bot rendered:
 *
 *     Identity — NOTHING LIVE (3 declared)      <- always red, always meaningless
 *     Risk     — NOTHING LIVE (2 declared)      <- genuinely red
 *
 * Both were red, and the ALWAYS-red one came first. A stage that is always red is a stage nobody
 * reads, and it buried the real finding next to it (`maxDailyLoss` is `legacy-only`, so a
 * configured daily-loss cap is not enforced by the loop). Narrow beats broad: this exclusion is
 * what keeps red meaning "something is wrong HERE" rather than "this bot has a name".
 *
 * `identity` stays in `STAGE_ORDER`, so the grouped list under the picture still lists the labels
 * as configuration. The two questions are different and both worth asking:
 *   list    — "what columns does this bot have, and is each enforced?"
 *   picture — "where in a trade's life can this bot actually act?"
 */
export const LIFECYCLE_STAGES = STAGE_ORDER.filter((s) => s !== 'identity');

export const STAGE_LABEL = {
  identity: 'Identity',
  scope: 'Scope',
  routing: 'Routing',
  entry: 'Entry',
  sizing: 'Sizing',
  risk: 'Risk',
  exit: 'Exit',
};

/**
 * A value counts as configured when it is set to something — `false` and `0` included.
 *
 * ⚠️ A truthiness check here would misreport `useRaritySizing: false` as "not configured" when it
 * is in fact configured and nothing reads it. Only `null | undefined | ''` are unset (AC6).
 */
export const isConfigured = (v) => v !== null && v !== undefined && v !== '';

/**
 * Does this rule hold a value that expresses an INTENTION the engine is ignoring?
 *
 * Moved here from `ViewStrategyPage.jsx` unchanged. The reasoning, which is the page's:
 *
 *   `name` / `version` — declared `display-only`, and genuinely do nothing to a trade. But they are
 *                        LABELS. `name` is the MT5 order comment body and `version` tags A/B
 *                        snapshots. Nothing about them is dormant or surprising, so flagging them is
 *                        noise. `stage: 'identity'` already marks them — the declaration knows.
 *
 *   `hotStockEnabled: false` — a boolean set to `false` says "off". An unread field that is off is
 *                        behaving exactly as configured, so nothing is being silently ignored.
 *                        `true` on the same field IS the dangerous case. So booleans count only
 *                        when true.
 *
 * ⚠️ This does NOT second-guess the declaration. `enforcement` is the single source of truth for
 * whether a rule applies — the only judgement here is presentation weighting.
 */
export function isDormant(rule, raw) {
  if (rule.enforcement === 'live') return false;
  if (rule.stage === 'identity') return false; // labels, not rules
  if (!isConfigured(raw)) return false;
  if (raw === false) return false; // "off" — consistent with being unread
  return true;
}

/**
 * Group the declarations by stage, in lifecycle order, with any unrecognised stage last.
 *
 * @returns {Array<{ stage: string, label: string, rules: object[] }>}
 */
export function groupRulesByStage(rules) {
  const byStage = new Map();
  for (const rule of rules) {
    const stage = STAGE_ORDER.includes(rule.stage) ? rule.stage : 'other';
    if (!byStage.has(stage)) byStage.set(stage, []);
    byStage.get(stage).push(rule);
  }
  return [...byStage.entries()]
    .sort((a, b) => {
      const ia = STAGE_ORDER.indexOf(a[0]);
      const ib = STAGE_ORDER.indexOf(b[0]);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    })
    .map(([stage, stageRules]) => ({
      stage,
      label: STAGE_LABEL[stage] || stage,
      rules: stageRules,
    }));
}

/**
 * Per-stage tallies. Pure — no claims, no colours, so the numbers can be asserted in a test.
 *
 * `live` counts rules the engine CAN act on, regardless of whether this bot set a value. That is
 * the question "does this stage exist in the running system at all", which is different from
 * "has this bot configured it".
 */
export function stageTally(stageRules, bot) {
  const live = stageRules.filter((r) => r.enforcement === 'live');
  const dormant = bot ? stageRules.filter((r) => isDormant(r, bot[r.field])) : [];
  const liveConfigured = bot
    ? live.filter((r) => isConfigured(bot[r.field]))
    : [];
  return { declared: stageRules.length, live: live.length, liveConfigured: liveConfigured.length, dormant };
}

/**
 * The label for one stage node.
 *
 * ⚠️ Worded so the DANGEROUS case is the loudest thing in the string. A stage where somebody set a
 * value the engine ignores says so in capitals, because that is the one a reader must not skim past
 * — the same priority the page's headline gives it.
 */
function stageLabel(t, label) {
  if (t.declared === 0) return `${label} — no rules declared`;
  const base = t.live > 0 ? `${label} — ${t.live} live / ${t.declared} declared` : `${label} — NOTHING LIVE (${t.declared} declared)`;
  return t.dormant.length > 0 ? `${base} ⚠ ${t.dormant.length} SET AND IGNORED` : base;
}

/**
 * Build the lifecycle path for one bot from its declarations.
 *
 * ⚠️ EVERY STAGE IN `LIFECYCLE_STAGES` GETS A NODE, declared or not.
 *
 * The first draft emitted only the stages that had rules, which silently skipped from `scope`
 * straight to `sizing` when `routing` and `entry` were undeclared. A reader had to already know the
 * lifecycle to notice the gap — and the gap is precisely the finding worth seeing. The whole point
 * of this picture is that a missing stage should LOOK missing; omitting the node made an absence
 * indistinguishable from a stage that does not exist in the model at all.
 *
 * An undeclared stage therefore renders as `"<Label> — no rules declared"` and its claims resolve to
 * `ok: null` (nothing was measured, so nothing is asserted — see `botStageClaims`).
 *
 * @param bot    the `trading_strategy` row (values), or null when it did not load
 * @param rules  the declarations from `GET /api/trading/strategies/bot-rules`
 * @returns {{ source: string, nodes: Array<{ id, label, stage, tally }> }}
 *          `source` is Mermaid; `nodes` is the same structure as data, for the claim panel.
 */
export function buildBotStagePath(bot, rules) {
  const declared = groupRulesByStage(Array.isArray(rules) ? rules : []);
  const byStage = new Map(declared.map((g) => [g.stage, g]));

  // The lifecycle in order, then any unrecognised stage the declarations introduced, last.
  const ordered = [
    ...LIFECYCLE_STAGES.map((stage) => byStage.get(stage) || { stage, label: STAGE_LABEL[stage], rules: [] }),
    ...declared.filter((g) => g.stage === 'other'),
  ];

  const nodes = ordered.map((g, i) => {
    const tally = stageTally(g.rules, bot);
    return { id: `st${i + 1}`, label: stageLabel(tally, g.label), stage: g.stage, tally };
  });

  const lines = ['flowchart TD'];
  for (const n of nodes) {
    // Quote the label so punctuation (`—`, `/`, `⚠`, brackets) cannot be read as mermaid syntax.
    lines.push(`  ${n.id}["${n.label.replace(/"/g, '&quot;')}"]`);
  }
  // Chain the stages in order. A trade passes through them; a fan-out would imply parallel work
  // that does not happen.
  for (let i = 0; i < nodes.length - 1; i++) {
    lines.push(`  ${nodes[i].id} --> ${nodes[i + 1].id}`);
  }

  // ── THE BRAKE LAYER — what stops a trade, and whether it needs the app to be running ─────
  //
  // ⚠️ WHY THIS EXISTS (owner, 2026-09-30). Two facts were true, important, and named NOWHERE in
  // this picture — and both were learned the hard way on the −322.67 position:
  //
  //   1. EVERY app-side brake needs the app to be RUNNING. The guardian, the time-stop, the
  //      exhaustion observer and the loop's own risk gate all live in this process. With the PC
  //      off there is **no management of any open position at all**. The owner had not factored
  //      this in, and nothing here said it.
  //   2. The brakes that DO survive come from somewhere this page never named — the **bridge's**
  //      own caps and the **broker's** SL/TP — and one of them, the daily-loss cap, **RESETS AT
  //      MIDNIGHT** (`mt5_bridge_v2.py:1680`, window `datetime.now().replace(hour=0, …)`).
  //
  // The lifecycle chain above answers "where can this bot act?". These nodes answer "what acts
  // when it cannot?" — which is the half a reader is blind to. A stage stroked red is NOT the same
  // as a position that is unprotected, and before this the picture could not tell them apart.
  //
  // ⚠️ `tally: null` marks these as NOT stages, and `botStageClaims` skips them. They carry no
  // assertion because neither is checkable from a bot's declarations — and a claim that cannot be
  // evaluated must resolve to unverified, never to a pass. Inventing a green here would be the
  // "verifier that inspects nothing" defect this repo names in its own instructions.
  const coverage = [
    {
      id: `st${nodes.length + 1}`,
      stage: 'coverage',
      tally: null,
      label:
        'Brakes INSIDE the app — guardian trailing, time-stop, exhaustion, the loop risk gate. ' +
        '⚠ ALL REQUIRE THE APP TO BE RUNNING. PC off = no management of any open position.',
    },
    {
      id: `st${nodes.length + 2}`,
      stage: 'coverage',
      tally: null,
      label:
        'Brakes OUTSIDE the app — bridge caps (max positions / max size / daily loss, which ⚠ ' +
        'RESETS AT MIDNIGHT) and the broker SL/TP. The broker SL/TP is the ONLY brake that survives ' +
        'the app and the PC being off — and it is FIXED when the order was placed, so a scale-in ' +
        'adds size WITHOUT moving it.',
    },
  ];
  for (const c of coverage) lines.push(`  ${c.id}["${c.label.replace(/"/g, '&quot;')}"]`);
  lines.push(`  ${nodes[nodes.length - 1].id} -.-> ${coverage[0].id}`);
  lines.push(`  ${coverage[0].id} -.-> ${coverage[1].id}`);

  return { source: lines.join('\n'), nodes: [...nodes, ...coverage] };
}

/**
 * Claims for one bot, in the shape `diagram-claims.js` uses.
 *
 * TWO claims per stage, and they ask genuinely different questions:
 *
 *   A. "at least one rule in this stage can affect a trade" — answerable from the DECLARATIONS
 *      ALONE. It stays checkable even when the bot row failed to load, which is exactly when a
 *      reader most needs to know the difference between "this stage is inert" and "I could not
 *      look". Same principle as `directive-registered` in `strategy-diagram.js`.
 *
 *   B. "nothing here is set to a value the engine ignores" — needs the bot's VALUES, so it is
 *      `ok: null` (unverified) when the row is missing.
 *
 * ⚠️ AN EMPTY STAGE IS AN ABSENCE, NOT A DISAGREEMENT. A stage with no declared rules gets claim A
 * as `expect: null` and resolves to `ok: null`. Marking it false would stroke a stage red for not
 * existing, which says nothing about whether the bot is sound — and a check that invents failures
 * gets ignored.
 */
export function botStageClaims(bot, path) {
  const claims = [];
  for (const n of path.nodes) {
    // ⚠️ The brake-layer nodes (`tally: null`) are NOT stages and carry no claim. See
    // `buildBotStagePath`: they state a fact about the system, not about this bot, so there is
    // nothing here to evaluate — and `undefined.declared` would throw.
    if (!n.tally) continue;
    const t = n.tally;

    if (t.declared === 0) {
      claims.push({
        node: n.id,
        says: `${n.stage} has no declared rules`,
        expect: '(none declared)',
        kind: 'stage-absent',
        note: 'Nothing is declared for this stage, so there is nothing to check here.',
      });
      continue;
    }

    claims.push({
      node: n.id,
      nodeStage: n.stage,
      says: `${n.stage} has a rule the engine can act on`,
      expect: 'at least one live rule',
      actualHint: t.live > 0 ? `${t.live} live rule(s)` : 'none',
      kind: 'stage-has-live-rule',
      note:
        'Every rule declared for this stage is execute-only, display-only or unapplied, so nothing ' +
        'in the running system can act at this point in a trade.',
    });

    claims.push({
      node: n.id,
      nodeStage: n.stage,
      says: `${n.stage} holds nothing the engine ignores`,
      expect: 'nothing set and ignored',
      kind: 'stage-not-dormant',
      note:
        'A value is set on this stage that the automation loop does not read — somebody configured ' +
        'it expecting it to work. Not a style issue: the configuration states an intention the ' +
        'engine does not honour.',
    });
  }
  return claims;
}

/**
 * Resolve each claim. `ok` is true / false / null (null = unverified).
 *
 * ⚠️ `null` is not a failure and MUST NOT render as one. A probe that cannot run has told you
 * nothing, and showing it red would assert the bot is unsound when the truth is that nothing was
 * measured. Same rule as `diagram-claims.js` and `strategy-diagram.js`.
 *
 * @param claims from `botStageClaims`
 * @param ctx    { bot, rules, error }
 *               `error` — why the declarations request failed, if it did
 */
export function evaluateBotStageClaims(claims, ctx = {}) {
  const { bot, rules, error } = ctx;
  const haveRules = Array.isArray(rules) && rules.length > 0;
  const rows = [];

  for (const claim of claims) {
    const row = { ...claim, actual: null, ok: null, error: null };

    if (error) {
      row.error = `not checked — the rule declarations could not be read (${error})`;
      rows.push(row);
      continue;
    }
    // A verifier that cannot read its input must ERROR, never pass. Without the declarations
    // there is no way to say which rules apply, and rendering the path anyway would imply the
    // enforcement status is known. Mirrors the page's own early return.
    if (!haveRules) {
      row.error = 'not checked — no rule declarations available';
      rows.push(row);
      continue;
    }

    switch (claim.kind) {
      case 'stage-absent': {
        // Declarations loaded and this stage genuinely has none. Nothing was measured, so
        // nothing is asserted. NOT false — see the note on the claim.
        row.actual = 'no rules declared';
        row.error = 'not checked — this stage declares no rules, so there is nothing to judge.';
        break;
      }

      case 'stage-has-live-rule': {
        // Answered from the declarations, so it does NOT depend on the bot row.
        const t = claim.actualHint;
        row.actual = t;
        row.ok = t !== 'none';
        break;
      }

      case 'stage-not-dormant': {
        if (!bot) {
          row.error = "not checked — the bot's own values were not read";
          break;
        }
        // Recomputed here from the stage's own rules, keyed on `nodeStage` carried by the claim.
        // Deriving it from the node id instead would couple this to the id format, and trusting a
        // pre-computed list on the claim would let the two disagree silently.
        const stageRules = rules.filter(
          (r) => (STAGE_ORDER.includes(r.stage) ? r.stage : 'other') === claim.nodeStage,
        );
        const dormant = stageRules.filter((r) => isDormant(r, bot[r.field]));
        row.actual = dormant.length ? dormant.map((r) => r.field).join(', ') : 'none';
        row.ok = dormant.length === 0;
        break;
      }

      default:
        row.error = 'no resolver for this claim kind';
    }

    rows.push(row);
  }
  return rows;
}
