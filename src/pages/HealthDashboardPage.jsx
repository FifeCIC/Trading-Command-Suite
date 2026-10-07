import { useMemo } from 'react';
import { motion } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import ApiOfflineBanner from '../components/ApiOfflineBanner';
import './health-dashboard.css';
import PageInfoPopover from '../components/PageInfoPopover';
import { notice } from '../core/notices/registry';
import { noticeFromError } from '../core/notices/from-error.js';

// ── Helpers ──────────────────────────────────────────────

import { timeAgo, formatMs, formatMb, formatCount, formatDateTime } from '../core/format-utils';
const STATUS_EMOJI = { ok: '✅', warn: '⚠️', critical: '🔴' };
const PROVIDER_STATUS = { healthy: '🟢', degraded: '🟡', unhealthy: '🔴', unknown: '⚪' };
const METHOD_COLOR = { GET: '#22c55e', POST: '#3b82f6', PUT: '#f59e0b', DELETE: '#ef4444' };

// ── Section Components ───────────────────────────────────

function VitalsCard({ vitals }) {
  if (!vitals) return null;
  const memColor = vitals.memUsagePct > 85 ? 'var(--color-loss)' : vitals.memUsagePct > 65 ? 'var(--color-warning)' : 'var(--color-profit)';
  const cpuColor = vitals.cpuLoad1m > vitals.cpuCores * 0.8 ? 'var(--color-loss)' : 'var(--color-profit)';
  return (
    <div className="hd-vitals-grid">
      <div className="hd-card">
        <div className="hd-card-label">CPU Load</div>
        <div className="hd-card-value" style={{ color: cpuColor }}>{vitals.cpuLoad1m} / {vitals.cpuCores} cores</div>
        <div className="hd-card-sub">{vitals.cpuModel}</div>
      </div>
      <div className="hd-card">
        <div className="hd-card-label">Memory</div>
        <div className="hd-card-value" style={{ color: memColor }}>{vitals.memUsagePct}%</div>
        <div className="hd-card-sub">{vitals.memUsedGb} / {vitals.memTotalGb} GB</div>
      </div>
      <div className="hd-card">
        <div className="hd-card-label">Uptime</div>
        <div className="hd-card-value">{vitals.uptimeHours}h</div>
        <div className="hd-card-sub">Node {vitals.nodeVersion}</div>
      </div>
      <div className="hd-card">
        <div className="hd-card-label">Heap</div>
        <div className="hd-card-value">{vitals.heapUsedMb} MB</div>
        <div className="hd-card-sub">of {vitals.heapTotalMb} MB</div>
      </div>
      <div className="hd-card">
        <div className="hd-card-label">Platform</div>
        <div className="hd-card-value il-fs-075">{vitals.platform}</div>
        <div className="hd-card-sub">PID {vitals.pid}</div>
      </div>
    </div>
  );
}

function DbTableRow({ t }) {
  const statusIcon = STATUS_EMOJI[t.status] || '';
  return (
    <tr className={`hd-tr-${t.status}`}>
      <td className="hd-td-name">{statusIcon} {t.tableName}</td>
      <td className="hd-td-num">{formatCount(t.rowCount)}</td>
      <td className="hd-td-num">{formatMb(t.dataSizeMb)}</td>
      <td className="hd-td-num">{t.retentionDays ? `${t.retentionDays}d` : '—'}</td>
      <td className="hd-td-hint" title={t.hint}>{t.hint || '—'}</td>
    </tr>
  );
}

function ProviderChip({ p }) {
  const icon = PROVIDER_STATUS[p.status] || '⚪';
  return (
    <div className={`hd-provider-chip hd-provider-${p.status}`}>
      <span className="hd-provider-icon">{icon}</span>
      <span className="hd-provider-name">{p.provider}</span>
      <span className="hd-provider-latency">{p.latencyMs ? `${p.latencyMs}ms` : '—'}</span>
      {!p.credentialsOk && <span className="hd-provider-cred" title="Credentials invalid">🔑</span>}
      <span className="hd-provider-age">{timeAgo(p.checkedAt)}</span>
    </div>
  );
}

