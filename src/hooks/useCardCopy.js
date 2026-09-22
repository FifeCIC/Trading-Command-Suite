/**
 * useCardCopy — the "copy this card's reference" action and its per-card feedback.
 * =================================================================================
 * Extracted 2026-09-22 (A/B Ladder) — the Ladder had this inline (state + clipboard
 * call + timeout + cleanup) and the new page copied it verbatim. Both now call this.
 *
 * ⚠️ TWO CONTRACTS THE CALLER MUST KEEP (both were paid for on the Ladder):
 *
 *   1. `copied` is PER CARD — `null` unless THIS card's copy just finished. A single
 *      boolean pair would flash the confirmation on whichever card rendered first,
 *      which is worse than no feedback because it is confidently wrong.
 *      Wire it as: `copied={copyState.key === cardKey ? copyState.ok : null}`.
 *
 *   2. A blocked clipboard reports FAILURE (`ok: false`), never a silent success —
 *      "never report a success you did not observe". `navigator.clipboard.writeText`
 *      rejects in insecure contexts / when permission is denied, and that rejection
 *      is what turns into the false.
 */
import { useEffect, useRef, useState } from 'react';
import { buildCardRef } from '../core/score-card-view';

export function useCardCopy({ label = 'TCS ladder card', holdMs = 1800 } = {}) {
  const [copyState, setCopyState] = useState({ key: null, ok: false });
  const timer = useRef(null);

  // A pending hide-timer must not outlive the page.
  useEffect(() => () => clearTimeout(timer.current), []);

  const copyCardRef = async (entry) => {
    const key = `${entry.protocolId}::${entry.symbol}`;
    let ok = true;
    try {
      await navigator.clipboard.writeText(buildCardRef(entry, { label }));
    } catch {
      ok = false; // clipboard blocked (insecure context / permission denied)
    }
    setCopyState({ key, ok });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopyState({ key: null, ok: false }), holdMs);
  };

  return { copyState, copyCardRef };
}
