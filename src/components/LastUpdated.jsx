import { useState, useEffect } from 'react';

/**
 * LastUpdated — small timestamp badge showing how long ago data was fetched.
 *
 * Usage: <LastUpdated at={someTimestamp} />
 *
 * Displays "Updated 1m ago" → "Updated Xm ago" with minute granularity.
 * Sits top-right in the content area. Use on any view that fetches data.
 *
 * Pass `null` or omit `at` to hide the badge entirely.
 */
export default function LastUpdated({ at }) {
  const [minutesAgo, setMinutesAgo] = useState(null);

  useEffect(() => {
    if (!at) {
      setMinutesAgo(null);
      return;
    }
    function tick() {
      const ms = Date.now() - new Date(at).getTime();
      const mins = Math.max(0, Math.floor(ms / 60_000));
      setMinutesAgo(mins);
    }
    tick();
    const interval = setInterval(tick, 30_000); // update every 30s
    return () => clearInterval(interval);
  }, [at]);

  if (minutesAgo === null) return null;

  return (
    <div className="last-updated">
      Updated {minutesAgo === 0 ? 'now' : `${minutesAgo}m ago`}
    </div>
  );
}
