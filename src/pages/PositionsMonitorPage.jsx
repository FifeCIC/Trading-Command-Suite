import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import PageInfoPopover from '../components/PageInfoPopover';
import './positions-monitor.css';

/**
 * num2() — a money/price cell, or an em dash.
 *
 * ⚠️ `pos.sl != null ? \`$${Number(pos.sl).toFixed(2)}\` : '—'` PRINTED "$NaN" ON A LIVE CARD
 * (measured 2026-11-07 on /trading/positions-monitor, FTAD). `Number(undefined)` is NaN, and
 * `NaN != null` is TRUE — so the null check passed and the formatter rendered the NaN. The broker
 * reports some fields as NaN rather than omitting them, so "present but not a number" is a real
 * state here and must render as "cannot judge", not as a number.
 */
function num2(v) {
  const n = Number(v);
  return Number.isFinite(n) ? `$${n.toFixed(2)}` : '—';
}

/**
 * RiskBar — the exposure bar on a position card.
 * ⚠️ Was three hardcoded hex literals (`#ef4444` / `#f59e0b` / `#22c55e`) chosen in JS, so the bar
 * ignored the theme. ui-standards:use the THEMED `--risk-*` scale for a severity ramp — it is the
 * app's only themed multi-step severity palette. Same thresholds (10 / 20) as the marker line the
 * CSS draws, so the colour and the line cannot disagree.
 */
function RiskBar({ pct, label }) {
  const color = pct > 20
    ? 'var(--risk-high, var(--color-loss))'
    : pct > 10
      ? 'var(--risk-elevated, var(--color-warning))'
      : 'var(--risk-normal, var(--color-profit))';
  const displayPct = Math.min(Math.max(pct || 0, 0), 100);
  return (
    <div className="pm-risk-bar" title={`${label}: portion of portfolio value at risk. ${pct > 20 ? 'Above 20% threshold — consider reducing.' : pct > 10 ? 'Moderate risk — monitor closely.' : 'Within acceptable range.'}`}>
      <motion.div className="pm-risk-fill" initial={{ width: 0 }} animate={{ width: `${displayPct}%` }} transition={{ duration: 0.5, ease: 'easeOut' }} style={{ background: color }} />
      <span className="pm-risk-label" title="Risk Exposure = |(Current − Entry) / Entry| × 100%. Represents how much this position could lose if it moved against you.">{label}: {displayPct.toFixed(1)}%</span>
      {/* 20% threshold marker */}
      <div className="pm-risk-threshold" title="20% risk threshold — positions above this line need review" />
    </div>
  );
}

