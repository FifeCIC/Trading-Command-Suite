/**
 * RoadmapBoard — portable kanban × gantt board (epic #681, Phase C).
 * =====================================================================
 * Presentational core with zero TCS specifics: columns (editable
 * titles), cards (one per GitHub issue), HTML5 drag-and-drop with
 * fractional-position moves, dependency enforcement (via
 * roadmap-core validateMove) and cross-column dependency edges.
 *
 * Props:
 *   columns         [{ id, title, kind }] — left → right column order.
 *   cards           [{ number, title, state, labels, assignee, blockedBy,
 *                      columnId, position }]
 *   sortMode        'position' (default) | 'number' | 'priority' — card order
 *                   within columns (see roadmap-core compareCards)
 *   onMove          (cardNumber, columnId, targetIndex) → persist
 *   onRenameColumn  (columnId, title) → persist
 *   onOpenCard      (card) → optional navigation (GitHub issue link)
 *
 * Cards flagged `isLastClosed` are display helpers: non-draggable, badged.
 */
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { validateMove, compareCards } from '../../core/roadmap/roadmap-core';
import './roadmap-board.css';

// ── Pipeline-style visuals (2026-09-03) ────────────────────────────
// Type icons per GitHub label; priority colours per priority-* label.
const TYPE_ICONS = [
  ['bug', '🐞'],
  ['enhancement', '✨'],
  ['documentation', '📘'],
  ['discussion', '💬'],
  ['question', '❓'],
  ['epic', '⭐'],
  ['research', '🔬'],
  ['dependencies', '🔗'],
  ['wontfix', '🚫'],
  ['infra', '🛠️'],
  ['experimental', '🧪'],
  ['strategy', '🎯'],
];

