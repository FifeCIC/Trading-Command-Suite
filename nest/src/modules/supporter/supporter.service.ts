import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { SettingsResolverService } from '../../common/settings/settings-resolver.service';
import { ProgressionService } from '../progression/progression.service';
import { SupporterTarget, buildTargets } from './supporter-targets';

/**
 * SupporterService — decides whether a support prompt may appear, and records what happened.
 *
 * ── DECISION (2026-11-15, primary) ──
 * WHAT:      The support system is named "Supporter Programme", namespace `supporter`.
 * WHY:       The owner proposed "Community Sustainability System" and asked. The intent was right
 *            (non-grabby, and it covers the whole arc from a prompt to credits and Discord perks),
 *            but two of the three words are already taken here: `CSS` already appears 225 times
 *            across 100 files in a project with a documented CSS architecture, "Community" appears
 *            only in roadmap prose and as `source: 'community'` on provider comparisons — there is
 *            no community yet, so the name would assert a population nothing backs — and `sustain`
 *            already means trend persistence in `strategy-library.js` / `candle-patterns.js`.
 *            `supporter` and `steward` appear in ZERO files, measured before choosing.
 * INSTEAD OF: "Community Sustainability System" (`css`), the owner's proposed name.
 * REVERSE BY: Rename the four `supporter.*` settings keys, this module, and the
 *             `supporter_interaction` table, then update SETTLED-DECISIONS row 177.
 *            Nothing else reads the name, so the rename is mechanical.
 * REGISTER:  docs/SETTLED-DECISIONS.md row 182
 * GUARD:     nest/src/modules/supporter/supporter.service.spec.ts
 *
 * STEP IN THE PIPELINE: it sits BESIDE every trading path and inside none of them. Nothing here may
 * influence what a symbol scores, how a position is sized, or whether an order is placed. It answers
 * one question — *"may I ask this person to support the project today?"* — and records the answer.
 *
 * ── THE THREE THINGS THAT MUST BE TRUE BEFORE A PROMPT APPEARS ─────────────────────────────────
 *
 *   1. The user has not switched it off (`supporter.enabled`).
 *   2. The cadence has elapsed — both since the last prompt AND since the app was first used, so a
 *      brand-new installation is never asked for money on day one.
 *   3. Every input could actually be READ. If any read fails, the answer is `unavailable` and the
 *      prompt does NOT appear.
 *
 * ⚠️ (3) IS THE MOST IMPORTANT ONE, AND IT HAS A BODY COUNT. A donation panel shipped in September
 * 2026 and was deleted on 2026-09-17 because its only reachable state was the *unresolved-view
 * fallback* — it appeared exactly when the app could not produce a real answer. That is the same
 * class as #782: a failed read rendered as a normal state. **A prompt is an interruption, and an
 * interruption triggered by an error is a bug wearing a banner.** So every failure path here returns
 * `eligible: false`, and says why rather than defaulting to silence or to a guess.
 *
 * ── WHY `daysActive` COMES FROM ProgressionService ───────────────────────────────────────────────
 *
 * "How long has this been in use?" is ALREADY MEASURED — `ProgressionService` computes it from the
 * earliest `createdAt` across trade / backtestrun / tradingstrategy. Reading it from there rather than
 * re-deriving it here is the difference between one definition and two that will drift. It also means
 * no new "install date" record was needed for this feature.
 */

/** Prompt kinds. `general` is built; `milestone` (§2.4) and `profit` (§2.3) are planned. */
export const SUPPORTER_KINDS = ['general'] as const;
export type SupporterKind = (typeof SUPPORTER_KINDS)[number];

/**
 * The answers a prompt can receive.
 *
 * ⚠️ `dismissed` and `snoozed` are deliberately DIFFERENT. `snoozed` is the user pressing "Not now",
 * which sets an explicit snooze window. `dismissed` is the prompt being closed without a choice (an
 * Escape key or a stray click); it must not extend the snooze, because the user never asked for one.
 */
export const SUPPORTER_RESPONSES = ['dismissed', 'snoozed', 'donated', 'opened', 'muted'] as const;
export type SupporterResponse = (typeof SUPPORTER_RESPONSES)[number];

