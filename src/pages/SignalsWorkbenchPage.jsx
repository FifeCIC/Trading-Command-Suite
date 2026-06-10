import FeatureSkeletonPage from './FeatureSkeletonPage'
import { SKELETON_ROLLOUT } from './skeleton-rollout'
import { SKELETON_HANDOFF } from './skeleton-handoff'

export default function SignalsWorkbenchPage() {
  return (
    <FeatureSkeletonPage
      title="Signals Workbench"
      subtitle="Live signal stack with directive breakdown, confidence, and path-to-execution preview."
      domain="Trading / Decision Layer"
      rollout={SKELETON_ROLLOUT.signalsWorkbench}
      handoff={SKELETON_HANDOFF.signalsWorkbench}
      milestones={[
        'Normalize directive outputs into signal envelopes',
        'Visual confidence rails and conflict resolution badges',
        'Pre-trade checks before queue handoff',
      ]}
      metrics={[
        { label: 'Signals / cycle', value: '0 (stub)' },
        { label: 'Bull / Bear ratio', value: 'N/A' },
        { label: 'Execution-ready', value: '0' },
      ]}
      placeholders={[
        'Signal Ladder',
        'Directive Drilldown',
        'Conflict Resolver',
        'Queue Preview',
      ]}
      notes={[
        'Consumes freshness, news, and strategy context',
        'Output contract should be execution-engine friendly',
        'Neon cyan border reserved for active signal blocks',
      ]}
    />
  )
}
