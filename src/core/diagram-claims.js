/**
 * diagram-claims.js — machine-checkable assertions about the diagrams on /lab/diagrams.
 *
 * ── THE PROBLEM ──────────────────────────────────────────────────────────────
 * Every diagram on that page is a set of CLAIMS about the running system: this
 * threshold, that route, N of those. The claims are prose inside a mermaid string,
 * so a claim that has gone stale is rendered identically to one that is still true.
 * That is why the page carries a "CONCEPTUAL REFERENCE ONLY — may not reflect
 * current implementation" banner: it is an honest disclaimer standing in for a
 * missing check.
 *
 * Measured 2026-09-21, that banner is load-bearing. Four examples from 33 diagrams:
 *   • `signal-state-machine` prints ">= 80 STRONG, 40 - 79 BUY/SELL, < 40 HOLD".
 *     Live `GET /api/scoring/gated/thresholds` returns { entry: 6, strong: 13 }.
 *     The chart teaches a ~6x-wrong boundary to every reader AND every AI agent.
 *   • `sees-automation` prints "42 protocols"; the live count is 45.
 *   • `protocol-calendar` (32), `metastack-product` (37) and `data-flow-architecture`
 *     (32) print three MORE protocol counts — four diagrams, four different numbers.
 *   • `component-arch` says "80+ pages" (actual 166) and `data-arch` says "70+ models"
 *     (actual 113). A LOWER-BOUND claim can never become false, so nothing catches it
 *     becoming useless — "80+" is not wrong at 166, it is just no longer information.
 *
 * ── THE IDEA ────────────────────────────────────────────────────────────────
 * A declaration is not validated by being well-formed, only by being checked against
 * the thing it names. So: declare each claim together with the SOURCE that decides it,
 * evaluate that source at render time, and let the DIAGRAM ITSELF carry the result —
 * a node whose claim fails is stroked in the conflict colour, and the panel names both
 * the documented value and the live one. The picture stops being able to be wrong
 * silently.
 *
 * This generalises the pre-existing `#493` strip on the page, which DISPLAYS four live
 * numbers for two hardcoded diagrams but compares them to nothing. Extending that idea
 * rather than adding a second one.
 *
 * ── SCOPE, STATED HONESTLY ──────────────────────────────────────────────────
 * Only the claims listed here are checked. A diagram with four registered claims has
 * four checked statements and dozens of unchecked ones, so the panel reports "N of M"
 * rather than implying the whole diagram is verified. An unprobed claim is reported as
 * UNVERIFIED, never as passing — a check that inspects nothing must never report OK.
 *
 * ── HOW TO EXTEND ───────────────────────────────────────────────────────────
 * Key by diagram id (the `id:` field in DiagramsPage's DIAGRAMS array). `expect` must
 * be what the DIAGRAM says, NOT what is correct — the whole point is to catch the
 * diagram being wrong. When a claim fails you fix the diagram or the code; you never
 * "fix" it by pasting the live value into `expect`, because that converts a probe into
 * a rubber stamp and the next drift goes unnoticed.
 *
 * `node` must be a real mermaid node id in that diagram. If it is not, the claim is
 * reported as a conflict in its own right: the claim has outlived the shape it described.
 */

