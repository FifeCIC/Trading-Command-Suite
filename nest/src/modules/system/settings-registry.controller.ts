import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Post,
  Put,
  Param,
  Query,
} from '@nestjs/common';
import { SettingsResolverService } from '../../common/settings/settings-resolver.service';
import {
  SETTINGS,
  RUNTIME_SETTINGS,
  SECRET_SETTINGS,
  SETTING_FAMILIES,
  matchFamily,
} from '../../common/settings/settings-registry';

/**
 * SettingsRegistryController — the surface that makes the settings source of truth VISIBLE (#849).
 *
 * STEP IN THE PIPELINE: reads come from `SettingsResolverService`, which reads `global_setting`. This
 * controller exists so that a human (or an agent) can answer three questions that had no answer before:
 *
 *   1. What settings exist, and what is each one's effective value?  → GET
 *   2. Is that value from the database, or is it the declared default?  → the `source` field
 *   3. How many settings still have no declaration?  → `undeclared`
 *
 * WHY (2) AND (3) MATTER MORE THAN (1)
 * ------------------------------------
 * The defect that created this work was a control that saved successfully and changed nothing. A list
 * of values alone would not have caught it, because the value it saved to was never read. Exposing
 * `source` makes "this is the default, nobody has set it" legible; exposing `undeclared` turns the #849
 * inventory from a document into a number that moves as the work proceeds. Both are the same principle:
 * mark a value's PROVENANCE, because a value without provenance is indistinguishable from a guess.
 *
 * ⚠️ Secrets are listed but never returned. `class: 'secret'` settings live in `.env`; the API reports
 * their KEY and whether the env var is present — never a value. Echoing a credential through an HTTP
 * endpoint would turn a settings convenience into a disclosure, and the repo's own rule is that seeds
 * and responses must not carry secrets.
 */
@Controller('system/settings/registry')
export class SettingsRegistryController {
  private readonly logger = new Logger(SettingsRegistryController.name);

  constructor(private readonly resolver: SettingsResolverService) {}

  /** GET /api/system/settings/registry — every declared setting, its effective value, and its provenance. */
  @Get()
  async list() {
    const [settings, undeclared] = await Promise.all([
      this.resolver.getAll(),
      this.resolver.undeclaredKeys(),
    ]);

    return {
      note:
        'source: "db" = a row exists in global_setting. "default" = no row; the declared default applies. ' +
        '"invalid" = a row exists but cannot be parsed — inspect it, do not ignore it.',
      counts: {
        declared: SETTINGS.length,
        runtime: RUNTIME_SETTINGS.length,
        secrets: SECRET_SETTINGS.length,
        undeclaredKeysInDb: undeclared.count,
        familyMembers: undeclared.familyMembers,
      },
      undeclaredKeySample: undeclared.sample,
      // Families are reported so the mechanism is VISIBLE. A key-family layer nobody can see is
      // indistinguishable from one that does not exist, and the count above only becomes meaningful
      // once it is clear how many keys are covered by a shape rather than by a named setting.
      families: SETTING_FAMILIES.map((f) => ({
        id: f.id,
        label: f.label,
        owner: f.owner,
        pattern: f.pattern.source,
        fields: Object.entries(f.fields).map(([name, def]) => ({
          field: name,
          type: def.type,
          min: def.min,
          max: def.max,
          allowed: def.allowed,
          userChangeable: def.userChangeable,
        })),
        seeded: false,
        // ⚠️ #872 — this string used to say "Read via GET .../family/:key", and THAT FORM 404s.
        // The member is read with a QUERY PARAMETER (`?key=<full key>`), which is the route declared
        // below as `@Get('family')`. A guidance string that does not run is worse than no guidance,
        // because it is followed: the caller gets a 404 and concludes the feature is broken rather
        // than the instruction. Any change to the route form must be made here too.
        note: 'Members have NO default, so ensureDefaults() never creates one. Read one member via GET /api/system/settings/registry/family?key=<full key>',
      })),
      settings,
      // Present so the shape of the contract is self-describing — an API that documents its own
      // provenance semantics is one a new agent can use without reading this file.
      secrets: SECRET_SETTINGS.map((s) => ({
        key: s.key,
        owner: s.owner,
        present: !!process.env[s.key],
        note: 'value never returned — see .env',
      })),
    };
  }

