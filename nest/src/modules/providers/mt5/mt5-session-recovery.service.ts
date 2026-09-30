/**
 * Mt5SessionRecoveryService — recovers a bridge whose MT5 session died, FROM OUTSIDE (#992).
 * =========================================================================================
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT A DUPLICATE OF THE BRIDGE WATCHDOG
 * --------------------------------------------------------------------
 * #992 was found on 2026-09-25 when broker 2 lost its MT5 session and **trading halted silently**.
 * Nothing recovered it: `POST /reconnect` fixed it in ONE call (`connectionErrors` 485 → 0) and no
 * component was responsible for making that call. It cost about an hour of trading and needed a
 * human to go and find an endpoint they had to already know existed.
 *
 * ⚠️ **The bridge now has its own watchdog, and this is still not redundant — the issue says so
 * explicitly: "A and B are not the same fix and both are wanted."**
 *
 *   · **A — the bridge's own `connection_watchdog()`** (`mt5_bridge_v2.py`, #992, 2026-09-25).
 *     Recovers while the bridge can still *poll* MT5 — it notices the state change and rebuilds.
 *     ⚠️ **It is bounded on purpose and STOPS.** `WATCHDOG_TERMINAL_DOWN_MAX_ATTEMPTS = 5`: after
 *     five consecutive failures it stops escalating entirely, because reconnecting a switched-off
 *     terminal forever is a loop that hides the real remedy. **Once it stops, nothing ever tries
 *     again.**
 *   · **B — this service.** An observer that does not share the bridge's process, its interpreter or
 *     its backoff state. It acts only on the case the bridge can still SPEAK about and has given up
 *     on, and it never fights a bridge that is recovering on its own.
 *
 * ⚠️ **THE SIGNAL THIS ACTS ON DID NOT EXIST UNTIL #992's SECOND HALF.** `reachable` is
 * `ok && connected`, so `reachable: false` meant BOTH "the bridge did not answer" AND "the bridge
 * answered and its session is gone" — and those need opposite responses. Acting on the first by
 * posting `/reconnect` is pointless (nothing is listening); acting on neither is the defect. This
 * service therefore reads `answered` and `reachable` **separately**, which is precisely why
 * `Mt5BrokerInfo.answered` was added in the same change.
 *
 * ⚠️ WHY IT IS DELIBERATELY SLOW AND BOUNDED
 * -----------------------------------------
 * `POST /reconnect` runs `mt5.shutdown()` + `initialize()` — it TEARS DOWN a live session. Firing
 * it at a bridge that is merely mid-recovery would destroy a working link, so:
 *
 *   · it waits `FAILURES_BEFORE_ACTION` consecutive bad observations (3 × 30s = 90s);
 *   · it never acts when `answered === false` (the bridge must be able to ANSWER to be asked);
 *   · it backs off `ATTEMPT_COOLDOWN_MS` between attempts and STOPS after `MAX_ATTEMPTS`;
 *   · it resets on the first healthy observation, so a later outage starts fresh;
 *   · it logs on STATE CHANGE only — never once per poll.
 *
 * ⚠️ A KNOWN FAILURE MODE THIS CANNOT COVER, stated rather than implied: if the bridge's native MT5
 * call BLOCKS the interpreter, the bridge answers nothing and `answered === false` — so this service
 * does not fire, correctly. That is **#1000**, and `docs/SETTLED-DECISIONS.md` row 37 records why a
 * thread-based watchdog cannot cover it either. This service is not that fix.
 */

import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Mt5ConnectionManager } from './mt5-connection-manager.service';

export interface BridgeRecoveryRecord {
  brokerId: number;
  /** Consecutive observations where the bridge ANSWERED but its session is down. */
  consecutiveDown: number;
  /** Attempts made during the CURRENT outage. Reset by one healthy observation. */
  attempts: number;
  lastAttemptAt: string | null;
  /** Why we are not acting, when we are not. Never silent. */
  blockedReason: string | null;
  /** The bridge's own last stated state + remedy, carried so a reader does not re-derive it. */
  lastState: string | null;
  lastRemedy: string | null;
}

export interface SessionRecoveryState {
  enabled: boolean;
  pollCount: number;
  lastPollAt: string | null;
  /** One per configured bridge, so a bridge that is fine is as visible as one that is not. */
  bridges: BridgeRecoveryRecord[];
  /** Attempts since boot — the whole point is that this number is explainable. */
  totalAttempts: number;
  lastRecoveryAt: string | null;
  /**
   * Bridges that did not ANSWER. Separate from `bridges`, because the remedy is different
   * ("start it") and conflating the two is the defect this whole change exists to remove.
   */
  unansweringBrokerIds: number[];
}

