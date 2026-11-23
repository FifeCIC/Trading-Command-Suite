/**
 * bar-provider.ts — WHICH PUBLISHER'S BARS A RUN IS ALLOWED TO READ.
 *
 * ── THE DEFECT THIS CLOSES (measured 2026-11-23, #1282) ────────────────────────────────────────────
 * `marketbar` has a `provider` column and the backtest never filtered on it. Two publishers write the
 * SAME `symbolId` at different price scales, so a run read both and mixed them:
 *
 *     BTC  5m   binance + mt5       ETH 5m  binance + mt5      SOL 5m  binance + mt5
 *     SOUN 5m   mt5 + yahoo        NVDA 15m mt5 + yahoo       WTI 1d/1h/4h mt5 + yahoo
 *
 * `WTI` was measured ~**25× apart** between the two publishers (#1282), so a "−45.92% intraday move"
 * was a level mismatch, not a price move. Nothing errored: the number was plausible, which is exactly
 * the class this repo keeps paying for.
 *
 * ── THE RULE ──────────────────────────────────────────────────────────────────────────────────────
 * **One run reads ONE provider.** Never a blend, never a silent pick between two scales.
 *
 *   1 provider          → use it.
 *   several, pinned     → use the pin, and SAY that the others were excluded.
 *   several, no pin     → use the one with the most bars in the window, and REPORT the ambiguity with
 *                         every provider named. Deterministic (count, then name) so two identical runs
 *                         cannot silently disagree.
 *   pin not present     → REFUSE with the providers that DO exist, rather than falling back — a pin
 *                         that matches nothing must not quietly become "whatever is there".
 *
 * Pure: the caller supplies the counts. No Prisma, no clock.
 */

export interface BarProviderChoice {
  /** The provider every bar read must be filtered by. `null` when the window holds no bars at all. */
  provider: string | null;
  /** Every provider present in the window, sorted — so a note can name them. */
  available: string[];
  /** TRUE when more than one publisher writes this symbol/timeframe and no pin decided it. */
  ambiguous: boolean;
  /** Set when the caller's `pinned` value cannot be honoured, or when a choice needs stating. */
  refused: string | null;
  /** Ready-to-append sentence for `caveats` / the result. `null` when there is nothing to say. */
  note: string | null;
}

/**
 * Decide which provider this run reads.
 *
 * @param counts  rows per provider in the run's window, e.g. `{ mt5: 449, yahoo: 12 }`.
 * @param pinned  the caller's explicit choice (`request.barProvider`), if any.
 */
export function chooseBarProvider(
  counts: Readonly<Record<string, number>>,
  pinned?: string | null,
): BarProviderChoice {
  const available = Object.keys(counts).filter((k) => Number(counts[k]) > 0).sort();

  if (available.length === 0) {
    return {
      provider: null,
      available,
      ambiguous: false,
      refused: null,
      note: 'The window holds no bars, so no publisher could be read.',
    };
  }

  const pin = typeof pinned === 'string' && pinned.trim() ? pinned.trim() : null;

  if (pin) {
    if (!available.includes(pin)) {
      return {
        provider: null,
        available,
        ambiguous: available.length > 1,
        refused:
          `barProvider '${pin}' has no bars in this window. Present: ${available.join(', ')}. ` +
          'Refusing rather than falling back — a pin that matches nothing must not become "whatever '
          + 'is there".',
        note: null,
      };
    }
    const others = available.filter((p) => p !== pin);
    return {
      provider: pin,
      available,
      ambiguous: false,
      refused: null,
      note: others.length
        ? `Reading ${pin} bars only; ${others.join(', ')} also publish this symbol/timeframe and were `
          + 'excluded, because two publishers can sit at different price scales (#1282).'
        : null,
    };
  }

  if (available.length === 1) {
    return { provider: available[0], available, ambiguous: false, refused: null, note: null };
  }

  // Several, unpinned. Deterministic: most bars wins; ties break on the name so the same window always
  // resolves the same way.
  const ranked = [...available].sort((a, b) => (counts[b] - counts[a]) || a.localeCompare(b));
  const provider = ranked[0];
  const dropped = ranked.slice(1);
  return {
    provider,
    available,
    ambiguous: true,
    refused: null,
    note:
      `AMBIGUOUS PUBLISHER — ${available.join(' and ')} both publish this symbol/timeframe, and the two `
      + `can sit at different price scales (#1282). This run read ${provider} only (the most bars: `
      + `${counts[provider]} vs ${dropped.map((p) => `${p} ${counts[p]}`).join(', ')}). `
      + 'Pass `barProvider` to choose explicitly; the other publisher was NOT mixed in.',
  };
}
