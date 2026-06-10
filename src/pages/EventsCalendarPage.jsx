import FeatureSkeletonPage from './FeatureSkeletonPage'
import { SKELETON_ROLLOUT } from './skeleton-rollout'
import { SKELETON_HANDOFF } from './skeleton-handoff'

export default function EventsCalendarPage() {
  return (
    <FeatureSkeletonPage
      title="Events Calendar"
      subtitle="Economic events, earnings windows, and custom watch events aligned to risk and execution windows."
      domain="Sources / Scheduling"
      rollout={SKELETON_ROLLOUT.eventsCalendar}
      handoff={SKELETON_HANDOFF.eventsCalendar}
      milestones={[
        'Economic calendar provider sync and local cache',
        'Symbol-specific earnings and corporate event mapping',
        'Pre-event lock and post-event cool-down controls',
      ]}
      metrics={[
        { label: 'Upcoming events', value: '0 (stub)' },
        { label: 'High impact events', value: '0' },
        { label: 'Locked strategies', value: '0' },
      ]}
      placeholders={[
        'Impact Filters',
        'Timeline Heatmap',
        'Session Locks',
        'Agent Notes',
      ]}
      notes={[
        'Feed event locks into Risk Controls and Execution Queue',
        'Surface countdown timers in header context slots',
        'Design for timezone-aware automation workflows',
      ]}
    />
  )
}
