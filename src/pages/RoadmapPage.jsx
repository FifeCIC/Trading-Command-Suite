/**
 * RoadmapPage — dynamic roadmap (epic #681, Phase D).
 * ====================================================
 * TCS adapter over the portable RoadmapBoard: loads the merged board
 * from GET /api/roadmap, persists moves/renames/sprint columns via the
 * roadmap module, and opens cards as GitHub issues.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import RoadmapBoard from '../components/roadmap/RoadmapBoard';
import { apiGet, apiPatch, apiPost } from '../core/api/client';
import { applyMove } from '../core/roadmap/roadmap-core';
import './roadmap-page.css';

const GITHUB_ISSUE_URL = 'https://github.com/FifeCIC/Trading-Command-Suite/issues';

export default function RoadmapPage() {
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['roadmap'],
    queryFn: () => apiGet('/api/roadmap').catch(() => null),
    refetchInterval: 120_000,
  });
  const board = data || { columns: [], cards: [] };

  // ── Filters (2026-09-02) ─────────────────────────────────────────
  const [statusFilter, setStatusFilter] = useState('open'); // 'open' | 'closed'
  const [showLastClosed, setShowLastClosed] = useState(true);
  const [sortMode, setSortMode] = useState('priority'); // 'priority' | 'number'
  const [search, setSearch] = useState('');

  const sortFn = (a, b) =>
    sortMode === 'number' ? a.number - b.number : (a.position ?? 0) - (b.position ?? 0);

  const visibleCards = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matches = board.cards.filter((c) => {
      if (!q) return true;
      return String(c.number).includes(q) || (c.title || '').toLowerCase().includes(q);
    });

    if (statusFilter === 'closed') {
      return matches.filter((c) => c.state === 'closed');
    }

    const open = matches.filter((c) => c.state !== 'closed');
    if (!showLastClosed) return open;

    // Most recently closed card per column (search-matched).
    const lastClosedByCol = new Map();
    for (const c of matches) {
      if (c.state !== 'closed') continue;
      const prev = lastClosedByCol.get(c.columnId);
      const t = (x) => new Date(x.closedAt || x.updatedAt || 0).getTime();
      if (!prev || t(c) > t(prev)) lastClosedByCol.set(c.columnId, c);
    }
    return [...open, ...[...lastClosedByCol.values()].map((c) => ({ ...c, isLastClosed: true }))];
  }, [board.cards, statusFilter, showLastClosed, search]);

  const moveMutation = useMutation({
    mutationFn: ({ number, columnId, targetIndex }) =>
      apiPost(`/api/roadmap/cards/${number}/move`, { columnId, targetIndex }),
    onMutate: async ({ number, columnId, targetIndex }) => {
      await queryClient.cancelQueries({ queryKey: ['roadmap'] });
      const prev = queryClient.getQueryData(['roadmap']);
      queryClient.setQueryData(['roadmap'], (old) => {
        if (!old?.cards) return old;
        const moved = applyMove(old.cards, number, columnId, targetIndex);
        const posByNum = new Map(moved.positions.map((p) => [p.number, p.position]));
        return {
          ...old,
          cards: old.cards.map((c) =>
            posByNum.has(c.number)
              ? { ...c, position: posByNum.get(c.number), columnId: targetColumnIdFor(c, number, columnId, posByNum) }
              : c,
          ),
        };
      });
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['roadmap'], ctx.prev);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['roadmap'] }),
  });

  /**
   * The board reports the drop index in DISPLAYED order (which may be
   * filtered/sorted differently from the stored position order).
   * Convert to a targetIndex in the full position-ordered column by
   * anchoring on the card the drop lands before.
   */
  const handleMove = (number, columnId, targetIndex) => {
    const displayed = visibleCards
      .filter((c) => c.columnId === columnId && !c.isLastClosed)
      .sort(sortFn);
    const below = displayed[targetIndex];
    const fullLen = board.cards.filter((c) => c.columnId === columnId && c.number !== number).length;
    if (!below) {
      moveMutation.mutate({ number, columnId, targetIndex: fullLen });
      return;
    }
    const fullCol = board.cards
      .filter((c) => c.columnId === columnId && c.number !== number)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    const idx = fullCol.findIndex((c) => c.number === below.number);
    moveMutation.mutate({ number, columnId, targetIndex: idx === -1 ? fullLen : idx });
  };

  const renameMutation = useMutation({
    mutationFn: ({ id, title }) => apiPatch(`/api/roadmap/columns/${id}`, { title }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['roadmap'] }),
  });

  const addColumnMutation = useMutation({
    mutationFn: (title) => apiPost('/api/roadmap/columns', { title, kind: 'sprint' }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['roadmap'] }),
  });

  return (
    <div className="rm-page">
      <header className="rm-page-head">
        <div>
          <h1>Dynamic Roadmap</h1>
          <p className="rm-page-sub">
            Kanban × gantt planning over live GitHub issues — columns are phases/sprints,
            top-to-bottom order is the sequence, and blockers are enforced.
          </p>
        </div>
        <form
          className="rm-add-sprint"
          onSubmit={(e) => {
            e.preventDefault();
            const input = e.currentTarget.elements.sprint;
            if (input.value.trim()) {
              addColumnMutation.mutate(input.value.trim());
              input.value = '';
            }
          }}
        >
          <input name="sprint" placeholder="New sprint column…" aria-label="New sprint column" />
          <button type="submit" disabled={addColumnMutation.isPending}>
            ＋ Add sprint
          </button>
        </form>
      </header>

      {/* ── Filter row ── */}
      <div className="rm-filters">
        <div className="rm-filter-group" role="group" aria-label="Status filter">
          <button
            type="button"
            className={`rm-filter-btn ${statusFilter === 'open' ? 'rm-filter-active' : ''}`}
            onClick={() => setStatusFilter('open')}
          >
            Open
          </button>
          <button
            type="button"
            className={`rm-filter-btn ${statusFilter === 'closed' ? 'rm-filter-active' : ''}`}
            onClick={() => setStatusFilter('closed')}
          >
            Closed
          </button>
        </div>

        {statusFilter === 'open' && (
          <label className="rm-filter-check">
            <input
              type="checkbox"
              checked={showLastClosed}
              onChange={(e) => setShowLastClosed(e.target.checked)}
            />
            Show last closed per column
          </label>
        )}

        <select
          className="rm-filter-select"
          value={sortMode}
          onChange={(e) => setSortMode(e.target.value)}
          aria-label="Order cards by"
        >
          <option value="priority">Order: Priority</option>
          <option value="number">Order: Issue #</option>
        </select>

        <input
          className="rm-filter-search"
          type="search"
          placeholder="Search title or #number…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search cards"
        />
      </div>

      {error && !data && (
        <div className="rm-page-error">⚠️ Roadmap API unavailable — is the backend running?</div>
      )}

      {isLoading && !data ? (
        <div className="rm-page-loading">Loading roadmap…</div>
      ) : (
        <RoadmapBoard
          columns={board.columns}
          cards={visibleCards}
          sortMode={sortMode === 'number' ? 'number' : 'position'}
          onMove={handleMove}
          onRenameColumn={(id, title) => renameMutation.mutate({ id, title })}
          onOpenCard={(card) => window.open(`${GITHUB_ISSUE_URL}/${card.number}`, '_blank', 'noopener')}
        />
      )}
    </div>
  );
}

function targetColumnIdFor(card, movedNumber, targetColumnId, posByNum) {
  if (card.number === movedNumber) return targetColumnId;
  // All other repositioned cards were already in the target column.
  return posByNum.has(card.number) ? targetColumnId : card.columnId;
}
