/**
 * Trading212 Portfolio Page
 * ==========================
 * Unified multi-account portfolio overview — Trading212 (Live, Demo, Stocks ISA,
 * CFD), MT5 bridge accounts, and Capital.com, grouped into Live / Demo categories.
 *
 * Account selection and totals are owned by the API:
 *   GET  /api/portfolio/accounts          → categories + accounts + totals
 *   POST /api/portfolio/accounts/:id      → toggle an account or category
 */

import { Fragment, useState, useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiDelete } from '../core/api/client';
import { feedUnavailable } from '../core/api/feed-state.js';
import LastUpdated from '../components/LastUpdated';
import PageInfoPopover from '../components/PageInfoPopover';
import NoticeBlock from '../components/NoticeBlock';
import { noticeFromError } from '../core/notices/from-error.js';
import { notice } from '../core/notices/registry.js';
import './t212-portfolio.css';

const fmt = (n) => (n == null ? '—' : `£${Number(n).toFixed(2)}`);
/** A NUMBER WITHOUT A CURRENCY — for prices and notionals, whose currency is the instrument's own. */
const num2 = (n) => (n == null || !Number.isFinite(Number(n)) ? '—' : Number(n).toFixed(2));

const fmtPct = (v) => (v == null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`);

/** "3d 4h" / "42m" — how long the position has been open, from its own open timestamp. */
function holdingFor(openedAt) {
  if (!openedAt) return '—';
  const t = new Date(openedAt).getTime();
  if (Number.isNaN(t)) return '—';
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 60) return `${mins}m`;
  if (mins < 60 * 24) return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  return `${Math.floor(mins / 1440)}d ${Math.floor((mins % 1440) / 60)}h`;
}

/** Distance from the current price to a stop or target, in price units and as a percentage. */
const distanceTo = (from, to) => {
  if (from == null || to == null || !from) return '—';
  const d = to - from;
  return `${d > 0 ? '+' : ''}${d.toFixed(5)} (${((d / from) * 100).toFixed(2)}%)`;
};

/**
 * movePct — direction-adjusted PRICE move, as a percentage.
 *
 * ⚠️ THIS REPLACED A WRONG P&L PERCENTAGE, measured 2026-11-06. The first version divided the profit
 * by `entry × volume`, which is only a notional for a source whose quantity is a SHARE COUNT. For an
 * MT5 position `volume` is LOTS, and the money value of a lot depends on the contract size (100 for
 * metals, 100,000 for FX) — so a €16 gain on 0.02 lots of EURUSD rendered as **+72727%**. The number
 * was not merely imprecise, it was meaningless.
 *
 * A price move needs no contract size and is identical for every instrument, so it is the one
 * percentage that can be shown for ALL sources — and it is what a trader reads anyway ("it moved
 * 0.8% in my favour"). For a share-count source it agrees with the P&L percentage by construction.
 */
const movePct = (side, entry, current) => {
  if (entry == null || current == null || !entry) return null;
  const raw = ((current - entry) / entry) * 100;
  return side === 'sell' ? -raw : raw;
};

/**
 * PositionDetail — the expanded row behind a hovered (or focused) position.
 * ==========================================================================
 * Rendered INSIDE the table as a `<tr><td colSpan>` so every fact sits under the columns it belongs
 * to. The previous affordance was the symbol link's native `title`, which repeated the ticker and
 * floated wherever the pointer was — the owner's "same information, not even inline with columns".
 *
 * ⚠️ NOTHING IS INVENTED. Every field shown comes from the position payload; where a source does not
 * report something (a Trading212 holding has no stop and no broker, by measurement) the row says so
 * instead of showing a placeholder that reads like a value.
 *
 * ⚠️ THE CONTROLS ARE MT5-ONLY, and the panel explains why rather than silently omitting them. A
 * Trading212 holding is an imported copy — this app cannot trade it — so a disabled Close button on
 * that row would imply a capability that does not exist.
 */
function PositionDetail({ p, busy, error, armed, onArm, onClose, onBreakeven, onSetStops }) {
  const [slDraft, setSlDraft] = useState(p.sl != null ? String(p.sl) : '');
  const [tpDraft, setTpDraft] = useState(p.tp != null ? String(p.tp) : '');

  const numberOrNull = (raw) => {
    const s = String(raw).trim();
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };
  const slNum = numberOrNull(slDraft);
  const tpNum = numberOrNull(tpDraft);
  const stopsDirty = slNum !== (p.sl ?? null) || tpNum !== (p.tp ?? null);
  const stopsValid = slDraft === '' || slNum !== null ? (tpDraft === '' || tpNum !== null) : false;

  const breakevenUseful = p.entry != null && p.sl !== p.entry;

  return (
    <div className="t212p-detail">
      <dl className="t212p-detail-grid">
        <div>
          <dt>Entry</dt>
          <dd>{p.entry != null ? p.entry.toFixed(5) : '—'}</dd>
        </div>
        <div>
          <dt>Current</dt>
          <dd>{p.currentPrice != null ? Number(p.currentPrice).toFixed(5) : '—'}</dd>
        </div>
        <div>
          <dt>P&amp;L</dt>
          <dd className={p.pnl > 0 ? 't212p-profit' : p.pnl < 0 ? 't212p-loss' : ''}>
            {p.pnl != null ? fmt(p.pnl) : '—'} · {fmtPct(p.movePct)} price move
          </dd>
        </div>
        <div>
          <dt>Held</dt>
          <dd>{holdingFor(p.openedAt)}</dd>
        </div>

        <div>
          <dt>Stop-loss</dt>
          <dd>
            {p.sl != null
              ? `${p.sl} · ${distanceTo(p.currentPrice, p.sl)} away`
              : p.source === 'mt5' ? 'none set' : 'not applicable — imported holding'}
          </dd>
        </div>
        <div>
          <dt>Take-profit</dt>
          <dd>
            {p.tp != null
              ? `${p.tp} · ${distanceTo(p.currentPrice, p.tp)} away`
              : p.source === 'mt5' ? 'none set' : 'not applicable — imported holding'}
          </dd>
        </div>
        <div>
          <dt>Profit protected</dt>
          <dd>
            {p.lockedIn === true && <span className="t212p-ok">yes — stop is beyond entry</span>}
            {p.lockedIn === false && (
              <span className="t212p-warn">
                no — stop is still on the losing side{p.pnl > 0 ? ', so this profit is unprotected' : ''}
              </span>
            )}
            {p.lockedIn === null && <span className="t212p-muted">cannot judge — no stop-loss on the position</span>}
          </dd>
        </div>
        <div>
          <dt>Best seen</dt>
          <dd>
            {p.peakProfitPct != null
              ? `${fmtPct(p.peakProfitPct)}${p.movePct != null ? ` · now ${fmtPct(p.movePct)}` : ''}`
              : <span className="t212p-muted">not recorded for this source</span>}
          </dd>
        </div>

        <div>
          <dt>Account</dt>
          <dd>
            {p.account}
            {p.isDemo !== null && ` · ${p.isDemo ? 'demo/paper' : 'LIVE'}`}
          </dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>
            {p.source === 'mt5'
              ? `MT5 broker ${p.brokerId ?? '—'}${p.ticket ? ` · ticket ${p.ticket}` : ''}`
              : p.source === 'isa' ? 'Trading212 Stocks ISA import' : 'Trading212 import'}
          </dd>
        </div>
        <div>
          <dt>Side / size</dt>
          <dd>
            {(p.side || '—').toUpperCase()} · {p.quantity != null ? Number(p.quantity).toFixed(2) : '—'}
            {p.source === 'mt5' && p.contractSize ? ` lots (×${p.contractSize})` : ''}
          </dd>
        </div>
        {p.source === 'mt5' && (
          <div>
            <dt>Notional</dt>
            <dd>
              {p.value != null
                ? `${num2(p.value)}${p.valueCurrency ? ` ${p.valueCurrency}` : ''}`
                : '— no contract size in the payload'}
              <span className="t212p-detail-hint"> — size × contract × price, in the instrument&apos;s own currency</span>
            </dd>
          </div>
        )}
        <div>
          <dt>{p.source === 'mt5' ? 'Swap / origin' : 'Value'}</dt>
          <dd>
            {p.source === 'mt5'
              ? `${p.swap != null ? p.swap.toFixed(2) : '—'}${p.comment ? ` · ${p.comment}` : ''}`
              : fmt(p.value)}
          </dd>
        </div>
      </dl>

      {error && (
        // ⚠️ NoticeBlock, NOT `error.title` + `error.message` (#826 Phase 5). `error` here is already a
        // rendered notice from `noticeFromError(err, 'TCS-SYS-007', …)` — printing its wording by hand
        // threw away the CODE, which is the only stable identity the message has. `validate-notices`
        // flagged exactly this line as an undeclared raw `.message` render.
        <div className="t212p-detail-error">
          <NoticeBlock notice={error} compact />
        </div>
      )}

      {p.tradeable ? (
        <div className="t212p-controls" role="group" aria-label={`Trade controls for ${p.ticker}`}>
          <button
            type="button"
            className={`t212p-action ${armed ? 't212p-action--armed' : 't212p-action--danger'}`}
            disabled={busy}
            onClick={() => (armed ? onClose() : onArm())}
            title="Close this position on the broker. Click once to arm, again to confirm."
          >
            {busy ? 'Working…' : armed ? 'Confirm close' : 'Close position'}
          </button>

          <button
            type="button"
            className="t212p-action"
            disabled={busy || !breakevenUseful}
            onClick={onBreakeven}
            title={
              breakevenUseful
                ? `Move the stop to the entry price (${p.entry}) so the position cannot turn into a loss`
                : 'The stop is already at the entry price'
            }
          >
            Stop to breakeven
          </button>

          <span className="t212p-stopform">
            <label>
              SL
              <input
                type="number"
                inputMode="decimal"
                step="any"
                value={slDraft}
                onChange={(e) => setSlDraft(e.target.value)}
                aria-label={`Stop-loss for ${p.ticker}`}
                placeholder="none"
              />
            </label>
            <label>
              TP
              <input
                type="number"
                inputMode="decimal"
                step="any"
                value={tpDraft}
                onChange={(e) => setTpDraft(e.target.value)}
                aria-label={`Take-profit for ${p.ticker}`}
                placeholder="none"
              />
            </label>
            <button
              type="button"
              className="t212p-action"
              disabled={busy || !stopsDirty || !stopsValid}
              onClick={() => onSetStops(slNum, tpNum)}
              title={stopsValid ? 'Send these stop-loss / take-profit levels to the broker' : 'Both levels must be numbers, or left empty'}
            >
              Apply SL/TP
            </button>
          </span>
        </div>
      ) : (
        <p className="t212p-detail-note">
          Imported holding — this app has no route to trade it, so it carries no controls. Close or
          amend it at the broker.
        </p>
      )}
    </div>
  );
}

export default function T212PortfolioPage() {
  const qc = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [imported, setImported] = useState(false);

  // Trade controls: one action in flight at a time, one armed confirmation at a time.
  // ⚠️ Declared BEFORE the hover state because `scheduleClose` disarms on close (see below).
  const [busyKey, setBusyKey] = useState(null);
  const [armedKey, setArmedKey] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [closeAll, setCloseAll] = useState({ armed: false, busy: false, notice: null });

  /**
   * Hover/focus detail state.
   *
   * ⚠️ The close is DELAYED (200ms) and cancelled when the pointer enters the detail row. Without the
   * delay, moving from the row down to a control leaves the row and unmounts the panel the pointer was
   * travelling into — the panel would be unreachable with a mouse.
   */
  const [hoveredKey, setHoveredKey] = useState(null);
  const closeTimer = useRef(null);
  const openPanel = (key) => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setHoveredKey(key);
  };
  const scheduleClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {
      setHoveredKey(null);
      /**
       * ⚠️ DISARM ON CLOSE (measured 2026-11-06). `armedKey` outlived the panel it belongs to: arm
       * "Close position", let the panel close, come back — and the button still read "Confirm close",
       * so the FIRST click closed a position. An armed destructive control must not survive losing
       * the surface that shows it.
       */
      setArmedKey(null);
    }, 200);
  };
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);

  // ── Unified account overview (API-owned toggles + totals) ──
  const overview = useQuery({
    queryKey: ['portfolio-accounts'],
    queryFn: () => apiGet('/api/portfolio/accounts').catch(() => ({ categories: [], grandTotal: null })),
    refetchInterval: 60_000,
  });
  const categories = overview.data?.categories || [];
  const grandTotal = overview.data?.grandTotal ?? null;
  const allAccounts = categories.flatMap((c) => c.accounts);

  const demoInvest = allAccounts.find((a) => a.id === 't212:demo');
  const liveInvest = allAccounts.find((a) => a.id === 't212:live');
  const isaAcct = allAccounts.find((a) => a.id === 't212:isa');

  const investActive = demoInvest?.enabled && demoInvest?.connected
    ? 'demo'
    : liveInvest?.enabled && liveInvest?.connected ? 'live' : null;
  const isaActive = isaAcct?.enabled && isaAcct?.connected;

  // ── Investment account detail (positions/summary/history) ──
  const account = useQuery({
    queryKey: ['t212-account'],
    queryFn: () => apiGet('/api/portfolio/trading212/validate'),
    refetchInterval: 60_000,
    retry: 1,
  });

  const history = useQuery({
    queryKey: ['t212-history'],
    // ⚠️ NO `.catch(() => [])` (#782 / INV-NO-EMPTY-SWALLOW). The empty state below reads "No trade
    // history available." — a statement about the account's history, printed for a failed read too.
    queryFn: () => apiGet('/api/portfolio/trading212/history?limit=20'),
    refetchInterval: 120_000,
    retry: 1,
  });

  // ── Stocks ISA detail ──
  const isa = useQuery({
    queryKey: ['t212-isa'],
    queryFn: () => apiGet('/api/isa/dashboard').catch(() => null),
    refetchInterval: 60_000,
    retry: 1,
    enabled: isaActive,
  });

  async function doImport() {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await apiPost('/api/portfolio/trading212/import');
      setSyncResult(res);
      if (res.success) setImported(true);
      qc.invalidateQueries({ queryKey: ['t212-account'] });
      qc.invalidateQueries({ queryKey: ['t212-history'] });
      qc.invalidateQueries({ queryKey: ['portfolio-accounts'] });
    } catch (e) {
      setSyncResult({ error: noticeFromError(e, 'TCS-SYS-007', { operation: 'sync the T212 portfolio' }) });
    }
    setSyncing(false);
  }

  // Auto-import on page visit (backend enforces 60s cooldown)
  useEffect(() => {
    if (!imported) doImport();
  }, []);

  // Account toggles live in Screen Options — refresh when they change there.
  useEffect(() => {
    const refresh = () => {
      qc.invalidateQueries({ queryKey: ['portfolio-accounts'] });
      qc.invalidateQueries({ queryKey: ['t212-isa'] });
    };
    window.addEventListener('tcs:accounts-changed', refresh);
    return () => window.removeEventListener('tcs:accounts-changed', refresh);
  }, [qc]);

  const summary = account.data?.account;
  const positions = account.data?.positions || [];

  /**
   * valueCost — the ONE money figure this page derives, so the tiles reconcile.
   *
   * `summary.total` (Σ quantity × currentPrice) and `summary.invested` (Σ quantity × avgPrice) arrive
   * from the broker on the same request (measured 2026-11-06: 8,675.38 and 11,835.92, matching the
   * positions to the penny), so subtracting them is exactly what the two tiles beside it state.
   * ⚠️ It is NOT `summary.ppl` — the broker's own P&L is −1,309.27 here while value − cost is
   * −3,160.54, so the two are on different bases (#1208). The derived tile is marked as derived.
   * `null` when either input is missing: an absent input must never render as a zero.
   */
  const valueCost = summary && summary.total != null && summary.invested != null
    ? summary.total - summary.invested
    : null;
  const trades = Array.isArray(history.data) ? history.data : (history.data?.trades || []);
  const lastUpdated = account.dataUpdatedAt || history.dataUpdatedAt || Date.now();
  const isaData = isa.data || {};
  const isaPositions = Array.isArray(isaData.positions) ? isaData.positions : [];

  /**
   * ⚠️ A COOLDOWN PRODUCES NOTHING ON SCREEN — measured reconsideration, same session. The backend
   * answers `cooldown:true` for 60s after every successful import, and the page auto-imports on mount,
   * so a first draft rendered "Cooldown: 41s remaining" on nearly every visit. That is machine chatter
   * dressed as a status line: it describes a mechanism working correctly, on a page the owner had just
   * asked to have LESS low-value text. The last-synced time already answers "how fresh is this".
   */
  const syncNotice = useMemo(() => {
    if (!syncResult || syncResult.success || syncResult.cooldown) return null;
    // Already a rendered notice (the catch branch uses noticeFromError).
    if (syncResult.error && typeof syncResult.error === 'object') return syncResult.error;
    return notice('TCS-SYS-007', {
      operation: 'sync the T212 portfolio',
      detail: typeof syncResult.error === 'string' ? syncResult.error : 'the API gave no reason',
    });
  }, [syncResult]);

  const investTitle = investActive === 'demo' ? 'Practice (Demo)' : 'Invest (Live)';

  // ── MT5 positions (live broker rows, 2026-11-06) ──
  // ⚠️ WHY THEY ARE HERE AT ALL. The owner asked for the hover to say "what broker the position is
  // opened on, SL, TP, and a clear indicator if a position is not only in profit but the profit is
  // locked in" — and NONE of those fields exist on an imported Trading212 holding (measured: the T212
  // position payload has avgPrice/pnl/peakProfitPct, no stop, no broker). Only the MT5 positions carry
  // sl/tp/brokerId/account, so the table merges both or the request is unanswerable.
  // ⚠️ `/api/providers/mt5/positions` (camelCase, includes `account`/`swap`/`magic`) rather than
  // `/api/trading/mt5/positions` (snake_case, no account label) — the display needs the account.
  const mt5PositionsQuery = useQuery({
    queryKey: ['mt5-positions'],
    queryFn: () => apiGet('/api/providers/mt5/positions').catch(() => null),
    refetchInterval: 15_000,
  });
  const mt5Positions = Array.isArray(mt5PositionsQuery.data?.positions)
    ? mt5PositionsQuery.data.positions
    : [];

  /**
   * `isDemo` — the demo/live indicator.
   *
   * ⚠️ DERIVED FROM WHAT THE SOURCE REPORTS, never from a constant: a T212 holding says so through
   * `accountId` ('trading212-demo' / 'trading212-live'); an MT5 position says so through the `account`
   * label the bridge returns ('10011309743 @ MetaQuotes-Demo'). `null` means the source did not say —
   * which is NOT "live", and renders as no chip rather than a guess.
   */
  function demoFlag(accountId, accountLabel) {
    const s = `${accountId || ''} ${accountLabel || ''}`.toLowerCase();
    if (/demo|practice|paper/.test(s)) return true;
    if (/live|real/.test(s)) return false;
    return null;
  }

  // One combined positions table across all enabled accounts.
  const combinedPositions = useMemo(() => {
    const list = [];
    if (investActive) {
      for (const p of positions) {
        const entry = p.avgPrice ?? null;
        const qty = p.quantity ?? null;
        list.push({
          key: 'inv-' + (p.id || p.ticker || list.length),
          source: 't212',
          ticker: p.ticker || p.symbol,
          account: investTitle,
          isDemo: demoFlag(p.accountId, p.provider),
          side: p.side || null,
          quantity: qty,
          entry,
          currentPrice: p.currentPrice,
          value: (qty || 0) * (p.currentPrice || 0),
          pnl: p.pnl,
          movePct: movePct(p.side, entry, p.currentPrice),
          peakProfitPct: p.peakProfitPct ?? null,
          openedAt: p.openedAt || null,
          tradeable: false,
        });
      }
    }
    if (isaActive) {
      for (const p of isaPositions) {
        list.push({
          key: 'isa-' + (p.ticker || list.length),
          source: 'isa',
          ticker: p.ticker,
          account: 'Stocks ISA',
          isDemo: demoFlag(null, 'isa'),
          side: p.side || null,
          quantity: p.quantity,
          entry: p.avgPrice ?? null,
          currentPrice: p.currentPriceGbp,
          value: p.valueGbp,
          pnl: p.pnlGbp,
          movePct: movePct(p.side, p.avgPrice ?? null, p.currentPriceGbp),
          peakProfitPct: null,
          openedAt: p.openedAt || null,
          tradeable: false,
        });
      }
    }
    for (const p of mt5Positions) {
      const side = p.type === 'sell' ? 'sell' : 'buy';
      const sl = typeof p.sl === 'number' ? p.sl : null;
      const tp = typeof p.tp === 'number' ? p.tp : null;
      const entry = typeof p.priceOpen === 'number' ? p.priceOpen : null;
      /**
       * `lockedIn` — is the profit PROTECTED by the stop, not merely positive?
       * A long is protected when the stop sits at or above entry; a short when it sits at or below.
       * `false` means "in profit with the stop still on the losing side" — the state a reader most
       * needs to see, and the one a bare P&L column hides. `null` (no stop at all) is neither.
       */
      const lockedIn = sl == null || entry == null
        ? null
        : side === 'buy' ? sl >= entry : sl <= entry;
      list.push({
        key: 'mt5-' + p.ticket,
        source: 'mt5',
        ticket: p.ticket,
        ticker: p.symbol,
        account: p.account || `broker ${p.brokerId}`,
        isDemo: demoFlag(null, p.account),
        side,
        quantity: p.volume,
        entry,
        currentPrice: p.priceCurrent,
        /**
         * ⚠️ `volume` is LOTS, so `volume × price` is NOT money — measured 2026-11-06: a 0.01-lot
         * EURUSD position rendered "£0.01" and a 0.01-lot XAUUSD "£40.60", when the real notional is
         * 100× and 100× that. The payload DOES carry `contractSize` (100 for gold, 100,000 for FX), so
         * it is multiplied in and the column is labelled NOTIONAL. With no contract size the figure is
         * unknowable, so it renders "—" rather than a plausible wrong number.
         */
        value: Number.isFinite(p.contractSize) && p.contractSize > 0 && p.priceCurrent != null
          ? Number(p.volume || 0) * p.contractSize * p.priceCurrent
          : null,
        valueLabel: 'Notional',
        valueCurrency: p.currencyBase || null,
        contractSize: Number.isFinite(p.contractSize) ? p.contractSize : null,
        pnl: p.profit,
        movePct: movePct(side, entry, p.priceCurrent),
        peakProfitPct: null,
        openedAt: p.openTime || null,
        sl,
        tp,
        lockedIn,
        swap: p.swap ?? null,
        comment: p.comment || null,
        magic: p.magic ?? null,
        brokerId: p.brokerId ?? null,
        tradeable: true,
      });
    }
    return list;
  }, [investActive, positions, investTitle, isaActive, isaPositions, mt5Positions]);

  const mt5Rows = useMemo(() => combinedPositions.filter((p) => p.tradeable), [combinedPositions]);

  /** Re-read the broker after an action. A write that is not followed by a read leaves the row stale. */
  const refreshPositions = () => {
    qc.invalidateQueries({ queryKey: ['mt5-positions'] });
    qc.invalidateQueries({ queryKey: ['t212-account'] });
    qc.invalidateQueries({ queryKey: ['portfolio-accounts'] });
  };

  /**
   * runMt5Action — one broker action, with the failure made visible.
   *
   * ⚠️ THE BROKER CAN REFUSE WITH A 200. `closePosition`/`modifyPosition` answer
   * `{ success: false, error }` inside a successful HTTP response (market closed, invalid stops), so
   * `res.ok` is not the test — `success === false` is, and it is turned into a thrown error here so a
   * refusal renders the same notice path as a transport failure instead of looking like a success.
   */
  async function runMt5Action(key, fn, operation) {
    setBusyKey(key);
    setActionError(null);
    try {
      const res = await fn();
      if (res && res.success === false) {
        throw new Error(typeof res.error === 'string' ? res.error : 'refused by the broker');
      }
      setArmedKey(null);
      refreshPositions();
    } catch (err) {
      setActionError({ key, notice: noticeFromError(err, 'TCS-SYS-007', { operation }) });
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="t212p-page">
      {/* ── ONE summary block ──────────────────────────────────────────────────────────────────
          ⚠️ THE TOP OF THIS PAGE WAS MOSTLY AIR (owner, 2026-11-06: *"the top area is low value
          right now … a space at the top that's too big"*). Four stacked full-width rows — a header
          whose only child is an `h1` the shell HIDES, the grand total, a hint paragraph and a
          LastUpdated line — each costing its own margin to say very little, and all of it leaving the
          right half of the page empty. Measured: the page began at y=191 and the grand total at y=239,
          48px of which ~24px was the hidden header's `margin-bottom`.

          Now: no header (the breadcrumb already names the view, and `index.css` hides a page-level
          h1 anyway), the ℹ and the meta line live on the section heading row, and the grand total is
          the FIRST TILE OF THE SAME GRID as the account figures — the owner's own suggestion. */}
      <section className="t212p-section">
        <div className="t212p-section-head">
          <h2>
            {investActive ? `${investTitle} — Account Summary` : 'Account Summary'}
            <PageInfoPopover>
              Unified account overview — enable or disable each account (and each Live / Demo
              category) in ⚙ Screen Options → Accounts &amp; Totals to control exactly what is
              totalled together.
              <br /><br />
              The first tile totals <strong>every enabled account</strong>. The tiles after it are the
              Trading212 investment account alone, ordered as a sum: what you put in, what is left as
              cash, and the value those two add up to.
            </PageInfoPopover>
          </h2>
          <span className="t212p-section-meta">
            {syncing ? <span className="t212p-hint">Syncing…</span> : <LastUpdated at={lastUpdated} inline />}
            <span className="t212p-hint">⚙ Screen Options → Accounts &amp; Totals sets what is totalled</span>
          </span>
        </div>

        {syncNotice && <NoticeBlock notice={syncNotice} compact />}

        <div className="t212p-summary-wrap">
          <div className="t212p-summary-grid">
          <div
            className="t212p-stat t212p-stat--grand"
            title="The sum of the current value of every ENABLED account — each account's own balance, added together. Not a cost basis, and not comparable with the Cost basis tile below."
          >
            <span className="t212p-stat-label">Across enabled accounts</span>
            <span className="t212p-stat-value">{fmt(grandTotal)}</span>
          </div>

          {investActive && (
            <>
              {/* ⚠️ THE TILES DID NOT ADD UP, and the labels were the reason (owner, 2026-11-06:
                  *"we have Invested and cash shows zero so not sure about the maths"*).
                  Measured against `/api/portfolio/trading212/validate`:
                    Σ(quantity × avgPrice)    = 11,835.92 = `invested`
                    Σ(quantity × currentPrice)=  8,675.38 = `total`
                    Σ(pnl)                    = -1,309.27 = `ppl`   (and `result`, on this account)
                  So `invested` is the COST BASIS of the holdings, not their value — yet it sat beside
                  `Total Value` under labels that read as a sum, and `invested + free` was 11,835.92
                  while `total` said 8,675.38. `value − cost` = −3,160.54 and `ppl` = −1,309.27, i.e.
                  even the two available profit figures are on different bases (see #1208).
                  Now each tile says what it IS, and the one figure the app derives is marked as
                  derived and computed from the two tiles beside it, so it reconciles by construction.
                  Order kept as a sum: cost → cash → value, then the profits, then the count. */}
              <div className="t212p-stat" title="Σ quantity × average price — what these holdings COST. It is not what they are worth now, so it does not subtract from Total Value.">
                <span className="t212p-stat-label">Cost basis</span>
                <span className="t212p-stat-value">{fmt(summary?.invested)}</span>
              </div>
              <div className="t212p-stat" title="Cash the broker reports as available to trade. Zero here means the demo account is fully invested.">
                <span className="t212p-stat-label">Free Cash</span>
                <span className="t212p-stat-value">{fmt(summary?.free)}</span>
              </div>
              <div className="t212p-stat t212p-stat--total" title="Σ quantity × current price — what the holdings are worth right now. This is the account's value, and it is the figure the grand total above includes.">
                <span className="t212p-stat-label">Total Value</span>
                <span className="t212p-stat-value">{fmt(summary?.total)}</span>
              </div>
              <div className="t212p-stat t212p-stat--derived" title="Total Value − Cost basis. Computed here from the two tiles beside it, so it always reconciles with them.">
                <span className="t212p-stat-label">Value − cost</span>
                <span className={`t212p-stat-value ${valueCost > 0 ? 't212p-profit' : valueCost < 0 ? 't212p-loss' : ''}`}>
                  {valueCost != null ? fmt(valueCost) : '—'}
                </span>
              </div>
              <div className="t212p-stat" title="The broker's own unrealised profit/loss for OPEN positions, in account currency. Reported by Trading212, not derived here — which is why it is not equal to Value − cost (#1208).">
                <span className="t212p-stat-label">P&amp;L (open)</span>
                <span className={`t212p-stat-value ${summary?.ppl > 0 ? 't212p-profit' : summary?.ppl < 0 ? 't212p-loss' : ''}`}>
                  {summary?.ppl != null ? fmt(summary.ppl) : '—'}
                </span>
              </div>
              <div className="t212p-stat" title="The broker's account result, including realised profit from positions already closed. Equals P&L (open) when nothing has been closed.">
                <span className="t212p-stat-label">Result (incl. realised)</span>
                <span className={`t212p-stat-value ${summary?.result > 0 ? 't212p-profit' : summary?.result < 0 ? 't212p-loss' : ''}`}>
                  {summary?.result != null ? fmt(summary.result) : '—'}
                </span>
              </div>
              <div className="t212p-stat">
                <span className="t212p-stat-label">Positions</span>
                <span className="t212p-stat-value">{positions.length}</span>
              </div>
            </>
          )}
          </div>
        </div>
      </section>

      {/* ── Combined positions (all enabled accounts + MT5) ─────────────────────────────────────
          ⚠️ THE HOVER IS THE FEATURE, NOT THE ROW (owner, 2026-11-06): *"The tables hover over row
          changes display the same information and its not even inline with columns … Expand on the
          hover over approach before we pack the initial rows of the table full of information which
          doesn't have a lot of room for that."*
          So the six columns stay exactly as they were, and a detail row opens UNDER the hovered row —
          full table width, so every fact lines up with the columns above it instead of floating in a
          browser tooltip. Keyboard reaches it too: focusing the row opens the panel, Escape closes it.
          ⚠️ Opening on hover alone would be pointer-only (WCAG 2.1.1), which is why `onFocus` is bound
          to the row as well and why the panel stays until Escape or another row — a mouse-leave timer
          alone would close it while the reader is reaching for a control. */}
      <section className="t212p-section">
        <div className="t212p-section-head">
          <h2>
            Positions ({combinedPositions.length})
            <PageInfoPopover label="About the positions table">
              Every open position this app knows about: imported Trading212/ISA holdings plus the live
              MT5 positions on each broker. Point at a row (or tab to it) for the full detail.
              <br /><br />
              <strong>Why only some rows have trade controls.</strong> An MT5 position can be closed or
              re-stopped from here. An imported Trading212 holding is a READ-ONLY copy of what the
              broker reported — this app has no route to trade it, so a control on that row would be a
              promise it cannot keep.
            </PageInfoPopover>
          </h2>
          <span className="t212p-section-meta">
            <span className="t212p-hint">
              {mt5Rows.length} on MT5 · {combinedPositions.length - mt5Rows.length} imported
            </span>
            {mt5Rows.some((p) => p.pnl > 0) && (
              <button
                type="button"
                className={`t212p-action ${closeAll.armed ? 't212p-action--armed' : 't212p-action--danger'}`}
                disabled={closeAll.busy}
                onClick={async () => {
                  if (!closeAll.armed) { setCloseAll({ armed: true, busy: false, notice: null }); return; }
                  setCloseAll({ armed: false, busy: true, notice: null });
                  try {
                    const res = await apiPost('/api/trading/mt5/close-profitable');
                    setCloseAll({
                      armed: false,
                      busy: false,
                      notice: res?.success === false
                        ? notice('TCS-SYS-007', { operation: 'close the profitable positions', detail: res.error || 'refused by the broker' })
                        : null,
                    });
                    refreshPositions();
                  } catch (err) {
                    setCloseAll({
                      armed: false, busy: false,
                      notice: noticeFromError(err, 'TCS-SYS-007', { operation: 'close the profitable positions' }),
                    });
                  }
                }}
                title="Closes every MT5 position currently in profit. Click once to arm, again to confirm."
              >
                {closeAll.busy ? 'Closing…' : closeAll.armed ? 'Confirm close all profitable' : 'Close all profitable'}
              </button>
            )}
          </span>
        </div>

        {closeAll.notice && <NoticeBlock notice={closeAll.notice} compact />}

        {combinedPositions.length === 0 ? (
          <p className="t212p-empty">No open positions. Import from Trading212 to populate.</p>
        ) : (
          <div className="t212p-table-wrap">
            <table className="t212p-table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Account</th>
                  <th>Qty</th>
                  <th>Current</th>
                  <th>Value</th>
                  <th>P&amp;L</th>
                </tr>
              </thead>
              <tbody>
                {combinedPositions.slice(0, 100).map((p) => (
                  <Fragment key={p.key}>
                    <tr
                      className={hoveredKey === p.key ? 't212p-row t212p-row--open' : 't212p-row'}
                      tabIndex={0}
                      aria-expanded={hoveredKey === p.key}
                      onMouseEnter={() => openPanel(p.key)}
                      onMouseLeave={scheduleClose}
                      onFocus={() => openPanel(p.key)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') { setHoveredKey(null); setArmedKey(null); }
                      }}
                    >
                      <td className="t212p-symbol">
                        <a
                          className="t212p-symbol-link"
                          href={`/research/symbol/${encodeURIComponent(p.ticker)}`}
                          title={`Open the ${p.ticker} research page`}
                        >
                          {p.ticker}
                        </a>
                        {p.side && <span className="t212p-side">{p.side === 'sell' ? 'SHORT' : 'LONG'}</span>}
                      </td>
                      <td className="t212p-account-cell">
                        {p.account}
                        {p.isDemo !== null && (
                          <span className={`t212p-mode-chip ${p.isDemo ? 't212p-mode-chip--demo' : 't212p-mode-chip--live'}`}>
                            {p.isDemo ? 'DEMO' : 'LIVE'}
                          </span>
                        )}
                      </td>
                      <td>{p.quantity != null ? Number(p.quantity).toFixed(2) : '—'}</td>
                      {/* ⚠️ A price is not sterling. Only the imported sources carry GBP-equivalent
                          prices; an MT5 quote is in the instrument's own currency, so it is shown
                          bare rather than prefixed with a £ it does not have. Same for the notional. */}
                      <td>{p.source === 'mt5' ? num2(p.currentPrice) : fmt(p.currentPrice)}</td>
                      <td>
                        {p.source === 'mt5'
                          ? (p.value == null ? '—' : `${num2(p.value)}${p.valueCurrency ? ` ${p.valueCurrency}` : ''}`)
                          : fmt(p.value)}
                      </td>
                      <td className={p.pnl > 0 ? 't212p-profit' : p.pnl < 0 ? 't212p-loss' : ''}>
                        {p.pnl != null ? fmt(p.pnl) : '—'}
                        {p.movePct != null && (
                          <span className="t212p-pnl-pct">{p.movePct > 0 ? '+' : ''}{p.movePct.toFixed(2)}%</span>
                        )}
                        {/* Profit that the STOP protects, not merely profit that exists. */}
                        {p.lockedIn === true && (
                          <span className="t212p-lock" title="Stop-loss is beyond the entry price — this profit is protected">🔒</span>
                        )}
                      </td>
                    </tr>

                    {hoveredKey === p.key && (
                      <tr
                        className="t212p-detail-row"
                        onMouseEnter={() => openPanel(p.key)}
                        onMouseLeave={scheduleClose}
                      >
                        <td colSpan={6}>
                          <PositionDetail
                            p={p}
                            busy={busyKey === p.key}
                            error={actionError?.key === p.key ? actionError.notice : null}
                            armed={armedKey === p.key}
                            onArm={() => setArmedKey(p.key)}
                            onClose={() => runMt5Action(p.key, () => apiDelete(`/api/trading/mt5/close/${p.ticket}`), 'close this position')}
                            onBreakeven={() => runMt5Action(
                              p.key,
                              () => apiPost(`/api/trading/mt5/modify/${p.ticket}`, { sl: p.entry, tp: p.tp ?? null }),
                              'move the stop to breakeven',
                            )}
                            onSetStops={(sl, tp) => runMt5Action(
                              p.key,
                              () => apiPost(`/api/trading/mt5/modify/${p.ticket}`, { sl, tp }),
                              'set the stop-loss and take-profit',
                            )}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Recent Trades ── */}
      {investActive && (
        <section className="t212p-section">
          <h2>Recent Trades</h2>
          {trades.length === 0 ? (
            <p className="t212p-empty">
              {feedUnavailable(history)
                ? '⚠️ Trade history could not be read — this is not an empty history. Retry to load it.'
                : 'No trade history available.'}
            </p>
          ) : (
            <div className="t212p-table-wrap">
              <table className="t212p-table">
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Side</th>
                    <th>Qty</th>
                    <th>Price</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.slice(0, 10).map((t, i) => (
                    <tr key={i}>
                      <td className="t212p-symbol">
                        <a
                          className="t212p-symbol-link"
                          href={`/research/symbol/${encodeURIComponent(t.ticker || t.symbol)}`}
                          title={`Research ${t.ticker || t.symbol}`}
                        >
                          {t.ticker || t.symbol}
                        </a>
                      </td>
                      <td className={t.side === 'BUY' ? 't212p-profit' : 't212p-loss'}>{t.side || t.type}</td>
                      <td>{t.quantity?.toFixed(2) || '—'}</td>
                      <td>{fmt(t.price)}</td>
                      <td>{t.date ? new Date(t.date).toLocaleDateString() : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
