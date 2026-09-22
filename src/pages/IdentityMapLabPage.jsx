/**
 * IdentityMapLabPage — "which column holds which identity?", laid out in one place.
 * Route: /lab/identity-map
 *
 * ⚠️ TEMPORARY / DIAGNOSTIC. Reads a SNAPSHOT: src/data/identity-map.json, produced by
 *    `node nest/scripts/identity-map.cjs`. Re-run that script after schema or data changes.
 *
 * WHY IT EXISTS
 * -------------
 * A recurring class of defect in this repo is a column that is NAMED for an identity but holds a
 * different one: `trade.scoringStrategyId` holds bot ids, protocol slugs AND orphaned UUIDs;
 * `score_snapshot.protocolId` is typed UUID-width but is mostly slugs. Each instance is found
 * separately, painfully, and only when something downstream misreads it.
 *
 * The reason is structural, and this page makes it visible: **182 reference-shaped columns exist
 * and 181 of them have no foreign key**, so nothing enforces what a column named `protocolId`
 * contains — or which protocol identifier it contains. Nine column NAMES have conflicting types
 * across tables; `protocolId` alone appears at four different widths.
 *
 * This is a MAP, not a fix. It exists so the next agent can see the disagreement in one screen
 * instead of rediscovering it from a symptom.
 */

import { useState, useMemo } from 'react';
import map from '../data/identity-map.json';
import styles from './identity-map-lab.module.css';

/** Short, plain-language label for an identity space. */
const SPACE_LABEL = {
  'protocol.id': 'protocol id (UUID)',
  'protocol.slug': 'protocol slug',
  'trading_strategy.id': 'bot id',
  'scoring_strategy.id': 'scoring-strategy id',
  'symbol.id': 'symbol id',
  'symbol.ticker': 'ticker',
};

