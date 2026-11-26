/**
 * bot-resolution.ts — WHICH BOT a backtest measures, and WHY that one.
 *
 * ── THE DEFECT THIS REPLACES ─────────────────────────────────────────────────────────────────────
 * Measured 2026-11-26 on `movers-v1-long`: **five bots name the protocol**, all `active: 0`, four with
 * **no `strategy_protocol` subscription at all** — and the old rule was `active desc, updatedAt desc`.
 * So an unnamed run resolved to `Movers V1 Long — 2h hold (mechanism test)`, a throwaway probe created
 * for a mechanism question, because it had been EDITED most recently. The result then reported
 * `resolvedBy: 'auto'`, which reads as "the service found the strategy" and was in fact a timestamp.
 *
 * ⚠️ **A SUBSCRIPTION IS NOT A PREFERENCE — IT IS THE DIFFERENCE BETWEEN A BOT AND A CONFIGURATION.**
 * `SignalQueueService` routes by `strategy_protocol`; a bot without a row there can never receive a
 * signal, so its `slPct`/`tpPct`/`maxHoldHours` describe a configuration nothing has ever run. Ranking
 * it above a subscribed bot measures a hypothetical.
 *
 * ⚠️ And when two candidates are EQUAL on every rule, the tie is a decision nobody made — so it is
 * reported (`ambiguous: true`) rather than presented as a resolution. The winner is still returned, so
 * a caller is never blocked; it is just told the answer is a tiebreak on edit time.
 *
 * Files: consumed by `selection-run.service.ts`. Guard: `bot-resolution.spec.ts`.
 */

export interface BotCandidate {
  id: string;
  name: string;
  protocolId: string | null;
  shortProtocolId?: string | null;
  active: boolean;
  updatedAt: Date | string;
}

export interface BotResolution {
  /** How many bots name this protocol at all (primary or short leg). */
  candidateCount: number;
  /**
   * `true` when more than one candidate shares the winning rank, so `updatedAt` decided it.
   * That is a stated tiebreak, not a rule — a reader deciding whether to trust the numbers needs it.
   */
  ambiguous: boolean;
  /** Why the winner won, in the reader's language. Never empty. */
  reason: string;
  candidates: Array<{
    id: string;
    name: string;
    active: boolean;
    subscribed: boolean;
    /** Whether this bot names the protocol as its PRIMARY leg, not `shortProtocolId`. */
    primary: boolean;
    chosen: boolean;
  }>;
}

export interface BotResolutionResult<T> {
  bot: T | null;
  resolvedBy: 'auto' | 'explicit' | 'none';
  resolution: BotResolution;
}

const EMPTY: BotResolution = {
  candidateCount: 0,
  ambiguous: false,
  reason: 'no bot names this protocol, so the engine literals are what this run measures',
  candidates: [],
};

function time(value: Date | string): number {
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/**
 * rankBotCandidates() — pure, so the spec can drive every branch without a database.
 *
 * Order, and each level earns its place:
 *   1. **primary leg** — a bot naming this protocol as its SHORT leg is a different strategy;
 *   2. **active** — a live bot beats a retired one;
 *   3. **subscribed** — a bot the signal queue can actually reach beats a configuration that never runs;
 *   4. **updatedAt** — last, and reported when it is the only thing left.
 */
export function rankBotCandidates<T extends BotCandidate>(
  candidates: T[],
  opts: { protocolId: string; subscribedIds: Set<string> },
): BotResolutionResult<T> {
  if (!candidates.length) return { bot: null, resolvedBy: 'none', resolution: EMPTY };

  const primary = candidates.filter((c) => c.protocolId === opts.protocolId);
  // ⚠️ Falling back to short-leg bots is ALLOWED but it is said out loud — silently measuring a bot
  // that names the protocol as its short leg is how a long test acquires a short strategy.
  const usedPrimary = primary.length > 0;
  const poolIds = new Set((usedPrimary ? primary : candidates).map((c) => c.id));

  // ⚠️ EVERY candidate is listed — the pool is a subset — so a reader can see the bots that were not
  // eligible and why, rather than a list that quietly omits them.
  const scored = candidates.map((c) => ({
    candidate: c,
    primary: poolIds.has(c.id),
    active: c.active === true,
    subscribed: opts.subscribedIds.has(c.id),
    stamp: time(c.updatedAt),
  }));

  const ranked = scored
    .filter((s) => s.primary)
    .sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      if (a.subscribed !== b.subscribed) return a.subscribed ? -1 : 1;
      return b.stamp - a.stamp;
    });

  const winner = ranked[0];
  const tied = ranked.filter(
    (s) => s !== winner && s.active === winner.active && s.subscribed === winner.subscribed,
  );

  let reason: string;
  if (!usedPrimary) {
    reason = `no bot names this protocol as its primary leg; ranked ${ranked.length} bot(s) that name it as a short leg`;
  } else if (winner.active && tied.length === 0) {
    reason = 'the only active bot naming this protocol';
  } else if (winner.active) {
    reason = `active, and the most recently edited of ${tied.length + 1} active bots`;
  } else if (winner.subscribed && tied.length === 0) {
    reason = 'no bot naming this protocol is active; this one is the only one the signal queue is subscribed to';
  } else if (winner.subscribed) {
    reason = `no bot naming this protocol is active; subscribed, and the most recently edited of ${tied.length + 1} subscribed bots`;
  } else if (tied.length) {
    reason = `no bot naming this protocol is active or subscribed; this is the most recently edited of ${tied.length + 1} such bots — a tiebreak on edit time, not a rule`;
  } else {
    reason = 'no bot naming this protocol is active or subscribed';
  }

  return {
    bot: winner.candidate,
    resolvedBy: 'auto',
    resolution: {
      candidateCount: candidates.length,
      ambiguous: tied.length > 0,
      reason,
      candidates: scored.map((s) => ({
        id: s.candidate.id,
        name: s.candidate.name,
        active: s.active,
        subscribed: s.subscribed,
        primary: s.primary,
        chosen: s === winner,
      })),
    },
  };
}
