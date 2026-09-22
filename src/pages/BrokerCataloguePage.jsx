/**
 * BrokerCataloguePage — what the BROKERS offer, versus what the app has onboarded (#958).
 *
 * Route: /research/broker-catalogue
 *
 * ⚠️ WHY THIS PAGE EXISTS. #958 built the capability — the broker's 12,373-instrument list is now
 * imported instead of being read into an in-memory cache and discarded. But a capability nobody
 * can see is indistinguishable from an absent one, and the entire finding behind this work was
 * invisible: **GRML rose +539% in two sessions** while the app could see 11 tradeable instruments
 * out of ~13,000. This page is the surface that makes that gap a number rather than a claim.
 *
 * ⚠️ THE HEADLINE NUMBER IS `undiscoveredTradeable` — offered by the broker, `tradeMode: 4`
 * (the broker would accept an order), and NOT in the app's `symbol` table. It is not "symbols we
 * don't have" (most are irrelevant); it is "instruments that could be traded today and have never
 * been looked at".
 *
 * ⚠️ EVERY STATE RENDERS DIFFERENTLY. Loading, an empty result, and a failed request must never
 * look the same — `[]` is information, an error is the absence of information, and the two lead to
 * opposite conclusions (philosophy §7). A broker that could not be reached shows its reason.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '../core/api/client';
import './broker-catalogue.css';

const PAGE_SIZE = 50;

export default function BrokerCataloguePage() {
  const [brokerFilter, setBrokerFilter] = useState('');
  const [assetClass, setAssetClass] = useState('');
  const [undiscoveredOnly, setUndiscoveredOnly] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const queryClient = useQueryClient();

  const summaryQuery = useQuery({
    queryKey: ['broker-symbols-summary'],
    queryFn: () => apiGet('/api/broker-symbols/summary').catch(() => null),
    refetchInterval: 60_000,
  });

  const classesQuery = useQuery({
    queryKey: ['broker-symbols-classes', brokerFilter],
    queryFn: () =>
      apiGet(`/api/broker-symbols/classes${brokerFilter ? `?brokerId=${brokerFilter}` : ''}`).catch(
        () => null,
      ),
  });

  const listPath = () => {
    const params = new URLSearchParams();
    if (brokerFilter) params.set('brokerId', brokerFilter);
    if (assetClass) params.set('assetClass', assetClass);
    if (search.trim()) params.set('search', search.trim());
    params.set('limit', String(PAGE_SIZE));
    params.set('offset', String(page * PAGE_SIZE));
    // `/undiscovered` is the dedicated backlog route: registered=false AND tradeMode=4. Using the
    // explicit route rather than two query params keeps the intent readable in the network tab.
    if (undiscoveredOnly) return `/api/broker-symbols/undiscovered?${params.toString()}`;
    params.set('registered', 'true');
    return `/api/broker-symbols?${params.toString()}`;
  };

  const listQuery = useQuery({
    queryKey: ['broker-symbols-list', brokerFilter, assetClass, undiscoveredOnly, search, page],
    queryFn: () => apiGet(listPath()).catch(() => null),
    staleTime: 15_000,
  });

  const syncMutation = useMutation({
    mutationFn: () =>
      apiPost(`/api/broker-symbols/sync${brokerFilter ? `?brokerId=${brokerFilter}` : ''}`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['broker-symbols-summary'] });
      queryClient.invalidateQueries({ queryKey: ['broker-symbols-list'] });
      queryClient.invalidateQueries({ queryKey: ['broker-symbols-classes'] });
    },
  });

  const brokers = summaryQuery.data?.brokers || [];
  const classes = classesQuery.data?.classes || [];
  const data = listQuery.data || {};
  const rows = data.rows || [];
  const total = data.total || 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const totals = brokers.reduce(
    (acc, b) => ({
      offered: acc.offered + (b.offered || 0),
      tradeable: acc.tradeable + (b.tradeable || 0),
      onboarded: acc.onboarded + (b.onboarded || 0),
      undiscovered: acc.undiscovered + (b.undiscoveredTradeable || 0),
    }),
    { offered: 0, tradeable: 0, onboarded: 0, undiscovered: 0 },
  );

  return (
    <div className="bc-page">
      <header className="bc-header">
        <h1>🌐 Broker Catalogue</h1>
        <p className="bc-subtitle">
          What the brokers offer, versus what this app has onboarded. The figure that matters is{' '}
          <strong>never looked at</strong> — tradeable, and absent from the app's symbol table.
        </p>
      </header>

      {/* ── Per-broker state ──────────────────────────────────────────────────────────────
          Each broker carries its OWN state and reason. A broker that could not be reached is
          shown as such rather than being folded into a total that silently omits it. */}
      <section className="bc-brokers">
        {summaryQuery.isLoading ? (
          <p className="bc-state">Reading broker catalogue…</p>
        ) : summaryQuery.isError || !summaryQuery.data ? (
          <p className="bc-state bc-state-error">
            Could not read the catalogue summary — this is a failure, not an empty result.
          </p>
        ) : (
          brokers.map((b) => (
            <article key={b.brokerId} className={`bc-broker bc-broker-${b.state}`}>
              <div className="bc-broker-head">
                <span className="bc-broker-id">Broker {b.brokerId}</span>
                <span className={`bc-broker-state bc-state-${b.state}`}>{b.state}</span>
              </div>
              {b.reason && <p className="bc-broker-reason">{b.reason}</p>}
              <dl className="bc-broker-stats">
                <div>
                  <dt>Offered</dt>
                  <dd>{b.offered.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Tradeable</dt>
                  <dd>{b.tradeable.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Onboarded</dt>
                  <dd>{b.onboarded.toLocaleString()}</dd>
                </div>
                <div className="bc-stat-key">
                  <dt>Never looked at</dt>
                  <dd>{b.undiscoveredTradeable.toLocaleString()}</dd>
                </div>
              </dl>
              <p className="bc-broker-meta">
                {b.lastSuccessAt
                  ? `Last successful sync ${new Date(b.lastSuccessAt).toLocaleString()}` +
                    (b.noLongerOffered > 0
                      ? ` · ${b.noLongerOffered.toLocaleString()} no longer offered`
                      : '')
                  : 'Never synced'}
              </p>
            </article>
          ))
        )}
      </section>

      {brokers.length > 0 && (
        <p className="bc-totals">
          Across {brokers.length} broker{brokers.length === 1 ? '' : 's'}:{' '}
          {totals.offered.toLocaleString()} offered · {totals.tradeable.toLocaleString()} tradeable
          · {totals.onboarded.toLocaleString()} onboarded ·{' '}
          <strong>{totals.undiscovered.toLocaleString()} never looked at</strong>
        </p>
      )}

      {/* ── Controls ── */}
      <div className="bc-controls">
        <label className="bc-field">
          <span>Broker</span>
          <select
            value={brokerFilter}
            onChange={(e) => {
              setBrokerFilter(e.target.value);
              setPage(0);
            }}
          >
            <option value="">All</option>
            {brokers.map((b) => (
              <option key={b.brokerId} value={b.brokerId}>
                Broker {b.brokerId}
              </option>
            ))}
          </select>
        </label>

        <label className="bc-field">
          <span>Class</span>
          <select
            value={assetClass}
            onChange={(e) => {
              setAssetClass(e.target.value);
              setPage(0);
            }}
          >
            <option value="">All</option>
            {classes.map((c) => (
              <option key={c.assetClass} value={c.assetClass}>
                {c.assetClass} ({c.count.toLocaleString()})
              </option>
            ))}
          </select>
        </label>

        <label className="bc-field bc-field-grow">
          <span>Search</span>
          <input
            type="text"
            placeholder="Ticker"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
          />
        </label>

        <label className="bc-toggle">
          <input
            type="checkbox"
            checked={undiscoveredOnly}
            onChange={(e) => {
              setUndiscoveredOnly(e.target.checked);
              setPage(0);
            }}
          />
          <span>Never looked at only</span>
        </label>

        <button
          className="bc-sync"
          onClick={() => syncMutation.mutate()}
          disabled={syncMutation.isPending}
        >
          {syncMutation.isPending ? 'Syncing…' : 'Sync now'}
        </button>
      </div>

      {syncMutation.data?.results && (
        <p className="bc-sync-result">
          {syncMutation.data.results
            .map((r) => `Broker ${r.brokerId}: ${r.state} (${r.fetched.toLocaleString()} fetched)`)
            .join(' · ')}
        </p>
      )}
      {syncMutation.isError && (
        <p className="bc-state bc-state-error">Sync failed: {String(syncMutation.error)}</p>
      )}

      {/* ── The catalogue ── */}
      <section className="bc-table-wrap">
        {listQuery.isLoading ? (
          <p className="bc-state">Loading instruments…</p>
        ) : listQuery.isError || !listQuery.data ? (
          <p className="bc-state bc-state-error">
            Could not read the catalogue — a failed request is not an empty list.
          </p>
        ) : rows.length === 0 ? (
          <p className="bc-state">
            No instruments match these filters. That is a result, not a failure — try clearing the
            class filter or turning off “never looked at only”.
          </p>
        ) : (
          <>
            <table className="bc-table">
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th>Broker</th>
                  <th>Class</th>
                  <th>Trade mode</th>
                  <th>Min volume</th>
                  <th>Digits</th>
                  <th>Onboarded</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="bc-ticker">{r.name}</td>
                    <td>{r.brokerId}</td>
                    <td>{r.assetClass || '—'}</td>
                    <td>
                      {r.tradeMode === 4 ? (
                        <span className="bc-pill bc-pill-ok">4 · full</span>
                      ) : (
                        <span className="bc-pill bc-pill-off">
                          {r.tradeMode === null ? 'unknown' : `${r.tradeMode} · disabled`}
                        </span>
                      )}
                    </td>
                    <td>{r.volumeMin ?? '—'}</td>
                    <td>{r.digits ?? '—'}</td>
                    <td>{r.registered ? <span className="bc-pill bc-pill-ok">yes</span> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="bc-pager">
              <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>
                ‹ Prev
              </button>
              <span>
                Page {page + 1} of {pageCount.toLocaleString()} · {total.toLocaleString()} matching
              </span>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={page + 1 >= pageCount}
              >
                Next ›
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