export default function IdentityMapLabPage() {
  const [family, setFamily] = useState('all');
  const [query, setQuery] = useState('');
  const [onlyProblems, setOnlyProblems] = useState(true);

  const { headline, families, columns, nameConflicts, spaces, spineEvidence } = map;

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return columns.filter((c) => {
      if (family !== 'all' && c.family !== family) return false;
      if (q && !`${c.table}.${c.column}`.toLowerCase().includes(q)) return false;
      // ⚠️ `drawsFrom` is read defensively. An earlier snapshot omitted it on unreadable rows,
      // and a bare `.length` threw — taking the WHOLE page down behind the error boundary
      // because of one bad row. One malformed row must degrade to one odd-looking cell.
      const draws = c.drawsFrom || [];
      // "Problems" = nothing enforces it AND it is ambiguous or unplaceable.
      if (onlyProblems && (c.enforced || (!c.ambiguous && draws.length > 0))) return false;
      return true;
    });
  }, [columns, family, query, onlyProblems]);

  const ambiguous = columns.filter((c) => c.ambiguous);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>Identity Map</h1>
        <p className={styles.sub}>
          Every column that looks like it names something, and what it <strong>actually</strong> holds.
          Snapshot {new Date(map.generatedAt).toLocaleString('en-GB')} ·{' '}
          <span className={styles.mono}>node nest/scripts/identity-map.cjs</span> rebuilds it.
        </p>
      </header>

      {/* ── Headline ── */}
      <section className={styles.tiles}>
        <Tile label="Reference columns" value={headline.referenceColumns} sub="name-shaped like a reference" />
        <Tile label="Enforced" value={headline.enforced} tone="good" sub="foreign keys" />
        <Tile label="Free text" value={headline.unenforced} tone="bad" sub="nothing enforces them" />
        <Tile label="Ambiguous" value={headline.ambiguous} tone="bad" sub="draw from >1 identity space" />
        <Tile label="Unplaceable" value={headline.matchesNothingKnown} tone="warn" sub="match none of 6 modelled spaces" />
        <Tile label="Name conflicts" value={nameConflicts.length} tone="warn" sub="same name, different type" />
      </section>

      <p className={styles.note}>
        <strong>Read this first.</strong> “Unplaceable” is <em>not</em> the same as “broken”. The classifier
        knows six identity spaces (protocol id/slug, bot id, scoring-strategy id, symbol id/ticker) —
        a column holding broker numbers, provider names or watchlist names will legitimately match
        none of them. The trustworthy signals on this page are <strong>Ambiguous</strong> (a column
        provably drawing from two spaces at once) and <strong>Name conflicts</strong> (the same name
        meaning different things in different tables).
      </p>

      {/* ── The punchline ── */}
      <section className={styles.card}>
        <h2>The columns that provably hold two things at once</h2>
        <p className={styles.cardSub}>
          Each of these matched more than one identity space in the same column. A reader who trusts
          the column NAME gets the wrong answer for some fraction of rows — silently.
        </p>
        <div className={styles.ambiguous}>
          {ambiguous.map((c) => {
            const total = c.drawsFrom.reduce((n, d) => n + d.n, 0);
            const unmatched = c.unmatched;
            return (
              <div key={`${c.table}.${c.column}`} className={styles.ambCard}>
                <div className={styles.ambHead}>
                  <span className={styles.mono}>{c.table}.{c.column}</span>
                  <span className={styles.typeChip}>{c.type}</span>
                </div>
                <div className={styles.split} role="img" aria-label={c.drawsFrom.map((d) => `${d.space} ${d.n}`).join(', ')}>
                  {c.drawsFrom.map((d, i) => (
                    <span
                      key={d.space}
                      className={`${styles.splitSeg} ${i % 2 ? styles.segB : styles.segA}`}
                      style={{ width: `${(d.n / (total + unmatched || 1)) * 100}%` }}
                    />
                  ))}
                  {unmatched > 0 && (
                    <span className={styles.splitSegNone} style={{ width: `${(unmatched / (total + unmatched || 1)) * 100}%` }} />
                  )}
                </div>
                <ul className={styles.legend}>
                  {c.drawsFrom.map((d, i) => (
                    <li key={d.space}>
                      <i className={`${styles.dot} ${i % 2 ? styles.segB : styles.segA}`} />
                      {SPACE_LABEL[d.space] || d.space} <strong>{d.n}</strong>
                    </li>
                  ))}
                  {unmatched > 0 && (
                    <li><i className={styles.dotNone} /> matches no modelled space <strong>{unmatched}</strong></li>
                  )}
                </ul>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Name conflicts ── */}
      <section className={styles.card}>
        <h2>Same name, different meaning</h2>
        <p className={styles.cardSub}>
          A column name is a <em>claim</em> about what it holds. These names appear in several tables
          with <strong>different column types</strong> — a width difference is a tell that the value
          space differs too. <span className={styles.mono}>protocolId</span> appears at four widths.
        </p>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Column</th>
                <th>Types seen</th>
                <th>Tables</th>
                <th>Enforced anywhere?</th>
              </tr>
            </thead>
            <tbody>
              {nameConflicts.map((c) => (
                <tr key={c.column} className={c.enforcedAnywhere ? '' : styles.rowWarn}>
                  <td className={styles.mono}>{c.column}</td>
                  <td>{c.types.map((t) => <span key={t} className={styles.typeChip}>{t}</span>)}</td>
                  <td className={styles.num}>{c.tables}</td>
                  <td>{c.enforcedAnywhere ? 'yes' : <span className={styles.no}>no</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Spine evidence ── */}
      <section className={styles.card}>
        <h2>The spine tables</h2>
        <p className={styles.cardSub}>
          What the tables other columns point at actually offer. Note <span className={styles.mono}>protocol</span>{' '}
          has <strong>two</strong> identifiers — that is the root of the whole problem.
        </p>
        <ul className={styles.spineList}>
          {spineEvidence.map((s) => (
            <li key={s.table}>
              <span className={styles.mono}>{s.table}</span>
              <span>{s.note}</span>
            </li>
          ))}
        </ul>
        <div className={styles.spaces}>
          {Object.entries(spaces).map(([k, n]) => (
            <span key={k} className={styles.spaceChip}>
              {SPACE_LABEL[k] || k} <strong>{n}</strong>
            </span>
          ))}
        </div>
      </section>

      {/* ── Full inventory ── */}
      <section className={styles.card}>
        <h2>All reference columns</h2>
        <div className={styles.controls}>
          <div className={styles.chips}>
            <button
              type="button"
              className={`${styles.chip} ${family === 'all' ? styles.chipOn : ''}`}
              onClick={() => setFamily('all')}
            >
              All <strong>{columns.length}</strong>
            </button>
            {families.map((f) => (
              <button
                key={f.key}
                type="button"
                className={`${styles.chip} ${family === f.key ? styles.chipOn : ''}`}
                onClick={() => setFamily(f.key)}
              >
                {f.label} <strong>{f.columns}</strong>
              </button>
            ))}
          </div>
          <label className={styles.search}>
            <span className={styles.srOnly}>Filter by table or column</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter table or column…"
            />
          </label>
          <label className={styles.toggle}>
            <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} />
            Only unenforced &amp; unplaceable
          </label>
        </div>

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Table</th>
                <th>Column</th>
                <th>Type</th>
                <th>FK</th>
                <th>Rows</th>
                <th>Holds</th>
                <th>Sample values</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 400).map((c) => (
                <tr key={`${c.table}.${c.column}`} className={c.ambiguous ? styles.rowAmb : ''}>
                  <td>{c.table}</td>
                  <td className={styles.mono}>{c.column}</td>
                  <td><span className={styles.typeChip}>{c.type}</span></td>
                  <td>{c.enforced ? '✓' : <span className={styles.no}>—</span>}</td>
                  <td className={styles.num}>{c.totalRows == null ? '—' : `${c.nonNull}/${c.totalRows}`}</td>
                  <td>
                    {c.unreadable ? <em className={styles.unreadable}>unreadable</em>
                      : (c.drawsFrom || []).length === 0 ? <em className={styles.none}>unplaced</em>
                        : (c.drawsFrom || []).map((d) => (
                            <span key={d.space} className={styles.spaceTag}>
                              {SPACE_LABEL[d.space] || d.space} <strong>{d.n}</strong>
                            </span>
                          ))}
                  </td>
                  <td className={styles.sample}>
                    {(c.sample || []).map((v) => <code key={v}>{v}</code>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length > 400 && <p className={styles.cardSub}>Showing 400 of {rows.length} matching columns.</p>}
        {rows.length === 0 && <p className={styles.cardSub}>No columns match the current filter.</p>}
      </section>
    </div>
  );
}

function Tile({ label, value, sub, tone = '' }) {
  return (
    <div className={`${styles.tile} ${tone ? styles[tone] : ''}`}>
      <span className={styles.tileLabel}>{label}</span>
      <span className={styles.tileValue}>{value}</span>
      <span className={styles.tileSub}>{sub}</span>
    </div>
  );
}
