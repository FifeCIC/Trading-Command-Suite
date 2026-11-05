import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { SettingsResolverService } from '../../common/settings/settings-resolver.service';
import {
  PROGRESSION_LEVELS,
  ProgressionCounts,
  botCapForXp,
  summarise,
  xpBreakdown,
} from './progression-levels';

/**
 * ProgressionService — reads the counts, assembles the level, and answers the cap question.
 *
 * STEP IN THE PIPELINE: it sits BESIDE the trading path, never inside it. `TradingStrategyService`
 * asks this service one question — *"may another bot be active?"* — and the scoring, gating,
 * sizing and execution paths do not call it at all. A progression level must never influence what a
 * symbol scores or how a position is sized; it only decides how many bots a person may run.
 *
 * ⚠️ "CANNOT JUDGE" IS A STATE, NOT A ZERO (#1193). If the counts cannot be read — a fresh install
 * mid-migration, a table not yet created — this returns `status: 'unavailable'` with the reason.
 * Returning zeros would render "Level 1" to an established operator and refuse their activation with
 * a confident, wrong number. The gate treats unavailable as **allow** (see
 * `TradingStrategyService.assertBotCapAllowsActivation`): a guardrail that cannot read its input
 * must not become a lock.
 */
@Injectable()
export class ProgressionService {
  private readonly logger = new Logger(ProgressionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsResolverService,
  ) {}

  /**
   * The measured counts behind a level.
   *
   * ⚠️ Each source is read from the table that ALREADY records it — no counter is maintained:
   *   trade.status != 'open'   closed trades (an open row is not a completed attempt)
   *   backtestrun row count    a row is written when a run COMPLETES (no status column exists)
   *   first activity → today   the earliest createdAt across trade / backtestrun / tradingstrategy
   */
  async readCounts(): Promise<ProgressionCounts> {
    const [closedTrades, backtestRuns, firstTrade, firstRun, firstBot] =
      await Promise.all([
        this.prisma.trade.count({ where: { status: { not: 'open' } } }),
        this.prisma.backtestRun.count(),
        this.prisma.trade.findFirst({
          orderBy: { createdAt: 'asc' },
          select: { createdAt: true },
        }),
        this.prisma.backtestRun.findFirst({
          orderBy: { createdAt: 'asc' },
          select: { createdAt: true },
        }),
        this.prisma.tradingStrategy.findFirst({
          orderBy: { createdAt: 'asc' },
          select: { createdAt: true },
        }),
      ]);

    const stamps = [
      firstTrade?.createdAt,
      firstRun?.createdAt,
      firstBot?.createdAt,
    ]
      .filter((d): d is Date => d instanceof Date)
      .map((d) => d.getTime());
    const daysActive =
      stamps.length === 0
        ? 0
        : Math.max(
            0,
            Math.floor((Date.now() - Math.min(...stamps)) / 86_400_000),
          );

    return { closedTrades, backtestRuns, daysActive };
  }

  /** How many bots are ACTIVE right now. The cap is compared against this, never against a cached count. */
  async countActiveBots(): Promise<number> {
    return this.prisma.tradingStrategy.count({ where: { active: true } });
  }

  /**
   * The enforcement switch. Declared in `settings-registry.ts` as `progression.botCapEnabled`
   * (runtime, default true), so the limitation is visible in Settings and liftable without a code
   * change — the honest posture #809 settled on: a guardrail, stated, not a security boundary.
   */
  async isEnforcementEnabled(): Promise<{ enabled: boolean; source: string }> {
    try {
      const resolved = await this.settings.resolve('progression.botCapEnabled');
      return { enabled: Boolean(resolved.value), source: resolved.source };
    } catch (err) {
      // A setting that cannot be read must not silently switch a safety control OFF *or* ON. We
      // keep the declared default (true) and say the read failed, so the surface can show it.
      this.logger.warn(
        `progression.botCapEnabled could not be resolved: ${(err as Error).message}`,
      );
      return { enabled: true, source: 'unreadable' };
    }
  }

  /**
   * The ceiling right now, and whether it could be judged at all.
   *
   * ⚠️ `cap: null` means UNLIMITED; `judged: false` means the level could not be read. They are
   * different answers and callers must not collapse them — a fresh-install seeder that treated
   * "cannot judge" as "unlimited" would be fine (fail-open), but one that treated it as "cap 1"
   * would ship an install with one active bot and no explanation.
   */
  async getActiveBotCap(): Promise<{ cap: number | null; judged: boolean; level: number | null }> {
    try {
      const view = await this.getView();
      if (view.status !== 'ok') return { cap: null, judged: false, level: null };
      return { cap: view.botCap, judged: true, level: view.level.level };
    } catch {
      return { cap: null, judged: false, level: null };
    }
  }

  /**
   * How many bots a FRESH INSTALL should start with active (#1193).
   *
   * The owner's requirement is that a new user cannot run more than one bot until they have earned
   * the level — and the shipped seed carries several bots. So the first-run seeder asks this and
   * creates the rest INACTIVE. ⚠️ This is the only place the cap is applied to a seed, and it is
   * safe *because* `FirstRunSeedService` only runs when the bot table is empty: it cannot
   * retro-deactivate a bot an operator already runs. `seedDefaults()` convergence on an existing
   * install stays ungated on purpose.
   */
  async activeBotsForFreshInstall(): Promise<{ limit: number | null; judged: boolean }> {
    const { cap, judged } = await this.getActiveBotCap();
    return { limit: judged ? cap : null, judged };
  }

  /**
   * The view the API and the panel render.
   *
   * Shape is deliberately explicit rather than a bare number: the panel must be able to show the
   * XP that earned the level, the RAW and COUNTED value of every source, and what would lift the
   * cap. A level alone cannot explain why a button was refused.
   */
  async getView() {
    const enforcement = await this.isEnforcementEnabled();
    let counts: ProgressionCounts;
    let activeBots: number;
    try {
      [counts, activeBots] = await Promise.all([
        this.readCounts(),
        this.countActiveBots(),
      ]);
    } catch (err) {
      const reason = (err as Error).message;
      this.logger.warn(`Progression could not be computed: ${reason}`);
      return {
        status: 'unavailable' as const,
        reason,
        enforcement,
        levels: PROGRESSION_LEVELS,
      };
    }

    const summary = summarise(counts);
    const cap = botCapForXp(summary.xp);
    return {
      status: 'ok' as const,
      ...summary,
      botCap: cap,
      activeBots,
      capReached: cap !== null && activeBots >= cap,
      /** An install above its cap is GRANDFATHERED: it may deactivate and edit, not add. */
      overCap: cap !== null && activeBots > cap,
      counts,
      breakdown: xpBreakdown(counts),
      enforcement,
      levels: PROGRESSION_LEVELS,
    };
  }
}
