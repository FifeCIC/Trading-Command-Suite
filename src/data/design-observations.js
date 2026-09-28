/**
 * design-observations.js — the DESIGN OBSERVATION REGISTER.
 * =========================================================
 *
 * WHY THIS EXISTS (review row R21, answered 2026-09-24; issue #990)
 * -----------------------------------------------------------------
 * Owner, 2026-09-24: *"Are we noting observations for review and consideration? This is important for
 * re-considering designs."*
 *
 * The honest answer at the time was **no**. Three homes existed and this observation was in none of
 * the reviewable ones:
 *
 *   | home                        | for                              | this finding? |
 *   |-----------------------------|----------------------------------|---------------|
 *   | `.github/REVIEW-QUEUE.md`   | decisions the owner must make     | no            |
 *   | `.github/AGENT-ATTENTION.md`| blockers needing human attention  | no            |
 *   | GitHub issues               | work to be done                   | no            |
 *   | `/development/theory-registry` | falsifiable predictions        | no            |
 *   | Decision Trail `OBSERVED`   | a SCORING decision with no consumer | different class |
 *
 * So it landed in a code comment — durable, and invisible to the only person who reconsiders designs.
 *
 * ⚠️ THE IRONY THIS FILE EXISTS TO CLOSE: the finding was *"a mechanism with no surface"*, and the
 * response to it was *"an observation with no surface"*. The same defect, one level up.
 *
 * ── THE RULE THAT MAKES THIS A REGISTER AND NOT A COMPLAINTS LOG ────────────────────────────────
 *
 * > **`reconsiderIf` is REQUIRED, always.** It is the analogue of a theory's `falsification`.
 *
 * An observation says *"this looks wrong"*. `reconsiderIf` says *"and you should change the design
 * when THIS becomes true"*. Without the second half an observation is a preference — the same reason
 * a theory without a falsification test does not belong in the registry next door.
 *
 * An observation is therefore **not** a defect report (that is an issue) and **not** a decision (that
 * is the review queue). It is a **design tension held open on purpose**, with the condition that
 * would close it.
 *
 * ── THE FIELDS ─────────────────────────────────────────────────────────────────────────────────
 *   observation   one sentence: what was SEEN. Not what should be done about it.
 *   why           what it means for the design — why a reader should care.
 *   evidence      `basis` grades the evidence exactly as `theories.js` does, so a cited number can
 *                 never pass as a measurement:
 *                   'measurement' — we counted it here; `n` is the sample size (positive integer)
 *                   'code-read'   — a fact about the SOURCE; there is no sample, so `n` MUST be null
 *                   'cited'       — carried from an issue or another agent; `source` MUST name it
 *   status        raised | considering | decided | rejected
 *   reconsiderIf  REQUIRED. The trigger that should re-open this. See the rule above.
 *   decision      REQUIRED once status is `decided` or `rejected`. An answer nobody acted on is trivia.
 *
 * `scripts/validate-design-observations.cjs` enforces all of the above and is canaried in both
 * directions. Like `validate-theories.cjs` it is **on demand, not in `prebuild`** — this register is
 * data, and a gate that fires for unrelated reasons gets allowlisted, which is worse than no gate.
 *
 * ── DECISION (2026-09-24, primary) ──
 * WHAT:      Design observations get their OWN REGISTER, and every row MUST carry a `reconsiderIf`.
 * WHY:       The repo had a home for decisions (the review queue), blockers (the attention board),
 *            work (issues) and predictions (the theory registry) — and none for "this mechanism has
 *            no surface" / "reconsider this design". #990's finding landed in a code comment:
 *            durable, and invisible to the only person who reconsiders designs. The cost is not a
 *            lost fact, it is a RE-OPENED decision, because the reasoning was never in front of
 *            anyone.
 * INSTEAD OF: A second section inside `.github/REVIEW-QUEUE.md` — the cheaper option, and the one
 *            the queue's own "one canonical location" rule argued for. Rejected because the owner
 *            wants observations to ACCUMULATE BEFORE they become decisions, and the queue's hard
 *            limits (one concern per row, question <= 40 words) are designed to prevent exactly that.
 * REVERSE BY: Delete this file and its four registration points (nav-tree.js, view-meta.js,
 *            view-routes.jsx, page-data-status.js), then paste the rows into the review queue.
 * REGISTER:  docs/SETTLED-DECISIONS.md row 33
 * GUARD:     scripts/validate-design-observations.cjs (--self-test canaried, 8 rules)
 */