  /**
   * POST /api/system/settings/registry/ensure — seed-on-install / repair.
   *
   * `{ dryRun: true }` returns what it WOULD create and writes nothing. That exists so a repair can be
   * distinguished from a regression: a mutation you asked for and a mutation you did not expect must
   * not look the same in a log.
   *
   * ⚠️ It only ever CREATES. A setting that already has a value is reported in `existing` and left
   * alone, so running this can never revert a deliberate change.
   */
  @Post('ensure')
  async ensure(@Body() body: { dryRun?: boolean; keys?: string[] } = {}) {
    const report = await this.resolver.ensureDefaults({
      dryRun: body.dryRun === true,
      keys: Array.isArray(body.keys) ? body.keys : undefined,
    });
    if (report.created.length) {
      this.logger.log(
        `seeded ${report.created.length} setting(s): ${report.created.join(', ')}`,
      );
    }
    return {
      ...report,
      note: report.dryRun
        ? 'DRY RUN — nothing was written. `wouldCreate` is what a real run would add.'
        : 'Only missing settings are created. Any setting with an existing value is left untouched.',
    };
  }

  /**
   * GET /api/system/settings/registry/family?key=<full key> — read one KEY-FAMILY member.
   *
   * The key travels as a QUERY parameter, not a path segment, because keys contain dots and colons
   * (`directive:adx:maxScore`, `automation.brokerTrading.mt5`) which a path parameter would split.
   *
   * ⚠️ `source: 'absent'` is a real answer, not an error: a family member has no declared default, so an
   * absent row means the OWNER's fallback is in force. Returning a value here would fabricate one.
   */
  @Get('family')
  async readFamily(@Query('key') key?: string) {
    if (!key) {
      throw new BadRequestException(
        'pass ?key=<full setting key>, for example ?key=directive:adx:maxScore',
      );
    }
    const resolved = await this.resolver.resolveFamily(key);
    if (resolved.source === 'invalid') {
      this.logger.warn(
        `family key "${key}" holds an unusable value: ${resolved.error}`,
      );
    }
    return resolved;
  }

  /**
   * PUT /api/system/settings/registry/:key — set one declared setting.
   *
   * The value is validated against the declaration (type, and numeric bounds) and rejected with the
   * reason if it fails. A risk limit that silently accepts an out-of-range number is worse than one
   * that refuses: the operator then believes a limit is enforced that is not.
   */
  @Put(':key')
  async set(@Param('key') key: string, @Body() body: { value?: unknown }) {
    if (body?.value === undefined) {
      throw new BadRequestException(
        `body must be { value } — no value supplied for "${key}"`,
      );
    }
    const updated = await this.resolver.set(key, body.value);
    this.logger.log(
      `setting "${key}" set to ${updated.value} (was ${updated.source})`,
    );
    return updated;
  }

  /**
   * DELETE /api/system/settings/registry/:key — remove ONE stored row.
   *
   * Exists for "un-accept": a baseline, once accepted, must be revocable. `set()` cannot express
   * removal (writing `''` would store an empty string and leave `source: 'stored'` lying about it),
   * and `clearFamily` cannot target a dot-style family's key — it derives a `:` separator.
   *
   * ⚠️ Returns the row count. A `deleted: 0` is NOT an error here — it means the value was already the
   * declared default (or the baseline was already cleared) — but the caller is told what it replaced
   * via `previousSource`, so "cleared" and "there was nothing there" stay distinguishable.
   */
  @Delete(':key')
  async clear(@Param('key') key: string) {
    // An unowned key is a BAD REQUEST, not a server fault — the resolver's guard would otherwise
    // surface as a 500 and read like an outage. The service keeps its own guard for direct callers.
    if (!SETTINGS.some((s) => s.key === key) && !matchFamily(key)) {
      throw new BadRequestException(
        `setting "${key}" is not declared in settings-registry.ts and matches no family — refusing to delete it.`,
      );
    }
    return this.resolver.clear(key);
  }
}