/** "Not now" means not now — a month. Shorter than the 90-day cadence, so snoozing is genuinely kinder. */
const SNOOZE_DAYS = 30;

const MS_PER_DAY = 86_400_000;

export type SupporterReason =
  | 'eligible'
  | 'disabled'
  | 'snoozed'
  | 'too-new'
  | 'recently-shown'
  | 'unavailable';

export interface SupporterStatus {
  /**
   * ⚠️ TWO STATES, and they must never look alike.
   *   'ok'          — every input was read; `eligible` is a real verdict.
   *   'unavailable' — something could not be read. `eligible` is false and `detail` says what.
   */
  status: 'ok' | 'unavailable';
  eligible: boolean;
  reason: SupporterReason;
  /** One sentence, safe to render. Says WHY, so the settings page can explain silence. */
  detail: string;
  enabled: boolean;
  cadenceDays: number;
  daysActive: number | null;
  lastShownAt: string | null;
  lastResponse: string | null;
  daysSinceLastShown: number | null;
  snoozedUntil: string | null;
  targets: SupporterTarget[];
}

export interface SupporterRecordInput {
  kind?: string;
  /** Absent = this is a "shown" record, not a response to one. */
  response?: string;
  context?: string;
}

export interface SupporterRecordResult {
  recorded: 'shown' | 'response';
  kind: string;
  response: string | null;
  shownAt: string;
  /** Human sentence naming the side effect the answer applied. */
  effect: string;
  status: SupporterStatus;
}

@Injectable()
export class SupporterService {
  private readonly logger = new Logger(SupporterService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsResolverService,
    private readonly progression: ProgressionService,
  ) {}

