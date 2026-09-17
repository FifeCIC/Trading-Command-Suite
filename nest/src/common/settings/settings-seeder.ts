import type { PrismaService } from '../../database/prisma.service';
import {
  RUNTIME_SETTINGS,
  SettingDefinition,
  SETTINGS_BY_KEY,
  serialiseSetting,
} from './settings-registry';

/**
 * settings-seeder.ts — seed-on-install, as a PURE function.
 *
 * WHY THIS IS A SEPARATE MODULE AND NOT A METHOD
 * ----------------------------------------------
 * Two callers need to seed settings:
 *
 *   1. `SettingsResolverService.ensureDefaults()` — at boot, and on demand via the API.
 *   2. `nest/prisma/seed.ts` — during a fresh install.
 *
 * `seed.ts` runs outside the Nest container, so it cannot inject the resolver. The obvious move —
 * duplicate the loop in `seed.ts` — is the exact defect this whole piece of work exists to remove:
 * a second copy of a rule, where only one of the two gets the next fix. So the logic lives here as a
 * plain function taking a Prisma client, and both callers delegate to it.
 *
 * 🛑 THE SAFETY PROPERTY, IN ONE LINE
 * -----------------------------------
 * This uses **`create`**, never `upsert` with the declared default in `update`.
 *
 * Rows exist only because a human set them, so an upsert-based seeder would overwrite deliberate
 * choices with defaults on the next restart, silently. `create`-if-missing cannot do that by
 * construction — which is why the guarantee is the *verb* and not a conditional somebody can later
 * "simplify" away.
 */

export interface EnsureSettingsReport {
  dryRun: boolean;
  checked: string[];
  existing: string[];
  created: string[];
  /** Populated in a dry run only — what `created` would have been. */
  wouldCreate: string[];
  errors: Array<{ key: string; reason: string }>;
}

/** The Prisma surface this needs. Narrow on purpose, so a partial client can satisfy it in a test. */
export interface SettingsSeederPrisma {
  globalSetting: {
    create(args: { data: { key: string; value: string } }): Promise<unknown>;
    findMany(args: {
      where: { key: { in: string[] } };
      select: { key: true };
    }): Promise<Array<{ key: string }>>;
  };
}

/**
 * Create every declared runtime setting that has no row. Idempotent; safe to call at every boot.
 *
 * `dryRun` reports without writing, so a repair can be told apart from an unintended mutation. That
 * matters at boot: an operator needs to distinguish "the installer added 3 settings" from "something
 * rewrote my settings", and only one of those is this.
 */
export async function ensureDeclaredSettings(
  prisma: SettingsSeederPrisma,
  opts: { dryRun?: boolean; keys?: string[] } = {},
): Promise<EnsureSettingsReport> {
  const dryRun = opts.dryRun === true;

  const wanted: SettingDefinition[] = opts.keys?.length
    ? opts.keys
        .map((k) => SETTINGS_BY_KEY.get(k))
        .filter((d): d is SettingDefinition => !!d)
    : RUNTIME_SETTINGS;

  const report: EnsureSettingsReport = {
    dryRun,
    checked: wanted.map((d) => d.key),
    existing: [],
    created: [],
    wouldCreate: [],
    errors: [],
  };

  if (!report.checked.length) return report;

  // One read for all candidates: this may run at boot, and it should not become a round-trip per
  // setting as the registry grows.
  let present: Set<string>;
  try {
    const rows = await prisma.globalSetting.findMany({
      where: { key: { in: report.checked } },
      select: { key: true },
    });
    present = new Set(rows.map((r) => r.key));
  } catch (err) {
    // Cannot determine what already exists ⇒ must not create anything. Creating on an unreadable
    // state could duplicate work another boot is doing, so this REFUSES rather than guesses.
    report.errors.push({
      key: '*',
      reason: `could not read existing settings: ${(err as Error).message}`,
    });
    return report;
  }

  for (const def of wanted) {
    if (present.has(def.key)) {
      report.existing.push(def.key);
      continue;
    }
    if (dryRun) {
      report.wouldCreate.push(def.key);
      continue;
    }
    try {
      // 🛑 `create`, never `upsert` — see the module comment.
      await prisma.globalSetting.create({
        data: { key: def.key, value: serialiseSetting(def) },
      });
      report.created.push(def.key);
    } catch (err) {
      // P2002 (unique violation) means a concurrent boot created it between the read and the write.
      // That is the DESIRED end state, so it is recorded as existing rather than as a failure.
      if ((err as { code?: string }).code === 'P2002') {
        report.existing.push(def.key);
      } else {
        report.errors.push({ key: def.key, reason: (err as Error).message });
      }
    }
  }

  return report;
}

/**
 * Narrow a full `PrismaService` to the seeder surface.
 *
 * The conversion is a no-op at runtime and the types are structurally compatible, so there is no cast
 * here — but the function is kept because it is the ONE place a schema-wide Prisma change would have to
 * be reconciled with this module, and the narrow return type is what keeps the seeder independent of
 * the rest of the schema. It is also what makes the spec able to pass a stub.
 */
export function asSeederPrisma(prisma: PrismaService): SettingsSeederPrisma {
  return prisma;
}