export const OBSERVATION_STATUSES = ['raised', 'considering', 'decided', 'rejected'];

/** Same scale as `theories.js`, deliberately — two registries must not mean different things by it. */
export const OBSERVATION_BASES = ['measurement', 'code-read', 'cited'];

export const DESIGN_OBSERVATIONS = [
  {
    id: 'exit-management-has-no-surface',
    raisedAt: '2026-09-24',
    raisedBy: 'Copilot, while making post-entry exit management visible',
    area: 'trading',
    title: 'The mechanism that locks in profit was invisible on the bot page',
    observation:
      'The per-bot truth view renders every `trading_strategy` column with its enforcement status, and its EXIT stage is complete for those columns — but `StopGuardianService`, the only thing that manages a stop after entry, is not a column at all, so it appeared nowhere.',
    why:
      'A reader could study a bot’s entire exit configuration and never learn that a trailing tighten will move its stop, on what evidence, how far, or how often. The layer that locks in profit was the one layer with no surface — and it is the layer the owner watches when profit gives back.',
    evidence: {
      basis: 'measurement',
      n: 1,
      detail:
        'Observed live on the AVGO bot: the Exit stage shows 3 live rules (`slPct`, `tpPct`, `maxHoldHours`) and no mention of the guardian. `GUARDIAN_RULES` now declares the post-entry behaviour — 11 `global` + 1 `per-bot` — served on `GET /api/automation/stop-guardian/status` and rendered in a new “Exit management — post-entry” section labelled GLOBAL.',
      source: 'This repo — /api/automation/stop-guardian/status, read 2026-09-24 (12 rules, guardian enabled, 251 ticks)',
      observedAt: '2026-09-24',
    },
    status: 'decided',
    decision:
      'Owner ruling 2026-09-28: the MECHANISM is the unit, and `scope` decides whether it is per-bot. CLOSED — and its trigger was SPENT BEFORE ANYONE NOTICED. The trigger was "a second exit mechanism is added", and the second one (the up-move exhaustion observer) had already been added; that is why it fired. It fired silently because the guardian declared NO mechanism for it: it was attributed to the guardian by `bot-rules.ts` and declared by the service NOWHERE. The surface now names, per column, the mechanism that reads it, and `validate-rule-enforcement.cjs` (prebuild) fails if the two registries disagree. PARTIAL BY DESIGN: the 11 `global` mechanisms are still shared, so this alone does not make a stop policy trial-able on one bot — that is `exit-management-is-global-not-per-bot`, now a decided constraint rather than an open question.',
    reconsiderIf:
      'Reconsider if a mechanism can exist OUTSIDE both registries — the failure here was not that the guardian was invisible, but that one of its mechanisms was declared nowhere, and a guard now covers that. A second surface, or a mechanism configured somewhere other than a bot column, would re-open it.',
    issue: 990,
  },
  {
    id: 'exit-management-is-global-not-per-bot',
    raisedAt: '2026-09-24',
    raisedBy: 'Copilot, while declaring `GUARDIAN_RULES`',
    area: 'trading',
    title: 'All post-entry exit behaviour is global; nothing about it is per-bot data',
    observation:
      'Every declared exit rule is `global` — one `StopGuardianService` serves every position on every bot, and its four inputs are a hardcoded `new Set([...])` in the service file.',
    why:
      'The owner’s stated long-term direction is a data approach. Here the behaviour is not merely authored in code — it is *shared* by every bot, so there is no way to trial a different stop policy on one bot without changing all of them. That is what makes the A/B route for stop changes awkward.',
    evidence: {
      basis: 'code-read',
      n: null,
      detail:
        '`STOP_GUARDIAN_DIRECTIVES = new Set([\'atr-trailing-stop\',\'supertrend\',\'chandelier-exit\',\'wick-filter\'])` — a module-level constant. No column on `trading_strategy` selects an exit directive, and no per-bot settings table exists for one.',
      source: 'This repo — nest/src/modules/automation/stop-guardian.service.ts',
      observedAt: '2026-09-24',
    },
    status: 'decided',
    decision:
      'Owner ruling 2026-09-28: mechanism = the unit, `scope` decides per-bot. DECIDED AS A CONSTRAINT KEPT — not as a defect removed, and the distinction is the honest reading of the ruling. The 11 `global` mechanisms remain shared by every bot, so a stop policy still cannot be trialled on one bot without a copied configuration, which is the #929 route. What CHANGED is that this is now explicit and visible per mechanism instead of an unexamined default, and the 2 `per-bot` mechanisms (sim-TSL and the exhaustion observer) demonstrate that the shape supports both. Making all 11 per-bot was the REJECTED alternative: ~11 new columns, and one global change becoming 40 divergent ones. NOT the maths: no threshold, gate or size moved.',
    reconsiderIf:
      'Reconsider when a stop policy genuinely must differ on ONE bot — that is the moment the shared default becomes a blocker rather than a simplification. The cheapest route then is NOT 11 new columns but promoting `scope` for the single mechanism that needs it, because `fields` already exists to carry the columns.',
    issue: 990,
  },
  {
    id: 'bot-timeframe-is-display-only',
    raisedAt: '2026-09-24',
    raisedBy: 'Copilot, reading `bot-rules.ts`',
    area: 'ui',
    title: 'A bot declares a timeframe that readiness does not use',
    observation:
      '`trading_strategy.timeframe` is declared `display-only`: it is surfaced on the bot list, but data readiness compares the PROTOCOL’s declared timeframe instead.',
    why:
      'The create form invites a choice that has no effect, so a bot whose timeframe disagrees with its protocol reads as ready on the protocol’s cadence. That is the declared-but-unenforced class the truth view exists to expose — correctly labelled there, but the form still offers it.',
    evidence: {
      basis: 'code-read',
      n: null,
      detail:
        '`bot-rules.ts` declares `timeframe` as `enforcement: \'display-only\'` with the caveat that readiness uses the protocol cadence; the create form still renders the control.',
      source: 'This repo — nest/src/modules/trading/bot-rules.ts',
      observedAt: '2026-09-24',
    },
    status: 'raised',
    reconsiderIf:
      'Reconsider when a bot is run on a timeframe its protocol does not declare, or when readiness is asked to be per-bot — either makes this a live disagreement rather than a label.',
  },
  {
    id: 'design-observations-have-no-home',
    raisedAt: '2026-09-24',
    raisedBy: 'Copilot, answering the owner’s question about observations',
    area: 'process',
    title: 'There was no home for a design observation',
    observation:
      'The repo had a home for decisions (the review queue), for blockers (the attention board), for work (issues) and for predictions (the theory registry) — but none for “this mechanism exists and has no surface” or “reconsider this design”.',
    why:
      'An observation with no home lands in a code comment. That is durable and visible to the next person editing that file, and invisible to the only person who reconsiders designs — which is the person the observation is for. The cost is not a lost fact; it is a *re-opened* decision, because the reasoning was never in front of anyone.',
    evidence: {
      basis: 'measurement',
      n: 4,
      detail:
        'Four homes were enumerated and checked for this specific finding: review queue, attention board, GitHub issue, theory registry. None held it; the Decision Trail `OBSERVED` status was checked and is a different class (a SCORING decision with no consumer, per `decision-trail-view.js`).',
      source: 'This repo — .github/REVIEW-QUEUE.md, .github/AGENT-ATTENTION.md, src/core/decision-trail-view.js',
      observedAt: '2026-09-24',
    },
    status: 'decided',
    decision:
      'BUILT — this register. The owner answered review row R21 “new register” on 2026-09-24, choosing a dedicated register over a second section in the review queue, accepting that observations should be able to accumulate BEFORE they become decisions. ⚠️ The register is the decision; whether it stays depends on it being read, which is why every row carries `reconsiderIf` rather than just a description.',
    reconsiderIf:
      'Reconsider if this register stops being read, or if it grows past a screenful of open rows — at that point the queue’s hard row limits are the better home and this should be collapsed into it rather than maintained alongside it.',
    issue: 990,
  },
];