  /** Whether a support prompt may appear, and the full reasoning behind that verdict. */
  async getStatus(kind: string = 'general'): Promise<SupporterStatus> {
    const unavailable = (detail: string): SupporterStatus => ({
      status: 'unavailable',
      eligible: false,
      reason: 'unavailable',
      detail,
      enabled: false,
      cadenceDays: 0,
      daysActive: null,
      lastShownAt: null,
      lastResponse: null,
      daysSinceLastShown: null,
      snoozedUntil: null,
      targets: [],
    });

    let enabled: boolean;
    let cadenceDays: number;
    let snoozeRaw: string;
    let donateUrl: string;

    try {
      const [enabledR, cadenceR, snoozeR, donateR] = await Promise.all([
        this.settings.resolve('supporter.enabled'),
        this.settings.resolve('supporter.cadenceDays'),
        this.settings.resolve('supporter.snoozedUntil'),
        this.settings.resolve('supporter.donate.url'),
      ]);

      // ⚠️ `source: 'invalid'` means the ROW could not be parsed and the resolver has fallen back to
      // the declared default. Reading that fallback as the answer would silently switch the system
      // back ON, or turn a corrupt snooze into "not snoozed". Refuse instead, and name the key.
      const broken = [enabledR, cadenceR, snoozeR, donateR].filter((r) => r.source === 'invalid');
      if (broken.length) {
        return unavailable(
          `setting "${broken[0].key}" holds a value that cannot be parsed (${broken[0].error ?? 'no reason given'}) — ` +
            'the prompt will not appear until it is fixed.',
        );
      }

      enabled = enabledR.value === true;
      cadenceDays = typeof cadenceR.value === 'number' ? cadenceR.value : Number(cadenceR.value);
      snoozeRaw = typeof snoozeR.value === 'string' ? snoozeR.value : String(snoozeR.value ?? '');
      donateUrl = typeof donateR.value === 'string' ? donateR.value : '';
      if (!Number.isFinite(cadenceDays) || cadenceDays <= 0) {
        return unavailable(`setting "supporter.cadenceDays" is not a usable number of days.`);
      }
    } catch (err) {
      return unavailable(`settings could not be read: ${(err as Error).message}`);
    }

    // A corrupt snooze date must not become an immediate re-ask. "Cannot judge" is a state.
    let snoozedUntil: string | null = null;
    let snoozedUntilMs: number | null = null;
    if (snoozeRaw.trim()) {
      const t = Date.parse(snoozeRaw);
      if (Number.isNaN(t)) {
        return unavailable(
          `setting "supporter.snoozedUntil" holds "${snoozeRaw}", which is not a date — ` +
            'the prompt will not appear until it is corrected or cleared.',
        );
      }
      snoozedUntil = new Date(t).toISOString();
      snoozedUntilMs = t;
    }

    let daysActive: number | null = null;
    try {
      const view = await this.progression.getView();
      if (view.status === 'ok') daysActive = view.counts.daysActive;
    } catch (err) {
      this.logger.warn(`supporter: progression counts unavailable — ${(err as Error).message}`);
    }
    if (daysActive === null) {
      // Without an age we cannot decide "too-new", and guessing would either ask a day-old install
      // or stay silent for years. Neither is acceptable, so the prompt does not appear.
      return unavailable('the install age could not be read, so the cadence cannot be judged.');
    }

    let lastShownAt: Date | null = null;
    let lastResponse: string | null = null;
    try {
      const last = await this.prisma.supporterInteraction.findFirst({
        where: { kind },
        orderBy: { shownAt: 'desc' },
        select: { shownAt: true, response: true },
      });
      lastShownAt = last?.shownAt ?? null;
      lastResponse = last?.response ?? null;
    } catch (err) {
      // The table exists but cannot be read (or the migration has not been applied). Silence here
      // would read as "never shown", which re-asks on every request — the exact hassling this
      // system exists to avoid.
      return unavailable(`prompt history could not be read: ${(err as Error).message}`);
    }

    const now = Date.now();
    const daysSinceLastShown =
      lastShownAt === null
        ? null
        : Math.round(((now - lastShownAt.getTime()) / MS_PER_DAY) * 10) / 10;

    const base = {
      enabled,
      cadenceDays,
      daysActive,
      lastShownAt: lastShownAt ? lastShownAt.toISOString() : null,
      lastResponse,
      daysSinceLastShown,
      snoozedUntil,
      targets: buildTargets(donateUrl),
    };

    if (!enabled) {
      return {
        ...base,
        status: 'ok',
        eligible: false,
        reason: 'disabled',
        detail: 'Support prompts are switched off in Settings → General → Supporter Programme.',
      };
    }
    if (snoozedUntilMs !== null && snoozedUntilMs > now) {
      const daysLeft = Math.ceil((snoozedUntilMs - now) / MS_PER_DAY);
      return {
        ...base,
        status: 'ok',
        eligible: false,
        reason: 'snoozed',
        detail: `Snoozed by the user — ${daysLeft} day(s) left.`,
      };
    }
    if (daysActive < cadenceDays) {
      return {
        ...base,
        status: 'ok',
        eligible: false,
        reason: 'too-new',
        detail:
          `The app has been in use ${daysActive} day(s); the first ask waits until ${cadenceDays}. ` +
          'A new installation is never asked for money.',
      };
    }
    if (daysSinceLastShown !== null && daysSinceLastShown < cadenceDays) {
      return {
        ...base,
        status: 'ok',
        eligible: false,
        reason: 'recently-shown',
        detail: `Last shown ${daysSinceLastShown} day(s) ago; the cadence is ${cadenceDays}.`,
      };
    }

    return {
      ...base,
      status: 'ok',
      eligible: true,
      reason: 'eligible',
      detail: `Eligible — in use ${daysActive} day(s), cadence ${cadenceDays}.`,
    };
  }

