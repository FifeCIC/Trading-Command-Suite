/**
 * DirectiveSettingsPanel — step 4 of **Backtesting Protocols** (owner direction, 2026-10-27).
 * =============================================================================================
 *
 * *"This step should be replaced (on the Backtesting Protocols view only) with a list of directives
 * in the protocol and the settings for those directives offered in fields for editing. Remember,
 * this is to be done using the approach that stores the edited value as a custom per-protocol value,
 * it is not a global that changes the directive for all using protocols."*
 *
 * ── WHICH STORE THIS WRITES, AND WHY IT IS NOT THE OBVIOUS ONE ───────────────────────────────
 * There are TWO per-protocol stores in this codebase, and only ONE of them changes a score:
 *
 *   · `protocol_directive_entry.maxScore` — written by `PATCH :slug/directives/:directiveId`.
 *     ⚠️ It is NOT read by the scorer, and `GET :slug/directives` even prefers the directive CLASS's
 *     maxScore over it. A field bound to that would look like it worked and change nothing.
 *   · the settings family `protocol:<slug>:<directiveId>` — read by
 *     `ProtocolGatingService.resolveEffectiveMaxScores()` via `configService.getProtocolOverrides()`.
 *     **This is the one the score actually uses**, and it is what
 *     `PATCH :slug/directive-config` writes.
 *
 * So the panel reads and writes `/directive-config`, and shows the precedence the engine applies:
 * **protocol override → global config → directive class**.
 *
 * ⚠️ ONLY `maxScore` IS APPLIED PER PROTOCOL (#1133). The store accepts other fields; the scorer
 * ignores them. The endpoint already returns a `warning` naming anything it stored but did not
 * apply, and this panel renders it rather than dropping it — a control that changes nothing must
 * never be indistinguishable from one that did.
 *
 * ⚠️ AND THE SCOPE IS THE PROTOCOL, NOT THE RUN. Unlike an SL/TP override (which travels with one
 * run), this edits the stored protocol: every future backtest **and every live bot** using it scores
 * with the new value. The banner says so, because the same-looking field on the Strategies page has
 * the opposite scope.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPatch } from '../../core/api/client.js';
import NoticeBlock from '../NoticeBlock.jsx';
import { noticeFromError } from '../../core/notices/from-error.js';

const fmt = (v) => (v == null ? '—' : Number(v));

export default function DirectiveSettingsPanel({ protocolSlug }) {
  const qc = useQueryClient();
  const [saving, setSaving] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  /** The scorer-authoritative view: class → global → effective, and where the value came from. */
  const cfg = useQuery({
    queryKey: ['directive-config', protocolSlug],
    queryFn: () => apiGet(`/api/scoring/protocols/${encodeURIComponent(protocolSlug)}/directive-config`).catch(() => null),
    enabled: Boolean(protocolSlug),
    staleTime: 10_000,
  });

  /** Grouping + descriptions only — the VALUES come from `directive-config`, never from here. */
  const layout = useQuery({
    queryKey: ['protocol-directives', protocolSlug],
    queryFn: () => apiGet(`/api/scoring/protocols/${encodeURIComponent(protocolSlug)}/directives`).catch(() => null),
    enabled: Boolean(protocolSlug),
    staleTime: 60_000,
  });

  if (!protocolSlug) {
    return <p className="pb-none">Select a protocol in step 1 to see its directives.</p>;
  }
  if (cfg.isLoading) return <p className="pb-none">Loading this protocol&apos;s directives…</p>;
  if (cfg.isError || !cfg.data) {
    return (
      <p className="pb-none">
        ⚠️ The directive configuration did not load, so this is <strong>unknown</strong> — not
        &ldquo;no directives&rdquo;. Nothing here has been changed.
      </p>
    );
  }

  const byId = new Map((cfg.data.directives ?? []).map((d) => [d.id, d]));
  const groups = layout.data?.groups ?? [];
  const grouped = groups.length > 0
    ? groups.map((g) => ({ name: g.name, weight: g.weight, risk: g.isRiskGate, ids: (g.directives ?? []).map((d) => d.id) }))
    : [{ name: 'All directives', weight: null, risk: false, ids: [...byId.keys()] }];

  const descriptions = new Map();
  for (const g of groups) for (const d of g.directives ?? []) descriptions.set(d.id, d.description ?? '');

  const save = async (directiveId, raw) => {
    const value = String(raw).trim();
    setSaving(directiveId);
    setError(null);
    setNotice(null);
    try {
      const res = await apiPatch(
        `/api/scoring/protocols/${encodeURIComponent(protocolSlug)}/directive-config`,
        { directiveId, config: { maxScore: value === '' ? null : Number(value) } },
      );
      await qc.invalidateQueries({ queryKey: ['directive-config', protocolSlug] });
      if (res?.warning) setNotice({ kind: 'warn', text: res.warning });
      else {
        setNotice({
          kind: 'ok',
          text: `Saved ${directiveId} = ${value}. This is the protocol's own value — every run and bot using it now scores with it.`,
        });
      }
    } catch (e) {
      // ⚠️ THROUGH THE NOTICE REGISTRY, not a raw `err.message` (the `notices` build gate rejects a
      // surface that renders a server string directly — this component failed the build for exactly
      // that on 2026-10-27). The code and the "Why / Fix" lines come from the registry, so a failure
      // here looks like every other failure in the app.
      setError({ err: e, directiveId });
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="dp-panel">
      <p className="dp-scope" role="note">
        ⚠️ <strong>These edits belong to the PROTOCOL, not to this run.</strong> A saved value is used
        by every future backtest <em>and by every live bot</em> running this protocol. On the
        Strategies page the equivalent fields belong to a single run — the scope is the opposite, so
        read this line before typing.
      </p>

      <p className="pb-field-note">
        Precedence the engine applies: <strong>protocol override → global config → directive class</strong>.
        Total configured weight for this protocol:{' '}
        <strong>{fmt(cfg.data.totalWeight)}</strong>.
      </p>

      {error && (
        <div>
          <NoticeBlock notice={noticeFromError(error.err)} compact />
          <p className="dp-hint">
            Could not save <strong>{error.directiveId}</strong> — nothing was changed.
          </p>
        </div>
      )}
      {notice && <p className={notice.kind === 'warn' ? 'dp-warn' : 'dp-ok'} role="status">{notice.text}</p>}

      {grouped.map((g) => (
        <section key={g.name} className="dp-group">
          <h4 className="dp-group-head">
            {g.name}
            {g.weight != null && <span className="dp-group-weight">group weight {fmt(g.weight)}</span>}
            {g.risk && <span className="dp-badge dp-badge--risk">risk gate</span>}
          </h4>
          <table className="bt-table dp-table">
            <caption className="sr-only">Directives in {g.name} and their effective maxScore</caption>
            <thead>
              <tr>
                <th scope="col">Directive</th>
                <th scope="col">Class</th>
                <th scope="col">Global</th>
                <th scope="col">Effective</th>
                <th scope="col">Source</th>
                <th scope="col">This protocol</th>
              </tr>
            </thead>
            <tbody>
              {g.ids.map((id) => {
                const d = byId.get(id);
                if (!d) return null;
                return (
                  <tr key={id}>
                    <td>
                      <strong>{d.name}</strong>
                      {descriptions.get(id) && <div className="dp-desc">{descriptions.get(id)}</div>}
                    </td>
                    <td className="pb-mono">{fmt(d.classMaxScore)}</td>
                    <td className="pb-mono">{fmt(d.globalMaxScore)}</td>
                    <td className="pb-mono"><strong>{fmt(d.effectiveMaxScore)}</strong></td>
                    <td>
                      <span className={`dp-badge ${d.source === 'override' ? 'dp-badge--override' : ''}`}>
                        {d.source === 'override' ? 'protocol' : 'inherited'}
                      </span>
                    </td>
                    <td>
                      <input
                        className="dp-input"
                        type="number"
                        min="0"
                        step="1"
                        defaultValue={d.source === 'override' ? d.effectiveMaxScore : ''}
                        placeholder={String(d.effectiveMaxScore)}
                        disabled={saving === id}
                        onKeyDown={(e) => { if (e.key === 'Enter') save(id, e.currentTarget.value); }}
                        onBlur={(e) => {
                          const v = e.currentTarget.value;
                          // ⚠️ BLANK IS NOT "inherit" — there is no endpoint that removes a protocol
                          // override. Measured 2026-10-27: `PATCH {maxScore: null}` leaves the row in
                          // place and the config still reports `source: "override"`. So an empty field
                          // writes nothing rather than pretending to clear something it cannot.
                          if (v === '') return;
                          if (Number(v) === Number(d.effectiveMaxScore) && d.source === 'override') return;
                          save(id, v);
                        }}
                      />
                      <span className="dp-hint">
                        {saving === id
                          ? 'saving…'
                          : d.source === 'override'
                            ? 'protocol value'
                            : 'inherited — type to override'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ))}

      <p className="pb-field-note">
        ⚠️ <strong>Only <code>maxScore</code> is honoured per protocol</strong> (#1133). A directive&apos;s
        internal thresholds — the numbers its maths compares against — are constants in its TypeScript
        implementation, not stored values, so there is no field for them yet. That gap is why this
        table has one editable column and not several: a control that cannot change a score is worse
        than no control.
      </p>

      <p className="pb-field-note">
        ⚠️ <strong>There is no way to remove a protocol override from here.</strong> Measured
        2026-10-27: <code>{'PATCH {maxScore: null}'}</code> leaves the stored row in place, so clearing
        the field would be a request the backend silently ignores. To go back to the inherited value,
        type that value — the score will match, and the row will say <em>protocol</em> rather than
        <em>inherited</em>. Regression to a clean inherit needs a delete endpoint that does not exist.
      </p>
    </div>
  );
}
