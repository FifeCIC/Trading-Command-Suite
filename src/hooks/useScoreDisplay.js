/**
 * useScoreDisplay — the Screen Options "Score Display" preference, live.
 * ======================================================================
 * Extracted 2026-09-22 (A/B Ladder) — the Ladder had this as an inline useState +
 * 250 ms localStorage poll, and the new page copied it verbatim. Both now call this.
 *
 * ⚠️ WHY A POLL AND NOT JUST useState. The Screen Options control writes to
 * localStorage from a different component; a same-tab write does NOT fire the
 * `storage` event, so an event listener would never see the change. Polling is the
 * deliberate mechanism, not an oversight — do not "simplify" it to an event listener.
 */
import { useEffect, useState } from 'react';
import { readScoreDisplay } from '../core/score-card-filters';

export function useScoreDisplay(intervalMs = 250) {
  const [scoreDisplay, setScoreDisplay] = useState(readScoreDisplay);

  useEffect(() => {
    const interval = setInterval(() => {
      setScoreDisplay((prev) => {
        const current = readScoreDisplay();
        return prev !== current ? current : prev;
      });
    }, intervalMs);
    return () => clearInterval(interval);
  }, [intervalMs]);

  return scoreDisplay;
}
