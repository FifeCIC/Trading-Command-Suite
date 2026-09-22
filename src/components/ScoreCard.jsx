/**
 * ScoreCard — the ONE score-card presentation, shared by the Ladder and the META.Stack Cockpit.
 * =============================================================================================
 * Extracted from `LadderPage.jsx` (2026-09-17) so the cockpit's Scores column re-displays the
 * same card instead of growing a near-copy. The rendering is UNCHANGED — this is a move, not a
 * redesign, so the Ladder looks and behaves exactly as before.
 *
 * WHY ONE CARD AND NOT TWO
 * `shared-core.instructions.md`: a second implementation is the most expensive kind of technical
 * debt — both copies drift and only one gets the next fix. Everything here was already
 * load-bearing on the Ladder (the always-present Opp slot, the state chip, the copy-ref button),
 * and each of those was paid for by a specific past bug. Re-deriving them in the cockpit would
 * have re-opened all of them.
 *
 * WHAT THE CALLER OWNS (deliberately NOT in here)
 *   - the card SET and order (search / filter / sort) — that is page logic
 *   - the score lookup (`scoreMap` / `familyMap`) — via `useProtocolData()`
 *   - the copy action and its feedback state
 *   - the scroll-reveal observer: call `useScrollReveal(ref, [list])` on the container, or the
 *     cards stay at `opacity: 0` and render INVISIBLE. See `src/hooks/useScrollReveal.js`.
 *
 * ⚠️ CSS lives in `ladder.css` under the `lad-` prefix (file-unique, verified against
 * `src/**\/*.css`), and this component IMPORTS it so it renders styled on any page.
 * Do NOT reintroduce a `ts-` prefix here; that was a real cross-page collision fixed 2026-09-17.
 *
 * ⚠️ `.lad-card` is a CSS CONTAINER (`container: lad-card / inline-size`) and
 * `@container lad-card (max-width: 420px)` reflows the footer. In a narrow cockpit column that
 * query WILL fire, which is intended — the card adapts rather than overflowing.
 */
import { forwardRef } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import SignalBadge from './SignalBadge';
// ⚠️ The component OWNS its stylesheet. Do not remove this as a "page concern".
// All page CSS is bundled globally, but in DEV Vite injects CSS only when a module is
// imported — so a page that mounts ScoreCard without having imported ladder.css itself
// renders completely unstyled (the `lad-` classes exist but no rules match). Importing
// here makes the card portable to any page; Vite dedupes the duplicate import.
import '../pages/ladder.css';
import { timeAgo } from '../core/format-utils';
import { stateClass, stateLabel, stateTitle, fmtVal, fmtSigned } from '../core/score-card-view';

/**
 * One labeled score block — used for BOTH the Signal and Opportunity scores so
 * they render identically. Value format follows the Screen Options preference
 * (raw | percent | both). `active` highlights the metric the list is ranked by.
 */
export function ScoreBlock({ label, score, max, pct, mode, active }) {
  const raw = score != null
    ? `${score.toLocaleString()}${max ? ` / ${max.toLocaleString()}` : ''}`
    : null;
  const pctNode = pct != null ? `${pct}%` : null;
  const value = mode === 'raw'
    ? raw
    : mode === 'percent'
      ? pctNode
      : null;
  return (
    <span className={`lad-score-block ${active ? 'lad-score-block--active' : ''}`}>
      <span className="lad-score-label">{label}</span>
      {value != null ? (
        <span className="lad-score-value">{value ?? '—'}</span>
      ) : (
        <span className="lad-score-value">
          <span>{raw ?? '—'}</span>
          {pctNode && <span className="lad-score-pct">{pctNode}</span>}
        </span>
      )}
    </span>
  );
}

/**
 * LadderFacts({ meta, pos, asBlock }) — company / open-position facts.
 *
 * `asBlock` renders it as a footer column matching ScoreBlock's label-above-value
 * rhythm (label "Details", values beneath) instead of an inline strip. It is
 * ALWAYS ON now — the "Details" toolbar toggle was removed — so this no longer
 * depends on `showFacts`. Returns null when there is nothing to show, which stops
 * an unscored card rendering an empty third column.
 */
