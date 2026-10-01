/**
 * BotTradeability — "can a bot actually act on this card's signal?" (#911).
 *
 * WHY IT IS ON THE CARD AND NOT ON A SETTINGS PAGE
 * ------------------------------------------------
 * `ScoringThresholds` already shows the two scales — but on Scoring and Trading settings, which is
 * not where anyone reads a signal. An operator looking at a ladder card saw `BUY` and had no way to
 * know that 24 of 26 bots refuse at that strength. The reconciliation has to be on the surface where
 * the claim is made.
 *
 * ⚠️ NO NEW ENDPOINT AND NO NEW THRESHOLD. `GET /api/scoring/gated/thresholds` already returns
 * `bots[]` with each bot's `barPct`, and react-query already caches it under `['scoring-thresholds']`
 * — the same key `ScoringThresholds` uses, so this is one cached read, not a fetch per card. The
 * RULE lives in `src/core/tradeability.js` and is covered by `node --test`.
 *
 * ⚠️ It renders in EVERY state, including `clear`. A block that appears only when something is
 * wrong teaches the reader that absence means fine — and then a bug that stops it rendering reads
 * as a clean bill of health.
 */

import { useGatedThresholds } from './ScoringThresholds';
import { botTradeability } from '../core/tradeability';
import './bot-tradeability.css';

/** One chip word per state. Plain text, so it survives greyscale and a missing stylesheet. */
const STATE_WORD = {
  clear: 'ACTIONABLE',
  refused: 'NO BOT WILL TAKE IT',
  unsubscribed: 'NOTHING SUBSCRIBED',
  unknown: 'CANNOT JUDGE',
};

export default function BotTradeability({ protocolId, signalPct, className = '' }) {
  const { data, isLoading, isError } = useGatedThresholds();

  /**
   * ⚠️ A failed thresholds read must NOT render as "nothing to say" — that is the silent-empty
   * anti-pattern this repo keeps finding. Loading is stated, and an errored read says so.
   */
  if (isLoading) {
    return <p className={`btr btr--muted ${className}`.trim()}>Bots: loading bars…</p>;
  }
  if (isError || !data) {
    return (
      <p className={`btr btr--warn ${className}`.trim()}>
        Bots: could not read the bot bars (<code>GET /api/scoring/gated/thresholds</code>), so
        whether any bot can act on this signal is unknown.
      </p>
    );
  }

  const t = botTradeability(signalPct, data.bots, protocolId);

  return (
    <div className={`btr btr--${t.state} ${className}`.trim()} data-tradeability={t.state}>
      <span className="btr-head">
        <span className="btr-label">Bots</span>
        <span className={`btr-chip btr-chip--${t.state}`}>{STATE_WORD[t.state]}</span>
      </span>
      <span className="btr-reason">{t.reason}</span>
      {t.subscribed.length > 0 && (
        <span className="btr-bars">
          {t.subscribed.map((b) => (
            <span
              key={`${b.protocolId}:${b.name}`}
              className={`btr-bar ${b.clears === true ? 'btr-bar--on' : b.clears === false ? 'btr-bar--off' : ''}`}
              title={
                b.barPct == null
                  ? `${b.name}: no bar declared`
                  : `${b.name}: bar ${b.barPct}%${
                      b.clears === false ? ` — shortfall ${b.shortfall} points` : ''
                    }${b.samples != null ? ` · ${b.samples} samples` : ''}`
              }
            >
              {b.name} <strong>{b.barPct == null ? '—' : `${b.barPct}%`}</strong>
              {b.clears === true ? ' ✓' : b.clears === false ? ' ✗' : ''}
              {b.clears === false && b.shortfall != null && (
                <span className="btr-short"> (−{b.shortfall})</span>
              )}
            </span>
          ))}
        </span>
      )}
    </div>
  );
}