function CFDPosition({ pos, index, onClose, isClosing, highlight }) {
  const cardRef = useRef(null);
  const isHighlighted = highlight != null && String(pos.ticket) === String(highlight);

  // Scroll the highlighted position into view (e.g. from a Signals card link).
  useEffect(() => {
    if (isHighlighted) {
      const t = setTimeout(() => cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300);
      return () => clearTimeout(t);
    }
  }, [isHighlighted]);

  const riskPct = pos.riskPct || (
    pos.currentPrice && pos.avgCost
      ? Math.abs(((pos.currentPrice - pos.avgCost) / pos.avgCost) * 100)
      : pos.allocation ? pos.allocation
      : 0
  );

  const isProfit = pos.pnl >= 0;

  return (
    <motion.div
      ref={cardRef}
      className={`pm-pos-card ${isHighlighted ? 'pm-pos-card--highlight' : ''} ${isProfit ? 'pm-win' : 'pm-lose'}`}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: Math.min(index * 0.04, 0.4) }}
    >
      <div className="pm-pos-header">
        <div className="pm-pos-title">
          <strong>{pos.symbol}</strong>
          <span className="pm-pos-source">{pos.source}</span>
          {/* WHICH ACCOUNT. Two accounts hold this book and the money is not the same money —
              a position with no account on it is not actionable (#1037). */}
          {pos.brokerLabel && (
            <span className="pm-pos-source" title="MT5 account this position is held on">
              {pos.brokerLabel}
              {pos.currency ? ` · ${pos.currency}` : ''}
            </span>
          )}
          {pos.fillCount > 1 && (
            <span
              className="pm-pos-source"
              title={`${pos.fillCount} fills make up this ONE broker position. It grew after it was opened, so the stop has not moved with the size.`}
            >
              {pos.fillCount} fills
            </span>
          )}
          {pos.ticket && <span className="pm-pos-ticket" title={`MT5 ticket #${pos.ticket}`}>#{pos.ticket}</span>}
        </div>
        <div className="pm-pos-pnl-group">
          <span className={`pm-pos-pnl ${isProfit ? 'pm-profit' : 'pm-loss'}`}>
            {isProfit ? '+' : ''}{pos.pnl?.toFixed(2)}
          </span>
          {pos.pnlPct != null && (
            <span className={`pm-pos-pnl-pct ${isProfit ? 'pm-profit' : 'pm-loss'}`}>
              ({isProfit ? '+' : ''}{pos.pnlPct.toFixed(1)}%)
            </span>
          )}
        </div>
      </div>

      {/* Entry → Current price line */}
      {pos.avgCost != null && pos.currentPrice != null && (
        <div className="pm-price-line">
          <span className="pm-price-entry">Entry ${Number(pos.avgCost).toFixed(2)}</span>
          <span className="pm-price-arrow">→</span>
          <span className={`pm-price-current ${isProfit ? 'pm-profit' : 'pm-loss'}`}>${Number(pos.currentPrice).toFixed(2)}</span>
        </div>
      )}

      <div className="pm-pos-details">
        <div>
          <span>Owner</span>
          {/* The loud case is the ABSENT one. A position no mechanism owns is one nothing will
              manage — the broker stop is all that stands, and that is how 0.10 lots sat unattended
              for 2h20m while 26 guardian warnings went to a log nobody reads.

              ⚠️ SHORTENED 2026-11-07. The sentence "nothing is managing this" made this tile three
              lines tall in a two-column grid, which pushed every row below it out of alignment — the
              exact complaint the restructure was for. The wording is now the tooltip; the loud part
              ("★ UNOWNED") stays visible, and the summary strip counts them. */}
          <span
            className={pos.owner ? '' : 'pm-loss'}
            title={pos.owner ? undefined : 'No strategy, guardian or bot owns this position — nothing but the broker\'s own stop is managing it.'}
          >
            {pos.owner ? pos.owner.strategyName : '★ UNOWNED'}
          </span>
        </div>
        <div>
          <span>Managed by</span>
          <span>
            {pos.owner
              ? `TCS guardian · stop via ${pos.owner.ownerVia}`
              : 'the broker\u2019s stop only'}
          </span>
        </div>
        <div><span>Direction</span><span className={pos.direction === 'BUY' ? 'pm-buy' : 'pm-sell'}>{pos.direction}</span></div>
        <div><span>Volume</span><span>{pos.volume}</span></div>
        <div><span>Leverage</span><span>{pos.leverage || '—'}</span></div>
        <div><span>Margin</span><span>{num2(pos.margin)}</span></div>
        <div><span>Days Held</span><span>{pos.daysHeld}d</span></div>
        {pos.allocation != null && (
          <div><span>Allocation</span><span>{pos.allocation.toFixed(1)}%</span></div>
        )}
        <div><span>Stop Loss</span><span>{num2(pos.sl)}</span></div>
        <div><span>Take Profit</span><span>{num2(pos.tp)}</span></div>
        {/* THE PEAK AND WHAT IT GAVE BACK (2026-11-05). A position that touched +0.35% and is now
            −0.60% is a different problem from one that never moved: the first had profit and lost
            it, the second never had any. `peakProfitPct` is the high-water mark maintained by
            position-sync (#998); `giveBackPct` comes from exit-consensus. Sampled at sync cadence,
            so the peak is a LOWER bound — the card says so rather than implying tick precision. */}
        <div>
          <span>Peak</span>
          <span title={pos.peak?.peakPrice != null
            ? `Highest recorded price ${Number(pos.peak.peakPrice).toFixed(5)} — sampled when the position syncs, so the true peak may be higher`
            : 'No peak recorded yet for this position'}>
            {pos.peak?.peakProfitPct != null
              ? `${pos.peak.peakProfitPct >= 0 ? '+' : ''}${Number(pos.peak.peakProfitPct).toFixed(2)}%`
              : '—'}
          </span>
        </div>
        <div>
          <span>Gave back</span>
          <span
            className={pos.peak?.giveBackPct >= 0.25 ? 'pm-loss' : ''}
            title="Peak profit % minus current profit %. Sampled, so this is the MINIMUM that was given back."
          >
            {pos.peak?.giveBackPct != null ? `${Number(pos.peak.giveBackPct).toFixed(2)}%` : '—'}
          </span>
        </div>
      </div>
      {/* Only when it is material. 0.25 of a percentage point on these sizes is real money, and a
          line that fires on every position is one nobody reads. */}
      {pos.peak?.giveBackPct >= 0.25 && pos.peak?.peakProfitPct > 0 && (
        <div className="pm-warning">
          ⚠ Gave back <strong>{Number(pos.peak.giveBackPct).toFixed(2)}%</strong> of price from its peak
          ({Number(pos.peak.peakProfitPct).toFixed(2)}% → {Number(pos.peak.profitPct ?? pos.pnlPct ?? 0).toFixed(2)}%).
          {pos.peak.conviction ? ` Exit consensus: ${pos.peak.conviction}.` : ''}
        </div>
      )}
      {pos.overnightFee > 0 && (
        <div className="pm-warning">⚠ Overnight fee accruing: ${pos.overnightFee.toFixed(2)}/day</div>
      )}
      {/* THE RECORD AND THE BROKER DISAGREE ABOUT THE SIZE (#1037).
          The −322.67 position was ONE broker position of 0.10 built from ten fills, while the app's
          own row said 0.01 and `pnlInvalid` said the row was usable. Neither source can see this
          alone: the broker reports a NET volume and never says how it got there, and the app's row
          is the only place the intended size is written down. */}
      {pos.divergence && (
        <div className="pm-warning">
          ⚠ Size does not reconcile: the app records <strong>{pos.divergence.recordedQuantity}</strong>{' '}
          but the broker holds <strong>{pos.divergence.netVolume}</strong> as one position
          {pos.divergence.factor ? ` (×${pos.divergence.factor})` : ''}. This row&apos;s P&amp;L and its
          recorded size are not from the same trade.
        </div>
      )}
      {/* CONTESTED — MORE THAN ONE BOT BUILT THIS POSITION (#1037).
          A netting account has ONE position per symbol, so several bots' orders merge into it and
          the broker reports only the net. It never says the position has more than one author. The
          app can: it knows which order each bot placed, and the deals say which position that order
          joined. Naming the claimants is the whole point — a position nobody owns is one nobody
          manages, and silence there is what let 0.10 lots sit untrailed for 2h20m. */}
      {pos.contested && (
        <div className="pm-warning">
          ⚠ <strong>CONTESTED — no single owner.</strong> Orders from{' '}
          <strong>{pos.claimants.length} different bots</strong> went into this one broker position:{' '}
          {pos.claimants.join(' · ')}. No one bot&apos;s rules can be said to be managing it.
        </div>
      )}
      {pos.source === 'MT5' && pos.daysHeld > 7 && (
        <div className="pm-warning">⚠ CFD held {pos.daysHeld} days — consider closing</div>
      )}
      <RiskBar pct={riskPct} label="Risk Exposure" />

      {/* Action row */}
      <div className="pm-actions">
        {pos.source === 'MT5' && (
          pos.closable ? (
            <button
              className="pm-close-btn"
              onClick={() => onClose(pos.ticket, pos.symbol)}
              disabled={isClosing}
            >
              {isClosing ? '⌛ Closing...' : '✕ Close'}
            </button>
          ) : (
            <span
              className="pm-warning"
              title="Close is not offered for this account: the close route still addresses the PRIMARY bridge only, so pressing it here would send the request to the wrong broker. Tracked in #1033."
            >
              ⚠️ Close unavailable — routing not broker-aware (#1033)
            </span>
          )
        )}
        <a className="pm-nav-link" href={`/research/symbol/${pos.symbol}`}>🔍 Details</a>
        {/* 🔗 Trail → `/automation/decision-trail` REMOVED 2026-10-01: the view was deleted at the
            owner's direction in the Page Walkthrough. The old §9.14 edition gate is gone with it —
            a deleted page needs no gate. */}
      </div>
    </motion.div>
  );
}

