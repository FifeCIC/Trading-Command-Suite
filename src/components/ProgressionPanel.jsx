/**
 * ProgressionPanel — the earned level, the XP behind it, and the active-bot ceiling it decides.
 *
 * WHERE THIS SITS: `/trading/trading-bots`, the page where the ceiling actually bites. It is not a
 * new page and not a new nav entry — a first-time reader meets it at the moment it matters.
 *
 * ⚠️ THE FRAMING IS THE FEATURE (#1193). The owner's words, and the panel must carry their intent:
 * *a careful restriction while the app is still new, could be resource intensive, and to protect
 * users while testing safeguards are still outstanding.* So the copy says WHY the limit exists
 * before it says what it is, and it never reads as a paywall. Nothing here is for sale — that is
 * `#809` / `#1147`, a different axis entirely.
 *
 * ⚠️ THREE STATES, RENDERED DIFFERENTLY ON PURPOSE. `status: 'unavailable'` is shown as "could not
 * be read" with its reason — never as Level 1. A confident zero on the surface that explains a
 * refusal is worse than an honest gap: the reader would believe a wrong level and have no reason
 * to check it. (Same rule as `distinguish fine from cannot-judge` in the dev philosophy.)
 *
 * ⚠️ THE SOURCE TABLE SHOWS RAW **AND** COUNTED. A capped source is why a level stops moving, and
 * hiding it turns "the level is broken" into a believable report.
 */
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import './progression-panel.css';

function SourceRow({ row }) {
  return (
    <tr>
      <th scope="row">{row.label}</th>
      <td className="prg-num">{row.raw.toLocaleString()}</td>
      <td className="prg-num">
        {row.capped ? (
          <>
            {row.counted.toLocaleString()} <span className="prg-capped">capped</span>
          </>
        ) : (
          row.counted.toLocaleString()
        )}
      </td>
      <td className="prg-num">{row.xp.toLocaleString()}</td>
    </tr>
  );
}

export default function ProgressionPanel() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['progression'],
    queryFn: () => apiGet('/api/progression'),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <section className="prg-panel prg-panel--muted" aria-busy="true">
        <h2 className="prg-title">Progression</h2>
        <p className="prg-line">Reading your record…</p>
      </section>
    );
  }

  // Cannot judge is NOT level 1. Say so, and offer the retry.
  //
  // ⚠️ NO `error.message` HERE, deliberately. `validate-notices.cjs` (Phase 5 ratchet) treats
  // `…message` as a raw error render: extracting it discards the code, the status and the remedy,
  // which is the defect #824 exposed. The server's own `reason` is a *stated* reason (not a
  // transport error) and is shown as-is; a failed request gets a sentence that says what is true.
  if (isError || !data || data.status !== 'ok') {
    const reason = isError
      ? 'The request to the API failed, so the level could not be read.'
      : data?.reason || 'The server could not compute the level.';
    return (
      <section className="prg-panel prg-panel--warn" role="status">
        <h2 className="prg-title">Progression — cannot be read</h2>
        <p className="prg-line">
          Your level decides how many bots may be active, so it is shown only when it can be
          calculated. Nothing is being enforced from this panel.
        </p>
        <p className="prg-detail">{reason}</p>
        <button type="button" className="prg-retry" onClick={() => refetch()}>
          Try again
        </button>
      </section>
    );
  }

  const { level, xp, nextLevel, percentToNext, botCap, activeBots, capReached, overCap, breakdown, enforcement } =
    data;

  return (
    <section className="prg-panel" aria-labelledby="prg-heading">
      <header className="prg-head">
        <h2 className="prg-title" id="prg-heading">
          Progression
        </h2>
        <span className="prg-level">
          Level {level.level} — {level.name}
        </span>
      </header>

      <p className="prg-why">
        A new install starts with <strong>one active bot</strong>. Running many bots at once is
        resource-intensive, and several trading safeguards are still outstanding — so the limit
        lifts as your own record shows you have used the app. It is a guardrail, not a licence, and
        nothing here is for sale.
      </p>

      <div className="prg-meter">
        <div
          className="prg-bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percentToNext}
          aria-label="Progress to the next progression level"
        >
          <span className="prg-bar-fill" style={{ width: `${percentToNext}%` }} />
        </div>
        <p className="prg-line">
          {nextLevel
            ? `${xp.toLocaleString()} XP — ${nextLevel.xpRemaining.toLocaleString()} more to reach level ${nextLevel.level} (${nextLevel.xpRequired.toLocaleString()} XP)`
            : `${xp.toLocaleString()} XP — top level reached`}
        </p>
      </div>

      <p className={`prg-cap${capReached ? ' prg-cap--reached' : ''}`}>
        <strong>
          {activeBots} {botCap === null ? 'active bots' : `of ${botCap} active bot${botCap === 1 ? '' : 's'}`}
        </strong>
        {botCap === null && ' — no ceiling at this level'}
        {capReached && nextLevel && (
          <>
            {' '}
            — at the limit. Deactivate a bot to free a slot, or reach level {nextLevel.level} to
            allow {nextLevel.activeBotCap ?? 'more'}.
          </>
        )}
        {overCap && (
          <>
            {' '}
            — above the limit for your level. Nothing has been stopped; you can deactivate and edit
            freely, and activating another waits until you are back under it.
          </>
        )}
      </p>

      <details className="prg-sources">
        <summary>How the level is earned</summary>
        <table className="prg-table">
          <caption className="prg-caption">
            Measured from this install&rsquo;s own record — nothing is awarded or spendable.
          </caption>
          <thead>
            <tr>
              <th scope="col">Source</th>
              <th scope="col">Recorded</th>
              <th scope="col">Counted</th>
              <th scope="col">XP</th>
            </tr>
          </thead>
          <tbody>
            {breakdown.map((row) => (
              <SourceRow key={row.key} row={row} />
            ))}
          </tbody>
        </table>
        <p className="prg-detail">
          Each source stops scoring at a ceiling, so no single one can carry a level on its own.
        </p>
      </details>

      {!enforcement?.enabled && (
        <p className="prg-detail">
          ⚠️ The limit is currently switched off in Settings (<code>progression.botCapEnabled</code>).
          The level is still shown, but no activation is refused.
        </p>
      )}
    </section>
  );
}
