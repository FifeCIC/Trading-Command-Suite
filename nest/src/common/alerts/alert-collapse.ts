/**
 * collapseOrCreateAlert() — the ONE write path for `alert` rows (2026-09-23).
 * ==========================================================================
 *
 * WHY THIS IS SHARED, AND WHY IT EXISTS AT ALL
 * --------------------------------------------
 * Two writers create alerts and they must not drift:
 *
 *   - `AlertsService.addAlert()`     — CONDITION alerts (trigger evaluations, blocked trades)
 *   - `NotificationsService.persistAlert()` — EVENT alerts (position opened/closed, stop adjusted, …)
 *
 * Both used to INSERT unconditionally. Condition alerts then re-fired every poll window and the
 * table reached 12,865 undismissed rows covering 1,124 conditions — "Market Data Stale" ×2,621,
 * "1 MT5 Bridge(s) Down" ×2,210, `R3NK P&L Alert` ×4,796 — while the notification bell showed
 * 9,818 and its popup said "All clear". Event alerts added their own stream: a trailing stop that
 * creeps every cadence window produced **×50 `Stop adjusted — EURCAD` rows in two days**.
 *
 * ⚠️ AN ALERT IS AN ATTENTION RECORD, NOT AN AUDIT TRAIL. The record of what happened lives
 * elsewhere and is untouched by this collapse: trade closes are in the `trade` table, stop
 * adjustments are in `stop_adjustment` (recorded by the guardian alongside the notification),
 * decisions are in `decision_log`. What the alert row owes the reader is the CURRENT state of one
 * thing that needs looking at — which is exactly what `lastSeenAt` + `repeatCount` + the latest
 * `detail` express.
 *
 * THE RULE: an UNDISMISSED row with the same (type, title) is the same thing needing attention.
 * Update it — latest detail, moved `lastSeenAt`, incremented `repeatCount` — instead of inserting.
 *
 * ⚠️ THE KEY IS (type, title), NOT the detail. Condition messages routinely embed a changing
 * number ("612,223 bars" → "612,224"), so a detail-keyed collapse treats each observation as a
 * new condition (measured: 514 "active" rows survived the first, detail-keyed attempt).
 *
 * ⚠️ DISMISSAL IS NOT A MUTE: only UNDISMISSED rows are matched. A condition that recurs after
 * the user dismissed it creates a fresh row and re-surfaces — silencing X today must not silence
 * the next occurrence of X.
 *
 * No Nest DI here on purpose: NotificationsModule ← ProvidersModule ← AlertsModule already
 * imports in one direction, and injecting AlertsService into NotificationsService would close a
 * module cycle. A plain function over the shared Prisma client keeps ONE implementation without
 * one wiring knot.
 */
import type { PrismaService } from '../../database/prisma.service';

export interface AlertWrite {
  type: string;
  title: string;
  detail?: string | null;
  severity?: string;
  ticker?: string | null;
  link?: string | null;
}

/**
 * Create the alert, or fold this observation into the row that already describes it.
 * Returns the created/updated row, or null when the database is unavailable.
 */
export async function collapseOrCreateAlert(prisma: PrismaService, input: AlertWrite): Promise<any | null> {
  if (!prisma?.isAvailable) return null;
  const client = (prisma as any).alert;
  const now = new Date();

  const existing = await client.findFirst({
    where: { dismissed: false, type: input.type, title: input.title },
    orderBy: { createdAt: 'desc' },
  });

  if (existing) {
    return client.update({
      where: { id: existing.id },
      data: {
        // The latest observation wins — the detail describes the condition NOW, not first sight.
        detail: input.detail ?? existing.detail,
        severity: input.severity ?? existing.severity,
        // A recurring event keeps its original ticker/link unless the new write names one.
        ticker: input.ticker ?? existing.ticker,
        link: input.link ?? existing.link,
        lastSeenAt: now,
        repeatCount: (existing.repeatCount ?? 1) + 1,
      },
    });
  }

  return client.create({
    data: {
      type: input.type,
      title: input.title,
      detail: input.detail ?? null,
      severity: input.severity ?? 'info',
      ticker: input.ticker ?? null,
      link: input.link ?? null,
      lastSeenAt: now,
      repeatCount: 1,
    },
  });
}