@Injectable()
export class Mt5SessionRecoveryService {
  // ── DECISION (2026-09-30, primary) ──
  // WHAT:      TWO recovery mechanisms are kept ON PURPOSE — the bridge's own watchdog (A) and this
  //            service (B). Neither replaces the other, and B must not be deleted as redundant.
  // WHY:       A recovers while the bridge can still POLL MT5, and it is BOUNDED deliberately:
  //            `WATCHDOG_TERMINAL_DOWN_MAX_ATTEMPTS = 5`, after which it stops escalating and never
  //            tries again, because reconnecting a switched-off terminal forever hides the real
  //            remedy. **Once A stops, nothing ever tries again** — and on 2026-09-25 that cost
  //            ~1 hour of trading while the bridge logged 4,325 lines and named no remedy. B is an
  //            observer outside that process, acting on the case A can still SPEAK about and has
  //            given up on.
  // INSTEAD OF: making the bridge's watchdog unbounded (which is the loop A refuses to be), or
  //            folding B's retry into A (which shares A's fate — same process, same interpreter).
  // REVERSE BY: delete this service and its module registration. Do NOT do that on the grounds that
  //            "the bridge already has a watchdog" — read the bound above first.
  // REGISTER:  docs/SETTLED-DECISIONS.md row 48 (and row 37 for the failure mode B cannot cover)
  // GUARD:     nest/src/modules/providers/mt5/mt5-session-recovery.spec.ts (7 tests, canaried in
  //            three directions: threshold, the `answered` branch, and the attempt cap)
  private readonly logger = new Logger(Mt5SessionRecoveryService.name);

  /** 3 × 30s = 90s of a bridge saying "my session is gone" before we touch it. */
  private readonly FAILURES_BEFORE_ACTION = 3;
  /** Spacing between our attempts, so a stubborn bridge is not hammered. */
  private readonly ATTEMPT_COOLDOWN_MS = 5 * 60_000;
  /** After this many attempts in ONE outage, stop and say so — mirroring the bridge's own bound. */
  private readonly MAX_ATTEMPTS = 5;

  private readonly records = new Map<number, BridgeRecoveryRecord>();
  private readonly unanswering = new Set<number>();
  /** The last state we LOGGED, per bridge — logging is driven by changes in this, nothing else. */
  private readonly lastLoggedState = new Map<number, string>();

  private polling = false;

  state: SessionRecoveryState = {
    enabled: true,
    pollCount: 0,
    lastPollAt: null,
    bridges: [],
    totalAttempts: 0,
    lastRecoveryAt: null,
    unansweringBrokerIds: [],
  };

  constructor(private readonly mt5Connection: Mt5ConnectionManager) {}

  /** Observe every bridge. Deliberately NOT `@Cron` — this must run on bridge-time, not wall-time. */
  @Interval(30_000)
  async poll(): Promise<void> {
    if (!this.state.enabled || this.polling) return;
    this.polling = true;
    try {
      await this.evaluate();
    } catch (err) {
      // A recovery mechanism that throws must not take the tick down with it.
      this.logger.error(`Session recovery poll failed: ${(err as Error).message}`);
    } finally {
      this.polling = false;
      this.state.pollCount++;
      this.state.lastPollAt = new Date().toISOString();
      this.syncState();
    }
  }

  /**
   * Publish the working maps onto `state`, so `getState()` is honest for EVERY caller.
   *
   * ⚠️ Found by the spec, not by reading: this used to run only inside `poll()`, so any direct
   * `evaluate()` — which is exactly what a test or an on-demand route does — left `getState()`
   * reporting an EMPTY `bridges`/`unansweringBrokerIds` while the watchdog had in fact just seen a
   * dead session. A status surface that reads as "nothing is wrong" during the one condition it
   * exists to report is the defect this issue is about, one level down.
   */
  private syncState(): void {
    this.state.bridges = [...this.records.values()];
    this.state.unansweringBrokerIds = [...this.unanswering];
  }

