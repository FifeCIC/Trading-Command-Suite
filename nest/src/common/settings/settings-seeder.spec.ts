import {
  ensureDeclaredSettings,
  SettingsSeederPrisma,
} from './settings-seeder';
import { RUNTIME_SETTINGS, SETTINGS } from './settings-registry';

/**
 * settings-seeder.spec.ts — proves the ONE property that makes seeding safe.
 *
 * WHY THIS TEST IS THE DELIVERABLE, NOT A FORMALITY (#849)
 * -------------------------------------------------------
 * `ensureDeclaredSettings` is called at every boot AND during install. The value it must add is a
 * handful of rows. The value it must NOT do is overwrite the rows a human deliberately set — and
 * nothing about the happy path would reveal that it did.
 *
 * So the test that matters is not "does it create the missing ones". It is:
 *
 *     "given a row that a user changed to something other than the default, does a re-run leave it
 *      alone?"
 *
 * An `upsert`-based implementation passes every other test in this file and silently reverts user
 * choices on the next restart. That is the difference between a safeguard and a data-loss bug in one
 * line of code, so it is pinned here by name.
 *
 * The store is a stub, deliberately: this must be runnable without a database, and "the seeder writes
 * only what is missing" is a property of the LOGIC, not of MySQL.
 */

/** The value every runtime setting gets when created, per `serialiseSetting`. */
function expectedStored(def: {
  type: string;
  defaultValue: number | boolean | string;
}): string {
  if (def.type === 'boolean') return def.defaultValue ? 'true' : 'false';
  return String(def.defaultValue);
}

function stubPrisma(
  initial: Record<string, string> = {},
  opts: { failRead?: boolean } = {},
) {
  const rows = new Map(Object.entries(initial));
  const createCalls: Array<{ key: string; value: string }> = [];
  const updateCalls: string[] = [];

  const prisma: SettingsSeederPrisma & { update?: unknown } = {
    globalSetting: {
      // These stubs deliberately do NOT use `async`: they return promises to match Prisma's API but
      // have nothing to await, and the seeder awaits them regardless — so the asynchrony under test is
      // real, while `async` on the stub would only be decoration (and `require-await` flags it).
      create({
        data,
      }: {
        data: { key: string; value: string };
      }): Promise<unknown> {
        createCalls.push(data);
        if (rows.has(data.key)) {
          // Mirror Prisma's unique-constraint error shape.
          const err = new Error(
            'Unique constraint failed on the fields: (`key`)',
          ) as Error & {
            code?: string;
          };
          err.code = 'P2002';
          throw err;
        }
        rows.set(data.key, data.value);
        return Promise.resolve(data);
      },
      findMany({
        where,
      }: {
        where: { key: { in: string[] } };
      }): Promise<Array<{ key: string }>> {
        if (opts.failRead)
          throw new Error('ER_NO_SUCH_TABLE: simulated read failure');
        return Promise.resolve(
          [...rows.keys()]
            .filter((k) => where.key.in.includes(k))
            .map((k) => ({ key: k })),
        );
      },
      // Present so the test can ASSERT it is never called. The seeder must not be able to reach an
      // update path at all — if a future refactor swaps `create` for `upsert`, this records it.
      //
      // ⚠️ It MUTATES, deliberately, like a real upsert would. A stub whose update was a no-op would
      // make the "creates only" assertion unfalsifiable — it would pass whether or not the seeder
      // overwrote anything, which is the definition of a decoration rather than a guard.
      async update({
        where,
        data,
      }: {
        where: { key: string };
        data?: { value?: string };
      }): Promise<{ key: string }> {
        updateCalls.push(where.key);
        if (data?.value !== undefined) rows.set(where.key, data.value);
        return Promise.resolve({ key: where.key });
      },
    },
  } as SettingsSeederPrisma & { update?: unknown };

  return { prisma, rows, createCalls, updateCalls };
}

