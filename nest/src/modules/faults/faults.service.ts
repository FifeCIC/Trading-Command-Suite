/**
 * FaultsService — the registry of PERSISTENT faults, so a fault survives a restart and can be
 * counted, aged and linked to the issue that owns it.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────
 * Several subsystems already knew about a fault only in memory. `ProviderDegradationService`
 * holds its state in a `new Map()`, so a bridge that had been failing for six hours was forgotten
 * the moment the API restarted — and a fault that is forgotten cannot be COUNTED, so it can never
 * be prioritised against the others. This is the one place a fault is written down.
 *
 * 🛑 THE THREE RULES THIS SERVICE IS BUILT TO — `scripts/validate-fault-taxonomy.cjs` fails the
 *    build if they are broken. Read `docs/FAULT-TAXONOMY-GUARDRAILS.md` for the reasoning:
 *    G1 — a fault is an INSTANCE with an owner: a stable `code`, a `count`, a `lastSeen`, evidence
 *         and an issue link. Not a phrase. That is why the `Fault` model has no (title, detail) pair.
 *    G2 — RETIRE, NEVER DELETE. **There is deliberately no `delete()` and no `deleteMany()` in this
 *         service, and there must never be one.** Deleting a code when its issue closes destroys the
 *         evidence that it ever happened, and the next occurrence looks brand new. Retirement is a
 *         `status` change and the row stays.
 *    G3 — any diagram over these rows is GENERATED from this table, never hand-drawn.
 *
 * ── THE ONE POLICY DECISION WORTH KNOWING BEFORE YOU USE IT ──────────────────────────────
 * A RETIRED fault that is observed again is **not silently reopened**. Its count and lastSeen move,
 * and it is reported as `recurredAfterRetirement`. Reopening would let a machine reverse a human's
 * retirement decision with no record; reporting it puts the same fact in front of the reader while
 * preserving the decision they made.
 *
 * ── THE CADENCE FIELD, AND WHY IT IS THE POINT ───────────────────────────────────────────
 * `reviewedAt` is what stops a registry becoming a graveyard. A row nobody has ever reviewed has
 * `reviewedAt = null`, which is reported as `neverReviewed: true` — never rendered as "reviewed
 * 0 days ago". A list nobody is prompted about is a list nobody visits.
 */
import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

/**
 * The pathways a fault may sit on. Validated rather than free text: `area` is what lets the
 * registry be read one subsystem at a time, and a typo would silently create a second pathway
 * that nobody filters on. Adding one is a one-line change here, which is a visible change.
 */
export const FAULT_AREAS = ['bridge', 'scoring', 'queue', 'trading', 'data', 'api', 'provider'] as const;
export type FaultArea = (typeof FAULT_AREAS)[number];

export const FAULT_STATUSES = ['open', 'acknowledged', 'retired'] as const;
export type FaultStatus = (typeof FAULT_STATUSES)[number];

export const FAULT_SEVERITIES = ['critical', 'warning', 'info'] as const;
export type FaultSeverity = (typeof FAULT_SEVERITIES)[number];

/**
 * A fault code is `TCS-<PATHWAY>-<CONDITION>` — the house style already used by the UI notices.
 * Enforced because the code is the IDENTITY: a reworded title is harmless, a reused code makes the
 * count a lie.
 *
 * ⚠️ Do NOT quote a real notice code (a literal `TCS-` plus three digits) anywhere in `nest/src`,
 * including in a comment like this one: `scripts/validate-notices.cjs` scans the backend tree for
 * that shape and reads it as "the backend emits this code", so an illustration becomes a build
 * failure about a catalogue entry that does not exist. Measured 2026-11-19 — this very comment
 * caused it, and the code it named was never emitted by anything here.
 */
const CODE_RE = /^TCS-[A-Z0-9]+(-[A-Z0-9]+)*$/;

export interface FaultObservation {
  code: string;
  title: string;
  area: FaultArea;
  severity?: FaultSeverity;
  /** The observation that proves it. Printed beside the fault, never instead of it. */
  evidence?: Record<string, unknown>;
  issueUrl?: string;
}

export interface FaultRow {
  code: string;
  title: string;
  area: string;
  severity: string;
  status: string;
  firstSeen: Date;
  lastSeen: Date;
  count: number;
  evidence: unknown;
  issueUrl: string | null;
  reviewedAt: Date | null;
  reviewedBy: string | null;
  note: string | null;
}

export interface FaultView extends FaultRow {
  /**
   * Derived for display and ALWAYS returned beside the raw `lastSeen` / `reviewedAt` it came from.
   * A derived number must not hide the data it was computed from.
   */
  daysSinceReview: number | null;
  /** `reviewedAt === null` — "nobody has ever looked", which is NOT the same as "looked today". */
  neverReviewed: boolean;
  /** Observed since the last review. A retired fault with this true is the interesting case. */
  recurredSinceReview: boolean;
}