function OptionPosition({ pos }) {
  const daysToExpiry = pos.daysToExpiry || 30;
  const urgencyColor = daysToExpiry < 3
    ? 'var(--risk-high, var(--color-loss))'
    : daysToExpiry < 7
      ? 'var(--risk-elevated, var(--color-warning))'
      : 'var(--color-muted)';
  return (
    <div className="pm-pos-card pm-option">
      <div className="pm-pos-header">
        <strong>{pos.symbol} {pos.strike} {pos.type?.toUpperCase()}</strong>
        <span className={`pm-pos-pnl ${pos.pnl >= 0 ? 'pm-profit' : 'pm-loss'}`}>
          {pos.pnl >= 0 ? '+' : ''}{pos.pnl?.toFixed(2)}
        </span>
      </div>
      <div className="pm-pos-details">
        <div><span>Expiry</span><span style={{ color: urgencyColor }}>{pos.expiry} ({daysToExpiry}d)</span></div>
        <div><span>Strike</span><span>${pos.strike}</span></div>
        <div><span>Current</span><span>${pos.currentPrice?.toFixed(2) || '—'}</span></div>
        <div><span>Intrinsic Value</span><span>${pos.intrinsicValue?.toFixed(2) || '—'}</span></div>
        <div><span>Time Value</span><span>${pos.timeValue?.toFixed(2) || '—'}</span></div>
        <div><span>Delta</span><span>{pos.delta?.toFixed(2) || '—'}</span></div>
        <div><span>Theta</span><span>{pos.theta?.toFixed(2) || '—'}</span></div>
        <div><span>Multiplier</span><span>×{pos.multiplier || 100}</span></div>
      </div>
      {daysToExpiry < 3 && <div className="pm-warning">⚠ Expiring in {daysToExpiry} days!</div>}
      <RiskBar pct={pos.riskPct || 3} label="Risk Exposure" />
    </div>
  );
}