describe('ensureDeclaredSettings', () => {
  it('creates every declared runtime setting in an empty store', async () => {
    const { prisma, rows } = stubPrisma();

    const report = await ensureDeclaredSettings(prisma);

    expect(report.created).toEqual(RUNTIME_SETTINGS.map((s) => s.key));
    expect(report.errors).toEqual([]);
    expect(rows.size).toBe(RUNTIME_SETTINGS.length);
    // The stored form must match the declared default, or the first boot would silently change a limit.
    for (const def of RUNTIME_SETTINGS) {
      expect(rows.get(def.key)).toBe(expectedStored(def));
    }
  });

  it('CREATES ONLY — a row whose value differs from the default is left untouched', async () => {
    // This is the whole safety property. `risk.maxOpenPositions` defaults to 5; imagine an operator
    // deliberately raised it to 20 through the API, then the API restarted.
    const target = RUNTIME_SETTINGS.find(
      (s) => s.key === 'risk.maxOpenPositions',
    );
    expect(target).toBeDefined();
    expect(target.defaultValue).not.toBe(20);

    const { prisma, rows, createCalls, updateCalls } = stubPrisma({
      'risk.maxOpenPositions': '20',
    });

    const report = await ensureDeclaredSettings(prisma);

    expect(rows.get('risk.maxOpenPositions')).toBe('20'); // still the operator's value
    expect(report.created).not.toContain('risk.maxOpenPositions');
    expect(report.existing).toContain('risk.maxOpenPositions');
    expect(createCalls.map((c) => c.key)).not.toContain(
      'risk.maxOpenPositions',
    );
    // The strongest form of the claim: no write of ANY kind touched the existing row.
    expect(updateCalls).toEqual([]);
  });

  it('is idempotent — a second run creates nothing and reports everything as existing', async () => {
    const { prisma, rows, createCalls } = stubPrisma();

    await ensureDeclaredSettings(prisma);
    const firstRunCreations = createCalls.length;
    const snapshot = new Map(rows);

    const second = await ensureDeclaredSettings(prisma);

    expect(second.created).toEqual([]);
    expect(second.existing.sort()).toEqual(
      RUNTIME_SETTINGS.map((s) => s.key).sort(),
    );
    expect(createCalls.length).toBe(firstRunCreations); // no extra writes
    expect(rows).toEqual(snapshot); // byte-for-byte unchanged
  });

  it('dryRun reports what it would create and writes NOTHING', async () => {
    const { prisma, rows, createCalls } = stubPrisma();

    const report = await ensureDeclaredSettings(prisma, { dryRun: true });

    expect(report.dryRun).toBe(true);
    expect(report.wouldCreate).toEqual(RUNTIME_SETTINGS.map((s) => s.key));
    expect(report.created).toEqual([]);
    expect(createCalls).toEqual([]);
    expect(rows.size).toBe(0);
  });

  it('treats a concurrent create (P2002) as existing, not as a failure', async () => {
    // Two processes booting at once: the other one wins the INSERT. The desired end state — a row
    // exists — was still reached, so reporting an error would be a false alarm at every rolling restart.
    const { prisma, rows } = stubPrisma();
    const racing = stubPrisma();
    // Seed the racing store's rows first so the second create hits the unique constraint.
    for (const def of RUNTIME_SETTINGS) rows.set(def.key, expectedStored(def));
    void racing;

    const report = await ensureDeclaredSettings(prisma);

    expect(report.errors).toEqual([]);
    expect(report.existing.sort()).toEqual(
      RUNTIME_SETTINGS.map((s) => s.key).sort(),
    );
  });

  it('REFUSES to create anything when the store cannot be read', async () => {
    // Cannot determine what exists ⇒ must not guess. Creating here could duplicate work another boot
    // is doing, and a wrong answer is worse than no answer.
    const { prisma, rows, createCalls } = stubPrisma({}, { failRead: true });

    const report = await ensureDeclaredSettings(prisma);

    expect(report.created).toEqual([]);
    expect(report.wouldCreate).toEqual([]);
    expect(createCalls).toEqual([]);
    expect(rows.size).toBe(0);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0].reason).toContain(
      'could not read existing settings',
    );
  });

  it('can be scoped to specific keys', async () => {
    const { prisma, rows } = stubPrisma();

    const report = await ensureDeclaredSettings(prisma, {
      keys: ['risk.maxDailyLoss'],
    });

    expect(report.checked).toEqual(['risk.maxDailyLoss']);
    expect(report.created).toEqual(['risk.maxDailyLoss']);
    expect(rows.size).toBe(1);
  });

  it('ignores an undeclared key rather than inventing a default for it', async () => {
    // A caller asking to seed something that is not declared is a bug in the caller. Doing nothing is
    // correct: writing a row for an undeclared key would create a setting with no owner and no default.
    const { prisma, rows } = stubPrisma();

    const report = await ensureDeclaredSettings(prisma, {
      keys: ['not.a.real.setting'],
    });

    expect(report.checked).toEqual([]);
    expect(report.created).toEqual([]);
    expect(rows.size).toBe(0);
  });

  it('the migrated risk caps are declared as runtime settings with the carried-over values', () => {
    // Guards the migration itself. If someone "tidies" a default, the enforced trading limit changes —
    // so the values that replaced .env are asserted here, by name, with their origin recorded.
    const byKey = new Map(SETTINGS.map((s) => [s.key, s]));

    const maxPos = byKey.get('risk.maxPositionSize');
    expect(maxPos?.defaultValue).toBe(1.0);
    expect(maxPos?.migratedFrom).toBe('MT5_MAX_POSITION_SIZE');

    const maxOpen = byKey.get('risk.maxOpenPositions');
    expect(maxOpen?.defaultValue).toBe(5);
    expect(maxOpen?.migratedFrom).toBe('MT5_MAX_OPEN_POSITIONS');

    const maxLoss = byKey.get('risk.maxDailyLoss');
    expect(maxLoss?.defaultValue).toBe(100);
    expect(maxLoss?.migratedFrom).toBe('MT5_MAX_DAILY_LOSS');
  });
});
