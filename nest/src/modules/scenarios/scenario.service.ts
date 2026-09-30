import { Injectable, Logger } from '@nestjs/common';

/**
 * ScenarioService — the TRAINING unit: a symbol's market period, plus notes.
 *
 * ── OWNER DEFINITION (2026-09-30) ──────────────────────────────────────────────
 * *"specific periods of market data for a symbol and notes to understand the key activity we want to
 * practice trading, for training and in backtesting."*
 *
 * ── MERGED FROM TWO COPIES, 2026-09-30 review ────────────────────────────────
 * This module held TWO implementations of one concept:
 *   `scenario.service.ts`   (this file, WIRED)  — 3 KB
 *   `scenarios.service.ts`  (DEAD, 0 refs)      — 3 KB, DELETED
 *
 * ⚠️ **The dead copy was the better work, and its logic is what survives here.** Two places proved it:
 *
 * 1. **Readiness maths.** The dead copy computed `presentWeight / totalWeight` — a correct weighted
 *    ratio. This file computed `totalWeight / factors.length`, dividing a SUM OF WEIGHTS by a
 *    COUNT OF FACTORS. Different quantities, different units; the result was not a percentage of
 *    anything, it merely landed in a plausible range. Replaced.
 *
 * 2. **Directive identification.** This file GUESSED directive ids from a factor's NAME by substring:
 *    `f.name.toLowerCase().includes('rsi')` → `'rsi-oversold'`. That is the class
 *    `INV-NO-SYMBOL-GUESSING` already bans — *"a guess cannot survive a rename, cannot report that
 *    it broke, and is indistinguishable from a working relationship."* A factor that fires IS the
 *    directive; the name is carried directly, and the ones that did NOT fire are reported as
 *    `directivesMissed` instead of being dropped.
 *
 * ⚠️ **`readinessScore` HAD TWO UNITS UNDER ONE NAME.** This file returned 0–100; the deleted copy
 * returned 0–1. Same field name, same type (`number`), different meaning — the `protocolId`
 * slug-vs-UUID hazard in a different costume. **Standardised on 0–100**, stated in the type.
 *
 * ⚠️ **IN-MEMORY IS STILL A GAP.** Scenarios live in a `Map`, so they are LOST ON RESTART — for
 * material described as *"training and backtesting"* that is not usable. NOT fixed here: persisting
 * needs a table, and this repo has 13 tables outside Prisma with no migration history, so a schema
 * change is a deliberate decision rather than a side effect of a merge. Recorded, not smuggled in.
 */

export interface ScenarioFactor {
  name: string;
  present: boolean;
  /** Relative importance. These are SUMMED, so they must share a unit. */
  weight: number;
}

export interface ScenarioAssessment {
  /** Factors that fired — carried DIRECTLY, never inferred from the name. */
  directivesTriggered: string[];
  /** Factors that did not fire. Reported rather than dropped: this is the training value. */
  directivesMissed: string[];
  /** ⚠️ **0–100** — a percentage of the scenario's total declared weight. NOT a 0–1 fraction. */
  readinessScore: number;
  recommendation: string;
  assessedAt: string;
}

/** The market-data window a scenario covers — the "period" in the owner's definition. */
export interface ScenarioPeriod {
  from: string;
  to: string;
}

export interface Scenario {
  id: string;
  name: string;
  description: string;
  /** Free-text notes — what was notable about this period and worth practising. */
  notes: string;
  /** ⚠️ TYPED union (from the wired copy). The deleted copy used bare `string`. */
  marketCondition: 'bull' | 'bear' | 'ranging' | 'volatile' | 'crash';
  symbol: string;
  /** The market-data period this scenario is built from. */
  period: ScenarioPeriod | null;
  factors: ScenarioFactor[];
  assessment: ScenarioAssessment | null;
  /** The historical occurrence this models, and what actually happened. */
  historicalReference: { period: ScenarioPeriod; outcome: string } | null;
  createdAt: string;
}

@Injectable()
export class ScenarioService {
  private readonly logger = new Logger(ScenarioService.name);
  private scenarios = new Map<string, Scenario>();

  create(data: Partial<Scenario>): Scenario {
    const id = `scn-${Date.now()}`;
    const scenario: Scenario = {
      id,
      name: data.name || 'Unnamed Scenario',
      description: data.description || '',
      notes: data.notes || '',
      marketCondition: data.marketCondition || 'ranging',
      symbol: data.symbol || 'SPY',
      period: data.period ?? null,
      factors: data.factors || [],
      assessment: null,
      historicalReference: null,
      createdAt: new Date().toISOString(),
    };
    this.scenarios.set(id, scenario);
    this.logger.log(`Created scenario: ${scenario.name} (${scenario.symbol})`);
    return scenario;
  }

  list(): Scenario[] {
    return [...this.scenarios.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(id: string): Scenario | null {
    return this.scenarios.get(id) || null;
  }

  /**
   * assess() — how ready is this scenario?
   *
   * ⚠️ The denominator is the scenario's **total declared weight**, matching the numerator's unit.
   * The previous version divided by `factors.length`, mixing weight-units with a count.
   */
  assess(id: string): Scenario | null {
    const scenario = this.scenarios.get(id);
    if (!scenario) return null;

    const present = scenario.factors.filter((f) => f.present);
    const totalWeight = scenario.factors.reduce((s, f) => s + f.weight, 0);
    const presentWeight = present.reduce((s, f) => s + f.weight, 0);

    // ⚠️ No declared weight means NO measurable readiness. `0/0` returning a confident `0%` is an
    // absence of evidence presented as a number (INV-NO-FABRICATED-READING).
    const readinessScore = totalWeight > 0 ? Math.round((presentWeight / totalWeight) * 100) : 0;

    scenario.assessment = {
      // ⚠️ DIRECT, not inferred. The factor that fired IS the directive.
      directivesTriggered: present.map((f) => f.name),
      directivesMissed: scenario.factors.filter((f) => !f.present).map((f) => f.name),
      readinessScore,
      recommendation: totalWeight > 0
        ? readinessScore >= 70
          ? `Strong readiness (${readinessScore}%) — most of the declared weight fired.`
          : readinessScore >= 40
            ? `Partial coverage (${readinessScore}%) — review the missed factors.`
            : `Low readiness (${readinessScore}%) — significant gaps.`
        : 'No factors declared, so readiness cannot be measured. Add factors rather than reading 0% as a result.',
      assessedAt: new Date().toISOString(),
    };
    return scenario;
  }

  /** Attach what actually happened to the historical occurrence this scenario models. */
  addHistory(id: string, period: ScenarioPeriod, outcome: string): Scenario | null {
    const scenario = this.scenarios.get(id);
    if (!scenario) return null;
    scenario.historicalReference = { period, outcome };
    this.scenarios.set(id, scenario);
    return scenario;
  }
}
