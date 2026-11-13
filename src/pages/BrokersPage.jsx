/**
 * BrokersPage — the trading venues this app is connected to, and the accounts on them.
 * =====================================================================================
 * ANSWERS: "which brokers do I have, are they connected, and what is on them?"
 * NOT:     "what can a broker trade?" — that is `/status/broker-catalogue` (symbol classes and
 *          coverage). This page is about ACCOUNTS and MONEY, which is why it lives in the Accounts
 *          area rather than beside the catalogue.
 *
 * Data (real only — no fixtures; the app is single-instance against live bridges):
 *   GET /api/providers/mt5/accounts        — one row per account per bridge, with balance/equity
 *   GET /api/broker-symbols/summary        — per-broker symbol coverage and last sync
 *   GET /api/brokers/status                — live capability + connection state, per adapter id
 *
 * ── TWO KINDS OF BROKER NAME, AND ONLY ONE OF THEM IS DATA ────────────────────
 * ⚠️ `src/data/broker-catalogue.js` DOES hardcode broker names, regions, fee models and support
 * levels. That is correct and is not a breach of the rule below: those are REFERENCE FACTS about
 * venues a reader might sign up to, identical for every user of the app, and there is no external
 * system to ask. They are a directory, not a configuration.
 *
 * ⚠️ NO ACCOUNT-HOLDING BROKER NAME IS HARDCODED. `broker_config` has no list endpoint, so the
 * broker's NAME for the accounts section is derived from the `server` its accounts report (e.g.
 * `PepperstoneUK-Demo`). That is data the external system gave us, and it survives a new account
 * on a broker nobody has configured yet — which a constant map would not
 * (`.github/instructions/external-systems-are-data.instructions.md`).
 * The directory joins to live state by adapter id and NEVER invents a status for a venue TCS has
 * not wired: "not wired into TCS" is rendered, not guessed.
 *
 * ⚠️ THREE STATES, KEPT APART (the repo's most repeated defect is collapsing them):
 *   loading      → LoadingSkeleton
 *   failed read  → "could not load", explicitly NOT "no accounts"
 *   empty list   → "no accounts", which is information
 */
