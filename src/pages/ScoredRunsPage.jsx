import UnavailablePlaceholder from '../components/UnavailablePlaceholder';

export default function ScoredRunsPage() {
  return (
    <UnavailablePlaceholder
      title="Scored Runs"
      message="Historical scoring runs are not yet persisted to the database. This view requires the scoring scheduler to record completed runs with their full directive breakdowns."
      action="View Live Ordering Stack"
      actionUrl="/scoring/live-ordering-stack"
    />
  );
}