/** Read `a.b.c` out of a response without throwing on a missing branch. */
export function pickPath(obj, path) {
  if (!path) return undefined;
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/** Best-effort "how many things does this response describe". */
export function countOf(data) {
  if (Array.isArray(data)) return data.length;
  if (!data || typeof data !== 'object') return null;
  if (Array.isArray(data.protocols)) return data.protocols.length;
  if (Array.isArray(data.strategies)) return data.strategies.length;
  if (typeof data.count === 'number') return data.count;
  if (typeof data.total === 'number') return data.total;
  return null;
}

/**
 * Does the diagram's mermaid source still declare this node?
 * Guards against a claim that references a node someone has since renamed — which is
 * exactly how a verification panel silently stops covering anything.
 */
export function nodeExistsInSource(source, node) {
  if (!source || !node) return false;
  return new RegExp(`(^|[^\\w])${node}\\s*(\\[|\\(|\\{|-->|--|:::|=)`).test(source);
}

/**
 * The claims registry.
 * `node`   — mermaid node id the claim is about
 * `says`   — what the diagram asserts, in words
 * `expect` — the documented value (what the DIAGRAM says, not what is true)
 * `probe`  — how to ask the running system: { api, pick } or { api, count }
 * `note`   — what is actually true, when it differs (context for the reader)
 */
export const DIAGRAM_CLAIMS = {
  'signal-state-machine': [
    {
      node: 'PCT',
      says: 'classification is a percentage of configured directional capacity (ADR-011), not a raw score',
      expect: 'percent of CONFIGURED directional capacity (ADR-011)',
      probe: { api: '/api/scoring/gated/thresholds', pick: 'classification.scale' },
    },
    {
      node: 'STRONG',
      says: 'STRONG_BUY / STRONG_SELL at >= 80%',
      expect: 80,
      probe: { api: '/api/scoring/gated/thresholds', pick: 'classification.strong' },
      note: 'STRONG_PCT was rescaled to 13 on 2026-09-15 (comment above STRONG_PCT in protocol-gating.service.ts).',
    },
    {
      node: 'TRADE',
      says: 'BUY / SELL from 40% up',
      expect: 40,
      probe: { api: '/api/scoring/gated/thresholds', pick: 'classification.entry' },
      note: 'ENTRY_THRESHOLD is 6.',
    },
    {
      node: 'HOLD',
      says: 'HOLD below 40%',
      expect: 40,
      probe: { api: '/api/scoring/gated/thresholds', pick: 'classification.entry' },
      note: 'The HOLD boundary follows ENTRY_THRESHOLD, which is 6.',
    },
  ],

  'sees-automation': [
    {
      node: 'A4',
      says: 'there are 42 protocols',
      expect: 42,
      probe: { api: '/api/scoring/gated/protocols', count: true },
      note: 'Three other diagrams claim 32, 32 and 37 for this same number.',
    },
  ],

  // ── Not yet claimed (needs the node ids confirmed first, see the header) ──────
  //   scoring-gating      — BUY >= 65 / HOLD >= 35 / SELL < 35  (same stale scale)
  //   protocol-calendar   — 32 total protocols / 32 total protocols
  //   metastack-product   — 37 protocols in PROTOCOL_REGISTRY
  //   data-flow-architecture — 32 protocols, and Macro/Social/Insider "schema only"
  //   metastack-rating    — trade.scoringStrategyId as the attribution key, which
  //                         holds a BOT id, not a scoring_strategy id
  //   seasonality-heatmap — bridge port 5001, while mt5-execution says 5000
  //                         (both answer /health, which is itself the #883 defect)
};

export function claimsFor(diagramId) {
  return DIAGRAM_CLAIMS[diagramId] || [];
}

/**
 * Colour the diagram from its own verification result.
 * Appends mermaid classDef/class lines so the node a failed claim is about is stroked
 * in the conflict colour — the failure is visible IN the picture, not only beside it.
 */
export function annotateSource(diagramId, source, results) {
  if (!results || !results.length) return source;
  const bad = [...new Set(results.filter((r) => r.ok === false).map((r) => r.node))];
  const ok = [...new Set(results.filter((r) => r.ok === true).map((r) => r.node))].filter(
    (n) => !bad.includes(n),
  );
  let out = source;
  out += '\n  classDef claimOk stroke:#22c55e,stroke-width:3px';
  out += '\n  classDef claimBad stroke:#ef4444,stroke-width:3px,stroke-dasharray:5 3';
  for (const n of bad) out += `\n  class ${n} claimBad`;
  for (const n of ok) out += `\n  class ${n} claimOk`;
  return out;
}

/**
 * Evaluate every claim registered for a diagram.
 * @param diagramId  the DIAGRAMS entry id
 * @param source     the diagram's mermaid source (for the node-existence check)
 * @param getJson    a function (path) => Promise<data>. Pass `apiGet` in the browser
 *                   and a fetch wrapper in Node, so one definition serves both.
 * @returns [{ ...claim, actual, ok, error }] — ok is true / false / null (null = unprobed)
 */
export async function evaluateClaims(diagramId, source, getJson) {
  const claims = claimsFor(diagramId);
  const out = [];
  for (const claim of claims) {
    const row = { ...claim, actual: null, ok: null, error: null };

    if (!nodeExistsInSource(source, claim.node)) {
      row.ok = false;
      row.error = `the diagram has no node "${claim.node}" — this claim outlived the shape it described`;
      out.push(row);
      continue;
    }

    try {
      const data = await getJson(claim.probe.api);
      row.actual = claim.probe.count ? countOf(data) : pickPath(data, claim.probe.pick);
      if (row.actual == null) {
        // The endpoint answered but the value has moved. That means the claim cannot be
        // CHECKED — not that the diagram is wrong. Left as unverified on purpose: calling
        // it a conflict would assert the diagram is at fault when the probe may simply be
        // reading a field someone renamed.
        row.error = 'the probe answered but found no value at that path — the claim cannot be checked';
      } else {
        row.ok = String(row.actual) === String(claim.expect);
        if (!row.ok && claim.note) row.error = claim.note;
      }
    } catch (e) {
      // A probe that cannot run is NOT a pass — it is an unverifiable claim, and the
      // panel must say so rather than showing a green tick next to an unchecked number.
      row.error = e?.message || 'probe failed to reach the API';
    }

    out.push(row);
  }
  return out;
}

/** Summary counts for the panel header. */
export function summarise(results) {
  const checked = results.filter((r) => r.ok !== null).length;
  const passed = results.filter((r) => r.ok === true).length;
  const failed = results.filter((r) => r.ok === false).length;
  const unverified = results.filter((r) => r.ok === null).length;
  return { total: results.length, checked, passed, failed, unverified };
}
