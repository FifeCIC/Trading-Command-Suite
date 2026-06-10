import FeatureSkeletonPage from './FeatureSkeletonPage'
import { SKELETON_ROLLOUT } from './skeleton-rollout'
import { SKELETON_HANDOFF } from './skeleton-handoff'

export default function StrategyBuilderPage() {
  return (
    <FeatureSkeletonPage
      title="Strategy Builder"
      subtitle="Composable strategy definitions, rule packs, and guardrail templates for reusable automation."
      domain="Trading / Strategy"
      rollout={SKELETON_ROLLOUT.strategyBuilder}
      handoff={SKELETON_HANDOFF.strategyBuilder}
      milestones={[
        'Visual rule composer mapped to strategy schema',
        'Versioned strategy presets with rollback support',
        'Backtest stub integration points for later execution',
      ]}
      metrics={[
        { label: 'Strategies', value: '0 (stub)' },
        { label: 'Active templates', value: '0' },
        { label: 'Validation errors', value: '0' },
      ]}
      placeholders={[
        'Rule Canvas',
        'Condition Blocks',
        'Preset Vault',
        'Dry Run Console',
      ]}
      notes={[
        'Keep schema aligned with backend strategy DTOs',
        'Presets should include risk profile metadata',
        'Use thicker violet border for experimental modules',
      ]}
    />
  )
}
