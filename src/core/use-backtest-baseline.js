/**
 * use-backtest-baseline — WHICH RUN IS "A", stored in the DATABASE (not the browser).
 * ==================================================================================
 *
 * *"'A' will also be the data from the backtest that the user indicates as an improvement … so that we
 * can mark the accepted change and then compare the following backtest to that new set of data."*
 *
 * The first version of this lived in `localStorage`, and its own docblock said why that was wrong: a
 * baseline died with a cache clear, and no other machine or agent could see which run was accepted. An
 * accepted reference is a DECISION ABOUT EVIDENCE, so it belongs with the runs it points at.
 *
 * ── WHERE IT LIVES NOW ────────────────────────────────────────────────────────────────────────
 * The settings key family `backtestBaseline` (declared in `settings-registry.ts`):
 *
 *     backtest.baseline.<scope>.runId       ← the accepted `backtestrun.id`
 *     backtest.baseline.<scope>.acceptedAt  ← when, so an old reference is not guessed from createdAt
 *
 * `scope` is a PROTOCOL SLUG, not a run id: two protocols score different directives against different
 * symbols, so their runs are not comparable. There is one baseline per scope, and accepting a run
 * REPLACES it — that is what "this is the new reference" means.
 *
 * ── THREE STATES, KEPT APART ON PURPOSE ─────────────────────────────────────────────────────
 * `absent`      no baseline was ever accepted (normal on a fresh protocol)
 * `invalid`     a row exists but the store cannot parse it — reported, never silently defaulted
 * `unreadable`  the request failed, so we do NOT know — this is not the same as "none", and the UI
 *               must not render it as one (the rule this repo keeps paying for)
 *
 * ── ONE-TIME MIGRATION ──────────────────────────────────────────────────────────────────────
 * Users who accepted a baseline in the browser before this change have it in `localStorage`. When the
 * server says `absent` and a local value exists, that value is promoted to the server once and the
 * local key is removed, so nothing the reader already accepted is lost.
 *
 * ── DECISION (2026-10-27, primary) ──
 * WHAT:      the accepted baseline is a SETTINGS KEY FAMILY (`backtest.baseline.<scope>.<field>` in
 *            `global_setting`), one baseline per protocol scope; accepting a run REPLACES it.
 * WHY:       it is a decision about evidence, so it must survive a browser cache clear and be visible
 *            to every machine and agent. `localStorage` did neither.
 * INSTEAD OF: an `isBaseline` column on `backtestrun` (the obvious design). Rejected because the
 *            marker would vanish with the run it marks, and a REVOKED run then reads as "never
 *            accepted" — a dangling id the UI can report and clear is the recoverable state.
 * REVERSE BY: adding `isBaseline` to `backtestrun`, backfilling from
 *            `SELECT * FROM global_setting WHERE key LIKE 'backtest.baseline.%.runId'`, then deleting
 *            those rows and this family from `settings-registry.ts`.
 * REGISTER:  docs/SETTLED-DECISIONS.md (row added 2026-10-27)
 * GUARD:     nest/src/common/settings/settings-clear.spec.ts + settings-family.spec.ts (family shape,
 *            undeclared-key refusal, single-key delete); the UI reports `unreadable` rather than
 *            "none" when the read fails.
 */
import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPut, apiDelete } from './api/client.js';

const SCOPE = (scope) => scope || 'all';
const RUN_ID_KEY = (scope) => `backtest.baseline.${SCOPE(scope)}.runId`;
const ACCEPTED_AT_KEY = (scope) => `backtest.baseline.${SCOPE(scope)}.acceptedAt`;

/** The pre-2026-10-27 browser store. Read once, migrated, then deleted. */
const LEGACY_KEY = (scope) => `bt.baseline.${SCOPE(scope)}`;

const familyPath = (key) => `/api/system/settings/registry/family?key=${encodeURIComponent(key)}`;
const memberPath = (key) => `/api/system/settings/registry/${encodeURIComponent(key)}`;

async function readMember(key) {
  const r = await apiGet(familyPath(key));
  // `source` is the honest answer and the caller keeps it: 'db' | 'absent' | 'invalid'.
  return { source: r?.source ?? 'absent', value: r?.value ?? null, error: r?.error ?? null };
}

export function useBacktestBaseline(scope) {
  const qc = useQueryClient();
  const queryKey = ['bt-baseline', SCOPE(scope)];

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      // ⚠️ LET THE FAILURE PROPAGATE. Catching it here would turn a transport failure into a
      // SUCCESSFUL query that react-query never retries — measured 2026-10-27: one request attempted
      // while the API restarted left the panel saying "could not be read" for the rest of the session,
      // with no retry. `isError` is what makes the state transient AND honest.
      const member = await readMember(RUN_ID_KEY(scope));
      return { runId: member.source === 'db' ? String(member.value) : null, source: member.source };
    },
    enabled: Boolean(scope),
    staleTime: 60_000,
  });

  const save = useMutation({
    mutationFn: async (runId) => {
      await apiPut(memberPath(RUN_ID_KEY(scope)), { value: runId });
      await apiPut(memberPath(ACCEPTED_AT_KEY(scope)), { value: new Date().toISOString() });
      return runId;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });

  const clear = useMutation({
    mutationFn: async () => {
      await apiDelete(memberPath(RUN_ID_KEY(scope)));
      await apiDelete(memberPath(ACCEPTED_AT_KEY(scope)));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });

  const data = query.data;
  const serverAbsent = data?.source === 'absent' && !data.runId;

  // One-time promotion of a browser baseline to the database. Runs at most once per scope per mount,
  // and only when the SERVER has none — a server value is never overwritten by a stale local one.
  useEffect(() => {
    if (!scope || !serverAbsent) return;
    let local = null;
    try {
      local = window.localStorage.getItem(LEGACY_KEY(scope));
    } catch {
      return;
    }
    if (!local) return;
    save.mutate(local, {
      onSuccess: () => {
        try {
          window.localStorage.removeItem(LEGACY_KEY(scope));
        } catch {
          /* the migration already succeeded; a leftover local key is harmless */
        }
      },
    });
    // `save` is a stable mutation object; `serverAbsent` is the condition that makes it safe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, serverAbsent]);

  return {
    runId: data?.runId ?? null,
    /**
     * 'db' | 'absent' | 'invalid' | 'unreadable' | 'loading' — the UI renders these differently.
     * ⚠️ `unreadable` is derived from the QUERY FAILING, not from the payload, so "we do not know" can
     * never be mistaken for "nothing is accepted".
     */
    source: query.isLoading
      ? 'loading'
      : query.isError
        ? 'unreadable'
        : (data?.source ?? 'unreadable'),
    accept: (runId) => save.mutate(runId),
    clear: () => clear.mutate(),
    saving: save.isPending || clear.isPending,
    error: save.error ?? clear.error ?? query.error ?? null,
  };
}
