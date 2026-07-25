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
        <div className="tp-controls-grid">
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
        <div className="faq-categories">
          {allCategories.map((cat) => (
            <button
              key={cat.name || '__all__'}
              type="button"
              className={`tp-chip ${activeCategory === cat.name ? 'tp-chip--ok' : ''}`}
              onClick={() => setActiveCategory(activeCategory === cat.name ? '' : cat.name)}
            >
              {cat.label || cat.name} ({cat.count})
            </button>
          ))}
        </div>
      </section>

      {/* Results count */}
      <p className="faq-results-count">
        {faqQuery.isLoading
          ? 'Loading...'
          : search.trim()
            ? `${entries.length} result${entries.length !== 1 ? 's' : ''} for '${search.trim()}'`
            : `${entries.length} question${entries.length !== 1 ? 's' : ''}`}
      </p>

      {/* FAQ entries */}
      {!faqQuery.isLoading && entries.length === 0 && (
        <div className="tp-card faq-empty">
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
            onClick={() => setExpandedId(isOpen ? null : entry.id)}
          >
            <div className="faq-entry-row">
              <div>
                <h3
                  className="faq-entry-title"
                  dangerouslySetInnerHTML={{ __html: highlight(entry.question) }}
                />
                <div className="faq-entry-tags">
                  <span className="tp-chip tp-chip--neutral">{entry.category}</span>
                  {entry.tags && entry.tags.split(',').filter(Boolean).slice(0, 3).map((tag) => (
                    <span key={tag} className="tp-chip tp-chip--neutral" style={{ opacity: 0.6 }}>{tag.trim()}</span>
                  ))}
                </div>
              </div>
              <span className="faq-entry-arrow">
                {isOpen ? '▲' : '▼'}
              </span>
            </div>

            {isOpen && (
              <div
                className="faq-answer"
                dangerouslySetInnerHTML={{ __html: highlight(entry.answer) }}
              />
            )}
          </article>
        )
      })}
    </div>
  )
}
