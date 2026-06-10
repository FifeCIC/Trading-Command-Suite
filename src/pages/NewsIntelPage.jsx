import FeatureSkeletonPage from './FeatureSkeletonPage'
import { SKELETON_ROLLOUT } from './skeleton-rollout'
import { SKELETON_HANDOFF } from './skeleton-handoff'

export default function NewsIntelPage() {
  return (
    <FeatureSkeletonPage
      title="News Intel"
      subtitle="Event-aware market news ingestion, relevance scoring, and actionable context for strategy modules."
      domain="Sources / Intelligence"
      rollout={SKELETON_ROLLOUT.newsIntel}
      handoff={SKELETON_HANDOFF.newsIntel}
      milestones={[
        'Provider normalization for headline and article feeds',
        'Symbol relevance scoring and confidence bands',
        'Directive hooks for news-triggered strategy context',
      ]}
      metrics={[
        { label: 'Headlines / hour', value: '0 (stub)' },
        { label: 'Mapped symbols', value: '0' },
        { label: 'Sentiment drift', value: 'N/A' },
      ]}
      placeholders={[
        'Feed Router',
        'Relevance Engine',
        'Sentiment Lens',
        'Alert Timeline',
      ]}
      notes={[
        'Target: no provider lock-in at ingestion layer',
        'Use score envelopes consumed by Signals page',
        'Keep all widgets token-driven and theme-safe',
      ]}
    />
  )
}
