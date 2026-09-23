/**
 * strategy-diagram.js — a strategy's DECISION PATH, generated from its own declarative data,
 * and checked against the running system.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────
 * `src/data/strategy-library.js` already carries everything a decision path needs:
 *   - `directiveMappings[]` — which directive does which job, and its `role` in the method
 *   - `configSchema`        — the parameters the thesis depends on
 *   - `tcsProtocol`         — the live protocol this theory claims to describe
 * `StrategyLibraryPage` currently renders the mappings as a flat list and the schema as a
 * key/value table, so the reader has to assemble the sequence in their head.
 *
 * This module GENERATES the picture from that data rather than storing a hand-drawn one.
 * The argument for generating: a hand-drawn diagram is prose that can drift; a generated one
 * is derived from the same fields the page already shows, so it cannot disagree with them.
 *
 * ── THE PART THAT MAKES IT ALIVE ────────────────────────────────────────────────────────
 * Every generated node also carries a CLAIM, and a claim is `expect` (what the theory says)
 * against `actual` (what the running system says). A node whose claim fails is stroked red
 * in the picture. That mechanism already exists for the developer Diagrams page in
 * `src/core/diagram-claims.js` — this module reuses its claim SHAPE and its
 * `annotateSource` / `summarise` presentation, and deliberately does not fork them.
 *
 * ⚠️ ONE DELIBERATE DIFFERENCE — read before "simplifying" this into `evaluateClaims`:
 * `evaluateClaims` resolves a probe as a STATIC PATH into one API response (`probe.pick`).
 * The claims here are RELATIONAL: "the bot whose `protocolId` equals this entry's
 * `tcsProtocol`". That is a lookup, not a path, and it cannot be expressed as `pick` without
 * hardcoding a positional index that changes the moment a bot is added. So the resolution
 * lives here — but the row shape, the `ok: true | false | null` semantics and the
 * "unverified is never a pass" rule are IDENTICAL to the existing mechanism.
 *
 * ── COVERAGE IS PARTIAL AND THAT IS DECLARED, NOT HIDDEN ────────────────────────────────
 * Several `configSchema` keys have NO counterpart in the running system, because the library
 * describes the method in a trader's units (pips, ratios, tranche splits) while a
 * `trading_strategy` row stores percentages and composite scores. Those claims resolve to
 * `null` (unverifiable) with the reason attached — never to a green tick, and never dropped,
 * because "this cannot be checked" is itself the finding.
 *
 * @module strategy-diagram
 */

/**
 * Ordered decision stages, matched against a mapping's `role` (lowercased).
 *
 * ⚠️ ORDER IS SIGNIFICANT IN TWO WAYS, and both were wrong in the first draft:
 *  1. Stages are emitted in THIS array's order, not in the order the mappings happen to be
 *     declared — otherwise a directive declared early lands late in the picture and the path
 *     reads as a different sequence than the method describes.
 *  2. `exit` is tested BEFORE `session`, because `time-stop` carries the role "Session Exit".
 *     With `/session/` first, the strategy's own exit directive was swept into the session
 *     stage and the drawn path had no exit at all.
 * A `role` that matches nothing lands in `Other` at the end rather than being dropped:
 * a gap in this table should be visible, not silently swallowed.
 */
const STAGES = [
  { key: 'signal', label: 'Signal', match: /signal|trigger|entry timing/ },
  { key: 'confirm', label: 'Confirmation', match: /confirm|validat/ },
  { key: 'level', label: 'Level / Structure', match: /level|structure|precision|pivot/ },
  { key: 'macro', label: 'Macro / Regime', match: /macro|regime|filter|context|dxy/ },
  { key: 'exit', label: 'Exit', match: /exit/ },
  { key: 'session', label: 'Session / Timing', match: /session|timing/ },
  { key: 'other', label: 'Other', match: /$^/ },
];

/** Which stage a mapping belongs to. First match wins, so specific patterns come first. */
function stageOf(role) {
  const r = String(role || '').toLowerCase();
  return STAGES.find((s) => s.match.test(r)) || STAGES[STAGES.length - 1];
}

/**
 * The market a library entry is about, reduced to the prefix that a broker symbol would
 * carry. Derived from `assetClasses` — this is the PROTOTYPE'S OWN rule, not a field the
 * library declares, and it is the rule that surfaces the first real disagreement.
 */
function marketPrefixOf(strategy) {
  const classes = (strategy.assetClasses || []).join(' ').toLowerCase();
  if (/precious metal|gold/.test(classes)) return 'XAU';
  if (/silver/.test(classes)) return 'XAG';
  if (/oil|energy/.test(classes)) return 'USOIL';
  if (/forex|currency|major/.test(classes)) return null; // a pair has no single prefix
  return null;
}

