import { Injectable, Logger } from '@nestjs/common';

export interface ScenarioFactor {
  name: string;
  present: boolean;
  weight: number; // 0-1
}

export interface ScenarioAssessment {
  directivesTriggered: string[];
  readinessScore: number; // 0-100
  recommendation: string;
  assessedAt: string;
}

export interface Scenario {
  id: string;
  name: string;
  description: string;
  marketCondition: 'bull' | 'bear' | 'ranging' | 'volatile' | 'crash';
  symbol: string;
  factors: ScenarioFactor[];
  assessment: ScenarioAssessment | null;
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
      marketCondition: data.marketCondition || 'ranging',
      symbol: data.symbol || 'SPY',
      factors: data.factors || [],
      assessment: null,
      createdAt: new Date().toISOString(),
    };
    this.scenarios.set(id, scenario);
    this.logger.log(`Created scenario: ${scenario.name}`);
    return scenario;
  }

  list(): Scenario[] {
    return [...this.scenarios.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(id: string): Scenario | null {
    return this.scenarios.get(id) || null;
  }

  assess(id: string): Scenario | null {
    const scenario = this.scenarios.get(id);
    if (!scenario) return null;

    const presentFactors = scenario.factors.filter((f) => f.present);
    const totalWeight = presentFactors.reduce((s, f) => s + f.weight, 0);
    const readinessScore = Math.min(100, Math.round((totalWeight / Math.max(1, scenario.factors.length)) * 100));

    const directivesTriggered: string[] = [];
    for (const f of presentFactors) {
      if (f.name.toLowerCase().includes('rsi')) directivesTriggered.push('rsi-oversold');
      if (f.name.toLowerCase().includes('macd')) directivesTriggered.push('macd-crossover');
      if (f.name.toLowerCase().includes('ema')) directivesTriggered.push('ema-structure');
      if (f.name.toLowerCase().includes('atr')) directivesTriggered.push('atr-dip');
      if (f.name.toLowerCase().includes('volume')) directivesTriggered.push('volume-confirmation');
      if (f.name.toLowerCase().includes('support')) directivesTriggered.push('support-resistance');
    }

    const recommendation = readinessScore >= 70 ? 'System is ready for this scenario'
      : readinessScore >= 40 ? 'Partially ready — some directives may miss'
      : 'Not ready — significant gaps in factor coverage';

    scenario.assessment = {
      directivesTriggered: [...new Set(directivesTriggered)],
      readinessScore,
      recommendation,
      assessedAt: new Date().toISOString(),
    };
    return scenario;
  }
}