export function LadderFacts({ meta, pos, asBlock = false }) {
  const co = meta && meta.name && String(meta.name).trim().toUpperCase() !== String(meta.ticker || '').toUpperCase()
    ? meta.name
    : null;
  const pnl = pos && typeof pos.pnl === 'number' ? pos.pnl : null;
  const pnlPct = pos && typeof pos.pnlPct === 'number' ? pos.pnlPct : null;
  if (!co && !pos) return null;

  const body = (
    <>
      {co && (
        <span className="lad-fact" title={[meta.exchange, meta.type].filter(Boolean).join(' · ') || 'Company'}>
          {co}
        </span>
      )}
      {pos && (
        <span
          className={`lad-fact lad-fact--pos${pnl != null ? (pnl >= 0 ? ' lad-pnl-up' : ' lad-pnl-down') : ''}`}
          title={`Open position${pos.provider ? ` · ${pos.provider}` : ''}`}
        >
          ● {fmtVal(pos.quantity, 2)} @ {fmtVal(pos.avgPrice)} → {fmtVal(pos.currentPrice)}
          {pnl != null && (
            <span className="lad-fact-pnl"> · P&L {fmtSigned(pnl)} ({fmtSigned(pnlPct)}%)</span>
          )}
        </span>
      )}
    </>
  );

  if (asBlock) {
    return (
      <span className="lad-score-block lad-score-block--facts">
        <span className="lad-score-label">Details</span>
        <span className="lad-score-value lad-facts-values">{body}</span>
      </span>
    );
  }

  return <div className="lad-facts">{body}</div>;
}

/**
 * ⚠️ MUST be a forwardRef component.
 * `AnimatePresence mode="popLayout"` (used by the Ladder's card stack) wraps each
 * child in a `PopChild` that passes a REF for layout measurement. A plain function
 * component silently drops it and React logs "Function components cannot be given
 * refs" — the cards still render, so the defect is nearly invisible. The ref must
 * reach the root `motion.div` (which is what motion measures), exactly as the
 * previous inline motion.div did. Measured 2026-09-17 during extraction.
 */
