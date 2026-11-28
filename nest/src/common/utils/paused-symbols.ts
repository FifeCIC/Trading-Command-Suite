/**
 * paused-symbols.ts — the one parser for a `pausedSymbols` JSON column.
 *
 * `protocol_score_status.pausedSymbols` holds `[{symbol,state,reason}]` — WHICH symbols a protocol
 * skipped because they are not tradeable in the current market state (#1359 follow-up). It is the
 * machine-readable half of the pause; the count is `symbolsPaused`.
 *
 * ⚠️ A malformed value degrades to `null`, never to `[]`. The count still reads, and `null` says
 * "the list could not be read" rather than "nothing was paused" — two different facts that a reader
 * must be able to tell apart.
 */
export interface PausedSymbol {
  symbol: string;
  state: string;
  reason: string;
}

export function parsePausedSymbols(raw: unknown): PausedSymbol[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(String(raw));
    return Array.isArray(parsed) ? (parsed as PausedSymbol[]) : null;
  } catch {
    return null;
  }
}
