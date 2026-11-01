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
import { apiGet, apiPatch, apiPost, apiDelete } from '../../core/api/client.js';
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
  /**
   * One row per DIRECTIVE, not per instance (#1165).
   *
   * ⚠️ MEASURED 2026-11-01: a group that holds two instances of one directive listed its id twice, so
   * the maxScore table rendered two `<tr>` with the same React key — which React reports and then
   * behaves unpredictably around. `maxScore` is a per-DIRECTIVE value (`directive-config` reports one
   * per directive), so a second row would have offered the same control twice and implied two weights.
   */
  const uniqueIds = (list) => [...new Set((list ?? []).map((d) => d.id))];
  const grouped = groups.length > 0
    ? groups.map((g) => ({ name: g.name, weight: g.weight, risk: g.isRiskGate, ids: uniqueIds(g.directives) }))
    : [{ name: 'All directives', weight: null, risk: false, ids: uniqueIds((cfg.data.directives ?? []).map((d) => ({ id: d.id }))) }];

  const descriptions = new Map();
  for (const g of groups) for (const d of g.directives ?? []) descriptions.set(d.id, d.description ?? '');

  /**
   * Every CONFIGURED INSTANCE per directive, in group order (#1165).
   *
   * `layout` is the only source of instances — `directive-config` reports one effective maxScore per
   * directive and knows nothing about how many configurations exist. A directive with a single entry
   * has one item here with `instanceLabel: ''`; that is the primary, and it is what every protocol had
   * before instances were possible.
   */
  const instancesByDirective = new Map();
  for (const g of groups) {
    for (const d of g.directives ?? []) {
      const list = instancesByDirective.get(d.id) ?? [];
      list.push(d);
      instancesByDirective.set(d.id, list);
    }
  }
  // Only directives that DECLARE params. A directive with none has nothing to tune, and rendering an
  // empty form for it would imply a control that does not exist.
  const tunable = [...instancesByDirective.entries()].filter(
    ([, list]) => (list[0]?.paramSpec ?? []).length > 0,
  );

  const save = async (directiveId, raw) => {    const value = String(raw).trim();
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

      {/* ── TUNING & INSTANCES (#1165) ─────────────────────────────────────────────────────────
          Owner direction 2026-11-01: *"Do the wiring"* — the instance control on the Configure
          Directives surface. Every number below is a `params` value stored on
          `protocol_directive_entry` and READ by the scorer (unlike the maxScore field above, which the
          engine ignores for scoring). A directive may hold several CONFIGURATIONS; they are AVERAGED
          into one directive slot, so adding one changes the view and never the protocol's capacity —
          which is why the panel says so, and why it is not a weight control. */}
      {tunable.length > 0 && (
        <section className="dp-group">
          <h4 className="dp-group-head">
            Parameters &amp; instances
            <span className="dp-count">· {tunable.length} tunable directive(s)</span>
          </h4>
          <p className="pb-field-note">
            Each field below is stored on this protocol&apos;s own entry and <strong>is read by the
            scorer</strong>. Leave a field at its default and the directive behaves exactly as it did
            before anyone tuned it.
          </p>
          {tunable.map(([directiveId, list]) => (
            <TunableDirective
              key={directiveId}
              protocolSlug={protocolSlug}
              directiveId={directiveId}
              name={list[0].name ?? directiveId}
              instances={list}
              onChanged={async () => {
                await qc.invalidateQueries({ queryKey: ['protocol-directives', protocolSlug] });
                // The SCORE is served from the scorer's own config cache, which the PATCH/POST/DELETE
                // endpoint clears — but the breakdown a reader looks at is a stored snapshot, so the
                // directive-config query is refreshed too. Without both, a saved value reads as inert.
                await qc.invalidateQueries({ queryKey: ['directive-config', protocolSlug] });
              }}
            />
          ))}
        </section>
      )}

      <p className="pb-field-note">
        ⚠️ <strong>Only <code>maxScore</code> uses the precedence above.</strong> A directive&apos;s
        internal numbers are its own <code>params</code> — stored per protocol entry and read by the
        scorer (#1165), so they are edited in the section above rather than in that table. A directive
        that declares none has nothing to tune; that is a fact about the directive, not a missing form.
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

/**
 * TunableDirective — one directive's parameters and configured instances (#1165).
 * ================================================================================
 * A `<details>` rather than JS state: it is keyboard-operable and screen-reader-announced by the
 * browser (expand/collapse is native), so there is no `aria-expanded` to keep in sync and nothing to
 * get wrong. Collapsed by default because a protocol can hold 40+ directives and only a handful are
 * tunable in any one session.
 *
 * ⚠️ WHY THIS IS NOT A WEIGHT CONTROL. Instances are AVERAGED into a single directive slot by
 * `DirectivesService.runAll`, so adding one changes WHICH view of the directive the protocol reads and
 * never its configured capacity. Presenting "add instance" as anything that increases influence would
 * be a lie the arithmetic does not support.
 */
function TunableDirective({ protocolSlug, directiveId, name, instances, onChanged }) {
  const spec = instances[0]?.paramSpec ?? [];
  const named = instances.filter((i) => (i.instanceLabel ?? '') !== '');
  const summary =
    named.length === 0
      ? 'primary only'
      : `${instances.length} instances averaged into one slot`;

  return (
    <details className="dp-tune">
      <summary className="dp-tune-head">
        <strong>{name}</strong>
        <span className="dp-count">{summary}</span>
      </summary>
      <div className="dp-tune-body">
        {instances.map((inst) => (
          <InstanceEditor
            key={inst.entryId ?? `${directiveId}:${inst.instanceLabel}`}
            protocolSlug={protocolSlug}
            directiveId={directiveId}
            instance={inst}
            spec={spec}
            onChanged={onChanged}
          />
        ))}
        <AddInstance
          protocolSlug={protocolSlug}
          directiveId={directiveId}
          spec={spec}
          from={instances[0]?.params ?? null}
          onChanged={onChanged}
        />
      </div>
    </details>
  );
}

/** The values an instance currently runs with — stored params over the declared defaults. */
function valuesFor(spec, stored) {
  const out = {};
  for (const s of spec) {
    const v = stored?.[s.key];
    out[s.key] = v === undefined || v === null ? s.default : v;
  }
  return out;
}

/** Turn the draft (strings from inputs) into the numbers the API validates. */
function numericDraft(spec, draft) {
  const out = {};
  for (const s of spec) {
    const raw = draft[s.key];
    if (raw === '' || raw === undefined || raw === null) continue;
    out[s.key] = s.type === 'boolean' ? Boolean(raw) : Number(raw);
  }
  return out;
}

/**
 * The draft reduced to what is DELIBERATELY tuned — a value equal to the declared default is dropped.
 *
 * ⚠️ WHY THIS MATTERS. Sending every field stores the default explicitly, which pins it: a later
 * improvement to that default would silently not apply to this protocol, and the row would say
 * "tuned" when the user never changed anything. Measured 2026-11-01 — the first version of this form
 * wrote `{"bbPeriod": 30, "squeezeLookback": 50}` where only `bbPeriod` had been edited.
 *
 * An empty result means "nothing tuned", which the caller sends as `null` — the declared defaults.
 */
function tunedOnly(spec, draft) {
  const all = numericDraft(spec, draft);
  const out = {};
  for (const [key, value] of Object.entries(all)) {
    const declared = spec.find((s) => s.key === key)?.default;
    if (String(value) !== String(declared)) out[key] = value;
  }
  return out;
}

function ParamFields({ spec, draft, setDraft, disabled, idPrefix }) {
  return (
    <>
      {spec.map((s) => (
        <label className="dp-param" key={s.key} htmlFor={`${idPrefix}-${s.key}`}>
          <span className="dp-param-label">{s.label ?? s.key}</span>
          <input
            id={`${idPrefix}-${s.key}`}
            className="dp-input"
            type="number"
            min={s.min}
            max={s.max}
            step={s.step ?? 'any'}
            value={draft[s.key] ?? ''}
            disabled={disabled}
            onChange={(e) => setDraft({ ...draft, [s.key]: e.target.value })}
          />
          <span className="dp-hint">
            {s.unit ? `${s.unit} · ` : ''}
            {s.min}–{s.max}
            {s.chart === 'none' ? ' · no chart yet' : ''}
          </span>
        </label>
      ))}
    </>
  );
}

/**
 * InstanceEditor — one configured configuration of a directive.
 *
 * `params: null` on save means "back to the declared defaults", which is what "Reset to defaults"
 * writes. Only a NAMED instance can be removed: removing the primary would remove the directive from
 * the protocol entirely, and that is the other control's job.
 */
function InstanceEditor({ protocolSlug, directiveId, instance, spec, onChanged }) {
  const label = instance.instanceLabel ?? '';
  const [draft, setDraft] = useState(() => valuesFor(spec, instance.params));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const stored = valuesFor(spec, instance.params);
  const dirty = spec.some((s) => String(draft[s.key] ?? '') !== String(stored[s.key] ?? ''));

  const write = async (params) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await apiPatch(
        `/api/scoring/protocols/${encodeURIComponent(protocolSlug)}/directives/${encodeURIComponent(directiveId)}`,
        { instanceLabel: label, params },
      );
      await onChanged?.();
      setNotice(
        params === null
          ? `${label || 'primary'} reset to the directive's declared defaults.`
          : `${label || 'primary'} saved — the next score uses these values.`,
      );
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await apiDelete(
        `/api/scoring/protocols/${encodeURIComponent(protocolSlug)}/directives/${encodeURIComponent(directiveId)}` +
          `?instanceLabel=${encodeURIComponent(label)}`,
      );
      await onChanged?.();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const idPrefix = `dp-${directiveId}-${label || 'primary'}`;

  return (
    <div className="dp-inst">
      <div className="dp-inst-head">
        <span className="dp-badge">{label || 'primary'}</span>
        {instance.params && <span className="dp-count">tuned</span>}
        {label && (
          <button type="button" className="dp-btn dp-btn--danger" disabled={busy} onClick={remove}>
            Remove
          </button>
        )}
      </div>

      <div className="dp-params">
        <ParamFields spec={spec} draft={draft} setDraft={setDraft} disabled={busy} idPrefix={idPrefix} />
      </div>

      <div className="dp-inst-actions">
        <button
          type="button"
          className="dp-btn"
          disabled={busy || !dirty}
          onClick={() => {
            const tuned = tunedOnly(spec, draft);
            write(Object.keys(tuned).length > 0 ? tuned : null);
          }}
        >
          {busy ? 'Saving…' : `Save ${label || 'primary'}`}
        </button>
        <button
          type="button"
          className="dp-btn dp-btn--ghost"
          disabled={busy || !instance.params}
          onClick={() => {
            setDraft(valuesFor(spec, null));
            write(null);
          }}
          title="Store nothing for this instance, so the directive's declared defaults apply"
        >
          Reset to defaults
        </button>
      </div>

      {error && (
        <div>
          <NoticeBlock notice={noticeFromError(error)} compact />
          <p className="dp-hint">Nothing was changed.</p>
        </div>
      )}
      {notice && <p className="dp-ok" role="status">{notice}</p>}
    </div>
  );
}

/**
 * AddInstance — a SECOND configuration of a directive already in the protocol.
 *
 * The label is required and non-empty: `''` is the PRIMARY instance and already exists, so an empty
 * label would be an attempt at a second primary — which the database refuses with a raw constraint
 * error. The form asks for values at the same time because an instance configured IDENTICALLY to the
 * primary is refused: averaging makes a duplicate a silent halving of that directive's weight, not a
 * no-op, and the backend says so in words.
 */
function AddInstance({ protocolSlug, directiveId, spec, from, onChanged }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [draft, setDraft] = useState(() => valuesFor(spec, from));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (!open) {
    return (
      <button type="button" className="dp-btn dp-btn--ghost" onClick={() => setOpen(true)}>
        + Add a second configuration
      </button>
    );
  }

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const tuned = tunedOnly(spec, draft);
      await apiPost(
        `/api/scoring/protocols/${encodeURIComponent(protocolSlug)}/directives/${encodeURIComponent(directiveId)}/instances`,
        // `null`, not `{}`: an instance that tunes nothing IS an identical instance, and the backend
        // refuses those (averaging would silently halve the directive's weight). Sending `{}` would
        // slip past that comparison because `{}` and `null` are different values but the same
        // behaviour.
        { instanceLabel: label.trim(), params: Object.keys(tuned).length > 0 ? tuned : null },
      );
      await onChanged?.();
      setOpen(false);
      setLabel('');
      setDraft(valuesFor(spec, from));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="dp-add" onSubmit={submit}>
      <p className="dp-hint">
        A second configuration is scored on the same bars and <strong>averaged</strong> with the
        existing one — it changes what this directive reports, not how much it influences the protocol.
      </p>
      <label className="dp-param" htmlFor={`dp-new-${directiveId}-label`}>
        <span className="dp-param-label">Name this configuration</span>
        <input
          id={`dp-new-${directiveId}-label`}
          className="dp-input dp-input--wide"
          type="text"
          required
          maxLength={60}
          value={label}
          placeholder="fast, slow, period-9…"
          disabled={busy}
          onChange={(e) => setLabel(e.target.value)}
        />
        <span className="dp-hint">Required — it is how you tell the two apart.</span>
      </label>

      <div className="dp-params">
        <ParamFields
          spec={spec}
          draft={draft}
          setDraft={setDraft}
          disabled={busy}
          idPrefix={`dp-new-${directiveId}`}
        />
      </div>

      <div className="dp-inst-actions">
        <button type="submit" className="dp-btn" disabled={busy || !label.trim()}>
          {busy ? 'Adding…' : 'Add configuration'}
        </button>
        <button
          type="button"
          className="dp-btn dp-btn--ghost"
          disabled={busy}
          onClick={() => { setOpen(false); setError(null); }}
        >
          Cancel
        </button>
      </div>

      {error && (
        <div>
          <NoticeBlock notice={noticeFromError(error)} compact />
          <p className="dp-hint">No configuration was added.</p>
        </div>
      )}
    </form>
  );
}
