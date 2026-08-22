/**
 * Research Notes — user paste-bin for research clippings.
 * ======================================================
 * Free-text notes (news, email, social, discord) with:
 *   - accordion open/close per note
 *   - drag-to-reorder (persisted to DB)
 *   - delete
 *   - ticker detection: uppercase tokens are highlighted; hovering opens a
 *     popout with Registered-Open / Gemini / Google / Register+Import actions.
 *
 * Persistence: /api/research/notes (research_note table).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Reorder, useDragControls } from 'motion/react';
import PageInfoPopover from '../components/PageInfoPopover';
import { apiGet, apiPost, apiPut, apiDelete } from '../core/api/client';
import './research-notes.css';

// Uppercase 2–5 letters, optional .XX suffix. Common English words filtered.
const TICKER_RE = /\b[A-Z]{2,5}(?:\.[A-Z]{1,2})?\b/g;

const COMMON_WORDS = new Set([
  'THE','AND','FOR','YOU','ARE','NOT','NEW','GET','OUT','ALL','BUT','CAN',
  'BUY','SELL','HOLD','AIM','FUND','FUNDS','AI','GDP','ETF','CEO','CFO','IPO',
  'EPS','PE','USD','GBP','EUR','OIL','GAS','APP','WEB','DAY','WEEK','MONTH',
  'YEAR','NEWS','DATA','HIGH','LOW','TOP','BEST','NEXT','LAST','THIS','THAT',
  'WITH','FROM','HAVE','WILL','MORE','MOST','SOME','SUCH','THAN','THEY','THEM',
  'WHEN','WHAT','WHICH','COULD','WOULD','SHOULD','ABOUT','AFTER','BEFORE',
  'OTHER','MANY','MUCH','MARKET','STOCK','STOCKS','TRADE','TRADING','GROWTH',
  'GLOBAL','WARMING','CLIMATE','CHANGE','WATER','FOOD','SOLAR','WIND','ENERGY',
  'POWER','GRID','BUILD','MAKE','MADE','ALSO','JUST','LIKE','THINK','KNOW',
  'GOOD','GREAT','FREE','ONLY','OVER','UNDER','INTO','ONTO','VERY','REAL',
  'MUST','NEED','NEEDS','BASED','BASIS','RATE','RATES','RISK','COST','COSTS',
  'ONE','TWO','THREE','FIVE','FOUR','SIX','PAGE','PAGES','MAY','JAN','FEB',
  'MAR','APR','JUN','JUL','AUG','SEP','OCT','NOV','DEC','MON','TUE','WED',
  'THU','FRI','SAT','SUN','CEO','CTO','CFO','COO','PM','AM','RE','DR','MR',
  'EST','INC','LTD','CORP','CO','PLC','SEC','NY','LA','DC','US','UK','EU',
]);

function detectTickers(text) {
  const found = [];
  const re = new RegExp(TICKER_RE.source, 'g');
  let m;
  while ((m = re.exec(text)) !== null) {
    const ticker = m[0];
    if (!COMMON_WORDS.has(ticker)) found.push({ ticker, index: m.index });
  }
  return found;
}

function NoteContent({ content, registry, onTickerHover, onTickerLeave }) {
  const parts = [];
  const matches = detectTickers(content);
  let cursor = 0;
  matches.forEach(({ ticker, index }, i) => {
    if (index > cursor) parts.push(content.slice(cursor, index));
    parts.push(
      <span
        key={`${index}-${i}`}
        className="rn-ticker"
        data-registered={registry.has(ticker) ? 'yes' : 'no'}
        onMouseEnter={(e) => onTickerHover(ticker, e)}
        onMouseLeave={onTickerLeave}
      >
        {ticker}
      </span>,
    );
    cursor = index + ticker.length;
  });
  if (cursor < content.length) parts.push(content.slice(cursor));
  return <div className="rn-content-text">{parts}</div>;
}

export default function ResearchNotesPage() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const [openIds, setOpenIds] = useState(() => new Set());
  const [popout, setPopout] = useState(null); // { ticker, x, y }
  const [registering, setRegistering] = useState(null); // ticker being registered
  const [registerMsg, setRegisterMsg] = useState(null); // { ticker, ok }
  const [massOpen, setMassOpen] = useState(false);
  const [watchlistChecked, setWatchlistChecked] = useState(false);
  const [watchlistName, setWatchlistName] = useState('');
  const [importing, setImporting] = useState(false);
  const [batchState, setBatchState] = useState(null); // /api/imports/batch/status
  const pollTimer = useRef(null);
  const popoutTimer = useRef(null);
  const dragControls = useDragControls();
  const didInitOpen = useRef(false);

  const notesQuery = useQuery({
    queryKey: ['research-notes'],
    queryFn: () => apiGet('/api/research/notes'),
  });
  const notes = notesQuery.data ?? [];

  const symbolsQuery = useQuery({
    queryKey: ['symbols-tickers'],
    queryFn: () => apiGet('/api/symbols'),
    staleTime: 60_000,
  });
  const registry = useMemo(() => {
    const set = new Set();
    for (const s of symbolsQuery.data?.symbols ?? []) {
      if (s?.ticker) set.add(String(s.ticker).toUpperCase());
    }
    return set;
  }, [symbolsQuery.data]);

  // Open the newest note by default on first load ONLY — afterwards the
  // user's open/closed state is respected (an effect keyed on openIds.size
  // would re-open the newest note every time the last one was collapsed).
  useEffect(() => {
    if (!didInitOpen.current && notes.length > 0) {
      didInitOpen.current = true;
      setOpenIds(new Set([notes[notes.length - 1].id]));
    }
  }, [notes]);

  // Clear any pending batch-status poll timer on unmount.
  useEffect(() => () => { if (pollTimer.current) clearTimeout(pollTimer.current); }, []);

  const toggleOpen = (id) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const addNote = async () => {
    const content = draft.trim();
    if (!content) return;
    await apiPost('/api/research/notes', { content });
    setDraft('');
    queryClient.invalidateQueries({ queryKey: ['research-notes'] });
  };

  const deleteNote = async (id) => {
    if (!window.confirm('Delete this note?')) return;
    await apiDelete(`/api/research/notes/${id}`);
    queryClient.invalidateQueries({ queryKey: ['research-notes'] });
  };

  const handleReorder = (reordered) => {
    // Local reorder is handled by Reorder.Group via `notes` state binding
    // below; persist the new order to the backend.
    apiPut('/api/research/notes/reorder', {
      orderedIds: reordered.map((n) => n.id),
    }).catch(() => queryClient.invalidateQueries({ queryKey: ['research-notes'] }));
  };

  const onTickerHover = (ticker, e) => {
    if (popoutTimer.current) clearTimeout(popoutTimer.current);
    const rect = e.target.getBoundingClientRect();
    const left = Math.min(rect.left, window.innerWidth - 250);
    setPopout({ ticker, x: left, y: rect.bottom + 6 });
  };
  const onTickerLeave = () => {
    if (popoutTimer.current) clearTimeout(popoutTimer.current);
    popoutTimer.current = setTimeout(() => setPopout(null), 160);
  };

  const registerTicker = async (ticker) => {
    setRegistering(ticker);
    setRegisterMsg(null);
    try {
      // CreateSymbolDto requires exchange + type (whitelist strips partial bodies).
      const res = await apiPost('/api/symbols', {
        ticker,
        name: ticker,
        exchange: 'Unknown',
        type: 'stock',
      });
      const symbolId = res?.symbol?.id;
      // Request market-data import for the new symbol (fire and forget).
      if (symbolId) {
        apiPost(`/api/imports/refresh/${symbolId}`).catch(() => {});
      }
      queryClient.invalidateQueries({ queryKey: ['symbols-tickers'] });
      setRegisterMsg({ ticker, ok: true });
    } catch {
      setRegisterMsg({ ticker, ok: false });
    } finally {
      setRegistering(null);
    }
  };

  // ── Mass import ─────────────────────────────────────────────
  // Union of tickers detected across ALL notes, minus registered ones.
  const unregisteredTickers = useMemo(() => {
    const set = new Set();
    for (const note of notes) {
      for (const { ticker } of detectTickers(note.content)) {
        if (!registry.has(ticker)) set.add(ticker);
      }
    }
    return [...set].sort();
  }, [notes, registry]);

  const pollBatchStatus = () => {
    apiGet('/api/imports/batch/status')
      .then((s) => {
        setBatchState(s);
        if (s?.running) pollTimer.current = setTimeout(pollBatchStatus, 2000);
        else queryClient.invalidateQueries({ queryKey: ['symbols-tickers'] });
      })
      .catch(() => {});
  };

  const runMassImport = async () => {
    if (unregisteredTickers.length === 0) return;
    setImporting(true);
    setBatchState(null);
    try {
      if (watchlistChecked && watchlistName.trim()) {
        await apiPost('/api/watchlists', {
          name: watchlistName.trim(),
          symbols: unregisteredTickers,
          source: 'research-notes',
        });
      }
      await apiPost('/api/imports/batch', {
        tickers: unregisteredTickers,
        timeframe: '1d',
        limit: 365,
      });
      setWatchlistChecked(false);
      setWatchlistName('');
      pollBatchStatus();
    } catch {
      setBatchState({ running: false, errors: ['Batch failed to start'] });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="rn-page">
      <header className="rn-header">
        <h1>
          Notes
          <PageInfoPopover>
            Paste research clippings — news, emails, social posts, discord chats.
            Uppercase tickers are detected automatically: hover one to open its
            symbol, research it on Gemini/Google, or register + import it.
            Drag the ⠿ handle to reorder; click a note to expand it.
          </PageInfoPopover>
        </h1>
      </header>

      <div className="rn-composer">
        <textarea
          className="rn-textarea"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Paste news, emails, social posts, discord chats…"
          rows={4}
        />
        <div className="rn-composer-row">
          {openIds.size > 0 && (
            <button className="rn-mass-btn" onClick={() => setMassOpen(true)} title="Import every unregistered ticker found in your notes">
              ⤵ Mass import symbols
            </button>
          )}
          <span className="rn-composer-spacer" />
          <button className="rn-add-btn" onClick={addNote} disabled={!draft.trim()}>
            Add note
          </button>
        </div>
      </div>

      {notes.length === 0 ? (
        <p className="rn-empty">No notes yet — paste your first clipping above.</p>
      ) : (
        <Reorder.Group
          as="div"
          axis="y"
          values={notes}
          onReorder={handleReorder}
          className="rn-list"
        >
          {notes.map((note) => {
            const open = openIds.has(note.id);
            const title = note.content.split('\n')[0].slice(0, 70) || '(empty note)';
            return (
              <Reorder.Item
                key={note.id}
                value={note}
                id={note.id}
                dragListener={false}
                dragControls={dragControls}
                className={`rn-item ${open ? 'rn-item--open' : ''}`}
              >
                <div className="rn-item-bar">
                  <span
                    className="rn-drag"
                    title="Drag to reorder"
                    onPointerDown={(e) => dragControls.start(e)}
                  >
                    ⠿
                  </span>
                  <button className="rn-item-toggle" onClick={() => toggleOpen(note.id)}>
                    <span className="rn-chevron">{open ? '▾' : '▸'}</span>
                    <span className="rn-item-title">{title}</span>
                  </button>
                  <span className="rn-item-meta">
                    {detectTickers(note.content).length > 0
                      ? `${detectTickers(note.content).length} ticker${detectTickers(note.content).length === 1 ? '' : 's'}`
                      : ''}
                  </span>
                  <button className="rn-delete-btn" onClick={() => deleteNote(note.id)} title="Delete note">
                    ✕
                  </button>
                </div>
                {open && (
                  <div className="rn-item-body">
                    <NoteContent
                      content={note.content}
                      registry={registry}
                      onTickerHover={onTickerHover}
                      onTickerLeave={onTickerLeave}
                    />
                  </div>
                )}
              </Reorder.Item>
            );
          })}
        </Reorder.Group>
      )}

      {massOpen && (
        <div className="rn-overlay" onClick={() => setMassOpen(false)}>
          <div className="rn-modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="rn-modal-title">Mass symbol import</h2>
            <p className="rn-modal-sub">
              <strong>{unregisteredTickers.length}</strong> unregistered ticker{unregisteredTickers.length === 1 ? '' : 's'} detected across your notes will be imported.
              {unregisteredTickers.length > 0 && (
                <span className="rn-modal-tickers">
                  {' '}{unregisteredTickers.slice(0, 25).join(', ')}{unregisteredTickers.length > 25 ? '…' : ''}
                </span>
              )}
            </p>
            {batchState && (
              <div className="rn-batch">
                {batchState.running
                  ? `Importing… ${batchState.done}/${batchState.total}${batchState.currentSymbol ? ` — now: ${batchState.currentSymbol}` : ''}`
                  : batchState.errors?.length
                    ? `Finished with ${batchState.errors.length} error(s): ${batchState.errors.slice(0, 5).join(' · ')}`
                    : 'Import finished.'}
              </div>
            )}
            <label className="rn-watchlist-row">
              <input
                type="checkbox"
                checked={watchlistChecked}
                onChange={(e) => setWatchlistChecked(e.target.checked)}
              />
              <span>Add these symbols to a new Watchlist</span>
            </label>
            {watchlistChecked && (
              <input
                className="rn-watchlist-name"
                value={watchlistName}
                onChange={(e) => setWatchlistName(e.target.value)}
                placeholder={`Research ${new Date().toISOString().slice(0, 10)}`}
              />
            )}
            <div className="rn-modal-actions">
              <button
                className="rn-add-btn"
                onClick={runMassImport}
                disabled={importing || unregisteredTickers.length === 0}
              >
                {importing ? 'Starting…' : 'Import'}
              </button>
              <button className="rn-cancel-btn" onClick={() => setMassOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {popout && (
        <div
          className="rn-popout"
          style={{ left: popout.x, top: popout.y }}
          onMouseEnter={() => { if (popoutTimer.current) clearTimeout(popoutTimer.current); }}
          onMouseLeave={onTickerLeave}
        >          <div className="rn-popout-head">
            <span className="rn-popout-ticker">{popout.ticker}</span>
            {registerMsg?.ticker === popout.ticker && (
              <span className="rn-popout-msg">{registerMsg.ok ? '✓ registered' : '✗ failed'}</span>
            )}
          </div>
          <div className="rn-popout-actions">
            {registry.has(popout.ticker) ? (
              <Link
                className="rn-popout-action rn-popout-action--primary"
                to={`/research/symbol/${popout.ticker}`}
              >
                Registered — Open
              </Link>
            ) : (
              <button
                className="rn-popout-action rn-popout-action--primary"
                disabled={registering === popout.ticker}
                onClick={() => registerTicker(popout.ticker)}
              >
                {registering === popout.ticker ? 'Registering…' : 'Register + import'}
              </button>
            )}
            <a
              className="rn-popout-action"
              href={`https://gemini.google.com/app?q=${encodeURIComponent(`${popout.ticker} stock analysis`)}`}
              target="_blank"
              rel="noreferrer"
            >
              Gemini
            </a>
            <a
              className="rn-popout-action"
              href={`https://www.google.com/search?q=${encodeURIComponent(`${popout.ticker} stock`)}`}
              target="_blank"
              rel="noreferrer"
            >
              Google
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
