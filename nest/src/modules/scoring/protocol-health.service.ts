import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { ProtocolDbService } from './protocol-db.service';
import { DirectivesService } from '../directives/directives.service';
import { PrismaService } from '../../database/prisma.service';

/**
 * Resolve the `nest/` package root by walking up from `__dirname` until a directory holding
 * `package.json` is found.
 *
 * ⚠️ NOT a hardcoded `'..'` depth. The compiled module lives at `dist/src/modules/scoring/`, so a
 * fixed depth resolves to `nest/` from source and to something else entirely from `dist/`. This is
 * exactly the bug `log.service.ts` documents — a path that worked in dev and silently pointed at
 * the build-owned `dist/` at runtime. Walking to `package.json` is layout-independent.
 */
function resolveNestRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i += 1) {
    const parent = path.dirname(dir);
    if (parent === dir) break; // filesystem root
    dir = parent;
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
  }
  return process.cwd();
}

/**
 * The coverage validator (#970).
 *
 * ⚠️ The rule is IMPLEMENTED ONCE, in this `.cjs` file, and this service SPAWNS it rather than
 * re-implementing the same membership test in TypeScript. Two copies of one rule drift, and only
 * one of them gets the next fix.
 */
const COVERAGE_VALIDATOR = path.join(
  resolveNestRoot(),
  'scripts',
  'validate-protocol-covers-bot-symbol.cjs',
);

export interface CoveragePayload {
  bots: number;
  covered: number;
  failures: { bot: string; symbol: string; protocol: string; set: string[] }[];
  cannotJudge: { bot: string; symbol: string; protocol: string }[];
}

/**
 * Turn the validator's `--json` payload into one warning line, or `null` when there is nothing to
 * report. PURE, so it is exercised without spawning anything.
 *
 * ⚠️ Returns `null` ONLY for a well-formed payload with zero failures. A payload that cannot be
 * read is NOT this function's job — the caller must report that as "could not run", never as "OK".
 * Collapsing "fine" and "cannot judge" is the defect this repo names most often.
 */
export function formatCoverageWarning(payload: CoveragePayload | null | undefined): string | null {
  if (!payload || !Array.isArray(payload.failures) || payload.failures.length === 0) return null;
  const named = payload.failures
    .slice(0, 5)
    .map((f) => `${f.bot} trades ${f.symbol} but protocol '${f.protocol}' declares [${(f.set ?? []).join(', ')}]`)
    .join('; ');
  const more = payload.failures.length > 5 ? ` (+${payload.failures.length - 5} more)` : '';
  return `${payload.failures.length} bot(s) score on a protocol that never declares their own symbol: ${named}${more}`;
}

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
    // RETIRED 2026-09-21 (#906): 'low-declared-directional-capacity' was removed.
    // Declared bias does not describe runtime capacity — measured: a `neutral`
    // directive emitted 11,129 directional hits over 7 days, and the config-based
    // verdict was already tried and reverted once as a capacity rule (ADR-011,
    // SETTLED-DECISIONS row 9, guarded by directional-capacity-contract.spec.ts).
    // The actionable version is evidence-based: 'ceiling-below-threshold'.
    /** Measured maximum composite is BELOW the bot's minComposite — the bot can
     *  never trade as configured, however the market behaves (2026-09-10). */
    | 'ceiling-below-threshold'
    /** Measured maximum composite clears minComposite by under 25%, so the bot
     *  fires rarely and is fragile to any weight change (2026-09-10). */
    | 'ceiling-near-threshold';
  severity: 'warning' | 'error';
  message: string;
}

