/**
 * peak-equity.ts — the monotonic high-water mark used by the drawdown gate.
 * ==========================================================================
 * WHY THIS IS A MODULE, NOT AN INLINE `if` (#848). The gate measures a drawdown against a peak,
 * and the peak only ever rises. The defect the inline version had:
 *
 *   const portfolioValue = account?.equity ?? account?.balance ?? 10_000;   // fabricated fallback
 *   if (this.peakEquity === null || portfolioValue > this.peakEquity) this.peakEquity = portfolioValue;
 *
 * When the MT5 bridge was unreachable, `account` was null, so **$10,000 became the permanent
 * peak**. The real ~$1,389 account then looked like an 86.1% drawdown and the gate blocked EVERY
 * trade. Measured live 2026-09-16: 707 FAILED decisions during the outage, and the block appeared
 * the moment the bridge RECOVERED — the system got worse as infrastructure got better.
 *
 * THE RULE, pinned here so it cannot be re-broken silently: an unreadable account value NEVER
 * touches the peak. "Cannot judge" must never become a number — a fabricated peak is worse than
 * no peak, because it persists (the field is in-memory and only ever increases).
 *
 * ⚠️ The opposite failure is real too and deliberately NOT solved here: an API restart forgets a
 * genuine peak, which resets the gate to permissive. That is a persistence question (noted on
 * #848), not a fabrication question — do not "fix" it by seeding a value.
 */
export function nextPeakEquity(
  current: number | null,
  accountValue: number | null,
): number | null {
  // No reading (bridge down, parse failed) → no update. Never a fallback number.
  if (accountValue === null || !Number.isFinite(accountValue)) return current;
  // First REAL value sets the peak; a later higher reading raises it.
  if (current === null || accountValue > current) return accountValue;
  // Monotonic: a lower later reading does not lower the peak.
  return current;
}
