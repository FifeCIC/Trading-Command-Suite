/**
 * Phase Gates — Development phases for the Trading Command Suite.
 *
 * Phase 1: Core Engine     — Data pipeline, scoring, automation, execution
 * Phase 2: Prove & Publish — Backtesting, validation, social proof, content
 * Phase 3: Public Launch   — Multi-user, billing, landing page, marketplace
 *
 * Strategy: Build → Prove → Launch (not Build → Launch → Prove).
 * Social proof from backtest results and content published to
 * Twitter/Reddit/Discord builds trust before a landing page exists.
 */

const STORAGE_KEY = 'tcs:active-phase';

function getActivePhase() {
  try {
    return localStorage.getItem(STORAGE_KEY) || 'current';
  } catch {
    return 'current';
  }
}

/**
 * Features gated behind specific phases.
 *
 * Phase 2: Backtesting & Social Proof
 *   Backtest all directives, validate strategies against historical data,
 *   publish equity curves and win rates to social media. Build audience
 *   through evidence, not promises.
 *
 * Phase 3: Public Launch
 *   Multi-user platform with billing, PDF reports, landing page.
 *   Only after the engine is proven and an audience exists.
 */
export const PHASE_GATES = {
  // ── Phase 2: Backtesting & Social Proof ────────────────
  'backtest-full-pipeline': {
    phase: 'phase-2',
    label: 'Full Backtest Pipeline',
    description: 'Backtest all directives against historical data with parameter optimization and walk-forward validation.',
  },
  'social-content': {
    phase: 'phase-2',
    label: 'Social Media Publishing',
    description: 'Automated equity curve screenshots, win rate summaries, and strategy performance posts for Twitter/Reddit/Discord.',
  },
  'strategy-showcase': {
    phase: 'phase-2',
    label: 'Public Strategy Showcase',
    description: 'Public-facing strategy performance pages with verified track records for social proof.',
  },

  // ── Phase 3: Public Launch ─────────────────────────────
  'reports': {
    phase: 'phase-3',
    label: 'PDF Reports',
    description: 'Generate downloadable PDF reports for completed backtest runs.',
  },
  'multi-user-auth': {
    phase: 'phase-3',
    label: 'Multi-User Authentication',
    description: 'User accounts, roles, and permission-based access control.',
  },
  'public-landing': {
    phase: 'phase-3',
    label: 'Public Landing Page',
    description: 'Marketing website with feature showcase, pricing, and signup flow.',
  },
  'subscription-billing': {
    phase: 'phase-3',
    label: 'Subscription & Billing',
    description: 'Stripe integration for paid tiers with usage-based billing.',
  },

  // ── Future: Long-term Ideas ────────────────────────────
  'social-trading': {
    phase: 'future',
    label: 'Social Trading',
    description: 'Share strategies, follow other traders, copy-trade functionality.',
  },
  'mobile-app': {
    phase: 'future',
    label: 'Native Mobile App',
    description: 'iOS/Android app with push notifications for signals and alerts.',
  },
  'ai-chatbot': {
    phase: 'future',
    label: 'AI Trading Chatbot',
    description: 'Conversational AI that answers trading questions and suggests strategies.',
  },
  'marketplace': {
    phase: 'future',
    label: 'Strategy Marketplace',
    description: 'Buy and sell trading strategies with verified track records.',
  },
};

/**
 * Check if a feature is currently gated (should NOT be worked on).
 */
export function isGated(featureId) {
  const gate = PHASE_GATES[featureId];
  if (!gate) return false;
  return gate.phase !== getActivePhase();
}

/**
 * Get the active phase name.
 */
export function getPhase() {
  return getActivePhase();
}

/**
 * Get all features for a given phase.
 */
export function getPhaseFeatures(phase) {
  return Object.entries(PHASE_GATES)
    .filter(([, gate]) => gate.phase === phase)
    .map(([id, gate]) => ({ id, ...gate }));
}