function SummaryBanner({ positions }) {
  const totalPnl = positions.reduce((s, p) => s + (p.pnl || 0), 0);
  const winners = positions.filter(p => p.pnl > 0).length;
  const losers = positions.filter(p => p.pnl < 0).length;
  const best = positions.reduce((a, b) => (b.pnl || 0) > (a.pnl || 0) ? b : a, positions[0]);
  const worst = positions.reduce((a, b) => (b.pnl || 0) < (a.pnl || 0) ? b : a, positions[0]);

  // ── Added stats (owner request, 2026-10-08: "there is probably more stats") ──
  // Each is DERIVED FROM WHAT IS ALREADY ON THE PAGE — no new fetch and no new field, so a reader
  // can reconcile every number against the cards below it.
  //
  // ⚠️ `decided` EXCLUDES BREAK-EVEN. A position with exactly 0 P&L is neither a win nor a loss, and
  // counting it in the denominator would report a win rate that is lower than what was won — the
  // same shape of error as the score denominator in #1090.
  const decided = winners + losers;
  const winRate = decided > 0 ? Math.round((winners / decided) * 100) : null;
  // ⚠️ THE SAME 20% THRESHOLD THE RISK BAR DRAWS (RiskBar's title and .pm-risk-threshold). Counting
  // above it is the point of drawing it; until now the line was on every card and counted nowhere.
  const aboveRiskLine = positions.filter(p => (p.riskPct || 0) > 20).length;
  const oldest = positions.reduce((a, b) => ((b.daysHeld || 0) > (a.daysHeld || 0) ? b : a), positions[0]);

  // ── Second batch of derived stats (owner request 2026-11-07: "consider some additional statistics
  //    using existing data"). Same rule as above — every figure comes from fields already on the
  //    cards, so a reader can reconcile it against the row below it. Nothing new is fetched.
  //
  //    UNMANAGED is the aggregate of the loudest per-card warning: a position with no owner is one
  //    nothing will manage, and until now that fact existed only one row at a time. It is the number
  //    most worth seeing at a glance, so it is a tile rather than a sentence.
  //    MARGIN and FEES are sums of fields the cards already show; they answer "how much of the book
  //    is committed" and "what is this costing to hold", which no single card can.
  //    AVG HOLD is a mean over `daysHeld`, rounded — a derived number, so it carries its own label
  //    rather than being dressed up as a position.
  const unmanaged = positions.filter(p => !p.owner).length;
  const marginInUse = positions.reduce((s, p) => s + (Number(p.margin) || 0), 0);
  const feesPerDay = positions.reduce((s, p) => s + (Number(p.overnightFee) || 0), 0);
  const avgHold = positions.length > 0
    ? positions.reduce((s, p) => s + (Number(p.daysHeld) || 0), 0) / positions.length
    : 0;
  const gaveBack = positions.filter(p => (p.peak?.giveBackPct || 0) >= 0.25 && (p.peak?.peakProfitPct || 0) > 0).length;

  if (positions.length === 0) return null;

  return (
    <motion.div
      className="pm-summary"
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="pm-summary-stat">
        <span className="pm-summary-label">Total P&amp;L</span>
        <span className={`pm-summary-value ${totalPnl >= 0 ? 'pm-profit' : 'pm-loss'}`}>
          {totalPnl >= 0 ? '+' : ''}{totalPnl.toFixed(2)}
        </span>
      </div>
      <div className="pm-summary-stat">
        <span className="pm-summary-label">Positions</span>
        <span className="pm-summary-value">{positions.length}</span>
      </div>
      <div className="pm-summary-stat">
        <span className="pm-summary-label">Winners</span>
        <span className="pm-summary-value pm-profit">{winners}</span>
      </div>
      <div className="pm-summary-stat">
        <span className="pm-summary-label">Losers</span>
        <span className="pm-summary-value pm-loss">{losers}</span>
      </div>
      {winRate != null && (
        <div className="pm-summary-stat">
          <span className="pm-summary-label">Win rate</span>
          <span className={`pm-summary-value ${winRate >= 50 ? 'pm-profit' : 'pm-loss'}`} title={`${winners} of ${decided} decided positions. Break-even positions are excluded.`}>
            {winRate}%
          </span>
        </div>
      )}
      <div className="pm-summary-stat">
        <span className="pm-summary-label">Above 20% risk</span>
        <span className={`pm-summary-value ${aboveRiskLine > 0 ? 'pm-loss' : 'pm-profit'}`} title="Positions past the 20% line the risk bar on each card draws.">
          {aboveRiskLine}
        </span>
      </div>
      {oldest && (
        <div className="pm-summary-stat">
          <span className="pm-summary-label">Oldest</span>
          <span className="pm-summary-value" title={`${oldest.symbol} has been held ${oldest.daysHeld} days.`}>
            {oldest.symbol} · {oldest.daysHeld}d
          </span>
        </div>
      )}
      {best && (
        <div className="pm-summary-stat">
          <span className="pm-summary-label">Best</span>
          <span className="pm-summary-value pm-profit">{best.symbol} +{best.pnl?.toFixed(2)}</span>
        </div>
      )}
      {worst && (
        <div className="pm-summary-stat">
          <span className="pm-summary-label">Worst</span>
          <span className="pm-summary-value pm-loss">{worst.symbol} {worst.pnl?.toFixed(2)}</span>
        </div>
      )}
      {/* ── second batch (2026-11-07) ── */}
      <div className="pm-summary-stat">
        <span className="pm-summary-label">Unmanaged</span>
        <span
          className={`pm-summary-value ${unmanaged > 0 ? 'pm-loss' : 'pm-profit'}`}
          title="Positions no strategy, guardian or bot owns. Nothing but the broker's own stop is managing these."
        >
          {unmanaged}
        </span>
      </div>
      <div className="pm-summary-stat">
        <span className="pm-summary-label">Margin in use</span>
        <span className="pm-summary-value" title="Sum of the Margin field on every card — how much of the book is committed right now.">
          ${marginInUse.toFixed(2)}
        </span>
      </div>
      <div className="pm-summary-stat">
        <span className="pm-summary-label">Fees / day</span>
        <span className={`pm-summary-value ${feesPerDay > 0 ? 'pm-loss' : ''}`} title="Sum of the overnight fees the cards report. What holding this book costs per day.">
          ${feesPerDay.toFixed(2)}
        </span>
      </div>
      <div className="pm-summary-stat">
        <span className="pm-summary-label">Avg hold</span>
        <span className="pm-summary-value" title="Mean daysHeld across every position, rounded to one decimal.">
          {avgHold.toFixed(1)}d
        </span>
      </div>
      {gaveBack > 0 && (
        <div className="pm-summary-stat">
          <span className="pm-summary-label">Gave back</span>
          <span className="pm-summary-value pm-loss" title="Positions that reached a peak and have since given back 0.25% or more — the per-card warning below, counted.">
            {gaveBack}
          </span>
        </div>
      )}
    </motion.div>
  );
}