function TrendBar({ point, maxAvg }) {
  const pct = maxAvg > 0 ? (point.avgMs / maxAvg) * 100 : 0;
  const color = point.avgMs > 2000 ? 'var(--color-loss)' : point.avgMs > 500 ? 'var(--color-warning)' : 'var(--color-profit)';
  return (
    <div className="hd-trend-row">
      <span className="hd-trend-hour">{point.hour?.slice(11) || point.hour}</span>
      <div className="hd-trend-bar-wrap">
        <span className="hd-trend-bar" style={{ width: `${Math.min(pct, 100)}%`, background: color }} />
      </div>
      <span className="hd-trend-val" style={{ color }}>{point.avgMs}ms</span>
      <span className="hd-trend-count">{point.count}</span>
    </div>
  );
}

// ── Feed Freshness (#841) ────────────────────────────────

/**
 * FeedFreshnessSection — "STEP 3 of 3" in the stale-bar pipeline (see the sibling
 * handoff for the whole path). The sequence is:
 *
 *   STEP 1  bar-refresh.service.ts  refreshes bars and computes `starvedSymbols`
 *           from CADENCE_STALE_MS — the ONE owner of what "stale" means.
 *   STEP 2  signal-envelope.service.ts  refuses to score a symbol whose bars are
 *           stale on EVERY cadence (#827), so no `directiveoutcome` row is written.
 *   STEP 3  THIS component  tells a human which symbols have gone quiet.
 *
 * ⚠️ WHY STEP 3 IS NOT OPTIONAL. Steps 1 and 2 make the system *correct* — a stale
 * symbol is no longer scored, so no plausible-looking number is produced. But they
 * make it *silent*: the symbol simply stops appearing, and "no signal today" is
 * indistinguishable from "this symbol has had no data for six days". The data was
 * already computed and served; nothing rendered it. This is the buried-ability
 * pattern — the mechanism was correct and invisible.
 *
 * ⚠️ DO NOT RECOMPUTE STALENESS HERE. `ageHours` and the `starvedSymbols` list come
 * from the API, because `CADENCE_STALE_MS` in `nest/src/common/utils/timeframe.ts` is
 * the single owner of that threshold. A frontend threshold would drift from the
 * backend one and the two would disagree about the same symbol — the same class of
 * defect as the two bar-ordering bugs already fixed (#838).
 */
function StarvedSymbolRow({ s }) {
  // ⚠️ `newestBar === null` is NOT "very stale" — it means the symbol has NEVER
  // produced a bar. That is a routing/setup fault, while a timestamp with a large
  // `ageHours` is a provider that has gone quiet. Collapsing both into one "stale"
  // label sends someone hunting a feed outage when the real fault is a symbol that
  // was never wired to a provider at all. Hence two different notices, and the
  // backend deliberately serves the two shapes differently.
  const neverProduced = !s.newestBar;
  const n = notice(neverProduced ? 'TCS-DATA-002' : 'TCS-DATA-003', {
    symbol: s.ticker,
    hours: s.ageHours,
  });
  return (
    <tr className={neverProduced ? 'hd-tr-critical' : 'hd-tr-warn'}>
      <td className="hd-td-name" title={n.action}>{s.ticker}</td>
      <td className="hd-td-age">
        {neverProduced ? '—' : <span title={timeAgo(s.newestBar)}>{formatDateTime(s.newestBar)}</span>}
      </td>
      <td className="hd-td-num">{s.ageHours == null ? '—' : `${s.ageHours}h`}</td>
      <td className="hd-td-hint" title={n.cause}>{n.title}</td>
      <td className="hd-td-hint">
        {s.missingTimeframes?.length ? s.missingTimeframes.join(', ') : '—'}
      </td>
    </tr>
  );
}