// Column accent palette — mirrors the META.Stack pipeline lane colours.
const COLUMN_COLORS = ['#3b82f6', '#22c55e', '#8b5cf6', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899'];

function cardType(card) {
  const labels = card.labels || [];
  const hit = TYPE_ICONS.find(([label]) => labels.includes(label));
  return hit ? { icon: hit[1], label: hit[0] } : null;
}

function cardPriority(card) {
  const labels = card.labels || [];
  if (labels.includes('priority-high')) return 'high';
  if (labels.includes('priority-medium')) return 'medium';
  if (labels.includes('priority-low')) return 'low';
  return null;
}

export default function RoadmapBoard({
  columns = [],
  cards = [],
  sortMode = 'position',
  onMove,
  onRenameColumn,
  onOpenCard,
}) {
  const boardRef = useRef(null);
  const cardRefs = useRef(new Map());
  const [dragNumber, setDragNumber] = useState(null);
  const [dropTarget, setDropTarget] = useState(null); // { columnId, index }
  const [violation, setViolation] = useState(null); // { columnId, message }
  const [editingCol, setEditingCol] = useState(null);
  const [editText, setEditText] = useState('');
  const [rects, setRects] = useState({});

  const byNumber = useMemo(() => new Map(cards.map((c) => [c.number, c])), [cards]);
  const blockedByMap = useMemo(() => {
    const m = {};
    for (const c of cards) {
      if (c.blockedBy?.length) m[c.number] = c.blockedBy;
    }
    return m;
  }, [cards]);
  const columnOrder = columns.map((c) => c.id);

  const measure = useCallback(() => {
    const boardRect = boardRef.current?.getBoundingClientRect();
    if (!boardRect) return;
    const next = {};
    for (const [num, el] of cardRefs.current) {
      const r = el.getBoundingClientRect();
      next[num] = {
        x: r.left - boardRect.left,
        y: r.top - boardRect.top,
        w: r.width,
        h: r.height,
      };
    }
    setRects(next);
  }, []);

  useLayoutEffect(() => {
    measure();
  }, [cards, columns, measure]);

  useLayoutEffect(() => {
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  // ── Drag ─────────────────────────────────────────────────────────
  const handleDragStart = (card) => (e) => {
    setDragNumber(card.number);
    setViolation(null);
    e.dataTransfer.setData('text/plain', String(card.number));
    e.dataTransfer.effectAllowed = 'move';
  };

  const attemptMove = (number, columnId, index) => {
    const moving = byNumber.get(number);
    if (!moving) return;
    const check = validateMove(cards, blockedByMap, number, columnId, index, columnOrder);
    if (!check.ok) {
      setViolation({ columnId, message: check.violations.join(' · ') });
      setDragNumber(null);
      setDropTarget(null);
      return;
    }
    setViolation(null);
    onMove?.(number, columnId, index);
    setDragNumber(null);
    setDropTarget(null);
  };

  const handleCardDragOver = (columnId, index) => (e) => {
    if (dragNumber == null) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    const before = e.clientY < r.top + r.height / 2;
    const idx = before ? index : index + 1;
    if (!dropTarget || dropTarget.columnId !== columnId || dropTarget.index !== idx) {
      setDropTarget({ columnId, index: idx });
    }
  };

  const handleColumnDragOver = (columnId, count) => (e) => {
    if (dragNumber == null) return;
    e.preventDefault();
    if (!dropTarget || dropTarget.columnId !== columnId || dropTarget.index !== count) {
      setDropTarget({ columnId, index: count });
    }
  };

  const handleColumnDrop = (columnId, count) => (e) => {
    e.preventDefault();
    const number = dragNumber ?? parseInt(e.dataTransfer.getData('text/plain'), 10);
    const idx = dropTarget && dropTarget.columnId === columnId ? dropTarget.index : count;
    if (number) attemptMove(number, columnId, idx);
    else {
      setDragNumber(null);
      setDropTarget(null);
    }
  };

  const handleDragEnd = () => {
    setDragNumber(null);
    setDropTarget(null);
  };

  // ── Rename ───────────────────────────────────────────────────────
  const startRename = (col) => {
    setEditingCol(col.id);
    setEditText(col.title);
  };
  const commitRename = () => {
    if (editingCol && editText.trim()) onRenameColumn?.(editingCol, editText.trim());
    setEditingCol(null);
  };

  // ── Dependency edges (cross-column only) ─────────────────────────
  const edges = useMemo(() => {
    const list = [];
    for (const card of cards) {
      if (!card.blockedBy?.length) continue;
      const a = rects[card.number];
      if (!a) continue;
      for (const blockerNumber of card.blockedBy) {
        const blocker = byNumber.get(blockerNumber);
        if (!blocker || blocker.columnId === card.columnId) continue;
        const b = rects[blockerNumber];
        if (!b) continue;
        const y1 = b.y + b.h / 2;
        const y2 = a.y + a.h / 2;
        const x1 = b.x + b.w;
        const x2 = a.x;
        list.push({ key: `${blockerNumber}->${card.number}`, d: `M ${x1} ${y1} C ${x1 + 48} ${y1}, ${x2 - 48} ${y2}, ${x2} ${y2}` });
      }
    }
    return list;
  }, [cards, rects, byNumber]);

  return (
    <div className="rm-scroll">
      <div className="rm-board" ref={boardRef}>
        <svg className="rm-edge-layer">
          {edges.map((e) => (
            <path key={e.key} d={e.d} className="rm-edge" />
          ))}
        </svg>
        {columns.map((col, colIndex) => {
          const colCards = cards
            .filter((c) => c.columnId === col.id)
            .sort((a, b) => compareCards(a, b, sortMode));
          const colColor = COLUMN_COLORS[colIndex % COLUMN_COLORS.length];
          const rejected = violation?.columnId === col.id;
          return (
            <section
              key={col.id}
              className={`rm-column ${rejected ? 'rm-column-reject' : ''}`}
              style={{
                borderColor: rejected ? 'rgba(220,38,38,0.55)' : colColor + '44',
                background: colColor + '06',
              }}
              onDragOver={handleColumnDragOver(col.id, colCards.length)}
              onDrop={handleColumnDrop(col.id, colCards.length)}
            >
              <header className="rm-col-head">
                {editingCol === col.id ? (
                  <input
                    className="rm-col-input"
                    autoFocus
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename();
                      if (e.key === 'Escape') setEditingCol(null);
                    }}
                  />
                ) : (
                  <h3
                    onDoubleClick={() => startRename(col)}
                    title="Double-click to rename"
                    style={{ color: colColor }}
                  >
                    {col.title}
                  </h3>
                )}
                <span className="rm-col-count">{colCards.length}</span>
              </header>
              {violation?.columnId === col.id && (
                <div className="rm-violation">⛔ {violation.message}</div>
              )}
              <div className="rm-col-cards">
                {colCards.map((c, i) => {
                  const type = cardType(c);
                  const prio = cardPriority(c);
                  return (
                  <article
                    key={c.number}
                    ref={(el) => {
                      if (el) cardRefs.current.set(c.number, el);
                      else cardRefs.current.delete(c.number);
                    }}
                    className={[
                      'rm-card',
                      prio ? `rm-card-p-${prio}` : '',
                      c.state === 'closed' ? 'rm-card-closed' : '',
                      c.isLastClosed ? 'rm-card-lastclosed' : '',
                      dragNumber === c.number ? 'rm-card-dragging' : '',
                      dropTarget && dropTarget.columnId === col.id && dropTarget.index === i ? 'rm-drop-before' : '',
                    ].join(' ')}
                    draggable={!c.isLastClosed}
                    onDragStart={c.isLastClosed ? undefined : handleDragStart(c)}
                    onDragEnd={handleDragEnd}
                    onDragOver={handleCardDragOver(col.id, i)}
                  >
                    <div className="rm-card-top">
                      {type && (
                        <span className="rm-card-icon" title={`Type: ${type.label}`}>
                          {type.icon}
                        </span>
                      )}
                      <span className="rm-card-num">#{c.number}</span>
                      {type && <span className="rm-card-typelabel">{type.label}</span>}
                      <span className="rm-card-badges">
                        {prio && (
                          <span className={`rm-badge rm-badge-priority rm-badge-p-${prio}`}>
                            {prio === 'high' ? 'HIGH' : prio === 'medium' ? 'MED' : 'LOW'}
                          </span>
                        )}
                        {c.blockedBy?.length > 0 && (
                          <span
                            className="rm-badge rm-badge-chain"
                            title={`Blocked by ${c.blockedBy.map((n) => `#${n}`).join(', ')}`}
                          >
                            ⛓{c.blockedBy.length}
                          </span>
                        )}
                        {c.state === 'closed' && <span className="rm-badge rm-badge-closed">closed</span>}
                        {c.isLastClosed && <span className="rm-badge rm-badge-lastclosed">last closed</span>}
                        {c.assignee && (
                          <span className="rm-badge rm-badge-owner" title={c.assignee}>
                            {c.assignee.slice(0, 1).toUpperCase()}
                          </span>
                        )}
                      </span>
                    </div>
                    <span
                      className="rm-card-title"
                      title={c.title}
                      onClick={() => onOpenCard?.(c)}
                    >
                      {c.title}
                    </span>
                  </article>
                  );
                })}
                {colCards.length === 0 && <div className="rm-col-empty">Drop cards here</div>}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
