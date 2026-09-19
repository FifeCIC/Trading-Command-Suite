import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ProtocolDbService } from './protocol-db.service';
import { DirectivesService } from '../directives/directives.service';
import { classifyDirectiveInclusion } from '../directives/directive-inclusion';
import { PrismaService } from '../../database/prisma.service';

/**
 * ProtocolHealthService — static protocol-config validation.
 * ===========================================================
 * Catches configuration faults BEFORE they corrupt scoring output. The
 * motivating bug (2026-09-03, #716 follow-up): vix-spike-v1 shipped with a
 * Sentiment group weighted 0.35 but ZERO directiveIds, so 35% of the
 * protocol's signal read 0 forever and manufactured permanent divergences.
 *
 * Scoring now treats empty groups as INACTIVE (neutral), but config faults
 * must still be surfaced — a silent neutral is better than a silent zero,
 * yet the config itself is wrong and needs a human decision. This service
 * flags it on boot and via GET /api/scoring/gated/protocols/health.
 */

export interface ProtocolHealthIssue {
  protocolId: string;
  groupId?: string;
  kind:
    | 'empty-group'
    | 'unknown-directive'
    | 'no-risk-gate'
    | 'duplicate-directive'
    | 'zero-weight'
    /** Under 25% of declared maxScore sits on direction-declaring directives.
     *  A review prompt only — config understates real capacity (2026-09-10). */
    | 'low-declared-directional-capacity'
    /** Measured maximum composite is BELOW the bot's minComposite — the bot can
     *  never trade as configured, however the market behaves (2026-09-10). */
    | 'ceiling-below-threshold'
    /** Measured maximum composite clears minComposite by under 25%, so the bot
     *  fires rarely and is fragile to any weight change (2026-09-10). */
    | 'ceiling-near-threshold';
  severity: 'warning' | 'error';
  message: string;
}

