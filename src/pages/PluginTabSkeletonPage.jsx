import FeatureSkeletonPage from './FeatureSkeletonPage'
import { PLUGIN_TAB_SKELETONS } from './plugin-tab-skeletons'
import { SKELETON_ROLLOUT } from './skeleton-rollout'

export default function PluginTabSkeletonPage({ tabId }) {
  const meta = PLUGIN_TAB_SKELETONS[tabId]
  const rollout = SKELETON_ROLLOUT[tabId]

  if (!meta) {
    return (
      <FeatureSkeletonPage
        title="Tab Placeholder"
        subtitle="This tab has been reserved for plugin parity scaffolding."
        domain="Scaffold"
        milestones={['Define tab contract', 'Wire route data source', 'Connect operational UI states']}
        metrics={[{ label: 'Status', value: 'placeholder' }]}
        placeholders={['Data panel', 'Actions rail', 'Diagnostics']}
        notes={['Populate this tab with implementation details when feature work starts.']}
      />
    )
  }

  return (
    <FeatureSkeletonPage
      title={meta.title}
      subtitle={meta.subtitle}
      domain={meta.domain}
      rollout={rollout}
      milestones={[
        'Define contract and required data sources',
        'Add endpoint and state-store integration',
        'Ship diagnostics and operator actions',
      ]}
      metrics={[
        { label: 'Build state', value: 'skeleton' },
        { label: 'Route status', value: 'wired' },
        { label: 'Data mode', value: 'pending' },
      ]}
      placeholders={['Primary table', 'Detail rail', 'Actions', 'Diagnostics']}
      notes={[
        'Scaffold retains plugin-era tab intent while keeping implementation in this standalone app.',
        'Use this page as the insertion point for real endpoints and state contracts.',
      ]}
    />
  )
}