const SORT_OPTIONS = [
  { key: 'pnl-desc', label: 'P&L ↓', fn: (a, b) => (b.pnl || 0) - (a.pnl || 0) },
  { key: 'pnl-asc', label: 'P&L ↑', fn: (a, b) => (a.pnl || 0) - (b.pnl || 0) },
  { key: 'risk-desc', label: 'Risk ↓', fn: (a, b) => (b.riskPct || 0) - (a.riskPct || 0) },
  { key: 'days-desc', label: 'Age ↓', fn: (a, b) => (b.daysHeld || 0) - (a.daysHeld || 0) },
  { key: 'symbol-asc', label: 'A–Z', fn: (a, b) => (a.symbol || '').localeCompare(b.symbol || '') },
];

/**
 * What a second position on an already-held symbol DOES, per account.
 *
 * The bridge reads MT5 `margin_mode` and classifies it; `unknown` is a real state and is kept as
 * one — both order gates refuse on it, so it must never fall back to a label that reads as
 * permissive. See `classify_position_model()` in scripts/mt5-bridge/mt5_bridge_v2.py.
 */
const POSITION_MODELS = {
  netting: { label: 'netting — a 2nd order MERGES into the open one' },
  hedging: { label: 'hedging — a 2nd order opens a separate position' },
  exchange: { label: 'exchange — the broker decides (MT5 margin_mode 1)' },
  unknown: { label: 'position model unknown — a 2nd order will be REFUSED' },
};

