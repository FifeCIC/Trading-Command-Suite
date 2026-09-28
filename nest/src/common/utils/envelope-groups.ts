/**
 * envelope-groups.ts — shape a scored breakdown into the group panels the UI renders.
 *
 * WHY THIS IS A SHARED HELPER (#926 follow-up, 2026-09-28)
 * -------------------------------------------------------
 * `SignalEnvelopeService.buildGroups()` did this shaping privately, from a LIVE `GatedScore`. But
 * the same two inputs it reads — `breakouts` and `subScores` — are already PERSISTED inside
 * `score.breakdown`, which meant the symbol page could only get shaped groups by running a full
 * scoring pass to re-derive them.
 *
 * The symbol page did exactly that: 20 scoring runs to draw one screen, re-computing an assessment
 * that was already on disk.
 *
 * ⚠️ **This is an EXTRACTION, not a second implementation.** `buildGroups()` now calls it, so the
 * live envelope and the persisted reading cannot drift — which is the failure a copy would have
 * guaranteed: two shapings of the same data, only one of which gets the next fix.
 *
 * ⚠️ **The shape and ordering are load-bearing and deliberately unchanged:**
 *   - top 5 directives per group, by `normalizedScore` descending;
 *   - non-risk groups first (weight descending), risk groups last.
 * A reader compares panels across protocols, so a different order here would silently reorder every
 * page that renders this.
 */

/** The two fields this needs — a subset of `GatedScore` and of the persisted breakdown. */
export interface GroupShapingInput {
  /** groupId → that group's directive hits. */
  breakouts?: Record<string, any[]> | null;
  /** groupId → the group's own score. */
  subScores?: Record<string, number> | null;
}

export interface ShapedDirective {
  id: string;
  name: string;
  score: number;
  maxScore: number;
  normalized: number;
  signalClass: string;
  reason: string;
}

export interface ShapedGroup {
  groupId: string;
  groupName: string;
  score: number;
  weight: number;
  isRisk: boolean;
  topDirectives: ShapedDirective[];
}

/**
 * Group display metadata. ⚠️ `weight` here is DISPLAY weight for ordering the panels — it is NOT
 * the protocol's scoring weight, and must never be used as one.
 */
const GROUP_META: Record<string, { name: string; weight: number; isRisk: boolean }> = {
  technical: { name: 'Technical', weight: 40, isRisk: false },
  sentiment: { name: 'Sentiment', weight: 35, isRisk: false },
  risk: { name: 'Risk Gate', weight: 25, isRisk: true },
  macro: { name: 'Macro', weight: 20, isRisk: false },
  fundamental: { name: 'Fundamental', weight: 15, isRisk: false },
  exit: { name: 'Exit Signals', weight: 10, isRisk: true },
};

/**
 * Shape `breakouts` + `subScores` into ordered group panels.
 *
 * ⚠️ Returns `[]` for a breakdown that carries no breakouts — which is a real state (a
 * `preTradeReady`-only breakdown, 12 of the 4 measured key sets) and must render as "no directive
 * detail", never as a panel of zeroes.
 */
export function shapeEnvelopeGroups(input: GroupShapingInput): ShapedGroup[] {
  const breakouts = input?.breakouts ?? {};
  const subScores = input?.subScores ?? {};
  const groups: ShapedGroup[] = [];

  for (const [groupId, hits] of Object.entries(breakouts)) {
    if (!hits || hits.length === 0) continue;

    const meta = GROUP_META[groupId] || { name: groupId, weight: 0, isRisk: false };
    // ⚠️ `?? 50` is the pre-existing default and is kept verbatim: a group with no sub-score
    // renders mid-scale rather than as zero, which would read as "this group scored nothing".
    const score = subScores[groupId] ?? 50;

    // ⚠️ EXACT FIDELITY — no `?? 0` fallback was added here, deliberately. The original
    // (`SignalEnvelopeService.buildGroups`) compared `b.normalizedScore - a.normalizedScore`
    // directly, and an extraction that also "improves" something is not an extraction: it makes the
    // two paths differ on exactly the input nobody tests. If the fallback is wanted, it belongs in
    // its own change with its own evidence.
    const sorted = [...hits]
      .sort((a, b) => b.normalizedScore - a.normalizedScore)
      .slice(0, 5);

    groups.push({
      groupId,
      groupName: meta.name,
      score: Math.round(score),
      weight: meta.weight,
      isRisk: meta.isRisk,
      topDirectives: sorted.map((b) => ({
        id: b.directiveId,
        name: b.name,
        score: b.score,
        maxScore: b.maxScore,
        normalized: b.normalizedScore,
        signalClass: b.signalClass,
        reason: b.reason,
      })),
    });
  }

  // Non-risk first by weight desc, risk last — the ordering every existing page depends on.
  groups.sort((a, b) => {
    if (a.isRisk !== b.isRisk) return a.isRisk ? 1 : -1;
    return b.weight - a.weight;
  });

  return groups;
}
