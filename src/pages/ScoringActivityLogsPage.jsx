import UnavailablePlaceholder from '../components/UnavailablePlaceholder';

export default function ScoringActivityLogsPage() {
  return (
    <UnavailablePlaceholder
      title="Scoring Activity Logs"
      message="The scoring activity log pipeline is not yet connected to the live scoring engine. This view requires the OutcomeTrackerService to persist directive-level traces to the database."
      action="View Live Scoring"
      actionUrl="/scoring/live-ordering-stack"
    />
  );
}
