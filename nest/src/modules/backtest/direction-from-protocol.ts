/**
 * direction-from-protocol.ts — WHICH SIDE A RUN OPENS, when the caller did not say.
 *
 * ── THE DEFECT THIS CLOSES (measured 2026-11-19) ─────────────────────────────────────────────────
 * `backtest.service.run()` defaulted `directionMode` to `'long'` unconditionally. So a **SHORT**
 * protocol backtested without an explicit direction ran with the wrong side, `decideEntry()` discarded
 * every `SELL`/`STRONG_SELL` as `blockedBy: 'direction-mode'`, and the run returned a **successful,
 * complete result with zero trades**. Every counter agreed with that reading:
 *
 *     totalSignals: 0 · tradesRefusedUnaffordable: 0 · signalsWithoutTrade: 0
 *     breakEvenUnavailable: "no-trades"
 *
 * Measured on `movers-losers-2026-11-10` / APPS / 5m, same bars and same protocol:
 *
 * | request | trades |
 * |---|---|
 * | no `directionMode` | **0** |
 * | `directionMode: 'short'` | **173** |
 *
 * Nothing threw. "This strategy never trades" is indistinguishable from "the run was pointed the wrong
 * way", which is the failure shape this repo designs against.
 *
 * ── WHY DERIVING IS NOT COERCION ────────────────────────────────────────────────────────────────
 * A `SHORT_ONLY` protocol run long blocks 100% of its own signals, so there is **no configuration in
 * which the old default measured anything**. The protocol's declared direction is the only side the
 * caller can have meant. An EXPLICIT request always wins untouched, so a deliberate contrarian run
 * (`SHORT_ONLY` measured long) still works and still records what was asked for.
 *
 * ⚠️ **UNKNOWN IS NOT LONG.** A protocol whose direction cannot be read falls back to `'long'` — but
 * `'long'` is the historical default and is kept so existing callers are unchanged, NOT because it is
 * a safe inference. The caller is warned at the site when the read fails, so "cannot judge" is
 * reported rather than silently rendered as a decision.
 *
 * This is a pure function, extracted from the service for the same reason `entry-side.ts` was: the
 * decision lived behind Prisma and a bar loader, so the one thing that can silently empty a run had no
 * assertion. `direction-from-protocol.spec.ts` pins every branch.
 */

export type RunDirection = 'long' | 'short' | 'both';

/**
 * ── DECISION (2026-11-19, TCS-Dev) ──
 * WHAT:       A backtest's side is DERIVED from the protocol's own `directionMode` when the caller
 *             omits it. An explicit request always wins untouched.
 * WHY:        `run()` defaulted to 'long', so a short protocol ran with the wrong side and every
 *             SELL/STRONG_SELL was discarded as `blockedBy: 'direction-mode'` — returning a
 *             complete result with ZERO trades where every counter agreed with "never trades".
 *             Measured on movers-losers-2026-11-10 / APPS / 5m: 0 trades without a direction,
 *             173 with it, same bars and protocol. A SHORT_ONLY protocol run long blocks 100% of
 *             its own signals, so the old default measured nothing in any configuration.
 * INSTEAD OF: Refusing when the field is absent, which breaks every existing long caller that omits
 *             it and punishes the working case to protect the broken one.
 * REVERSE BY: Restoring `directionMode = 'long'` at the destructure in `backtest.service.ts` and
 *             deleting the `resolveDirectionMode` call. Nothing is stored or migrated.
 * REGISTER:  docs/SETTLED-DECISIONS.md row 214
 * GUARD:     nest/src/modules/backtest/direction-from-protocol.spec.ts
 */

/**
 * @param requested          the caller's explicit `directionMode`, if any. ALWAYS wins.
 * @param protocolDirection  the protocol's own `direction`/`directionMode` column — `LONG_ONLY`,
 *                           `SHORT_ONLY`, already-usable lowercase, or null/undefined when unknown.
 */
export function directionFromProtocol(
  requested: RunDirection | undefined | null,
  protocolDirection: string | null | undefined,
): RunDirection {
  if (requested) return requested;

  const declared = String(protocolDirection ?? '').trim().toUpperCase();
  if (declared === 'SHORT_ONLY' || declared === 'SHORT') return 'short';
  if (declared === 'LONG_ONLY' || declared === 'LONG') return 'long';

  // `BOTH` is deliberately NOT mapped to `'both'`: that mode is refused on the run path, and returning
  // it here would turn a refusal into a stored, unrunnable configuration.
  return 'long';
}
