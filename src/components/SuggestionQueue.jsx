/**
 * SuggestionQueue — the queued changes we intend to TRY, shown wherever they are needed.
 *
 * ── ONE COMPONENT, TWO PAGES, ON PURPOSE ─────────────────────────────────────────────────────────
 * Owner, 2026-11-18: *"Display the queued suggested changes on the protocols page… We will also
 * display that same information in the Strategies area on the strategies page so that at the end: the
 * combined suggestion changes to try for both protocol and bot are in one place."*
 *
 * ⚠️ If the Protocols page and the Strategies page each rendered their own list, the two would drift
 * and the reader would have to decide which one to believe — the same defect the repo records for
 * duplicated utilities. So there is ONE component, and the `scope` prop decides which slice it asks
 * the API for. Both read `GET /api/suggestions/protocol/:slug`, which returns the protocol's own rows
 * PLUS those of every bot subscribed to it.
 *
 * ── THREE THINGS IT REFUSES TO DO ────────────────────────────────────────────────────────────────
 *
 * 1. **It never says a change is applied.** `status` is a record of what someone did, not something
 *    this component performs. There is no "Apply" button.
 * 2. **It distinguishes a plan from a backlog.** A `missing-directive` row names a directive that does
 *    not exist yet. It is rendered as a placeholder with its issue link, never as a directive you could
 *    attach — because a directive that is selectable but scores nothing is the silent zero this repo
 *    designs against.
 * 3. **It reports a row with no issue.** `issueUrl: null` renders as an explicit "no issue" marker
 *    rather than an empty cell, because the issue is the durable record of *why* and its absence is
 *    information.
 */
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import NoticeBlock from './NoticeBlock';
import { noticeFromError } from '../core/notices/from-error.js';
import './suggestion-queue.css';

const STATUS_TONE = {
  queued: 'sq-chip--queued',
  accepted: 'sq-chip--accepted',
  applied: 'sq-chip--applied',
  rejected: 'sq-chip--rejected',
  blocked: 'sq-chip--blocked',
};

const KIND_LABEL = {
  'add-directive': 'Add directive',
  'remove-directive': 'Remove directive',
  'reweight-group': 'Reweight group',
  'missing-directive': 'Directive to build',
  param: 'Parameter',
  'bot-rule': 'Bot rule',
};

/** A missing directive is a PLACEHOLDER, not a suggestion to attach something. */
const isPlaceholder = (row) => row.kind === 'missing-directive';