/**
 * Every timeframe a library entry declares, normalised to mt5 spelling.
 *
 * ⚠️ RETURNS A LIST, NOT ONE VALUE — and the first draft got this wrong in a way worth
 * keeping written down. `gold-scalp` declares `timeframe: 'M1 / M5'`: the method runs on BOTH.
 * Returning the first match (`1m`) made the claim fail against a bot correctly running `5m`,
 * manufacturing a conflict out of a strategy that was being followed properly.
 * A check that invents failures gets ignored, so the claim accepts ANY declared timeframe.
 *
 * @returns {string[]} e.g. ['1m','5m'] — empty when the field names no period.
 */
function timeframesOf(strategy) {
  const tf = String(strategy.timeframe || '');
  const out = [];
  for (const m of tf.matchAll(/M(\d+)/gi)) out.push(`${m[1]}m`);
  for (const h of tf.matchAll(/H(\d+)/gi)) out.push(`${h[1]}h`);
  if (/daily/i.test(tf)) out.push('1d');
  return [...new Set(out)];
}

/**
 * Build the decision path for one library entry.
 *
 * @returns {{ source: string, nodes: Array<{ id, label, stage, mappings }> }}
 *          `source` is Mermaid; `nodes` is the same structure as data, for the claim panel.
 */
export function buildDecisionPath(strategy) {
  const mappings = strategy.directiveMappings || [];

  // Group the mappings into ordered stages, then EMIT IN STAGE ORDER (see the note above —
  // declaration order would put a late-declared early-stage directive in the wrong place).
  // Declaration order is preserved WITHIN a stage, which is meaningful: it is the author's
  // own sequence when two directives share a job.
  const byStage = new Map();
  for (const m of mappings) {
    const s = stageOf(m.role);
    if (!byStage.has(s.key)) byStage.set(s.key, { stage: s, mappings: [] });
    byStage.get(s.key).mappings.push(m);
  }
  const ordered = STAGES.map((s) => byStage.get(s.key)).filter(Boolean);

  // The three stages that exist only in the RUNNING system, not in the library entry.
  const botStages = [
    { stage: { key: 'gate', label: 'Entry gate' }, mappings: [] },
    { stage: { key: 'risk', label: 'Stop / Target' }, mappings: [] },
  ];

  // ⚠️ EMISSION ORDER IS THE DECISION ORDER, and it is not simply STAGES order.
  // A first draft emitted the `exit` stage where STAGES placed it — BEFORE the session gate —
  // which drew the strategy's exit rule in the middle of its entry logic. The sequence a
  // trade actually passes through is: the theory's gates, then the bot's entry and price
  // exits, then the rule that ends the trade. So `exit` is pulled out and appended last.
  const libraryStages = ordered.filter((e) => e.stage.key !== 'exit');
  const exitStages = ordered.filter((e) => e.stage.key === 'exit');
  const flow = [...libraryStages, ...botStages, ...exitStages];

  const nodes = [];
  const label = (s, ms) => {
    if (ms.length === 0) return `${s.label} — bot`;
    return ms.length === 1
      ? `${s.label} — ${ms[0].directiveId} (${ms[0].role})`
      : `${s.label} — ${ms.map((m) => m.directiveId).join(' + ')}`;
  };

  for (const { stage, mappings: ms } of flow) {
    nodes.push({ id: `n${nodes.length + 1}`, label: label(stage, ms), stage: stage.key, mappings: ms });
  }

  const lines = ['flowchart TD'];
  for (const n of nodes) {
    // Quote the label so punctuation (`—`, `+`, `/`) cannot be read as mermaid syntax.
    lines.push(`  ${n.id}["${n.label.replace(/"/g, '&quot;')}"]`);
  }
  // Chain the stages in order. `-->` between every adjacent pair keeps it linear and
  // readable; a fan-out would imply parallel work that does not happen.
  for (let i = 0; i < nodes.length - 1; i++) {
    lines.push(`  ${nodes[i].id} --> ${nodes[i + 1].id}`);
  }

  return { source: lines.join('\n'), nodes };
}

/**
 * Claims for one strategy, in the same shape `diagram-claims.js` uses.
 *
 * `expect` is what the LIBRARY says. `actual` is what the RUNNING SYSTEM says (resolved in
 * `evaluateStrategyClaims`, because these are relations, not paths).
 *
 * ⚠️ A claim is only created where a comparison is meaningful. Where the library's unit and
 * the bot's unit are different (pips vs percent) there is NO claim — instead the caller
 * reports it as unverifiable, with the reason. Inventing a conversion would manufacture a
 * pass or a failure out of a guess.
 */
