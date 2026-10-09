/**
 * RegisterSymbolOverlay — ONE overlay for "register this symbol and add it to a watchlist",
 * offered from ANY view that names a symbol the app may not have onboarded.
 *
 * USAGE — mount it where the symbol context exists; it owns nothing view-specific:
 *
 *   const [overlayTicker, setOverlayTicker] = useState(null);
 *   ...
 *   <button onClick={() => setOverlayTicker('KEN')}>Register…</button>
 *   {overlayTicker && <RegisterSymbolOverlay ticker={overlayTicker} onClose={() => setOverlayTicker(null)} />}
 *
 * WHY IT EXISTS (owner direction, 2026-10-08): *"I want it to be an overlay that can be offered from
 * any view, and some of the functions should already exist."* The functions DID exist — `POST
 * /api/symbols` to register, and `GET /api/watchlists` to list — but adding one symbol to an EXISTING
 * watchlist had no safe endpoint: `POST /api/watchlists` derives the row id from the `name` it is
 * given, so passing a watchlist's label would create a DUPLICATE watchlist and return 200. That gap
 * was closed with `POST /api/watchlists/:id/symbols/:ticker` before this component was written, so
 * this overlay never has to do a read-modify-write of a whole watchlist.
 *
 * ⚠️ THE TWO ACTIONS ARE INDEPENDENT ON PURPOSE. Registering and adding to a watchlist are different
 * facts — a symbol can be registered and in no watchlist, and the owner's ask named both. Collapsing
 * them into one "Add" button would make the second silently depend on the first.
 *
 * ⚠️ "ALREADY REGISTERED" IS NOT AN ERROR. It is reported as its own state, because a reader must be
 * able to tell "the app knows this symbol" from "we just created it" — the same reasoning as the
 * endpoint's `added` / `alreadyPresent` pair.
 */
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '../core/api/client';
import './register-symbol-overlay.css';

const SYMBOL_TYPES = ['stock', 'crypto', 'forex', 'index', 'commodity', 'etf'];