const DAY_MS = 86_400_000;

/** Attach the derived, display-only fields — always beside the raw values they came from. */
export function toView(row: FaultRow): FaultView {
  const reviewedAt = row.reviewedAt ? new Date(row.reviewedAt) : null;
  const lastSeen = new Date(row.lastSeen);
  return {
    ...row,
    daysSinceReview: reviewedAt ? Math.floor((Date.now() - reviewedAt.getTime()) / DAY_MS) : null,
    neverReviewed: reviewedAt === null,
    /**
   * `lastSeen > reviewedAt` — EQUALITY IS NOT A RECURRENCE.
   *
   * A review and an observation landing in the same millisecond cannot be ordered, so the honest
   * answer is "cannot tell", and this reports `false` rather than inventing a recurrence. The case
   * that matters (`recurred after a retirement that did not hold`) is always minutes-to-days apart,
   * so the ambiguity costs nothing; reporting a recurrence on equality would manufacture one.
   */
  recurredSinceReview: reviewedAt !== null && lastSeen.getTime() > reviewedAt.getTime(),
  };
}

@Injectable()
export class FaultsService {
  private readonly logger = new Logger(FaultsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Record one observation of a fault. `count` counts EPISODES, not requests — call this on a
   * state TRANSITION (a provider becoming failed), never from a poll loop, or the count becomes a
   * measure of how often the caller ran.
   */
  async record(observation: FaultObservation): Promise<{ view: FaultView; recurredAfterRetirement: boolean }> {
    const { code, title, area, severity = 'warning', evidence, issueUrl } = observation;

    if (!CODE_RE.test(code ?? '')) {
      // A code that is not a code is a phrase, and a phrase cannot be counted (G1).
      throw new BadRequestException(
        `fault code '${code}' is not of the form TCS-<PATHWAY>-<CONDITION> — the code is the identity and must be stable`,
      );
    }
    if (!FAULT_AREAS.includes(area)) {
      throw new BadRequestException(`fault area '${area}' is not one of ${FAULT_AREAS.join(', ')}`);
    }
    if (!FAULT_SEVERITIES.includes(severity)) {
      throw new BadRequestException(`fault severity '${severity}' is not one of ${FAULT_SEVERITIES.join(', ')}`);
    }

    const now = new Date();
    const row = (await this.prisma.fault.upsert({
      where: { code },
      create: {
        code,
        title,
        area,
        severity,
        status: 'open',
        firstSeen: now,
        lastSeen: now,
        count: 1,
        evidence: (evidence ?? null) as never,
        issueUrl: issueUrl ?? null,
      },
      update: {
        // ⚠️ `status` is deliberately NOT in this map. A recurrence moves the count and the
        // clock; whether the fault is open again is a human decision (see the header).
        title,
        area,
        severity,
        lastSeen: now,
        count: { increment: 1 },
        evidence: (evidence ?? null) as never,
        ...(issueUrl ? { issueUrl } : {}),
      },
    })) as FaultRow;

    const recurredAfterRetirement = row.status === 'retired';
    if (recurredAfterRetirement) {
      this.logger.warn(
        `${code} was observed again AFTER being retired (count ${row.count}) — a retirement that did not hold is the most useful thing this registry can tell you`,
      );
    }
    return { view: toView(row), recurredAfterRetirement };
  }

  /**
   * The cadence beat. Recording that somebody looked is a first-class operation, because a
   * registry with no record of being visited cannot report that it has been neglected.
   *
   * `issueUrl` is accepted here because the most useful output of a review is "this is owned by #N" —
   * needing a second write to attach the owner would make linking an issue feel like extra work, and
   * an unlinked fault is one nobody can act on.
   */
  async review(code: string, reviewedBy: string, note?: string, issueUrl?: string): Promise<FaultView> {
    return this.updateReviewed(code, { reviewedBy, note, issueUrl });
  }

  /** Acknowledge: seen and understood, still happening. Keeps the row in the open set. */
  async acknowledge(code: string, reviewedBy: string, note?: string, issueUrl?: string): Promise<FaultView> {
    return this.updateReviewed(code, { reviewedBy, note, issueUrl }, 'acknowledged');
  }

  /**
   * Retire — the ONLY exit path (G2). The row stays, keeps its count, and stays in every 'all'
   * view, because the recurrence history is the value being preserved.
   */
  async retire(code: string, reviewedBy: string, note?: string, issueUrl?: string): Promise<FaultView> {
    return this.updateReviewed(code, { reviewedBy, note, issueUrl }, 'retired');
  }

  /** The registry. `staleDays` returns the neglected set — the one that needs a visit. */
  async list(query: { status?: FaultStatus; area?: FaultArea; staleDays?: number } = {}): Promise<{
    rows: FaultView[];
    total: number;
    staleDays: number | null;
  }> {
    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;
    if (query.area) where.area = query.area;

    const rows = (await this.prisma.fault.findMany({
      where,
      orderBy: [{ status: 'asc' }, { lastSeen: 'desc' }],
    })) as FaultRow[];

    const views = rows.map(toView);
    if (query.staleDays === undefined) {
      return { rows: views, total: views.length, staleDays: null };
    }

    // Filtered in JS on purpose: the registry holds tens-to-hundreds of rows, and a SQL-side
    // "NULL OR older than" is the sort of predicate that reads correct and quietly excludes the
    // never-reviewed rows — which are exactly the ones this filter exists to surface.
    const stale = views.filter((v) => v.neverReviewed || (v.daysSinceReview ?? 0) >= query.staleDays!);
    return { rows: stale, total: views.length, staleDays: query.staleDays };
  }

  /**
   * The numbers a reader needs to know whether the registry is being maintained. Reported as
   * counts of ROWS, each with the threshold it was measured against — never a bare percentage.
   */
  async summary(staleDays = 14): Promise<{
    total: number;
    byStatus: Record<string, number>;
    byArea: Record<string, number>;
    neverReviewed: number;
    stale: number;
    recurredAfterRetirement: number;
    staleDays: number;
  }> {
    const rows = ((await this.prisma.fault.findMany({})) as FaultRow[]).map(toView);
    const byStatus: Record<string, number> = {};
    const byArea: Record<string, number> = {};
    for (const r of rows) {
      byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
      byArea[r.area] = (byArea[r.area] ?? 0) + 1;
    }
    return {
      total: rows.length,
      byStatus,
      byArea,
      neverReviewed: rows.filter((r) => r.neverReviewed).length,
      stale: rows.filter((r) => r.neverReviewed || (r.daysSinceReview ?? 0) >= staleDays).length,
      recurredAfterRetirement: rows.filter((r) => r.status === 'retired' && r.recurredSinceReview).length,
      staleDays,
    };
  }

  /**
   * Move `lastSeen` WITHOUT incrementing `count` — for an episode that is still happening.
   *
   * ⚠️ WITHOUT THIS, A LIVE FAULT AGES. `record()` is called once per episode, so a fault that has
   * been failing continuously would keep a `lastSeen` frozen at the moment it started, and every
   * reader that ages a fault by `lastSeen` would render a currently-broken system as a stale one.
   * Measured 2026-11-19: the four `TCS-ALERT-*` rows all carried `lastSeen` equal to their first
   * observation while the conditions were still firing.
   *
   * Returns the number of rows touched. `0` means the episode was known to the caller but has no row
   * — reported rather than swallowed, because that is a disagreement worth seeing (a tracker that
   * outlived its table, e.g. after a reset).
   */
  async touch(code: string, evidence?: Record<string, unknown>): Promise<number> {
    const result = await this.prisma.fault.updateMany({
      where: { code },
      data: {
        lastSeen: new Date(),
        ...(evidence ? { evidence: evidence as never } : {}),
      },
    });
    if (result.count === 0) {
      this.logger.warn(`${code} was observed as ongoing but has no row — the tracker and the table disagree`);
    }
    return result.count;
  }

  /**
   * The open fault codes a booting process should ADOPT rather than count as new.
   *
   * ⚠️ Filtered in JS on purpose (the registry holds tens-to-hundreds of rows): a SQL prefix + range
   * predicate is the kind of thing that reads correct and quietly matches nothing — this way the
   * caller gets the same answer as `list()` and the two cannot disagree.
   */
  async openCodesSince(prefix: string, since: Date): Promise<string[]> {
    const rows = (await this.prisma.fault.findMany({ where: { status: 'open' } })) as FaultRow[];
    return rows
      .filter((r) => r.code.startsWith(prefix) && new Date(r.lastSeen).getTime() >= since.getTime())
      .map((r) => r.code);
  }

  private async updateReviewed(
    code: string,
    input: { reviewedBy: string; note?: string; issueUrl?: string },
    status?: FaultStatus,
  ): Promise<FaultView> {
    const existing = await this.prisma.fault.findUnique({ where: { code } });
    if (!existing) {
      // Reviewing a row that does not exist is a claim about nothing. Error rather than upsert:
      // an upsert here would create an empty fault whose `count` means nothing.
      throw new NotFoundException(`no fault with code '${code}' — record it before reviewing it`);
    }
    if (status && !FAULT_STATUSES.includes(status)) {
      throw new BadRequestException(`fault status '${status}' is not one of ${FAULT_STATUSES.join(', ')}`);
    }
    const row = (await this.prisma.fault.update({
      where: { code },
      data: {
        reviewedAt: new Date(),
        reviewedBy: input.reviewedBy,
        ...(status ? { status } : {}),
        ...(input.note ? { note: input.note } : {}),
        ...(input.issueUrl ? { issueUrl: input.issueUrl } : {}),
      },
    })) as FaultRow;
    return toView(row);
  }
}
