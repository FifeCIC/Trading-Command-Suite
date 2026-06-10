import FeatureSkeletonPage from './FeatureSkeletonPage'
import { SKELETON_ROLLOUT } from './skeleton-rollout'
import { SKELETON_HANDOFF } from './skeleton-handoff'

export default function RiskControlsPage() {
  return (
    <FeatureSkeletonPage
      title="Risk Controls"
      subtitle="Central guardrails for exposure, drawdown limits, session gating, and circuit-breaker behavior."
      domain="Ops / Governance"
      rollout={SKELETON_ROLLOUT.riskControls}
      handoff={SKELETON_HANDOFF.riskControls}
      milestones={[
        'Portfolio and symbol exposure thresholds',
        'Time-window constraints for volatile sessions',
        'Emergency kill-switch and auto-recovery states',
      ]}
      metrics={[
        { label: 'Risk profiles', value: '0 (stub)' },
        { label: 'Blocked orders', value: '0' },
        { label: 'Circuit state', value: 'Ready' },
      ]}
      placeholders={[
        'Exposure Caps',
        'Drawdown Guard',
        'Session Gates',
        'Kill Switch Log',
      ]}
      notes={[
        'Every execution request must pass this layer',
        'Integrate event locks from Events Calendar',
        'Use amber thick outlines for warning blocks',
      ]}
    />
  )
}
