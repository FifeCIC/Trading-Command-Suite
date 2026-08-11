/**
 * GlossaryPage — Full glossary index with search and category filtering.
 *
 * Route: /education/glossary
 * Data: src/data/glossary.js (static, no API needed)
 *
 * BEFORE: Settings → Education Settings
 * AFTER:  Can be used standalone or as a slide-out overlay
 * NEXT:   GlossaryPopover component for inline term lookups
 */

import { useState, useMemo } from 'react';
import { getAllGlossary } from '../data/glossary';
import './glossary-page.css';

const GLOSSARY = getAllGlossary();

/** Extract unique categories in order of first appearance */
const CATEGORIES = [...new Set(GLOSSARY.map((e) => e.category).filter(Boolean))];

export default function GlossaryPage({ compact = false }) {
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('');
  const [expandedTerm, setExpandedTerm] = useState(null);

  const filtered = useMemo(() => {
    let entries = GLOSSARY;
    if (activeCategory) {
      entries = entries.filter((e) => e.category === activeCategory);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      entries = entries.filter(
        (e) =>
          e.term.toLowerCase().includes(q) ||
          e.definition.toLowerCase().includes(q) ||
          (e.aliases || []).some((a) => a.toLowerCase().includes(q)),
      );
    }
    return entries;
  }, [search, activeCategory]);

  const categoryCounts = useMemo(() => {
    const counts = {};
    CATEGORIES.forEach((cat) => {
      counts[cat] = GLOSSARY.filter((e) => e.category === cat).length;
    });
    return counts;
  }, []);

  function highlightMatch(text) {
    if (!search.trim()) return text;
    const q = search.trim();
    const regex = new RegExp(`(${escapeRegex(q)})`, 'gi');
    const parts = text.split(regex);
    return parts.map((part, i) =>
      part.toLowerCase() === q.toLowerCase() ? `<mark>${part}</mark>` : part,
    ).join('');
  }

  function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  return (
    <div className={`glossary-page${compact ? ' glossary-compact' : ''}`}>
      {!compact && (
        <header className="glossary-header">
          <h1>📖 Trading Glossary</h1>
          <p>Plain-language definitions for trading terms used throughout the app.</p>
        </header>
      )}

      {/* Search */}
      <div className="glossary-search-wrap">
        <input
          type="search"
          className="glossary-search"
          placeholder="Search glossary terms..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search glossary"
        />
      </div>

      {/* Category pills */}
      <div className="glossary-cats">
        <button
          className={`glossary-cat${!activeCategory ? ' active' : ''}`}
          onClick={() => setActiveCategory('')}
        >
          All ({GLOSSARY.length})
        </button>
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            className={`glossary-cat${activeCategory === cat ? ' active' : ''}`}
            onClick={() => setActiveCategory(cat)}
          >
            {cat} ({categoryCounts[cat] || 0})
          </button>
        ))}
      </div>

      {/* Results count */}
      {search.trim() && (
        <p className="glossary-count">
          {filtered.length} term{filtered.length !== 1 ? 's' : ''} matching "{search.trim()}"
        </p>
      )}

      {/* Term list */}
      <div className="glossary-list">
        {filtered.length === 0 ? (
          <div className="glossary-empty">
            <p>No terms found for "{search.trim()}".</p>
            <p>Try a different search or browse by category.</p>
          </div>
        ) : (
          filtered.map((entry) => {
            const isExpanded = expandedTerm === entry.term;
            return (
              <div
                key={entry.term}
                className={`glossary-entry${isExpanded ? ' expanded' : ''}`}
              >
                <button
                  className="glossary-entry-header"
                  onClick={() => setExpandedTerm(isExpanded ? null : entry.term)}
                  aria-expanded={isExpanded}
                >
                  <span className="glossary-entry-arrow">{isExpanded ? '▼' : '▶'}</span>
                  <span className="glossary-entry-term">
                    {search.trim() ? (
                      <span dangerouslySetInnerHTML={{ __html: highlightMatch(entry.term) }} />
                    ) : (
                      entry.term
                    )}
                  </span>
                  {entry.category && (
                    <span className="glossary-entry-cat">{entry.category}</span>
                  )}
                  {entry.aliases && entry.aliases.length > 0 && (
                    <span className="glossary-entry-aliases">
                      aka {entry.aliases.slice(0, 3).join(', ')}
                      {entry.aliases.length > 3 ? ` +${entry.aliases.length - 3}` : ''}
                    </span>
                  )}
                </button>
                {isExpanded && (
                  <div className="glossary-entry-body">
                    <p
                      dangerouslySetInnerHTML={{
                        __html: search.trim()
                          ? highlightMatch(entry.definition)
                          : entry.definition,
                      }}
                    />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Total count */}
      <p className="glossary-footer-count">
        {GLOSSARY.length} terms across {CATEGORIES.length} categories
      </p>
    </div>
  );
}
