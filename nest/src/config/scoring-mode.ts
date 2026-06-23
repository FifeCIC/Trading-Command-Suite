/**
 * Scoring mode helper — single source of truth for demo/live gating.
 *
 * "demo" = relaxed: all directives fire, regime mismatch → -30% not MUTE, risk floor raised
 * "live" = strict:  regime gating enforced, directives muted on mismatch, risk floor 0.3
 *
 * Controlled by SCORING_MODE in .env
 */
export function isScoringDemo(): boolean {
  return (process.env.SCORING_MODE || 'demo') === 'demo';
}
