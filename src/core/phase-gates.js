/**
 * Phase Gates — Features that are designed but intentionally deferred.
 *
 * These features are visible in the app as placeholders but should NOT be
 * worked on until their phase is activated. This prevents accidentally
 * spending time on "nice-to-have" features meant for a future release.
 *
 * Phases:
 *   'current'  — Active development (default, no gate)
 *   'phase-2'  — Public release features (PDF reports, multi-user, etc.)
 *   'future'   — Long-term ideas (may never be built)
 *
 * To activate a phase, change the activePhase below or set
 * `localStorage.setItem('tcs:active-phase', 'phase-2')` in the browser console.
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
 * Key: page/feature ID
 * Value: { phase, label, description, dependsOn }
 */
export const PHASE_GATES = {
  // ── Phase 2: Public Release ──────────────────────────
  'reports': {
    phase: 'phase-2',
    label: 'PDF Reports',
    description: 'Generate downloadable PDF reports for completed backtest runs. Requires PDF generation service.',
  },
  'multi-user-auth': {
    phase: 'phase-2',
    label: 'Multi-User Authentication',
    description: 'User accounts, roles, and permission-based access control.',
  },
  'public-landing': {
    phase: 'phase-2',
    label: 'Public Landing Page',
    description: 'Marketing website with feature showcase, pricing, and signup flow.',
  },
  'subscription-billing': {
    phase: 'phase-2',
    label: 'Subscription & Billing',
    description: 'Stripe integration for paid tiers with usage-based billing.',
  },

  // ── Future: Long-term Ideas ───────────────────────────
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
