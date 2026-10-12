/**
 * signal-card-view.js — pure helpers for rendering / forming a SIGNAL card.
 * ========================================================================
 * Extracted from `SignalsOverviewPage.jsx` (2026-09-17) so the META.Stack Cockpit's
 * Signals column can re-display the same cards from the same code, per
 * `shared-core.instructions.md` ("a second implementation is the most expensive kind
 * of technical debt").
 *
 * `directionLabel` and `topDirectives` were extracted rather than copied because
 * BOTH card variants consume them — card A renders direction chips and directive
 * chips, card B renders the direction chip and puts directives into the plan
 * context. A second copy would let the two variants disagree about the same data.
 *
 * `buildNotices` is the one that matters most: it is what makes a blocker, a warning
 * and a conflict render through ONE uniform list instead of three ad-hoc styles.
 * If the cockpit grew its own version, the same condition would look different on
 * two pages — and the notice CODE is the thing a user quotes in a bug report.
 *
 * No React, no DOM — pure functions, safe to call from any page.
 */
import { notice } from './notices/registry';
import { stripWarningGlyph } from './signal-utils';

/**
 * The ONE refresh cadence for signal data.
 *
 * Exported so the page's list query and the per-card action query cannot drift
 * apart. They were separate literals before (both `60_000`) — two numbers that had
 * to agree by convention alone.
 */
export const SIGNAL_REFRESH_MS = 60_000;

/**
 * Dismissal horizon in hours — Screen Option 'Dismissal Window' (#684).
 *
 * Moved here from `SignalsOverviewPage` so the META.Stack Cockpit dismisses for the SAME
 * window the user configured. A locally-defaulted value would have silently ignored the
 * Screen Option, and the two pages would disagree about a user preference.
 */
export function readDismissHours() {
  const v = parseInt(localStorage.getItem('sig-dismiss-hours') || '1', 10);
  return Number.isFinite(v) && v >= 1 && v <= 168 ? v : 1;
}

/** Direction chip label from a protocol's direction intent. */
export function directionLabel(mode) {
  if (mode === 'SHORT_ONLY') return { label: 'SHORT', cls: 'short' };
  if (mode === 'BOTH') return { label: 'L/S', cls: 'both' };
  return { label: 'LONG', cls: 'long' };
}

/** Top directives across all groups, best-normalized first (max 3). */
export function topDirectives(envelope) {
  const all = [];
  for (const g of envelope.groups || []) {
    for (const d of g.topDirectives || []) all.push(d);
  }
  return all.sort((a, b) => b.normalized - a.normalized).slice(0, 3);
}

/** Round a percentage to a whole number for display (avoids 55.555…%). */
export function roundPct(v) { return v == null ? null : Math.round(v); }

/**
 * Normalise every blocker/warning/conflict into ONE uniform notice list so the
 * card never mixes ad-hoc styles.
 *
 * #826 Phase 2 — each entry is a rendered REGISTRY NOTICE (code + severity + wording)
 * rather than `{severity, text, title}` prose. The server still supplies the raw reason
 * for blockers, warnings and conflicts, so it is passed through as a notice PARAM
 * (`reason`/`warning`/`description`) — the code gives the condition an identity while
 * the server's own wording is preserved verbatim inside it.
 */
export function buildNotices(envelope) {
  const out = [];
  const add = (n) => { if (n) out.push(n); };

  // Execution feasibility (blocks the trade) — most important, shown first. The bot name is
  // context the registry cannot know, so it is prepended to the reason rather than replacing the
  // notice's own title.
  (envelope.executionBlockers || []).forEach((b) =>
    add(notice('TCS-RISK-001', {
      reason: [envelope.botName, b.message, b.hint].filter(Boolean).join(' · '),
    })));
  // Pre-trade block (duplicate/cooldown etc).
  if ((envelope.preTradeBlockers || []).length) {
    add(notice('TCS-RISK-001', { reason: envelope.preTradeBlockers.slice(0, 2).join(' · ') }));
  }
  // The BOT VERDICT (#911 → single service, 2026-10-12) — "no bot will take it", generated
  // server-side ONCE (`signal-envelope.service.ts` → `botGate`) and rendered verbatim.
  // `notice` is false when the below-gate blocker already carries the same sentence (one fact, one
  // sentence) and false for `clear`/`unknown` — this is a display explanation, never a new block.
  if (envelope.botGate?.notice && envelope.botGate.sentence) {
    add(notice('TCS-RISK-004', { reason: envelope.botGate.sentence }));
  }
  // Risk-gate warnings — the gate's own wording is the message.
  (envelope.riskGate?.warnings || []).map(stripWarningGlyph).slice(0, 2).forEach((w) =>
    add(notice('TCS-RISK-003', { warning: w })));
  // Directive conflicts — low/med = info, high = warning. The registry entry carries a fixed
  // severity, so a HIGH conflict is reported with its own code/severity rather than re-coloured here.
  (envelope.conflicts || []).forEach((c) =>
    add(notice('TCS-RISK-002', { description: c.description, type: c.type, severity: c.severity })));
  return out;
}

// ⚠️ `tradeReadiness()` deliberately lives in `./signal-utils`, NOT here (#935).
// This module imports `./notices/registry` extensionless, which Node's ESM resolver cannot load —
// so anything defined here cannot be unit-tested with `node --test`, and a verdict that cannot be
// tested is a verdict that cannot be guarded. `signal-utils` has no such import.