export default function SuggestionQueue({ protocolSlug, botId = null, mode: explicitMode = null, title = 'Queued changes' }) {
  /**
   * Three modes, one component:
   *   protocolSlug        → this protocol PLUS its subscribing bots' rows  (Protocols page)
   *   botId               → one bot's rows                                 (a bot's own surface)
   *   mode="all"          → EVERYTHING queued, protocol and bot together   (Strategies page)
   *
   * ⚠️ "ALL" IS OPT-IN, AND THE FIRST VERSION OF THIS COMPONENT GOT THAT WRONG. It fell back to
   * showing every row whenever `protocolSlug` was falsy — so when the Protocols page passed an
   * undefined slug, the per-protocol panel rendered **all 22 rows** and looked like it was working.
   * That is the exact failure this repo keeps re-finding: a plausible render, no error, wrong data.
   * Measured in the browser on 2026-11-19 — `selectedProto.slug` did not exist (the payload's `id` IS
   * the slug) and nothing reported it.
   *
   * ⇒ Without a slug, a bot id, or an explicit `mode="all"`, this renders a REFUSAL that names the
   * problem. A list that cannot be scoped must not render as if it were scoped.
   */
  const mode = protocolSlug ? 'protocol' : botId ? 'bot' : explicitMode === 'all' ? 'all' : 'unscoped';
  const { data, isLoading, error } = useQuery({
    queryKey: ['suggestion-queue', mode, protocolSlug ?? null, botId ?? null],
    queryFn: () => {
      if (mode === 'protocol') return apiGet(`/api/suggestions/protocol/${encodeURIComponent(protocolSlug)}`);
      if (mode === 'bot') return apiGet(`/api/suggestions?botId=${encodeURIComponent(botId)}`);
      return apiGet('/api/suggestions');
    },
    enabled: mode !== 'unscoped',
    staleTime: 30_000,
  });

  if (mode === 'unscoped') {
    return (
      <section className="sq sq--blocked">
        <h3 className="sq-title">{title}</h3>
        <p className="sq-empty">
          🚫 <strong>Cannot show the queue for this item.</strong> No protocol slug and no bot id were
          supplied, so the list would be unscoped — showing everything here would look like this
          item&apos;s queue. Reported rather than rendered.
        </p>
      </section>
    );
  }

  if (error) {
    return (
      <NoticeBlock
        notice={noticeFromError(error, 'TCS-SYS-007', { operation: 'load the queued change suggestions' })}
      />
    );
  }

  // ⚠️ `null` is not `[]`. A payload that has not arrived must not render as "nothing queued" —
  // that would report a failed read as a satisfied queue.
  const rows = mode === 'protocol'
    ? [...(data?.protocol ?? []), ...(data?.bots ?? [])]
    : (data?.suggestions ?? []);
  const coverage = data?.coverage;
  const loaded = Boolean(data);

  return (
    <section className="sq" aria-labelledby="sq-heading">
      <header className="sq-head">
        <h3 id="sq-heading" className="sq-title">{title}</h3>
        {loaded && coverage && (
          <p className="sq-counts">
            <span><strong>{coverage.byStatus?.queued ?? 0}</strong> queued</span>
            <span><strong>{coverage.missingDirectives ?? 0}</strong> to build</span>
            {coverage.withoutIssue > 0 && (
              <span className="sq-warn"><strong>{coverage.withoutIssue}</strong> with no issue</span>
            )}
          </p>
        )}
      </header>

      {isLoading && <p className="sq-empty">Loading the queue…</p>}

      {loaded && rows.length === 0 && (
        <p className="sq-empty">
          Nothing queued. Suggestions added through <code>POST /api/suggestions</code> appear here.
        </p>
      )}

      {loaded && rows.length > 0 && (
        <ul className="sq-list">
          {rows.map((row) => (
            <li key={row.id} className={`sq-row${isPlaceholder(row) ? ' sq-row--missing' : ''}`}>
              <span className={`sq-chip ${STATUS_TONE[row.status] ?? 'sq-chip--queued'}`}>
                {row.status}
              </span>

              <div className="sq-body">
                <p className="sq-line">
                  <strong className="sq-kind">{KIND_LABEL[row.kind] ?? row.kind}</strong>
                  {row.targetKey && <code className="sq-target">{row.targetKey}</code>}
                  {row.scope === 'bot' && <span className="sq-scope">on bot</span>}
                  {row.scope === 'protocol' && <span className="sq-scope">on protocol</span>}
                </p>

                <p className="sq-rationale">{row.rationale}</p>

                {/* ⚠️ `null` here means "does not exist yet", which is a different fact from 0. */}
                <p className="sq-values">
                  <span className="sq-value-label">now</span>
                  <span className="sq-value">{row.currentValue ?? 'does not exist yet'}</span>
                  <span className="sq-arrow" aria-hidden="true">→</span>
                  <span className="sq-value-label">proposed</span>
                  <span className="sq-value">{row.suggestedValue ?? '—'}</span>
                </p>
              </div>

              <div className="sq-links">
                {row.issueUrl
                  ? (
                    <a className="sq-issue" href={row.issueUrl} target="_blank" rel="noreferrer">
                      issue
                    </a>
                  )
                  : <span className="sq-noissue" title="No issue yet — the reasoning has no durable home">no issue</span>}
                <span className="sq-priority" title="1 = do first">P{row.priority}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
