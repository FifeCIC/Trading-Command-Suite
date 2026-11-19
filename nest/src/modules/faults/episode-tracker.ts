/**
 * EpisodeTracker — what turns a POLL into an EPISODE.
 *
 * ⚠️ WHY THIS EXISTS SEPARATELY, AND WHY IT IS NOT JUST A `Set` IN THE CALLER.
 * A fault's `count` is only meaningful if it counts *episodes*: "this bridge has dropped 4 times
 * today" is a measurement, while "this poll observed a broken bridge 1,440 times" is a measure of
 * how often the poller ran — a number that grows fastest while the app is working and says nothing
 * about the fault. Every writer therefore has to answer one question: *is this the same episode as
 * last time, or a new one?*
 *
 * That question is repeated in each caller, so it lives here once and is tested once. The precedents
 * that make the distinction load-bearing:
 *   · `ProviderDegradationService` counts on a `healthy|degraded → failed` TRANSITION, not per error.
 *   · `alert-trigger.service.ts` polls ~15 conditions every 60 s; recording per poll would have made
 *     `TCS-ALERT-DATA-STALENESS` reach ~500 a day for one stuck symbol.
 *
 * ⚠️ `quiet` is the only branch that CLEARS state, and it must be reached on every non-triggering
 * poll — otherwise a condition that ends and later returns is never counted a second time, and the
 * recurrence this registry exists to record is silently lost.
 */
/**
 * Which alert triggers are FAULTS, and which are merely CONDITIONS worth noticing.
 *
 * ⚠️ MEASURED 2026-11-19, on the first hour of live data: recording every firing alert produced six
 * open faults, and **three of them were not faults at all** — "5 earnings events in the next 24h", "8
 * positions past −50%", "margin at 50.0% of equity". Those are market and risk notices: the system is
 * WORKING when they fire. Only the other three named something broken.
 *
 * Without this line the registry becomes a second alert list with a permanent tail — the exact bloat
 * `docs/FAULT-TAXONOMY-GUARDRAILS.md` exists to prevent, and the thing the owner asked to be
 * protected from ("a huge amount of tests being built and how we'll keep coming back to them").
 *
 * THE TEST, and it is the only one that matters: **is there a path that should work and does not?**
 *   · mt5-disconnected     — the bridge path is broken
 *   · bridge-clock-skew    — the timestamp path is broken
 *   · provider-degraded    — an external path is failing
 *   · data-staleness       — the bar path is delivering nothing new
 *   · symbol-silent        — scoring works, execution never happens: a broken path
 *   · trade-disabled       — order placement is refused
 * Everything else (P&L, margin, earnings, market hours, swap, gap risk) is the market being the market.
 */
export const FAULT_WORTHY_TRIGGERS = new Set([
  'mt5-disconnected',
  'bridge-clock-skew',
  'provider-degraded',
  'data-staleness',
  'symbol-silent',
  'trade-disabled',
]);

/** Kept as a function so the classification is one call site and can be tested in both directions. */
export function isFaultWorthy(triggerKey: string): boolean {
  return FAULT_WORTHY_TRIGGERS.has(triggerKey);
}

export type EpisodeEvent =
  /** The condition was false and is now true — count this. */
  | 'started'
  /** Still true; the same episode. The fault's `lastSeen` may move, but `count` must not. */
  | 'ongoing'
  /** The condition is not (or no longer) true. */
  | 'quiet';

export class EpisodeTracker {
  private readonly active = new Set<string>();

  /** Feed it every observation, active or not. Returns what just happened. */
  observe(key: string, isActive: boolean): EpisodeEvent {
    if (!isActive) {
      this.active.delete(key);
      return 'quiet';
    }
    if (this.active.has(key)) return 'ongoing';
    this.active.add(key);
    return 'started';
  }

  /**
   * Mark keys as already active WITHOUT counting them.
   *
   * ⚠️ WHY THIS EXISTS — measured 2026-11-19. Episode state is in memory, so the first observation
   * after a restart looked like a brand-new episode and incremented `count`: a rebuild took all four
   * `TCS-ALERT-*` faults from ×1 to ×2 with nothing having changed in the world. Left alone, `count`
   * becomes a count of DEPLOYS. So at boot the caller adopts the faults that were seen recently and
   * are still open, and their next observation is 'ongoing' (touch, no increment).
   *
   * ⚠️ The window matters and is the caller's decision, not this class's: adopting a fault last seen
   * three days ago would silently swallow a genuine recurrence. Adopt only what could plausibly have
   * been running while the process was down.
   */
  adopt(keys: string[]): void {
    for (const k of keys) this.active.add(k);
  }

  /** Exposed so a caller can report "what is failing right now" without tracking it separately. */
  activeKeys(): string[] {
    return [...this.active];
  }
}