export default function PositionsMonitorPage() {
  const [tab, setTab] = useState('cfd');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [sortKey, setSortKey] = useState('pnl-desc');
  const [closingTicket, setClosingTicket] = useState(null);
  const qc = useQueryClient();

  // ?highlight=<ticket> — deep-link from a Signals card's placed order.
  const [searchParams] = useSearchParams();
  const highlightTicket = searchParams.get('highlight');

  // MT5 positions — EVERY bridge, not the primary one (#1037, closing the reading half of #1033).
  //
  // ⚠️ WHY THE ENDPOINT CHANGED. `GET /api/trading/mt5/positions` reads ONE bridge — the primary.
  // Measured 2026-09-30: `symbol_route` sends XAGUSD / US500 / US30 / UK100 / FRA40 / GER40 to
  // broker 3 (PepperstoneUK-Demo), so those positions were absent from this page entirely and the
  // page still looked complete. `/positions/managed` reads every registered bridge and stamps each
  // row with its `brokerId`, account and currency.
  //
  // ⚠️ The map below RENAMES two fields back to what the rest of this page already expects
  // (`volume` ← `netVolume`, `type` ← `side`) rather than editing every consumer. It is a seam, and
  // it is deliberate: the alternative was touching the risk bar, the close handler and the details
  // grid in the same commit as a data-source change, which is how a display fix becomes an order
  // bug. The genuinely new fields (`brokerLabel`, `fillCount`, `recorded`, `divergence`) pass
  // through untouched for the columns that use them.
  const mt5Query = useQuery({
    queryKey: ['mt5-positions'],
    queryFn: () => apiGet('/api/trading/mt5/positions/managed')
      .then(data => ({
        positions: (data?.positions || []).map((p) => ({
          ...p,
          volume: p.netVolume,
          type: String(p.side || '').toLowerCase(),
        })),
        brokers: data?.brokers || [],
        gaps: data?.gaps || [],
      }))
      .catch(() => null),
    staleTime: 15000,
    refetchInterval: 30000,
    retry: 2,
    placeholderData: (prev) => prev,
  });

  // Trading212 portfolio
  const t212Query = useQuery({
    queryKey: ['t212-portfolio-positions'],
    queryFn: () => apiGet('/api/portfolio?source=trading212').catch(() => null),
    staleTime: 30000,
    refetchInterval: 120000,
    retry: 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10000),
    placeholderData: (prev) => prev,
  });

  // WHO OWNS EACH POSITION, AND WHAT IS MANAGING IT (#1037).
  //
  // ⚠️ Joined from `StopGuardianService`, NOT re-derived here. The guardian is the ONE owner of the
  // attribution rule, and it already publishes both halves: `guardedPositions[]` carries
  // `ticket → strategyName + ownerVia` (measured: `ownerVia: 'magic'`), and `ownerAttribution`
  // gives the roll-up `{ viaMagic, viaComment, unresolved[] }`. Re-computing this from the position
  // comment would be a SECOND implementation of the rule that CAUSED the incident — `viaComment`
  // failed precisely because a comment is mutable text a later order can overwrite.
  //
  // ⚠️ A position ABSENT from `guardedPositions` is the loud case, not a blank: it means no
  // mechanism in the app is managing it, and the broker-side stop is all that stands. Silence here
  // is exactly what the −322.67 position experienced for 2h20m.
  const guardianQuery = useQuery({
    queryKey: ['stop-guardian-status'],
    // ⚠️ `/api/...` IS REQUIRED (§988) — `VITE_API_BASE_URL` is the host WITHOUT `/api`.
    queryFn: () => apiGet('/api/automation/stop-guardian/status').catch(() => null),
    refetchInterval: 30000,
  });

  const ownerByTicket = useMemo(() => {
    const m = new Map();
    const rows = guardianQuery.data?.guardedPositions;
    if (Array.isArray(rows)) {
      for (const g of rows) m.set(String(g.ticket), g);
    }
    return m;
  }, [guardianQuery.data]);

  /**
   * HOW FAR EACH POSITION HAS ALREADY RUN — the peak, and what it gave back.
   *
   * ⚠️ READ, NOT RE-DERIVED (2026-11-05). The high-water mark is maintained by `position-sync`
   * (`nextPeak` / `peakProfitPctFor`, monotonic — #998: an unknown reading never erases it) and
   * the give-back is computed in `exit-consensus.service.ts` as `peakProfitPct − profitPct`.
   * Recomputing either here from `currentPrice` would be a SECOND implementation of a rule that
   * already has one owner — and a page that disagrees with Exit Signals is worse than a page that
   * shows nothing.
   *
   * ⚠️ WHY IT BELONGS HERE. Exit Signals is the only place these numbers were visible, one click
   * away from the positions themselves. MEASURED 2026-11-05 22:20 UTC, this book: XAUUSD had
   * reached **+0.35%** and was **−0.60%** — 0.95 points given back, and the whole −£18.42. A
   * position fading off its peak is the single thing a positions view should show and did not.
   */
  const exitQuery = useQuery({
    queryKey: ['exit-consensus'],
    queryFn: () => apiGet('/api/scoring/exit-consensus').catch(() => null),
    refetchInterval: 30000,
  });

  const peakByTicket = useMemo(() => {
    const m = new Map();
    const rows = exitQuery.data?.assessments;
    if (Array.isArray(rows)) {
      for (const a of rows) m.set(String(a.ticket), a);
    }
    return m;
  }, [exitQuery.data]);

  // Close mutation
  const closeMutation = useMutation({
    mutationFn: ({ ticket }) => fetch(`/api/trading/mt5/close/${ticket}`, { method: 'DELETE' }).then(r => r.json()),
    onMutate: ({ ticket }) => setClosingTicket(ticket),
    onSettled: () => setClosingTicket(null),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mt5-positions'] });
      qc.invalidateQueries({ queryKey: ['trade-history'] });
    },
  });

  const handleClose = useCallback((ticket, symbol) => {
    if (window.confirm(`Close ${symbol} position #${ticket}?`)) {
      closeMutation.mutate({ ticket });
    }
  }, [closeMutation]);

  // Map MT5 positions — fixed camelCase field names
  const mt5Positions = useMemo(() => (mt5Query.data?.positions || []).map((p) => {
    const entryPrice = p.priceOpen;
    const curPrice = p.priceCurrent;
    const pnlAbs = p.profit || 0;
    const pnlPctVal = entryPrice && curPrice
      ? (p.type === 'sell' ? -1 : 1) * ((curPrice - entryPrice) / entryPrice) * 100
      : 0;
    const heldDays = p.openTime
      ? Math.max(1, Math.floor((Date.now() - new Date(p.openTime).getTime()) / 86400000))
      : 0;

    return {
      symbol: p.symbol,
      direction: p.type === 'buy' || p.type === 0 ? 'BUY' : 'SELL',
      volume: String(p.volume),
      leverage: '—',
      margin: entryPrice && p.volume ? (entryPrice * p.volume).toFixed(2) : '—',
      pnl: pnlAbs,
      pnlPct: pnlPctVal,
      daysHeld: heldDays,
      sl: p.sl,
      tp: p.tp,
      overnightFee: p.swap || 0,
      riskPct: entryPrice && curPrice ? Math.abs(((curPrice - entryPrice) / entryPrice) * 100) : 0,
      ticket: p.ticket,
      source: 'MT5',
      currentPrice: curPrice,
      avgCost: entryPrice,
      allocation: null,
      // ── #1037 passthroughs ──
      // ⚠️ THIS OBJECT IS AN EXPLICIT LITERAL, so any field not named here is DROPPED. The card
      // below reads `brokerLabel` / `fillCount` / `divergence` / `owner`, and the first version of
      // that card read them off a row that never carried them — the fields rendered as nothing and
      // looked like a clean position. Name every field the render depends on.
      brokerId: p.brokerId,
      brokerLabel: p.brokerLabel,
      currency: p.currency,
      fillCount: p.fillCount,
      divergence: p.divergence,
      claimants: p.claimants || [],
      contested: Boolean(p.contested),
      comment: p.comment,
      owner: ownerByTicket.get(String(p.ticket)) ?? null,
      // Peak / give-back, joined from `/api/scoring/exit-consensus`. Null when that read failed OR
      // when the position has no peak yet — the card distinguishes the two rather than showing 0%.
      peak: peakByTicket.get(String(p.ticket)) ?? null,
      // ⚠️ CLOSE ROUTING IS NOT BROKER-AWARE YET (#1033). `DELETE /close/:ticket` sends to the
      // PRIMARY bridge only, so a Close pressed on a broker-3 row would be AIMED AT THE WRONG
      // ACCOUNT. Showing this page's other rows is safe — they are read-only — but a visible
      // action that hits the wrong broker is a money bug.
      //
      // ⚠️ FAIL CLOSED. If `brokers` is missing, `closable` is false for EVERY row and the buttons
      // disappear. That is deliberate: an unproven routing must refuse, never guess. A Close that
      // silently does nothing is a nuisance; a Close that reaches the wrong account is a loss.
      closable: p.brokerId === mt5Query.data?.brokers?.[0]?.brokerId,
    };
  }), [mt5Query.data, ownerByTicket, peakByTicket]);

  // Map Trading212 positions (long-only Invest accounts — direction is always BUY)
  const t212Positions = useMemo(() => (t212Query.data?.positions || []).map((p) => ({
    symbol: p.symbol || p.ticker,
    direction: p.direction || p.side || 'BUY',  // T212 Invest is long-only; check for direction field if available
    volume: String(p.shares || p.quantity || '—'),
    leverage: '—',
    margin: p.avgCost && (p.shares || p.quantity) ? (p.avgCost * (p.shares || p.quantity)).toFixed(2) : '—',
    pnl: p.pnl || 0,
    pnlPct: p.pnlPct != null ? p.pnlPct : 0,
    daysHeld: p.initialFillDate ? Math.max(1, Math.floor((Date.now() - new Date(p.initialFillDate).getTime()) / 86400000)) : 0,
    sl: '—',
    tp: '—',
    overnightFee: 0,
    riskPct: Math.abs(p.pnlPct || 0),
    allocation: p.allocation ? p.allocation * 100 : null,
    ticket: p.symbol || p.ticker,
    source: t212Query.data?.mode === 'demo' ? 'T212 Practice' : 'Trading212',
    currentPrice: p.currentPrice,
    avgCost: p.avgCost,
  })), [t212Query.data]);

  const allPositions = useMemo(() => [...mt5Positions, ...t212Positions], [mt5Positions, t212Positions]);

  const sortFn = SORT_OPTIONS.find(s => s.key === sortKey)?.fn || SORT_OPTIONS[0].fn;

  const filteredPositions = useMemo(() => {
    let list = sourceFilter === 'all'
      ? allPositions
      : allPositions.filter((p) => p.source.toLowerCase().includes(sourceFilter.toLowerCase()));
    return [...list].sort(sortFn);
  }, [allPositions, sourceFilter, sortFn]);

  const lastUpdated = mt5Query.dataUpdatedAt || t212Query.dataUpdatedAt
    ? new Date(Math.max(mt5Query.dataUpdatedAt || 0, t212Query.dataUpdatedAt || 0)).toLocaleTimeString()
    : null;

  return (
    <div className="pm-page" aria-live="polite" aria-atomic="true">
      <header className="pm-header">
        <h1>
          Positions Monitor
          <PageInfoPopover label="About Positions Monitor">
            <p>Combined view of all open positions across brokers.</p>
            {/* ⚠️ NETTING vs HEDGING IS THE ANSWER TO A QUESTION THIS PAGE KEEPS PROVOKING.
                On a netting account a second order on a symbol the bot already holds MERGES into the
                existing position (size averaged, entry price rewritten) — so "two buys" appear as ONE
                row with a bigger volume. On a hedging account the broker opens a genuine second ticket.
                Without this line the only visible difference is a position count that does not go up,
                which reads exactly like a lost order.
                ⚠️ It moved from a `<p>` under the title into this popover on 2026-11-07 (owner:
                *"move <p.pm-account-models> to an information popout using the i icon as used on
                other pages"*) and is rendered only when a broker reported — a failed fan-out must
                not invent models. */}
            {mt5Query.data?.brokers?.length > 0 && (
              <p className="pm-account-models">
                {mt5Query.data.brokers.map((b) => {
                  const model = POSITION_MODELS[b.positionModel] || POSITION_MODELS.unknown;
                  return `${b.label || `broker ${b.brokerId}`} — ${model.label}`;
                }).join('  ·  ')}
              </p>
            )}
          </PageInfoPopover>
        </h1>
      </header>

      {/* Portfolio Summary Banner */}
      <SummaryBanner positions={allPositions} />

      {/* ⚠️ `gaps` WAS FETCHED AND NEVER RENDERED (fixed 2026-10-08). Every bridge fan-out returns a
          `gaps` array alongside the positions; this page stored it in the query result and drew
          nothing with it. That is the "plausible output, no error" shape this repo keeps
          re-finding — the page looks complete while a broker that did not answer is silently
          missing, so its positions read as ABSENT rather than UNKNOWN.

          Rendered only when non-empty, so a healthy fan-out adds no noise; the wording says
          "may be missing" rather than "is missing", because a gap proves the broker did not answer,
          not what it held. */}
      {Array.isArray(mt5Query.data?.gaps) && mt5Query.data.gaps.length > 0 && (
        <div className="pm-warning" role="status">
          ⚠ {mt5Query.data.gaps.length} gap{mt5Query.data.gaps.length === 1 ? '' : 's'} in the broker
          fan-out — the positions below may be INCOMPLETE:{' '}
          {mt5Query.data.gaps
            .map((g) => g?.brokerLabel || g?.brokerId || g?.reason || g?.message || JSON.stringify(g))
            .join(', ')}
        </div>
      )}

      {/* T212 rate-limit / fetch warning */}
      {t212Query.data === null && !t212Query.isLoading && (
        <div className="pm-warning-banner">
          ⚠️ Trading212 data unavailable — API may be rate-limited. Showing cached MT5 data.
        </div>
      )}

      <div className="pm-tabs">
        <button className={`pm-tab ${tab === 'cfd' ? 'pm-active' : ''}`} onClick={() => setTab('cfd')}>Positions</button>
        <button className={`pm-tab ${tab === 'options' ? 'pm-active' : ''}`} onClick={() => setTab('options')}>Options</button>

        {/* Sort controls */}
        <div className="pm-sort-controls">
          <span>Sort:</span>
          {SORT_OPTIONS.map((s) => (
            <button
              key={s.key}
              className={`pm-source-chip ${sortKey === s.key ? 'pm-active' : ''}`}
              onClick={() => setSortKey(s.key)}
            >{s.label}</button>
          ))}
        </div>

        {/* Data freshness */}
        {lastUpdated && (
          <span className="pm-freshness" title={`MT5: ${mt5Query.isFetching ? 'refreshing' : 'stale'} · T212: ${t212Query.isFetching ? 'refreshing' : 'stale'}`}>
            Updated {lastUpdated}
          </span>
        )}

        <div className="pm-source-filter">
          <span>Source:</span>
          {['all', 'MT5', 'Trading212', 'T212 Demo'].map((s) => (
            <button key={s} className={`pm-source-chip ${sourceFilter === s ? 'pm-active' : ''}`} onClick={() => setSourceFilter(s)}>{s}</button>
          ))}
        </div>
      </div>

      {tab === 'cfd' && (
        <div className="pm-positions">
          {(mt5Query.isLoading || t212Query.isLoading) && <div className="pm-empty">Loading positions...</div>}
          {filteredPositions.length === 0 && !mt5Query.isLoading && !t212Query.isLoading && <div className="pm-empty">No open positions. Connect MT5 or Trading212 to see your holdings.</div>}
          {filteredPositions.map((p, i) => (
            <CFDPosition
              key={p.ticket || i}
              pos={p}
              index={i}
              onClose={handleClose}
              isClosing={closingTicket === p.ticket}
              highlight={highlightTicket}
            />
          ))}
        </div>
      )}

      {tab === 'options' && (
        <div className="pm-positions">
          <div className="pm-empty">
            <p>Options monitoring not yet available.</p>
            <p className="pm-empty-sub">Connect an options-capable broker (e.g., Interactive Brokers) to enable this tab.</p>
          </div>
        </div>
      )}
    </div>
  );
}
