import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../core/api/client'
import './trading-platforms.css'

export default function FaqPage() {
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState('')
  const [expandedId, setExpandedId] = useState(null)

  const searchParams = new URLSearchParams()
  if (search.trim()) searchParams.set('search', search.trim())
  if (activeCategory) searchParams.set('category', activeCategory)

  const faqQuery = useQuery({
    queryKey: ['faq', search.trim(), activeCategory],
    queryFn: () => apiGet(`/api/faq?${searchParams}`),
  })

  const categoriesQuery = useQuery({
    queryKey: ['faq-categories'],
    queryFn: () => apiGet('/api/faq/categories'),
  })

  const entries = Array.isArray(faqQuery.data?.entries) ? faqQuery.data.entries : []
  const categories = Array.isArray(categoriesQuery.data?.categories) ? categoriesQuery.data.categories : []
  const allCount = categories.reduce((sum, c) => sum + c.count, 0)

  const allCategories = useMemo(
    () => [{ name: '', count: allCount, label: 'All' }, ...categories],
    [categories, allCount],
  )

  /**
   * Highlight search terms in text.
   */
  function highlight(text) {
    if (!search.trim()) return text
    const q = search.trim()
    const parts = text.split(new RegExp(`(${escapeRegex(q)})`, 'gi'))
    return parts.map((part, i) =>
      part.toLowerCase() === q.toLowerCase()
        ? `<mark key={i}>${part}</mark>`
        : part,
    ).join('')
  }

  function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  return (
    <div className="trading-platforms-page">
      <header className="tp-page-header">
        <h1>FAQ</h1>
        <p>Frequently asked questions about the Trading Command Suite.</p>
      </header>

      {/* Search bar */}
      <section className="tp-card">
        <div className="tp-controls-grid" style={{ alignItems: 'end' }}>
          <label className="tp-control" style={{ flex: 1 }}>
            <span>Search</span>
            <input
              type="text"
              placeholder="Search questions, answers, or tags..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="faq-search-input"
            />
          </label>
        </div>

        {/* Category filter chips */}
        <div className="faq-categories" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.75rem' }}>
          {allCategories.map((cat) => (
            <button
              key={cat.name || '__all__'}
              type="button"
              className={`tp-chip ${activeCategory === cat.name ? 'tp-chip--ok' : ''}`}
              onClick={() => setActiveCategory(activeCategory === cat.name ? '' : cat.name)}
              style={{ cursor: 'pointer', fontSize: '0.82rem' }}
            >
              {cat.label || cat.name} ({cat.count})
            </button>
          ))}
        </div>
      </section>

      {/* Results count */}
      <p style={{ margin: '0.75rem 0', fontSize: '0.85rem', color: 'var(--ink-soft)' }}>
        {faqQuery.isLoading
          ? 'Loading...'
          : search.trim()
            ? `${entries.length} result${entries.length !== 1 ? 's' : ''} for '${search.trim()}'`
            : `${entries.length} question${entries.length !== 1 ? 's' : ''}`}
      </p>

      {/* FAQ entries */}
      {!faqQuery.isLoading && entries.length === 0 && (
        <div className="tp-card" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
          <p>No FAQ entries yet.</p>
          <p className="hint">Content will be added in a future update.</p>
        </div>
      )}

      {entries.map((entry) => {
        const isOpen = expandedId === entry.id

        return (
          <article
            key={entry.id}
            className="tp-card faq-entry"
            style={{ marginBottom: '0.5rem', cursor: 'pointer' }}
            onClick={() => setExpandedId(isOpen ? null : entry.id)}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
              <div>
                <h3
                  style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600 }}
                  dangerouslySetInnerHTML={{ __html: highlight(entry.question) }}
                />
                <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.35rem' }}>
                  <span className="tp-chip tp-chip--neutral" style={{ fontSize: '0.7rem' }}>{entry.category}</span>
                  {entry.tags && entry.tags.split(',').filter(Boolean).slice(0, 3).map((tag) => (
                    <span key={tag} className="tp-chip tp-chip--neutral" style={{ fontSize: '0.7rem', opacity: 0.6 }}>{tag.trim()}</span>
                  ))}
                </div>
              </div>
              <span style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', flexShrink: 0 }}>
                {isOpen ? '▲' : '▼'}
              </span>
            </div>

            {isOpen && (
              <div
                className="faq-answer"
                style={{
                  marginTop: '0.75rem',
                  paddingTop: '0.75rem',
                  borderTop: '1px solid var(--line)',
                  lineHeight: 1.6,
                  fontSize: '0.9rem',
                }}
                dangerouslySetInnerHTML={{ __html: highlight(entry.answer) }}
              />
            )}
          </article>
        )
      })}
    </div>
  )
}
