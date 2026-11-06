/**
 * VendorsPage — every source of DATA this app can draw on, and whether it is usable.
 * ================================================================================
 * ANSWERS: "what data can this app get, from whom, and is it working?"
 * NOT:     "what can be traded" (Broker Catalogue) or "which accounts do I hold" (Brokers).
 *
 * Data:
 *   GET /api/providers/health      — the provider registry: name, endpoint, credentials, status,
 *                                    last check, latency, and any adapter-declared feature notes
 *   GET /api/providers/mt5/accounts — only to name the SOURCES an MT5 bridge supplies
 *
 * ⚠️ MT5 IS A VENDOR HERE, ON PURPOSE (owner, 2026-11-06): *"MT5 and Pepperstone MT5 can be factored
 * into the Vendors page as the aim will be to list sources of data basically."* A broker is also a
 * data feed — it is where prices and account state come from — so the list is "where does data come
 * from", not "which API keys do I have". The ACCOUNTS behind MT5 are named beneath it, which is how
 * `PepperstoneUK-Demo` appears as a source without inventing a second fake provider row.
 *
 * ⚠️ NOTHING HERE IS HARDCODED. The rows come from the registry, so a new adapter appears the moment
 * it registers. `.github/instructions/external-systems-are-data.instructions.md`.
 *
 * ⚠️ `unknown` IS NOT `healthy`, and `missing-credentials` is not `down` — three different facts, and
 * the status chip says which. A credentials-less provider that needs no key (Binance market data)
 * reports `message` explaining that, and the page shows the message rather than a red badge.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import EmptyState from '../components/EmptyState';
import PageInfoPopover from '../components/PageInfoPopover';
import styles from './accounts.module.css';

const REFRESH_MS = 60_000;

/** Tone per registry status. `unknown` is deliberately NEUTRAL — see the header note. */
const STATUS_TONE = {
  healthy: styles.chipOk,
  degraded: styles.chipWarn,
  down: styles.chipBad,
  'missing-credentials': styles.chipWarn,
  unknown: styles.chipNeutral,
};

const fmtWhen = (iso) => {
  if (!iso) return 'never';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'never';
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
};