const ScoreCard = forwardRef(function ScoreCard({
  entry: e,
  rank = 0,
  dimmed = false,
  scoreDisplay = 'both',
  rankBy = 'signal',
  meta = null,
  pos = null,
  onCopyRef,
  copied = null,
  // ⚠️ Set `showTop={false}` when several lists each start at rank 0 (e.g. one per
  // cockpit column). Otherwise EVERY column's first card is marked `lad-card--top`
  // and the "top" highlight stops meaning "the best opportunity".
  showTop = true,
}, ref) {
  return (
    <motion.div
      ref={ref}
      layout
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.45, ease: 'easeOut' }}
      className={`lad-card ${showTop && rank === 0 && !dimmed ? 'lad-card--top' : ''} ${dimmed ? 'lad-card--filtered' : ''} ${e.vm.state !== 'unscored' && e.vm.frozen ? 'lad-card--closed' : ''}`}
    >
      <div className="lad-reveal">
      <div className="lad-card-head">
        <span className="lad-rank">#{rank + 1}</span>
        <Link
          className="lad-symbol"
          to={`/research/symbol/${encodeURIComponent(e.symbol)}`}
          title={`Open ${e.symbol}`}
        >
          {e.symbol}
        </Link>
        <span className="lad-proto-tag">{e.protocolName}</span>
        {/* Adaptive Target badge (2026-09-10) — this protocol's percentage is measured
            against its own observed peak, NOT its configured capacity. Shown on the card
            itself (not just the registry) because the whole risk of this feature is a
            reader comparing two percentages that sit on different scales without knowing.
            Deliberately a word, not just a colour, so it survives colour-blind rendering. */}
        {e.adaptiveTargetActive && (
          <span
            className="lad-target-badge"
            title={
              `Adaptive Target — measured against this protocol's observed peak` +
              `${e.adaptiveTargetMax != null ? ` (${Math.round(e.adaptiveTargetMax)})` : ''}, ` +
              `not its configured capacity. The peak only ever rises.`
            }
          >
            target
          </span>
        )}
        <span className="lad-card-status">
          <SignalBadge display={e.vm} />
          {/* ONE state chip on every card — never a different element or a
              missing chip. Values: Live / Market closed / Stale / Not scored.
              Unscored rows must NOT claim "Live" (that reads as a live tradable
              signal next to a blank score), so they get their own value here
              rather than swapping the markup out. */}
          <span className={`lad-state ${stateClass(e.vm)}`} title={stateTitle(e.vm)}>
            {stateLabel(e.vm)}
          </span>
        </span>
      </div>
      <div className="lad-card-foot">
        <div className="lad-card-scores">
          <ScoreBlock
            label="Signal"
            score={e.vm.score}
            max={e.vm.scoreMax}
            pct={e.vm.pct}
            mode={scoreDisplay}
            active={rankBy === 'signal'}
          />
          {/* Both score slots always render. Previously "Opp" was omitted when
              null, so an unscored card was visibly SHORTER than a scored one and
              the whole row shifted. An empty slot is the honest and consistent
              presentation: the protocol genuinely has no Opportunity score. */}
          <ScoreBlock
            label="Opp"
            score={e.vm.opportunityScore}
            max={e.vm.opportunityMax}
            pct={e.vm.opportunityPct}
            mode={scoreDisplay}
            active={rankBy === 'opp'}
          />
          {/* Details (company + open position) lives in the footer as a third
              labelled column so all three read with the same label-above-value
              rhythm. Always on; renders nothing when there is no data, so an
              unscored card simply has two columns rather than an empty third. */}
          <LadderFacts asBlock meta={meta} pos={pos} />
          {/* Footer meta — the SAME slots in the SAME order on every card, so a
              card missing something is visibly missing it rather than just looking
              shorter. Rendered as a score-block so "Scored" sits above its value
              like "Signal" and "Opp" do. The run id is nested INSIDE the value so
              the column stays narrow and the label never wraps to two lines. */}
          <span className="lad-score-block lad-score-block--time">
            <span className="lad-score-label">Scored</span>
            <span className="lad-score-value lad-time-value">
              {e.time ? (
                <>
                  <span>{timeAgo(e.time)}</span>
                  <span
                    className="lad-time-src"
                    title={`Scoring run: ${e.runId || e.protocolId}`}
                  >
                    {e.runId || e.protocolId}
                  </span>
                  {e.scoreFrom && (
                    <span
                      className="lad-time-borrow"
                      title={`${e.protocolId} produced no run — showing ${e.scoreFrom} instead`}
                    >
                      borrowed
                    </span>
                  )}
                </>
              ) : (
                <span className="lad-time-none">No scoring run yet</span>
              )}
            </span>
          </span>
          {/* Copy the card's identifiers — above all the persisted score ID — so an
              investigation starts from real values instead of transcribed ones. Last in
              the grid so it can never push a metric out of its column. Always rendered
              (even unscored) because "no score ID" is itself an answer worth pasting. */}
          <button
            type="button"
            className="lad-copy-ref"
            onClick={() => onCopyRef && onCopyRef(e)}
            title={
              e.scoreId
                ? `Copy this card's reference — includes score ID ${e.scoreId}`
                : 'Copy this card\'s reference — no score ID (this card has produced no scoring run)'
            }
            aria-label={`Copy reference for ${e.symbol} on ${e.protocolName}`}
          >
            {copied === null ? '⧉ copy' : copied ? '✓ copied' : '✗ blocked'}
          </button>
        </div>
      </div>
      </div>
    </motion.div>
  );
});

export default ScoreCard;