  /**
   * Record a prompt being shown, or the user's answer to one.
   *
   * ⚠️ A "shown" record is a WRITE, and it happens when the prompt is rendered rather than when it is
   * answered. If only answers were stored, a user who ignores the prompt forever would be asked again
   * on the next request — the cooldown would never start. Storing the showing is what makes "never
   * shown again" possible.
   */
  async record(input: SupporterRecordInput): Promise<SupporterRecordResult> {
    const kind = this.normaliseKind(input.kind);
    const response = input.response == null ? null : this.normaliseResponse(input.response);
    const context = (input.context ?? '').slice(0, 160) || null;
    const now = new Date();

    if (response === null) {
      const created = await this.prisma.supporterInteraction.create({
        data: { kind, context, shownAt: now },
        select: { shownAt: true },
      });
      this.logger.log(`supporter: "${kind}" prompt shown${context ? ` on ${context}` : ''}`);
      return {
        recorded: 'shown',
        kind,
        response: null,
        shownAt: created.shownAt.toISOString(),
        effect: 'Cooldown started.',
        status: await this.getStatus(kind),
      };
    }

    // Attach the answer to the most recent SHOWN row for this kind. A row that already carries a
    // response is not overwritten — the history is the record of what happened, not the latest state.
    const open = await this.prisma.supporterInteraction.findFirst({
      where: { kind, response: null },
      orderBy: { shownAt: 'desc' },
      select: { id: true, shownAt: true },
    });

    const shownAt = open?.shownAt ?? now;
    if (open) {
      await this.prisma.supporterInteraction.update({
        where: { id: open.id },
        data: { response, respondedAt: now, ...(context ? { context } : {}) },
      });
    } else {
      // An answer with no shown row is still a real event — losing it would let a user mute the
      // system and be asked again on the next boot.
      await this.prisma.supporterInteraction.create({
        data: { kind, context, shownAt: now, response, respondedAt: now },
      });
    }

    const effect = await this.applyResponse(response);

    this.logger.log(`supporter: "${kind}" answered "${response}" — ${effect}`);
    return {
      recorded: 'response',
      kind,
      response,
      shownAt: shownAt.toISOString(),
      effect,
      status: await this.getStatus(kind),
    };
  }

  /** Apply the side effect an answer asks for. Returns a sentence naming it, for the caller's log. */
  private async applyResponse(response: SupporterResponse): Promise<string> {
    const now = Date.now();
    if (response === 'snoozed') {
      const until = new Date(now + SNOOZE_DAYS * MS_PER_DAY);
      await this.settings.set('supporter.snoozedUntil', until.toISOString());
      return `Snoozed for ${SNOOZE_DAYS} days (until ${until.toISOString()}).`;
    }
    if (response === 'muted') {
      await this.settings.set('supporter.enabled', false);
      return 'Switched off permanently. Re-enable in Settings → General → Supporter Programme.';
    }
    if (response === 'donated') {
      // Someone who has just given should not be asked again immediately. The cadence, not a
      // hardcoded window, decides how long — one number owns "how often", in one place.
      const cadence = await this.settings.resolve('supporter.cadenceDays');
      const days = typeof cadence.value === 'number' && cadence.value > 0 ? cadence.value : 90;
      const until = new Date(now + days * MS_PER_DAY);
      await this.settings.set('supporter.snoozedUntil', until.toISOString());
      return `Thanked — next ask no earlier than ${days} days (until ${until.toISOString()}).`;
    }
    if (response === 'opened') {
      return 'Link opened. No frequency change — reading about support is not a decision.';
    }
    return 'Dismissed. No snooze was requested, so only the normal cadence applies.';
  }

  private normaliseKind(kind?: string): string {
    const k = (kind ?? 'general').trim();
    if (!(SUPPORTER_KINDS as readonly string[]).includes(k)) {
      throw new Error(
        `unknown prompt kind "${k}" — declared kinds are: ${SUPPORTER_KINDS.join(', ')}. ` +
          'Add the kind to SUPPORTER_KINDS before using it, so a typo cannot create an invisible ' +
          'history that no cooldown reads.',
      );
    }
    return k;
  }

  private normaliseResponse(response: string): SupporterResponse {
    const r = response.trim();
    if (!(SUPPORTER_RESPONSES as readonly string[]).includes(r)) {
      throw new Error(
        `unknown response "${r}" — allowed: ${SUPPORTER_RESPONSES.join(', ')}. ` +
          'An unrecognised answer must not be stored: the store decides whether to ask again.',
      );
    }
    return r as SupporterResponse;
  }
}
