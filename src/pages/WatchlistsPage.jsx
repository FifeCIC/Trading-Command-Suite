import UnavailablePlaceholder from '../components/UnavailablePlaceholder';

export default function WatchlistsPage() {
  return (
    <UnavailablePlaceholder
      title="Watchlists"
      message="Watchlists are not yet persisted to the database. This view requires the WatchlistService and user authentication to store and retrieve watchlists."
      action="View Active Symbols"
      actionUrl="/watchlists/active-symbols"
    />
  );
}