export default function VendorsPage() {
  const healthQuery = useQuery({
    queryKey: ['vendors-health'],
    queryFn: () => apiGet('/api/providers/health'),
    refetchInterval: REFRESH_MS,
  });

  // Only used to name what the MT5 bridge supplies. A failure here leaves the MT5 row without its
  // sub-sources — it must not blank the vendor list, so `null` is an acceptable outcome.
  const accountsQuery = useQuery({
    queryKey: ['brokers-accounts'],
    queryFn: () => apiGet('/api/providers/mt5/accounts').catch(() => null),
    refetchInterval: 120_000,
  });

  const providers = useMemo(() => {
    const rows = healthQuery.data?.providers;
    return Array.isArray(rows) ? rows : [];
  }, [healthQuery.data]);

  const activeProvider = healthQuery.data?.activeProvider || null;

  /** Distinct broker servers the MT5 bridge trades against — the actual "sources" behind MT5. */
  const mt5Sources = useMemo(() => {
    const rows = accountsQuery.data?.accounts;
    if (!Array.isArray(rows)) return [];
    return [...new Set(rows.map((a) => a.server).filter(Boolean))];
  }, [accountsQuery.data]);

  const tally = useMemo(() => ({
    total: providers.length,
    healthy: providers.filter((p) => p.status === 'healthy').length,
    withCreds: providers.filter((p) => p.credentialsConfigured).length,
  }), [providers]);

  if (healthQuery.isLoading) {
    return <div className={styles.page}><LoadingSkeleton variant="card" count={2} /></div>;
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>Vendors
          <PageInfoPopover label="About this page">
            Every source of data this app can draw on — market data, news, fundamentals and the
            brokers themselves — with the credentials state and the last health check each one
            reported.
            <br /><br />
            <strong>A broker is a data feed too.</strong> MT5 appears here because prices and account
            state come through it; the servers it supplies (for example a Pepperstone demo) are named
            underneath it. What can be <em>traded</em> is on Broker Catalogue, and the accounts you
            hold are on <strong>Brokers</strong>.
            <br /><br />
            <strong>“unknown” is not “healthy”.</strong> It means no health check has run yet, which
            is a different fact from a failure.
          </PageInfoPopover>
        </h1>
      </header>

      {healthQuery.isError && (
        <EmptyState
          icon="⚠️"
          title="Unable to load vendors"
          description="The request to GET /api/providers/health failed. This is a failed read, NOT an empty vendor list — no provider has been removed. Check the API is running."
        />
      )}

      {!healthQuery.isError && providers.length === 0 && (
        <EmptyState
          icon="🔌"
          title="No vendors registered"
          description="The API answered with no providers. That is an empty registry, not a failure — an adapter registers itself when its module loads."
        />
      )}

      {!healthQuery.isError && providers.length > 0 && (
        <>
          <div className={styles.summaryBar}>
            <span><strong>{tally.total}</strong> vendors</span>
            <span><strong>{tally.healthy}</strong> healthy</span>
            <span><strong>{tally.withCreds}</strong> with credentials</span>
            {activeProvider && <span className={styles.activeNote}>active provider <strong>{activeProvider}</strong></span>}
            <span className={styles.summaryNote}>refreshes every {REFRESH_MS / 1000}s</span>
          </div>

          <div className={styles.tableWrap}>
            <table className="vd-table">
              <thead>
                <tr>
                  <th scope="col">Vendor</th>
                  <th scope="col">Endpoint</th>
                  <th scope="col">Credentials</th>
                  <th scope="col">Status</th>
                  <th scope="col">Last checked</th>
                  <th scope="col" className="num">Latency</th>
                  <th scope="col">What it reports</th>
                </tr>
              </thead>
              <tbody>
                {providers.map((p) => {
                  // Adapter-declared caveats (e.g. MT5 explaining that DXY is estimated from EURUSD)
                  // are FACTS ABOUT THE DATA, so they are shown rather than hidden in a tooltip.
                  const featureNotes = p.features && typeof p.features === 'object'
                    ? Object.values(p.features).filter((v) => typeof v === 'string')
                    : [];
                  return (
                    <tr key={p.provider}>
                      <td>
                        <span className={styles.vendorName}>
                          {p.displayName || p.provider}
                          {p.provider === activeProvider && <span className={styles.activeChip}>active</span>}
                        </span>
                        <span className={styles.providerId}>{p.provider}{p.adapterType ? ` · ${p.adapterType}` : ''}</span>
                        {p.provider === 'mt5' && mt5Sources.length > 0 && (
                          // The sources BEHIND the bridge, named from what the accounts report.
                          <span className={styles.subSources}>
                            supplies: {mt5Sources.join(' · ')}
                          </span>
                        )}
                      </td>
                      <td className={styles.mono} title={p.endpoint || ''}>{p.endpoint || '—'}</td>
                      <td>
                        <span className={`${styles.chip} ${p.credentialsConfigured ? styles.chipOk : styles.chipNeutral}`}>
                          {p.credentialsConfigured ? 'configured' : 'not configured'}
                        </span>
                      </td>
                      <td>
                        <span className={`${styles.chip} ${STATUS_TONE[p.status] || styles.chipNeutral}`}>
                          {p.status || 'unknown'}
                        </span>
                      </td>
                      <td className={styles.muted}>{fmtWhen(p.checkedAt)}</td>
                      <td className="num">
                        {p.latencyMs != null ? `${p.latencyMs} ms` : <span className={styles.muted}>—</span>}
                      </td>
                      <td className={styles.report}>
                        {p.message || <span className={styles.muted}>—</span>}
                        {featureNotes.map((note) => (
                          <span key={note} className={styles.featureNote}>{note}</span>
                        ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
