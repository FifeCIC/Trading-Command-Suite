import { Injectable, Logger } from '@nestjs/common';

export interface ScenarioFactor {
  name: string;
  present: boolean;
  weight: number;
}

export interface ScenarioAssessment {
  directivesTriggered: string[];
  directivesMissed: string[];
  readinessScore: number;
  recommendation: string;
}

export interface Scenario {
  id: string;
  name: string;
  description: string;
  marketCondition: string;
  symbol: string;
  factors: ScenarioFactor[];
  assessment: ScenarioAssessment | null;
  historicalReference: { date: string; outcome: string } | null;
  createdAt: string;
}

@Injectable()
export class ScenariosService {
  private readonly logger = new Logger(ScenariosService.name);
  private scenarios: Map<string, Scenario> = new Map();

  create(data: Omit<Scenario, 'id' | 'createdAt' | 'assessment' | 'historicalReference'>): Scenario {
    const id = `sc-${Date.now()}`;
    const scenario: Scenario = {
      ...data,
      id,
      assessment: null,
      historicalReference: null,
      createdAt: new Date().toISOString(),
    };
    this.scenarios.set(id, scenario);
    return scenario;
  }

  list(): Scenario[] {
    return Array.from(this.scenarios.values());
  }

  get(id: string): Scenario | undefined {
    return this.scenarios.get(id);
  }

  assess(id: string): ScenarioAssessResult | null {
    const scenario = this.scenarios.get(id);
    if (!scenario) return null;

    const presentFactors = scenario.factors.filter(f => f.present);
    const allFactors = scenario.factors;
    const totalWeight = allFactors.reduce((s, f) => s + f.weight, 0);
    const presentWeight = presentFactors.reduce((s, f) => s + f.weight, 0);
    const readinessScore = totalWeight > 0 ? presentWeight / totalWeight : 0;

    const assessment: ScenarioAssessment = {
      directivesTriggered: presentFactors.map(f => f.name),
      directivesMissed: allFactors.filter(f => !f.present).map(f => f.name),
      readinessScore: Math.round(readinessScore * 100) / 100,
      recommendation: readinessScore > 0.7
        ? `Strong readiness (${(readinessScore * 100).toFixed(0)}%) — most relevant directives would fire.`
        : readinessScore > 0.4
          ? `Partial coverage (${(readinessScore * 100).toFixed(0)}%) — some gaps, review missing factors.`
          : `Low readiness (${(readinessScore * 100).toFixed(0)}%) — significant gaps. Add more directives or data.`,
    };

    scenario.assessment = assessment;
    this.scenarios.set(id, scenario);
    return { scenario };
  }

  addHistory(id: string, date: string, outcome: string): Scenario | null {
    const scenario = this.scenarios.get(id);
    if (!scenario) return null;
    scenario.historicalReference = { date, outcome };
    this.scenarios.set(id, scenario);
    return scenario;
  }
}

export interface ScenarioAssessResult {
  scenario: Scenario;
}
