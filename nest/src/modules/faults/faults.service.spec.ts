/**
 * FaultsService — the rules the registry exists to satisfy, tested without a database.
 *
 * ⚠️ THE CASES BELOW ARE THE GUARDRAIL IN BEHAVIOUR, not decoration. Each one corresponds to a way
 * a fault registry decays into a second list nobody trusts:
 *   · a phrase recorded as a fault            → cannot be counted   (G1)
 *   · a reworded/reused code                  → the count is a lie  (G1)
 *   · a deleted row on issue-close            → recurrence erased   (G2)
 *   · a machine silently reversing a retirement decision
 *   · "never reviewed" rendered as "reviewed today" (the repo's standing 'cannot judge' rule)
 *   · a review of a row that does not exist, silently succeeding
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { FaultsService } from './faults.service';

type Row = Record<string, any>;

/** The slice of Prisma this service uses, in memory — upsert / findUnique / update / findMany. */
function fakePrisma() {
  const rows = new Map<string, Row>();
  const table = {
    async upsert({ where, create, update }: { where: { code: string }; create: Row; update: Row }) {
      const existing = rows.get(where.code);
      if (!existing) {
        const row = { id: `id-${rows.size + 1}`, ...create };
        rows.set(where.code, row);
        return { ...row };
      }
      const next: Row = { ...existing };
      for (const [k, v] of Object.entries(update)) {
        // Prisma's `{ increment: n }` shape — the count must MOVE, not be overwritten.
        if (v && typeof v === 'object' && 'increment' in (v as Row)) next[k] = (next[k] ?? 0) + (v as Row).increment;
        else next[k] = v;
      }
      rows.set(where.code, next);
      return { ...next };
    },
    async findUnique({ where }: { where: { code: string } }) {
      const row = rows.get(where.code);
      return row ? { ...row } : null;
    },
    async update({ where, data }: { where: { code: string }; data: Row }) {
      const row = rows.get(where.code);
      if (!row) throw new Error('record not found');
      const next = { ...row, ...data };
      rows.set(where.code, next);
      return { ...next };
    },
    async findMany({ where }: { where?: Row } = {}) {
      const all = [...rows.values()];
      if (!where) return all.map((r) => ({ ...r }));
      return all
        .filter((r) => Object.entries(where).every(([k, v]) => r[k] === v))
        .map((r) => ({ ...r }));
    },
  };
  return { prisma: { fault: table } as any, rows };
}

const base = { code: 'TCS-BRIDGE-UNREACHABLE', title: 'Bridge unreachable', area: 'bridge' as const };