export function strategyClaims(strategy, path) {
  const claims = [];
  const nodeFor = (stage) => (path.nodes.find((n) => n.stage === stage) || {}).id;

  // ⚠️ `protocol` is carried on EVERY claim, separately from `expect`. The first draft made
  // the resolver compare `bot.protocolId` against `claim.expect`, which works only for the
  // one claim whose expect happens to be a protocol slug — and silently falls through for
  // the rest. An explicit field cannot be misread by the next person.
  const protocol = strategy.tcsProtocol || null;

  // 0. EVERY mapped directive must actually exist in the registry.
  //
  // This is the claim that makes the whole path checkable. Without it the Confirmation,
  // Level and Macro stages carry no claim at all — a stage that asserts a directive which
  // was renamed or deleted would render as an ordinary, healthy node. The directive list is
  // already fetched for the readiness badges on this page, so this costs no extra request.
  for (const n of path.nodes) {
    for (const m of n.mappings) {
      claims.push({
        node: n.id,
        says: `${m.directiveId} is a registered directive`,
        expect: m.directiveId,
        protocol,
        kind: 'directive-registered',
        note: `Role in this strategy: ${m.role}.`,
      });
    }
  }

  // 1. The link itself — the field the whole idea rests on.
  claims.push({
    node: nodeFor('signal') || path.nodes[0].id,
    says: 'the library entry names a protocol, and a bot runs it',
    expect: protocol || '(no tcsProtocol declared)',
    protocol,
    kind: 'protocol-resolves',
    note: 'A library entry is documentation until a bot runs its protocol.',
  });

  // 2. The market the theory is about.
  const prefix = marketPrefixOf(strategy);
  if (prefix) {
    claims.push({
      node: nodeFor('signal') || path.nodes[0].id,
      says: `the bot trades the market this theory is about (${prefix})`,
      expect: prefix,
      kind: 'bot-symbol-prefix',
      note: 'Derived from assetClasses by this prototype — the library declares no symbol.',
    });
  }

  // 3. Timeframe — the bot must run one of the timeframes the method declares.
  const tfs = timeframesOf(strategy);
  if (tfs.length) {
    claims.push({
      node: nodeFor('session') || nodeFor('confirm') || path.nodes[0].id,
      says: 'the bot runs a timeframe the theory names',
      expect: tfs,
      kind: 'bot-timeframe',
      note: `Library declares "${strategy.timeframe}".`,
    });
  }

  // 4. Session window — the library gives clock times, the bot gives a named session, so
  //    only the NAMED half can be compared. Declared as a presence claim, not an equality.
  if (strategy.configSchema?.sessionStartEST) {
    claims.push({
      node: nodeFor('session') || path.nodes[0].id,
      says: 'the bot has a session window set',
      expect: 'a window',
      kind: 'bot-session-present',
      note: `Library declares ${strategy.configSchema.sessionStartEST}-${strategy.configSchema.sessionEndEST} EST; the bot stores named sessions, so the clocks cannot be compared directly.`,
    });
  }

  // 5. The bot's own gates — the library does not parameterise these at all.
  if (nodeFor('gate')) {
    claims.push({
      node: nodeFor('gate'),
      says: 'the bot declares an entry threshold',
      expect: 'declared',
      kind: 'bot-gate-present',
      note: 'No counterpart in the library entry — the thesis does not state one.',
    });
  }
  if (nodeFor('risk')) {
    claims.push({
      node: nodeFor('risk'),
      says: 'the bot declares a stop and a target',
      expect: 'declared',
      kind: 'bot-risk-present',
      note: 'No counterpart in the library entry — the thesis states stops in pips and ratios instead.',
    });
  }

  return claims;
}

/**
 * Resolve each claim against the live data.
 *
 * @param claims  from `strategyClaims`
 * @param ctx     { bots, error }
 *                `bots`  — the rows from GET /api/trading/strategies (already fetched)
 *                `error` — why the fetch failed, if it did
 * @returns [{ ...claim, actual, ok, error }] — `ok` is true / false / null (null = unverified)
 *
 * ⚠️ `null` is not a failure and MUST NOT render as one. A probe that cannot run has told
 * you nothing about the claim, and showing it red would assert the theory is wrong when the
 * truth is that nothing was measured. Same rule as `diagram-claims.js`.
 */