function FeedFreshnessSection({ starved, error, totalScanned, isLoading }) {
  // ⚠️ FOUR distinct states, and three of them are NOT "all clear". The order below
  // is the whole point of the component:
  //   1. still loading            — unknown
  //   2. `error` non-null         — the QUERY failed, so an empty list would be a lie
  //   3. `starved` undefined      — the server has not computed it yet (it is cached)
  //   4. empty array              — genuinely nothing stale, the ONLY all-clear
  // An empty list and a failed query must never look the same; the backend exposes
  // `starvedSymbolsError` for exactly this reason (#761).
  if (isLoading) {
    return <span className="hd-empty" role="status">Checking which symbols are still producing bars…</span>;
  }

  if (error) {
    const n = notice('TCS-DATA-004', { detail: error, ref: 'starvedSymbolsError' });
    return (
      <div className="app-notice app-notice--critical" role="alert">
        <strong>{n.title}</strong>
        <span> {n.message}</span>
        {n.action && <div className="hd-td-hint">{n.action}</div>}
      </div>
    );
  }

  if (starved === undefined) {
    return (
      <span className="hd-empty" role="status">
        Not computed yet — the starvation check is cached and runs on the refresh tick.
      </span>
    );
  }

  if (starved.length === 0) {
    // Positive confirmation, NOT a blank panel. "No stale symbols" is information and
    // must be readable as such; a blank area reads as "the check did not run".
    const n = notice('TCS-DATA-006', { count: totalScanned ?? 0 });
    return <div className="hd-empty-ok" role="status">✅ {n.message}</div>;
  }

  const noData = starved.filter(s => !s.newestBar).length;
  const stopped = starved.length - noData;
  const agg = notice('TCS-DATA-005', { count: starved.length, noData, stopped });

  return (
    <>
      <div className="app-notice app-notice--warning" role="status">
        <strong>{agg.title}</strong>
        <span> {agg.message}</span>
        {agg.action && <div className="hd-td-hint">{agg.action}</div>}
      </div>
      <div className="hd-table-wrap">
        <table className="hd-table hd-table-sm">
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Newest bar</th>
              <th>Age</th>
              <th>Condition</th>
              <th>Missing timeframes</th>
            </tr>
          </thead>
          <tbody>
            {starved.map(s => <StarvedSymbolRow key={s.ticker} s={s} />)}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ── Main Page ────────────────────────────────────────────

export default function HealthDashboardPage() {
  const dashQuery = useQuery({
    queryKey: ['health-dashboard'],
    queryFn: () => apiGet('/api/system/health-dashboard'),
    refetchInterval: 15000,
  });

  // Separate endpoint, so a separate query. The starvation check is backed by a short
  // server-side cache (it is a diagnostic, not a hot path), so polling it faster than
  // the bar-refresh tick would only return the same cached rows.
  const feedQuery = useQuery({
    queryKey: ['bars-refresh-status'],
    queryFn: () => apiGet('/api/market-data/bars/refresh/status'),
    refetchInterval: 30000,
  });

  const data = dashQuery.data;
  const apiOnline = !dashQuery.isError;

  const maxAvgMs = useMemo(() => {
    if (!data?.apiTrends?.length) return 1;
    return Math.max(...data.apiTrends.map(p => p.avgMs), 1);
  }, [data?.apiTrends]);

  /**
   * downloadReport() — one file a developer can act on without asking a follow-up question.
   *
   * Owner request (Page Walkthrough, /status/health-check): *"Add report download for sending to
   * developer for troubleshooting."*
   *
   * ⚠️ IT CARRIES THE APP VERSION AND THE MOMENT OF READING. A report from an unknown build cannot be
   * matched to a fix or lined up against a log, so the identifiers are what make the numbers usable.
   *
   * ⚠️ `null` (the query failed) and `[]` (the section is genuinely empty) are kept as DIFFERENT
   * values. Collapsing them would destroy the exact distinction this page exists to make (§7 — an
   * empty list and a failed query must never render the same).
   */
  const downloadReport = async () => {
    const version = await apiGet('/api/version').catch(() => null);
    const snap = (q) => ({
      state: q.status,
      fetchedAt: q.dataUpdatedAt ? new Date(q.dataUpdatedAt).toISOString() : null,
      // ⚠️ #826 Phase 5 — A RAW `.message` IS NOT A REPORT FIELD.
      //
      // This was `String(q.error?.message || q.error)` — the last raw error render on this page,
      // and a standing red gate (`validate-notices.cjs`, which runs in prebuild). `noticeFromError()`
      // answers it properly: the server's own wording is ALWAYS preserved (as `detail` — the
      // adapter's docblock is explicit that the code "must never be the reason a specific broker
      // message is lost"), and the CODE is added beside it, which is what makes an entry here
      // joinable to a log line, the UI, or an issue — the reason this report exists at all.
      error: q.error ? noticeFromError(q.error) : null,
      data: q.data ?? null,
    });
    const report = {
      generatedAt: new Date().toISOString(),
      route: '/status/health-check',
      version,
      browser: {
        userAgent: navigator.userAgent,
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        language: navigator.language,
      },
      queries: {
        healthDashboard: snap(dashQuery),
        barsRefreshStatus: snap(feedQuery),
      },
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tcs-health-${report.generatedAt.replace(/[:.]/g, '-').slice(0, 19)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  if (dashQuery.isLoading) return <div className="hd-page"><LoadingSkeleton variant="card" count={4} /></div>;

  return (
    <div className="hd-page">
      <motion.header className="hd-header" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
        {/* ⚠️ THE ℹ POPOVER IS A SIBLING OF THE h1, NOT INSIDE IT (2026-10-06), and that is a fix.
            Measured: the shell injects `.main-stage h1 { display: none }` — the breadcrumb already
            names the page, so page-level h1s are hidden. A `PageInfoPopover` rendered INSIDE the h1 is
            therefore `display: none` as well: a control nobody can see or click. It measured 0×0 on
            this page while the same component measures 24×24 on `/research/screener`. Not introduced
            by this batch — found while checking a header change and worth keeping fixed. */}
        <h1>Health & Diagnostics</h1>
        <PageInfoPopover>
          System vitals, DB health, slow queries, API trends, provider status, and trace correlation — refreshed every 15s.
        </PageInfoPopover>
        <button
          type="button"
          className="hd-report-btn"
          onClick={downloadReport}
          title="Download every value on this page as JSON — stamped with the time, the app version and the browser — to send to a developer."
        >
          ⤓ Download report
        </button>
      </motion.header>

      {!apiOnline && <ApiOfflineBanner />}

      {/* ── 1. System Vitals ── */}
      <motion.section className="hd-section" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.04 }}>
        <h2 className="hd-section-title">💻 System Vitals</h2>
        <VitalsCard vitals={data?.vitals} />
      </motion.section>

      {/* ── 2. Provider Health Grid ── */}
      <motion.section className="hd-section" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}>
        <h2 className="hd-section-title">📡 Provider Health</h2>
        <div className="hd-provider-grid">
          {(data?.providerGrid || []).map(p => <ProviderChip key={p.provider} p={p} />)}
          {(!data?.providerGrid || data.providerGrid.length === 0) && <span className="hd-empty">No provider data</span>}
        </div>
      </motion.section>

      {/* ── 3. Feed Freshness ── */}
      <motion.section className="hd-section" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }}>
        <h2 className="hd-section-title">🛰️ Feed Freshness</h2>
        <p className="hd-td-hint">
          Symbols whose newest bar is outside their cadence tolerance. Stale symbols are not scored
          (#827), so without this they would simply vanish from the ladder — which reads as
          &ldquo;no signal&rdquo; rather than &ldquo;no data&rdquo;.
        </p>
        <FeedFreshnessSection
          starved={feedQuery.data?.starvedSymbols}
          error={feedQuery.data?.starvedSymbolsError}
          totalScanned={feedQuery.data?.lastSymbols}
          isLoading={feedQuery.isLoading}
        />
      </motion.section>

      {/* ── 4. API Trends ── */}
      <motion.section className="hd-section" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.16 }}>
        <h2 className="hd-section-title">📊 API Response Times (24h)</h2>
        <div className="hd-trend-chart">
          {(data?.apiTrends || []).slice(0, 24).map(p => <TrendBar key={p.hour} point={p} maxAvg={maxAvgMs} />)}
          {(!data?.apiTrends || data.apiTrends.length === 0) && <span className="hd-empty">No API trend data</span>}
        </div>
      </motion.section>

      {/* ── 5. DB Table Sizes ── */}
      <motion.section className="hd-section" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.20 }}>
        <h2 className="hd-section-title">🗄️ Database Tables vs Retention</h2>
        <div className="hd-table-wrap">
          <table className="hd-table">
            <thead>
              <tr>
                <th>Table</th>
                <th>Rows</th>
                <th>Size</th>
                <th>Retention</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {(data?.dbDiagnostics || []).map(t => <DbTableRow key={t.tableName} t={t} />)}
            </tbody>
          </table>
          {(!data?.dbDiagnostics || data.dbDiagnostics.length === 0) && <span className="hd-empty">No DB data</span>}
        </div>
      </motion.section>

      {/* ── 6. Slow Queries ── */}
      <motion.section className="hd-section" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.24 }}>
        <h2 className="hd-section-title">🐢 Slow Queries (&gt;1s)</h2>
        <div className="hd-table-wrap">
          <table className="hd-table hd-table-sm">
            <thead>
              <tr>
                <th>Endpoint</th>
                <th>Method</th>
                <th>Duration</th>
                <th>Status</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {(data?.slowQueries || []).map(q => (
                <tr key={q.id}>
                  <td className="hd-td-name" title={q.endpoint}>{q.endpoint?.slice(-60)}</td>
                  <td><span className="hd-method-badge" style={{ color: METHOD_COLOR[q.method] || '#94a3b8' }}>{q.method}</span></td>
                  <td className="hd-td-num" style={{ color: q.durationMs > 3000 ? 'var(--color-loss)' : 'var(--color-warning)' }}>{formatMs(q.durationMs)}</td>
                  <td className="hd-td-num">{q.statusCode}</td>
                  <td className="hd-td-age">{timeAgo(q.timestamp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {(!data?.slowQueries || data.slowQueries.length === 0) && <div className="hd-empty-ok">✅ No slow queries detected</div>}
        </div>
      </motion.section>

      {/* ── 7. Trace Correlations ── */}
      <motion.section className="hd-section" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.28 }}>
        <h2 className="hd-section-title">🔗 Trace Correlations (recent API traces)</h2>
        <div className="hd-table-wrap">
          <table className="hd-table hd-table-sm">
            <thead>
              <tr>
                <th>Cache Key</th>
                <th>URL</th>
                <th>Method</th>
                <th>Duration</th>
                <th>Cached</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {(data?.traceCorrelations || []).map(t => (
                <tr key={t.cacheKey + t.createdAt}>
                  <td className="hd-td-mono" title={t.cacheKey}>{t.cacheKey?.slice(0, 12)}…</td>
                  <td className="hd-td-name" title={t.url}>{t.url?.slice(-50)}</td>
                  <td><span className="hd-method-badge" style={{ color: METHOD_COLOR[t.method] || '#94a3b8' }}>{t.method}</span></td>
                  <td className="hd-td-num">{formatMs(t.durationMs)}</td>
                  <td>{t.cached ? '♻️' : '🆕'}</td>
                  <td className="hd-td-age">{timeAgo(t.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {(!data?.traceCorrelations || data.traceCorrelations.length === 0) && <span className="hd-empty">No trace data</span>}
        </div>
      </motion.section>

      <motion.footer className="hd-footer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.32 }}>
        Data fetched at {data?.fetchedAt ? new Date(data.fetchedAt).toLocaleTimeString() : '—'} · Auto-refresh 15s
      </motion.footer>
    </div>
  );
}
