/**
 * ResultByDayStep.test.jsx — the day table's two claims that a reader acts on.
 *
 * ⚠️ WHY THIS SPEC EXISTS (2026-11-27). The "Excluded" column showed a bare number — 34 — with nothing
 * saying what it was. Measured, the 34 was `25 not picked + 9 pre-cutoff`, and those two halves mean
 * OPPOSITE things: one is the strategy's selectivity, the other is the test's own cutoff rule. A reader
 * who saw only `34` would conclude the strategy declined 34 opportunities on the day it was measured.
 *
 * These assert the SPLIT IS VISIBLE and that "nothing excluded" and "this day did not run" still render
 * differently — the two states that must never collapse into one another.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import ResultByDayStep from './ResultByDayStep.jsx';
import { summariseExclusions } from './selection-exclusions.js';
import { useSort } from '../../core/use-sort';

afterEach(cleanup);

/**
 * ⚠️ A REAL `useSort`, not a stub. `SortableTh` calls `api.ariaSort()`, and a stub that omits it makes
 * the table throw before any row renders — the first version of this spec hand-built `{ sorted }` and
 * four tests failed with `api.ariaSort is not a function`. Using the hook keeps the test honest about
 * what the page actually passes.
 */
function Harness({ rows }) {
  const sort = useSort(rows, 'answerDate', 'desc');
  return <ResultByDayStep sort={sort} />;
}

const baseRow = {
  id: 'movers-winners-2026-11-11',
  answerDate: '2026-11-11',
  ranked: [],
  selected: ['NXXT'],
  candidates: 10,
  trades: 29,
  winRate: 17.24,
  netPnl: 229.49,
  notice: null,
};

const renderRows = (rows) => render(<Harness rows={rows} />);

describe('ResultByDayStep', () => {
  it('shows the split of what the run did not count, not just the total', () => {
    const exclusions = summariseExclusions([
      { symbol: 'NXXT', trades: 29, excludedNotSelected: 25, excludedBeforeCutoff: 9 },
    ]);
    renderRows([{ ...baseRow, exclusions, excluded: exclusions.total }]);

    expect(screen.getByText('34')).toBeTruthy();
    expect(screen.getByText('25 not picked · 9 pre-cutoff')).toBeTruthy();
    // The two halves are on screen as text, so a screen reader gets them too — not only in a tooltip.
    expect(screen.getByText('Not counted')).toBeTruthy();
  });

  it('renders a zero total as 0 with NO split — "nothing was excluded" is a result', () => {
    const exclusions = summariseExclusions([{ trades: 6, excludedNotSelected: 0, excludedBeforeCutoff: 0 }]);
    renderRows([{ ...baseRow, trades: 6, exclusions, excluded: 0 }]);

    expect(screen.getByText('0')).toBeTruthy();
    expect(screen.queryByText(/not picked/)).toBeNull();
  });

  it('renders an em dash when there is nothing to split — a day that did not run has excluded nothing', () => {
    renderRows([{ ...baseRow, exclusions: null, excluded: null }]);
    const cells = screen.getAllByRole('cell');
    const last = cells[cells.length - 1];
    expect(last.textContent).toBe('—');
  });

  it('marks a FAILED day as failed, and still shows an em dash rather than zero', () => {
    renderRows([{ ...baseRow, notice: { title: 'Run refused' }, exclusions: null, excluded: null }]);
    expect(screen.getByText('Run refused')).toBeTruthy();
    const cells = screen.getAllByRole('cell');
    expect(cells[cells.length - 1].textContent).toBe('—');
    expect(screen.getAllByText('—').length).toBeGreaterThan(1);
  });

  it('renders an em dash for a count the run did not return — a blank cell reads as zero', () => {
    renderRows([{ ...baseRow, candidates: null, trades: null, winRate: null }]);
    const cells = screen.getAllByRole('cell');
    // Day, ranked, traded, candidates, trades, win %, P/L bar cell, not-counted
    const numeric = cells.slice(3, 6).map((c) => c.textContent);
    expect(numeric).toEqual(['—', '—', '—']);
  });

  it('shows the strategy’s own ranking on screen, not only in a hover title', () => {
    renderRows([
      {
        ...baseRow,
        ranked: [
          { symbol: 'NXXT', movePct: 6.8, rank: 1, selected: true },
          { symbol: 'KPTI', movePct: null, rank: null, reason: 'no bars before the cutoff', selected: false },
        ],
      },
    ]);

    // The rank is VISIBLE — one character, in the chip, reachable by keyboard and screen reader.
    expect(screen.getByText('1')).toBeTruthy();
    // …and the chip carries the facts as an accessible name, so hovering is not the only way to learn them.
    expect(screen.getByLabelText('NXXT, rank 1, picked')).toBeTruthy();
    // A candidate that could not be measured says so, rather than rendering a rank of 0.
    expect(screen.getByLabelText('KPTI, not measurable')).toBeTruthy();
    expect(screen.getByTitle('no bars before the cutoff')).toBeTruthy();
  });

  it('says there is nothing to show when no day finished, instead of rendering an empty table', () => {
    renderRows([]);
    expect(screen.getByText(/No session finished/)).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });
});