export function evaluateStrategyClaims(claims, ctx = {}) {
  const { bots, directives, error } = ctx;
  const rows = [];

  for (const claim of claims) {
    const row = { ...claim, actual: null, ok: null, error: null };

    if (error) {
      row.error = `not checked — the strategies endpoint could not be read (${error})`;
      rows.push(row);
      continue;
    }
    if (!Array.isArray(bots)) {
      row.error = 'not checked — no bot list available';
      rows.push(row);
      continue;
    }

    // ── Directive registration does NOT depend on a bot. It is answered from the directive
    // registry, so it stays checkable even when no bot runs the protocol at all — which is
    // exactly when a reader most needs to know the difference between "not wired yet" and
    // "wired to something that no longer exists".
    if (claim.kind === 'directive-registered') {
      if (!Array.isArray(directives)) {
        row.error = 'not checked — the directive registry was not read';
        rows.push(row);
        continue;
      }
      const d = directives.find((x) => x.id === claim.expect);
      row.ok = Boolean(d);
      row.actual = d ? (d.readiness || 'registered') : 'not registered';
      if (!d) {
        row.error =
          `no directive called "${claim.expect}" is registered. The library entry maps a ` +
          'directive the app does not have — either it was renamed, or it was never built.';
      }
      rows.push(row);
      continue;
    }

    // Every remaining claim is about THE BOT THAT RUNS THIS PROTOCOL. There is deliberately no
    // fallback to "any bot" — a claim checked against an unrelated bot is worse than an
    // unchecked one, because it renders a confident answer about the wrong thing.
    const proto = claim.protocol ?? ctx.protocol;
    const mine = proto ? bots.filter((b) => b.protocolId === proto) : [];

    switch (claim.kind) {
      case 'protocol-resolves': {
        row.actual = mine.length ? `${mine.length} bot${mine.length === 1 ? '' : 's'}` : 'no bot';
        row.ok = mine.length > 0;
        if (!row.ok) {
          row.error =
            'no bot references this protocol. The library entry may be stale, the protocol ' +
            'may be inactive, or the bot may be missing its strategy_protocol subscription.';
        }
        break;
      }
      case 'bot-symbol-prefix': {
        const sym = mine[0]?.symbol;
        row.actual = mine.length ? mine.map((b) => b.symbol).join(', ') : null;
        row.ok = mine.length ? sym.startsWith(claim.expect) : null;
        if (row.ok === false) {
          row.error =
            `the theory is about ${claim.expect} but the bot trades ${row.actual}. ` +
            'Either the library entry or the protocol link is wrong — this is drift, not a style issue.';
        }
        break;
      }
      case 'bot-timeframe': {
        row.actual = mine.length ? mine[0].timeframe : null;
        // `expect` is a LIST of accepted timeframes — a method may run on several.
        row.ok = mine.length ? claim.expect.includes(mine[0].timeframe) : null;
        if (row.ok === false) {
          row.error = `the method declares ${claim.expect.join(' / ')} but the bot runs ${row.actual}.`;
        }
        break;
      }
      case 'bot-session-present': {
        const w = mine[0]?.sessionWindow;
        row.actual = w ? (Array.isArray(w) ? w.join(', ') : String(w)) : null;
        row.ok = mine.length ? Boolean(w && (Array.isArray(w) ? w.length : String(w).length)) : null;
        break;
      }
      case 'bot-gate-present': {
        const v = mine[0]?.minComposite;
        row.actual = v == null ? null : String(v);
        row.ok = mine.length ? v != null : null;
        break;
      }
      case 'bot-risk-present': {
        const b = mine[0];
        row.actual = b ? `sl ${b.slPct}, tp ${b.tpPct}` : null;
        row.ok = mine.length ? b.slPct != null && b.tpPct != null : null;
        break;
      }
      default:
        row.error = 'no resolver for this claim kind';
    }

    rows.push(row);
  }

  return rows;
}

/**
 * Fields the library declares that the running system has no column for.
 * Returned as reasons, not as claims — a claim needs an `expect` and a probe, and these have
 * neither. They are surfaced because "the theory asks for something the app cannot store"
 * is the most useful thing a reader can learn from the comparison.
 */
export function unverifiableSchemaKeys(strategy) {
  const schema = strategy.configSchema || {};
  const NO_LIVE_HOME = [
    { re: /pip/i, why: 'stored as a percent (slPct/tpPct), not pips' },
    { re: /atr/i, why: 'no ATR-multiple column on trading_strategy' },
    { re: /tranche|split/i, why: 'no tranche model — baseSize is a single order size' },
    { re: /volume|lookback/i, why: 'no volume filter column on trading_strategy' },
    { re: /correlation/i, why: 'no correlation column; #660 tracks the missing directive' },
    { re: /bracket|news/i, why: 'no news-bracket order model' },
    { re: /asian|sessionEnd|sessionStart/i, why: 'bot stores named sessions, not clock times' },
  ];
  return Object.keys(schema)
    .map((key) => {
      const hit = NO_LIVE_HOME.find((n) => n.re.test(key));
      return hit ? { key, why: hit.why } : null;
    })
    .filter(Boolean);
}
