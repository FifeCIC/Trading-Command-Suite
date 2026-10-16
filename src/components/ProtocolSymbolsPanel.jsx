/**
 * ProtocolSymbolsPanel — assign the symbols a protocol scores (#1124).
 * ====================================================================
 *
 * Pipeline position:
 *   compose  POST /api/scoring/protocols              → the protocol's directives (the Builder)
 *   WIRE     POST /api/scoring/gated/protocols/:id/symbols   → THIS panel  ← did not exist before
 *   score    resolveSymbols() reads `symbol_protocol_assignment` (Path 1 of 3)
 *
 * ⚠️ WHY THIS EXISTS. Before 2026-10-16, **no controller wrote `symbol_protocol_assignment`**. The
 * only writes were side-effects inside `protocol-db.service.ts` — L590 copies assignments when a
 * protocol is **duplicated**, L709 deletes them on delete. So:
 *
 *   • a protocol COPIED from one that already had symbols worked; and
 *   • a protocol **COMPOSED from scratch could never be given any**.
 *
 * With no assignment, `resolveSymbols()` falls past Path 1 (assignment) and Path 2 (linked
 * watchlist) to **Path 3 — a name-guessing fallback that infers symbols from the protocol's slug
 * text** (#761/#763). It then warns, or resolves nothing and scores nothing. **Neither failure
 * reports an error.** That is why the assignment is a first-class control here rather than a
 * database chore.
 *
 * ⚠️ `resolution` IS RENDERED, AND 'derived' IS SHOWN AS A WARNING — because it is one.
 * `derived` means the symbol list was **GUESSED from the protocol's name**, not wired. It works
 * until the ticker is renamed, and then it silently points at a dead symbol. Rendering `derived`
 * as though it were `db:assignment` would hide exactly the state a reader needs to see.
 *
 * ⚠️ NO NEW CSS. This uses the canonical Form System (`src/core/forms.css`, `.ff-*`) rather than a
 * local stylesheet, so there is no new token to validate and nothing to duplicate.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiDelete } from '../core/api/client';
import NoticeBlock from './NoticeBlock';
import { noticeFromError } from '../core/notices/from-error.js';
import '../core/forms.css';

export default function ProtocolSymbolsPanel({ protocolSlug }) {
  const qc = useQueryClient();
  const [pick, setPick] = useState('');
  const [msg, setMsg] = useState(null);

  const symbolsQuery = useQuery({
    queryKey: ['protocol-symbols', protocolSlug],
    queryFn: () => apiGet(`/api/scoring/gated/protocols/${encodeURIComponent(protocolSlug)}/symbols`),
    enabled: Boolean(protocolSlug),
    staleTime: 15_000,
  });

  // The pool to assign FROM. Only registered symbols can be assigned — the endpoint refuses an
  // unregistered ticker, so offering one here would be an invitation to a 400.
  const poolQuery = useQuery({
    queryKey: ['symbol-pool'],
    queryFn: () => apiGet('/api/symbols'),
    enabled: Boolean(protocolSlug),
    staleTime: 300_000,
  });

  const assigned = symbolsQuery.data?.symbols ?? [];
  const resolution = symbolsQuery.data?.resolution ?? null;

  const addMutation = useMutation({
    mutationFn: (symbol) =>
      apiPost(`/api/scoring/gated/protocols/${encodeURIComponent(protocolSlug)}/symbols`, { symbol }),
    onSuccess: (r) => {
      setMsg({ ok: true, text: `${r.symbol} assigned — this protocol now scores ${r.symbols.join(', ')}.` });
      setPick('');
      qc.invalidateQueries({ queryKey: ['protocol-symbols', protocolSlug] });
    },
    onError: (err) => setMsg({ ok: false, notice: noticeFromError(err, 'TCS-SYS-007', { operation: 'assign the symbol' }) }),
  });

  const removeMutation = useMutation({
    mutationFn: (symbol) =>
      apiDelete(`/api/scoring/gated/protocols/${encodeURIComponent(protocolSlug)}/symbols/${encodeURIComponent(symbol)}`),
    onSuccess: (r) => {
      setMsg({
        ok: true,
        text: r.removed
          ? `Removed ${r.removed} assignment. Now scoring: ${r.symbols.length ? r.symbols.join(', ') : 'nothing'}.`
          : 'No assignment row existed for that symbol.',
      });
      qc.invalidateQueries({ queryKey: ['protocol-symbols', protocolSlug] });
    },
    onError: (err) => setMsg({ ok: false, notice: noticeFromError(err, 'TCS-SYS-007', { operation: 'remove the symbol' }) }),
  });

  if (!protocolSlug) {
    return (
      <section className="ff-form" aria-labelledby="psp-heading">
        <h3 id="psp-heading" className="ff-legend">Symbols this protocol scores</h3>
        <p className="ff-hint">
          Save the protocol first — symbols are assigned to a saved protocol.
        </p>
      </section>
    );
  }

  const pool = (poolQuery.data?.symbols ?? [])
    .map((s) => String(s.ticker ?? '').toUpperCase())
    .filter((t) => t && !assigned.includes(t))
    .sort();

  return (
    <section className="ff-form" aria-labelledby="psp-heading">
      <h3 id="psp-heading" className="ff-legend">Symbols this protocol scores</h3>

      {/* ⚠️ 'derived' means the list was GUESSED from the protocol's name. Shown as a warning,
          because it breaks silently on a ticker rename (#761/#763). */}
      {resolution === 'derived' && assigned.length > 0 && (
        <p className="ff-hint ff-hint-warn">
          ⚠️ <b>These symbols were guessed from the protocol&apos;s name, not wired.</b> A rename breaks
          that silently. Assign a symbol below to replace the guess with a real link.
        </p>
      )}
      {resolution === 'db:watchlist' && (
        <p className="ff-hint">
          Symbols come from a linked <b>watchlist</b>. Adding a symbol here adds an explicit
          assignment alongside it — the two combine, and removing one does not remove the other.
        </p>
      )}
      {resolution === 'db:assignment' && (
        <p className="ff-hint">Wired by explicit assignment.</p>
      )}

      {/* ⚠️ Loading, failed, and empty are kept DISTINCT — an empty list and a failed read must
          never look the same (`development-philosophy` §7). */}
      {symbolsQuery.isLoading && <p className="ff-hint">Loading…</p>}

      {symbolsQuery.error && (
        <div>
          <NoticeBlock notice={noticeFromError(symbolsQuery.error, 'TCS-SYS-002')} />
          <button type="button" className="ff-btn ff-btn-secondary" onClick={() => symbolsQuery.refetch()}>
            Retry
          </button>
        </div>
      )}

      {!symbolsQuery.isLoading && !symbolsQuery.error && assigned.length === 0 && (
        <p className="ff-hint ff-hint-warn">
          <b>This protocol scores nothing.</b> It has no assignment, no linked watchlist, and no
          derivable symbol — so no symbol is ever scored with it.
        </p>
      )}

      {assigned.length > 0 && (
        <ul className="ff-row-3">
          {assigned.map((s) => (
            <li key={s} className="ff-field">
              <span className="ff-label">{s}</span>
              <button
                type="button"
                className="ff-btn ff-btn-secondary"
                disabled={removeMutation.isPending}
                onClick={() => removeMutation.mutate(s)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="ff-field">
        <label className="ff-label" htmlFor="psp-add">Add a symbol</label>
        <select
          id="psp-add"
          className="ff-select"
          value={pick}
          onChange={(e) => setPick(e.target.value)}
        >
          <option value="">— choose a registered symbol —</option>
          {pool.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      <div className="ff-actions">
        <button
          type="button"
          className="ff-btn ff-btn-primary"
          disabled={!pick || addMutation.isPending}
          onClick={() => addMutation.mutate(pick)}
        >
          {addMutation.isPending ? 'Assigning…' : 'Assign symbol'}
        </button>
      </div>

      {msg && (msg.ok ? <p className="ff-success">{msg.text}</p> : <NoticeBlock notice={msg.notice} />)}
    </section>
  );
}