  /** Evaluate once, on demand — the same code the interval runs, so a test drives the real path. */
  async evaluate(): Promise<void> {
    const healths = await this.mt5Connection.getAllBrokerHealths();

    for (const h of healths) {
      const brokerId = h.brokerId;
      const rec = this.records.get(brokerId) ?? {
        brokerId,
        consecutiveDown: 0,
        attempts: 0,
        lastAttemptAt: null,
        blockedReason: null,
        lastState: null,
        lastRemedy: null,
      };

      // ── The bridge did not answer. Reconnecting CANNOT help; starting it can. ──
      if (!h.answered) {
        this.unanswering.add(brokerId);
        rec.consecutiveDown = 0;
        rec.blockedReason = 'bridge did not answer — POST /reconnect cannot help; the bridge is not running';
        rec.lastState = null;
        rec.lastRemedy = 'Start the bridge: cd scripts/mt5-bridge && python mt5_bridge_v2.py';
        this.logOnce(brokerId, 'unanswered', `broker ${brokerId}: bridge did not answer (no /health reply)`);
        this.records.set(brokerId, rec);
        continue;
      }

      this.unanswering.delete(brokerId);
      rec.lastState = h.connectionState ?? null;
      rec.lastRemedy = h.remedy ?? null;

      // ── Healthy: reset the whole record so a LATER outage starts from zero. ──
      if (h.reachable) {
        const wasAttempting = rec.attempts > 0 || rec.consecutiveDown >= this.FAILURES_BEFORE_ACTION;
        if (wasAttempting) {
          this.state.lastRecoveryAt = new Date().toISOString();
          this.logger.log(
            `MT5 session recovered on broker ${brokerId} (was state='${rec.lastState ?? '?'}', ` +
              `${rec.attempts} attempt(s) made this outage)`,
          );
        }
        rec.consecutiveDown = 0;
        rec.attempts = 0;
        rec.blockedReason = null;
        this.logOnce(brokerId, 'ok', `broker ${brokerId}: MT5 session healthy`);
        this.records.set(brokerId, rec);
        continue;
      }

      // ── Answered, and its session is gone. THE RECOVERABLE CASE. ──
      rec.consecutiveDown++;

      if (rec.consecutiveDown < this.FAILURES_BEFORE_ACTION) {
        rec.blockedReason = `waiting — ${rec.consecutiveDown}/${this.FAILURES_BEFORE_ACTION} consecutive bad observations`;
        this.records.set(brokerId, rec);
        continue;
      }

      if (rec.attempts >= this.MAX_ATTEMPTS) {
        rec.blockedReason =
          `stopped after ${this.MAX_ATTEMPTS} attempts this outage — reconnecting is not fixing it, ` +
          `so the remedy is the bridge's own: ${rec.lastRemedy ?? 'start the MT5 terminal'}`;
        this.logOnce(
          brokerId,
          'exhausted',
          `broker ${brokerId}: session still down after ${this.MAX_ATTEMPTS} reconnect attempts — ` +
            `NOT retrying again this outage. state='${rec.lastState ?? '?'}'. Remedy: ` +
            `${rec.lastRemedy ?? 'start the MT5 terminal'}`,
        );
        this.records.set(brokerId, rec);
        continue;
      }

      if (rec.lastAttemptAt && Date.now() - Date.parse(rec.lastAttemptAt) < this.ATTEMPT_COOLDOWN_MS) {
        const waitS = Math.ceil(
          (this.ATTEMPT_COOLDOWN_MS - (Date.now() - Date.parse(rec.lastAttemptAt))) / 1000,
        );
        rec.blockedReason = `cooldown — next attempt in ${waitS}s`;
        this.records.set(brokerId, rec);
        continue;
      }

      // ── Act. Bounded, observable, and announced BEFORE it happens. ──
      rec.attempts++;
      rec.lastAttemptAt = new Date().toISOString();
      rec.blockedReason = null;
      this.state.totalAttempts++;

      this.logger.warn(
        `MT5 session down on broker ${brokerId} (state='${rec.lastState ?? '?'}', ` +
          `${rec.consecutiveDown} consecutive observations) — attempting reconnect ` +
          `${rec.attempts}/${this.MAX_ATTEMPTS}`,
      );

      const result = await this.mt5Connection.reconnectBroker(brokerId);
      if (result.success) {
        this.logger.log(
          `MT5 session recovered on broker ${brokerId} by the recovery watchdog ` +
            `(state now '${result.connectionState ?? '?'}') — no human was needed`,
        );
        this.state.lastRecoveryAt = new Date().toISOString();
      } else {
        this.logger.error(
          `Reconnect FAILED on broker ${brokerId}: ${result.error ?? 'unknown'}` +
            (result.instructions ? ` — ${result.instructions}` : ''),
        );
      }
      this.logOnce(brokerId, `down:${rec.attempts}`, `broker ${brokerId}: reconnect attempt ${rec.attempts} completed`);
      this.records.set(brokerId, rec);
    }

    this.syncState();
  }

  /**
   * Log ONLY when the state for that bridge CHANGES.
   *
   * ⚠️ This is the second half of #992, and it is not cosmetic. The original outage produced
   * **4,325** identical `terminal not connected` lines and **not one** mentioning the remedy: the
   * log stated the problem four times a minute and never said what to do. State-change logging is
   * how the remedy becomes readable — the bridge's own watchdog uses the same rule for the same
   * reason.
   */
  private logOnce(brokerId: number, key: string, message: string): void {
    if (this.lastLoggedState.get(brokerId) === key) return;
    this.lastLoggedState.set(brokerId, key);
    this.logger.log(message);
  }

  getState(): SessionRecoveryState {
    return { ...this.state, bridges: [...this.records.values()] };
  }

  /** Off switch — a recovery mechanism that can be aimed at a live session needs one. */
  setEnabled(enabled: boolean): SessionRecoveryState {
    this.state.enabled = enabled;
    this.logger.warn(`MT5 session recovery ${enabled ? 'ENABLED' : 'DISABLED'} by request`);
    return this.getState();
  }
}
