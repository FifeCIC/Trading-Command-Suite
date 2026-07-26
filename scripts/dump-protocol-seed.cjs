const fs = require('fs');
const seed = JSON.parse(fs.readFileSync('C:/wamp64/www/trading-command-suite/nest/data/protocols-seed-compact.json', 'utf8'));

const header = `// Auto-generated protocol seed data — used by ProtocolDbService.seedProtocolsToDatabase()
// Regenerate from live DB: node scripts/dump-protocol-seed.cjs
// Source: POST /api/scoring/gated/protocols/seed uses this data to populate empty DBs.

export interface SeedProtocolGroup {
  id: string;
  name: string;
  description: string;
  weight: number;
  isRiskGate: boolean;
  minMultiplier: number;
  maxMultiplier: number;
  directiveIds: string[];
  directiveMaxScores: Record<string, number>;
}

export interface SeedProtocol {
  name: string;
  description: string;
  directionMode: string;
  tradingStyle: string | null;
  recommendedTimeframe: string | null;
  avgHoldTime: string | null;
  winRateTarget: string | null;
  idealFor: string | null;
  groups: SeedProtocolGroup[];
}

export const PROTOCOL_SEED_DATA: Record<string, SeedProtocol> = `;

const content = header + JSON.stringify(seed, null, 2) + ';\n';
fs.writeFileSync('C:/wamp64/www/trading-command-suite/nest/src/modules/scoring/protocols-seed-data.ts', content);
console.log('Wrote', Object.keys(seed).length, 'protocols to protocols-seed-data.ts');
