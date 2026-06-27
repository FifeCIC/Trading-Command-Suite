import UnavailablePlaceholder from '../components/UnavailablePlaceholder';

export default function ScoringActivityLogPage() {
  return (
    <UnavailablePlaceholder
      title="Scoring Activity Log"
      message="The real-time scoring event log is not yet connected. This view requires the API activity pipeline to record scoring events to the database."
      action="View Automation Dashboard"
      actionUrl="/automation/automation-dashboard"
    />
  );
}
