import UnavailablePlaceholder from '../components/UnavailablePlaceholder';
export default function ResearchOverviewPage() {
  return (
    <UnavailablePlaceholder
      title='Research Overview'
      message='This view requires active scoring pipeline data.'
      action='View Live Ordering Stack'
      actionUrl='/scoring/live-ordering-stack'
    />
  );
}