/**
 * ⚠️ #999 — WHY THERE IS NO WINDOW CONSTANT HERE, AND WHY THAT IS DELIBERATE.
 *
 * The defect was that `auditMeasuredCeilings()` read the `score` table and described what it found
 * as "the highest composite EVER recorded". Measured 2026-09-27, that is false: `score` held 6,304
 * rows spanning 2026-08-29 -> 09-27, while `score_snapshot` held 314,024 rows spanning 06-30 ->
 * 09-27. And the number is not stable — for `xau-speed-m15` the `score` maximum was 55 when the
 * issue was written and 32 when this was fixed, against a true all-history maximum of **638**.
 *
 * MY FIRST ATTEMPT AT THE FIX WAS WRONG, and it is recorded here because the mistake is the
 * instructive part: I bounded the query with `AND s.timestamp >= ?` for a 30-day window. But
 * `measureProtocolCeiling()` shares this arithmetic basis with this audit ON PURPOSE (see its
 * docstring — "One arithmetic basis shared with the audit above, so detector and gate can never
 * disagree about units again"), and that one is NOT windowed. Bounding the audit alone would have
 * made the detector and the activation gate measure DIFFERENT ceilings for the same protocol.
 * Introducing a disagreement between a detector and the gate that consumes it is a worse fault
 * than the one being fixed.
 *
 * So the measurement is left on the shared, unbounded basis and the defect is fixed at the two
 * places it actually lived:
 *   1. THE CLAIM — the message now states the RANGE it read (`MIN(timestamp)` to now) instead of
 *      asserting "EVER".
 *   2. THE VERDICT — a `score_snapshot` cross-check can VETO the finding. When full history shows
 *      a higher composite than the window did, "cannot reach the bar" is not established and is
 *      reported as a warning rather than an error.
 *
 * ⚠️ A window constant is NOT the fix here. If one is ever wanted, it must be applied to
 * `measureProtocolCeiling()` in the same change, so detector and gate stay on one basis.
 */

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

      // ── Directional capacity verdict — RETIRED 2026-09-21 (#906) ──────────
      // A per-protocol "declared directional capacity" warning lived here. It was
      // removed because the field it measured understates runtime behaviour: over
      // 7 days, directives DECLARING `neutral` emitted thousands of directional
      // hits (support-resistance-levels 11,129; macd-crossover 5,252), and the same
      // config-based verdict was already tried and reverted once as a capacity rule
      // (ADR-011 + SETTLED-DECISIONS row 9; guarded by
      // directional-capacity-contract.spec.ts). It fired for 14 of 17 protocols —
      // one structural cause, fourteen alarms — while the genuinely actionable cases
      // sit above it as evidence: 'ceiling-below-threshold' from the measured-ceiling
      // audit (auditMeasuredCeilings). Do not reintroduce a config-derived verdict
      // here; measure outcomes instead.

      for (const group of config.groups as any[]) {
        const groupId: string = group.id;
        const directiveIds: string[] = group.directiveIds ?? [];
        const weight = Number(group.weight ?? 0);

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
   * Its predecessor, `low-declared-directional-capacity`, was RETIRED
   * (#906, 2026-09-21) because it read config, and config understates real
   * capacity — several directives declare `neutral` yet emit direction at
   * runtime (measured). This audit replaced it: config alone cannot answer the
   * question that actually matters: **can this bot ever trade?**
   *
   * This check answers it from evidence. For each active bot it takes the
   * protocol's highest composite **within the range of `score` it actually read** and compares it
   * to the bot's own threshold. If the ceiling is below the bar, the bot is configured to never
   * fire, and no amount of market movement will change that.
   *
   * ⚠️ #999 — IT USED TO SAY "EVER RECORDED" HERE, AND THAT WAS FALSE. `score` is a shorter,
   * non-stationary window than `score_snapshot` (6,304 rows / 29 days against 314,024 rows /
   * 89 days, measured 2026-09-27), and its maximum moves: 55 then 32 for `xau-speed-m15`, against
   * a true all-history peak of 638. So the range is now NAMED in the message, and a `score_snapshot`
   * cross-check can veto the finding when the longer history contradicts it. A measurement that
   * describes a window must say so; a verdict that history falsifies must not be an error.
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
    // ⚠️ NO `isAvailable` GUARD HERE (2026-09-19, #905). It used to be
    // `if (!this.prisma?.isAvailable) return issues;` — and at `onApplicationBootstrap` time that
    // flag can still be false, so the audit returned an EMPTY list with no log line: the boot
    // surface reported clean while the endpoint (a minute later, flag true) found three issues in
    // the same process. A guard that converts "cannot run yet" into "found nothing" is the
    // silent-no-op shape this file already warns about. Let the query run; a genuine failure
    // reaches the catch below, which logs the FULL error.
    if (!this.prisma) return issues;

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
      // ⚠️ #999 — THE WINDOW IS NOW BOUNDED **AND** CROSS-CHECKED, because "EVER" WAS A FALSE CLAIM.
      //
      // This query reads `score`. Measured 2026-09-27, `score` holds 6,304 rows spanning
      // 2026-08-29 -> 09-27 (29 days), while `score_snapshot` holds 314,024 rows spanning
      // 2026-06-30 -> 09-27 (89 days). The message below nevertheless said "highest composite
      // EVER recorded", and `(N readings)` printed a bare count with no window on it.
      //
      // ⚠️ WORSE, ITEM: THE WINDOW IS NOT EVEN STABLE. For `xau-speed-m15` the `score` maximum was
      // 55 when #999 was written and is 32 now, against a TRUE all-history maximum of 638 in
      // `score_snapshot`. So the audit can pronounce a protocol unable to reach its bar using a
      // number that is (a) window-dependent and (b) contradicted by the protocol's own history.
      //
      // The `snapshot*` subqueries below are the falsification test. `score_snapshot` carries no
      // `breakdown` JSON, so it CANNOT yield `configuredSignalMax` and therefore cannot produce a
      // percentage — it is deliberately used here as a RAW historical corroboration only, on the
      // same basis (`composite` vs `rawComposite`), which is why it can veto a verdict but never
      // create one.
      // ⚠️ #999 — THE WINDOW IS CROSS-CHECKED, BUT DELIBERATELY **NOT** BOUNDED HERE.
      //
      // My first attempt at this fix added `AND s.timestamp >= ?` to bound the window. That was
      // WRONG and is recorded because it would have been a regression: `measureProtocolCeiling()`
      // below shares this arithmetic basis with this audit on purpose (see its docstring — "so
      // detector and gate can never disagree about units again"), and it is NOT windowed. Bounding
      // the audit alone would let the detector and the activation gate measure different ceilings
      // for the same protocol and disagree — a worse fault than the one being fixed.
      //
      // So the basis stays shared and unbounded; what changes is (1) the message states the RANGE
      // it actually read instead of claiming "EVER", and (2) the `snapshot*` subqueries below
      // falsify a verdict that full history contradicts. Both fix the defect without moving the
      // measurement.
      //
      // MEASURED 2026-09-27, and it is why "EVER" was false: `score` held 6,304 rows spanning
      // 2026-08-29 -> 09-27 (29 days) while `score_snapshot` held 314,024 rows spanning 06-30 ->
      // 09-27 (89 days). ⚠️ The window is not even stable — for `xau-speed-m15` the `score` maximum
      // was 55 when #999 was written and 32 when this was fixed, against a TRUE all-history maximum
      // of 638. A number that moves is not "EVER", and it cannot be the basis of a definite error.
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
                 WHERE s2.strategyId COLLATE utf8mb4_0900_ai_ci = p.slug COLLATE utf8mb4_0900_ai_ci) AS samples,
               -- The ACTUAL range read, so the message can name it rather than say "EVER".
               (SELECT MIN(s.timestamp) FROM score s
                 WHERE s.strategyId COLLATE utf8mb4_0900_ai_ci = p.slug COLLATE utf8mb4_0900_ai_ci) AS windowFrom,
               -- ⚠️ The falsification test: a LONGER history, from the table the pipeline writes.
               (SELECT MAX(ss.composite) FROM score_snapshot ss
                 WHERE ss.protocolId COLLATE utf8mb4_0900_ai_ci = p.slug COLLATE utf8mb4_0900_ai_ci) AS snapshotMax,
               (SELECT COUNT(*) FROM score_snapshot ss
                 WHERE ss.protocolId COLLATE utf8mb4_0900_ai_ci = p.slug COLLATE utf8mb4_0900_ai_ci) AS snapshotSamples,
               (SELECT MAX(ss.snappedAt) FROM score_snapshot ss
                 WHERE ss.protocolId COLLATE utf8mb4_0900_ai_ci = p.slug COLLATE utf8mb4_0900_ai_ci) AS snapshotNewest
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
      const snapshotMax = row.snapshotMax == null ? null : Number(row.snapshotMax);
      const snapshotSamples = Number(row.snapshotSamples ?? 0);

      // Need a real history before claiming a ceiling. 10 readings is enough to
      // see the shape without waiting a session.
      if (ceilingPct == null || samples < 10) continue;

      // ⚠️ #999 — THE RANGE IS NAMED, NOT CLAIMED. A bare count hides its own span:
      // `(101 readings)` is unreadable; `(101 readings, 2026-08-30 -> 2026-09-27)` is checkable.
      // This is the ACTUAL range of `score` for this protocol, read from MIN(timestamp), so the
      // message can never again describe a window as all of history.
      const windowFrom = row.windowFrom ? new Date(row.windowFrom).toISOString().slice(0, 10) : 'earliest';
      const windowTo = new Date().toISOString().slice(0, 10);
      const windowLabel = `${windowFrom} to ${windowTo}, ${samples} readings`;
      const historyLabel = snapshotSamples > 0
        ? `peak composite ${snapshotMax} across ${snapshotSamples} snapshots`
        : 'no snapshot history to compare against';

      // The SAME percentage the gate compares against minComposite (#905). Raw and capacity are
      // kept in the message so the reader can re-derive the figure — a derived number alone
      // hides the data it came from.
      const describeCeiling = `${ceilingPct.toFixed(1)}% of capacity (raw ${ceilingRaw ?? '?'} of ${capacity ?? '?'})`;

      // ⚠️⚠️ #999 — THE FALSIFICATION TEST. A verdict of "this protocol cannot reach its bar" is a
      // claim about ALL time, but it is computed from a WINDOW. `score_snapshot` holds the longer
      // history, so when it shows a composite HIGHER than anything in the window, the protocol has
      // demonstrably reached further than the window suggests and this verdict is NOT established.
      //
      // Measured for `xau-speed-m15`: window maximum raw 32, full-history maximum 638. Reporting
      // "cannot reach 91" from the window alone would have been a false error contradicted by the
      // protocol's own record — the exact shape this repo keeps re-finding (plausible output, no
      // error, wrong underneath).
      //
      // It is deliberately a VETO and never a pass: `score_snapshot` carries no `breakdown`, so it
      // cannot yield `configuredSignalMax` and cannot compute a percentage. It can only say "the
      // window understates this protocol", which is a reason to LOOK, not a reason to approve.
      const historyExceedsWindow =
        snapshotMax != null && ceilingRaw != null && snapshotMax > ceilingRaw;

      if (historyExceedsWindow) {
        issues.push({
          protocolId: row.slug,
          kind: 'ceiling-near-threshold',
          severity: 'warning',
          message:
            `Protocol "${row.slug}" measures ${describeCeiling} over ${windowLabel}, BELOW its ` +
            `${row.bots} active bot(s)' minComposite of ${required}% — but a LONGER history is ` +
            `higher (${historyLabel}), so "cannot reach the bar" is NOT established. Treat this as ` +
            `a reason to look, not a verdict: the window may be unrepresentative, or the protocol ` +
            `may have been changed. NOT reported as an error, because an error is a fact and this ` +
            `is a contradiction between two sources.`,
        });
      } else if (ceilingPct < required) {
        issues.push({
          protocolId: row.slug,
          kind: 'ceiling-below-threshold',
          severity: 'error',
          message:
            `Protocol "${row.slug}" cannot reach the composite its ${row.bots} active bot(s) ` +
            `require: highest composite over ${windowLabel} is ${describeCeiling} against a ` +
            `minComposite of ${required}%, and the longer history agrees (${historyLabel}). ` +
            `This bot cannot trade as configured — fix the protocol's directional capacity, lower ` +
            `minComposite, or disable the bot.`,
        });
      } else if (ceilingPct < required * 1.25) {
        // Reaches the bar, but only just: it will fire rarely and any change to
        // directive weights could strand it.
        issues.push({
          protocolId: row.slug,
          kind: 'ceiling-near-threshold',
          severity: 'warning',
          message:
            `Protocol "${row.slug}" barely clears its threshold: highest composite over ` +
            `${windowLabel} is ${describeCeiling} against minComposite ${required}%. It ` +
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

    // ── Bot ↔ protocol symbol coverage (#970) ───────────────────────────────
    // ⚠️ Deliberately NOT awaited. This spawns a child process that itself reads MySQL by CLI;
    // awaiting it would make API READINESS depend on that read. A diagnostic must never delay boot,
    // and it must never be fatal — every path below resolves.
    void this.checkBotSymbolCoverage();
  }

  /**
   * Log, once at boot, whether any ACTIVE bot scores on a protocol that never declares the bot's own
   * symbol (#970). Such a bot produces scores it can never act on, and nothing else reports it.
   *
   * ⚠️ THREE outcomes, kept apart on purpose — because "found nothing" and "could not look" must
   * never render the same:
   *   • findings        → WARN, naming the bots
   *   • zero findings   → a quiet LOG line
   *   • could not run   → WARN saying so, explicitly "cannot judge", NOT "no findings"
   */
  private checkBotSymbolCoverage(): Promise<void> {
    return new Promise<void>((resolve) => {
      if (!fs.existsSync(COVERAGE_VALIDATOR)) {
        this.logger.warn(
          `Bot-symbol coverage (#970): check DID NOT RUN — validator not found at ${COVERAGE_VALIDATOR}. ` +
          'This is "cannot judge", NOT "no findings".',
        );
        return resolve();
      }

      execFile(
        process.execPath,
        [COVERAGE_VALIDATOR, '--json'],
        { timeout: 30_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
        (err, stdout) => {
          // ⚠️ A non-zero exit is EXPECTED when findings exist (the validator exits 1 for them), so
          // `err` alone is not a failure. Only an unparseable payload means "could not run".
          let payload: CoveragePayload | null = null;
          try {
            payload = JSON.parse(String(stdout ?? ''));
          } catch {
            payload = null;
          }

          if (!payload) {
            this.logger.warn(
              `Bot-symbol coverage (#970): check COULD NOT RUN (${err?.message ?? 'no JSON output'}). ` +
              'Treated as "cannot judge", NOT as "no findings".',
            );
            return resolve();
          }

          const warning = formatCoverageWarning(payload);
          if (warning) {
            this.logger.warn(`Bot-symbol coverage (#970): ${warning}`);
          } else {
            this.logger.log(
              `Bot-symbol coverage (#970): OK — ${payload.covered} bot(s) verified, ` +
              `${payload.failures?.length ?? 0} unreachable, ` +
              `${payload.cannotJudge?.length ?? 0} not judgeable.`,
            );
          }
          resolve();
        },
      );
    });
  }
}