import { Fragment, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import EmptyState from '../components/EmptyState';
import PageInfoPopover from '../components/PageInfoPopover';
import {
  BROKER_CATALOGUE,
  BROKER_CATALOGUE_BY_ID,
  REGION_LABEL,
  TCS_SUPPORT,
  TCS_SUPPORT_LABEL,
} from '../data/broker-catalogue';
import styles from './accounts.module.css';

const REFRESH_MS = 30_000;

/** Relative age of a timestamp, so a stale sync is visible without arithmetic. */
const fmtWhen = (iso) => {
  if (!iso) return 'never';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 'never';
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
};

export default function BrokersPage() {
  const accountsQuery = useQuery({
    queryKey: ['brokers-accounts'],
    queryFn: () => apiGet('/api/providers/mt5/accounts'),
    refetchInterval: REFRESH_MS,
  });

  const coverageQuery = useQuery({
    queryKey: ['brokers-coverage'],
    // Enrichment, not the subject: a failure here must not blank the accounts table, so it is
    // allowed to resolve to `null` and the page renders without the coverage chips.
    queryFn: () => apiGet('/api/broker-symbols/summary').catch(() => null),
    refetchInterval: 120_000,
  });

  /**
   * Live broker capability + connection state, for the directory below.
   *
   * ⚠️ NOT `.catch(() => null)`. The directory must be able to say "live status could not be
   * loaded" — collapsing a failed read into an empty object would render every broker as
   * "not connected in TCS", which is the repo's most repeated defect: a failed query and a
   * real absence must never look the same.
   */
  const statusQuery = useQuery({
    queryKey: ['brokers-status'],
    queryFn: () => apiGet('/api/brokers/status'),
    refetchInterval: REFRESH_MS * 2,
    retry: 1,
  });

  /** catalogue (static reference) ⟕ live status, joined on adapter id. */
  const directory = useMemo(() => {
    const live = new Map((statusQuery.data?.brokers ?? []).map((b) => [b.id, b]));
    return BROKER_CATALOGUE.map((entry) => ({ entry, live: live.get(entry.id) ?? null }));
  }, [statusQuery.data]);

  const tradeableCount = useMemo(
    () => BROKER_CATALOGUE.filter((b) => b.tcsSupport === TCS_SUPPORT.TRADING).length,
    [],
  );

  const accounts = useMemo(() => {
    const rows = accountsQuery.data?.accounts;
    return Array.isArray(rows) ? rows : [];
  }, [accountsQuery.data]);

  /**
   * Which directory row holds which accounts.
   *
   * ⚠️ EVERY account currently comes from `GET /api/providers/mt5/accounts`, so all of them belong
   * to the `mt5` row. This is stated as an explicit map rather than "attach accounts to whichever
   * row looks like a broker": when a second broker gains an account endpoint (Capital.com, T212),
   * it MUST be added here deliberately. Guessing the owner would silently put one broker's money
   * under another broker's row — the exact class of error this page exists to prevent.
   */
  const accountsByDirectoryId = useMemo(() => ({ mt5: accounts }), [accounts]);

  // Expanded row ids. A Set, because the reader may have several open at once and the order they
  // opened them in is not information.
  const [expanded, setExpanded] = useState(() => new Set());

  const toggleRow = (id) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /**
   * Per-BRIDGE symbol coverage. This is the only figure that is per bridge rather than per broker,
   * so it is shown as its own strip instead of being attached to a broker heading it does not
   * describe. A failed read leaves it empty and the strips simply do not render.
   */
  const bridgeCoverage = useMemo(() => {
    const rows = coverageQuery.data?.brokers;
    return Array.isArray(rows) ? rows : [];
  }, [coverageQuery.data]);

  const totals = useMemo(() => {
    const connected = accounts.filter((a) => a.connected).length;
    const balance = accounts.reduce((sum, a) => sum + (typeof a.balance === 'number' ? a.balance : 0), 0);
    const equity = accounts.reduce((sum, a) => sum + (typeof a.equity === 'number' ? a.equity : 0), 0);
    return { connected, balance, equity };
  }, [accounts]);

  if (accountsQuery.isLoading) {
    return <div className={styles.page}><LoadingSkeleton variant="card" count={2} /></div>;
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>Brokers
          <PageInfoPopover label="About this page">
            The trading venues this app is connected to, and the accounts on them. One group per
            <strong> broker</strong> — the server the account reports (e.g. a Pepperstone demo) —
            because that is the venue your money sits on. A broker can be reachable over more than one
            bridge, so the bridge number is shown per account and summarised above the table.
            Balances are read from the broker, not calculated here.
            <br /><br />
            The <strong>Broker Directory</strong> above lists venues this app does not hold an
            account on yet, with what each one charges and how far TCS supports it. Regions were
            checked against each broker&apos;s own UK site; a fee shown as &quot;check the
            broker&quot; means the rate was not verified and is deliberately not guessed at.
            <br /><br />
            Looking for what a broker can TRADE (symbol coverage and classes)? That is the
            <strong> Broker Catalogue</strong> in the Status area. Registration details for each
            vendor, including MT5, are on <strong>Vendors</strong>.
          </PageInfoPopover>
        </h1>
      </header>

      {/* ── BROKER DIRECTORY ─────────────────────────────────────────────────────────────
          ONE table, ONE presentation. Every venue is a row and expanding a row is the ONLY way
          detail appears: fees, API depth, warnings, and the accounts held on that venue.

          ⚠️ WHY ACCORDIONS (owner instruction, 2026-11-13): this page used to show a directory
          table and then a separate stack of per-broker account sections further down. Two
          presentations of the same subject, and the second one was unreachable — a reader who
          sorted a column or filtered had no reason to scroll past the table. The detail now lives
          inside the row it belongs to, so it cannot be missed and there is nothing below the fold.

          ⚠️ The toggle is a real <button> with aria-expanded/aria-controls — Tab reaches it,
          Enter/Space operates it, and the state is announced. A clickable <tr> would need the same
          three attributes and still would not be focusable. */}
      <section className={styles.broker} aria-label="Broker directory">
        <div className={styles.brokerHead}>
          <h2 className={styles.brokerName}>Broker directory</h2>
          <span className={styles.brokerId}>
            {directory.length} venues · {tradeableCount} tradeable in TCS
          </span>
          <span className={styles.brokerId}>expand a row for accounts, fees and API</span>
          {statusQuery.isError && (
            <span className={`${styles.chip} ${styles.chipBad}`} title="GET /api/brokers/status failed">
              live status unavailable
            </span>
          )}
          {accountsQuery.isError && (
            // Surface the failure in the HEADER, not only inside the panel — otherwise a reader
            // who never expands MT5 sees a page that looks complete. Measured cause of this note:
            // the old page's error state was only reachable by scrolling.
            <span className={`${styles.chip} ${styles.chipBad}`} title="GET /api/providers/mt5/accounts failed">
              accounts unavailable
            </span>
          )}
        </div>

        <div className={styles.tableWrap}>
          <table className="brk-table">
            <thead>
              <tr>
                <th scope="col">Broker</th>
                <th scope="col">Regions</th>
                <th scope="col">Accounts</th>
                <th scope="col">TCS support</th>
                <th scope="col">Live status</th>
              </tr>
            </thead>
            <tbody>
              {directory.map(({ entry, live }) => {
                const held = accountsByDirectoryId[entry.id] ?? [];
                const open = expanded.has(entry.id);
                const panelId = `broker-panel-${entry.id}`;
                return (
                  <Fragment key={entry.id}>
                    <tr>
                      <th scope="row">
                        <button
                          type="button"
                          className={styles.rowToggle}
                          aria-expanded={open}
                          aria-controls={panelId}
                          onClick={() => toggleRow(entry.id)}
                        >
                          <span className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`} aria-hidden="true">
                            ▸
                          </span>
                          <span className={styles.toggleName}>{entry.name}</span>
                        </button>
                      </th>
                      <td>
                        {entry.regions.map((r) => (
                          <span key={r} className={`${styles.chip} ${styles.chipNeutral}`}>
                            {REGION_LABEL[r] ?? r}
                          </span>
                        ))}
                      </td>
                      <td>
                        {accountsQuery.isError ? (
                          <span className={styles.muted}>unknown</span>
                        ) : accountsQuery.isLoading ? (
                          <span className={styles.muted}>…</span>
                        ) : held.length > 0 ? (
                          <span className={styles.chip}>
                            {held.length} account{held.length === 1 ? '' : 's'}
                          </span>
                        ) : (
                          <span className={styles.muted}>—</span>
                        )}
                      </td>
                      <td>
                        <span
                          className={`${styles.chip} ${
                            entry.tcsSupport === TCS_SUPPORT.TRADING
                              ? styles.chipOk
                              : entry.tcsSupport === TCS_SUPPORT.PORTFOLIO
                                ? styles.chipNeutral
                                : styles.chipWarn
                          }`}
                        >
                          {TCS_SUPPORT_LABEL[entry.tcsSupport] ?? entry.tcsSupport}
                        </span>
                      </td>
                      <td>
                        {statusQuery.isError ? (
                          // Three states kept apart: a FAILED READ is not "not connected".
                          <span className={styles.muted}>unknown — read failed</span>
                        ) : statusQuery.isLoading ? (
                          <span className={styles.muted}>…</span>
                        ) : !live ? (
                          <span className={styles.muted}>not wired into TCS</span>
                        ) : (
                          <>
                            <span
                              className={`${styles.chip} ${
                                live.connection?.status === 'healthy' ? styles.chipOk : styles.chipNeutral
                              }`}
                            >
                              {live.connection?.observed ? live.connection.status : 'unobserved'}
                            </span>
                            {live.runtime?.canPlaceOrder === true && (
                              // ⚠️ CAPABILITY IS NOT PERMISSION. The adapter defining `placeOrder`
                              // says the METHOD exists; `tradingEnabled` says whether TCS will use
                              // it. Measured 2026-11-13: Trading 212 rendered "can place orders"
                              // beside its own note "order placement is gated off in TCS".
                              <span
                                className={`${styles.chip} ${
                                  live.runtime?.mockSuspect
                                    ? styles.chipWarn
                                    : live.tradingEnabled === true
                                      ? styles.chipOk
                                      : styles.chipWarn
                                }`}
                              >
                                {live.runtime?.mockSuspect
                                  ? 'orders = stub'
                                  : live.tradingEnabled === true
                                    ? 'can place orders'
                                    : 'orders gated off'}
                              </span>
                            )}
                            {live.runtime?.canModifyStop === true && (
                              <span className={`${styles.chip} ${styles.chipNeutral}`}>can move stops</span>
                            )}
                            {live.runtime?.canPlaceOrder !== true && (
                              // Registered but unable to trade (e.g. Binance: quotes only). Named so
                              // the cell does not read as "we don't know" when the answer is "read-only".
                              <span className={`${styles.chip} ${styles.chipNeutral}`}>read-only</span>
                            )}
                          </>
                        )}
                      </td>
                    </tr>

                    {open && (
                      <tr className={styles.panelRow}>
                        <td colSpan={5} id={panelId}>
                          <dl className={styles.panelGrid}>
                            <dt className={styles.panelTerm}>Fees</dt>
                            <dd className={styles.panelDef}>
                              {entry.feeModel}
                              {!entry.feesVerified && (
                                <span className={styles.panelNote}>
                                  check the broker — rate not verified here
                                </span>
                              )}
                            </dd>
                            <dt className={styles.panelTerm}>Trades</dt>
                            <dd className={styles.panelDef}>{entry.tradingTypes.join(', ')}</dd>
                            <dt className={styles.panelTerm}>API</dt>
                            <dd className={styles.panelDef}>
                              {entry.api}
                              {entry.apiNote && <span className={styles.panelNote}>{entry.apiNote}</span>}
                            </dd>
                            {entry.note && (
                              <>
                                <dt className={styles.panelTerm}>Note</dt>
                                <dd className={styles.panelDef}>{entry.note}</dd>
                              </>
                            )}
                            {entry.website && (
                              <>
                                <dt className={styles.panelTerm}>Website</dt>
                                <dd className={styles.panelDef}>
                                  <a href={entry.affiliateUrl || entry.website} target="_blank" rel="noreferrer noopener">
                                    {entry.website.replace(/^https?:\/\//, '')}
                                  </a>
                                </dd>
                              </>
                            )}
                          </dl>

                          {live?.warnings?.length > 0 && (
                            <ul className={styles.warnList}>
                              {live.warnings.map((w) => (
                                <li key={w}>{w}</li>
                              ))}
                            </ul>
                          )}

                          {held.length > 0 && (
                            <>
                              <h3 className={styles.panelSubHead}>
                                {held.length} account{held.length === 1 ? '' : 's'} · {totals.connected} connected
                                {' · '}balance {totals.balance.toFixed(2)} · equity {totals.equity.toFixed(2)}
                              </h3>
                              <p className={styles.panelNote}>
                                Balances are read from the broker, not calculated here. Refreshes every{' '}
                                {REFRESH_MS / 1000}s.
                              </p>

                              {bridgeCoverage.length > 0 && (
                                <div className={styles.bridgeRow}>
                                  {bridgeCoverage.map((b) => (
                                    <Fragment key={b.brokerId}>
                                      <span className={styles.bridgeName}>Bridge {b.brokerId}</span>
                                      <span className={styles.chip} title="Symbols this bridge reports the broker offers">
                                        {b.offered?.toLocaleString() ?? '—'} offered
                                      </span>
                                      <span className={styles.chip} title="Of those, symbols this app has onboarded">
                                        {b.onboarded?.toLocaleString() ?? '—'} onboarded
                                      </span>
                                      <span
                                        className={`${styles.chip} ${b.state === 'ok' ? styles.chipOk : styles.chipWarn}`}
                                        title={b.reason || 'Last symbol sync result'}
                                      >
                                        symbols {b.state || 'unknown'}
                                      </span>
                                      <span className={styles.muted}>last sync {fmtWhen(b.lastSuccessAt)}</span>
                                    </Fragment>
                                  ))}
                                </div>
                              )}

                              {/* ONE accounts table with the broker venue as a COLUMN, rather than one
                                  table per venue. Same columns for every account, so the reader compares
                                  like with like instead of re-learning a layout per heading. */}
                              <table className="brk-table">
                                <thead>
                                  <tr>
                                    <th scope="col">Venue</th>
                                    <th scope="col">Account</th>
                                    <th scope="col">Bridge</th>
                                    <th scope="col">Type</th>
                                    <th scope="col">Connection</th>
                                    <th scope="col">Role</th>
                                    <th scope="col" className="num">Balance</th>
                                    <th scope="col" className="num">Equity</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {held.map((a) => (
                                    // ⚠️ The key includes the bridge: the same LOGIN can be configured
                                    // on more than one bridge (measured 2026-11-06: login 10011309743
                                    // exists on brokers 2 and 3), so `a.login` alone is not unique.
                                    <tr key={`${a.brokerId}-${a.number}-${a.login}`}>
                                      <td>{a.server ?? '—'}</td>
                                      <td>
                                        <strong>{a.login || '—'}</strong>
                                        <span className={styles.accountNo}>#{a.number}</span>
                                      </td>
                                      <td>{a.brokerId ?? '—'}</td>
                                      <td>
                                        <span className={`${styles.chip} ${a.isLive ? styles.chipLive : styles.chipDemo}`}>
                                          {a.isLive ? 'LIVE' : 'demo'}
                                        </span>
                                      </td>
                                      <td>
                                        <span className={a.connected ? styles.dotOn : styles.dotOff} aria-hidden="true" />
                                        {a.connected ? 'connected' : 'not connected'}
                                      </td>
                                      <td>{a.active ? <strong>active</strong> : <span className={styles.muted}>standby</span>}</td>
                                      <td className="num">
                                        {typeof a.balance === 'number' ? a.balance.toFixed(2) : <span className={styles.muted}>—</span>}
                                      </td>
                                      <td className="num">
                                        {typeof a.equity === 'number' ? a.equity.toFixed(2) : <span className={styles.muted}>—</span>}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </>
                          )}

                          {entry.id === 'mt5' && accountsQuery.isError && (
                            <EmptyState
                              icon="⚠️"
                              title="Unable to load broker accounts"
                              description="The request to GET /api/providers/mt5/accounts failed. This is a failed read, NOT an empty account list — no broker has been disconnected by this. Check the API and the MT5 bridges are running."
                            />
                          )}
                          {entry.id === 'mt5' && !accountsQuery.isError && !accountsQuery.isLoading && held.length === 0 && (
                            <EmptyState
                              icon="🏛"
                              title="No broker accounts reported"
                              description="The broker bridges answered with no accounts. Add an account to a bridge's configuration and it will appear here."
                            />
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