@Injectable()
export class ProtocolHealthService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ProtocolHealthService.name);
  private lastIssues: ProtocolHealthIssue[] = [];
  private lastRunAt: string | null = null;

  constructor(
    private readonly protocolDb: ProtocolDbService,
    private readonly directives: DirectivesService,
    private readonly prisma: PrismaService,
  ) {}

  /** Validate every active protocol's group/directive wiring. */
  async validateAll(): Promise<ProtocolHealthIssue[]> {
    const issues: ProtocolHealthIssue[] = [];
    let slugs: string[] = [];
    try {
      slugs = await this.protocolDb.findAllActive();
    } catch {
      return issues;
    }

    for (const slug of slugs) {
      let config;
      try {
        config = this.protocolDb.getCached(slug) ?? (await this.protocolDb.findBySlug(slug));
      } catch {
        continue;
      }
      if (!config?.groups) continue;

      const seen = new Set<string>();
      const hasRiskGate = config.groups.some((g: any) => g.isRiskGate === true);

      // ── Directional capacity (added 2026-09-10) ──────────────────────────
      // The composite counts ONLY directives that can emit a directional
      // `signalClass`; a `directionBias: "neutral"` directive scores, is shown in
      // the UI, and adds EXACTLY ZERO. A protocol can therefore declare a huge
      // maxScore total and still be unable to reach its own threshold.
      //
      // This is not hypothetical: `ftse-speed-v1`, `dax-speed-v1` and
      // `cac-speed-v1` each wrap ~815 points of neutral technical directives
      // around a single 80-point directional one, so their all-time maximum
      // composite is 31 against a `minComposite` of 65 — they had never cleared
      // the gate once in their entire history. The fault was invisible because
      // every individual directive looked healthy and scored in range.
      let directionalCapacity = 0;
      let neutralCapacity = 0;

      for (const group of config.groups as any[]) {
        const groupId: string = group.id;
        const directiveIds: string[] = group.directiveIds ?? [];
        const weight = Number(group.weight ?? 0);

        // Gate groups are excluded from the signal by design, so their capacity
        // is neither directional nor wasted.
        const isGateGroup = group.isRiskGate === true;

        if (weight > 0 && directiveIds.length === 0) {
          issues.push({
            protocolId: slug,
            groupId,
            kind: 'empty-group',
            severity: 'warning',
            message: `Group "${group.name ?? groupId}" has weight ${weight} but zero directives — it is scored as inactive (neutral). Add directives or remove/reweight the group.`,
          });
        }
        if (weight <= 0 && directiveIds.length > 0) {
          issues.push({
            protocolId: slug,
            groupId,
            kind: 'zero-weight',
            severity: 'warning',
            message: `Group "${group.name ?? groupId}" has ${directiveIds.length} directive(s) but zero weight — its directives never contribute.`,
          });
        }
        for (const directiveId of directiveIds) {
          if (seen.has(directiveId)) {
            issues.push({
              protocolId: slug,
              groupId,
              kind: 'duplicate-directive',
              severity: 'warning',
              message: `Directive "${directiveId}" appears in more than one group — double-counted.`,
            });
            continue;
          }
          seen.add(directiveId);
          const impl = this.directives.get(directiveId);
          if (!impl) {
            issues.push({
              protocolId: slug,
              groupId,
              kind: 'unknown-directive',
              severity: 'error',
              message: `Directive "${directiveId}" has no implementation registered — it will never score.`,
            });
          } else if (!isGateGroup) {
            // `directionBias` is the DECLARED capability. A directive that
            // declares `neutral` may still emit a dynamic two-sided signalClass
            // at runtime (speed-momentum does), so this is reported as a
            // capacity SHORTFALL rather than asserted as a hard fact — but a
            // protocol whose declared directional capacity cannot reach its
            // threshold deserves a human look.
            //
            // ⚠️ MUST go through `classifyDirectiveInclusion` — the single
            // source of truth for directionBias vs directionMode.
            // Counting the raw `directionBias` here is exactly the drift that
            // module's header warns about, and it made this check MISS its own
            // motivating case: `ftse-speed-v1` is LONG_ONLY, so the bearish
            // `rsi-overbought` (140) is silently excluded at runtime — yet a
            // naive count credited it as directional capacity and pushed the
            // protocol over the threshold, hiding the fault (2026-09-10).
            const directionMode = (config as any).directionMode ?? 'LONG_ONLY';
            const included = classifyDirectiveInclusion(
              {
                directionBias: (impl as any).directionBias,
                readiness: (impl as any).readiness,
              },
              directionMode,
            );
            const maxScore = Number((impl as any).maxScore ?? 0);
            if (included !== 'included') {
              // Excluded by direction mode or alpha readiness. Not usable
              // capacity — do not credit it to either side.
              continue;
            }
            const bias = (impl as any).directionBias;
            if (bias === 'bullish' || bias === 'bearish') {
              directionalCapacity += maxScore;
            } else {
              neutralCapacity += maxScore;
            }
          }
        }
      }

      if (!hasRiskGate) {
        issues.push({
          protocolId: slug,
          kind: 'no-risk-gate',
          severity: 'warning',
          message: 'Protocol has no risk-gate group (isRiskGate) — risk multiplier stays at the default.',
        });
      }

      // A protocol whose DECLARED directional capacity is a small minority of
      // its total cannot reach a high threshold from declared signals alone.
      //
      // ⚠️ Reported at `warning` and worded as a prompt to verify, because the
      // declared bias UNDERSTATES real capacity: several directives declare
      // `neutral` and still emit bullish/bearish at runtime. `xau-speed-v1` sits
      // at 15% declared-directional yet regularly clears 65. The check is a
      // review trigger — "go and look at this protocol's measured ceiling" —
      // not a verdict.
      const totalCapacity = directionalCapacity + neutralCapacity;
      if (totalCapacity > 0 && directionalCapacity < totalCapacity * 0.25) {
        issues.push({
          protocolId: slug,
          kind: 'low-declared-directional-capacity',
          severity: 'warning',
          message:
            `Only ${directionalCapacity} of ${totalCapacity} maxScore points sit on directives that ` +
            `DECLARE a direction (${Math.round((directionalCapacity / totalCapacity) * 100)}%). ` +
            `Directives that declare none may still emit a bullish/bearish reading at runtime, so ` +
            `this is not proof the protocol is untradable — verify by comparing its measured ` +
            `composite against its minComposite. The known failure case is a protocol whose ` +
            `all-time maximum never reaches its own threshold.`,
        });
      }
    }

    this.lastIssues = issues;
    this.lastRunAt = new Date().toISOString();
    return issues;
  }

  /**
   * Compare each ACTIVE bot's `minComposite` against its protocol's MEASURED
   * maximum composite (2026-09-10).
   *
   * WHY THIS EXISTS
   * ---------------
   * `low-declared-directional-capacity` (above) reads config, and config
   * understates real capacity — several directives declare `neutral` yet emit
   * direction at runtime. So config alone cannot answer the question that
   * actually matters: **can this bot ever trade?**
   *
   * This check answers it from evidence. For each active bot it takes the
   * protocol's highest composite ever recorded and compares it to the bot's own
   * threshold. If the ceiling is below the bar, the bot is configured to never
   * fire, and no amount of market movement will change that.
   *
   * THE CASE THAT MOTIVATED IT: `ftse-speed-v1`, `dax-speed-v1` and
   * `cac-speed-v1` each had an all-time maximum composite of **31** against a
   * `minComposite` of **65**. They had cleared their gate 0 times in their entire
   * history while `forex-session-v1` cleared it 1,168 times. Every individual
   * directive looked healthy, so nothing reported a problem — the fault was only
   * visible by comparing the ceiling to the threshold.
   *
   * ⚠️ UNITS — FIXED 2026-09-19 (#905). This compared the RAW composite against
   * `minComposite`, but the GATE (protocol-gating) compares compositePct =
   * rawComposite / configuredSignalMax × 100 against it. Raw-vs-percent made the audit
   * silently blind: `xau-speed-1h`'s raw ceiling of 70 "cleared" its bar of 9, while its
   * true 7.7% could never clear 9% — two bots active and incapable with this detector green.
   * The audit now measures the SAME quantity the gate does, and `measureProtocolCeiling()`
   * below shares that basis so detector and gate cannot disagree again.
   *
   * ⚠️ Reported at `error` when the measured ceiling cannot reach the threshold,
   * because that is a definite fault rather than a suspicion: the bot cannot
   * trade as configured. It is deliberately NOT auto-fixed — the right response
   * may be to fix the protocol, lower the threshold, or disable the bot.
   */
  async auditMeasuredCeilings(): Promise<ProtocolHealthIssue[]> {
    const issues: ProtocolHealthIssue[] = [];
    if (!this.prisma?.isAvailable) return issues;

    let rows: any[] = [];
    try {
      // ⚠️ COLLATION IS LOAD-BEARING HERE — verified against information_schema:
      //
      //   trading_strategy.protocolId / .id  →  utf8mb4_0900_ai_ci
      //   protocol.id / .slug                →  utf8mb4_unicode_ci
      //   score.strategyId                   →  utf8mb4_unicode_ci
      //
      // The two tables were created under different server defaults, so a plain
      // `ON p.id = ts.protocolId` throws "Illegal mix of collations" and the
      // comparison of `slug` against `strategyId` clashes too. Every join and
      // subquery below therefore pins BOTH sides to utf8mb4_0900_ai_ci.
      //
      // This was diagnosed the hard way: the throw was caught and logged as a
      // bare `.message` that came out EMPTY, so the audit produced nothing and
      // the health endpoint looked clean. That silent-no-op shape is exactly what
      // this codebase keeps producing, hence the full-error log below.
      //
      // ⚠️ THE JOIN MUST MATCH BOTH protocolId FORMS (2026-09-19, #905/#801).
      // `trading_strategy.protocolId` is slug-or-UUID; every active bot carries a SLUG
      // today (26/26 measured), and `p.id` is a UUID — so the previous `ON p.id =
      // ts.protocolId` joined NOTHING, the audit's row set was empty, and it reported
      // clean forever while two bots could not fire. Matching slug OR id is the fix.
      rows = await this.prisma.$queryRawUnsafe(`
        SELECT ts.protocolId,
               p.slug                AS slug,
               MAX(ts.minComposite)  AS required,
               COUNT(DISTINCT ts.id) AS bots,
               (SELECT MAX(CAST(JSON_UNQUOTE(JSON_EXTRACT(s.breakdown, '$.rawComposite')) AS DECIMAL(10,2))
                           / NULLIF(CAST(JSON_UNQUOTE(JSON_EXTRACT(s.breakdown, '$.configuredSignalMax')) AS DECIMAL(10,2)), 0) * 100)
                  FROM score s
                 WHERE s.strategyId COLLATE utf8mb4_0900_ai_ci = p.slug COLLATE utf8mb4_0900_ai_ci) AS ceilingPct,
               (SELECT MAX(CAST(JSON_UNQUOTE(JSON_EXTRACT(s.breakdown, '$.rawComposite')) AS DECIMAL(10,2)))
                  FROM score s
                 WHERE s.strategyId COLLATE utf8mb4_0900_ai_ci = p.slug COLLATE utf8mb4_0900_ai_ci) AS ceilingRaw,
               (SELECT MAX(CAST(JSON_UNQUOTE(JSON_EXTRACT(s.breakdown, '$.configuredSignalMax')) AS DECIMAL(10,2)))
                  FROM score s
                 WHERE s.strategyId COLLATE utf8mb4_0900_ai_ci = p.slug COLLATE utf8mb4_0900_ai_ci) AS capacity,
               (SELECT COUNT(*) FROM score s2
                 WHERE s2.strategyId COLLATE utf8mb4_0900_ai_ci = p.slug COLLATE utf8mb4_0900_ai_ci) AS samples
          FROM trading_strategy ts
          JOIN protocol p
            ON (p.id COLLATE utf8mb4_0900_ai_ci = ts.protocolId COLLATE utf8mb4_0900_ai_ci
                OR p.slug COLLATE utf8mb4_0900_ai_ci = ts.protocolId COLLATE utf8mb4_0900_ai_ci)
         WHERE ts.active = 1
         GROUP BY ts.protocolId, p.slug
      `);
    } catch (err) {
      // ⚠️ Log the FULL error, not just `.message` — an empty message here once
      // meant a collation failure took ten minutes to find. Fail loud.
      this.logger.warn(
        `Measured-ceiling audit skipped: ${(err as Error).message || String(err)}`,
      );
      return issues;
    }

    for (const row of rows) {
      const required = Number(row.required ?? 0);
      const ceilingPct = row.ceilingPct == null ? null : Number(row.ceilingPct);
      const ceilingRaw = row.ceilingRaw == null ? null : Number(row.ceilingRaw);
      const capacity = row.capacity == null ? null : Number(row.capacity);
      const samples = Number(row.samples ?? 0);

      // Need a real history before claiming a ceiling. 10 readings is enough to
      // see the shape without waiting a session.
      if (ceilingPct == null || samples < 10) continue;

      // The SAME percentage the gate compares against minComposite (#905). Raw and capacity are
      // kept in the message so the reader can re-derive the figure — a derived number alone
      // hides the data it came from.
      const describeCeiling = `${ceilingPct.toFixed(1)}% of capacity (raw ${ceilingRaw ?? '?'} of ${capacity ?? '?'})`;

      if (ceilingPct < required) {
        issues.push({
          protocolId: row.slug,
          kind: 'ceiling-below-threshold',
          severity: 'error',
          message:
            `Protocol "${row.slug}" cannot reach the composite its ${row.bots} active bot(s) ` +
            `require: highest composite EVER recorded is ${describeCeiling} against a ` +
            `minComposite of ${required}% (${samples} readings). This bot cannot trade as ` +
            `configured — fix the protocol's directional capacity, lower minComposite, or ` +
            `disable the bot.`,
        });
      } else if (ceilingPct < required * 1.25) {
        // Reaches the bar, but only just: it will fire rarely and any change to
        // directive weights could strand it.
        issues.push({
          protocolId: row.slug,
          kind: 'ceiling-near-threshold',
          severity: 'warning',
          message:
            `Protocol "${row.slug}" barely clears its threshold: highest composite ever is ` +
            `${describeCeiling} against minComposite ${required}% (${samples} readings). It ` +
            `will trade rarely, and a small change to directive weights could strand it entirely.`,
        });
      }
    }

    return issues;
  }

  /**
   * measureProtocolCeiling() — the SAME measurement, scoped to one protocol (#905).
   *
   * Returns the protocol's MEASURED ceiling as the percentage the trading gate actually
   * compares against (`compositePct = rawComposite / configuredSignalMax × 100`, the
   * configured-capacity denominator documented in protocol-gating.service.ts), plus the raw
   * figures and the sample count.
   *
   * Accepts a slug OR a UUID — bots carry either (`trading_strategy.protocolId` is
   * slug-or-UUID; see #801) — by resolving the protocol row first.
   *
   * Used by `TradingStrategyService.assertCeilingAllowsActivation()` to REFUSE activating a
   * bot whose protocol can never reach its bar (fix direction 3 of #905: the measurement
   * existed, it needed to gate rather than advise). One arithmetic basis shared with the
   * audit above, so detector and gate can never disagree about units again.
   *
   * ⚠️ Returns `null` on no history OR any failure — callers treat that as cannot-judge and
   * allow (fail-open). Activation must not be blocked by an unmeasurable protocol.
   */
  async measureProtocolCeiling(protocolIdOrSlug: string): Promise<{
    slug: string;
    ceilingPct: number;
    ceilingRaw: number;
    capacity: number;
    samples: number;
  } | null> {
    if (!this.prisma?.isAvailable || !protocolIdOrSlug) return null;
    try {
      const protoRows: any[] = await this.prisma.$queryRawUnsafe(
        `SELECT slug FROM protocol
          WHERE slug COLLATE utf8mb4_0900_ai_ci = ? COLLATE utf8mb4_0900_ai_ci
             OR id   COLLATE utf8mb4_0900_ai_ci = ? COLLATE utf8mb4_0900_ai_ci
          LIMIT 1`,
        protocolIdOrSlug,
        protocolIdOrSlug,
      );
      const slug = protoRows?.[0]?.slug;
      if (!slug) return null;

      const rows: any[] = await this.prisma.$queryRawUnsafe(
        `SELECT MAX(CAST(JSON_UNQUOTE(JSON_EXTRACT(s.breakdown, '$.rawComposite')) AS DECIMAL(10,2))) AS ceilingRaw,
                MAX(CAST(JSON_UNQUOTE(JSON_EXTRACT(s.breakdown, '$.configuredSignalMax')) AS DECIMAL(10,2))) AS capacity,
                MAX(CAST(JSON_UNQUOTE(JSON_EXTRACT(s.breakdown, '$.rawComposite')) AS DECIMAL(10,2))
                    / NULLIF(CAST(JSON_UNQUOTE(JSON_EXTRACT(s.breakdown, '$.configuredSignalMax')) AS DECIMAL(10,2)), 0) * 100) AS ceilingPct,
                COUNT(*) AS samples
           FROM score s
          WHERE s.strategyId COLLATE utf8mb4_0900_ai_ci = ? COLLATE utf8mb4_0900_ai_ci`,
        slug,
      );
      const r = rows?.[0];
      if (!r || r.ceilingPct == null) return null;
      return {
        slug,
        ceilingPct: Number(r.ceilingPct),
        ceilingRaw: Number(r.ceilingRaw),
        capacity: Number(r.capacity),
        samples: Number(r.samples),
      };
    } catch (err) {
      this.logger.warn(
        `measureProtocolCeiling(${protocolIdOrSlug}) failed: ${(err as Error).message || String(err)}`,
      );
      return null;
    }
  }

  getLast(): { generatedAt: string | null; issues: ProtocolHealthIssue[] } {
    return { generatedAt: this.lastRunAt, issues: [...this.lastIssues] };
  }

  /** Log config faults once at boot so they're visible in the backend log too. */
  async onApplicationBootstrap() {
    try {
      const configIssues = await this.validateAll();

      // Evidence-based check: can each active bot actually reach its threshold?
      // Run AFTER validateAll so `lastIssues` keeps the config findings; the
      // ceiling findings are appended so a single health call reports both.
      let ceilingIssues: ProtocolHealthIssue[] = [];
      try {
        ceilingIssues = await this.auditMeasuredCeilings();
      } catch (err) {
        this.logger.warn(`Measured-ceiling audit failed: ${(err as Error).message}`);
      }

      const issues = [...configIssues, ...ceilingIssues];
      this.lastIssues = issues;

      for (const i of issues) {
        if (i.severity === 'error') {
          this.logger.error(`Protocol config ERROR [${i.protocolId}]: ${i.message}`);
        } else {
          this.logger.log(`Protocol config warning [${i.protocolId}]: ${i.message}`);
        }
      }
      if (issues.length > 0) {
        this.logger.warn(`Protocol health: ${issues.length} config issue(s) across ${new Set(issues.map(i => i.protocolId)).size} protocol(s)`);
      }
    } catch (err) {
      this.logger.warn(`Protocol health validation failed: ${(err as Error).message}`);
    }
  }
}