export default function RegisterSymbolOverlay({ ticker, onClose }) {
  const upper = (ticker || '').toUpperCase();
  const queryClient = useQueryClient();
  const firstFieldRef = useRef(null);

  const [name, setName] = useState('');
  const [exchange, setExchange] = useState('');
  const [type, setType] = useState('stock');
  const [watchlistId, setWatchlistId] = useState('');
  const [busy, setBusy] = useState(null); // 'register' | 'watchlist'
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null); // { kind, text }

  // Is this ticker already in the app's onboarded set?
  const symbolQuery = useQuery({
    queryKey: ['symbol-check', upper],
    queryFn: () => apiGet(`/api/symbols?search=${encodeURIComponent(upper)}`).catch(() => null),
    staleTime: 30_000,
    enabled: !!upper,
  });
  // ⚠️ Three outcomes, kept distinct: found / not found / could-not-check. A failed request must not
  // render as "not registered", or the user is told to create something that already exists.
  const symbols = symbolQuery.data?.symbols;
  const registered = Array.isArray(symbols)
    ? symbols.some((s) => String(s?.ticker ?? s ?? '').toUpperCase() === upper)
    : null;
  const checkFailed = symbolQuery.isError || (symbolQuery.isSuccess && !Array.isArray(symbols));

  // Watchlists are a plain ARRAY of {id,label,...} — measured live, not the {watchlists:[]} wrapper
  // the name suggests. Tolerate both so a server-side shape change cannot silently empty the picker.
  const watchlistQuery = useQuery({
    queryKey: ['overlay-watchlists'],
    queryFn: () => apiGet('/api/watchlists').catch(() => null),
    staleTime: 30_000,
  });
  const watchlists = Array.isArray(watchlistQuery.data)
    ? watchlistQuery.data
    : Array.isArray(watchlistQuery.data?.watchlists)
      ? watchlistQuery.data.watchlists
      : [];

  // Escape closes; focus lands on the first field so the dialog is usable from the keyboard alone.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    firstFieldRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const register = async () => {
    setError(null); setDone(null);
    if (!name.trim() || !exchange.trim()) {
      setError('A name and an exchange are required to register a symbol.');
      return;
    }
    setBusy('register');
    try {
      await apiPost('/api/symbols', { ticker: upper, name: name.trim(), exchange: exchange.trim(), type });
      queryClient.invalidateQueries({ queryKey: ['symbol-check', upper] });
      setDone({ kind: 'register', text: `${upper} registered as a ${type} on ${exchange.trim()}.` });
    } catch (err) {
      setError(err?.detail || err?.message || 'The symbol could not be registered.');
    } finally {
      setBusy(null);
    }
  };

  const addToWatchlist = async () => {
    setError(null); setDone(null);
    if (!watchlistId) { setError('Choose a watchlist first.'); return; }
    setBusy('watchlist');
    try {
      const res = await apiPost(`/api/watchlists/${encodeURIComponent(watchlistId)}/symbols/${encodeURIComponent(upper)}`);
      // ⚠️ The endpoint distinguishes "added" from "was already there" — surface it rather than
      // reporting a change that did not happen.
      setDone({
        kind: 'watchlist',
        text: res?.alreadyPresent
          ? `${upper} was already in ${labelOf(watchlistId)}.`
          : `${upper} added to ${labelOf(watchlistId)}.`,
      });
      queryClient.invalidateQueries({ queryKey: ['overlay-watchlists'] });
    } catch (err) {
      setError(err?.detail || err?.message || 'The symbol could not be added to that watchlist.');
    } finally {
      setBusy(null);
    }
  };

  function labelOf(id) {
    return watchlists.find((w) => w.id === id)?.label || watchlists.find((w) => w.id === id)?.name || id;
  }

  return (
    <div className="rso-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="rso-panel" role="dialog" aria-modal="true" aria-labelledby="rso-title">
        <header className="rso-head">
          <h2 id="rso-title" className="rso-title">
            Symbol <code className="rso-ticker">{upper}</code>
          </h2>
          <button type="button" className="rso-close" onClick={onClose} aria-label="Close">✕</button>
        </header>

        <p className="rso-state" role="status">
          {registered === true && '✅ Already registered — it can be scored.'}
          {registered === false && '⚠️ Not registered yet — register it before it can be scored.'}
          {registered === null && (checkFailed
            ? '❓ Could not check whether this symbol is registered.'
            : 'Checking registration…')}
        </p>

        {/* ⚠️ TWO CLAIMS DELIBERATELY NOT MADE HERE (2026-10-09, #1098).
            (1) "…and traded". This panel previously said a registered symbol "can be scored and
                traded". Registering writes a `symbol` row and NOTHING else — no `symbol_route`, no
                catalogue entry (`symbols.service.ts` `create()`). Whether a ticker is TRADEABLE is
                decided at routing time by what a broker CAN do (register row 38), which this panel
                has not measured, so stating it here would be a claim with no observation behind it.
                The honest thing to state is what the registry HOLDS, not what will happen to it.
            (2) "…saved". The row is written straight to the database and is in NO seeder
                (`database-seed-discipline.instructions.md`), so it survives restarts and is lost on
                a reinstall. A reader who registers a symbol and later reinstalls would have no way
                to know it is gone — silence about that is the defect, hence the note below it. */}
        <p className="rso-note">
          ⓘ Registration is recorded on this machine's database only — it is not part of the shipped
          catalogue, so a reinstall would not restore it.
        </p>

        {/* ── 1. Register ─────────────────────────────────────────────── */}
        <section className="rso-section">
          <h3 className="rso-section-title">Register the symbol</h3>
          {registered === true ? (
            <p className="rso-note">Nothing to do — the registry already holds this ticker.</p>
          ) : (
            <div className="rso-fields">
              <label className="rso-field">
                <span className="rso-label">Name</span>
                <input ref={firstFieldRef} className="ff-input" value={name}
                  onChange={(e) => setName(e.target.value)} placeholder="Kenvue Inc." />
              </label>
              <label className="rso-field">
                <span className="rso-label">Exchange</span>
                <input className="ff-input" value={exchange}
                  onChange={(e) => setExchange(e.target.value)} placeholder="NYSE" />
              </label>
              <label className="rso-field">
                <span className="rso-label">Type</span>
                <select className="ff-input" value={type} onChange={(e) => setType(e.target.value)}>
                  {SYMBOL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              <button type="button" className="btn rso-action" onClick={register} disabled={busy === 'register'}>
                {busy === 'register' ? 'Registering…' : 'Register symbol'}
              </button>
            </div>
          )}
        </section>

        {/* ── 2. Add to a watchlist ───────────────────────────────────── */}
        <section className="rso-section">
          <h3 className="rso-section-title">Add to a watchlist</h3>
          {watchlists.length === 0 ? (
            <p className="rso-note">
              {watchlistQuery.isLoading ? 'Loading watchlists…' : 'No watchlists were returned, so there is nothing to add it to.'}
            </p>
          ) : (
            <div className="rso-fields">
              <label className="rso-field">
                <span className="rso-label">Watchlist</span>
                <select className="ff-input" value={watchlistId} onChange={(e) => setWatchlistId(e.target.value)}>
                  <option value="">Choose a watchlist…</option>
                  {watchlists.map((w) => {
                    const id = w.id ?? w.label ?? w.name;
                    const count = w.symbolCount ?? w.symbols?.length;
                    return (
                      <option key={id} value={id}>
                        {(w.label || w.name || id)}{typeof count === 'number' ? ` · ${count}` : ''}
                      </option>
                    );
                  })}
                </select>
              </label>
              <button type="button" className="btn rso-action" onClick={addToWatchlist} disabled={busy === 'watchlist' || !watchlistId}>
                {busy === 'watchlist' ? 'Adding…' : 'Add to watchlist'}
              </button>
            </div>
          )}
        </section>

        {error && <p className="rso-error" role="alert">{error}</p>}
        {done && <p className="rso-ok" role="status">✅ {done.text}</p>}
      </div>
    </div>
  );
}