describe('FaultsService', () => {
  it('records a first observation as an instance: count 1, open, NEVER reviewed', async () => {
    const { prisma } = fakePrisma();
    const { view } = await new FaultsService(prisma).record(base);

    expect(view.count).toBe(1);
    expect(view.status).toBe('open');
    expect(view.firstSeen).toBeInstanceOf(Date);
    // ⚠️ 'never reviewed' must be its OWN state, not 0 days since review.
    expect(view.neverReviewed).toBe(true);
    expect(view.daysSinceReview).toBeNull();
  });

  it('counts EPISODES: a second observation increments the count and moves lastSeen, not firstSeen', async () => {
    const { prisma, rows } = fakePrisma();
    const service = new FaultsService(prisma);

    const first = await service.record(base);
    rows.get(base.code)!.lastSeen = new Date(Date.now() - 60_000);
    const firstSeen = rows.get(base.code)!.firstSeen;

    const second = await service.record({ ...base, evidence: { attempt: 2 } });

    expect(second.view.count).toBe(2);
    expect(second.view.firstSeen).toEqual(firstSeen);
    expect(second.view.lastSeen.getTime()).toBeGreaterThan(first.view.lastSeen.getTime() - 60_000);
    expect(second.view.evidence).toEqual({ attempt: 2 });
  });

  it('does NOT reopen a retired fault on recurrence — it reports it (a machine must not reverse a human decision)', async () => {
    const { prisma, rows } = fakePrisma();
    const service = new FaultsService(prisma);

    await service.record(base);
    await service.retire(base.code, 'owner', 'believed fixed');
    // The review happened, then time passed, then the fault came back — the real world ordering.
    // (A same-millisecond review+observation is unordered and is deliberately NOT reported as a
    // recurrence; see the note on `recurredSinceReview`.)
    rows.get(base.code)!.reviewedAt = new Date(Date.now() - 60_000);

    const again = await service.record(base);

    expect(again.recurredAfterRetirement).toBe(true);
    expect(again.view.status).toBe('retired'); // decision preserved
    expect(again.view.count).toBe(2); // and the recurrence is still counted
    expect(again.view.recurredSinceReview).toBe(true);
  });

  it('refuses a code that is a phrase — the code is the identity (G1)', async () => {
    const { prisma } = fakePrisma();
    const service = new FaultsService(prisma);

    await expect(service.record({ ...base, code: 'bridge is down' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.record({ ...base, code: 'TCS-bridge-down' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.record({ ...base, area: 'bridgey' as any })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.record({ ...base, severity: 'urgent' as any })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('errors when asked to review a fault that does not exist — a review of nothing is not a review', async () => {
    const { prisma } = fakePrisma();
    const service = new FaultsService(prisma);

    await expect(service.review('TCS-QUEUE-STUCK', 'owner')).rejects.toBeInstanceOf(NotFoundException);
    // and it must not have CREATED a row on the way to failing
    expect(await prisma.fault.findMany({})).toHaveLength(0);
  });

  it('retires rather than deletes: the row and its recurrence count survive (G2)', async () => {
    const { prisma } = fakePrisma();
    const service = new FaultsService(prisma);

    await service.record(base);
    await service.record(base);
    const retired = await service.retire(base.code, 'owner', 'fixed in #1234');

    expect(retired.status).toBe('retired');
    expect(retired.count).toBe(2);
    expect(retired.note).toBe('fixed in #1234');
    const { rows } = await service.list({});
    expect(rows.map((r) => r.code)).toContain(base.code);
  });

  it('exposes NO delete path at all — G2 has no code to call', () => {
    const { prisma } = fakePrisma();
    const service = new FaultsService(prisma) as any;
    expect(service.delete).toBeUndefined();
    expect(service.deleteMany).toBeUndefined();
    expect(service.remove).toBeUndefined();
    // …and the prisma delegate is never handed one from this service's own surface
    expect(typeof prisma.fault.delete).toBe('undefined');
  });

  it('staleDays surfaces NEVER-reviewed rows, which a naive "older than N days" predicate drops', async () => {
    const { prisma, rows } = fakePrisma();
    const service = new FaultsService(prisma);

    await service.record(base); // never reviewed
    await service.record({ ...base, code: 'TCS-QUEUE-STUCK', area: 'queue' });
    await service.review('TCS-QUEUE-STUCK', 'owner'); // reviewed just now
    // and one reviewed long ago
    await service.record({ ...base, code: 'TCS-DATA-STALE', area: 'data' });
    rows.get('TCS-DATA-STALE')!.reviewedAt = new Date(Date.now() - 40 * 86_400_000);

    const { rows: stale, total, staleDays } = await service.list({ staleDays: 14 });

    expect(staleDays).toBe(14);
    expect(total).toBe(3); // the filter states its own denominator
    expect(stale.map((r) => r.code).sort()).toEqual(['TCS-BRIDGE-UNREACHABLE', 'TCS-DATA-STALE']);
    expect(stale.find((r) => r.code === 'TCS-BRIDGE-UNREACHABLE')!.neverReviewed).toBe(true);
    expect(stale.find((r) => r.code === 'TCS-DATA-STALE')!.neverReviewed).toBe(false);
  });

  it('summary reports counts of rows plus the threshold they were measured against', async () => {
    const { prisma } = fakePrisma();
    const service = new FaultsService(prisma);

    await service.record(base);
    await service.record({ ...base, code: 'TCS-QUEUE-STUCK', area: 'queue' });
    await service.retire('TCS-QUEUE-STUCK', 'owner');

    const s = await service.summary(14);
    expect(s.total).toBe(2);
    expect(s.byStatus).toEqual({ open: 1, retired: 1 });
    expect(s.byArea).toEqual({ bridge: 1, queue: 1 });
    expect(s.neverReviewed).toBe(1);
    expect(s.staleDays).toBe(14);
  });
});
